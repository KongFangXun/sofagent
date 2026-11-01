// ============================================================
// push-target.test.ts · MCP push target 路由——webhook 出站 SSRF 防护
//
// 纵深防御：daemon 的 IM webhook 出站（push-target.ts pushWebhook）
// 与审计/训练侧出站同口径——内网/本机 URL 拒绝发起请求，并提供
// SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1 豁免开关（本地联调合法场景）。
//
// 测试范围（本文件只锁 SSRF 行为，不重复 pushWebhook 已有路由逻辑）：
//   1. 回环 endpoint → 零 HTTP 调用，返回 false
//   2. 豁免开关开启 → 正常发起请求
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { pushToTarget } from '../push-target';

describe('push-target webhook SSRF 防护', () => {
  const ENV_KEYS = ['SOFAGENT_WEBHOOK_DINGTALK', 'SOFAGENT_WEBHOOK_FEISHU', 'SOFAGENT_WEBHOOK_WECOM', 'SOFAGENT_WEBHOOK_ALLOW_LOCALHOST'];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  // 测试：webhook URL 指向本机回环地址时，不发起任何 HTTP 请求，推送失败返回 false。
  // 输入：SOFAGENT_WEBHOOK_DINGTALK=http://127.0.0.1:8080/admin
  // 预期：fetch 零调用，pushToTarget 返回 false（辅助通道失败不阻断主流程）。
  it('testPushToTarget_ssrfLoopbackEnv_noHttpCall_returnsFalse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.SOFAGENT_WEBHOOK_DINGTALK = 'http://127.0.0.1:8080/admin';

    const result = await pushToTarget({
      target: 'webhook:dingtalk',
      title: 'SSRF 探针',
      message: '回环 endpoint 应被拦截',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // 测试：豁免开关（SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1）下，本机 endpoint 照常发起请求——
  // 与审计侧 pushAuditResult 豁免口径一致，本地联调接收器不受影响。
  it('testPushToTarget_allowLocalhostEscapeHatch_httpCallSucceeds_returnsTrue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.SOFAGENT_WEBHOOK_DINGTALK = 'http://127.0.0.1:8080/admin';
    process.env.SOFAGENT_WEBHOOK_ALLOW_LOCALHOST = '1';

    const result = await pushToTarget({
      target: 'webhook:dingtalk',
      title: '豁免联调探针',
      message: '豁免开关下应正常推送',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// v1.4.7 批次 G-2：im-outbox 排水行为锁——「只写不删」断链的兜底闭环
// ────────────────────────────────────────────────────────────

describe('drainOutbox im-outbox 排水（v1.4.7 G-2）', () => {
  let testDir: string;
  const savedDataDir = process.env.SOFAGENT_DATA;

  beforeEach(() => {
    testDir = fs.mkdtempSync(join(os.tmpdir(), 'sofagent-drain-test-'));
    process.env.SOFAGENT_DATA = testDir;
  });

  afterEach(() => {
    process.env.SOFAGENT_DATA = savedDataDir;
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('超龄文件被移入 failed/（排水留档）', async () => {
    const { drainOutbox } = await import('../push-target');
    const outbox = join(testDir, 'im-outbox');
    fs.mkdirSync(outbox, { recursive: true });
    const old = join(outbox, 'old-msg.md');
    fs.writeFileSync(old, '# 旧消息\n');
    const eightDaysAgo = Date.now() - 8 * 24 * 3600 * 1000;
    fs.utimesSync(old, new Date(eightDaysAgo), new Date(eightDaysAgo));

    const drained = drainOutbox();
    expect(drained).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(join(outbox, 'failed', 'old-msg.md'))).toBe(true);
  });

  it('保留期内的文件不动（OpenClaw 可能还要拉取）', async () => {
    const { drainOutbox } = await import('../push-target');
    const outbox = join(testDir, 'im-outbox');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(join(outbox, 'fresh-msg.md'), '# 新消息\n');

    expect(drainOutbox()).toBe(0);
    expect(fs.existsSync(join(outbox, 'fresh-msg.md'))).toBe(true);
  });

  it('outbox 目录不存在时空转无害', async () => {
    const { drainOutbox } = await import('../push-target');
    expect(drainOutbox()).toBe(0);
  });

  it('推送成功语义 deleteOutboxFile 删除源文件', async () => {
    const { deleteOutboxFile } = await import('../push-target');
    const outbox = join(testDir, 'im-outbox');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(join(outbox, 'to-delete.md'), '# 删我\n');

    expect(deleteOutboxFile('to-delete.md')).toBe(true);
    expect(fs.existsSync(join(outbox, 'to-delete.md'))).toBe(false);
  });

  it('推送失败语义 moveOutboxToFailed 移入 failed/', async () => {
    const { moveOutboxToFailed } = await import('../push-target');
    const outbox = join(testDir, 'im-outbox');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(join(outbox, 'to-fail.md'), '# 失败\n');

    expect(moveOutboxToFailed('to-fail.md')).toBe(true);
    expect(fs.existsSync(join(outbox, 'failed', 'to-fail.md'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// R2 回归锁：pushOpenClawIM 三条「失败必留痕」路径
// ────────────────────────────────────────────────────────────
// 变异可检：删掉任一条 notify，对应用例必须变红（否则等于没有门禁）。

describe('pushOpenClawIM 留痕回归锁（R2）', () => {
  let lockDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const savedDataDirR2 = process.env.SOFAGENT_DATA;

  /** 取本轮 spy 已捕获的全部 console.log 文本 */
  const capturedLogs = (): string[] => logSpy.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    lockDir = fs.mkdtempSync(join(os.tmpdir(), 'sofagent-lock-r2-'));
    process.env.SOFAGENT_DATA = lockDir;
    fs.mkdirSync(join(lockDir, 'im-outbox'), { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (savedDataDirR2 === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedDataDirR2;
    try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  // 用例 A：锁「保留策略清理超龄文件前必须留痕」——删掉该 notify 则本用例变红
  it('超龄文件被清理时 → warn 带文件名 + 龄期 + 保留上限，且文件确实删除', async () => {
    const outbox = join(lockDir, 'im-outbox');
    const stale = join(outbox, 'stale-x.md');
    fs.writeFileSync(stale, '# 八天前的旧消息\n');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    fs.utimesSync(stale, eightDaysAgo, eightDaysAgo);

    const ok = await pushToTarget({ target: 'openclaw:im', title: 'T', message: 'M' });

    expect(ok).toBe(true);
    const hit = capturedLogs().find((l) => l.includes('清理超龄未投递文件'));
    expect(hit, `实际日志: ${JSON.stringify(capturedLogs())}`).toBeTruthy();
    expect(hit).toContain('stale-x.md');
    expect(hit).toContain('龄期');
    expect(hit).toContain('保留 7 天');
    // 龄期保留一位小数（不得出现「龄期 7 天 > 保留 7 天」截断矛盾）
    expect(hit).toMatch(/龄期 \d+\.\d 天/);
    // 销毁确实发生
    expect(fs.existsSync(stale)).toBe(false);
  });

  // 用例 B：锁「去重命中必须留痕且点明不确认送达」——删掉该 notify 则本用例变红
  it('同内容二次推送 → 返回 true 且 warn 点明「不确认送达」', async () => {
    const first = await pushToTarget({ target: 'openclaw:im', title: 'T', message: 'M' });
    expect(first).toBe(true);

    logSpy.mockClear(); // 只看第二次的日志
    const second = await pushToTarget({ target: 'openclaw:im', title: 'T', message: 'M' });

    // 返回值语义不变：去重命中仍视为 true（不改为 false）
    expect(second).toBe(true);
    const hit = capturedLogs().find((l) => l.includes('不确认送达'));
    expect(hit, `实际日志: ${JSON.stringify(capturedLogs())}`).toBeTruthy();
    expect(hit).toContain('跳过写入');
  });

  // 用例 C：锁「stat 失败仍留痕」——悬空符号链接使 statSync 必 ENOENT，
  // 比 chmod 稳定（chmod 000 不影响 stat，只挡 read）
  it('保留策略 stat 失败（悬空软链）→ warn 含「保留策略跳过」且文件不被删', async () => {
    const outbox = join(lockDir, 'im-outbox');
    const broken = join(outbox, 'broken-link.md');
    fs.symlinkSync(join(lockDir, 'no-such-target'), broken);

    const ok = await pushToTarget({ target: 'openclaw:im', title: 'T', message: 'M' });

    expect(ok).toBe(true);
    const hit = capturedLogs().find((l) => l.includes('保留策略跳过'));
    expect(hit, `实际日志: ${JSON.stringify(capturedLogs())}`).toBeTruthy();
    expect(hit).toContain('broken-link.md');
    // 保守语义不变：状态读不了的文件不删
    expect(fs.lstatSync(broken).isSymbolicLink()).toBe(true);
  });

  // 用例 D：锁「去重比对读失败必须留痕」——目录占 .md 名是**唯一**能确定性进到
  // 该分支的构造：statSync 对目录成功（因而停在保留策略的正常分支），
  // readFileSync 才抛 EISDIR。别用 chmod（chmod 只挡 read 不挡 stat，
  // 但 stat 失败会先被上一条 catch 吃掉，进不到去重比对）。
  it('去重比对读失败（目录占 .md 名）→ warn 含「去重比对跳过」且照常落盘', async () => {
    const outbox = join(lockDir, 'im-outbox');
    fs.mkdirSync(join(outbox, 'dir-h.md')); // 目录占 .md 名 → readFileSync EISDIR

    const ok = await pushToTarget({ target: 'openclaw:im', title: 'T', message: 'M' });

    expect(ok).toBe(true);
    // 区分触发点：必须是「去重比对跳过」，不是「保留策略跳过」
    expect(capturedLogs().some((l) => l.includes('保留策略跳过'))).toBe(false);
    const hit = capturedLogs().find((l) => l.includes('去重比对跳过'));
    expect(hit, `实际日志: ${JSON.stringify(capturedLogs())}`).toBeTruthy();
    expect(hit).toContain('dir-h.md');
    expect(hit).toContain('EISDIR');
    // 控制流不变：比对不了仍照常落盘（不因读失败而放弃写入）——
    // 目录占位本身就是「漏去重就重复落盘」的入口
    expect(fs.readdirSync(outbox).filter((f) => f.endsWith('.md'))).toHaveLength(2);
  });
});
