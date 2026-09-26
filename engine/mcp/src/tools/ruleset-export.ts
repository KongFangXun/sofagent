// ============================================================
// ruleset-export.ts · v1.5.3 章二 · MCP tool: ruleset_export
//
// 约束导出通道的 MCP 面（章二「规则面」——ruleset 可导出为标准 JSON）。
// 与 v1.2.9 `--ruleset-path` 加载格式同构：导出格式即加载格式，双向可逆
// （导出物 → loadRulesetFile() 能读出 + validateRuleset() 不报错）。
//
// 导出内容 = 25 条默认规则 + 已加载扩展规则，每条附训练消费元数据
// （rule_id / 检测意图 / 违规样例 / 严重级别），带规则集版本号 + 内容指纹，
// 并每次导出写一条审计留痕（谁在何时导出了哪个版本的规则集 + 指纹）。
//
// 延迟 require 策略（对齐 corpus-export.ts）：audit 包经 createRequire(__filename)
// 解析——MCP 进程内 audit 不一定在依赖树上，缺包时给 isError 降级提示不崩 server。
// 工具注册（tool-registry.ts 的 TOOLS 数组）由独立任务统一做，本文件只导出纯业务函数。
// ============================================================

/** ruleset_export tool 入参（camelCase——schema 面由 tool-registry 映射） */
export interface RulesetExportArgs {
  /** 规则集名称（缺省 'sofagent'） */
  rulesetName?: string;
  /** 规则集版本（缺省读 audit 包 package.json 版本） */
  rulesetVersion?: string;
  /** 规则集描述（缺省自动生成） */
  description?: string;
  /** 数据根目录（审计留痕落点，缺省 SOFAGENT_DATA / data） */
  dataDir?: string;
  /** 导出 JSON 落盘目录（缺省 <dataDir|'data'>/export/ruleset） */
  outDir?: string;
  /** 只构造不落盘、不留痕（预览用） */
  dryRun?: boolean;
}

/** ruleset_export tool 结果 */
export interface RulesetExportResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    ok: boolean;
    isError?: boolean;
    rulesetVersion?: string;
    schemaVersion?: string;
    fingerprint?: string;
    fingerprintAlgo?: string;
    ruleCount?: number;
    /** 落盘文件路径（dryRun 时为空数组） */
    files?: string[];
    /** 审计事件（缺包降级时为 null——占位数据不得长得像审计证据） */
    auditEvent: {
      event: string;
      rulesetVersion: string;
      fingerprint: string;
      ruleCount: number;
      signed: boolean;
      at: string;
    } | null;
  };
}

/** audit 包 buildRulesetExport 的返回形状（tool 面只消费这些字段） */
interface AuditRulesetExportResult {
  ok: boolean;
  fingerprint: string;
  fingerprintAlgo: string;
  schemaVersion: string;
  rulesetVersion: string;
  ruleCount: number;
  files: string[];
  auditEvent: {
    event: string;
    rulesetVersion: string;
    fingerprint: string;
    ruleCount: number;
    signed: boolean;
    at: string;
  };
}

/**
 * 规则集导出 tool。
 *
 * 只读语义：导出只读规则源，不修改任何规则源文件。
 *
 * @param args 参数
 * @returns { text, data }——text 人类可读摘要（首行 [sofagent] 前缀），data 结构化面
 */
export async function rulesetExport(args: RulesetExportArgs = {}): Promise<RulesetExportResult> {
  const createRequire = (await import('node:module')).createRequire;
  const req = createRequire(__filename);

  let buildRulesetExport: (o: {
    rulesetName?: string;
    rulesetVersion?: string;
    description?: string;
    dataDir?: string;
    outDir?: string;
    dryRun?: boolean;
  }) => AuditRulesetExportResult;
  try {
    const mod = req('@sofagent/audit') as Record<string, unknown>;
    buildRulesetExport = mod.buildRulesetExport as typeof buildRulesetExport;
    if (typeof buildRulesetExport !== 'function') throw new Error('ruleset export face missing');
  } catch {
    // audit 缺包/导出面缺失——降级不崩 server；auditEvent 置 null 不伪造审计记录形态
    return {
      text: '[sofagent] ruleset_export 不可用：@sofagent/audit 包未安装或导出面缺失（安装：npm install @sofagent/audit）',
      data: { ok: false, isError: true, auditEvent: null },
    };
  }

  const result = buildRulesetExport({
    ...(args.rulesetName !== undefined ? { rulesetName: args.rulesetName } : {}),
    ...(args.rulesetVersion !== undefined ? { rulesetVersion: args.rulesetVersion } : {}),
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.dataDir !== undefined ? { dataDir: args.dataDir } : {}),
    ...(args.outDir !== undefined ? { outDir: args.outDir } : {}),
    ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
  });

  const dest = result.files.length > 0 ? result.files[0] : '（dryRun：未落盘）';
  const text = [
    `[sofagent] 规则集导出完成：${result.ruleCount} 条规则（版本 ${result.rulesetVersion}，schema ${result.schemaVersion}）`,
    `  内容指纹 ${result.fingerprint}（${result.fingerprintAlgo === 'hmac-sha256' ? 'HMAC-SHA256' : 'SHA-256（无 HMAC 密钥，已降级）'}）`,
    `  导出物与 --ruleset-path 加载格式同构（双向可逆）`,
    `  落盘：${dest}`,
    `  审计留痕：ruleset_export（${result.auditEvent.at}）`,
  ].join('\n');

  return {
    text,
    data: {
      ok: result.ok,
      rulesetVersion: result.rulesetVersion,
      schemaVersion: result.schemaVersion,
      fingerprint: result.fingerprint,
      fingerprintAlgo: result.fingerprintAlgo,
      ruleCount: result.ruleCount,
      files: result.files,
      auditEvent: result.auditEvent,
    },
  };
}
