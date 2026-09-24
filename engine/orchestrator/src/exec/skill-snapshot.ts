// ============================================================
// skill-snapshot.ts · 执行时 skill 快照（v1.5.2 T10 第三项）
// ============================================================
//
// 每次执行前打包当次可见的 skill 版本（runtimeSkillPackages），执行结束
// 即清理——不做常驻预同步。
//
// 为什么不常驻同步（changelog 十章交付表的三条理由，代码即执行）：
//   1. 可复现：常驻同步导致同一 workflow 两次执行用不同 skill 版本；
//   2. 数据主权：设备侧残留越积越多是漏洞面；
//   3. 审计起点：版本漂移无审计锚——快照清单（名/版本/sha256）挂进
//      该次执行的审计记录（emitDecision 留痕），回放可精确回答
//      「当时用的是哪个版本的哪个 skill」。
//
// 快照对象：SKILL 目录树下的规范资产（harness/*.md + skills/*.md +
// rules/*.md + AGENTS.md + SKILL.md）——以调用方传入的 skillRoot 为准
// （测试注入临时目录，生产传 <install>/SKILL）。
//
// 落盘面：{dataDir}/skill-snapshots/<sessionId>/（每会话一目录，快照
// 文件复制自 skillRoot）；清理 = rmSync 该会话目录（执行后调用，文件
// 系统断言零残留是验收项）。
//
// 依赖形态：atomicWriteSync（core 根 barrel @public）+ emitDecision
// （audit @public——dual-gate-mw 同款 import 路径）。
// ============================================================

import { createHash } from 'crypto';
import { atomicWriteSync } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import * as fs from 'fs';
import * as path from 'path';

/** 快照清单条目（与 daemon RuntimeSkillPackage 同构——心跳携带摘要用） */
export interface SkillSnapshotEntry {
  /** skill 名（相对 skillRoot 的路径，如 harness/installer.md） */
  name: string;
  /** 版本（文件 mtime 的 ISO 时间戳——无版本化系统时以内容变更时点为版本） */
  version: string;
  /** 内容 sha256 前 16 位（审计锚点） */
  sha256: string;
}

/** 打包结果 */
export interface SkillSnapshotResult {
  /** 快照清单（排序稳定——按 name 字典序，回放比对友好） */
  packages: SkillSnapshotEntry[];
  /** 快照落盘目录（{dataDir}/skill-snapshots/<sessionId>） */
  snapshotDir: string;
  /** 审计留痕的决策记录 ts（回放查询键） */
  decisionTs: string;
}

/** 参与快照的文件扩展（SKILL 规范资产全是 md） */
const SNAPSHOT_EXT = '.md';

/**
 * 收集 skillRoot 下全部 .md 文件（相对路径字典序）。
 *
 * 目录不存在 → 空数组（fail-open 观测语义：无 skill 资产=无可快照，
 * 不是错误——裸 base-only 安装形态合法）。扫描失败（权限等）→ 抛错
 * 由调用方决定（打包面是执行前置件，失败应阻断执行而非静默空跑）。
 */
export function collectSkillFiles(skillRoot: string): string[] {
  if (!fs.existsSync(skillRoot)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(SNAPSHOT_EXT)) {
        out.push(path.relative(skillRoot, full));
      }
    }
  };
  walk(skillRoot);
  return out.sort();
}

/**
 * 打包执行时快照（执行前调用）。
 *
 * 流程：
 *   1. collectSkillFiles 收集 skillRoot 全部 .md；
 *   2. 逐文件复制到 {dataDir}/skill-snapshots/<sessionId>/（保相对路径）；
 *   3. 清单条目（name + version=mtime ISO + sha256 前 16 位）；
 *   4. 清单落盘 snapshot-manifest.json（回放时文件系统层证据）；
 *   5. emitDecision 留审计锚点（evidence 逐条「name@version sha256」）。
 *
 * 空 skillRoot（目录不存在）→ 空清单照样走完流程（审计记录「当时无
 * skill 资产」本身是有价值的事实——比缺记录诚实）。
 */
export function snapshotSkills(input: {
  /** skill 资产根目录（生产 = <install>/SKILL；测试注入临时目录） */
  skillRoot: string;
  /** 执行会话 ID（快照目录与审计记录的关联键） */
  sessionId: string;
  /** 数据根目录 */
  dataDir: string;
  /** 审计身份（emitDecision 必填） */
  agentId: string;
  /** 时间注入（测试用；缺省当前时间） */
  nowIso?: string;
}): SkillSnapshotResult {
  const ts = input.nowIso ?? new Date().toISOString();
  const files = collectSkillFiles(input.skillRoot);
  const snapshotDir = path.join(input.dataDir, 'skill-snapshots', input.sessionId);
  fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });

  const packages: SkillSnapshotEntry[] = [];
  for (const rel of files) {
    const src = path.join(input.skillRoot, rel);
    const content = fs.readFileSync(src);
    const dest = path.join(snapshotDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const stat = fs.statSync(src);
    packages.push({
      name: rel,
      version: stat.mtime.toISOString(),
      sha256: createHash('sha256').update(content).digest('hex').slice(0, 16),
    });
  }

  // 清单落盘（manifest 本身不进清单——它是索引不是资产）
  atomicWriteSync(
    path.join(snapshotDir, 'snapshot-manifest.json'),
    JSON.stringify({ sessionId: input.sessionId, takenAt: ts, packages }, null, 2),
  );

  // 审计锚点（回放可查——「当时用的是哪个版本的哪个 skill」）
  const decision = emitDecision(
    {
      agentId: input.agentId,
      sessionId: input.sessionId,
      kind: 'ORCHESTRATION', // 执行前置件的编排决策（快照打包/清理生命周期）
      moment: 'ACT',
      category: 'select',
      why: `执行时 skill 快照打包（${packages.length} 项）——执行结束即清理，无常驻`,
      evidence: packages.map((p) => `${p.name}@${p.version} sha256=${p.sha256}`),
      engine: 'sofagent-orchestrator/skill-snapshot',
    },
    input.dataDir,
  );

  return { packages, snapshotDir, decisionTs: decision.ts };
}

/**
 * 清理快照（执行后调用——验收「文件系统断言零残留」）。
 *
 * 只删本会话目录（skill-snapshots/<sessionId>），不碰兄弟会话。
 * 目录不存在 → 无操作（幂等——重复清理安全）。
 */
export function cleanupSnapshot(dataDir: string, sessionId: string): void {
  const snapshotDir = path.join(dataDir, 'skill-snapshots', sessionId);
  if (fs.existsSync(snapshotDir)) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * 读快照清单（回放查询面——执行后快照文件已清理时返回 null）。
 *
 * 回放语义：快照本体执行后即清理（不留残面）；**审计链里的 evidence
 * 是持久证据**（decision-log 持久化），本函数读的是「快照还活着」时
 * 的文件系统侧清单——用于清理前的中途检查或故障排查。
 */
export function readSnapshotManifest(
  dataDir: string,
  sessionId: string,
): { sessionId: string; takenAt: string; packages: SkillSnapshotEntry[] } | null {
  const manifestPath = path.join(dataDir, 'skill-snapshots', sessionId, 'snapshot-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      sessionId: string;
      takenAt: string;
      packages: SkillSnapshotEntry[];
    };
  } catch {
    return null; // 损坏 manifest = 无可读清单（观测面不抛错）
  }
}
