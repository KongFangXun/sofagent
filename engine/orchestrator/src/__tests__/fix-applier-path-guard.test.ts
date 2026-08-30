// ============================================================
// fix-applier-path-guard.test.ts · L4 修复器路径守卫安全回归测试
// ============================================================
//
// 背景（为什么必须有这个文件）：
//   loop-agent/fix-applier.ts 把 LLM 产出的 `change.target` 直接交给
//   `writeFileSync(target, ...)` 与 `execSync('git checkout -- "${file}"')`——
//   前者无路径校验（`/tmp/x` 与 `../x` 都能落盘，实测已写出文件），
//   后者走 /bin/sh（双引号拦不住 `$(...)`，实测 `x$(touch PWNED_MARK).md`
//   真的执行了 touch）。同族问题在 refine-agent/snapshot-manager.ts 有 5 处。
//
//   漏洞潜伏至今的直接原因：既有 4 个 applyFix 测试全部注入了 mock 的
//   applyChange / rollback，默认实现零覆盖——「测试全绿」与「默认路径安全」
//   是两件事。本文件专测默认实现。
//
// 修复后的三道闸：
//   一、applyFix 入口预校验（非法批次零副作用拒绝，不写任何文件）
//   二、defaultApplyChange 写盘前锚定（resolveWithinRoot）
//   三、defaultRollback 用 execFileSync 参数数组（文件名不经 shell）
//
// 覆盖：
// - resolveWithinRoot / isPathWithinRoot 单元（含同前缀兄弟目录边界）
// - applyFix：三处已实证攻击全部被拒且不产生副作用
// - 默认实现纵深防御：不注入 fileOps 时同样安全
// - 零副作用：批次内一条非法 → 合法那条也不落盘
// - 不误伤：合法相对路径照常写入，启发式降级照常工作
// - defaultRollback 收到的是参数数组（不是拼好的 shell 字符串）
// - snapshot-manager：逃逸出 agentDir 的文件被过滤，git 根本不会被调用
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { resolveWithinRoot, isPathWithinRoot } from '../path-guard';
import { applyFix } from '../loop-agent/fix-applier';
import { rollbackToSnapshot } from '../refine-agent/snapshot-manager';
import type { LocalizationResult } from '../loop-agent/error-localizer';
import type { DiffReport } from '../loop-agent/diff-report';

// git 调用全部走 mock——测试不依赖真实 git 仓库，且能断言「参数是不是数组」
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: vi.fn(() => Buffer.from('')) };
});

/** 每个用例独立临时目录（便于断言「未逃逸出根目录」） */
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fix-guard-'));
  vi.mocked(execFileSync).mockClear();
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

/** 构造一个返回指定 changes 的 LLM（模拟模型被诱导输出恶意 target） */
function evilLlm(changes: Array<{ target: string; operation?: string; content?: string }>) {
  return async () =>
    JSON.stringify({
      fixType: 'prompt_patch',
      changes: changes.map((c) => ({
        target: c.target,
        operation: c.operation ?? 'replace',
        content: c.content ?? 'PAYLOAD',
      })),
    });
}

/** 审计一律通过（隔离出「路径守卫」本身，不测审计） */
const passAudit = { runAudit: async () => ({ passed: true, violations: [] }) };
/** 审计一律失败（用于触发回滚路径） */
const failAudit = { runAudit: async () => ({ passed: false, violations: ['A2 密钥泄漏'] }) };

// ============================================================
// 一、resolveWithinRoot：合法路径放行 / 非法路径拒绝
// ============================================================

describe('resolveWithinRoot · 合法路径放行', () => {
  it('test_resolveWithinRoot_普通相对路径_返回锚定后的绝对路径', () => {
    const r = resolveWithinRoot(tmpRoot, 'think.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absPath).toBe(path.join(tmpRoot, 'think.md'));
  });

  it('test_resolveWithinRoot_深层多级目录_放行', () => {
    const r = resolveWithinRoot(tmpRoot, 'knowledge/refund/flow.md');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.absPath).toBe(path.join(tmpRoot, 'knowledge', 'refund', 'flow.md'));
  });

  it('test_resolveWithinRoot_前导点斜杠_放行', () => {
    expect(resolveWithinRoot(tmpRoot, './think.md').ok).toBe(true);
  });

  it('test_resolveWithinRoot_文件名含空格_放行', () => {
    expect(resolveWithinRoot(tmpRoot, 'my note.md').ok).toBe(true);
  });
});

describe('resolveWithinRoot · 非法路径拒绝', () => {
  it('test_resolveWithinRoot_POSIX绝对路径_拒绝', () => {
    const r = resolveWithinRoot(tmpRoot, '/etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNSAFE_RELATIVE_PATH');
  });

  it('test_resolveWithinRoot_父目录逃逸_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, '../escape.md').ok).toBe(false);
  });

  it('test_resolveWithinRoot_路径中段逃逸_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'src/../../escape.md').ok).toBe(false);
  });

  it('test_resolveWithinRoot_Windows盘符绝对路径_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'C:\\Windows\\system32').ok).toBe(false);
  });

  it('test_resolveWithinRoot_命令替换美元符_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'x$(touch /tmp/pwned).md').ok).toBe(false);
  });

  it('test_resolveWithinRoot_反引号_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'x`id`.md').ok).toBe(false);
  });

  it('test_resolveWithinRoot_换行符截断命令行_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'ok.md\nrm -rf /').ok).toBe(false);
  });

  it('test_resolveWithinRoot_目录形态带尾斜杠_拒绝', () => {
    // 启发式降级曾产出 'entities/' / 'knowledge/' 这类目录形态——
    // 写盘操作不接受目录（原实现会 EISDIR 报错），守卫提前拒绝更干净
    expect(resolveWithinRoot(tmpRoot, 'knowledge/').ok).toBe(false);
  });

  it('test_resolveWithinRoot_只有点_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, '.').ok).toBe(false);
  });

  it('test_resolveWithinRoot_空字符串_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, '').ok).toBe(false);
  });

  it('test_resolveWithinRoot_超长路径_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 'a/'.repeat(400)).ok).toBe(false);
  });

  it('test_resolveWithinRoot_非字符串输入_拒绝', () => {
    expect(resolveWithinRoot(tmpRoot, 123 as unknown as string).ok).toBe(false);
    expect(resolveWithinRoot(tmpRoot, null as unknown as string).ok).toBe(false);
  });
});

// ============================================================
// 二、isPathWithinRoot：已拼接路径的锚定（snapshot-manager 用）
// ============================================================

describe('isPathWithinRoot · 已拼接路径锚定', () => {
  it('test_isPathWithinRoot_根目录内绝对路径_放行', () => {
    expect(isPathWithinRoot(path.join(tmpRoot, 'think.md'), tmpRoot)).toBe(true);
  });

  it('test_isPathWithinRoot_根目录内相对路径_放行', () => {
    expect(isPathWithinRoot('think.md', tmpRoot)).toBe(true);
  });

  it('test_isPathWithinRoot_根目录外绝对路径_拒绝', () => {
    expect(isPathWithinRoot('/etc/passwd', tmpRoot)).toBe(false);
  });

  it('test_isPathWithinRoot_点点逃逸_拒绝', () => {
    expect(isPathWithinRoot('../evil.md', tmpRoot)).toBe(false);
  });

  it('test_isPathWithinRoot_同前缀兄弟目录_拒绝', () => {
    // 分隔符边界的价值：/x/proj-evil 与 /x/proj 同前缀但不是子目录，
    // 朴素的 startsWith(root) 会误放行
    const root = path.join(tmpRoot, 'proj');
    const sibling = path.join(tmpRoot, 'proj-evil', 'think.md');
    expect(isPathWithinRoot(sibling, root)).toBe(false);
  });

  it('test_isPathWithinRoot_指向根目录本身_拒绝', () => {
    expect(isPathWithinRoot(tmpRoot, tmpRoot)).toBe(false);
  });

  it('test_isPathWithinRoot_含换行符_拒绝', () => {
    expect(isPathWithinRoot('ok.md\nrm -rf /', tmpRoot)).toBe(false);
  });

  it('test_isPathWithinRoot_空字符串_拒绝', () => {
    expect(isPathWithinRoot('', tmpRoot)).toBe(false);
  });
});

// ============================================================
// 三、applyFix · 三处已实证攻击（修复前均可复现）
// ============================================================

describe('applyFix · 已实证攻击向量', () => {
  it('test_applyFix_绝对路径target_拒绝且不写根目录外文件', async () => {
    const outside = path.join(os.tmpdir(), `FIXAPPLIER_PWNED_${Date.now()}.txt`);
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: outside }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(false);
    expect(res.violations.length).toBeGreaterThan(0);
    expect(res.violations[0]).toContain('路径非法');
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('test_applyFix_点点穿越target_拒绝且不写根目录外文件', async () => {
    const escaped = path.join(path.dirname(tmpRoot), `FIXAPPLIER_ESCAPE_${Date.now()}.txt`);
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: path.join('..', path.basename(escaped)) }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(false);
    expect(fs.existsSync(escaped)).toBe(false);
  });

  it('test_applyFix_回滚路径shell注入_拒绝且不执行命令', async () => {
    const marker = path.join(os.tmpdir(), 'PWNED_MARK');
    fs.rmSync(marker, { force: true });

    // 走审计 FAIL → 触发回滚路径（修复前 execSync 拼接会让 touch 真正执行）
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'x$(touch PWNED_MARK).md' }]) },
      failAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, 'PWNED_MARK'))).toBe(false);
  });

  it('test_applyFix_反引号注入_拒绝且不执行命令', async () => {
    const marker = path.join(os.tmpdir(), 'PWNED_BACKTICK');
    fs.rmSync(marker, { force: true });

    await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'x`touch PWNED_BACKTICK`.md' }]) },
      failAudit,
      { rootDir: tmpRoot },
    );
    expect(fs.existsSync(marker)).toBe(false);
  });
});

// ============================================================
// 四、默认实现纵深防御（不注入 fileOps——既有测试全注入，故此处专测）
// ============================================================

describe('applyFix · 默认文件实现（未注入 applyChange/rollback）', () => {
  it('test_applyFix_合法target_默认实现照常写盘', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'think.md', content: 'LEGIT' }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, 'think.md'), 'utf-8')).toBe('LEGIT');
  });

  it('test_applyFix_恶意target_默认实现拒绝写盘', async () => {
    const outside = path.join(os.tmpdir(), `DEFAULT_APPLY_PWNED_${Date.now()}.txt`);
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: outside }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('test_applyFix_默认回滚_git收到参数数组而非shell字符串', async () => {
    await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'think.md', content: 'ROLLBACK-ME' }]) },
      failAudit,
      { rootDir: tmpRoot },
    );
    const calls = vi.mocked(execFileSync).mock.calls;
    const checkout = calls.find((c) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'checkout');
    expect(checkout).toBeDefined();
    // 参数数组形态：文件名是独立元素，不经 /bin/sh 拼接
    expect(checkout![1]).toEqual(['checkout', '--', 'think.md']);
    expect(checkout![0]).toBe('git');
  });
});

// ============================================================
// 五、零副作用：批次内一条非法 → 整批不动
// ============================================================

describe('applyFix · 非法批次零副作用', () => {
  it('test_applyFix_合法在前非法在后_合法那条也不落盘', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      {
        callLlm: evilLlm([
          { target: 'good.md', content: 'SHOULD-NOT-EXIST' },
          { target: '/etc/evil.md' },
        ]),
      },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.applied).toBe(false);
    // 预校验的意义：不让「写了两条再回滚一条」的中间态出现
    expect(fs.existsSync(path.join(tmpRoot, 'good.md'))).toBe(false);
    expect(fs.readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('test_applyFix_非法批次_rollbackInfo文件列表为空', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: '../evil.md' }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.rollbackInfo?.files).toEqual([]);
  });
});

// ============================================================
// 六、不误伤：合法业务路径照常工作
// ============================================================

describe('applyFix · 不误伤合法路径', () => {
  it('test_applyFix_深层知识库路径_照常应用', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'knowledge/refund.md', content: '退款流程' }]) },
      passAudit,
      { applyChange: async () => {}, rollback: async () => {}, rootDir: tmpRoot },
    );
    expect(res.applied).toBe(true);
  });

  it('test_applyFix_文件名含空格_照常应用', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'knowledge/my note.md' }]) },
      passAudit,
      { applyChange: async () => {}, rollback: async () => {}, rootDir: tmpRoot },
    );
    expect(res.applied).toBe(true);
  });

  it('test_applyFix_启发式降级_照常生成think.md修复', async () => {
    // 无 callLlm → 走 heuristicFixProposal（target = think.md）
    const res = await applyFix(mockLocalization, mockDiffReport, undefined, passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.proposal.fixType).toBe('prompt_patch');
    expect(res.applied).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, 'think.md'))).toBe(true);
  });

  it('test_applyFix_违规信息不含裸控制字符_日志不被注入', async () => {
    const res = await applyFix(mockLocalization, mockDiffReport,
      { callLlm: evilLlm([{ target: 'ok.md\nINJECTED-LOG-LINE' }]) },
      passAudit,
      { rootDir: tmpRoot },
    );
    expect(res.violations[0]).toContain('\\n');
    expect(res.violations[0]).not.toContain('\nINJECTED');
  });
});

// ============================================================
// 七、snapshot-manager · 逃逸出 agentDir 的文件不进 git
// ============================================================

describe('rollbackToSnapshot · 文件锚定', () => {
  it('test_rollbackToSnapshot_根目录外文件_被过滤且git不被调用', () => {
    rollbackToSnapshot(tmpRoot, ['/etc/passwd', '../../evil.md'], null);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it('test_rollbackToSnapshot_含换行文件_被过滤且git不被调用', () => {
    rollbackToSnapshot(tmpRoot, ['think.md\nrm -rf /'], null);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it('test_rollbackToSnapshot_agentDir内文件_正常走git参数数组', () => {
    const thinkMd = path.join(tmpRoot, 'think.md');
    rollbackToSnapshot(tmpRoot, [thinkMd], null);
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]![1]).toEqual(['checkout', '--', thinkMd]);
  });

  it('test_rollbackToSnapshot_非法SHA形态_按无快照处理而非拼接进命令', () => {
    const thinkMd = path.join(tmpRoot, 'think.md');
    rollbackToSnapshot(tmpRoot, [thinkMd], '$(touch /tmp/pwned)');
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // SHA 非法 → 不出现在 git 参数里，走 HEAD 恢复
    expect(calls[0]![1]).toEqual(['checkout', '--', thinkMd]);
  });
});
