// doctor-reset-baseline.test.ts · --reset-baseline 单测（v1.3.5 交付 2 附带小件）
//
// 覆盖 4 条验收（dev-prompt 交付 2 附带小件）：
//   1. resetBaseline=true 覆写已有基线（旧值 ≠ 新文件哈希时被替换）
//   2. resetBaseline=true 基线不存在时等价首跑写入
//   3. 不带 resetBaseline（默认）行为不变：基线存在则校验（不匹配 → fail）
//   4. 基线不存在 + 不带 flag → 首跑自动写入（既有行为回归保护）
//
// 隔离纪律：SOFAGENT_HOME 指向 tmpdir（哈希基线写 tmpdir 下的 internal/），
// 不碰真实 ~/.sofagent。audit dist 路径解析到 monorepo 真实产物（engine/audit/dist），
// 哈希值确定性来自该文件内容——测试只比对「记录值 == 计算值」，不硬编码哈希。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, createHash } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import * as auditHistory from '../audit-history';
import { runDoctor } from '../doctor';

/** doctor.ts 内部使用的 audit dist 路径（与实现同序解析）。
 * 注意层级：本测试在 src/__tests__/（三层深），doctor.ts 在 src/（两层深）——
 * 补一层对齐 doctor.ts 的 join(__dirname, '..', '..', 'audit', 'dist', 'index.js')。 */
const AUDIT_DIST = join(__dirname, '..', '..', '..', 'audit', 'dist', 'index.js');

/** 计算当前 dist 的 SHA-256（与 doctor 实现同算法） */
function currentDistHash(): string {
  const { createHash: ch } = require('crypto') as typeof import('crypto');
  return ch('sha256').update(readFileSync(AUDIT_DIST)).digest('hex');
}

describe('doctor --reset-baseline（v1.3.5 交付 2 附带小件）', () => {
  let tmpHome: string;
  let baselinePath: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'doctor-reset-'));
    baselinePath = join(tmpHome, 'internal', 'audit-hash.txt');
    vi.stubEnv('SOFAGENT_HOME', tmpHome);
    // v1.3.2 path-traversal 防护：/tmp 不在默认白名单，不设会被回退到真实 ~/.sofagent（污染 + allOk 假 false）
    vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', require('os').tmpdir());
    // 静音 console 输出（doctor 大量 console.log）
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 链校验 mock 为 ok——隔离 dist 检查之外的噪音
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* shim 加固 */ }
  });

  it('验收 1 · resetBaseline 覆写已有基线（陈旧基线被替换为新哈希）', () => {
    // 前置：写入一个「陈旧」基线（随便一个假哈希——模拟 rebuild 后基线过期）
    mkdirSync(join(tmpHome, 'internal'), { recursive: true });
    writeFileSync(baselinePath, 'deadbeef'.repeat(8) + '\n', 'utf-8');

    // 不带 flag：陈旧基线应触发 mismatch（fail）
    const before = runDoctor(tmpHome, {});
    expect(before.allOk).toBe(false);

    // 带 resetBaseline：无条件覆写
    const report = runDoctor(tmpHome, { resetBaseline: true });

    // 基线文件被覆写为当前 dist 哈希
    expect(existsSync(baselinePath)).toBe(true);
    expect(readFileSync(baselinePath, 'utf-8').trim()).toBe(currentDistHash());
    // 覆写后 distIntegrity 检查通过（不再 fail mismatch）
    // （allOk 可能因 tmp 环境其他项 warn——只断言本次不再因哈希不匹配而 fail：failCount 应低于不带 flag 的运行）
    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('基准哈希已重置');
    // v1.3.5 阶段五修正：tmp 环境无 .git/hooks（hook 段 warn 级但拖累 allOk）——
    // 本测试只验证 reset-baseline 语义，不断言全量 allOk（distIntegrity 已由上方基线比对覆盖）
    expect(report.failCount).toBe(0);
  });

  it('验收 2 · resetBaseline 在基线不存在时等价首跑写入（写出当前哈希）', () => {
    // 前置：无基线文件
    expect(existsSync(baselinePath)).toBe(false);

    const report = runDoctor(tmpHome, { resetBaseline: true });

    // 等价首跑：写出当前 dist 哈希
    expect(existsSync(baselinePath)).toBe(true);
    expect(readFileSync(baselinePath, 'utf-8').trim()).toBe(currentDistHash());
    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('基准哈希已重置');
    // 同验收 1：tmp 环境无 hook，不断言全量 allOk（failCount=0 即无 fail 级问题）
    expect(report.failCount).toBe(0);
  });

  it('验收 3 · 不带 flag 行为不变：基线存在且不匹配 → fail（防御语义保留）', () => {
    mkdirSync(join(tmpHome, 'internal'), { recursive: true });
    writeFileSync(baselinePath, '0123456789abcdef'.repeat(8) + '\n', 'utf-8');

    const report = runDoctor(tmpHome, {});
    // 哈希不匹配必须失败（影子审计器防御不降级）
    expect(report.allOk).toBe(false);
    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('哈希不匹配');
    // 基线文件保持原值（不带 flag 绝不覆写）
    expect(readFileSync(baselinePath, 'utf-8').trim()).toBe('0123456789abcdef'.repeat(8));
  });

  it('验收 4 · 基线不存在 + 不带 flag → 显性报错提示建基线，不自动写入（v1.4.2 G-01 行为变更）', () => {
    expect(existsSync(baselinePath)).toBe(false);

    const report = runDoctor(tmpHome, {});

    // v1.4.2 G-01：基线缺失不再自动记录（防止把已篡改 dist 固化为合法基线）——
    // 改为显眼提示 + fail，引导 --baseline 人工建立信任锚
    expect(existsSync(baselinePath)).toBe(false);
    expect(report.allOk).toBe(false);
    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('未建立 dist 基线哈希');
    expect(output).toContain('--baseline');
    // 该路径输出不含「已重置」（resetBaseline 专属文案未误触发）
    expect(output).not.toContain('基准哈希已重置');
  });
});
