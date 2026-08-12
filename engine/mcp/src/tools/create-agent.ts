// ============================================================
// create-agent.ts · MCP tool：agent-creation 一句话建节点（v1.3.3 交付 5）
// ============================================================
//
// create_agent({ requirement })
//   → deriveAgentFromRequirement(requirement)
//   → derived: 生成 think.md + knowledge 配置 + 验证清单
//   → needs_clarification: 返回追问问题
//
// 规则驱动 NLP（不是 LLM）——需求够具体就不追问。
// ============================================================

// ============================================================
// 类型定义
// ============================================================

export interface CreateAgentArgs {
  /** 一句话需求（如「回答金融合规问题的专家」） */
  requirement: string;
  /** 可选：落盘到指定 Agent 目录（默认不落盘，只返回配置） */
  targetDir?: string;
}

export interface CreateAgentResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    status: 'derived' | 'needs_clarification';
    agentName?: string;
    thinkMd?: string;
    matchedKnowledge?: string[];
    thinkingLevel?: string;
    clarifyingQuestions?: string[];
    validationErrors?: string[];
    isError: boolean;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 一句话需求 → 自动推导 Agent 配置。
 *
 * @param args 参数
 * @returns 结构化结果（text + data）
 */
export async function createAgent(args: CreateAgentArgs): Promise<CreateAgentResult> {
  if (!args.requirement || args.requirement.trim().length === 0) {
    return {
      text: '[sofagent] create_agent 错误: requirement 必填',
      data: { status: 'needs_clarification', isError: true },
    };
  }

  try {
    const { deriveAgentFromRequirement } = await import('@sofagent/orchestrator');
    const { validateAgentCreation, checkNoModelPersistence } = await import('@sofagent/orchestrator');

    const creation = deriveAgentFromRequirement(args.requirement);

    if (creation.status === 'needs_clarification') {
      return {
        text: [
          '[sofagent] create_agent: 需求太泛，无法自动推导——请补充以下信息：',
          ...(creation.clarifyingQuestions ?? []),
        ].join('\n'),
        data: {
          status: 'needs_clarification',
          clarifyingQuestions: creation.clarifyingQuestions,
          isError: false,
        },
      };
    }

    const config = creation.config!;

    // 验证清单
    const validation = validateAgentCreation(config);
    const modelViolation = checkNoModelPersistence(config);

    if (!validation.passed || modelViolation) {
      const allErrors = [...validation.errors];
      if (modelViolation) {
        allErrors.push('违反铁律：think.md 中含 provider/model_id 硬编码（应只写 thinking_level）');
      }
      return {
        text: `[sofagent] create_agent: 验证未通过\n${allErrors.map((e) => `  ✗ ${e}`).join('\n')}`,
        data: {
          status: 'derived',
          agentName: config.name,
          validationErrors: allErrors,
          isError: true,
        },
      };
    }

    // 可选落盘
    let savedPath: string | undefined;
    if (args.targetDir) {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      mkdirSync(args.targetDir, { recursive: true });
      savedPath = join(args.targetDir, 'think.md');
      writeFileSync(savedPath, config.thinkMd, 'utf-8');
    }

    const lines = [
      `[sofagent] create_agent: 成功推导 Agent「${config.name}」`,
      `  角色：${config.role}`,
      `  领域：${config.domain} · 动作：${config.action}`,
      ...(config.inputType ? [`  输入：${config.inputType}`] : []),
      ...(config.outputType ? [`  输出：${config.outputType}`] : []),
      `  thinking_level：${config.thinkingLevel}（唯一持久化的运行时参数）`,
      `  匹配 knowledge：${config.matchedKnowledge.length > 0 ? config.matchedKnowledge.join(', ') : '（无）'}`,
      ...(savedPath ? [`  think.md 已落盘：${savedPath}`] : []),
      ...(validation.warnings.length > 0 ? validation.warnings.map((w) => `  ⚠️ ${w}`) : []),
    ];

    return {
      text: lines.join('\n'),
      data: {
        status: 'derived',
        agentName: config.name,
        thinkMd: config.thinkMd,
        matchedKnowledge: config.matchedKnowledge,
        thinkingLevel: config.thinkingLevel,
        isError: false,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] create_agent 失败：${err instanceof Error ? err.message : String(err)}`,
      data: { status: 'needs_clarification', isError: true },
    };
  }
}
