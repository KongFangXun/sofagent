// ============================================================
// F46-F47.test.ts · watch 读链修复批（v1.5.7）行为锁
//
// F46：fs-watch 默认模板路径自省 + 0 目录告警三分支
//   一、自省排除口径：.git/node_modules/dist/build/隐藏目录被排除
//   二、自省回落：全部被排除 → ['.']（保底不空转）
//   三、自省只认目录：文件与符号链接异常项不进结果
// F47：cron 三段读侧全局层 fallback（项目级 → $SOFAGENT_HOME → 代码默认）
//   四、项目级缺 watch.yml → 全局层缺省段生效（首装模板不再断链）
//   五、项目级显式配置优先于全局层
//   六、项目级文件在但段缺失 → 不用全局层同段覆盖（「没写=别替我决定」）
//   七、坏 YAML（项目级）→ 尝试全局层（文件级故障不静默吞）
//   八、两层皆缺 → 代码默认（与既有缺省语义一致）
//   九、install.sh 首装模板四段被三读侧真实消费（段集合对齐的行为锁）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { introspectDefaultWatchPaths } from '../fs-watch';
import {
  loadInspectorsConfig,
  loadDreamCycleConfig,
  loadTrainArchiveCronConfig,
} from '../cron';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** install.sh 首装模板原文（F47 与 ensureDefaultInspectorsConfig 段集合对齐面） */
const INSTALL_TEMPLATE = `# sofagent 定时任务缺省配置（首装生成——可按需修改）
watch: {}

inspectors:
  enabled: true
  layers:
    L1: "@daily"
    L2: "@weekly"
    L3: "@monthly"

dream-cycle:
  enabled: true
  schedule: "@daily"

train-archive:
  enabled: true
  schedule: "@weekly"
  purge: true
  diskCheck: true
`;

// ============================================================
// F46：fs-watch 默认模板路径自省
// ============================================================
describe('F46 · introspectDefaultWatchPaths（默认模板路径自省）', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir('sof-f46-introspect-');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  /** 造一级目录 */
  const mk = (name: string): void => {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  };

  it('排除 .git / node_modules / dist / build / 隐藏目录，普通目录带尾斜杠收录', () => {
    for (const d of ['src', 'docs', '.git', '.github', '.sofagent', 'node_modules', 'dist', 'build']) mk(d);
    fs.writeFileSync(path.join(dir, 'README.md'), '# x\n'); // 文件不进结果
    const paths = introspectDefaultWatchPaths(dir);
    expect(paths).toEqual(['docs/', 'src/']); // 排除 + 尾斜杠 + 按名排序稳定
  });

  it('一级全部被排除 → 回落 ["."]（保底不空转）', () => {
    for (const d of ['.git', 'node_modules', 'dist', 'build']) mk(d);
    expect(introspectDefaultWatchPaths(dir)).toEqual(['.']);
  });

  it('项目根不可读（不存在）→ 回落 ["."] 不抛错', () => {
    expect(introspectDefaultWatchPaths(path.join(dir, 'no-such-dir'))).toEqual(['.']);
  });
});

// ============================================================
// F47：cron 三段读侧全局层 fallback
// ============================================================
describe('F47 · cron 三段读侧全局层 fallback（项目级 → $SOFAGENT_HOME → 代码默认）', () => {
  let projectDir: string;
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    projectDir = tmpDir('sof-f47-project-');
    home = tmpDir('sof-f47-home-');
    savedHome = process.env.SOFAGENT_HOME;
    process.env.SOFAGENT_HOME = home; // resolveWatchYmlPaths 全局层 = $SOFAGENT_HOME/watch.yml
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    for (const d of [projectDir, home]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  /** 写全局层 watch.yml（$SOFAGENT_HOME/watch.yml——install.sh 首装落点） */
  const writeGlobal = (content: string): void => {
    fs.writeFileSync(path.join(home, 'watch.yml'), content, 'utf-8');
  };

  /** 写项目级 watch.yml */
  const writeProject = (content: string): void => {
    fs.mkdirSync(path.join(projectDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.sofagent', 'watch.yml'), content, 'utf-8');
  };

  it('项目级缺 watch.yml → 全局层（install.sh 首装模板）缺省段生效', () => {
    writeGlobal(INSTALL_TEMPLATE);
    // inspectors：全局层缺省（enabled + L1/L2/L3 频率）
    const insp = loadInspectorsConfig(projectDir);
    expect(insp.enabled).toBe(true);
    expect(insp.layers).toEqual({ L1: '@daily', L2: '@weekly', L3: '@monthly' });
    // dream-cycle：全局层缺省 @daily 启用
    const dream = loadDreamCycleConfig(projectDir);
    expect(dream.enabled).toBe(true);
    expect(dream.schedule).toBe('@daily');
    // train-archive：全局层缺省 @weekly 启用（F47 补的段——此前断链）
    const train = loadTrainArchiveCronConfig(projectDir);
    expect(train.enabled).toBe(true);
    expect(train.schedule).toBe('@weekly');
  });

  it('项目级显式配置优先于全局层（覆盖频率与开关）', () => {
    writeGlobal(INSTALL_TEMPLATE);
    writeProject([
      'inspectors:',
      '  enabled: false',
      'dream-cycle:',
      '  enabled: true',
      '  schedule: "@monthly"',
    ].join('\n'));
    expect(loadInspectorsConfig(projectDir).enabled).toBe(false);
    expect(loadDreamCycleConfig(projectDir).schedule).toBe('@monthly');
  });

  it('项目级文件在但段缺失 → 不用全局层同段覆盖（「没写=别替我决定」）', () => {
    writeGlobal(INSTALL_TEMPLATE);
    // 项目级只写 dream-cycle 段——inspectors 段缺失走代码默认（非全局层值）
    writeProject('dream-cycle:\n  enabled: true\n  schedule: "@weekly"\n');
    const insp = loadInspectorsConfig(projectDir);
    expect(insp.enabled).toBe(true); // 代码默认（与全局层恰好同值——但 L3 可区分语义）
    // 更可区分的判据：全局层写非默认频率，项目级段缺失 → 仍是代码默认频率
    writeGlobal([
      'inspectors:',
      '  enabled: true',
      '  layers:',
      '    L1: "@monthly"',
      '    L2: "@monthly"',
      '    L3: "@monthly"',
      'dream-cycle:',
      '  enabled: true',
      '  schedule: "@daily"',
    ].join('\n'));
    const insp2 = loadInspectorsConfig(projectDir);
    expect(insp2.layers.L1).toBe('@daily'); // 代码默认（不是全局层的 @monthly）
  });

  it('项目级坏 YAML → 尝试全局层（文件级故障不静默吞）', () => {
    writeGlobal(INSTALL_TEMPLATE);
    writeProject('inspectors: [unclosed');
    // 项目级文件坏 → fallback 全局层：train-archive 段生效（F47 修复面）
    const train = loadTrainArchiveCronConfig(projectDir);
    expect(train.enabled).toBe(true);
    expect(train.schedule).toBe('@weekly');
  });

  it('两层皆缺 → 代码默认（与既有缺省语义一致）', () => {
    const insp = loadInspectorsConfig(projectDir);
    expect(insp.enabled).toBe(true);
    const dream = loadDreamCycleConfig(projectDir);
    expect(dream.schedule).toBe('@daily');
    const train = loadTrainArchiveCronConfig(projectDir);
    expect(train.schedule).toBe('@weekly');
  });

  it('全局层显式禁用被尊重（企业统一关闭巡检的语义）', () => {
    writeGlobal('watch: {}\ninspectors:\n  enabled: false\ndream-cycle:\n  enabled: false\n');
    expect(loadInspectorsConfig(projectDir).enabled).toBe(false);
    expect(loadDreamCycleConfig(projectDir).enabled).toBe(false);
  });
});
