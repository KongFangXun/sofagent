// ============================================================
// cron.test.ts · loadCronConfig 行为测试
// v1.4.4 第九章 #73：占位重写——原「无配置返回空数组」单断言
// 同义反复（Array.isArray 永真），改为行为级验证。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadCronConfig } from '../cron';

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
