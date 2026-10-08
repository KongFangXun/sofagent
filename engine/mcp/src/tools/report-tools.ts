// ============================================================
// report-tools.ts · MCP tool: list_capabilities
// v1.5.7: 从 mcp-server.ts 提取
// v1.5.7 章五: 从「工具清单」升级为「可拔能力地图」——接 engine/capabilities.json
//   （主干能力清单 SSOT），返回档位名 + 默认值 + 依赖级联 + 关档失效面。
//   读取方式：编译期打包 JSON 需各包 build 链配合，此处走**运行时相对解析**
//   （process.cwd() 向上找 engine/capabilities.json——MCP server 的既定部署形态
//   即仓内/安装态相邻目录）；文件缺席时**响亮降级**（标注 legacy 形态，不静默）。
// ============================================================
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ToolResult } from './audit-tools';
import { VERSION } from '@sofagent/audit';

// ============================================================
// 能力清单装载（capabilities.json · 运行时只读）
// ============================================================

/** capabilities.json 的最小结构面（消费字段子集——清单本体 schema 由生成器守卫） */
interface CapabilityManifest {
  capabilities: Array<{
    id: string;
    domain: string;
    carrier: string;
    gate: { name: string; default: boolean };
    env?: string;
    dependsOn: string[];
    disabledImpact: string;
  }>;
  shims: Array<{ id: string; cli: string; trigger: string; action: string }>;
}

/**
 * 解析 capabilities.json 路径——四级回退（与仓内数据目录解析纪律同族）：
 * ① 编译态：dist/tools/report-tools.js → 上三级 = engine/（dist/tools/ 深三层）
 * ② 源码态：src/tools/report-tools.ts → 上四级 = engine/（vitest 直跑 src）
 * ③ process.cwd()/engine/capabilities.json（仓内根运行态）
 * ④ process.cwd()/capabilities.json（安装态平铺）
 */
function resolveCapabilitiesPath(): string {
  const candidates: string[] = [
    join(__dirname, '..', '..', '..', 'capabilities.json'),
    join(__dirname, '..', '..', '..', '..', 'capabilities.json'),
    join(process.cwd(), 'engine', 'capabilities.json'),
    join(process.cwd(), 'capabilities.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return '';
}

/**
 * 读能力清单（缺席容错）——文件不存在/坏 JSON 时返回 null（调用方响亮降级，
 * 不静默装作「无能力地图」）。
 */
function loadCapabilityManifest(): CapabilityManifest | null {
  const p = resolveCapabilitiesPath();
  if (p === '') return null;
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8')) as CapabilityManifest;
    if (!doc || !Array.isArray(doc.capabilities) || !Array.isArray(doc.shims)) return null;
    return doc;
  } catch {
    return null;
  }
}

// ============================================================
// Tool: list_capabilities
// ============================================================

export function listCapabilities(): ToolResult {
  const capabilities = {
    tools: [
      { name: 'run_audit', description: '对 git diff 跑全量审计规则（28 条）' },
      { name: 'get_think', description: '读取 think.md 最近 N 条反思条目' },
      { name: 'write_think', description: '向 think.md 追加反思记录' },
      { name: 'compose', description: '编排模块——产出 Sub Agent 编排方案 YAML' },
      { name: 'audit_file', description: '单文件变更即时审计（A3/A7/A11/A18 + 可选 A14）' },
      { name: 'search_knowledge', description: '跨 entities/concepts 模糊搜索' },
      { name: 'read_entity', description: '读单个 entity 页' },
      { name: 'read_concept', description: '读单个 concept 页' },
      { name: 'list_entities', description: '列出所有 entity（可选 domain 过滤）' },
      { name: 'read_lessons', description: '读 lessons-missteps.md' },
      { name: 'read_think_md', description: '读 think.md 完整内容（含 [sofagent] 前缀）' },
      { name: 'stats', description: 'knowledge 库统计' },
      { name: 'list_capabilities', description: '返回本能力清单' },
      { name: 'data_sovereignty_report', description: '查询数据主权审计报告摘要（today/yesterday/YYYY-MM-DD）' },
      { name: 'create_entity', description: '创建/更新 entity（含 D1-D5 数据审计）' },
      { name: 'create_concept', description: '创建/更新 concept（含 D1-D5 数据审计）' },
      { name: 'validate_ontology', description: '本体数据完整性校验' },
      { name: 'evaluate_output', description: '用 golden set 评估 Agent 产出质量' },
      { name: 'optimize_skill', description: '优化 Skill 文件（evolve 模块）' },
      { name: 'health_check', description: '环境健康检查（doctor/verify）' },
      { name: 'audit_data_change', description: '数据变更审计（D1-D5 规则）' },
      { name: 'notify_session', description: '审计结果汇报（预格式化 [sofagent] 返回）' },
      { name: 'activate_workflow', description: '激活 FDE 交付物，注册企业 SubAgent' },
      { name: 'daemon_status', description: '查询 daemon 运行状态（只读）' },
      { name: 'list_agents', description: '列出已注册 Agent（内置 + 企业）' },
      { name: 'list_concepts', description: '列出 knowledge/concepts/ 下所有 concept' },
      { name: 'hitl_resolve', description: 'HITL 异步决议——提交决策触发 LOOP 恢复' },
    ],
    resources: [
      { uri: 'think://latest', description: 'think.md 最后一条条目' },
      { uri: 'logs://today', description: '今日任务日志' },
      { uri: 'audit://last-report', description: '最近一次审计报告' },
      { uri: 'orchestrator://latest-comparison', description: '最新 A/B 对比报告' },
    ],
    auditEngine: `sofagent-audit v${VERSION}`,
    rulesCount: 28, // v1.5.7 章八：27→28（E7 决策质量信号）；此处曾长期滞后（25），同批对齐 SECURITY SSOT
  };

  // ── 可拔能力地图（v1.5.7 章五：capabilities.json SSOT）──────────
  const manifest = loadCapabilityManifest();
  /** 判别收窄：units 在场 = 清单可达（真地图）；缺席 = legacy 降级形态 */
  const capabilityMap:
    | {
        source: string;
        domains: string[];
        units: Array<{
          id: string;
          domain: string;
          carrier: string;
          gate: string;
          gateDefault: boolean;
          env?: string;
          dependsOn: string[];
          disabledImpact: string;
        }>;
        shimRegistry: { count: number; note: string; shims: Array<{ id: string; cli: string; trigger: string; action: string }> };
      }
    | { source: string } = manifest
    ? {
        source: 'engine/capabilities.json',
        domains: [...new Set(manifest.capabilities.map((c) => c.domain))],
        units: manifest.capabilities.map((c) => ({
          id: c.id,
          domain: c.domain,
          carrier: c.carrier,
          gate: c.gate.name,
          gateDefault: c.gate.default,
          ...(c.env && c.env !== '' ? { env: c.env } : {}),
          dependsOn: c.dependsOn,
          disabledImpact: c.disabledImpact,
        })),
        shimRegistry: {
          count: manifest.shims.length,
          note: '旧命令转发 shim 退役台账（触发条件 = 兼容期届满，动作 = 移除；名单 SSOT = docs/changelog/v1.5/v1.5.6.md 章一附录）',
          shims: manifest.shims.map((s) => ({ id: s.id, cli: s.cli, trigger: s.trigger, action: s.action })),
        },
      }
    : {
        source: 'legacy（engine/capabilities.json 不可达——运行目录非仓内/安装态，能力地图缺席。清单见仓库 engine/capabilities.json，校验器 tools/gen/gen-capability-manifest.mjs）',
      };

  const lines: string[] = ['[sofagent] 能力清单:', ''];
  lines.push('Tools:');
  for (const t of capabilities.tools) lines.push(`  - ${t.name}: ${t.description}`);
  lines.push('');
  lines.push('Resources:');
  for (const r of capabilities.resources) lines.push(`  - ${r.uri}: ${r.description}`);
  lines.push('');
  lines.push(`Audit engine: ${capabilities.auditEngine} (${capabilities.rulesCount} 条规则)`);
  // 可拔能力地图渲染（人读面）：档位 + 默认值 + 依赖级联 + 失效面
  lines.push('');
  if ('units' in capabilityMap) {
    lines.push(`可拔能力地图（源 = ${capabilityMap.source}；域 = ${capabilityMap.domains.join(' · ')}）:`);
    for (const u of capabilityMap.units) {
      const dep = u.dependsOn.length > 0 ? `；依赖 = ${u.dependsOn.join(', ')}` : '';
      lines.push(`  - [${u.domain}] ${u.id}（载体 ${u.carrier}）：档位 ${u.gate} 默认${u.gateDefault ? '开' : '关'}${'env' in u ? `（env: ${u.env}）` : ''}${dep}`);
      lines.push(`      关档失效面：${u.disabledImpact}`);
    }
    lines.push(`  - shim 台账：${capabilityMap.shimRegistry.count} 条旧命令转发 shim（${capabilityMap.shimRegistry.shims.map((s) => s.cli).join(' / ')}）`);
  } else {
    lines.push(`可拔能力地图：${capabilityMap.source}`);
  }
  return {
    text: lines.join('\n'),
    data: { ...capabilities, capabilityMap },
  };
}
