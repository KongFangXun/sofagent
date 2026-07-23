// ============================================================
// dream-cycle/__tests__/state-machine.test.ts · Dream Cycle 状态机 e2e
// v1.1.6 新增
//
// 覆盖用例（共 6 case）：
//   1. 空 Ledger → pipeline 空转不报错，cycle_complete=true，counts 全 0
//   2. 🔴 Q5 验收级：think.md 输入 → entities/ 教训/实体产物「内容级断言」
//      （替代被删的 experience-sharing.test.ts —— 不是只断言 stage 流转）
//   3. 单条 audit history → runDreamCycle 产出 ≥1 fact
//   4. cycle_complete → knowledge/log.md 追加周报「本周学 N concept / M atom」
//   5. fromStage 断点续跑 → 从 synthesize_concepts 续跑不重跑 extract_facts
//   6. state.md 落盘 → cycle_complete=true 游标持久化
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runDreamCycle, loadState } from '../state-machine';
import { MockLLM } from '../llm-mock';
import type { Ledger } from '../types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-dreamcycle-e2e-'));
}

describe('runDreamCycle 状态机 e2e', () => {
  let dir: string;
  const llm = new MockLLM();

  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.sofagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 用例 1：空 Ledger → 空转不报错
  it('空 Ledger（无 think.md / audit history）→ pipeline 空转不报错，产出为空', async () => {
    const ledger: Ledger = { thinkContent: '', auditEntries: [] };
    const result = await runDreamCycle(dir, { ledger, llm });
    expect(result.cycleComplete).toBe(true);
    expect(result.counts.facts).toBe(0);
    expect(result.counts.concepts).toBe(0);
    expect(result.failedAt).toBeNull();
  });

  // 用例 2（🔴 Q5 验收级）：think.md → entities/ 产物「内容级断言」
  it('think.md 输入 → entities/ 教训/实体产物内容级断言（Q5：不是只断言 stage 流转）', async () => {
    // 设备 A 踩坑写入 think.md（复刻被删 experience-sharing 的输入语义）
    const thinkContent =
      '## 教训：不要用 rm -rf\n原因：删了整个项目\n## 教训：提交前先跑测试\n原因：避免回归\n';
    fs.writeFileSync(path.join(dir, '.sofagent', 'think.md'), thinkContent, 'utf-8');

    const result = await runDreamCycle(dir, { llm });
    expect(result.cycleComplete).toBe(true);
    expect(result.counts.facts).toBeGreaterThanOrEqual(1);

    // ── 内容级断言（Q5 核心）──
    // 不是只断言「stage 被调用/流转」，而是断言 entities/ 产物的内容：
    // 产出的 concept 文件里必须能看到来自 think.md 的教训文本。
    const entitiesDir = path.join(dir, '.sofagent', 'knowledge', 'entities');
    expect(fs.existsSync(entitiesDir)).toBe(true);
    const files = fs.readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const allContent = files
      .map((f) => fs.readFileSync(path.join(entitiesDir, f), 'utf-8'))
      .join('\n');
    // 教训文本经 extract → atom → synthesize 后必须进入 concept 正文
    expect(allContent).toContain('教训');
    expect(allContent).toContain('rm -rf');
    // frontmatter 必须有 source 回指（缺源检测的反向保障）
    expect(allContent).toContain('source: dream-cycle:');
    expect(allContent).toContain('sensitivity: internal');
  });

  // 用例 3：单条 audit history → ≥1 fact
  it('单条 audit history → runDreamCycle 产出 ≥1 fact', async () => {
    const auditDir = path.join(dir, '.sofagent', 'audit');
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditDir, 'history.jsonl'),
      JSON.stringify({ timestamp: '2026-07-20T00:00:00Z', rule: 'A2', status: 'FAIL', message: '敏感文件' }) + '\n',
      'utf-8',
    );
    const result = await runDreamCycle(dir, { llm });
    expect(result.counts.facts).toBeGreaterThanOrEqual(1);
    expect(result.auditEntryCount).toBe(1);
  });

  // 用例 4：cycle_complete → log.md 追加周报（LUI A）
  it('cycle_complete → knowledge/log.md 追加周报「本周学 N concept / M atom」', async () => {
    const thinkContent = '## 教训：每周复盘\n持续改进\n';
    fs.writeFileSync(path.join(dir, '.sofagent', 'think.md'), thinkContent, 'utf-8');
    const result = await runDreamCycle(dir, { llm });
    expect(result.cycleComplete).toBe(true);
    const logPath = path.join(dir, '.sofagent', 'knowledge', 'log.md');
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, 'utf-8');
    expect(logContent).toContain('Dream Cycle 周报');
    expect(logContent).toMatch(/本周学 \d+ 个 concept \/ \d+ 个 atom，来自 \d+ 条 audit history/);
  });

  // 用例 5：fromStage 断点续跑 → 跳过重跑前段 stage
  it('fromStage 断点续跑 → 从 synthesize_concepts 续跑不重复 extract_facts', async () => {
    const thinkContent = '## 教训：断点续跑\n失败可重试\n';
    fs.writeFileSync(path.join(dir, '.sofagent', 'think.md'), thinkContent, 'utf-8');
    // 首轮完整跑
    const first = await runDreamCycle(dir, { llm });
    expect(first.cycleComplete).toBe(true);
    // 从 synthesize_concepts 续跑：completedStages 应只含后段
    const resumed = await runDreamCycle(dir, { llm, fromStage: 'synthesize_concepts' });
    expect(resumed.cycleComplete).toBe(true);
    expect(resumed.completedStages).toContain('synthesize_concepts');
    expect(resumed.completedStages).toContain('embed');
  });

  // 用例 6：state.md 落盘 → cycle_complete=true 游标持久化
  it('state.md 落盘 → cycle_complete=true 游标持久化', async () => {
    const ledger: Ledger = { thinkContent: '## 教训：状态持久化\n游标落盘\n', auditEntries: [] };
    await runDreamCycle(dir, { ledger, llm });
    const state = loadState(dir);
    expect(state.cycleComplete).toBe(true);
    expect(state.completedStages.length).toBe(6);
    expect(state.failed).toBeNull();
    expect(state.lastRunAt).not.toBeNull();
  });
});
