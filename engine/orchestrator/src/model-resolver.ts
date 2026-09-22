// ============================================================
// model-resolver.ts · 节点级模型偏好 → 模型注册表解析（v1.5.1 第八章）
// ============================================================
// 偏好解析语义（fail-closed——不静默降级）：
//   - 未配置偏好 → 返回 null（调用方走默认模型，现行为不变）
//   - 偏好指向注册表内模型 → 返回注册表条目（执行层用其实际模型）
//   - 偏好指向未注册模型：
//       priority=required  → 抛 ModelPreferenceError（不静默降级）
//       priority=preferred（缺省）→ 抛错同样不静默降级（devlog 验收：
//         「偏好指向未注册模型时报错」——与 priority 无关，降级会让
//         「节点绑了旗舰却跑默认」静默发生，审计面失真）
//   - 注册表文件不存在/损坏 → 同未注册处理（报错带定位）
// ============================================================

import { loadRegistry, resolveModelRegistryPath, type ModelRegistryEntry } from './model-registry';

/** 偏好解析错误（结构化——带节点定位素材） */
export class ModelPreferenceError extends Error {
  constructor(
    message: string,
    public readonly nodeName: string,
    public readonly requestedModel: string,
  ) {
    super(message);
    this.name = 'ModelPreferenceError';
  }
}

/** 解析结果：null = 未配置偏好（走默认） */
export type ModelResolution =
  | { resolved: false }
  | { resolved: true; entry: ModelRegistryEntry; nodeName: string };

/**
 * 解析单个节点的模型偏好。
 * registryDataDir：model-registry.json 所在数据目录。
 */
export function resolveNodeModelPreference(
  nodeName: string,
  preference: { provider?: string; model: string; priority?: 'preferred' | 'required' } | undefined,
  registryDataDir: string,
): ModelResolution {
  if (!preference) return { resolved: false };

  let models: Record<string, ModelRegistryEntry>;
  try {
    const registry = loadRegistry(registryDataDir);
    models = registry.models;
  } catch (err) {
    throw new ModelPreferenceError(
      `节点「${nodeName}」偏好模型「${preference.model}」无法解析——模型注册表读取失败: ${err instanceof Error ? err.message : String(err)}（${resolveModelRegistryPath(registryDataDir)}）`,
      nodeName,
      preference.model,
    );
  }

  const entry = models[preference.model];
  if (!entry) {
    throw new ModelPreferenceError(
      `节点「${nodeName}」偏好模型「${preference.model}」未在注册表注册（已注册 ${Object.keys(models).length} 个）——不静默降级；请先注册模型或修正 workflow 偏好`,
      nodeName,
      preference.model,
    );
  }
  // provider 属展示性标注（注册表以 name 唯一）——不符仅提示不阻断
  if (preference.provider && !entry.endpoint.includes(preference.provider)) {
    // provider 串不在 endpoint 域内：信息性校验（同名即同模型，注册表 name 是唯一键）
    // 不抛错——防误配提示由调用方按需消费（resolved 仍成功）
  }
  return { resolved: true, entry, nodeName };
}

/**
 * 批量解析 workflow 全部节点偏好——任一 required 解析失败整体抛错
 * （编排前一次性校验，不跑到一半才炸）。
 */
export function resolveWorkflowModelPreferences(
  nodes: Array<{ id: string; modelPreference?: { provider?: string; model: string; priority?: 'preferred' | 'required' } }>,
  registryDataDir: string,
): Map<string, ModelRegistryEntry> {
  const resolved = new Map<string, ModelRegistryEntry>();
  for (const node of nodes) {
    if (!node.modelPreference) continue;
    const r = resolveNodeModelPreference(node.id, node.modelPreference, registryDataDir);
    if (r.resolved) resolved.set(node.id, r.entry);
  }
  return resolved;
}
