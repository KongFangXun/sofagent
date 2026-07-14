// ============================================================
// permission/loader.ts · 权限配置加载与合并
// v1.1.0 新增
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { PermissionConfig, PermissionRule, MergedPermission } from './types';

function loadConfig(filePath: string): PermissionConfig | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as PermissionConfig;
}

export function loadPermission(projectDir: string): MergedPermission {
  const sofData = process.env.SOFAGENT_DATA || path.join(projectDir, '.sofagent');
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
