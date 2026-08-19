// ============================================================
// durable/__tests__/wal.test.ts · v1.3.8 交付三：Durable L3 WAL 测试
// ============================================================
//
// 覆盖（TDD——时序/三态/undo 实测/告警/幂等）：
//  1. WalWriter 时序：文件中 begin 记录先于 commit（write-ahead 语义）
//     + abort 原因落盘 + taskId 透传
//  2. scanWAL 三态：手工构造半程 WAL → committed/aborted/incomplete
//     正确聚合（含孤儿终态忽略、重复 begin 首次为准）
//  3. recoverWAL：
//     - aborted → 有 undo 调 undo（rolled-back 清单）
//     - committed 未确认 → undo actualSideEffects
//     - incomplete + 全幂等 → reExecute 重跑
//     - incomplete + 非幂等 → 跳过 + onWarn 告警
//  4. git undo 临时仓库实测：mkdtemp 建仓 → git 修改 → gitRestore →
//     工作区恢复（真 git，非 mock）
//  5. deleteWrittenFile：删除新写文件 + 幂等（二次 undo 无害）
//  6. 不可逆告警：isReversible 查询 + warnIfNotFullyReversible 回调触发
//  7. 幂等重跑不双副作用：恢复后 reExecute 只执行一次（计数器验证）
//  8. 网关集成：execute() 走 begin→commit / begin→abort（WalWriter 实例接线）
//
// 全部使用临时目录隔离（mkdtemp）——不污染仓库。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

import { WalWriter, newTaskId, type SideEffectSpec } from '../wal-writer';
import { scanWAL } from '../wal-recovery';
import { recoverWAL } from '../wal-recovery';
import {
  UndoRegistry,
  createUndoRegistry,
  gitRestore,
  deleteWrittenFile,
  type UndoResult,
} from '../undo-registry';
import { createProxyGateway, type ProxyRequest } from '../../gateway/proxy-gateway';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-wal-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

/** 在 dir 建一个真实 git 仓库（初始 commit 含一个 tracked 文件） */
function initGitRepo(dir: string): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe', timeout: 10_000 });
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'wal-test@sofagent.local']);
  git(['config', 'user.name', 'wal-test']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'original\n', 'utf-8');
  git(['add', 'tracked.txt']);
  git(['commit', '-q', '-m', 'init']);
}

/** 读 WAL 文件逐行解析 */
function readWalLines(walPath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(walPath, 'utf-8');
  return content.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ════════════════════════════════════════
// 一、WalWriter 时序
// ════════════════════════════════════════

describe('交付三 · WalWriter 写入时序', () => {
  let dir: string;
  let wal: WalWriter;
  let walPath: string;

  beforeEach(() => {
    dir = tmpDir();
    walPath = path.join(dir, 'wal.jsonl');
    wal = new WalWriter(walPath);
  });
  afterEach(() => rmDir(dir));

  it('begin 记录先于 commit 落盘（write-ahead 语义）', () => {
    wal.begin('t1', 'write_file', { path: 'a.txt' }, [{ action: 'file.write', target: 'a.txt' }]);
    wal.commit('t1', [{ action: 'file.write', target: 'a.txt' }]);

    const lines = readWalLines(walPath);
    expect(lines.length).toBe(2);
    expect(lines[0]!.type).toBe('begin');          // 先 begin
    expect(lines[0]!.taskId).toBe('t1');
    expect(lines[0]!.tool).toBe('write_file');
    expect((lines[0]!.expectedSideEffects as SideEffectSpec[]).length).toBe(1);
    expect(lines[1]!.type).toBe('commit');         // 后 commit
    expect(lines[1]!.taskId).toBe('t1');
    // begin 行号 < commit 行号（文件中物理顺序——时序证明）
    const content = fs.readFileSync(walPath, 'utf-8');
    expect(content.indexOf('"type":"begin"')).toBeLessThan(content.indexOf('"type":"commit"'));
  });

  it('abort 落盘失败原因；commit 落盘实际副作用', () => {
    wal.begin('t2', 'db_write', { sql: 'UPDATE …' });
    wal.abort('t2', 'connection refused');
    wal.begin('t3', 'read_file', {});
    wal.commit('t3', [{ action: 'file.write', target: 'x.txt', idempotent: true }]);

    const lines = readWalLines(walPath);
    expect(lines.find((l) => l.type === 'abort')!.reason).toBe('connection refused');
    const commit = lines.find((l) => l.type === 'commit')!;
    expect((commit.actualSideEffects as SideEffectSpec[])[0]!.target).toBe('x.txt');
  });

  it('begin 返回入参 taskId；newTaskId 唯一', () => {
    expect(wal.begin('fixed-id', 't', {})).toBe('fixed-id');
    const ids = new Set([newTaskId(), newTaskId(), newTaskId()]);
    expect(ids.size).toBe(3);
  });

  it('readAll 读回全部记录（坏行跳过）', () => {
    wal.begin('a', 't1', {});
    wal.commit('a');
    // 手工追加一行坏 JSON（模拟崩溃半行）
    fs.appendFileSync(walPath, '{"type":"beg', 'utf-8');
    wal.begin('b', 't2', {});
    const all = wal.readAll();
    expect(all.length).toBe(3); // begin a + commit a + begin b（坏行不计）
  });
});

// ════════════════════════════════════════
// 二、scanWAL 三态
// ════════════════════════════════════════

describe('交付三 · scanWAL 三态聚合', () => {
  let dir: string;
  let walPath: string;

  beforeEach(() => { dir = tmpDir(); walPath = path.join(dir, 'wal.jsonl'); });
  afterEach(() => rmDir(dir));

  it('半程 WAL → committed / aborted / incomplete 三态正确分桶', () => {
    const wal = new WalWriter(walPath);
    wal.begin('t-done', 'write_file', {}, [{ action: 'file.write', target: 'a' }]);
    wal.commit('t-done', [{ action: 'file.write', target: 'a' }]);
    wal.begin('t-fail', 'db_write', {}, []);
    wal.abort('t-fail', 'boom');
    wal.begin('t-crash', 'send_email', {}, [{ action: 'email.send' }]); // 崩溃点：无终态

    const scan = scanWAL(walPath);
    expect(scan.committed.length).toBe(1);
    expect(scan.aborted.length).toBe(1);
    expect(scan.incomplete.length).toBe(1);
    expect(scan.committed[0]!.taskId).toBe('t-done');
    expect(scan.committed[0]!.actualSideEffects![0]!.target).toBe('a');
    expect(scan.aborted[0]!.abortReason).toBe('boom');
    expect(scan.incomplete[0]!.taskId).toBe('t-crash');
    expect(scan.incomplete[0]!.tool).toBe('send_email');
  });

  it('孤儿终态忽略 / 重复 begin 首次为准 / 文件不存在返回空', () => {
    const wal = new WalWriter(walPath);
    wal.commit('ghost');                       // 无 begin 的 commit——忽略
    wal.begin('dup', 'tool-a', {});
    wal.begin('dup', 'tool-b', {});            // 同 taskId 二次 begin——首次为准
    wal.abort('dup', 'x');

    const scan = scanWAL(walPath);
    expect(scan.committed.length).toBe(0);
    expect(scan.aborted.length).toBe(1);
    expect(scan.aborted[0]!.tool).toBe('tool-a'); // 首次 begin 的工具名
    expect(scanWAL(path.join(dir, 'nope.jsonl')).committed.length).toBe(0);
  });
});

// ════════════════════════════════════════
// 三、recoverWAL 三态处置
// ════════════════════════════════════════

describe('交付三 · recoverWAL 恢复处置', () => {
  let dir: string;
  let walPath: string;

  beforeEach(() => { dir = tmpDir(); walPath = path.join(dir, 'wal.jsonl'); });
  afterEach(() => rmDir(dir));

  it('aborted → 有 undo 调 undo（rolled-back 清单）', async () => {
    const file = path.join(dir, 'side.txt');
    fs.writeFileSync(file, 'partial', 'utf-8');           // 模拟已发生的部分副作用
    const wal = new WalWriter(walPath);
    wal.begin('t1', 'write_file', {}, [{ action: 'file.write', target: file }]);
    wal.abort('t1', 'crash mid-flight');

    const result = await recoverWAL({
      entries: scanWAL(walPath),
      undoRegistry: createUndoRegistry(),
    });
    expect(result.rolledBack.length).toBe(1);
    expect(result.rolledBack[0]!.status).toBe('done');
    expect(fs.existsSync(file)).toBe(false);              // undo 已删除副作用文件
  });

  it('committed 未确认 → undo actualSideEffects；无副作用 committed 跳过', async () => {
    const file = path.join(dir, 'committed-side.txt');
    fs.writeFileSync(file, 'x', 'utf-8');
    const wal = new WalWriter(walPath);
    wal.begin('t1', 'write_file', {}, [{ action: 'file.write', target: file }]);
    wal.commit('t1', [{ action: 'file.write', target: file }]);
    wal.begin('t2', 'read_file', {});                     // 无副作用 committed
    wal.commit('t2', []);

    const result = await recoverWAL({
      entries: scanWAL(walPath),
      undoRegistry: createUndoRegistry(),
    });
    expect(fs.existsSync(file)).toBe(false);              // committed 未确认也回滚
    expect(result.rolledBack.length).toBe(1);
    expect(result.skipped.some((s) => s.taskId === 't2')).toBe(true); // 纯读跳过
  });

  it('incomplete 全幂等 → reExecute 重跑；非幂等 → 跳过 + onWarn', async () => {
    const wal = new WalWriter(walPath);
    wal.begin('t-idem', 'append_log', {}, [{ action: 'log.append', idempotent: true }]);
    wal.begin('t-nonidem', 'send_email', {}, [{ action: 'email.send', idempotent: false }]);

    const reExecuted: string[] = [];
    const warnings: string[] = [];
    const result = await recoverWAL({
      entries: scanWAL(walPath),
      reExecute: (trx) => { reExecuted.push(trx.taskId); },
      onWarn: (w) => { warnings.push(w.message); },
    });
    expect(reExecuted).toEqual(['t-idem']);               // 只重跑幂等事务
    expect(result.reExecuted.length).toBe(1);
    expect(result.skipped.some((s) => s.taskId === 't-nonidem')).toBe(true);
    expect(warnings.some((m) => m.includes('t-nonidem'))).toBe(true); // 非幂等告警
  });

  it('不可逆副作用 → 不回滚记 skipped + 告警（已发生的事实不篡改）', async () => {
    const wal = new WalWriter(walPath);
    wal.begin('t-mail', 'send_email', {}, [{ action: 'email.send' }]);
    wal.abort('t-mail', 'timeout');

    const warnings: string[] = [];
    const result = await recoverWAL({
      entries: scanWAL(walPath),
      onWarn: (w) => { warnings.push(w.message); },
      // 默认注册表——email.send 未注册 → irreversible 路径
    });
    expect(result.rolledBack.length).toBe(0);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]!.reason).toContain('不可逆');
    expect(warnings.length).toBe(1);
  });

  it('undo 抛错 → rollbackFailures 记录且恢复继续（不中断后续事务）', async () => {
    const wal = new WalWriter(walPath);
    wal.begin('t-bad', 'explode.write', {}, [{ action: 'explode.write' }]);
    wal.abort('t-bad', 'x');
    wal.begin('t-good', 'file.write', {}, [{ action: 'file.write', target: path.join(dir, 'g.txt') }]);
    wal.abort('t-good', 'y');

    const registry = createUndoRegistry();
    registry.registerUndo('explode.write', () => { throw new Error('undo boom'); }, 'reversible');

    const result = await recoverWAL({ entries: scanWAL(walPath), undoRegistry: registry });
    expect(result.rollbackFailures.length).toBe(1);
    expect(result.rollbackFailures[0]!.reason).toContain('undo boom');
    expect(result.rolledBack.length).toBe(1);             // 后续事务照常处置
  });
});

// ════════════════════════════════════════
// 四、git undo 临时仓库实测
// ════════════════════════════════════════

describe('交付三 · gitRestore 真 git 回滚实测', () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('修改 tracked 文件 → gitRestore → 工作区恢复为 HEAD 内容', () => {
    initGitRepo(dir);
    const file = path.join(dir, 'tracked.txt');
    fs.writeFileSync(file, 'AGENT 改坏了\n', 'utf-8');    // 模拟工具写入

    const result = gitRestore({ taskId: 't-git', action: 'git.checkout', target: file });
    expect(result.status).toBe('done');
    expect(fs.readFileSync(file, 'utf-8')).toBe('original\n'); // 回到 HEAD
  });

  it('新建 untracked 文件 → gitRestore 返回 skipped（归 file.write undo 管，不误删）；仓库根 target → 整仓恢复', () => {
    initGitRepo(dir);
    const tracked = path.join(dir, 'tracked.txt');
    const untracked = path.join(dir, 'new-file.txt');
    fs.writeFileSync(untracked, 'new', 'utf-8');
    fs.writeFileSync(tracked, 'modified', 'utf-8');

    // untracked 文件：不在 git 索引——skipped 且文件保留（由 file.write undo 负责删）
    const r1 = gitRestore({ taskId: 't1', action: 'git.checkout', target: untracked });
    expect(r1.status).toBe('skipped');
    expect(fs.existsSync(untracked)).toBe(true);

    // 整仓恢复：target = 仓库根
    const r2 = gitRestore({ taskId: 't2', action: 'git.checkout', target: dir });
    expect(r2.status).toBe('done');
    expect(fs.readFileSync(tracked, 'utf-8')).toBe('original\n');
  });

  it('仓库外路径 → skipped（非 git 管辖）；不存在的 target → done（幂等）', () => {
    const outside = tmpDir();                              // 非 git 仓库
    try {
      const r = gitRestore({ taskId: 't', action: 'git.checkout', target: outside });
      expect(r.status).toBe('skipped');
    } finally { rmDir(outside); }
    const r2 = gitRestore({ taskId: 't', action: 'git.checkout', target: path.join(dir, 'never-exists.txt') });
    expect(r2.status).toBe('done');                        // 幂等——视为已回滚
  });
});

// ════════════════════════════════════════
// 五、deleteWrittenFile + 不可逆告警 + 幂等重跑
// ════════════════════════════════════════

describe('交付三 · deleteWrittenFile 与 undo 注册表', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('删除新写文件 + 二次 undo 幂等（已删视为 done）', () => {
    const file = path.join(dir, 'new.txt');
    fs.writeFileSync(file, 'data', 'utf-8');
    const r1 = deleteWrittenFile({ taskId: 't', action: 'file.write', target: file });
    expect(r1.status).toBe('done');
    expect(fs.existsSync(file)).toBe(false);
    const r2 = deleteWrittenFile({ taskId: 't', action: 'file.write', target: file });
    expect(r2.status).toBe('done');                        // 幂等
  });

  it('目录 target → skipped（拒绝递归删除）；缺 target → skipped', () => {
    const r1 = deleteWrittenFile({ taskId: 't', action: 'file.write', target: dir });
    expect(r1.status).toBe('skipped');
    const r2 = deleteWrittenFile({ taskId: 't', action: 'file.write' });
    expect(r2.status).toBe('skipped');
  });

  it('isReversible 三档查询 + warnIfNotFullyReversible 触发（irreversible/partial 告警，reversible 静默）', () => {
    const reg = createUndoRegistry();
    // 部分可逆：PR 创建（能关不能删）与飞书撤回——注册标记 partial
    const closePr: (e: { taskId: string; action: string; target?: string; detail?: string }) => UndoResult =
      (e) => ({ taskId: e.taskId, action: e.action, status: 'done', detail: `PR ${e.target ?? ''} 已关闭（创建记录保留）` });
    const recallFeishu: (e: { taskId: string; action: string; target?: string; detail?: string }) => UndoResult =
      (e) => ({ taskId: e.taskId, action: e.action, status: 'partial' in e ? 'done' : 'done', detail: '飞书消息撤回（2 分钟窗口内）' });
    reg.registerUndo('pr.create', closePr, 'partial');
    reg.registerUndo('feishu.send', recallFeishu, 'partial');
    // 不可逆：邮件发送 / webhook 触发——注册但 tier=irreversible（查询即告警依据）
    const noopUndo: (e: { taskId: string; action: string }) => UndoResult =
      (e) => ({ taskId: e.taskId, action: e.action, status: 'skipped', detail: '不可逆——不回滚' });
    reg.registerUndo('email.send', noopUndo, 'irreversible');
    reg.registerUndo('webhook.trigger', noopUndo, 'irreversible');

    expect(reg.isReversible('git.checkout')).toBe('reversible');
    expect(reg.isReversible('file.write')).toBe('reversible');
    expect(reg.isReversible('pr.create')).toBe('partial');
    expect(reg.isReversible('feishu.send')).toBe('partial');
    expect(reg.isReversible('email.send')).toBe('irreversible');
    expect(reg.isReversible('webhook.trigger')).toBe('irreversible');
    expect(reg.isReversible('unknown.tool')).toBe('irreversible'); // 未注册 fail-safe

    const warned: string[] = [];
    reg.onIrreversible((w) => { warned.push(`${w.tool}:${w.tier}`); });
    reg.warnIfNotFullyReversible('file.write', 't1');     // 可逆——不告警
    expect(warned.length).toBe(0);
    reg.warnIfNotFullyReversible('email.send', 't2');
    reg.warnIfNotFullyReversible('pr.create', 't3');
    expect(warned).toEqual(['email.send:irreversible', 'pr.create:partial']);
    expect(reg.registeredTools()).toContain('git.checkout');
  });
});

// ════════════════════════════════════════
// 六、幂等重跑不双副作用（计数器）
// ════════════════════════════════════════

describe('交付三 · 幂等重跑不双副作用', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('恢复 + 再次恢复：reExecute 只执行一次/轮，外部副作用计数不翻倍', async () => {
    // 场景：第一次崩溃恢复重跑了 t1（副作用计数 +1）；恢复成功后调用方
    // 写 commit 确认；第二次恢复（不该再重跑 t1——已 committed 且无副作用）。
    const walPath = path.join(dir, 'wal.jsonl');
    const wal = new WalWriter(walPath);
    wal.begin('t1', 'append_log', {}, [{ action: 'log.append', idempotent: true }]);

    let sideEffectCount = 0;
    const reExecute = (trx: { taskId: string }): void => {
      // 幂等重跑：先查 L2 登记簿语义（这里用计数器模拟）——已执行过就跳过
      if (executed.has(trx.taskId)) return;
      executed.add(trx.taskId);
      sideEffectCount += 1;
      // 重跑成功 → 调用方确认 commit（写终态防二次重跑）
      wal.commit(trx.taskId, [{ action: 'log.append', idempotent: true }]);
    };
    const executed = new Set<string>();

    // 第一次恢复：incomplete → 重跑（副作用 +1，commit 落盘）
    const r1 = await recoverWAL({ entries: scanWAL(walPath), reExecute });
    expect(r1.reExecuted.length).toBe(1);
    expect(sideEffectCount).toBe(1);

    // 第二次恢复（模拟调用方又崩了一次再起）：t1 已 committed——不再重跑
    const r2 = await recoverWAL({ entries: scanWAL(walPath), reExecute });
    expect(r2.reExecuted.length).toBe(0);
    expect(sideEffectCount).toBe(1);                       // 计数不翻倍
  });
});

// ════════════════════════════════════════
// 七、网关集成（begin→执行→commit/abort）
// ════════════════════════════════════════

describe('交付三 · 网关 execute WAL 集成', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  function readReq(overrides: Partial<ProxyRequest> = {}): ProxyRequest {
    return {
      agentId: 'a1',
      tool: 'read_file',
      action: 'read',
      target: { host: 'api.github.com', port: 443, protocol: 'https' },
      params: { path: 'src/index.ts' },
      ...overrides,
    };
  }

  it('execute 成功 → WAL begin+commit 落盘且 begin 在前；失败 → begin+abort', async () => {
    const walPath = path.join(dir, 'wal.jsonl');
    const wal = new WalWriter(walPath);
    const gw = createProxyGateway({
      dataDir: dir,
      allowHosts: ['api.github.com'],
      agents: { a1: ['read_file'] },
      wal,
      walTaskId: () => 'wal-task-1',                       // 确定性 taskId（断言用）
    });

    const ok = await gw.execute(readReq(), async () => 'done');
    expect(ok.result).toBe('done');

    let lines = readWalLines(walPath);
    expect(lines.length).toBe(2);
    expect(lines[0]!.type).toBe('begin');
    expect(lines[0]!.taskId).toBe('wal-task-1');
    expect(lines[0]!.tool).toBe('read_file');
    expect(lines[1]!.type).toBe('commit');
    expect(lines[1]!.taskId).toBe('wal-task-1');

    // 失败路径：begin + abort（错误不吞——调用方拿到 reject）
    await expect(gw.execute(readReq(), async () => { throw new Error('tool failed'); }))
      .rejects.toThrow('tool failed');
    lines = readWalLines(walPath);
    expect(lines.length).toBe(4);
    expect(lines[2]!.type).toBe('begin');
    expect(lines[3]!.type).toBe('abort');
    expect(String(lines[3]!.reason)).toContain('tool failed');
  });

  it('deny 请求不写 WAL（守卫先于执行——被拒请求无事务）', async () => {
    const walPath = path.join(dir, 'wal.jsonl');
    const wal = new WalWriter(walPath);
    const gw = createProxyGateway({
      dataDir: dir,
      allowHosts: [],
      agents: { a1: ['read_file'] },
      wal,
    });
    const denied = await gw.execute(readReq(), async () => 'never');
    expect(denied.decision).toBe('deny');
    expect(fs.existsSync(walPath)).toBe(false);            // 拒绝路径零 WAL 写入
  });
});
