// ============================================================
// agent-creation.test.ts · agent-creation 需求推导 + 验证测试（v1.3.2 交付 5）
// ============================================================
//
// 覆盖验收关键边界样例：
//   ✅「回答金融合规问题的专家」→ 能推导（不追问）
//   ✅「把 PDF 发票转成结构化数据的节点」→ 能推导（不追问）
//   ❌「一个有用的助手」→ 追问（缺领域边界）
//   ❌「帮我处理订单」→ 追问（"处理"太泛）
// ============================================================

import { describe, it, expect } from 'vitest';
import { deriveAgentFromRequirement } from '../onboard/agent-creator';
import { validateAgentCreation, checkNoModelPersistence } from '../onboard/creation-validator';

describe('交付 5 agent-creation · 需求推导边界样例', () => {
  // ✅ 能推导的样例
  describe('✅ 需求够具体 → 能推导（不追问）', () => {
    it('「回答金融合规问题的专家」→ 能推导', () => {
      const result = deriveAgentFromRequirement('回答金融合规问题的专家');
      expect(result.status).toBe('derived');
      expect(result.config).toBeDefined();
      expect(result.config!.domain).toBe('finance');
      expect(result.config!.action).toBe('answer');
      // 不追问
      expect(result.clarifyingQuestions).toBeUndefined();
    });

    it('「把 PDF 发票转成结构化数据的节点」→ 能推导', () => {
      const result = deriveAgentFromRequirement('把 PDF 发票转成结构化数据的节点');
      expect(result.status).toBe('derived');
      expect(result.config).toBeDefined();
      expect(result.config!.action).toBe('transform');
      expect(result.config!.inputType).toContain('PDF');
      expect(result.config!.outputType).toContain('结构化');
    });

    it('「分析制造产线质量数据的专家」→ 能推导', () => {
      const result = deriveAgentFromRequirement('分析制造产线质量数据的专家');
      expect(result.status).toBe('derived');
      expect(result.config!.domain).toBe('manufacturing');
      expect(result.config!.action).toBe('analyze');
    });

    it('「审查供应链合同合规性的节点」→ 能推导', () => {
      const result = deriveAgentFromRequirement('审查供应链合同合规性的节点');
      expect(result.status).toBe('derived');
      expect(result.config!.action).toBe('review');
    });
  });

  // ❌ 需要追问的样例
  describe('❌ 需求太泛 → 追问', () => {
    it('「一个有用的助手」→ 追问（缺领域边界）', () => {
      const result = deriveAgentFromRequirement('一个有用的助手');
      expect(result.status).toBe('needs_clarification');
      expect(result.clarifyingQuestions).toBeDefined();
      expect(result.clarifyingQuestions!.length).toBeGreaterThan(0);
    });

    it('「帮我处理订单」→ 追问（"处理"太泛）', () => {
      const result = deriveAgentFromRequirement('帮我处理订单');
      expect(result.status).toBe('needs_clarification');
      expect(result.clarifyingQuestions).toBeDefined();
      // 追问应提到"处理"太泛
      const allQuestions = result.clarifyingQuestions!.join(' ');
      expect(allQuestions).toContain('处理');
    });

    it('空需求 → 追问', () => {
      const result = deriveAgentFromRequirement('');
      expect(result.status).toBe('needs_clarification');
    });
  });
});

describe('交付 5 agent-creation · 推导配置完整性', () => {
  it('推导结果含 think.md（非空）', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    expect(result.config!.thinkMd).toBeDefined();
    expect(result.config!.thinkMd.length).toBeGreaterThan(0);
    expect(result.config!.thinkMd).toContain('# ');
  });

  it('think.md 含角色 + 应做 + 禁止规则', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    const md = result.config!.thinkMd;
    expect(md).toContain('角色');
    expect(md).toContain('应做');
    expect(md).toContain('禁止');
  });

  it('推导结果含 inclusionRules + exclusionRules', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    expect(result.config!.inclusionRules.length).toBeGreaterThan(0);
    expect(result.config!.exclusionRules.length).toBeGreaterThan(0);
    // 拒绝规则应含「不回答金融合规领域以外的问题」
    const exclusionText = result.config!.exclusionRules.join(' ');
    expect(exclusionText).toContain('金融合规');
  });

  it('推导结果含 matchedKnowledge（按需安装）', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    expect(result.config!.matchedKnowledge.length).toBeGreaterThan(0);
    // 应含金融相关 knowledge
    expect(result.config!.matchedKnowledge.some((k) => k.includes('finance'))).toBe(true);
  });

  it('推导结果含 thinkingLevel（唯一持久化的运行时参数）', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    expect(result.config!.thinkingLevel).toBeDefined();
    expect(['low', 'medium', 'high']).toContain(result.config!.thinkingLevel);
  });

  it('think.md 不含 provider/model_id 硬编码（铁律）', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    const violation = checkNoModelPersistence(result.config!);
    expect(violation).toBe(false);
  });
});

describe('交付 5 agent-creation · 验证清单', () => {
  it('完整配置 → 验证通过', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    const validation = validateAgentCreation(result.config!);
    expect(validation.passed).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('think.md 为空 → 验证失败', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    result.config!.thinkMd = '';
    const validation = validateAgentCreation(result.config!);
    expect(validation.passed).toBe(false);
    expect(validation.errors.some((e) => e.includes('think.md'))).toBe(true);
  });

  it('thinkingLevel 为空 → 验证失败', () => {
    const result = deriveAgentFromRequirement('回答金融合规问题的专家');
    result.config!.thinkingLevel = '';
    const validation = validateAgentCreation(result.config!);
    expect(validation.passed).toBe(false);
    expect(validation.errors.some((e) => e.includes('thinkingLevel'))).toBe(true);
  });
});
