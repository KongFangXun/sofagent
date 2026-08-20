// ============================================================
// gate-tools.mjs · 门禁脚本工具化（v1.3.9 五 · DSH tool 注册接线）
// ============================================================
// 把 tools/check/ 门禁脚本包成结构化 tool 暴露给 worker——
// worker 从 run_bash 执行 shell 升级为调内部 tool：
//   check_version / check_docs / check_review_system（首期三个）
//
// 后端无关注册：工具定义与 ExecutionBackend 解耦——
// LangGraph 后端 = DynamicStructuredTool；DSH 后端启用时同一工具
// 经 DSH tool 注册机制暴露（define 段 name/description/parameters 与
// 宿主私有段 execute 分离——对齐 dsh-backend.ts 的 ToolDefinition 三段式契约）。
//
// ⚠️ 不做成 @sofagent/cordis-plugin-* 生态包：这些脚本只服务 sofagent
// 仓库自己的发版流程，与 v1.4.0 通用 cordis-plugin-gate 是两个东西。
// ============================================================

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FORGE_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = join(FORGE_ROOT, '..');

/** 门禁脚本清单（首期三个——prompt 五 明确的首期范围） */
const GATE_SCRIPTS = {
  check_version: 'tools/check/check-version.sh',
  check_docs: 'tools/check/check-docs.sh',
  check_review_system: 'tools/check/check-review-system.sh',
};

/** 单个门禁工具的执行：跑脚本 + 截取结构化结论 */
function runGateScript(scriptRel) {
  const scriptPath = join(REPO_ROOT, scriptRel);
  if (!existsSync(scriptPath)) {
    return { ok: false, exitCode: 127, summary: `脚本不存在: ${scriptRel}` };
  }
  const startedAt = Date.now();
  try {
    // 门禁脚本必须全绿才算 ok——门禁自身内部有失败即非零退出的契约
    const output = execFileSync('bash', [scriptPath], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb' },
    });
    const durationMs = Date.now() - startedAt;
    // 提取结论行（各门禁尾部都有 ✓/✗ 汇总；给 worker 的速览）
    const tail = output.trim().split('\n').slice(-5).join('\n');
    return { ok: true, exitCode: 0, durationMs, summary: tail };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const output = err.stdout ? String(err.stdout) : '';
    const tail = output.trim().split('\n').slice(-8).join('\n');
    return {
      ok: false,
      exitCode: err.status ?? 1,
      durationMs,
      summary: tail || (err.message || '').split('\n').slice(-3).join('\n'),
    };
  }
}

/**
 * 创建门禁工具集（LangGraph DynamicStructuredTool 形态）。
 * DSH 后端启用时，同一组工具经 tool 注册机制转为 DSH ToolDefinition——
 * define 段（name/description/parameters）与 execute 段天然分离，
 * 与 dsh-backend.ts 的三段式契约对齐。
 */
export function createGateTools() {
  const { tool } = require('@langchain/core/tools');
  const { z } = require('zod');

  const gateTools = [];
  for (const [name, script] of Object.entries(GATE_SCRIPTS)) {
    gateTools.push(
      tool(
        async () => {
          const r = runGateScript(script);
          // 结构化输出：worker 拿 JSON 决策，不解析 shell 文本
          return JSON.stringify({
            gate: name,
            ok: r.ok,
            exitCode: r.exitCode,
            durationMs: r.durationMs,
            summary: r.summary,
          });
        },
        {
          name,
          description:
            `运行 sofagent 门禁脚本 ${script}（内部 tool——替代 run_bash 执行 shell）。` +
            '返回 JSON：{gate, ok, exitCode, durationMs, summary}。ok=false 时 summary 含失败项速览。',
          schema: z.object({}),
        }
      )
    );
  }
  return gateTools;
}

/**
 * 导出 DSH 注册形态（后端切换接线面）——DSH 后端启用时由 driver 把
 * 该定义转为 DSH ToolDefinition 挂到 ctx（tool 注册机制）。
 * 现阶段（DSH rc 期守卫拦截）作为接线契约先行落地。
 */
export function getGateToolDefinitions() {
  return Object.entries(GATE_SCRIPTS).map(([name, script]) => ({
    name,
    description: `运行 sofagent 门禁脚本 ${script}，返回结构化 JSON 结论`,
    parameters: { type: 'object', properties: {} },
    // 宿主私有段：execute 与 define 段分离（DSH 三段式契约）
    execute: () => runGateScript(script),
  }));
}
