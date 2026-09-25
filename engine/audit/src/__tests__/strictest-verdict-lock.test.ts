// ============================================================
// strictest-verdict-lock.test.ts · 多规则裁决「取最严」接线回归锁
// v1.5.3 第二章
// ============================================================
// 目的：第二章新增交付物「多规则裁决语义·取最严」此前**零生产消费方**
//   （strictestVerdict 只活在被单测里 = 「已实现未接线」）。本次把真实审计
//   聚合路径（runner.runRules 的 exitCode 归约）统一为对 `strictestVerdict`
//   的单点委托（runner.aggregateExitCode）。
//
// 本回归锁固化「接线前后对同一 fixture 的最终判定」必须**逐字节一致**：
//   - `legacyExitCode`：接线前 runRules 内联 max 归约的**冻结副本**（原文照抄）；
//   - `aggregateExitCode`：接线后经 strictestVerdict 的聚合；
//   - 二者对所有 fixture 的 exitCode 必须相等（无意行为变化 ⇒ diff 必须为 0）。
//
// 快照口径：
//   - 生成/刷新：`cd engine/audit && SOFAGENT_SNAPSHOT_OUT=<path> npx vitest run strictest-verdict-lock`
//   - 常规运行：读快照并断言相等（diff 必须为 0）
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { aggregateExitCode, runRules, GB48000_RULE_NAME } from '../rules/runner';
import type { RuleCheck } from '../rules/types';
import { makeDiffFile } from '../test-utils';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 已落盘的回归快照（接线前固化；接线后 diff 必须为 0） */
const SNAPSHOT_PATH = join(HERE, '..', '..', '..', '..', 'docs', 'evidence', 'v1.5.3-verdict-aggregation-snapshot.json');
/** 快照顶层标注（生成器**必须**产出——否则文档中的生成命令无法逐字节复现提交件） */
const SNAPSHOT_GENERATED_FOR = 'v1.5.3 第二章·多规则裁决取最严——接线前后判定一致性回归锁';
const SNAPSHOT_NOTE =
  '多规则「取最严」聚合的接线前后一致性快照。本文件由接线前逻辑（runRules 内联 max 归约的冻结副本 legacyExitCode）固化；' +
  '接线后聚合（aggregateExitCode → rule-loader.strictestVerdict）必须逐条 diff=0——证明「用 strictestVerdict 统一聚合」零行为漂移。' +
  '生成/刷新：cd engine/audit && SOFAGENT_SNAPSHOT_OUT=<path> npx vitest run src/__tests__/strictest-verdict-lock.test.ts';

/**
 * 接线前逻辑的**冻结副本**（原文照抄 v1.5.3 之前的 runner.runRules 汇总段）。
 * 本函数仅用于回归比对——生产路径已改为 aggregateExitCode，**禁止**在别处引用。
 */
function legacyExitCode(results: RuleCheck[], strict?: boolean): number {
  let exitCode = 0;
  for (const rule of results) {
    if (rule.name === GB48000_RULE_NAME) continue;
    if (rule.status === 'FAIL') {
      if (rule.ruleClass === '能力拐杖') {
        // Crutch rules: FAIL → WARN (advisory only, never block commit)
        if (strict) exitCode = 2;
        else if (exitCode === 0) exitCode = 1;
      } else {
        exitCode = 2;
      }
    } else if (rule.status === 'WARN') {
      if (strict) exitCode = 2;
      else if (exitCode === 0) exitCode = 1;
    }
  }
  return exitCode;
}

/** 构造单条 RuleCheck（合成夹具，不依赖任何真实规则/env） */
function mk(
  id: string,
  status: RuleCheck['status'],
  ruleClass?: RuleCheck['ruleClass'],
  name?: string,
): RuleCheck {
  return { id, name: name ?? id, number: 1, status, details: [], ruleClass };
}

/** GB48000 信息维度条目（name 必须等于 GB48000_RULE_NAME 才被排除） */
function gb(status: RuleCheck['status']): RuleCheck {
  return { id: 'gb48000', name: GB48000_RULE_NAME, number: 0, status, details: [], ruleClass: '工程规范' };
}

/**
 * 覆盖内联归约**全部分支**的合成夹具：
 *   状态{PASS/WARN/FAIL/SKIPPED} × {拐杖/非拐杖/无 class} × strict{on/off} × GB 排除。
 */
const FIXTURES: { id: string; strict: boolean; results: RuleCheck[] }[] = [
  { id: '空集·非strict', strict: false, results: [] },
  { id: '空集·strict', strict: true, results: [] },
  { id: '全 PASS', strict: false, results: [mk('A1', 'PASS', '业务底线')] },
  { id: '单 WARN·非strict', strict: false, results: [mk('A3', 'WARN', '业务底线')] },
  { id: '单 WARN·strict', strict: true, results: [mk('A3', 'WARN', '业务底线')] },
  { id: '单 FAIL 非拐杖·非strict', strict: false, results: [mk('A1', 'FAIL', '业务底线')] },
  { id: '单 FAIL 非拐杖·strict', strict: true, results: [mk('A1', 'FAIL', '业务底线')] },
  { id: '单 FAIL 拐杖·非strict', strict: false, results: [mk('A6', 'FAIL', '能力拐杖')] },
  { id: '单 FAIL 拐杖·strict', strict: true, results: [mk('A6', 'FAIL', '能力拐杖')] },
  { id: 'WARN + FAIL 非拐杖·非strict', strict: false, results: [mk('A3', 'WARN', '业务底线'), mk('A1', 'FAIL', '业务底线')] },
  { id: 'FAIL 拐杖 + WARN 非拐杖·非strict', strict: false, results: [mk('A6', 'FAIL', '能力拐杖'), mk('A3', 'WARN', '业务底线')] },
  { id: 'FAIL 拐杖 + WARN 非拐杖·strict', strict: true, results: [mk('A6', 'FAIL', '能力拐杖'), mk('A3', 'WARN', '业务底线')] },
  { id: '全 SKIPPED', strict: false, results: [mk('A1', 'SKIPPED'), mk('A2', 'SKIPPED')] },
  { id: 'SKIPPED + PASS', strict: false, results: [mk('A1', 'SKIPPED'), mk('A2', 'PASS', '业务底线')] },
  { id: '仅 GB48000（FAIL 但为信息维度）·非strict', strict: false, results: [gb('FAIL')] },
  { id: 'GB48000 + PASS', strict: false, results: [gb('WARN'), mk('A1', 'PASS', '业务底线')] },
  { id: 'GB48000 + FAIL 非拐杖', strict: false, results: [gb('WARN'), mk('A1', 'FAIL', '业务底线')] },
  { id: '多 FAIL 混合（拐杖+底线+WARN）', strict: false, results: [mk('A1', 'FAIL', '业务底线'), mk('A2', 'WARN', '业务底线'), mk('A3', 'FAIL', '能力拐杖')] },
  { id: '无 ruleClass 的 FAIL（默认非拐杖=硬拦）', strict: false, results: [mk('R1', 'FAIL')] },
];

describe('D2 · 多规则裁决「取最严」接线回归锁', () => {
  it('接线后聚合 aggregateExitCode 与接线前冻结逻辑 legacyExitCode 逐条一致（diff=0）', () => {
    for (const f of FIXTURES) {
      const legacy = legacyExitCode(f.results, f.strict);
      const wired = aggregateExitCode(f.results, f.strict);
      expect(wired, `fixture「${f.id}」判定漂移：legacy=${legacy} wired=${wired}`).toBe(legacy);
    }
  });

  it('最终判定快照与接线前固化值逐字节一致（快照 diff=0）', () => {
    const cases = FIXTURES.map((f) => ({ id: f.id, strict: f.strict, exitCode: legacyExitCode(f.results, f.strict) }));

    // 生成/刷新快照模式（从接线前冻结逻辑产出——即「接线前」基线）
    const out = process.env.SOFAGENT_SNAPSHOT_OUT;
    if (out) {
      writeFileSync(out, JSON.stringify({ generatedFor: SNAPSHOT_GENERATED_FOR, note: SNAPSHOT_NOTE, cases }, null, 2) + '\n', 'utf-8');
      return;
    }

    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as { cases: { id: string; strict: boolean; exitCode: number }[] };
    // 快照本身必须与接线前逻辑一致（防快照被误改）；随后接线后聚合必须复现该快照。
    expect(cases).toEqual(committed.cases);
    for (const c of committed.cases) {
      const f = FIXTURES.find((x) => x.id === c.id && x.strict === c.strict)!;
      expect(aggregateExitCode(f.results, f.strict), `快照「${c.id}」复现失败`).toBe(c.exitCode);
    }
  });

  it('真实路径端到端：runRules 的 exitCode 由统一聚合器产出（接线生效）', () => {
    // 全过 → 0
    const pass = runRules([makeDiffFile('src/index.ts', ['+const x = 1;'])], [], undefined, false, true, undefined, undefined, []);
    expect(pass.exitCode).toBe(0);

    // A1 敏感文件命中 → fast-fail 2（critical 层 FAIL 走同一聚合器）
    const sens = runRules([makeDiffFile('.env', ['+MODE=prod'])], [], undefined, false, true, undefined, undefined, []);
    expect(sens.exitCode).toBe(2);
  });

  it('critical fast-fail 三态：非strict / strict / +GB48000 opt-in 均拦截（exit 2，与旧硬编码逻辑一致）', () => {
    // critical 层 A1 命中 .env → fast-fail 后续层（warning/crutch/extended 全 SKIPPED）。
    // 旧逻辑：该分支**硬编码 exit 2**；接线后：走 aggregateExitCode——critical 层 FAIL
    // 均为非「能力拐杖」，取最严 ⇒ FAIL ⇒ 2。三态须**恒等 2**（补 QA 报的覆盖缺口：
    // 原 e2e 仅 1 例非 strict，无 strict / GB48000 opt-in 变体）。
    const env = () => [makeDiffFile('.env', ['+MODE=prod'])];
    // ① 非 strict
    expect(runRules(env(), [], undefined, false, true, undefined, undefined, []).exitCode).toBe(2);
    // ② strict
    expect(runRules(env(), [], undefined, true, true, undefined, undefined, []).exitCode).toBe(2);
    // ③ +GB48000 opt-in（信息维度不改变判定——第 9 参 gb48000=true）
    expect(runRules(env(), [], undefined, false, true, undefined, undefined, [], true).exitCode).toBe(2);
  });
});
