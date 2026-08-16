// ============================================================
// fde-registry.ts · FDE 节点注册表（v1.3.5 交付 5 #4）
// ============================================================
//
// fde-registry.yaml schema：
//   nodes:
//     - id: <节点 ID，如 onboarding-interview>
//       cadence: "@daily"        # 🔴 必须带引号——YAML 保留字符 @，裸写 @daily 会解析报错
//       risk: <风险等级 low | medium | high>
//       skills: [<所需 FDE 能力，如 workflow-draft, ontology-draft>]
//       human_gates: [<人工门禁点，如 企业确认工作流草稿>]
//
// ⚠️ 依赖方向（dev-prompt 交付 5 #4）：fde-registry 的读取方是 daemon，
//   本文件的解析/校验函数从 orchestrator index.ts 公开出口导出
//   （daemon → orchestrator 方向合法，反向禁止）。
//
// daemon 按 cadence 定时巡检（inspector 注册见 daemon/src/inspectors/
//   fde-registry-daily.ts）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** 巡检频率（与 daemon inspector-layers 的 LAYER_SCHEDULE 同枚举） */
export type FDECadence = '@daily' | '@weekly' | '@monthly';

/** 风险等级 */
export type FDERisk = 'low' | 'medium' | 'high';

/** 单个 FDE 注册节点 */
export interface FDERegistryNode {
  /** 节点 ID（唯一） */
  id: string;
  /** 巡检频率 */
  cadence: FDECadence;
  /** 风险等级 */
  risk: FDERisk;
  /** 所需 FDE 能力列表 */
  skills: string[];
  /** 人工门禁点列表 */
  humanGates: string[];
  /** 可选描述 */
  description?: string;
}

/** 注册表校验结果 */
export interface FDERegistryParseResult {
  /** 是否合法 */
  ok: boolean;
  /** 解析出的节点列表（ok=false 时空数组） */
  nodes: FDERegistryNode[];
  /** 错误信息（ok=false 时给出具体原因） */
  errors: string[];
}

const VALID_CADENCES: readonly string[] = ['@daily', '@weekly', '@monthly'];
const VALID_RISKS: readonly string[] = ['low', 'medium', 'high'];

/**
 * 解析并校验 fde-registry.yaml 内容（字符串输入——便于测试与多种来源）。
 *
 * @param content yaml 文本
 * @returns 校验结果
 */
export function parseFDERegistry(content: string): FDERegistryParseResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = yamlLoad(content);
  } catch (err) {
    return {
      ok: false,
      nodes: [],
      errors: [`YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (raw === null || raw === undefined) {
    return { ok: false, nodes: [], errors: ['注册表为空'] };
  }
  const root = raw as Record<string, unknown>;
  const nodesRaw = root['nodes'];
  if (!Array.isArray(nodesRaw)) {
    return { ok: false, nodes: [], errors: ['顶层必须为 nodes: <数组>'] };
  }

  const seenIds = new Set<string>();
  const nodes: FDERegistryNode[] = [];
  nodesRaw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`nodes[${i}] 非对象`);
      return;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e['id'] !== 'string' || (e['id'] as string).trim() === '') {
      errors.push(`nodes[${i}].id 必填（非空字符串）`);
      return;
    }
    const id = e['id'] as string;
    if (seenIds.has(id)) {
      errors.push(`nodes[${i}].id 重复: ${id}`);
      return;
    }
    seenIds.add(id);

    if (typeof e['cadence'] !== 'string' || !VALID_CADENCES.includes(e['cadence'] as string)) {
      errors.push(`nodes[${i}].cadence 非法: ${String(e['cadence'])}（须为 @daily|@weekly|@monthly）`);
      return;
    }
    if (typeof e['risk'] !== 'string' || !VALID_RISKS.includes(e['risk'] as string)) {
      errors.push(`nodes[${i}].risk 非法: ${String(e['risk'])}（须为 low|medium|high）`);
      return;
    }
    if (!Array.isArray(e['skills']) || (e['skills'] as unknown[]).some((s) => typeof s !== 'string')) {
      errors.push(`nodes[${i}].skills 必须为字符串数组`);
      return;
    }
    if (!Array.isArray(e['human_gates']) || (e['human_gates'] as unknown[]).some((s) => typeof s !== 'string')) {
      errors.push(`nodes[${i}].human_gates 必须为字符串数组`);
      return;
    }

    nodes.push({
      id,
      cadence: e['cadence'] as FDECadence,
      risk: e['risk'] as FDERisk,
      skills: e['skills'] as string[],
      humanGates: e['human_gates'] as string[],
      ...(typeof e['description'] === 'string' ? { description: e['description'] } : {}),
    });
  });

  return { ok: errors.length === 0, nodes, errors };
}

/**
 * 从项目目录读取 .sofagent/fde-registry.yaml 并解析。
 * 文件不存在 → ok=false（errors 说明缺文件），daemon 据此跳过巡检不报错。
 *
 * @param projectDir 项目根目录
 * @returns 校验结果
 */
export function loadFDERegistry(projectDir: string): FDERegistryParseResult {
  const registryPath = join(projectDir, '.sofagent', 'fde-registry.yaml');
  if (!existsSync(registryPath)) {
    return { ok: false, nodes: [], errors: [`fde-registry.yaml 不存在（${registryPath}）——FDE 节点巡检跳过`] };
  }
  let content: string;
  try {
    content = readFileSync(registryPath, 'utf-8');
  } catch (err) {
    return { ok: false, nodes: [], errors: [`读取失败: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return parseFDERegistry(content);
}

/**
 * 按频率过滤节点（daemon 巡检入口用）。
 *
 * @param nodes 注册节点
 * @param cadence 目标频率
 * @returns 匹配节点
 */
export function filterByCadence(nodes: FDERegistryNode[], cadence: FDECadence): FDERegistryNode[] {
  return nodes.filter((n) => n.cadence === cadence);
}

/**
 * 高风险节点（risk=high）——巡检结果中单独升级 severity。
 */
export function highRiskNodes(nodes: FDERegistryNode[]): FDERegistryNode[] {
  return nodes.filter((n) => n.risk === 'high');
}
