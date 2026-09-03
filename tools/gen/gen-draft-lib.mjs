// ============================================================
// tools/lib/gen-draft-lib.mjs · 单次 LLM 草稿生成器公共库
// ============================================================
// 抽自 gen-abc-draft.mjs / gen-fresh-eyes-draft.mjs 的整段重复：
//   MODEL_CFG / 参数解析 / 版本号 / key 解析 / 降级写盘 / LLM 调用。
// 两工具唯一真正的差异是「输入参数定义 + prompt 模板」——留在各自文件。
//
// 复用约定（退出码语义，两个调用方保持一致）：
//   0 = 草稿生成
//   1 = 参数或输入错误（无来源 / 路径不存在 / 版本号读不出）
//   2 = LLM 不可用（已降级输出 prompt 到 <out>.prompt.md）
//
// LLM 配置来源：FORGE/models/glm-5.3.mjs（GLM-5.3 Coding Plan 专用端点）。
// ============================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** 仓库根（本库位于 tools/ → 上两级） */
export const REPO_ROOT = join(__dirname, '../..');

/**
 * 模型配置：读 FORGE/models/profile.mjs 的 A 角色（与 driver 同源——换模型只改 profile 一处）。
 * v1.3.9 修复（2026-08-21）：此前硬编码 GLM-5.2，FORGE 模型切换（GLM→deepseek-v4-flash）后
 * 草稿工具仍调 GLM——GLM API 限额（429 7 天上限）即挂。现同步解析 profile.mjs 的 A 角色
 * 模型文件（纯文本解析，零异步——loadModelConfig 为同步函数，不能用动态 import）。
 * GLM 恢复后切回 profile.mjs 即自动跟随，无需改本文件。
 * temperature 由调用方按任务性质覆盖：分类 0.3 / 审查草稿 0.5。
 */
export function loadModelConfig(overrides = {}) {
  try {
    const profilePath = join(REPO_ROOT, 'FORGE/models/profile.mjs');
    if (existsSync(profilePath)) {
      const profileSrc = readFileSync(profilePath, 'utf-8');
      // ① 变量名 → 模型文件：`import deepseekV4Flash from './deepseek-v4-flash.mjs';`
      const importMap = {};
      for (const m of profileSrc.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/([\w.-]+\.mjs)['"]/g)) {
        importMap[m[1]] = m[2];
      }
      // ② A 角色引用的变量：`A: { model: deepseekV4Flash,`
      const aVar = profileSrc.match(/A:\s*\{\s*model:\s*(\w+)/)?.[1];
      if (aVar && importMap[aVar]) {
        const modelSrc = readFileSync(join(REPO_ROOT, 'FORGE/models', importMap[aVar]), 'utf-8');
        const model = modelSrc.match(/model:\s*['"]([^'"]+)['"]/)?.[1];
        const baseURL = modelSrc.match(/baseURL:\s*['"]([^'"]+)['"]/)?.[1];
        const apiKeyEnv = modelSrc.match(/apiKeyEnv:\s*['"]([^'"]+)['"]/)?.[1];
        if (model && baseURL) {
          return {
            model,
            baseURL,
            apiKeyEnv: apiKeyEnv || 'GLM_API_KEY',
            temperature: 0.3,
            ...overrides,
          };
        }
      }
    }
  } catch { /* 解析失败时回退 GLM（下） */ }
  return {
    model: 'glm-5.3',
    baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    apiKeyEnv: 'GLM_API_KEY',
    temperature: 0.3,
    ...overrides,
  };
}

/**
 * 通用参数解析：`--key value` 全收进 opts，`--help/-h` 打印调用方 helpText 后退出。
 * @param {string[]} argv process.argv.slice(2)
 * @param {string} helpText --help 输出（各工具的用法说明，含差异参数）
 */
export function parseArgs(argv, helpText) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') {
      console.log(helpText);
      process.exit(0);
    }
    if (k.startsWith('--')) {
      opts[k.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

/** 当前版本号（engine/audit/package.json，与 check-version.sh SSOT 同口径）；读不出退出 1 */
export function resolveVersion() {
  let ver = '';
  try {
    ver = require(join(REPO_ROOT, 'engine/audit/package.json')).version;
  } catch { /* 下面兜底报错 */ }
  if (!ver) {
    console.error('❌ 无法读取 engine/audit/package.json version');
    process.exit(1);
  }
  return ver;
}

/**
 * key 解析：环境变量 GLM_API_KEY 优先，--api-key 参数兜底。
 * 无 key 时降级写 <out>.prompt.md 并退出 2（SOP 不因断网/key 轮换卡死）。
 * @returns {string} API key（保证非空——空则已退出）
 */
export function resolveApiKey(opts) {
  // v1.3.9：key 环境变量跟随模型配置（apiKeyEnv）——GLM 用 GLM_API_KEY、deepseek 用 DEEPSEEK_API_KEY
  const keyEnv = opts.__modelCfg?.apiKeyEnv || 'GLM_API_KEY';
  const apiKey = process.env[keyEnv] || opts['api-key'] || '';
  if (!apiKey) {
    writeDegraded(opts.__out, `${keyEnv} 未设置`, opts.__prompts);
    console.error(`    用法：source FORGE/env.local 后重跑，或把 prompt 粘给任意 AI session`);
    process.exit(2);
  }
  return apiKey;
}

/**
 * 降级写盘：完整 prompt 写到 <out>.prompt.md，供人工粘贴给任意 AI session。
 * @param {string} out 产物路径（降级产物 = out + '.prompt.md'）
 * @param {string} reason 降级原因（无 key / LLM 失败信息）
 * @param {{system: string, user: string}} prompts 双段 prompt
 */
export function writeDegraded(out, reason, prompts) {
  // 注：reason='GLM_API_KEY 未设置' 时旧版 abc 头部带空括号「未设置（）」——
  // 为保证降级产物逐字一致（重构验收基准）保留原样，不做清理
  const suffix = reason === 'GLM_API_KEY 未设置' ? '（）' : '';
  writeFileSync(out + '.prompt.md',
    `<!-- 降级产物：${reason}${suffix}——把下面 prompt 粘贴给任意 AI session 执行；粘贴执行完即可删除本文件 -->\n\n` +
    `## System\n\n${prompts.system}\n\n## User\n\n${prompts.user}\n`, 'utf-8');
  console.error(`⚠️  ${reason} → 降级：prompt 已写入 ${out}.prompt.md`);
}

/**
 * 读来源文件并截断（防 prompt 爆长——分类/审查只需发现条目不需全文）。
 * @param {Array<[string, string|undefined, string, number]>} sources
 *   [key, path, label, limit]：path 缺省跳过；超 limit 截断并标注
 * @returns {{sections: string[], loaded: string[], skipped: string[]}}
 *   sections=已加载内容块 / loaded=已加载标签 / skipped=跳过标签
 */
export function loadSources(sources) {
  const sections = [];
  const loaded = [];
  const skipped = [];
  for (const [, path, label, limit] of sources) {
    if (!path) { skipped.push(label); continue; }
    if (!existsSync(path)) {
      console.error(`❌ 来源文件不存在: ${path}（${label}）`);
      process.exit(1);
    }
    const text = readFileSync(path, 'utf-8');
    const trimmed = text.length > limit
      ? text.slice(0, limit) + `\n…（截断，原文 ${text.length} 字符）`
      : text;
    sections.push(`### 来源：${label}（${path}）\n\n${trimmed}`);
    loaded.push(label);
  }
  return { sections, loaded, skipped };
}

/** CHANGELOG 当前版本行（轻量补充源）；无则返回 null */
export function readChangelogLine(changelogPath, curVer) {
  if (!existsSync(changelogPath)) return null;
  return readFileSync(changelogPath, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`- **v${curVer}**`)) || null;
}

/**
 * 单次 LLM 调用（原生 fetch，无 SDK 无循环）。
 * @returns {Promise<string>} LLM 输出内容（长度 ≥200 校验通过）
 * @throws Error HTTP 非 200 / 响应过短 / 网络失败（调用方 catch 后降级）
 */
export async function callLLM(modelCfg, apiKey, systemPrompt, userPrompt) {
  return callLLMOnce(modelCfg, apiKey, systemPrompt, userPrompt);
}

/**
 * v1.4.4 优化六（2026-09-03 修订）：主端点失败后的重试通道。
 * 原实现降级到 deepseek-v4-flash 按量通道——用户拍板弃用 DeepSeek（余额 402 且
 * 全链统一 GLM），改为同一 GLM 模型直连重试一次（端点级重试，非换模型）。
 * 历史背景：GLM coding 端点对大输入（~25k 字符）偶发 300s 无响应（run-2026-08-29
 * 实测 3 连败 aborted），重试通道固化当日手工绕行（/tmp/run-draft-deepseek.mjs）。
 *
 * 重试条件：主端点 abort（超时）/ HTTP 5xx / 网络错误（与原降级条件一致）。
 * 主端点正常返回（含 4xx 业务错误）不重试——那不是端点问题。
 */
export async function callLLMWithFallback(modelCfg, apiKey, systemPrompt, userPrompt) {
  try {
    return await callLLMOnce(modelCfg, apiKey, systemPrompt, userPrompt);
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || /aborted|fetch failed|network/i.test(err.message || '');
    const isServerError = /HTTP 5\d\d/.test(err.message || '');
    if (isTimeout || isServerError) {
      console.warn(`⚠️  主端点 ${modelCfg.baseURL} 失败（${(err.message || '').slice(0, 120)}）→ 同模型重试一次（GLM 统一通道，弃用 DeepSeek 降级）`);
      return callLLMOnce(modelCfg, apiKey, systemPrompt, userPrompt);
    }
    throw err;
  }
}

async function callLLMOnce(modelCfg, apiKey, systemPrompt, userPrompt) {
  const controller = new AbortController();
  // 5 分钟上限（GLM thinking 模式大输入 3min 实测不够）
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(`${modelCfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelCfg.model,
        temperature: modelCfg.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || content.length < 200) {
      throw new Error(`响应过短（${content ? content.length : 0} 字符）——疑似异常响应`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/** 正常产物写盘（头部元数据 + 内容）；返回产物绝对信息供日志 */
export function writeOutput(out, header, content) {
  writeFileSync(out, header + content + '\n', 'utf-8');
  return out;
}

/** 缺省产物路径：~/Desktop/<prefix>-draft-v<ver>.md */
export function defaultOut(prefix, curVer) {
  return join(homedir(), 'Desktop', `${prefix}-draft-v${curVer}.md`);
}
