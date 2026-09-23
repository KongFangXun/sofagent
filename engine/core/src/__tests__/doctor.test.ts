// doctor.test.ts · 审计日志 hash chain 完整性校验（P0-② 安全修复的回归保护）
//
// v1.2.9: checkHistoryChainDetailed 下沉到 core（同包 ./audit-history），
// 消除 core → audit 反向依赖。vitest spyOn 作用在同一模块缓存实例，
// doctor.ts 内的动态 import('./audit-history') 与测试的静态 import 命中同一实例。
//
// FLAG-2 升级：doctor 改用 checkHistoryChainDetailed 区分
//   「篡改（红）」与「历史不可复验（黄，key/环境漂移）」。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import * as auditHistory from '../audit-history';
import { runDoctor, detectInstallShape, formatVersionRepairHint } from '../doctor';

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
// 跳过对账一致（合并逻辑跳过数与检查报告数一致）
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
    expect(out).toContain('跳过对账一致（合并逻辑跳过 1 = doctor 报告 1）');
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
    expect(out).toContain('跳过对账一致（合并逻辑跳过 1 = doctor 报告 1）');
  });

  it('坏样本③ relations 字段拼写错 → WARN 病因含「非法字段名」并列出非法键', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    // has_many 拼成 hasMany（YAML 本身合法，纯字段名错）
    writeFileSync(
      join(t.entitiesDir, 'bad-rel.md'),
      '---\ntitle: 测试实体\ntype: entity\nrelations:\n  hasMany: [其他实体]\n---\n正文\n',
      'utf-8',
    );
    writeSkipLog([]); // YAML 合法 → 合并逻辑不跳过此文件
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
    expect(out).toContain('跳过对账一致（合并逻辑跳过 0 = doctor 报告 0）');
  });

  it('对账不一致 → WARN 指向重新合并（跳过数 vs 报告数脱钩可发现）', () => {
    mkdirSync(t.entitiesDir, { recursive: true });
    writeFileSync(join(t.entitiesDir, 'x.md'), '---\ntitle: X\n---\n正文\n', 'utf-8');
    // 合并逻辑记了 2 条跳过，但 doctor 侧当前目录零问题 → 不一致
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

// ============================================================
// v1.4.9 P1-13 · 版本修复提示按安装形态分流
// ------------------------------------------------------------
// 缺陷：两条版本修复提示都把 `bash install.sh` 当唯一修法，而 npm 形态下该脚本
//   不在用户机器上（`npm pack --dry-run` 实测 @sofagent/audit tarball 188 文件、
//   install.sh 0 命中）——提示是死路。且 `~/.sofagent/VERSION` 全仓唯一写入点是
//   install.sh:403，npm 安装不产生该文件 ⇒「**重新**运行 install.sh」双重不成立。
// 锁点：① npm 形态提示不含 install.sh、给出 npm 升级命令与 VERSION 绝对路径；
//   ② 仓库形态保留原 install.sh 修法，且两条都给出 VERSION 绝对路径（原先缺）。
// ============================================================
describe('doctor 版本修复提示按安装形态分流（v1.4.9 P1-13）', () => {
  it('npm 形态：提示不含 install.sh，给出 npm 升级命令与 VERSION 绝对路径', () => {
    // 构造 npm 安装布局：<root>/node_modules/@sofagent/core/dist
    const tmpRoot = mkdtempSync(join(tmpdir(), 'sofagent-doctor-npm-'));
    const moduleDir = join(tmpRoot, 'node_modules', '@sofagent', 'core', 'dist');
    mkdirSync(moduleDir, { recursive: true });
    try {
      expect(detectInstallShape(moduleDir)).toBe('npm');

      const versionFile = join(tmpRoot, 'VERSION');
      const mismatch = formatVersionRepairHint('npm', 'mismatch', versionFile, '1.4.8');
      // 锁「可执行修法」而非裸子串：npm 提示里刻意保留「无 install.sh」这句解释
      // （用户看过旧提示会疑惑脚本去哪了），故断言点必须是 **bash install.sh** 这条命令。
      expect(mismatch).not.toContain('bash install.sh');
      expect(mismatch).toContain('npm i -g @sofagent/audit@1.4.8');
      expect(mismatch).toContain(versionFile);

      const missing = formatVersionRepairHint('npm', 'missing', versionFile, '1.4.8');
      expect(missing).not.toContain('bash install.sh');
      expect(missing).toContain(versionFile);
      expect(missing).toContain('1.4.8');
    } finally {
      try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('仓库形态：保留 bash install.sh 修法，且两条都给出 VERSION 具体路径', () => {
    // 真实运行形态：本测试在仓库内跑，doctor.ts 的默认 __dirname 不含 node_modules 段
    expect(detectInstallShape()).toBe('repo');
    expect(detectInstallShape('/repo/engine/core/dist')).toBe('repo');

    const versionFile = join('/repo', '.sofagent', 'VERSION');
    const mismatch = formatVersionRepairHint('repo', 'mismatch', versionFile, '1.4.8');
    expect(mismatch).toContain('bash install.sh');
    expect(mismatch).toContain(versionFile);

    const missing = formatVersionRepairHint('repo', 'missing', versionFile, '1.4.8');
    expect(missing).toContain('install.sh');
    // 本项新增：原先只说「创建 VERSION 文件」，不给路径
    expect(missing).toContain(versionFile);
  });
});

// ============================================================
// v1.5.1 E3 · commit-msg hook 完整性校验（子串匹配 → 三要素）
// ------------------------------------------------------------
// 改前缺陷：doctor 用 `hookContent.includes('sofagent')` 判「已安装」——把
//   commit-msg 换成三行空脚本（只要含一行 `# sofagent` 注释）就报「✅ 已安装」，
//   而 SECURITY.md 只声称「删除可检测」，未披露「替换不可检测」。
// 改后判据（三要素，与 check-template-drift.sh 的 hook 版本标记口径同源）：
//   ① sofagent 标记 ② 版本标记行 `# sofagent commit-msg hook vX.Y.Z` ③ 行为锚点
//   （`sofagent-audit` 调用 + `EXIT_CODE` 契约）。
// 三点探针：① 形态完备 hook → 已安装 ② 三行空脚本（含 # sofagent）→ 不再误报已安装
//   ③ 删除 hook → 未安装。
// ============================================================
describe('doctor commit-msg hook 完整性校验（v1.5.1 E3）', () => {
  const GIT_OK = (() => {
    try {
      execFileSync('git', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  })();

  let repo: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'doctor-e3-'));
    vi.stubEnv('SOFAGENT_HOME', tmpHome);
    vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', tmpdir());
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });
    repo = mkdtempSync(join(tmpdir(), 'doctor-e3-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  const out = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n');
  const hookPath = (): string => join(repo, '.git', 'hooks', 'commit-msg');

  it('探针① 形态完备 hook（标记 + 版本标记行 + 行为锚点）→ 已安装（含版本号回显，具备版本对账能力）', () => {
    writeFileSync(
      hookPath(),
      '#!/bin/bash\n# sofagent commit-msg hook v1.5.0\nsofagent-audit --commit-msg "$1"\nEXIT_CODE=$?\nexit $EXIT_CODE\n',
      'utf-8',
    );
    const r = runDoctor(repo);
    expect(out()).toContain('commit-msg hook 已安装');
    expect(out()).toContain('v1.5.0');
    expect(r.hook).toBe(true);
  });

  it('探针② 三行空脚本（只含 `# sofagent` 注释）→ **不再**误报「已安装」', () => {
    writeFileSync(hookPath(), '#!/bin/bash\n# sofagent\nexit 0\n', 'utf-8');
    const r = runDoctor(repo);
    expect(out()).not.toContain('commit-msg hook 已安装');
    expect(out()).toContain('commit-msg hook 不完整');
    expect(out()).toContain('版本标记行');
    expect(r.hook).toBe(false);
  });

  it('探针②b 有版本标记行但无行为锚点（替换为空壳）→ 同样不误报已安装', () => {
    writeFileSync(hookPath(), '#!/bin/bash\n# sofagent commit-msg hook v1.5.0\nexit 0\n', 'utf-8');
    const r = runDoctor(repo);
    expect(out()).not.toContain('commit-msg hook 已安装');
    expect(out()).toContain('行为锚点');
    expect(r.hook).toBe(false);
  });

  it('探针③ 删除 hook → 未安装', () => {
    rmSync(hookPath(), { force: true });
    const r = runDoctor(repo);
    expect(out()).toContain('commit-msg hook 未安装');
    expect(r.hook).toBe(false);
  });

  // v1.5.2 A-7：pre-commit / commit-msg 未安装升 fail（主防线缺失不该 exit 0）
  it('A-7 commit-msg 未安装 → FAIL（failCount ≥1，文案不变只升严重度）', () => {
    rmSync(hookPath(), { force: true });
    const r = runDoctor(repo);
    expect(out()).toContain('❌ commit-msg hook 未安装——审计不会运行');
    expect(r.failCount).toBeGreaterThanOrEqual(1);
    expect(r.allOk).toBe(false);
  });

  it('A-7 pre-commit 未安装 → FAIL（.sofagent/ 入库主防线缺失）', () => {
    writeFileSync(
      hookPath(),
      '#!/bin/bash\n# sofagent commit-msg hook v1.5.0\nsofagent-audit --commit-msg "$1"\nEXIT_CODE=$?\nexit $EXIT_CODE\n',
      'utf-8',
    );
    // commit-msg 完备、pre-commit 缺席 → hookOk=false 且 pre-commit 分支 fail
    const r = runDoctor(repo);
    expect(out()).toContain('❌ pre-commit hook 未安装——.sofagent/ 入库主防线缺失');
    expect(r.failCount).toBeGreaterThanOrEqual(1);
  });

  it('A-7 post-commit 未安装维持 WARN（事后对账非主防线，severity 不升）', () => {
    writeFileSync(
      hookPath(),
      '#!/bin/bash\n# sofagent commit-msg hook v1.5.0\nsofagent-audit --commit-msg "$1"\nEXIT_CODE=$?\nexit $EXIT_CODE\n',
      'utf-8',
    );
    writeFileSync(
      join(repo, '.git', 'hooks', 'pre-commit'),
      '#!/bin/bash\n# sofagent pre-commit guard\nsofagent marker\ngit reset\n.sofagent/\n',
      'utf-8',
    );
    const r = runDoctor(repo);
    expect(out()).toContain('⚠️  post-commit hook 未安装——绕过检测不可用');
    // post-commit 未装不产生 fail 项（本仓库其余检查全绿时 failCount 应为 0）
    expect(out()).not.toContain('❌ post-commit hook 未安装');
  });
});
