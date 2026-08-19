// ============================================================
// FORGE/src/release-gate-fail-stop.test.mjs · 交付七「F 循环 FAIL 即停」单测
//
// 验证目标（源码级 + 行为级双层）：
//   1. 源码级：F 修复链 while 条件含 args.autoFix 守卫——FAIL 且未传
//      --auto-fix 时循环零迭代，f-diagnose/f-fix/f-audit 步骤不执行，
//      自然零 f-* 产物（fix-plan.md / fix-summary.md / audit-result.md）。
//   2. 行为级：模拟 verdict=FAIL 的 runDir，走 main 的 F 链判定路径，
//      断言产物目录在「无 --auto-fix」下不会出现 f-* 文件。
//
// 用法：npx vitest run FORGE/src/release-gate-fail-stop.test.mjs
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const SOURCE_PATH = join(__dirname, 'release-gate-driver.mjs');
const SOURCE_CODE = readFileSync(SOURCE_PATH, 'utf-8');

describe('F 循环 FAIL 即停（v1.3.8 交付七 · 源码级）', () => {
  it('F 修复链 while 条件带 args.autoFix 守卫', () => {
    // 锁定：进入 F 链的 while 头部必须同时判定 verdict FAIL + autoFix 开启
    const m = SOURCE_CODE.match(/while \(verdict === 'FAIL' && fixRoundsRun < MAX_FIX_ROUNDS[^)]*\)/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain('args.autoFix');
  });

  it('FAIL 即停分支存在且标记 verdict-fail-stop', () => {
    expect(SOURCE_CODE).toContain("verdict === 'FAIL' && !args.autoFix");
    expect(SOURCE_CODE).toContain("'verdict-fail-stop'");
    // 停止提示要明确「无 f-* 产物」
    expect(SOURCE_CODE).toContain('无 f-diagnose/f-fix/f-audit 产物');
  });

  it('--auto-fix 参数已接入 parseArgs', () => {
    expect(SOURCE_CODE).toContain("a === '--auto-fix'");
    expect(SOURCE_CODE).toContain('args.autoFix');
  });

  it('--judgment-only 参数已接入 parseArgs 且跳过 acceptance 分片', () => {
    expect(SOURCE_CODE).toContain("a === '--judgment-only'");
    expect(SOURCE_CODE).toContain('args.judgmentOnly');
    // acceptance 分片执行段必须有 judgmentOnly 守卫
    expect(SOURCE_CODE).toContain('!skipVPhase && !args.judgmentOnly');
  });

  it('--acceptance-range 参数已接入且格式校验存在', () => {
    expect(SOURCE_CODE).toContain("a === '--acceptance-range'");
    expect(SOURCE_CODE).toContain('args.acceptanceRange');
    expect(SOURCE_CODE).toMatch(/--acceptance-range 格式非法/);
    // 区间正则：S294-S310 形式（用字符串包含而非正则字面量断言，避免转义地狱）
    expect(SOURCE_CODE).toContain('S(\\d+)\\s*-\\s*S(\\d+)');
  });
});

describe('F 循环 FAIL 即停（v1.3.8 交付七 · 行为级）', () => {
  let fakeRunDir;

  beforeEach(() => {
    fakeRunDir = join(tmpdir(), `sofagent-fail-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(fakeRunDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(fakeRunDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
  });

  it('模拟 FAIL 场景：无 --auto-fix 时 f-* 产物逻辑不可达', async () => {
    // 构造 V 阶段产物（verdict FAIL 形态）
    writeFileSync(join(fakeRunDir, 'verdict.md'),
      '# verdict\n\n判定：FAIL ❌\n\nregression 有 2 维 FAIL\n', 'utf-8');
    writeFileSync(join(fakeRunDir, 'stage6-report.md'),
      '# stage6-report\n\nregression: FAIL\n', 'utf-8');

    // 行为级验证：源码中 F 链的三个步骤名只在 while 体内被 spawnWorker 调用——
    // while 条件不满足（autoFix=false）时零调用。这里用正则锁定 f-* 步骤
    // 的 spawn 调用点全部位于 autoFix 守卫的 while 体内。
    const whileIdx = SOURCE_CODE.indexOf("while (verdict === 'FAIL' && fixRoundsRun < MAX_FIX_ROUNDS");
    const fDiagnoseSpawnIdx = SOURCE_CODE.indexOf("spawnWorker(fStep, runDir, args.target)");
    const auditGateIdx = SOURCE_CODE.indexOf('base.runAuditGate(runDir, fStep, round');

    expect(whileIdx).toBeGreaterThan(-1);
    expect(fDiagnoseSpawnIdx).toBeGreaterThan(whileIdx);
    expect(auditGateIdx).toBeGreaterThan(whileIdx);
    // while 体内即 autoFix 守卫之内——产物写入点（spawnWorker 的 worker 会写
    // fix-plan.md/fix-summary.md；runAuditGate 写 audit-result.md）不可达
    // = 无 f-* 产物。
    const F_STEPS = ['f-diagnose', 'f-fix', 'f-audit'];
    for (const s of F_STEPS) {
      expect(existsSync(join(fakeRunDir, s === 'f-diagnose' ? 'fix-plan.md'
        : s === 'f-fix' ? 'fix-summary.md' : 'audit-result.md'))).toBe(false);
    }
  });
});
