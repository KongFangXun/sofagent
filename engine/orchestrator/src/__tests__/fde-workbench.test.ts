// ============================================================
// fde-workbench.test.ts · v1.4.2 章八 · FDE 六引擎测试
//
// 覆盖：
//   - 数据层路径（fdeWorkbenchDir / fdeWorkbenchPaths 七路径）
//   - fde-audit 独立事件域（六事件写入 / prevHash 链衔接 / enterpriseId
//     缺失拒绝 / 非法类型拒绝 / readFdeAudit 回读坏行跳过）
//   - 引擎一 recordInterview（首轮 profile / 多轮 nodeId 幂等合并 /
//     painKeywords 高频提取 / interviewPrompts 五要素话术）
//   - 引擎二 classifyNodes（三问三态 / summary 计数 / minimalUnits 六步 /
//     executor 映射 / classifyFn 注入点）
//   - 引擎三 quantifyNodes（公式同源 computeQuantification / ROI 降序 /
//     totals 汇总 / tag 关联 plans）
//   - 引擎四 deriveOntology（YAML 落盘 / counts / needsFullOntology）
//   - 引擎五 distillDeliverables（三层文件落盘 / README 索引表 / 五要素注入）
//   - 引擎六 deployWorkflow（deployments/<name>.yml / nodeCount / nextSteps）
//   - 主链路：interview→classify→quantify→derive→distill→deploy 后
//     fde-audit 六事件按序留痕
//
// 全部临时目录 fixture——零真实 IO 外溢。FIXED_NOW 时钟注入。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  fdeWorkbenchDir,
  fdeWorkbenchPaths,
  emitFdeAudit,
  readFdeAudit,
  recordInterview,
  classifyNodes,
  sixStepDecomposition,
  interviewPrompts,
  type FdeAuditEntry,
} from '../fde/fde-workbench';
import {
  quantifyNodes,
  deriveOntology,
  distillDeliverables,
  deployWorkflow,
  type NodeQuantifyInput,
} from '../fde/fde-quantify';
import { computeQuantification } from '../train/train-report';
import type { NodeInterview, ComposeSession } from '../fde/compose-interview';

let dataDir: string;
const FIXED_NOW = (): number => new Date('2026-02-01T08:00:00Z').getTime();

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-fde-test-'));
});

// ──────────────────────────────────────
// fixture
// ──────────────────────────────────────

function makeNode(overrides: Partial<NodeInterview> = {}): NodeInterview {
  return {
    nodeId: 'collect-report',
    description: '汇总各门店日报',
    elements: {
      input: '门店邮件日报（Excel 附件）',
      output: '汇总周报表（发给运营总监）',
      owner: '运营专员',
      duration: '每天 2 小时',
      bottleneck: '手工重复抄录数据，格式对不上要逐个核对',
    },
    questions: { inputAutomatable: true, rulesCodifiable: true, outputPredictable: true },
    tag: 'auto',
    dependsOn: [],
    ...overrides,
  };
}

function makeSession(nodes: NodeInterview[]): ComposeSession {
  return {
    enterpriseId: 'acme',
    workflowName: 'weekly-report',
    workflowDescription: '门店周报汇总自动化',
    nodes,
  };
}

// ──────────────────────────────────────
// 数据层路径
// ──────────────────────────────────────

describe('fde-workbench · 数据层', () => {
  it('test_fdeWorkbenchPaths_七路径单出口', () => {
    const dir = fdeWorkbenchDir(dataDir, 'acme');
    expect(dir).toBe(join(dataDir, 'fde', 'acme'));
    const p = fdeWorkbenchPaths(dataDir, 'acme');
    expect(p.dir).toBe(dir);
    expect(p.interview).toBe(join(dir, 'interview.json'));
    expect(p.nodes).toBe(join(dir, 'nodes.json'));
    expect(p.quantification).toBe(join(dir, 'quantification.json'));
    expect(p.ontologyDraft).toBe(join(dir, 'ontology-draft.yaml'));
    expect(p.deliverablesDir).toBe(join(dir, 'deliverables'));
    expect(p.deploymentsDir).toBe(join(dir, 'deployments'));
    expect(p.audit).toBe(join(dir, 'fde-audit.jsonl'));
  });
});

// ──────────────────────────────────────
// 独立 fde-audit 事件域
// ──────────────────────────────────────

describe('fde-workbench · fde-audit', () => {
  it('test_emitFdeAudit_六事件写入与链衔接', () => {
    const types = ['fde_interview', 'fde_classify', 'fde_quantify', 'fde_derive', 'fde_distill', 'fde_deploy'] as const;
    let prev = '';
    for (const t of types) {
      const e = emitFdeAudit({ type: t, enterpriseId: 'acme', artifact: `data/fde/acme/${t}.json` }, dataDir);
      expect(e.type).toBe(t);
      expect(e.enterpriseId).toBe('acme');
      expect(e.hashVersion).toBe(2);
      expect(e.envFingerprint).toBeTruthy();
      // 链衔接：首条 genesis，其后逐条推进
      if (prev === '') {
        expect(e.prevHash).toBe('genesis');
      } else {
        expect(e.prevHash).not.toBe('genesis');
        expect(e.prevHash).not.toBe(prev);
      }
      prev = e.prevHash;
    }
    const entries = readFdeAudit(dataDir, 'acme');
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.type)).toEqual([...types]);
  });

  it('test_emitFdeAudit_enterpriseId缺失拒绝', () => {
    expect(() =>
      emitFdeAudit({ type: 'fde_interview', enterpriseId: '', artifact: 'x' }, dataDir),
    ).toThrow(/enterpriseId/);
    expect(() =>
      emitFdeAudit({ type: 'fde_interview', enterpriseId: '   ', artifact: 'x' }, dataDir),
    ).toThrow(/enterpriseId/);
  });

  it('test_emitFdeAudit_非fde域类型拒绝（不污染 TRAIN_JOB 枚举）', () => {
    expect(() =>
      emitFdeAudit({ type: 'train_start' as never, enterpriseId: 'acme', artifact: 'x' }, dataDir),
    ).toThrow(/非法事件类型/);
  });

  it('test_readFdeAudit_坏行跳过与空文件', () => {
    expect(readFdeAudit(dataDir, 'nope')).toEqual([]);
    emitFdeAudit({ type: 'fde_deploy', enterpriseId: 'acme', artifact: 'a' }, dataDir);
    const { audit } = fdeWorkbenchPaths(dataDir, 'acme');
    appendFileSync(audit, '\n{broken json', 'utf8');
    const entries: FdeAuditEntry[] = readFdeAudit(dataDir, 'acme');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('fde_deploy');
  });

  it('test_emitFdeAudit_reason脱敏（密钥类泄漏拦截）', () => {
    const e = emitFdeAudit(
      { type: 'fde_classify', enterpriseId: 'acme', artifact: 'x', reason: '配置含 sk-abc123def456ghij 密钥' },
      dataDir,
    );
    expect(e.reason).not.toContain('sk-abc123def456ghij');
    expect(e.reason).toContain('sk-***REDACTED***');
  });
});

// ──────────────────────────────────────
// 引擎一：访谈结构化
// ──────────────────────────────────────

describe('fde-workbench · 引擎一 interview', () => {
  it('test_recordInterview_首轮落盘与profile', () => {
    const n1 = makeNode();
    const n2 = makeNode({
      nodeId: 'check-invoice',
      description: '发票核对',
      elements: {
        input: '供应商 PDF 发票',
        output: '核对结果表',
        owner: '财务专员',
        duration: '每周 3 小时',
        bottleneck: '逐张核对金额，重复且易漏',
      },
      questions: { inputAutomatable: true, rulesCodifiable: false, outputPredictable: true },
      tag: 'enhance',
      dependsOn: ['collect-report'],
    });
    const r = recordInterview(dataDir, 'acme', [n1, n2], { now: FIXED_NOW });
    expect(r.schemaVersion).toBe('v1');
    expect(r.rounds).toHaveLength(1);
    expect(r.profile.nodeCount).toBe(2);
    expect(r.profile.roles).toEqual(['运营专员', '财务专员']);
    expect(r.profile.updatedAt).toBe(new Date(FIXED_NOW()).toISOString());
    // 痛点关键词：两个节点 bottleneck 共享「重复」「核对」→ 各计 2 次入榜
    expect(r.profile.painKeywords).toContain('重复');
    expect(r.profile.painKeywords).toContain('核对');
    // 落盘可回读（rounds 持久化）
    const again = recordInterview(dataDir, 'acme', [], { now: FIXED_NOW });
    expect(again.rounds).toHaveLength(2); // 空轮也算一轮追加
    expect(again.profile.nodeCount).toBe(2); // 幂等合并不变
  });

  it('test_recordInterview_多轮nodeId幂等合并不重复计数', () => {
    const v1 = makeNode({ elements: { ...makeNode().elements, bottleneck: '手工抄录重复劳动' } });
    recordInterview(dataDir, 'acme', [v1], { now: FIXED_NOW });
    const v2 = makeNode({
      description: '汇总各门店日报（重访谈修订）',
      elements: { ...makeNode().elements, bottleneck: '手工抄录重复劳动（已减半）' },
    });
    const r = recordInterview(dataDir, 'acme', [v2], { now: FIXED_NOW });
    expect(r.rounds).toHaveLength(2);
    expect(r.profile.nodeCount).toBe(1); // 同 nodeId 覆盖不叠加
    expect(r.profile.roles).toEqual(['运营专员']);
  });

  it('test_interviewPrompts_五要素加实际流程话术齐全', () => {
    const p = interviewPrompts();
    // 五要素 + 第 6 条「实际流程」（GUIDE §2.3.2——名义流程 ≠ 实际流程，走真实案例）
    expect(p).toHaveLength(6);
    expect(p.map((x) => x.field)).toEqual(['输入', '输出', '负责人', '耗时', '最卡的地方', '实际流程']);
    for (const x of p) expect(x.question.length).toBeGreaterThan(5);
  });
});

// ──────────────────────────────────────
// 引擎二：三问判定 → 节点方案
// ──────────────────────────────────────

describe('fde-workbench · 引擎二 classify', () => {
  it('test_classifyNodes_三问三态与summary', () => {
    const nodes = [
      makeNode(), // 3 yes → auto
      makeNode({
        nodeId: 'enhance-node',
        questions: { inputAutomatable: true, rulesCodifiable: false, outputPredictable: true },
      }), // 2 yes → enhance
      makeNode({
        nodeId: 'manual-node',
        questions: { inputAutomatable: false, rulesCodifiable: false, outputPredictable: true },
      }), // 1 yes → manual
    ];
    const f = classifyNodes(dataDir, 'acme', nodes, { now: FIXED_NOW });
    expect(f.schemaVersion).toBe('v1');
    expect(f.summary).toEqual({ auto: 1, enhance: 1, manual: 1 });
    const byId = new Map(f.plans.map((p) => [p.nodeId, p]));
    expect(byId.get('collect-report')?.tag).toBe('auto');
    expect(byId.get('collect-report')?.executor).toBe('ai');
    expect(byId.get('enhance-node')?.tag).toBe('enhance');
    expect(byId.get('manual-node')?.tag).toBe('manual');
    expect(byId.get('manual-node')?.executor).toBe('human');
    expect(f.classifiedAt).toBe(new Date(FIXED_NOW()).toISOString());
  });

  it('test_classifyNodes_minimalUnits六步注入', () => {
    const n = makeNode();
    const f = classifyNodes(dataDir, 'acme', [n]);
    const plan = f.plans[0];
    expect(plan.minimalUnits).toHaveLength(6);
    expect(plan.minimalUnits[0]).toContain(n.elements.input);
    expect(plan.minimalUnits[2]).toContain('核心转换');
    expect(plan.minimalUnits[4]).toContain(n.elements.output);
    expect(plan.questions).toEqual(n.questions); // 判定依据快照可回查
  });

  it('test_classifyNodes_classifyFn注入点可替换', () => {
    const n = makeNode(); // 三问全 yes 缺省会 auto
    const f = classifyNodes(dataDir, 'acme', [n], {
      classifyFn: () => 'manual', // 注入强改（FDE 人工覆盖判定）
    });
    expect(f.plans[0].tag).toBe('manual');
    expect(f.summary.manual).toBe(1);
  });

  it('test_sixStepDecomposition_独立导出', () => {
    const units = sixStepDecomposition({
      input: '邮件附件',
      output: '周报表',
      bottleneck: '手工核对',
    });
    expect(units).toHaveLength(6);
    expect(units[0]).toContain('邮件附件');
    expect(units[3]).toContain('自检');
  });
});

// ──────────────────────────────────────
// 引擎三：量化 + ROI 排序
// ──────────────────────────────────────

describe('fde-quantify · 引擎三 quantify', () => {
  it('test_quantifyNodes_公式同源与ROI降序', () => {
    const inputs: NodeQuantifyInput[] = [
      { nodeId: 'low-roi', annualSalary: 100_000, takeoverRatio: 0.2, aiAnnualCost: 5_000, oneTimeInvestment: 50_000 },
      { nodeId: 'high-roi', annualSalary: 200_000, takeoverRatio: 0.5, aiAnnualCost: 10_000, oneTimeInvestment: 5_000 },
    ];
    const plans = classifyNodes(dataDir, 'acme', [
      makeNode({ nodeId: 'low-roi' }),
      makeNode({ nodeId: 'high-roi' }),
    ]).plans;
    const f = quantifyNodes(dataDir, 'acme', inputs, plans, { now: FIXED_NOW });

    expect(f.ranked.map((r) => r.nodeId)).toEqual(['high-roi', 'low-roi']); // ROI 降序
    expect(f.ranked[0].tag).toBe('auto'); // plans 关联判定标签
    // 同源：metrics 与 computeQuantification 直算一致
    const direct = computeQuantification({ annualSalary: 200_000, takeoverRatio: 0.5, aiAnnualCost: 10_000 });
    expect(f.ranked[0].metrics.annualSaving.value).toBe(direct.annualSaving.value); // 100000
    expect(f.ranked[0].metrics.annualSaving.value).toBe(100_000);
    expect(f.ranked[0].roiScore).toBeCloseTo(100_000 / 6_000, 5); // 分母 invest+1000（千元地板防小额失真——fresh-eyes 视角8-1）
    // totals 汇总
    expect(f.totals.totalAnnualSaving).toBe(100_000 + 20_000);
    expect(f.totals.totalOneTimeInvestment).toBe(55_000);
    expect(f.totals.nodeCount).toBe(2);
    expect(f.quantifiedAt).toBe(new Date(FIXED_NOW()).toISOString());
  });

  it('test_quantifyNodes_无plans时tag为unknown', () => {
    const f = quantifyNodes(
      dataDir,
      'acme',
      [{ nodeId: 'x', annualSalary: 100_000, takeoverRatio: 0.3, aiAnnualCost: 5_000 }],
      null,
    );
    expect(f.ranked[0].tag).toBe('unknown');
  });
});

// ──────────────────────────────────────
// 引擎四：本体推导
// ──────────────────────────────────────

describe('fde-quantify · 引擎四 derive', () => {
  it('test_deriveOntology_YAML落盘与计数', () => {
    const nodes = [
      makeNode(),
      makeNode({ nodeId: 'check-invoice', dependsOn: ['collect-report'] }),
    ];
    const r = deriveOntology(dataDir, 'acme', makeSession(nodes));
    const { ontologyDraft } = fdeWorkbenchPaths(dataDir, 'acme');
    expect(r.draftPath).toBe(ontologyDraft);
    expect(r.counts.entities).toBeGreaterThan(0);
    expect(r.counts.relations).toBeGreaterThan(0);
    const yaml = require('fs').readFileSync(ontologyDraft, 'utf8') as string;
    expect(yaml).toContain('entities:');
    expect(yaml).toContain('concepts:');
    expect(yaml).toContain('relations:');
    expect(yaml).toContain('from: collect-report'); // dependsOn → produces 关系
  });

  it('test_deriveOntology_节点超5触发needsFullOntology', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => makeNode({ nodeId: `n${i}` }));
    const r = deriveOntology(dataDir, 'acme', makeSession(nodes));
    expect(r.needsFullOntology).toBe(true);
  });
});

// ──────────────────────────────────────
// 引擎五：三层交付物
// ──────────────────────────────────────

describe('fde-quantify · 引擎五 distill', () => {
  it('test_distillDeliverables_三层文件落盘与索引', () => {
    const nodes = [makeNode(), makeNode({ nodeId: 'audit-node', description: '合规抽检' })];
    const r = distillDeliverables(dataDir, 'acme', nodes);
    const { deliverablesDir } = fdeWorkbenchPaths(dataDir, 'acme');
    expect(r.deliverablesDir).toBe(deliverablesDir);
    expect(r.layers).toHaveLength(2);

    const fs = require('fs') as typeof import('fs');
    for (const l of r.layers) {
      expect(fs.existsSync(l.docLayer.path)).toBe(true);
      expect(fs.existsSync(l.skillLayer.path)).toBe(true);
      expect(fs.existsSync(l.runLayer.path)).toBe(true);
    }
    // 手册含五要素与验收标准
    const manual = fs.readFileSync(r.layers[0].docLayer.path, 'utf8');
    expect(manual).toContain('collect-report');
    expect(manual).toContain('汇总各门店日报');
    expect(manual).toContain('验收标准');
    expect(manual).toContain('回滚方式');
    // Skill 层 frontmatter
    const skill = fs.readFileSync(r.layers[0].skillLayer.path, 'utf8');
    expect(skill).toContain('---');
    expect(skill).toContain('name: node-collect-report');
    // 运行层 yaml 片段
    const run = fs.readFileSync(r.layers[0].runLayer.path, 'utf8');
    expect(run).toContain('- id: collect-report');
    // README 索引表
    const index = fs.readFileSync(r.index.path, 'utf8');
    expect(index).toContain('| 节点 | 文档层 | Skill 层 | 运行层 |');
    expect(index).toContain('collect-report');
    expect(index).toContain('audit-node');
  });

  it('test_distillDeliverables_plans注入判定标签', () => {
    const n = makeNode({ questions: { inputAutomatable: false, rulesCodifiable: false, outputPredictable: false }, tag: 'manual' });
    const plans = classifyNodes(dataDir, 'acme', [n]).plans;
    const r = distillDeliverables(dataDir, 'acme', [n], plans);
    const fs = require('fs') as typeof import('fs');
    const manual = fs.readFileSync(r.layers[0].docLayer.path, 'utf8');
    expect(manual).toContain('👤 暂不动');
  });

  // ── 模板外置（v1.4.4 第七章·九）：改模板不改代码 ──

  it('test_distillDeliverables_仓库模板渲染与内置默认逐字节等价', () => {
    // 仓库模板（FDE/templates/deliverables/）与内置默认骨架语义一致——
    // 渲染产物应逐字节等价（模板外置是「能力外置」不是「行为变更」）
    const n = makeNode();
    const prevRoot = process.env.SOFAGENT_REPO_ROOT;
    process.env.SOFAGENT_REPO_ROOT = join(tmpdir(), 'sofagent-no-such-root');
    try {
      const builtin = distillDeliverables(dataDir, 'acme', [n]);
      const fs = require('fs') as typeof import('fs');
      const builtinDoc = fs.readFileSync(builtin.layers[0].docLayer.path, 'utf8');
      const builtinSkill = fs.readFileSync(builtin.layers[0].skillLayer.path, 'utf8');
      const builtinRun = fs.readFileSync(builtin.layers[0].runLayer.path, 'utf8');

      // cwd 指到仓库根 → 命中仓库模板（测试 cwd 即 monorepo 包目录，向上两级）
      const prevCwd = process.cwd();
      process.chdir(join(__dirname, '..', '..', '..', '..'));
      try {
        const templated = distillDeliverables(dataDir, 'acme2', [n]);
        expect(fs.readFileSync(templated.layers[0].docLayer.path, 'utf8')).toBe(builtinDoc);
        expect(fs.readFileSync(templated.layers[0].skillLayer.path, 'utf8')).toBe(builtinSkill);
        expect(fs.readFileSync(templated.layers[0].runLayer.path, 'utf8')).toBe(builtinRun);
      } finally {
        process.chdir(prevCwd);
      }
    } finally {
      if (prevRoot === undefined) delete process.env.SOFAGENT_REPO_ROOT;
      else process.env.SOFAGENT_REPO_ROOT = prevRoot;
    }
  });

  it('test_distillDeliverables_自定义模板定制生效（改模板不改代码）', () => {
    const fs = require('fs') as typeof import('fs');
    // 临时模板目录：只放 doc 层（skill/run 缺 → 整体回退内置——三层不混搭）
    const tmpTemplates = join(dataDir, 'custom-templates', 'FDE', 'templates', 'deliverables');
    fs.mkdirSync(tmpTemplates, { recursive: true });
    fs.writeFileSync(join(tmpTemplates, 'node-manual.md'), '# 定制手册 {{nodeId}}——{{description}}（{{tagLabel}}）');
    fs.writeFileSync(join(tmpTemplates, 'node-skill.md'), '---\nname: node-{{nodeId}}\ndescription: 定制 Skill。\n---\n# {{description}}');
    fs.writeFileSync(join(tmpTemplates, 'node-node.yaml'), '# 定制片段 {{nodeId}}');

    const prevRoot = process.env.SOFAGENT_REPO_ROOT;
    process.env.SOFAGENT_REPO_ROOT = join(dataDir, 'custom-templates');
    try {
      const r = distillDeliverables(dataDir, 'acme', [makeNode()]);
      const manual = fs.readFileSync(r.layers[0].docLayer.path, 'utf8');
      // plans 为 null → tag 'unknown' → tagLabel 走「暂不动」分支（三态兜底）
      expect(manual).toBe('# 定制手册 collect-report——汇总各门店日报（👤 暂不动）');
      const skill = fs.readFileSync(r.layers[0].skillLayer.path, 'utf8');
      expect(skill).toContain('description: 定制 Skill。');
      const run = fs.readFileSync(r.layers[0].runLayer.path, 'utf8');
      expect(run).toBe('# 定制片段 collect-report');
    } finally {
      if (prevRoot === undefined) delete process.env.SOFAGENT_REPO_ROOT;
      else process.env.SOFAGENT_REPO_ROOT = prevRoot;
    }
  });

  it('test_distillDeliverables_坏模板failclosed回退内置默认', () => {
    const fs = require('fs') as typeof import('fs');
    // 坏模板：占位符写错（渲染后残留 {{）→ 回退内置默认
    const tmpTemplates = join(dataDir, 'bad-templates', 'FDE', 'templates', 'deliverables');
    fs.mkdirSync(tmpTemplates, { recursive: true });
    fs.writeFileSync(join(tmpTemplates, 'node-manual.md'), '# 坏模板 {{nodeId}} {{typo_placeholder}}');
    fs.writeFileSync(join(tmpTemplates, 'node-skill.md'), '---\nname: node-{{nodeId}}\n---');
    fs.writeFileSync(join(tmpTemplates, 'node-node.yaml'), '# {{nodeId}}');

    const prevRoot = process.env.SOFAGENT_REPO_ROOT;
    process.env.SOFAGENT_REPO_ROOT = join(dataDir, 'bad-templates');
    try {
      const r = distillDeliverables(dataDir, 'acme', [makeNode()]);
      const manual = fs.readFileSync(r.layers[0].docLayer.path, 'utf8');
      // doc 层坏了 → 回退内置默认（含五要素结构），但 skill/run 层正常走模板
      expect(manual).toContain('## 现状（五要素）');
      expect(manual).not.toContain('{{typo_placeholder}}');
      const skill = fs.readFileSync(r.layers[0].skillLayer.path, 'utf8');
      expect(skill).toContain('---');
    } finally {
      if (prevRoot === undefined) delete process.env.SOFAGENT_REPO_ROOT;
      else process.env.SOFAGENT_REPO_ROOT = prevRoot;
    }
  });

  it('test_distillDeliverables_模板文件缺失整体回退（三层不混搭）', () => {
    const fs = require('fs') as typeof import('fs');
    // 只有 doc 模板、缺 skill/run → 整体回退内置（保证三层风格一致）
    const tmpTemplates = join(dataDir, 'partial-templates', 'FDE', 'templates', 'deliverables');
    fs.mkdirSync(tmpTemplates, { recursive: true });
    fs.writeFileSync(join(tmpTemplates, 'node-manual.md'), '# 只有这层 {{nodeId}}');

    const prevRoot = process.env.SOFAGENT_REPO_ROOT;
    process.env.SOFAGENT_REPO_ROOT = join(dataDir, 'partial-templates');
    try {
      const r = distillDeliverables(dataDir, 'acme', [makeNode()]);
      const manual = fs.readFileSync(r.layers[0].docLayer.path, 'utf8');
      expect(manual).toContain('## 现状（五要素）'); // 未走模板（整体回退）
      expect(manual).not.toContain('只有这层');
    } finally {
      if (prevRoot === undefined) delete process.env.SOFAGENT_REPO_ROOT;
      else process.env.SOFAGENT_REPO_ROOT = prevRoot;
    }
  });
});

// ──────────────────────────────────────
// 引擎六：部署组装
// ──────────────────────────────────────

describe('fde-quantify · 引擎六 deploy', () => {
  it('test_deployWorkflow_yaml产出与指引', () => {
    const nodes = [makeNode(), makeNode({ nodeId: 'check-invoice', dependsOn: ['collect-report'] })];
    const r = deployWorkflow(dataDir, 'acme', makeSession(nodes));
    const { deploymentsDir } = fdeWorkbenchPaths(dataDir, 'acme');
    expect(r.workflowPath).toBe(join(deploymentsDir, 'weekly-report.yml'));
    expect(r.nodeCount).toBe(2);
    const fs = require('fs') as typeof import('fs');
    expect(fs.existsSync(r.workflowPath)).toBe(true);
    const yaml = fs.readFileSync(r.workflowPath, 'utf8');
    expect(yaml).toContain('name: weekly-report');
    expect(yaml).toContain('- id: collect-report');
    expect(yaml).toContain('depends_on: ["collect-report"]');
    // nextSteps 指引现有链路（不代激活）
    expect(r.nextSteps.some((s) => s.includes('workflow_submit'))).toBe(true);
    expect(r.nextSteps.some((s) => s.includes('activate_workflow'))).toBe(true);
  });
});

// ──────────────────────────────────────
// 六引擎主链路（audit 六事件按序）
// ──────────────────────────────────────

describe('fde 六引擎主链路', () => {
  it('test_主链路_interview到deploy_审计六事件按序', () => {
    const nodes = [
      makeNode(),
      makeNode({ nodeId: 'check-invoice', dependsOn: ['collect-report'] }),
    ];
    const session = makeSession(nodes);

    // 引擎一 → 六
    recordInterview(dataDir, 'acme', nodes, { now: FIXED_NOW });
    const plans = classifyNodes(dataDir, 'acme', nodes, { now: FIXED_NOW }).plans;
    quantifyNodes(
      dataDir,
      'acme',
      nodes.map((n) => ({ nodeId: n.nodeId, annualSalary: 150_000, takeoverRatio: 0.4, aiAnnualCost: 8_000 })),
      plans,
      { now: FIXED_NOW },
    );
    deriveOntology(dataDir, 'acme', session);
    distillDeliverables(dataDir, 'acme', nodes, plans);
    deployWorkflow(dataDir, 'acme', session);

    const entries = readFdeAudit(dataDir, 'acme');
    expect(entries.map((e) => e.type)).toEqual([
      'fde_interview',
      'fde_classify',
      'fde_quantify',
      'fde_derive',
      'fde_distill',
      'fde_deploy',
    ]);
    // 链完整性：非 genesis 条目的 prevHash 逐条变化
    const hashes = new Set(entries.map((e) => e.prevHash));
    expect(hashes.size).toBe(6); // genesis + 5 个互不相同的推进
  });
});
