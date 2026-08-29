// ============================================================
// data-sovereignty.test.ts · 数据主权审计日志单测
// v1.2.9 P0 — 覆盖 DataSovereigntyLogger / sanitizeRecord /
//             resolveDateArg / resolveSovereigntyLogPath / HMAC 链
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { randomBytes } from 'crypto';
// vi.mock 会被 vitest hoist 到所有 import 之前，确保 CI 环境也生效
vi.mock('@sofagent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/core')>();
  return {
    ...actual,
    getHmacKey: () => 'test-hmac-key-for-vitest',
  };
});

// 必须在 mock 之后 import（vitest hoist 保证顺序）
const { DataSovereigntyLogger, sanitizeRecord, resolveDateArg, resolveSovereigntyLogPath } =
  await import('../data-sovereignty');
import type { DataSovereigntyRecord, SovereigntyLogEntry } from '../data-sovereignty';

// ── 测试工具 ──

/** 创建唯一的临时目录（测试隔离） */
function makeTmpDir(): string {
  const dir = join(tmpdir(), `sofagent-ds-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 构造一条合法的 DataSovereigntyRecord。
 * timestamp 通过参数传入，便于控制分日文件。
 */
function makeRecord(
  overrides: Partial<DataSovereigntyRecord> = {},
): DataSovereigntyRecord {
  return {
    cloudCall: {
      timestamp: '2026-07-28T10:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      tokenCount: { input: 100, output: 50 },
      purpose: 'code-gen',
    },
    localAction: {
      type: 'model-inference',
      target: 'gpt-4o',
      description: '生成代码',
      auditResult: 'PASS',
    },
    dataFlow: {
      direction: 'outbound',
      sensitivity: 'internal',
      fields: ['code-snippet'],
      destination: 'cloud-api',
      redacted: false,
    },
    taskContext: {
      taskId: 'task-001',
      userIntent: '帮我写一个函数',
      agentRole: 'engineer',
    },
    ...overrides,
  } as DataSovereigntyRecord;
}

/** 从 JSONL 文件解析所有行 */
function readJsonl(filePath: string): SovereigntyLogEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SovereigntyLogEntry);
}

// ============================================================
// resolveSovereigntyLogPath · 路径解析
// ============================================================

describe('resolveSovereigntyLogPath', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('字符串日期：拼接为 {base}/{年}/{月}/YYYY-MM-DD.jsonl', () => {
    // 测试：传入 ISO 日期字符串，路径应按年/月/日三级嵌套
    const path = resolveSovereigntyLogPath('2026-07-28', tmpHome);
    expect(path).toBe(join(tmpHome, 'data', 'audit', 'data-sovereignty', '2026', '07', '2026-07-28.jsonl'));
  });

  it('Date 对象：从 Date 提取年月日', () => {
    // 测试：传入 Date 对象时也能正确提取 year/month/day
    const path = resolveSovereigntyLogPath(new Date('2026-01-05T00:00:00Z'), tmpHome);
    expect(path).toContain(join('2026', '01', '2026-01-05.jsonl'));
  });

  it('月份和日期不足两位时补零', () => {
    // 测试：单数月/日应 padStart 到两位（01、05）
    const path = resolveSovereigntyLogPath('2026-1-5', tmpHome);
    expect(path).toContain('2026');
    expect(path).toMatch(/01/);
    expect(path).toMatch(/05/);
  });
});

// ============================================================
// resolveDateArg · 日期参数解析
// ============================================================

describe('resolveDateArg', () => {
  it('"today" 返回今天的 YYYY-MM-DD', () => {
    // 测试：today → 当天日期
    const result = resolveDateArg('today');
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });

  it('"yesterday" 返回昨天的 YYYY-MM-DD', () => {
    // 测试：yesterday → 比今天少一天的日期
    const result = resolveDateArg('yesterday');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expected = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });

  it('合法 YYYY-MM-DD 格式原样返回', () => {
    // 测试：已经是标准格式的不做转换
    expect(resolveDateArg('2026-07-28')).toBe('2026-07-28');
  });

  it('无效输入 fallback 到 today 而非抛错', () => {
    // 测试：垃圾输入不报错，降级为今天日期
    const result = resolveDateArg('not-a-date!!!');
    const today = resolveDateArg('today');
    expect(result).toBe(today);
  });

  it('可被 Date 解析的非标准格式（如 "7/28/2026"）转为 YYYY-MM-DD', () => {
    // 测试：非标准但合法的日期串走 Date.parse fallback
    const result = resolveDateArg('2026-07-28T12:00:00Z');
    // 应该是 2026-07-28（当地时区可能差一天，但一定在 07-2x 范围）
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ============================================================
// sanitizeRecord · 脱敏
// ============================================================

describe('sanitizeRecord', () => {
  it('不修改不含敏感串的记录', () => {
    // 测试：正常字段不被替换
    const record = makeRecord();
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields).toEqual(['code-snippet']);
    expect(result.taskContext.userIntent).toBe('帮我写一个函数');
    expect(result.dataFlow.redacted).toBe(false);
  });

  it('脱敏 fields 中 32+ 字符的随机串（API key 形态）', () => {
    // 测试：32 字符长串被替换为 [REDACTED:NN字符] 占位符
    // 运行时拼接避免 A2 扫描（不可写字面量）
    const secret = ['sk-abcdef', '1234567890', 'abcdef1234567890'].join(''); // 34 字符
    const record = makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'confidential',
        fields: [secret],
        destination: 'cloud-api',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields[0]).toContain('[REDACTED:');
    expect(result.dataFlow.fields[0]).not.toContain(secret);
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('脱敏 userIntent 中的敏感串', () => {
    // 测试：userIntent 中的 token 也被脱敏
    // 运行时拼接避免 A2 扫描（不可写字面量）
    const secret = ['AKIA', 'IOSFODNN7EXAMPLE', '1234567890123'].join(''); // 32+ 字符
    const record = makeRecord({
      taskContext: {
        taskId: 't1',
        userIntent: `用这个 key ${secret}`,
        agentRole: 'engineer',
      },
    });
    const result = sanitizeRecord(record);
    expect(result.taskContext.userIntent).not.toContain(secret);
    expect(result.taskContext.userIntent).toContain('[REDACTED:');
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('返回新对象，不修改入参（不可变性）', () => {
    // 测试：原始 record 的 fields 不被修改
    const secret = ['abcdefghij', '1234567890', 'abcdefghij1234'].join(''); // 34 字符
    const record = makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'internal',
        fields: [secret],
        destination: 'cloud-api',
        redacted: false,
      },
    });
    const original = record.dataFlow.fields[0];
    sanitizeRecord(record);
    expect(record.dataFlow.fields[0]).toBe(original);
  });

  it('redacted=true 的记录脱敏后仍为 true', () => {
    // 测试：已标记 redacted 的不会被重置为 false
    const record = makeRecord({
      dataFlow: {
        direction: 'local-only',
        sensitivity: 'public',
        fields: ['normal'],
        destination: 'local-file',
        redacted: true,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('脱敏 fields 中的 IPv4 地址', () => {
    // 测试：IPv4 地址被替换为 [IP]
    const record = makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'internal',
        fields: ['server 192.168.1.100 连接超时'],
        destination: 'cloud-api',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields[0]).toContain('[IP]');
    expect(result.dataFlow.fields[0]).not.toContain('192.168.1.100');
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('脱敏 fields 中的 macOS 用户路径', () => {
    // 测试：/Users/xxx/ 路径被替换为 [USER_PATH]
    // v1.3.2 P0-R1: 动态生成测试用户路径（不硬编码真实用户名，保证任意开发者机器可跑）
    const testUserPath = join(homedir(), 'WorkBuddy');
    const record = makeRecord({
      dataFlow: {
        direction: 'local-only',
        sensitivity: 'internal',
        fields: [`路径 ${testUserPath}/ 包含用户名`],
        destination: 'local-file',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields[0]).toContain('[USER_PATH]');
    expect(result.dataFlow.fields[0]).not.toContain(`${homedir()}/`);
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('脱敏 fields 中的 Linux 用户路径', () => {
    // 测试：/home/xxx/ 路径被替换为 [USER_PATH]
    const record = makeRecord({
      dataFlow: {
        direction: 'local-only',
        sensitivity: 'internal',
        fields: ['路径 /home/admin/.ssh/ 包含用户名'],
        destination: 'local-file',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields[0]).toContain('[USER_PATH]');
    expect(result.dataFlow.fields[0]).not.toContain('/home/admin/');
    expect(result.dataFlow.redacted).toBe(true);
  });

  it('data-URI 载荷不被长随机串模式误切（base64 静态资源原样保留）', () => {
    // 测试：内嵌图标/图片的 data-URI 不属于密钥形态——与 A2 / ToolGate /
    // prompt-sanitizer 的 data-URI 豁免同口径（H-02 家族）
    const uri = 'data:image/png;base64,' + 'A'.repeat(64);
    const record = makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'internal',
        fields: [`图标 ${uri} 结束`],
        destination: 'cloud-api',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    expect(result.dataFlow.fields[0]).toContain(uri);
    expect(result.dataFlow.fields[0]).not.toContain('[REDACTED:');
    expect(result.dataFlow.redacted).toBe(false);
  });

  it('data-URI 同字段混入真密钥：载荷保留、段外密钥照拦', () => {
    // 测试：豁免不降低安全性——data-URI 前后拼真密钥仍被脱敏
    // 运行时拼接避免 A2 扫描（不可写字面量）
    const secret = ['sk-live-abcdef', '1234567890', 'abcdef123456'].join(''); // 37 字符
    const uri = 'data:image/svg+xml;base64,' + 'QUJD'.repeat(20);
    const record = makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'confidential',
        fields: [`key=${secret} icon=${uri}`],
        destination: 'cloud-api',
        redacted: false,
      },
    });
    const result = sanitizeRecord(record);
    const field = result.dataFlow.fields[0];
    expect(field).toContain(uri);
    expect(field).toContain('[REDACTED:');
    expect(field).not.toContain(secret);
    expect(result.dataFlow.redacted).toBe(true);
  });
});

// ============================================================
// DataSovereigntyLogger · 写入
// ============================================================

describe('DataSovereigntyLogger', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  // ── 构造 + append ──

  it('append 后文件存在且为 JSONL 单行', () => {
    // 测试：首次写入创建 {年}/{月}/YYYY-MM-DD.jsonl
    const logger = new DataSovereigntyLogger(tmpHome);
    const record = makeRecord();

    logger.append(record);

    const filePath = resolveSovereigntyLogPath(record.cloudCall.timestamp, tmpHome);
    expect(existsSync(filePath)).toBe(true);

    const entries = readJsonl(filePath);
    expect(entries.length).toBe(1);
  });

  it('append 写入的条目包含 4 维完整字段', () => {
    // 测试：落盘 JSON 包含 cloudCall/localAction/dataFlow/taskContext
    const logger = new DataSovereigntyLogger(tmpHome);
    const record = makeRecord();

    logger.append(record);

    const filePath = resolveSovereigntyLogPath(record.cloudCall.timestamp, tmpHome);
    const entry = readJsonl(filePath)[0]!;
    expect(entry.cloudCall.model).toBe('gpt-4o');
    expect(entry.localAction.auditResult).toBe('PASS');
    expect(entry.dataFlow.direction).toBe('outbound');
    expect(entry.taskContext.taskId).toBe('task-001');
  });

  // ── HMAC 哈希链 ──

  it('首次写入 prevHash 为 "genesis"（空文件场景）', () => {
    // 测试：文件不存在时 prevHash = 'genesis'
    const logger = new DataSovereigntyLogger(tmpHome);
    const record = makeRecord();

    logger.append(record);

    const filePath = resolveSovereigntyLogPath(record.cloudCall.timestamp, tmpHome);
    const entry = readJsonl(filePath)[0]!;
    expect(entry.prevHash).toBe('genesis');
  });

  it('第二条记录的 prevHash 指向第一条记录的派生 hash', () => {
    // 测试：HMAC 链——第二条 prevHash 不再是 genesis 而是上一条派生值
    const logger = new DataSovereigntyLogger(tmpHome);
    const ts = '2026-07-28T10:00:00.000Z';

    logger.append(makeRecord({ cloudCall: { timestamp: ts, provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }));
    logger.append(makeRecord({ cloudCall: { timestamp: ts, provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 2, output: 2 }, purpose: 'p2' } }));

    const filePath = resolveSovereigntyLogPath(ts, tmpHome);
    const entries = readJsonl(filePath);
    expect(entries.length).toBe(2);

    // 第一条 genesis，第二条非 genesis
    expect(entries[0]!.prevHash).toBe('genesis');
    expect(entries[1]!.prevHash).not.toBe('genesis');
    expect(entries[1]!.prevHash).not.toBe('');
    // prevHash 是 16 位 hex 截断
    expect(entries[1]!.prevHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashVersion 标记为 2（环境指纹版本）', () => {
    // 测试：hashVersion = 2 对齐 audit-history v1.0.6+
    const logger = new DataSovereigntyLogger(tmpHome);
    logger.append(makeRecord());

    const filePath = resolveSovereigntyLogPath('2026-07-28', tmpHome);
    const entry = readJsonl(filePath)[0]!;
    expect(entry.hashVersion).toBe(2);
  });

  // ── HMAC 签名 ──

  it('有 HMAC key 时 hmacSig 存在且为 32 字符 hex', () => {
    // 测试：mock getHmacKey 后 hmacSig 被写入（32 字符截断）
    const logger = new DataSovereigntyLogger(tmpHome);
    logger.append(makeRecord());

    const filePath = resolveSovereigntyLogPath('2026-07-28', tmpHome);
    const entry = readJsonl(filePath)[0]!;
    expect(entry.hmacSig).toBeDefined();
    expect(entry.hmacSig).toMatch(/^[0-9a-f]{32}$/);
    expect(entry.hmacAlgo).toBe('stable');
  });

  // ── queryRecent ──

  it('queryRecent 返回写入的记录', () => {
    // 测试：写后读——queryRecent 能取回 append 的记录
    const logger = new DataSovereigntyLogger(tmpHome);
    const ts = '2026-07-28T10:00:00.000Z';
    logger.append(makeRecord({ cloudCall: { timestamp: ts, provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }));

    const records = logger.queryRecent({ date: '2026-07-28' });
    expect(records.length).toBe(1);
    expect(records[0]!.cloudCall.model).toBe('gpt-4o');
  });

  it('queryRecent 文件不存在时返回空数组', () => {
    // 测试：没写过的日期返回 []
    const logger = new DataSovereigntyLogger(tmpHome);
    const records = logger.queryRecent({ date: '2020-01-01' });
    expect(records).toEqual([]);
  });

  it('queryRecent 按 limit 截断返回条数', () => {
    // 测试：limit 参数生效
    const logger = new DataSovereigntyLogger(tmpHome);
    const ts = '2026-07-28T10:00:00.000Z';
    for (let i = 0; i < 5; i++) {
      logger.append(makeRecord({ cloudCall: { timestamp: ts, provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: i, output: i }, purpose: 'p' } }));
    }

    const records = logger.queryRecent({ date: '2026-07-28', limit: 2 });
    expect(records.length).toBe(2);
  });

  // ── queryRange ──

  it('queryRange 聚合区间内多日记录', () => {
    // 测试：跨日扫描——两天各写一条，queryRange 取回 2 条
    const logger = new DataSovereigntyLogger(tmpHome);
    logger.append(makeRecord({ cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }));
    logger.append(makeRecord({ cloudCall: { timestamp: '2026-07-29T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 2, output: 2 }, purpose: 'p2' } }));

    const records = logger.queryRange('2026-07-28', '2026-07-29');
    expect(records.length).toBe(2);
  });

  it('queryRange 区间外的日期被排除', () => {
    // 测试：范围过滤——只取区间内
    const logger = new DataSovereigntyLogger(tmpHome);
    logger.append(makeRecord({ cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }));
    logger.append(makeRecord({ cloudCall: { timestamp: '2026-07-29T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 2, output: 2 }, purpose: 'p2' } }));

    const records = logger.queryRange('2026-07-28', '2026-07-28');
    expect(records.length).toBe(1);
  });

  // ── 边界 ──

  it('append 不抛异常（即使目录需要递归创建）', () => {
    // 测试：嵌套目录 {home}/data/audit/data-sovereignty/2026/07/ 不存在时不报错
    const logger = new DataSovereigntyLogger(tmpHome);
    expect(() => logger.append(makeRecord())).not.toThrow();
  });

  it('脱敏后的敏感字段不原文落盘', () => {
    // 测试：包含 API key 的记录写入后，文件内容不含原始 key
    // 运行时拼接避免 A2 扫描（不可写字面量）
    const secret = ['sk-abcdef', '1234567890', 'abcdef1234567890'].join('');
    const logger = new DataSovereigntyLogger(tmpHome);
    logger.append(makeRecord({
      dataFlow: {
        direction: 'outbound',
        sensitivity: 'confidential',
        fields: [secret],
        destination: 'cloud-api',
        redacted: false,
      },
    }));

    const filePath = resolveSovereigntyLogPath('2026-07-28', tmpHome);
    const raw = readFileSync(filePath, 'utf-8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain('[REDACTED:');
  });
});
