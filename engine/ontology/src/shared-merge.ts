// ============================================================
// shared-merge.ts · 跨设备 ontology relations 合并
// v1.1.9 新增
// ============================================================

import type { MergedOntology, OntologyObject } from './types';

/**
 * 合并本地与共享 ontology，解决冲突
 *
 * @param local 本地 MergedOntology
 * @param shared 共享 MergedOntology
 * @returns 合并后的 ontology 与冲突列表
 */
export function mergeSharedOntology(
  local: MergedOntology,
  shared: MergedOntology,
): { merged: MergedOntology; conflicts: string[] } {
  const conflicts: string[] = [];
  const mergedObjects = new Map<string, OntologyObject>(
    local.objects.map(o => [o.name, o]),
  );

  for (const entity of shared.objects) {
    const existing = mergedObjects.get(entity.name);
    if (existing) {
      // 合并 relations 字段（去重）
      const mergedRelations = { ...existing.relations };

      for (const key of Object.keys(entity.relations) as Array<
        keyof typeof entity.relations
      >) {
        const sharedValues = entity.relations[key] ?? [];
        const localValues = existing.relations[key] ?? [];
        const combined = [...new Set([...localValues, ...sharedValues])];

        if (combined.length !== localValues.length) {
          mergedRelations[key] = combined;
        }
      }

      // 检查是否有实际变化
      const hasChange = Object.keys(mergedRelations).some(
        k =>
          JSON.stringify(mergedRelations[k as keyof typeof mergedRelations]) !==
          JSON.stringify(existing.relations[k as keyof typeof existing.relations]),
      );

      if (hasChange) {
        existing.relations = mergedRelations;
      } else {
        conflicts.push(
          `Object ${entity.name}: same relations in both sources`,
        );
      }
    } else {
      mergedObjects.set(entity.name, entity);
    }
  }

  // 合并 actions 和 constraints（共享源追加）
  const mergedActions = [...local.actions];
  const actionNames = new Set(local.actions.map(a => a.name));
  for (const action of shared.actions) {
    if (!actionNames.has(action.name)) {
      mergedActions.push(action);
      actionNames.add(action.name);
    }
  }

  const mergedConstraints = [...local.constraints];
  const constraintKeys = new Set(
    local.constraints.map(c => `${c.type}:${c.target}`),
  );
  for (const constraint of shared.constraints) {
    const key = `${constraint.type}:${constraint.target}`;
    if (!constraintKeys.has(key)) {
      mergedConstraints.push(constraint);
      constraintKeys.add(key);
    }
  }

  return {
    merged: {
      mergedAt: new Date().toISOString(),
      version: `${local.version}+shared`,
      objects: Array.from(mergedObjects.values()),
      actions: mergedActions,
      constraints: mergedConstraints,
      stats: {
        totalObjects: mergedObjects.size,
        totalActions: mergedActions.length,
        totalConstraints: mergedConstraints.length,
        sources: [...new Set([...local.stats.sources, ...shared.stats.sources])],
      },
    },
    conflicts,
  };
}
