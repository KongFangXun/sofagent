// ============================================================
// formations/schema.ts · 阵型配置 schema + 六阵型校验（v1.5.0 第三章）
// ============================================================
// formation.yml 声明阵型 + 角色分配 + 交接协议；
// 六种内置阵型（ccteam 启发）：
//   commander&crews / driver&advisor / cross-review /
//   bake-off / research-triangulation / cost-pyramid
// ============================================================

/** 六种合法阵型名（未识别报错列全六值） */
export const FORMATION_NAMES = [
  'commander-crews',
  'driver-advisor',
  'cross-review',
  'bake-off',
  'research-triangulation',
  'cost-pyramid',
] as const;

export type FormationName = (typeof FORMATION_NAMES)[number];

/** 阵型成员角色声明 */
export interface FormationMember {
  /** 角色名（如 commander / crew-1 / driver / advisor / reviewer-a） */
  role: string;
  /** 该角色绑定的 SubAgent 类型（v1.3.6 SDK 注册名） */
  agentType: string;
}

/** 交接边（信息流——审计留痕素材） */
export interface FormationEdge {
  from: string;
  to: string;
  /** 交接协议（同步阻塞 / 异步通知 / 审阅回传） */
  protocol: 'sync' | 'async' | 'review';
}

/** formation.yml 单文档结构 */
export interface FormationConfig {
  /** 阵型名（六选一） */
  formation: string;
  /** 成员（角色 × SubAgent 类型） */
  members: FormationMember[];
  /** 交接边（跨成员信息流） */
  edges: FormationEdge[];
}

/** 校验结果 */
export type SchemaVerdict =
  | { valid: true; formation: FormationName }
  | { valid: false; errors: string[] };

/**
 * 校验 formation 配置。
 * 校验项：阵型名合法（错列六合法值）/ 成员非空 / 角色不重复 /
 * 边端点都在成员表内。
 */
export function validateFormation(config: unknown): SchemaVerdict {
  const errors: string[] = [];
  const cfg = config as Partial<FormationConfig>;

  if (!cfg || typeof cfg !== 'object') {
    return { valid: false, errors: ['配置须为对象'] };
  }
  if (!cfg.formation || typeof cfg.formation !== 'string') {
    errors.push('缺 formation 字段（阵型名）');
  } else if (!(FORMATION_NAMES as readonly string[]).includes(cfg.formation)) {
    errors.push(`未识别的阵型名「${cfg.formation}」——合法值：${FORMATION_NAMES.join(' / ')}`);
  }
  if (!Array.isArray(cfg.members) || cfg.members.length === 0) {
    errors.push('members 须为非空数组');
  } else {
    const roles = new Set<string>();
    for (const m of cfg.members) {
      if (!m?.role || !m?.agentType) {
        errors.push('成员缺 role 或 agentType 字段');
        break;
      }
      if (roles.has(m.role)) errors.push(`角色名重复：${m.role}`);
      roles.add(m.role);
    }
    if (Array.isArray(cfg.edges)) {
      for (const e of cfg.edges) {
        if (!roles.has(e.from) || !roles.has(e.to)) {
          errors.push(`交接边端点不在成员表内：${e.from} → ${e.to}`);
        }
      }
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, formation: cfg.formation as FormationName };
}

/**
 * 解析 formation.yml 文本（YAML → 校验后的配置）。
 * yaml 解析由调用方注入（harness 零依赖同理——orchestrator 有 js-yaml）。
 */
export function parseFormation(yamlText: string, yamlLoad: (s: string) => unknown): SchemaVerdict & { config?: FormationConfig } {
  let parsed: unknown;
  try {
    parsed = yamlLoad(yamlText);
  } catch (e) {
    return { valid: false, errors: [`YAML 解析失败: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const v = validateFormation(parsed);
  if (!v.valid) return v;
  return { ...v, config: parsed as FormationConfig };
}
