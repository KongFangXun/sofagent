// ============================================================
// permission/types.ts · 权限配置类型定义
// v1.3.2 新增
// ============================================================

export interface PermissionRule {
  name: string;
  effect: 'allow' | 'deny';
  pattern: string;
  files?: string[];
}

export interface PermissionConfig {
  rules: PermissionRule[];
}

export interface MergedPermission {
  global: PermissionConfig;
  local?: PermissionConfig;
  merged: PermissionRule[];
  sources: Record<string, 'global' | 'local'>;
}
