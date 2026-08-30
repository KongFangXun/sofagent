// ============================================================
// FORGE/src/fresh-eyes-cost.test.mjs · 交付八「fresh-eyes 成本重构」单测
//
// 覆盖：
//   1. usage.jsonl 计量——recordUsage / appendUsageSummary 源码级锁定
//      （fresh-eyes 的 usage 落盘在 v1.3.7 已实现，本测试防回归：
//       prompt/completion/total 三字段 + 末尾 _summary 汇总行）
//   2. B 侧复核模式——两段式执行 + FORGE_B_REVIEW_MODE 注入 + prompt 拼接
//   3. 19 视角零删减 + 三层分工——PERSPECTIVES 数组 12 项 + playbook 标题 19 个
//      （13-16 视角在 playbook 有定义，driver 侧由草稿工具承接；
//       17-19 为手动层——跨组件契约/构建产物/执行证据，
//       需跨包追踪或 build/实跑取证，driver 与静态草稿均不覆盖）
//
// 用法：npx vitest run FORGE/src/fresh-eyes-cost.test.mjs
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_PATH = join(__dirname, 'fresh-eyes-driver.mjs');
const DRIVER_CODE = readFileSync(DRIVER_PATH, 'utf-8');
const PLAYBOOK_PATH = join(__dirname, '..', 'playbook', 'fresh-eyes-review.md');
const PLAYBOOK_CODE = readFileSync(PLAYBOOK_PATH, 'utf-8');
const DRAFT_TOOL_PATH = join(__dirname, '..', '..', 'tools', 'gen', 'gen-fresh-eyes-draft.mjs');
const DRAFT_TOOL_CODE = readFileSync(DRAFT_TOOL_PATH, 'utf-8');

// ─── 反射提取（与 release-gate-driver.test.mjs 同款手法）────────
function extractFunctionBody(source, funcName) {
  const startRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = startRegex.exec(source);
  if (!startMatch) throw new Error(`无法找到函数 ${funcName}`);

  const braceStart = startMatch.index + startMatch[0].lastIndexOf('{');
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  return source.slice(startMatch.index, end + 1);
}

// ═══════════════════════════════════════════════════════════
//  1. usage.jsonl 计量（照抄 release-gate 实现的防回归锁定）
// ═══════════════════════════════════════════════════════════

describe('usage.jsonl 计量（v1.3.8 交付八 · 防回归）', () => {
  it('recordUsage 落盘 prompt/completion/total 三字段', () => {
    const body = extractFunctionBody(DRIVER_CODE, 'recordUsage');
    expect(body).toContain('prompt_tokens');
    expect(body).toContain('completion_tokens');
    expect(body).toContain('total_tokens');
    expect(body).toContain("join(runDir, 'usage.jsonl')");
  });

  it('appendUsageSummary 生成末尾 _summary 汇总行（by_role A/B）', () => {
    const body = extractFunctionBody(DRIVER_CODE, 'appendUsageSummary');
    expect(body).toContain('_summary');
    expect(body).toContain('by_role');
    // A/B 双角色汇总（release-gate 是单角色 V——fresh-eyes 必须双角色）
    expect(body).toContain('A:');
    expect(body).toContain('B:');
  });

  it('recordUsage 在 worker invoke 后被调用（usage 记录接入主流程）', () => {
    expect(DRIVER_CODE).toContain('recordUsage(runDir, step, round, role, cfg.model, result, latencyMs, target)');
  });

  it('行为验证：appendUsageSummary 追加唯一 _summary 行（grep -c = 1）', () => {
    // 构造迷你 usage.jsonl（模拟 2 条 worker 记录），跑 appendUsageSummary，
    // 验证文件末尾恰有 1 行 _summary（验收命令 grep -c "_summary" = 1 的单测化）
    const runDir = join(tmpdir(), `sofagent-usage-test-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    const usagePath = join(runDir, 'usage.jsonl');
    writeFileSync(usagePath, [
      JSON.stringify({ ts: 't1', round: 1, step: 'a-check-p1', role: 'A', model: 'glm-5.2', prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost_cny: null }),
      JSON.stringify({ ts: 't2', round: 1, step: 'b-check-p1', role: 'B', model: 'glm-5.2', prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, cost_cny: null }),
    ].join('\n') + '\n', 'utf-8');

    try {
      // 提取 appendUsageSummary 并注入依赖——函数体内引用的模块级标识符
      // （join/fs 原语 + MODEL_CONFIGS.a_billing）统一以参数注入
      const { join: j } = require('path');
      const fs = require('fs');
      const fn = new Function(
        'join', 'existsSync', 'readFileSync', 'appendFileSync', 'MODEL_CONFIGS',
        extractFunctionBody(DRIVER_CODE, 'appendUsageSummary') + '\nreturn appendUsageSummary;'
      );
      const appendUsageSummary = fn(
        j, fs.existsSync, fs.readFileSync, fs.appendFileSync,
        { A: { billing: 'subscription' }, B: { billing: 'subscription' } },
      );
      const summary = appendUsageSummary(runDir, 1);

      // 汇总正确性：A=150 + B=280 = 430
      expect(summary.total_tokens).toBe(430);
      expect(summary.by_role.A.total_tokens).toBe(150);
      expect(summary.by_role.B.total_tokens).toBe(280);
      expect(summary.a_billing).toBe('subscription');

      // 🔴 验收口径：文件中 _summary 行数 = 1
      const summaryLines = fs.readFileSync(usagePath, 'utf-8')
        .split('\n').filter(Boolean)
        .filter(l => l.includes('"_summary":true'));
      expect(summaryLines.length).toBe(1);
    } finally {
      try { rmSync(runDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  2. B 侧复核模式（v1.4.4 优化二改造后：A/B 同批并行双盲全量）
// ═══════════════════════════════════════════════════════════

describe('B 侧复核模式（v1.3.8 交付八 · v1.4.4 优化二对齐）', () => {
  it('A/B 同批并行双盲全量：单段执行 + 崩溃降级按 a/b 前缀分派产物', () => {
    // v1.4.4 优化二：两段式（先 A 后 B 复核）已废弃——pendingWorkers 整批并行，
    // 信息隔离靠「B 不注入 A 报告路径」保证（见 :3513-3516 注释）。
    expect(DRIVER_CODE).toContain('A/B 同批并行');
    expect(DRIVER_CODE).toContain('不再拆 A/B 两段');
    // 崩溃降级路径仍按 step 前缀分派产物文件（runCheckBatch 内）
    expect(DRIVER_CODE).toContain("f.step.startsWith('a-check')");
    // A/B worker 成对构造（flatMap 产出 a-check-pN + b-check-pN）
    expect(DRIVER_CODE).toContain('[`a-check-p${p.id}`, roundDir, target]');
    expect(DRIVER_CODE).toContain('[`b-check-p${p.id}`, roundDir, target]');
  });

  it('FORGE_B_REVIEW_MODE 消费端保留（prompt 构造 b-check-p* 限定）', () => {
    // v1.3.8 交付八的消费端代码保留：FORGE_B_REVIEW_MODE=recheck-a-findings
    // 时 prompt 追加复核指令段。v1.4.4 双盲全量模式下 driver 不再注入此变量
    // （注入侧随两段式废弃），消费端留作外部手动触发/未来复用的挂点。
    expect(DRIVER_CODE).toContain("process.env.FORGE_B_REVIEW_MODE === 'recheck-a-findings'");
    expect(DRIVER_CODE).toContain("step.startsWith('b-check-p')");
  });

  it('worker prompt 构造消费 FORGE_B_REVIEW_MODE（b-check-p* 限定）', () => {
    // 注入段含复核纪律与输出格式（消费端 :1059-1085 的内容锁定）
    expect(DRIVER_CODE).toContain('独立复核 A 的 P0/P1 发现');
    expect(DRIVER_CODE).toContain('禁止盲从 A');
    expect(DRIVER_CODE).toContain('兜底补充');
    // A 报告路径注入（同视角 check-a-pN.md）
    expect(DRIVER_CODE).toContain('check-a-p');
    // A 报告缺失时回退全量审查（降级不阻塞）
    expect(DRIVER_CODE).toContain('回退为全量审查本视角');
  });
});

// ═══════════════════════════════════════════════════════════
//  3. 19 视角零删减 + 三层分工 + 草稿工具
// ═══════════════════════════════════════════════════════════

describe('19 视角零删减 + 三层分工', () => {
  it('playbook 视角标题数 = 19（含十七/十八/十九动态面）', () => {
    // 匹配「视角一 [1]」~「视角十九 [19]」形态的正式视角节标题
    // （排除「文档治理规则（…视角的常驻敏感）」这类非视角小节）
    const perspectiveHeadings = PLAYBOOK_CODE.match(/^### .*视角[一二三四五六七八九十]+ \[\d+\]/gm) || [];
    expect(perspectiveHeadings.length).toBe(19);
    // 三层分工完整：17-19 属手动层（跨组件契约/构建产物/执行证据——
    // 需跨包追踪或 build/实跑取证，driver 12 视角与静态草稿均不覆盖）
    expect(perspectiveHeadings.filter(h => /\[1[789]\]/.test(h)).length).toBe(3);
  });

  it('driver PERSPECTIVES 12 视角完整（1-12 id 连续）', () => {
    const ids = [...DRIVER_CODE.matchAll(/\{ id: (\d+),\s*name:/g)].map(m => parseInt(m[1], 10));
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('gen-fresh-eyes-draft.mjs 含 16 视角完整清单', () => {
    // 草稿工具的 16 视角数组（PERSPECTIVES_16）+ 完整性校验
    // （17-19 不进草稿：构建产物/执行证据需 build 与实跑取证，
    //  单次静态 LLM 草稿做不到，硬塞只会产出臆测——保持 16）
    expect(DRAFT_TOOL_CODE).toContain('PERSPECTIVES_16');
    // 只匹配数组元素行（行尾逗号）——注释里的示例串（如「p 形如 '1 陌生人'」）不算
    const names = [...DRAFT_TOOL_CODE.matchAll(/'(\d+) ([^']+)',/g)].map(m => m[1]);
    expect(names.length).toBe(16);
    // 16 视角完整性校验——缺节拒收
    expect(DRAFT_TOOL_CODE).toContain('完整性校验');
    expect(DRAFT_TOOL_CODE).toMatch(/missing\.length > 0/);
  });

  it('gen-fresh-eyes-draft.mjs 降级路径与退出码对齐 gen-abc-draft', () => {
    // 退出码语义：1=输入错误 / 2=LLM 不可用
    expect(DRAFT_TOOL_CODE).toMatch(/exit\(1\)/);
    expect(DRAFT_TOOL_CODE).toMatch(/exit\(2\)/);
    // 无 key 降级写 .prompt.md
    expect(DRAFT_TOOL_CODE).toContain('.prompt.md');
    // 输入=git diff + changelog（参数以 opts.diff / opts.changelog 键消费）
    expect(DRAFT_TOOL_CODE).toContain('opts.diff');
    expect(DRAFT_TOOL_CODE).toContain('opts.changelog');
    expect(DRAFT_TOOL_CODE).toContain('--changelog <p>');
  });
});
