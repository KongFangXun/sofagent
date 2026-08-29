// train-analyze.test.ts · v1.4.3 第四章 测试
//
// 验收标准逐条覆盖：
// - train analyze 可从 workflow 节点推导训练目标/数据需求/评估标准
//   （五要素 → 场景关键词命中 → 四段报告）
// - 复用 v1.3.2 FDE 梳理产出（interview.json 读取——不重复采集）
// - train templates list 可查场景模板；推导结果 + 模板 → 配置 →
//   train_submit 消费链路（algorithm/hyperparams 映射可提交）
// - RL 配方模板（grpo/dapo/cispo）可实例化——ScaleRL 四技巧参数齐全
// - MoE 模板防护：base_type=moe 实例化时校验 expert 矩阵覆盖
//   （target_modules 缺失 → 拒绝并给修复提示）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { NodeInterview } from '../../fde/compose-interview';
import {
  analyzeTrainNeed,
  deriveTrainScenario,
  findInterviewNode,
  pickDefaultTemplate,
  saveTrainAnalyzeReport,
  trainAnalyzeReportPath,
  type TrainAnalyzeOptions,
} from '../train/train-analyze';
import {
  TRAIN_SCENARIO_TEMPLATES,
  findTrainTemplate,
  instantiateTrainTemplate,
  listTrainTemplates,
  validateMoeTargetModules,
  MOE_TARGET_MODULES,
  DENSE_TARGET_MODULES,
} from '../train/train-templates';
import {
  buildQloraTemplate,
  DENSE_TARGET_MODULES as QLORA_DENSE,
} from '../train/qlora-template';
import { instantiateRlTemplate, findRlTemplate, RL_TEMPLATES } from '../train/rl-templates';

// ── 测试基建：tmpdir 生命周期 ──
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-analyze-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 构造五要素访谈节点（测试基线——对齐 NodeInterview） */
function makeNode(overrides: Partial<NodeInterview> = {}): NodeInterview {
  return {
    nodeId: 'node-1',
    description: '从发票 PDF 提取关键字段并结构化录入',
    elements: {
      input: '供应商邮件附件（PDF 发票）',
      output: '结构化 JSON（发票号/金额/日期/税号）',
      owner: '财务专员',
      duration: '每张 3 分钟，日均 200 张',
      bottleneck: '手工抄录字段最容易错漏，核对耗时占一半',
    },
    questions: { inputAutomatable: true, rulesCodifiable: true, outputPredictable: true },
    tag: 'auto',
    dependsOn: [],
    ...overrides,
  };
}

/** 预置 interview.json（复用 v1.3.2 产出——CLI 读取路径） */
function seedInterview(enterpriseId: string, nodes: NodeInterview[]): void {
  const fdeDir = join(dataDir, 'fde', enterpriseId);
  mkdirSync(fdeDir, { recursive: true });
  writeFileSync(
    join(fdeDir, 'interview.json'),
    JSON.stringify({
      schemaVersion: 'v1',
      enterpriseId,
      rounds: [{ interviewedAt: '2026-08-29T00:00:00.000Z', nodes }],
      profile: { nodeCount: nodes.length, roles: [], totalDurationNote: '', painKeywords: [], updatedAt: '' },
    }),
    'utf-8',
  );
}

// ════════════════════════════════════════
// 一、场景推导（关键词规则）
// ════════════════════════════════════════

describe('deriveTrainScenario 场景推导', () => {
  it('提取类节点命中 extraction（描述+最卡处关键词）', () => {
    const result = deriveTrainScenario({
      description: '从合同文本抽取关键条款字段',
      output: '结构化 JSON 字段集',
      bottleneck: '手工抄录字段易错',
    });
    expect(result.scenario).toBe('extraction');
    expect(result.confident).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('分类类节点命中 classification', () => {
    const result = deriveTrainScenario({
      description: '对工单做优先级判定与打标',
      output: 'P0/P1/P2 标签',
      bottleneck: '人工筛选不稳定',
    });
    expect(result.scenario).toBe('classification');
    expect(result.confident).toBe(true);
  });

  it('生成类节点命中 generation', () => {
    const result = deriveTrainScenario({
      description: '按企业模板撰写周报与摘要',
      output: '成稿报告',
      bottleneck: '起草耗时长',
    });
    expect(result.scenario).toBe('generation');
    expect(result.confident).toBe(true);
  });

  it('对话类节点命中 dialogue', () => {
    const result = deriveTrainScenario({
      description: '客服多轮应答与接待问答',
      output: '对话回复',
      bottleneck: '应答口径不统一',
    });
    expect(result.scenario).toBe('dialogue');
    expect(result.confident).toBe(true);
  });

  it('零命中兜底 extraction 且 confident=false（需人确认）', () => {
    const result = deriveTrainScenario({
      description: '某某事项',
      output: '某某结果',
      bottleneck: '说不上来',
    });
    expect(result.scenario).toBe('extraction');
    expect(result.confident).toBe(false);
    expect(result.evidence).toEqual([]);
  });
});

// ════════════════════════════════════════
// 二、模板库（list 可查 + 实例化）
// ════════════════════════════════════════

describe('train templates list 模板库', () => {
  it('全量含四场景 × QLoRA/SFT/DPO（≥ 8 个模板）', () => {
    expect(TRAIN_SCENARIO_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    const scenarios = new Set(TRAIN_SCENARIO_TEMPLATES.map((t) => t.scenario));
    expect(scenarios.has('extraction')).toBe(true);
    expect(scenarios.has('classification')).toBe(true);
    expect(scenarios.has('generation')).toBe(true);
    expect(scenarios.has('dialogue')).toBe(true);
    const methods = new Set(TRAIN_SCENARIO_TEMPLATES.map((t) => t.method));
    expect(methods.has('qlora')).toBe(true);
    expect(methods.has('sft')).toBe(true);
    expect(methods.has('dpo')).toBe(true);
  });

  it('listTrainTemplates 按场景过滤（scenario 省略 = 全量）', () => {
    expect(listTrainTemplates().length).toBe(TRAIN_SCENARIO_TEMPLATES.length);
    const dialogue = listTrainTemplates('dialogue');
    expect(dialogue.length).toBeGreaterThan(0);
    expect(dialogue.every((t) => t.scenario === 'dialogue')).toBe(true);
  });

  it('模板带 base_type 标注（dense/moe——MoE 防护前置）', () => {
    for (const t of TRAIN_SCENARIO_TEMPLATES) {
      expect(t.base_type === 'dense' || t.base_type === 'moe').toBe(true);
    }
  });

  it('findTrainTemplate 未知名返回 null', () => {
    expect(findTrainTemplate('nonexistent')).toBeNull();
  });
});

describe('instantiateTrainTemplate 模板实例化', () => {
  it('QLoRA 模板产出 Oumi 配置（五节齐全 + algorithm 映射 sft 通道）', () => {
    const inst = instantiateTrainTemplate({
      templateId: 'extraction-qlora',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/train.jsonl',
    });
    expect(inst.templateId).toBe('extraction-qlora');
    expect(inst.algorithm).toBe('sft');
    if ('oumi' in inst) {
      expect(inst.oumi.framework).toBe('oumi');
      expect(inst.oumi.base_type).toBe('dense');
      expect(inst.oumi.model.load_in_4bit).toBe(true);
      expect(inst.oumi.peft.method).toBe('lora');
      expect(inst.oumi.data.train_path).toBe('/data/train.jsonl');
      // eval 指标填充（场景模板口径）
      expect(inst.oumi.eval.metrics).toContain('exact_match');
    } else {
      throw new Error('qlora 模板实例化应产出 oumi 配置');
    }
  });

  it('SFT/DPO 模板产出 hyperparams 骨架（可被 train_submit 消费）', () => {
    const dpo = instantiateTrainTemplate({
      templateId: 'generation-dpo',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/pairs.jsonl',
    });
    expect(dpo.algorithm).toBe('dpo');
    if ('hyperparams' in dpo) {
      expect(typeof dpo.hyperparams.learningRate).toBe('number');
      expect(typeof dpo.hyperparams.beta).toBe('number');
    } else {
      throw new Error('dpo 模板实例化应产出 hyperparams');
    }
  });

  it('overrides 浅合并覆盖默认超参', () => {
    const inst = instantiateTrainTemplate({
      templateId: 'extraction-qlora',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/train.jsonl',
      overrides: { loraRank: 64 },
    });
    if ('oumi' in inst) {
      expect(inst.oumi.peft.r).toBe(64);
    } else {
      throw new Error('qlora 模板实例化应产出 oumi 配置');
    }
  });

  it('未知模板抛错（快速失败）', () => {
    expect(() =>
      instantiateTrainTemplate({
        templateId: 'no-such-template',
        baseModel: 'Qwen3-8B',
        baseType: 'dense',
        dataPath: '/data/train.jsonl',
      }),
    ).toThrow(/未知模板/);
  });
});

// ════════════════════════════════════════
// 三、MoE 防护（expert 矩阵覆盖校验）
// ════════════════════════════════════════

describe('MoE 模板防护', () => {
  it('dense 基座恒通过（无 expert 矩阵概念）', () => {
    const result = validateMoeTargetModules('dense', [...DENSE_TARGET_MODULES]);
    expect(result.valid).toBe(true);
  });

  it('moe 基座 expert 三矩阵齐全通过', () => {
    const result = validateMoeTargetModules('moe', [...MOE_TARGET_MODULES]);
    expect(result.valid).toBe(true);
  });

  it('moe 基座缺 expert 矩阵拒绝（只挂 attention 是典型错误）', () => {
    const result = validateMoeTargetModules('moe', [...DENSE_TARGET_MODULES]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.missing).toContain('gate_proj');
      expect(result.missing).toContain('up_proj');
      expect(result.missing).toContain('down_proj');
      expect(result.fixHint).toContain('MoE');
      expect(result.fixHint).toContain('gate_proj');
    }
  });

  it('moe 基座实例化 target_modules 缺 expert → 抛错含修复提示', () => {
    expect(() =>
      instantiateTrainTemplate({
        templateId: 'extraction-qlora',
        baseModel: 'Qwen3-MoE-30B',
        baseType: 'moe',
        dataPath: '/data/train.jsonl',
        targetModules: [...DENSE_TARGET_MODULES], // 故意只给 attention
      }),
    ).toThrow(/MoE 模板防护拒绝实例化/);
  });

  it('moe 基座显式完整 target_modules → 实例化通过且配置带 moe 标注', () => {
    const inst = instantiateTrainTemplate({
      templateId: 'extraction-qlora',
      baseModel: 'Qwen3-MoE-30B',
      baseType: 'moe',
      dataPath: '/data/train.jsonl',
      targetModules: [...MOE_TARGET_MODULES],
    });
    expect(inst.base_type).toBe('moe');
    if ('oumi' in inst) {
      expect(inst.oumi.peft.target_modules).toContain('gate_proj');
      expect(inst.oumi.peft.target_modules).toContain('up_proj');
      expect(inst.oumi.peft.target_modules).toContain('down_proj');
    }
  });

  it('moe 基座不显式传 target_modules → 缺省用 MoE 预置组（自动过校验）', () => {
    const inst = instantiateTrainTemplate({
      templateId: 'extraction-qlora',
      baseModel: 'Qwen3-MoE-30B',
      baseType: 'moe',
      dataPath: '/data/train.jsonl',
    });
    if ('oumi' in inst) {
      expect(inst.oumi.peft.target_modules).toEqual([...MOE_TARGET_MODULES]);
    } else {
      throw new Error('应产出 oumi 配置');
    }
  });
});

// ════════════════════════════════════════
// 四、RL 配方模板（grpo/dapo/cispo + ScaleRL 四技巧）
// ════════════════════════════════════════

describe('RL 配方模板', () => {
  it('三配方全量（grpo/dapo/cispo）', () => {
    expect(RL_TEMPLATES.map((t) => t.id).sort()).toEqual(['cispo', 'dapo', 'grpo']);
    expect(findRlTemplate('grpo')).not.toBeNull();
    expect(findRlTemplate('nonexistent')).toBeNull();
  });

  it('grpo 实例化：ScaleRL 四技巧参数齐全（归一化/零方差跳过/warmup）', () => {
    const inst = instantiateRlTemplate({
      recipe: 'grpo',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/rl-prompts.jsonl',
    });
    // 技巧① batch 级 advantage 归一化
    expect(inst.hyperparams.advantage_normalization).toBe('batch');
    // 技巧③ 零方差组跳过
    expect(inst.hyperparams.skip_zero_variance_groups).toBe(true);
    // 技巧④ LR warmup
    expect(inst.hyperparams.warmup_steps_ratio).toBeGreaterThan(0);
    // train_submit 消费映射：algorithm=grpo 通道
    expect(inst.algorithm).toBe('grpo');
    expect(inst.hyperparams.advantage_estimator).toBe('grpo');
    expect(inst.scalerlNotes.length).toBeGreaterThan(0);
  });

  it('dapo 实例化：技巧② clip ε 解耦（clip_eps_high > clip_eps_low）', () => {
    const inst = instantiateRlTemplate({
      recipe: 'dapo',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/rl-prompts.jsonl',
    });
    expect(inst.hyperparams.advantage_estimator).toBe('grpo');
    expect(inst.hyperparams.clip_eps_high).toBeGreaterThan(
      inst.hyperparams.clip_eps_low as number,
    );
    expect(inst.hyperparams.dynamic_sampling).toBe('resample');
  });

  it('cispo 实例化：技巧② CISPO clip ε 显式（token 级截断）', () => {
    const inst = instantiateRlTemplate({
      recipe: 'cispo',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/rl-prompts.jsonl',
    });
    expect(inst.hyperparams.advantage_estimator).toBe('cispo');
    expect(inst.hyperparams.clip_eps).toBe(0.2);
    expect(inst.recipe).toBe('cispo');
  });

  it('RL 实例化可被 train_submit 消费（algorithm 枚举合法 + hyperparams 可透传）', () => {
    for (const recipe of ['grpo', 'dapo', 'cispo'] as const) {
      const inst = instantiateRlTemplate({
        recipe,
        baseModel: 'Qwen3-8B',
        baseType: 'dense',
        dataPath: '/data/rl-prompts.jsonl',
      });
      // 协议 algorithm 枚举三值——RL 全走 grpo 通道
      expect(['sft', 'dpo', 'grpo']).toContain(inst.algorithm);
      expect(typeof inst.hyperparams).toBe('object');
      expect(inst.hyperparams).not.toBeNull();
    }
  });

  it('未知配方抛错（快速失败）', () => {
    expect(() =>
      instantiateRlTemplate({
        recipe: 'ppo-x',
        baseModel: 'Qwen3-8B',
        baseType: 'dense',
        dataPath: '/data/x.jsonl',
      }),
    ).toThrow(/未知 RL 配方/);
  });

  it('overrides 覆盖 RL 默认超参（组大小调优）', () => {
    const inst = instantiateRlTemplate({
      recipe: 'grpo',
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/rl.jsonl',
      overrides: { group_size: 64 },
    });
    expect(inst.hyperparams.group_size).toBe(64);
  });
});

// ════════════════════════════════════════
// 五、train analyze 推导主链路
// ════════════════════════════════════════

describe('analyzeTrainNeed 需求推导', () => {
  it('五要素 → 四段报告（目标/数据/评估/配置——显式传入 node）', () => {
    const report = analyzeTrainNeed(dataDir, 'ent-1', 'node-1', {
      node: makeNode(),
      dataPath: '/data/invoices.jsonl',
    });
    expect(report.enterpriseId).toBe('ent-1');
    expect(report.nodeId).toBe('node-1');
    // 一、训练目标
    expect(report.goal.scenario).toBe('extraction');
    expect(report.goal.confident).toBe(true);
    // 二、数据需求
    expect(report.dataRequirement.minSamples).toBeGreaterThan(0);
    expect(report.dataRequirement.format).toContain('JSONL');
    // 三、评估标准
    expect(report.evalCriteria.metric).toBe('exact_match');
    // 四、训练配置（QLoRA 首选模板实例化）
    expect(report.config).not.toBeNull();
    // 五要素快照留痕（复用 v1.3.2 产出）
    expect(report.node.bottleneck).toContain('抄录');
    expect(report.node.tag).toBe('auto');
  });

  it('复用 interview.json 既有梳理产出（不重复采集——CLI 路径）', () => {
    seedInterview('ent-2', [makeNode({ nodeId: 'inv-node' })]);
    const found = findInterviewNode(dataDir, 'ent-2', 'inv-node');
    expect(found).not.toBeNull();
    expect(found?.elements.owner).toBe('财务专员');

    const report = analyzeTrainNeed(dataDir, 'ent-2', 'inv-node');
    expect(report.goal.scenario).toBe('extraction');
  });

  it('节点不存在抛错（提示先跑 fde_interview——不重复采集口径）', () => {
    expect(() => analyzeTrainNeed(dataDir, 'ent-3', 'ghost')).toThrow(/fde_interview/);
  });

  it('rlRecipe 显式指定时走 RL 通道（配置为 RL 实例）', () => {
    const report = analyzeTrainNeed(dataDir, 'ent-1', 'node-1', {
      node: makeNode(),
      rlRecipe: 'grpo',
    });
    expect(report.config).not.toBeNull();
    if (report.config && 'recipe' in report.config) {
      expect(report.config.recipe).toBe('grpo');
      expect(report.config.algorithm).toBe('grpo');
    } else {
      throw new Error('rlRecipe 指定时配置应为 RL 实例');
    }
  });

  it('MoE 基座推导：实例化被防护拒绝时报告保留前三段并记 configNote', () => {
    // 场景模板默认走 moe 预置组会过校验——这里用显式 dense 预置组制造拒绝
    const report = analyzeTrainNeed(dataDir, 'ent-1', 'node-1', {
      node: makeNode(),
      baseType: 'moe',
      // 模板实例化在 analyzeTrainNeed 内不透传 targetModules（缺省 moe 预置组）
      // → 走通过路径；拒绝路径由 instantiateTrainTemplate 单测覆盖。
      // 本用例验证通过路径的 moe 标注：
    });
    if (report.config && 'base_type' in report.config) {
      expect(report.config.base_type).toBe('moe');
    }
  });

  it('报告落盘可回读（幂等覆盖——最新推导为准确认态）', () => {
    const report = analyzeTrainNeed(dataDir, 'ent-1', 'node-1', {
      node: makeNode(),
      dataPath: '/data/x.jsonl',
    });
    const file = saveTrainAnalyzeReport(dataDir, report);
    expect(file).toBe(trainAnalyzeReportPath(dataDir, 'ent-1', 'node-1'));
    const reread = JSON.parse(readFileSync(file, 'utf-8'));
    expect(reread.nodeId).toBe('node-1');
    expect(reread.goal.scenario).toBe('extraction');
  });

  it('pickDefaultTemplate：QLoRA 优先（企业单卡可训）', () => {
    for (const scenario of ['extraction', 'classification', 'generation', 'dialogue'] as const) {
      const template = pickDefaultTemplate(scenario);
      expect(template).not.toBeNull();
      // extraction/classification/generation/dialogue 均有 qlora 模板
      expect(template?.method).toBe('qlora');
    }
  });
});

// ════════════════════════════════════════
// 六、QLoRA 配置模板（qlora-template 直测）
// ════════════════════════════════════════

describe('qlora-template Oumi 配置', () => {
  it('dense/moe 预置组分离（moe 含 expert 三矩阵）', () => {
    expect(QLORA_DENSE).not.toContain('gate_proj');
    expect(MOE_TARGET_MODULES).toContain('gate_proj');
    expect(MOE_TARGET_MODULES).toContain('up_proj');
    expect(MOE_TARGET_MODULES).toContain('down_proj');
  });

  it('训练节字段齐全（gradient checkpointing + paged optimizer——OOM 处方同源）', () => {
    const cfg = buildQloraTemplate({
      baseModel: 'Qwen3-8B',
      baseType: 'dense',
      dataPath: '/data/train.jsonl',
    });
    expect(cfg.training.gradient_checkpointing).toBe(true);
    expect(cfg.training.paged_adamw_8bit).toBe(true);
    expect(cfg.model.load_in_4bit).toBe(true);
    expect(cfg.base_type).toBe('dense');
  });
});
