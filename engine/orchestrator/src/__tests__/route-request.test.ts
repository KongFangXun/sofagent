// ============================================================
// route-request.test.ts · 入口路由单测（v1.3.3 交付 T01）
// ============================================================

import { describe, it, expect } from 'vitest';
import { routeRequest } from '../route/route-request';
import type { ParsedWorkflow } from '../workflow-parser';

function makeWorkflow(nodes: Array<Partial<{ id: string; agent: string; task: string; type: 'loop' | 'auto' | 'manual'; hitl: boolean; depends_on: string[] }>>): ParsedWorkflow {
  return {
    name: 'test-workflow',
    description: '测试用 workflow',
    nodes: nodes.map((n, i) => ({
      id: n.id ?? `node-${i}`,
      agent: n.agent ?? 'developer',
      task: n.task ?? '默认任务',
      depends_on: n.depends_on ?? [],
      type: n.type ?? 'auto',
      hitl: n.hitl ?? false,
    })),
  };
}

describe('routeRequest', () => {
  it('请求命中 ⚡(auto) 节点 → route=workflow', () => {
    const wf = makeWorkflow([
      { id: 'report', agent: 'developer', task: '撰写财务分析报告', type: 'auto' },
      { id: 'review', agent: 'qa-engineer', task: '代码审查', type: 'auto' },
    ]);
    const result = routeRequest({ task: '帮我撰写财务分析', workflow: wf });
    expect(result.route).toBe('workflow');
    if (result.route === 'workflow') {
      expect(result.node.id).toBe('report');
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it('请求命中 🔄(loop) 节点 → route=workflow', () => {
    const wf = makeWorkflow([
      { id: 'onboard', agent: 'developer', task: 'Onboard Agent 循环收敛调试', type: 'loop' },
    ]);
    const result = routeRequest({ task: '帮我跑 Onboard 循环调试', workflow: wf });
    expect(result.route).toBe('workflow');
    if (result.route === 'workflow') {
      expect(result.node.id).toBe('onboard');
    }
  });

  it('请求不命中任何节点 → route=fallback', () => {
    const wf = makeWorkflow([
      { id: 'report', task: '撰写财务分析报告', type: 'auto' },
    ]);
    const result = routeRequest({ task: '今天天气怎么样', workflow: wf });
    expect(result.route).toBe('fallback');
    if (result.route === 'fallback') {
      expect(result.reason).toContain('未匹配');
    }
  });

  it('👤(manual) 节点不走自动路由 → 仅 manual 时 fallback', () => {
    const wf = makeWorkflow([
      { id: 'approve', task: '人工审批财务报告', type: 'manual' },
    ]);
    const result = routeRequest({ task: '审批财务报告', workflow: wf });
    // manual 节点被过滤，无候选 → fallback
    expect(result.route).toBe('fallback');
    if (result.route === 'fallback') {
      expect(result.reason).toContain('未匹配');
    }
  });

  it('manual + auto 混合 → 匹配 auto 节点不走 manual', () => {
    const wf = makeWorkflow([
      { id: 'approve', task: '审批财务报告', type: 'manual' },
      { id: 'generate', task: '生成财务报告', type: 'auto' },
    ]);
    const result = routeRequest({ task: '生成财务报告', workflow: wf });
    expect(result.route).toBe('workflow');
    if (result.route === 'workflow') {
      expect(result.node.id).toBe('generate');
    }
  });

  it('hitl=true 的节点不走自动路由', () => {
    const wf = makeWorkflow([
      { id: 'sensitive', task: '修改生产环境配置', type: 'auto', hitl: true },
    ]);
    const result = routeRequest({ task: '修改生产环境配置', workflow: wf });
    // hitl=true 被过滤 → fallback
    expect(result.route).toBe('fallback');
  });

  it('workflow 为空（无节点）→ route=fallback', () => {
    const wf: ParsedWorkflow = { name: 'empty', description: '', nodes: [] };
    const result = routeRequest({ task: '做点什么', workflow: wf });
    expect(result.route).toBe('fallback');
    if (result.route === 'fallback') {
      expect(result.reason).toContain('空');
    }
  });

  it('请求文本为空 → route=fallback', () => {
    const wf = makeWorkflow([{ id: 'n1', task: '任务', type: 'auto' }]);
    const result = routeRequest({ task: '', workflow: wf });
    expect(result.route).toBe('fallback');
    if (result.route === 'fallback') {
      expect(result.reason).toContain('空');
    }
  });

  it('多个匹配节点 → 取得分最高者', () => {
    const wf = makeWorkflow([
      { id: 'weak', task: '报告', type: 'auto' },
      { id: 'strong', task: '撰写季度财务分析报告并附图表', type: 'auto' },
    ]);
    const result = routeRequest({ task: '撰写季度财务分析报告', workflow: wf });
    expect(result.route).toBe('workflow');
    if (result.route === 'workflow') {
      // strong 节点 task 含更多匹配词，得分更高
      expect(result.node.id).toBe('strong');
    }
  });

  it('type=loop 节点可路由进 workflow（不因 type 被过滤）', () => {
    const wf = makeWorkflow([
      { id: 'refine', task: 'Refine Agent 质量优化循环', type: 'loop' },
    ]);
    const result = routeRequest({ task: '跑 Refine Agent 质量优化', workflow: wf });
    expect(result.route).toBe('workflow');
    if (result.route === 'workflow') {
      expect(result.node.type).toBe('loop');
    }
  });
});
