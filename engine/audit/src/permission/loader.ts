// ============================================================
// permission/loader.ts · 权限配置加载与合并
// v1.3.7 新增
// v1.3.9 配置解析容错——JSON 解析失败 / 缺少 rules 数组时
//   WARN 并按空配置处理，不让权限配置 DoS 崩溃审计进程。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { PermissionConfig, PermissionRule, MergedPermission } from './types';

function loadConfig(filePath: string): PermissionConfig | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PermissionConfig>;
    // 缺少 rules 数组（如 {"deny":[...]} 错误 schema）→ WARN + 空配置，不崩溃
    if (!Array.isArray(parsed.rules)) {
      console.warn(`[sofagent] 权限配置缺少 rules 数组（已忽略）: ${filePath}`);
      return { rules: [] };
    }
    return parsed as PermissionConfig;
  } catch (err) {
    console.warn(
      `[sofagent] 权限配置解析失败（已忽略该文件，不阻断审计）: ${filePath} → ${err instanceof Error ? err.message : String(err)}`
    );
    return { rules: [] };
  }
}

export function loadPermission(projectDir: string): MergedPermission {
  const sofData = process.env.SOFAGENT_DATA || path.join(projectDir, '.sofagent', 'data');
  const globalPath = path.join(sofData, 'permission.json');
  const localPath = path.join(projectDir, '.sofagent', 'permission.local.json');

  const global = loadConfig(globalPath) ?? { rules: [] };
  const local = loadConfig(localPath);

  const merged: PermissionRule[] = [];
  const sources: Record<string, 'global' | 'local'> = {};

  // 先加载 global 规则
  for (const rule of global.rules) {
    merged.push(rule);
    sources[rule.name] = 'global';
  }

  // local 覆盖同名 global 规则
  if (local) {
    for (const rule of local.rules) {
      const idx = merged.findIndex(r => r.name === rule.name);
      if (idx >= 0) {
        merged[idx] = rule;  // 覆盖
      } else {
        merged.push(rule);   // 追加
      }
      sources[rule.name] = 'local';
    }
  }

  return { global, local: local ?? undefined, merged, sources };
}
