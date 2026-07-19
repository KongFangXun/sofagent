// ============================================================
// cli-args-mode.test.ts · 审-8 单元测试
// 验证 subagent run 的 --mode <deploy|sustain> 解析
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseSubagentRunArgs } from '../cli-args';

describe('parseSubagentRunArgs · --mode 解析（审-8）', () => {
  it('不传 --mode 时默认 deploy（向后兼容 v1.1.4）', () => {
    const result = parseSubagentRunArgs(['fde', '--task', '部署 AI 节点']);
    expect(result.agentName).toBe('fde');
    expect(result.task).toBe('部署 AI 节点');
    expect(result.mode).toBe('deploy');
  });

  it('传 --mode sustain 时返回 sustain', () => {
    const result = parseSubagentRunArgs([
      'fde',
      '--mode',
      'sustain',
      '--task',
      '巡检所有节点',
    ]);
    expect(result.agentName).toBe('fde');
    expect(result.task).toBe('巡检所有节点');
    expect(result.mode).toBe('sustain');
  });

  it('传 --mode deploy 时返回 deploy（显式声明）', () => {
    const result = parseSubagentRunArgs([
      'engineer',
      '--mode',
      'deploy',
      '--task',
      '修复 bug',
    ]);
    expect(result.mode).toBe('deploy');
  });

  it('传非法 --mode 值时报错', () => {
    expect(() =>
      parseSubagentRunArgs(['fde', '--mode', 'invalid', '--task', 'x'])
    ).toThrow(/--mode 仅支持 deploy \| sustain/);
  });

  it('--mode 缺值时按非法处理（视为 undefined）', () => {
    expect(() =>
      parseSubagentRunArgs(['fde', '--mode', '--task', 'x'])
    ).toThrow(/--mode 仅支持 deploy \| sustain/);
  });

  it('缺 --task 时报错', () => {
    expect(() => parseSubagentRunArgs(['fde'])).toThrow(/--task/);
  });

  it('缺 agentName 时报错', () => {
    expect(() => parseSubagentRunArgs([])).toThrow(/<name>/);
  });
});
