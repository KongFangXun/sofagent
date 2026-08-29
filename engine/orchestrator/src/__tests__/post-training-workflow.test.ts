// post-training-workflow.test.ts · v1.4.3 第五章 测试
//
// 验收标准逐条覆盖：
// - post-training.yml 可被 workflow-parser 解析（DAG 无环校验通过）
// - 七节点依赖序正确（需求→环境→选型→数据→训练→eval→部署）
// - 三个 HITL 确认点配置正确（interrupt_before: true）
// - 各节点 capability_ref 指向正确版本（v1.4.1-1.4.4）

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseWorkflowYaml } from '../workflow-parser';

/** 模板路径（仓库根 FDE/templates/post-training/post-training.yml）
 * __tests__ → src → orchestrator → engine → 仓库根 */
const TEMPLATE_PATH = join(__dirname, '..', '..', '..', '..', 'FDE', 'templates', 'post-training', 'post-training.yml');

/** 读模板原文（hitl_config 原始字段核对——parser 可能不透传全部字段） */
const templateRaw = readFileSync(TEMPLATE_PATH, 'utf-8');

// ════════════════════════════════════════
// 一、模板可解析（workflow-parser 合法实例）
// ════════════════════════════════════════

describe('post-training.yml 模板解析', () => {
  it('workflow-parser 可解析（合法 YAML 实例）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    expect(parsed).not.toBeNull();
    expect(parsed.nodes.length).toBe(7);
  });

  it('七节点齐全（pt-need-collect → pt-deploy）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    const ids = parsed.nodes.map((n) => n.id);
    expect(ids).toEqual([
      'pt-need-collect',
      'pt-env-check',
      'pt-model-select',
      'pt-data-prep',
      'pt-train-run',
      'pt-eval-gate',
      'pt-deploy',
    ]);
  });
});

// ════════════════════════════════════════
// 二、DAG 无环 + 依赖序正确
// ════════════════════════════════════════

describe('DAG 结构校验', () => {
  it('DAG 无环（拓扑排序可行——全部节点可被访问）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    // 拓扑排序（Kahn）——有环则无法消费全部节点
    const nodes = parsed.nodes;
    const inDeg = new Map<string, number>();
    const edges = new Map<string, string[]>();
    for (const n of nodes) {
      inDeg.set(n.id, n.depends_on.length);
      for (const dep of n.depends_on) {
        edges.set(dep, [...(edges.get(dep) ?? []), n.id]);
      }
    }
    const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of edges.get(id) ?? []) {
        const d = (inDeg.get(next) ?? 0) - 1;
        inDeg.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    expect(order.length).toBe(nodes.length); // 全消费 = 无环
  });

  it('依赖序正确：需求 → 环境 → 选型 → 数据 → 训练 → eval → 部署（线性链）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
    expect(byId.get('pt-env-check')!.depends_on).toEqual(['pt-need-collect']);
    expect(byId.get('pt-model-select')!.depends_on).toEqual(['pt-env-check']);
    expect(byId.get('pt-data-prep')!.depends_on).toEqual(['pt-model-select']);
    expect(byId.get('pt-train-run')!.depends_on).toEqual(['pt-data-prep']);
    expect(byId.get('pt-eval-gate')!.depends_on).toEqual(['pt-train-run']);
    expect(byId.get('pt-deploy')!.depends_on).toEqual(['pt-eval-gate']);
  });

  it('依赖无悬空（depends_on 全部指向存在的节点）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    const ids = new Set(parsed.nodes.map((n) => n.id));
    for (const n of parsed.nodes) {
      for (const dep of n.depends_on) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════
// 三、三个 HITL 确认点（interrupt_before: true）
// ════════════════════════════════════════

describe('三 HITL 确认点配置', () => {
  it('恰好三个 HITL 节点（需求确认/选型确认/部署晋升）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    const hitlNodes = parsed.nodes.filter((n) => n.hitl === true);
    expect(hitlNodes.map((n) => n.id).sort()).toEqual(
      ['pt-deploy', 'pt-model-select', 'pt-need-collect'].sort(),
    );
  });

  it('三个 HITL 节点 interrupt_before: true（原文核对——人必须在场先于执行）', () => {
    // parser 可能不透传 hitl_config——对模板原文逐节点核对
    const hitlBlocks = templateRaw.match(/hitl: true[\s\S]*?interrupt_before: true/g) ?? [];
    expect(hitlBlocks.length).toBe(3);
  });

  it('其余四节点 hitl: false（自动执行 + 审计卡关）', () => {
    const parsed = parseWorkflowYaml(templateRaw);
    const auto = parsed.nodes.filter((n) => n.hitl !== true);
    expect(auto.map((n) => n.id).sort()).toEqual(
      ['pt-data-prep', 'pt-env-check', 'pt-eval-gate', 'pt-train-run'].sort(),
    );
  });
});

// ════════════════════════════════════════
// 四、capability_ref 指向正确版本
// ════════════════════════════════════════

describe('capability_ref 版本指向', () => {
  it('七节点各有 capability_ref（原文核对——parser 不透传该字段）', () => {
    const refs = templateRaw.match(/capability_ref: "v1\.4\.[0-9][^"]*"/g) ?? [];
    expect(refs.length).toBe(7);
  });

  it('关键节点版本指向正确（训练引擎能力映射）', () => {
    // 需求采集/选型 → v1.4.3（需求推导+模板库）；环境 → v1.4.2；
    // 训练执行 → v1.4.1（train-job 编排）；eval → v1.4.2（eval 闭环）
    expect(templateRaw).toMatch(/id: pt-need-collect[\s\S]*?capability_ref: "v1\.4\.3 训练需求推导/);
    expect(templateRaw).toMatch(/id: pt-model-select[\s\S]*?capability_ref: "v1\.4\.3 训练模板库/);
    expect(templateRaw).toMatch(/id: pt-env-check[\s\S]*?capability_ref: "v1\.4\.2 训练环境管理/);
    expect(templateRaw).toMatch(/id: pt-train-run[\s\S]*?capability_ref: "v1\.4\.1 train-job 编排/);
    expect(templateRaw).toMatch(/id: pt-eval-gate[\s\S]*?capability_ref: "v1\.4\.2 训练中 eval 闭环/);
  });
});

// ════════════════════════════════════════
// 五、FDE/templates/README.md 登记
// ════════════════════════════════════════

describe('README 登记', () => {
  it('FDE/templates/README.md 已登记 post-training 模板', () => {
    const readme = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'FDE', 'templates', 'README.md'),
      'utf-8',
    );
    expect(readme).toContain('post-training/post-training.yml');
    expect(readme).toContain('后训练 workflow 模板');
  });
});
