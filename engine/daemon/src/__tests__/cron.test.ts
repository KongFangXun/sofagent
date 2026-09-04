// ============================================================
// cron.test.ts · loadCronConfig 行为测试
// v1.4.4 第九章 #73：占位重写——原「无配置返回空数组」单断言
// 同义反复（Array.isArray 永真），改为行为级验证。
// v1.4.5 T1/T2 新增：inspectors: 段 / dream-cycle: 段解析 + 调度接线。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadCronConfig,
  loadInspectorsConfig,
  loadDreamCycleConfig,
  buildInspectorScheduleReport,
  ensureDefaultInspectorsConfig,
  recordInspectorSuccess,
} from '../cron';
import { LAYER_SCHEDULE } from '../inspector-layers';

describe('loadCronConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cron-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  const writeWatch = (content: string) => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), content, 'utf-8');
  };

  it('watch.yml 不存在时返回空数组', () => {
    const result = loadCronConfig(tmpDir);
    expect(result).toEqual([]);
  });

  it('合法 cron 条目被解析并保留（含 ab-schedule 配置透传）', () => {
    writeWatch([
      'cron:',
      '  - schedule: "@daily"',
      '    task: daily-health',
      '  - schedule: "@weekly"',
      '    task: ab-schedule',
      '    config:',
      '      threshold: 5',
      '      variants: ["B-domain", "C-risk"]',
    ].join('\n'));
    const result = loadCronConfig(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ schedule: '@daily', task: 'daily-health' });
    // A/B 调度配置透传（v1.1.8 ab-schedule 分支的输入）
    expect(result[1]).toMatchObject({
      schedule: '@weekly',
      task: 'ab-schedule',
      config: { threshold: 5, variants: ['B-domain', 'C-risk'] },
    });
  });

  it('缺 task 或 schedule 的条目被过滤（运行时校验）', () => {
    writeWatch([
      'cron:',
      '  - schedule: "@daily"',
      '  - task: no-schedule',
      '  - schedule: "@hourly"',
      '    task: ok-task',
    ].join('\n'));
    const result = loadCronConfig(tmpDir);
    // 前两条缺必填字段被过滤，只留合法条目
    expect(result).toHaveLength(1);
    expect(result[0]?.task).toBe('ok-task');
  });

  it('坏 YAML（语法错误）返回空数组不抛错（fail-open）', () => {
    writeWatch('cron: [unclosed');
    expect(() => loadCronConfig(tmpDir)).not.toThrow();
    expect(loadCronConfig(tmpDir)).toEqual([]);
  });

  it('cron 段非数组（类型错误）返回空数组', () => {
    writeWatch('cron: "not-an-array"');
    expect(loadCronConfig(tmpDir)).toEqual([]);
  });
});

// ============================================================
// v1.4.5 T1（P0 方案 A 接线）：inspectors: 段解析
// ============================================================
describe('loadInspectorsConfig（v1.4.5 T1）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cron-insp-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  const writeWatch = (content: string) => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), content, 'utf-8');
  };

  it('test_loadInspectorsConfig_段缺失_返回默认启用配置', () => {
    // P0 修复本体：inspectors 段缺失 → 默认启用（零调度 bug 的修复语义）
    const config = loadInspectorsConfig(tmpDir);
    expect(config.enabled).toBe(true);
    // 各层频率与 LAYER_SCHEDULE 对齐（L1=@daily / L2=@weekly / L3=@monthly）
    expect(config.layers.L1).toBe(LAYER_SCHEDULE.L1);
    expect(config.layers.L2).toBe(LAYER_SCHEDULE.L2);
    expect(config.layers.L3).toBe(LAYER_SCHEDULE.L3);
  });

  it('test_loadInspectorsConfig_显式enabledFalse_返回禁用', () => {
    writeWatch('inspectors:\n  enabled: false\n');
    const config = loadInspectorsConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });

  it('test_loadInspectorsConfig_显式覆盖层频率_返回覆盖值', () => {
    writeWatch([
      'inspectors:',
      '  enabled: true',
      '  layers:',
      '    L1: "@daily"',
      '    L2: "@daily"',
      '    L3: "@weekly"',
    ].join('\n'));
    const config = loadInspectorsConfig(tmpDir);
    expect(config.enabled).toBe(true);
    expect(config.layers.L2).toBe('@daily');  // 用户覆盖 @weekly → @daily
    expect(config.layers.L3).toBe('@weekly'); // 用户覆盖 @monthly → @weekly
  });

  it('test_loadInspectorsConfig_坏YAML_不抛错返回默认', () => {
    writeWatch('inspectors: [unclosed');
    expect(() => loadInspectorsConfig(tmpDir)).not.toThrow();
    expect(loadInspectorsConfig(tmpDir).enabled).toBe(true);
  });

  it('test_buildInspectorScheduleReport_默认配置_报告三层调度状态', () => {
    const report = buildInspectorScheduleReport(tmpDir);
    // 报告含每层频率 + enabled 总开关（--doctor 巡检调度状态展示用）
    expect(report.enabled).toBe(true);
    expect(report.layers).toHaveLength(3);
    expect(report.layers.map((l) => l.layer)).toEqual(['L1', 'L2', 'L3']);
    for (const layer of report.layers) {
      expect(layer.schedule).toBe(LAYER_SCHEDULE[layer.layer]);
      // 尚未执行过 → lastSuccessAt 为 null（doctor 据此提示「从未巡检」）
      expect(layer.lastSuccessAt).toBeNull();
    }
  });

  it('test_buildInspectorScheduleReport_已执行过_报告lastSuccessAt非空', () => {
    // 手动触发一次巡检成功 → health 记录 lastSuccessAt → 报告可见
    recordInspectorSuccess(tmpDir, 'L1');
    const report = buildInspectorScheduleReport(tmpDir);
    const l1 = report.layers.find((l) => l.layer === 'L1');
    expect(l1?.lastSuccessAt).not.toBeNull();
    // 其他层不受影响
    const l2 = report.layers.find((l) => l.layer === 'L2');
    expect(l2?.lastSuccessAt).toBeNull();
  });

  it('test_ensureDefaultInspectorsConfig_首启无配置_写入缺省段落', () => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    const written = ensureDefaultInspectorsConfig(tmpDir);
    expect(written).toBe(true);
    const raw = fs.readFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), 'utf-8');
    // 写入的内容含 inspectors: 缺省段（enabled: true + 三层默认频率）
    expect(raw).toContain('inspectors:');
    expect(raw).toContain('enabled: true');
    // 落盘后再读——应解析回默认启用
    const config = loadInspectorsConfig(tmpDir);
    expect(config.enabled).toBe(true);
  });

  it('test_ensureDefaultInspectorsConfig_已有watchYml_不覆盖用户配置', () => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.sofagent', 'watch.yml'),
      'inspectors:\n  enabled: false\n',
      'utf-8',
    );
    const written = ensureDefaultInspectorsConfig(tmpDir);
    expect(written).toBe(false); // 已有配置 → 不动
    const raw = fs.readFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), 'utf-8');
    expect(raw).toContain('enabled: false'); // 用户禁用语义保留
  });
});

// ============================================================
// v1.4.5 T2（P0）：dream-cycle: 段解析
// ============================================================
describe('loadDreamCycleConfig（v1.4.5 T2）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cron-dream-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  const writeWatch = (content: string) => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), content, 'utf-8');
  };

  it('test_loadDreamCycleConfig_段缺失_返回默认每日启用', () => {
    // P0 修复本体：dream-cycle 段缺失 → 默认 @daily 启用（零触发 bug 的修复语义）
    const config = loadDreamCycleConfig(tmpDir);
    expect(config.enabled).toBe(true);
    expect(config.schedule).toBe('@daily');
  });

  it('test_loadDreamCycleConfig_显式enabledFalse_返回禁用', () => {
    writeWatch('dream-cycle:\n  enabled: false\n');
    const config = loadDreamCycleConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });

  it('test_loadDreamCycleConfig_显式weekly_返回覆盖值', () => {
    writeWatch('dream-cycle:\n  enabled: true\n  schedule: "@weekly"\n');
    const config = loadDreamCycleConfig(tmpDir);
    expect(config.schedule).toBe('@weekly');
  });

  it('test_loadDreamCycleConfig_坏YAML_不抛错返回默认', () => {
    writeWatch('dream-cycle: [unclosed');
    expect(() => loadDreamCycleConfig(tmpDir)).not.toThrow();
    expect(loadDreamCycleConfig(tmpDir).enabled).toBe(true);
  });
});
