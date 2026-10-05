// ============================================================
// fix-applier-audit-gate.test.ts · L4 审计门 fail-closed 安全回归测试
// ============================================================
//
// 背景（为什么必须有这个文件）：
//   loop-agent/fix-applier.ts runAuditGate 默认实现的 git diff catch
//   分支此前静默 return { passed: true, violations: [] }——「diff 拿不到」
//   被当作「审计通过」处置，审计门整体旁路且零留痕：git 不可用 / rootDir
//   不在 git 管理中 / git 报错，修复一律免审 PASS。
//
//   既有测试全部注入 mock runAudit（AuditGateDeps），默认路径零覆盖——
//   「测试全绿」与「默认审计门安全」是两件事。本文件专测默认实现。
//
// 修复后语义（fail-closed）：
//   git diff 获取失败 → passed:false + violations 带「审计未执行」原因
//   → 复用 applyFix 对 passed:false 的既有处置（回滚 + applied:false）
//
// 覆盖：
// - mock git diff 抛错 → passed === false 且 violations 含原因与错误摘要
// - 经 applyFix 全链路：applied:false + 回滚被调用 + violations 透传
// - 空 diff（git 正常返回空串）→ 仍为 PASS（空变更无可审计，非本修复面）
// - 错误摘要限长 + 控制字符转义（错误消息不可注入日志）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { applyFix } from '../loop-agent/fix-applier';
import type { LocalizationResult } from '../loop-agent/error-localizer';
import type { DiffReport } from '../loop-agent/diff-report';

// child_process 全 mock——execSync 可按用例配置抛错/返回
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: vi.fn() };
});

// @sofagent/audit mock——runRules 恒返回一条 FAIL（只有「有 diff 走规则」
// 用例会触达；git 抛错/空 diff 用例不会走到 runRules）
vi.mock('@sofagent/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/audit')>();
  const mockRunRules = vi.fn(() => ({
    rules: [
      { name: 'A2', status: 'PASS', details: [] },
      { name: 'A9', status: 'FAIL', details: ['注入载荷'] },
    ],
  }) as unknown as ReturnType<typeof actual.runRules>);
  return { ...actual, runRules: mockRunRules };
});

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-audit-gate-'));
  vi.mocked(execSync).mockReset();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const mockLocalization: LocalizationResult = {
  errorSource: 'prompt',
  confidence: 0.8,
  reasoning: 'prompt 未区分退货和投诉',
  evidence: { diffCount: 1, contextSummary: 'prompt' },
};

const mockDiffReport: DiffReport = {
  taskId: 't1',
  timestamp: new Date().toISOString(),
  expectedSource: 'src',
  mismatches: [
    { type: 'value_error', field: 'order_status', expected: 'refunded', actual: 'complained', severity: 'error' },
  ],
};

/** 合法 LLM 修复（target 合法，隔离出「审计门」本身） */
const legitLlm = async () =>
  JSON.stringify({
    fixType: 'prompt_patch',
    changes: [{ target: 'think.md', operation: 'replace', content: 'LEGIT' }],
  });

// ============================================================
// 一、git diff 获取失败 → fail-closed
// ============================================================

describe('runAuditGate · git diff 获取失败（默认实现）', () => {
  it('test_runAuditGate_gitDiff抛错_passed为false且violations含原因', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("fatal: not a git repository (or any of the parent directories): .git");
    });

    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined, // 不注入 runAudit → 走默认审计门
      { rootDir: tmpRoot },
    );

    expect(res.applied).toBe(false);
    expect(res.proposal.auditResult?.passed).toBe(false);
    expect(res.violations.length).toBe(1);
    expect(res.violations[0]).toContain('审计未执行');
    expect(res.violations[0]).toContain('git diff 获取失败');
    // 错误摘要须在 violations 里（排查线索，不是只有一句「未执行」）
    expect(res.violations[0]).toContain('not a git repository');
    expect(res.violations[0]).toContain('按不通过处置');
  });

  it('test_runAuditGate_gitDiff抛错_既有回滚处置被触发', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });

    const rolledBack: string[] = [];
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined,
      {
        rootDir: tmpRoot,
        applyChange: async () => {},
        rollback: async (files) => { rolledBack.push(...files); },
      },
    );

    // fail-closed 必须接上既有「审计不通过 → 回滚」处置路径
    expect(res.applied).toBe(false);
    expect(res.rollbackInfo).toBeDefined();
    expect(res.rollbackInfo?.files).toEqual(['think.md']);
    expect(rolledBack).toEqual(['think.md']);
  });

  it('test_runAuditGate_gitDiff抛错_错误消息含换行_被转义不注入日志', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git failed\nINJECTED-FAKE-LOG-LINE');
    });

    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined,
      { rootDir: tmpRoot },
    );

    expect(res.applied).toBe(false);
    expect(res.violations[0]).toContain('\\n');
    // 换行被转义 → 原始换行后的伪造日志行不以裸形态出现
    expect(res.violations[0]).not.toContain('\nINJECTED');
  });

  it('test_runAuditGate_gitDiff抛错_超长错误消息_被限长', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('x'.repeat(5000));
    });

    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined,
      { rootDir: tmpRoot },
    );

    expect(res.violations[0]!.length).toBeLessThan(5000);
    expect(res.violations[0]).toContain('审计未执行');
  });
});

// ============================================================
// 二、不误伤：git 正常路径不受影响
// ============================================================

describe('runAuditGate · git 正常路径（默认实现）', () => {
  it('test_runAuditGate_空diff_仍为PASS', async () => {
    // git 正常返回空 diff（无变更可比对）→ 旧行为保留：PASS
    vi.mocked(execSync).mockReturnValue('');

    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined,
      { rootDir: tmpRoot },
    );

    expect(res.applied).toBe(true);
    expect(res.proposal.auditResult?.passed).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it('test_runAuditGate_有diff走规则_违规时FAIL', async () => {
    // git 正常返回 diff → 走 runRules 链路（顶层 mock：A9 FAIL）
    vi.mocked(execSync).mockReturnValue(
      'diff --git a/think.md b/think.md\n' +
      'index 111..222 100644\n' +
      '--- a/think.md\n' +
      '+++ b/think.md\n' +
      '@@ -1 +1 @@\n' +
      '-old\n' +
      '+new content\n',
    );

    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: legitLlm },
      undefined,
      { rootDir: tmpRoot },
    );

    expect(res.applied).toBe(false);
    expect(res.proposal.auditResult?.passed).toBe(false);
    expect(res.violations).toContain('A9: 注入载荷');
  });
});
