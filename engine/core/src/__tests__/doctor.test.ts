// doctor.test.ts · 审计日志 hash chain 完整性校验（P0-② 安全修复的回归保护）
//
// v1.2.9: checkHistoryChainIntegrity 下沉到 core（同包 ./audit-history），
// 消除 core → audit 反向依赖。vitest spyOn 作用在同一模块缓存实例，
// doctor.ts 内的动态 import('./audit-history') 与测试的静态 import 命中同一实例。
//
// FLAG-2 升级：doctor 改用 checkHistoryChainDetailed 区分
//   「篡改（红）」与「历史不可复验（黄，key/环境漂移）」。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as auditHistory from '../audit-history';
import { runDoctor } from '../doctor';

/**
 * v1.4.3 十三：Ontology 完整性检查测试的公共隔离装置。
 * 沙箱 HOME（SOFAGENT_HOME + 白名单前缀，对齐 doctor-reset-baseline.test.ts 先例）+
 * 链校验 mock（隔离 dist/审计噪音）+ console 静音（输出收集断言）。
 * knowledge/ 与 ontology/ 布局按用例需要搭建。
 */
function setupOntologyTest() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'doctor-ontology-'));
  vi.stubEnv('SOFAGENT_HOME', tmpHome);
  // v1.3.2 path-traversal 白名单：/tmp 不在默认白名单，不设会回退真实 ~/.sofagent
  vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', tmpdir());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });

  const entitiesDir = join(tmpHome, 'data', 'knowledge', 'entities');
  const ontologyDir = join(tmpHome, 'data', 'ontology');
  return {
    tmpHome,
    entitiesDir,
    ontologyDir,
    skipLogPath: join(ontologyDir, 'skip-log.json'),
    output: () => (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map((c) => String(c[0])).join('\n'),
    cleanup: () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

describe('doctor 审计日志链完整性校验', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'doctor-'));
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
    vi.restoreAllMocks();
  });

  it('链完整时 auditLog=true 且不被误判为失败', () => {
    const spy = vi
      .spyOn(auditHistory, 'checkHistoryChainDetailed')
      .mockReturnValue({ status: 'ok' });
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('篡改检测（红）：auditLog=false 且 allOk=false（P0-② 安全修复的回归保护）', () => {
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({
      status: 'tampered',
      index: 3,
      detail: '历史条目 3 HMAC 签名不匹配（hmacAlgo=stable），疑似内容被篡改',
    });
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(false);
    expect(r.allOk).toBe(false);
  });

  it('历史不可复验（黄）：auditLog=true 且 allOk=true，不误报为篡改（FLAG-2 修复）', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({
      status: 'unverifiable',
      detail: '部分历史段（v2 含环境指纹条目）因 ~/.sofagent-key 或环境指纹漂移无法复验',
    });
    const r = runDoctor(tmp);
    // 黄色提示：不判失败（auditLog 保持 true，即便其余检查在空 tmp 下不通过）
    expect(r.auditLog).toBe(true);
    // 输出应含「不可复验」但不含「篡改痕迹」
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('不可复验');
    expect(output).not.toContain('篡改痕迹');
    logSpy.mockRestore();
  });

  it('审计包调用抛错时降级不误报（catch 分支）', () => {
    vi
      .spyOn(auditHistory, 'checkHistoryChainDetailed')
      .mockImplementation(() => {
        throw new Error('no audit');
      });
    const r = runDoctor(tmp);
    // 保持默认 true，不误报篡改
    expect(r.auditLog).toBe(true);
  });

  // v1.3.9 五：VERSION 滞后提示补升级安全性一句——沙箱 HOME 模拟（不碰真实 ~/.sofagent）
  it('VERSION 滞后 → 输出含升级安全性说明（升级保留数据与 hooks）', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'sofagent-doctor-home-'));
    const savedHome = process.env.SOFAGENT_HOME;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.SOFAGENT_HOME = fakeHome;
      writeFileSync(join(fakeHome, 'VERSION'), '1.3.6\n', 'utf-8'); // 旧版本 → 触发滞后分支
      runDoctor(tmp);
      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('升级保留 ~/.sofagent/data/');
      expect(output).toContain('已装 hooks');
      expect(output).toContain('CHANGELOG');
    } finally {
      logSpy.mockRestore();
      if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
      else process.env.SOFAGENT_HOME = savedHome;
      try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});

// ============================================================
// v1.4.3 十三：Ontology 完整性检查
// 验收（changelog 原文）：坏样本三件逐一 WARN 病因准确 / 正常目录零误报 /
// 跳过对账一致（合并引擎跳过数与检查报告数一致）
// ============================================================
describe('doctor Ontology 完整性检查（v1.4.3 十三）', () => {
  let t: ReturnType<typeof setupOntologyTest>;

  beforeEach(() => { t = setupOntologyTest(); });
  afterEach(() => { t.cleanup(); });

  /** 写 skip-log.json（模拟 merge-engine 落盘） */
  function writeSkipLog(skipped: Array<{ file: string; reason: string }>, scanned = 4) {
    mkdirSync(t.ontologyDir, { recursive: true });
    writeFileSync(t.skipLogPath, JSON.stringify({ mergedAt: new Date().toISOString(), scanned, skipped }), 'utf-8');
  }

  it('坏样本① 缺 --- 分隔符 → WARN 病因含「缺少 frontmatter」且文件路径准确', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    writeFileSync(join(t.entitiesDir, 'no-fm.md'), '# 只有正文，没有 frontmatter\n\n正文内容。\n', 'utf-8');
    writeSkipLog([{ file: 'no-fm.md', reason: 'no-frontmatter' }]);
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('缺少 frontmatter');
    expect(out).toContain(join(t.entitiesDir, 'no-fm.md'));
    // repairHint 附模板样例与文档锚点
    expect(out).toContain('title:');
    expect(out).toContain('CHANGELOG v1.0.1');
    // 跳过对账一致（1 = 1）
    expect(out).toContain('跳过对账一致（合并引擎跳过 1 = doctor 报告 1）');
  });

  it('坏样本② frontmatter YAML 语法错误 → WARN 病因含「YAML 语法错误」', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    // 冒号后缺空格 + 未闭合引号 → js-yaml 抛错
    writeFileSync(join(t.entitiesDir, 'bad-yaml.md'), '---\ntitle: "未闭合\nbad: [a, b\n---\n正文\n', 'utf-8');
    writeSkipLog([{ file: 'bad-yaml.md', reason: 'yaml-error' }]);
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('YAML 语法错误');
    expect(out).toContain(join(t.entitiesDir, 'bad-yaml.md'));
    expect(out).toContain('跳过对账一致（合并引擎跳过 1 = doctor 报告 1）');
  });

  it('坏样本③ relations 字段拼写错 → WARN 病因含「非法字段名」并列出非法键', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    // has_many 拼成 hasMany（YAML 本身合法，纯字段名错）
    writeFileSync(
      join(t.entitiesDir, 'bad-rel.md'),
      '---\ntitle: 测试实体\ntype: entity\nrelations:\n  hasMany: [其他实体]\n---\n正文\n',
      'utf-8',
    );
    writeSkipLog([]); // YAML 合法 → 合并引擎不跳过此文件
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('非法字段名');
    expect(out).toContain('hasMany');
    expect(out).toContain(join(t.entitiesDir, 'bad-rel.md'));
    expect(out).toContain('has_many / belongs_to / depends_on / produces / consumes');
  });

  it('正常 entities/ 目录零误报 + 对账一致（0 = 0）', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    writeFileSync(
      join(t.entitiesDir, 'good.md'),
      '---\ntitle: 合规实体\ntype: entity\nrelations:\n  has_many: [A, B]\n  belongs_to: [父]\n---\n正文\n',
      'utf-8',
    );
    writeSkipLog([]);
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('Ontology 实体 frontmatter 全部合规');
    expect(out).not.toContain('非法字段名');
    expect(out).not.toContain('缺少 frontmatter');
    expect(out).not.toContain('YAML 语法错误');
    expect(out).toContain('跳过对账一致（合并引擎跳过 0 = doctor 报告 0）');
  });

  it('对账不一致 → WARN 指向重新合并（跳过数 vs 报告数脱钩可发现）', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    writeFileSync(join(t.entitiesDir, 'x.md'), '---\ntitle: X\n---\n正文\n', 'utf-8');
    // 合并引擎记了 2 条跳过，但 doctor 侧当前目录零问题 → 不一致
    writeSkipLog([{ file: 'gone-a.md', reason: 'yaml-error' }, { file: 'gone-b.md', reason: 'no-frontmatter' }]);
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('跳过对账不一致');
    expect(out).toContain('记录 2 条跳过');
    expect(out).toContain('doctor 本次报告 0 条');
    expect(out).toContain('sofagent-ontology merge');
  });

  it('entities/ 不存在 → info 跳过（全新安装正常形态，不告警）', () => {
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('knowledge/entities/ 目录不存在');
    expect(out).not.toContain('Ontology 实体');
  });
});

// ============================================================
// v1.4.4 #32+47：doctor 感知 daemon 守护死亡
// 验收（changelog 原文）：「daemon exit 78 可被 doctor 感知（心跳文件 + 检测路径在位）」
// core 不依赖 daemon 包（依赖方向 daemon → core），doctor 自读同源路径健康文件
// ============================================================
describe('doctor daemon 守护感知（v1.4.4 #32+47）', () => {
  let t: ReturnType<typeof setupOntologyTest>;

  beforeEach(() => { t = setupOntologyTest(); });
  afterEach(() => { t.cleanup(); });

  /** 在沙箱 DATA_DIR 写 daemon-health.json（doctor 侧同源路径：SOFAGENT_DATA || DATA_DIR） */
  function writeDaemonHealth(dataDir: string, health: Record<string, unknown>) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'daemon-health.json'), JSON.stringify(health), 'utf-8');
  }

  it('exit 78 + 心跳陈旧 → FAIL 报「守护已死亡」并给出重启修复提示', () => {
    const dataDir = join(t.tmpHome, 'data');
    writeDaemonHealth(dataDir, {
      pid: 1234,
      startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      version: '1.4.4',
      status: 'stopped',
      lastHeartbeat: new Date(Date.now() - 11 * 60 * 1000).toISOString(), // 心跳陈旧
      lastExitCode: 78,
      stoppedReason: 'uncaught-exception',
      lastPush: null,
      lastError: 'fatal',
      uptimeMs: 3600000,
    });
    const r = runDoctor(t.tmpHome);
    expect(r.failCount).toBeGreaterThanOrEqual(1);
    const out = t.output();
    expect(out).toContain('daemon 守护已死亡');
    expect(out).toContain('exit 78');
    expect(out).toContain('uncaught-exception');
    expect(out).toContain('sofagent-daemon start');
  });

  it('daemon 运行中（心跳新鲜）→ OK 零误报', () => {
    const dataDir = join(t.tmpHome, 'data');
    writeDaemonHealth(dataDir, {
      pid: 1234,
      startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      version: '1.4.4',
      status: 'running',
      lastHeartbeat: new Date().toISOString(), // 心跳新鲜
      lastExitCode: 78, // 残留上轮退出码——心跳新鲜不误报
      lastPush: null,
      lastError: null,
      uptimeMs: 300000,
    });
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('daemon 运行正常');
    expect(out).not.toContain('守护已死亡');
  });

  it('正常停止（exit 0，心跳陈旧）→ WARN 停止提示而非 FAIL 死亡', () => {
    const dataDir = join(t.tmpHome, 'data');
    writeDaemonHealth(dataDir, {
      pid: 1234,
      startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      version: '1.4.4',
      status: 'stopped',
      lastHeartbeat: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      lastExitCode: 0, // 正常停止
      lastPush: null,
      lastError: null,
      uptimeMs: 3600000,
    });
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('daemon 已停止运行');
    expect(out).not.toContain('守护已死亡');
  });

  it('daemon-health.json 不存在 → info 提示从未运行（不告警——审计核心不依赖守护）', () => {
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('daemon 从未运行过');
    expect(out).not.toContain('守护已死亡');
  });

  it('健康文件 JSON 损坏 → WARN 解析失败 + 重启覆盖修复提示（不崩 doctor）', () => {
    const dataDir = join(t.tmpHome, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'daemon-health.json'), '{corrupted', 'utf-8');
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('daemon-health.json 解析失败');
    expect(out).toContain('sofagent-daemon start');
  });
});
