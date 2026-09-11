// ============================================================
// model-preference.test.ts · 偏好生效/未配置默认/未注册报错（v1.4.8 第八章）
// ============================================================
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseWorkflowYaml } from '../workflow-parser';
import {
  resolveNodeModelPreference,
  resolveWorkflowModelPreferences,
  ModelPreferenceError,
} from '../model-resolver';

const TMP = path.join(os.tmpdir(), `sofagent-model-pref-${process.pid}`);
const REGISTRY = {
  version: 1,
  models: {
    'deepseek-v4-flash': {
      name: 'deepseek-v4-flash',
      endpoint: 'https://api.deepseek.com/v1',
      clientType: 'openai-compatible' as const,
      model: 'deepseek-v4-flash',
      source: 'endpoint' as const,
      status: 'active' as const,
      registeredAt: '2026-09-12T00:00:00Z',
    },
    'glm-5.3': {
      name: 'glm-5.3',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4',
      clientType: 'openai-compatible' as const,
      model: 'glm-5.3',
      source: 'endpoint' as const,
      status: 'active' as const,
      registeredAt: '2026-09-12T00:00:00Z',
    },
  },
};

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TMP, 'config'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'config', 'model-registry.json'), JSON.stringify(REGISTRY));
});
afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('第八章 · modelPreference 解析层承接', () => {
  it('YAML 节点带 modelPreference → ParsedWorkflow 承接', () => {
    const wf = parseWorkflowYaml(`workflow:
  name: t
  description: test
  nodes:
    - id: n1
      agent: developer
      task: 简单任务
    - id: n2
      agent: developer
      task: 复杂任务
      modelPreference:
        provider: glm
        model: glm-5.3
        priority: required
`);
    const n2 = wf.nodes.find((n) => n.id === 'n2');
    expect(n2?.modelPreference).toBeDefined();
    expect(n2?.modelPreference?.model).toBe('glm-5.3');
    expect(n2?.modelPreference?.priority).toBe('required');
    // 未配置节点不带字段
    const n1 = wf.nodes.find((n) => n.id === 'n1');
    expect(n1?.modelPreference).toBeUndefined();
  });
});

describe('第八章 · model-resolver（偏好/默认/未注册三态）', () => {
  it('未配置偏好 → resolved=false（走默认模型，现行为不变）', () => {
    const r = resolveNodeModelPreference('n1', undefined, TMP);
    expect(r.resolved).toBe(false);
  });

  it('偏好命中注册表 → resolved 且带 entry（节点级偏好生效）', () => {
    const r = resolveNodeModelPreference('n2', { provider: 'glm', model: 'glm-5.3' }, TMP);
    expect(r.resolved).toBe(true);
    if (r.resolved) expect(r.entry.name).toBe('glm-5.3');
  });

  it('未注册模型 → 抛 ModelPreferenceError（不静默降级）', () => {
    expect(() => resolveNodeModelPreference('n2', { model: 'gpt-99-ultra' }, TMP)).toThrow(ModelPreferenceError);
    try {
      resolveNodeModelPreference('n2', { model: 'gpt-99-ultra' }, TMP);
    } catch (e) {
      expect((e as ModelPreferenceError).message).toContain('未在注册表注册');
      expect((e as ModelPreferenceError).message).toContain('不静默降级');
    }
  });

  it('provider 属展示性标注——不符不阻断（注册表以 name 唯一）', () => {
    const r = resolveNodeModelPreference('n2', { provider: 'other', model: 'glm-5.3' }, TMP);
    expect(r.resolved).toBe(true);
  });

  it('批量解析——同 workflow 不同节点不同模型（偏好生效核心场景）', () => {
    const wf = parseWorkflowYaml(`workflow:
  name: mixed
  description: 混合模型
  nodes:
    - id: cheap-node
      agent: developer
      task: 常规
      modelPreference:
        model: deepseek-v4-flash
    - id: premium-node
      agent: developer
      task: 关键
      modelPreference:
        model: glm-5.3
`);
    const resolved = resolveWorkflowModelPreferences(wf.nodes, TMP);
    expect(resolved.get('cheap-node')?.name).toBe('deepseek-v4-flash');
    expect(resolved.get('premium-node')?.name).toBe('glm-5.3');
    expect(resolved.size).toBe(2);
  });

  it('无偏好节点批量解析 → 空表（零开销）', () => {
    const wf = parseWorkflowYaml(`workflow:
  name: plain
  description: 默认
  nodes:
    - id: n1
      agent: developer
      task: t
`);
    expect(resolveWorkflowModelPreferences(wf.nodes, TMP).size).toBe(0);
  });
});
