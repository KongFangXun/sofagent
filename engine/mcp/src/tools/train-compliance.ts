// ============================================================
// train-compliance.ts · MCP tool：train_compliance（v1.4.5 第三章）
// ============================================================
//
// 训练数据合规扫描的 MCP 面——委托 @sofagent/orchestrator 的
// train-compliance：
//   - scan：扫描训练集三类风险项（PII/敏感字段/企业专有名词——复用
//     v1.4.5 redactor 红名单检测）+ 报告写训练集版本
//   - gate：合规闸门断言（严重级发现 → 阻断训练提交的结构化错误）
//   - mark：数据来源标记（企业提供/合成/公开语料——合规可追溯）
//
// 边界（devlog §三）：与 v1.4.4 脱敏检测能力共用、处置逻辑独立——
// 导出闸防「泄漏出去」，训练闸防「不该训的数据进了训练」。
// ============================================================

import { getDataDir } from '@sofagent/core';

/** train_compliance tool 入参 */
export interface TrainComplianceArgs {
  /** 🔴 企业标识（隔离分区依赖） */
  enterprise_id: string;
  /** 🔴 数据集标识 */
  dataset_id: string;
  /** 🔴 数据集版本（versions.jsonl 的 version 字段） */
  version: string;
  /** 操作（缺省 scan——scan=扫描+写版本；gate=只断言不落盘；mark=来源标记） */
  action?: 'scan' | 'gate' | 'mark';
  /** 数据来源标记（action=mark 必填；action=scan 可选——扫描同时打标） */
  provenance?: 'enterprise' | 'synthetic' | 'public';
}

/** train_compliance tool 结果 */
export interface TrainComplianceToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    /** 闸门结论（无 critical/high 发现 = true） */
    passed?: boolean;
    /** 阻断原因（passed=false 时非空） */
    blockedBy?: string;
    /** 发现项计数（按严重度） */
    findingCounts?: Record<string, number>;
    /** 发现项明细（形态+计数+处置建议——不含命中原文） */
    findings?: Array<{
      kind: string;
      severity: string;
      matchedPattern: string;
      sampleCount: number;
      action: string;
      advice: string;
    }>;
    /** 来源标记生效值（mark 成功 / scan 带标时返回） */
    provenance?: string;
    /** 打标后的版本号（-c 后缀） */
    stampedVersion?: string;
  };
}

/**
 * train_compliance——训练数据合规扫描（scan / gate / mark 三操作）。
 * 校验失败与闸门阻断都返回结构化错误（不抛出——gate 的阻断语义由
 * isError=true + passed=false 表达，调用方转人读提示）。
 */
export async function trainComplianceTool(args: TrainComplianceArgs): Promise<TrainComplianceToolResult> {
  const { enterprise_id, dataset_id, version, action = 'scan', provenance } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_compliance 失败：enterprise_id 必填且非空',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }
  if (typeof dataset_id !== 'string' || dataset_id.trim() === '') {
    return {
      text: '[sofagent] train_compliance 失败：dataset_id 必填且非空',
      data: { isError: true, ok: false, issues: ['dataset_id 必填且非空'] },
    };
  }
  if (typeof version !== 'string' || version.trim() === '') {
    return {
      text: '[sofagent] train_compliance 失败：version 必填且非空',
      data: { isError: true, ok: false, issues: ['version 必填且非空'] },
    };
  }
  if (action === 'mark' && provenance === undefined) {
    return {
      text: '[sofagent] train_compliance 失败：action=mark 需要 provenance（enterprise/synthetic/public）',
      data: { isError: true, ok: false, issues: ['action=mark 时 provenance 必填'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();

    // ── mark：来源标记（独立操作——不扫描）──
    if (action === 'mark') {
      const stamped = orch.markProvenance(dataDir, enterprise_id, dataset_id, version, provenance!);
      return {
        text: `[sofagent] 数据来源已标记 ✅（${dataset_id}@${version} → ${stamped.version}，来源 ${provenance}）——合规可追溯`,
        data: {
          isError: false,
          ok: true,
          issues: [],
          provenance,
          stampedVersion: stamped.version,
        },
      };
    }

    // ── scan / gate：扫描（gate = 只断言不落盘版本）──
    const report = orch.scanDatasetCompliance({
      dataDir,
      enterpriseId: enterprise_id,
      datasetId: dataset_id,
      version,
      ...(provenance !== undefined ? { provenance } : {}),
    });

    if (action === 'scan') {
      // 扫描结果 + 来源标记写训练集版本（append-only 台账——-c 后缀新记录）
      const counts: Record<string, number> = {};
      for (const f of report.findings) {
        counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      }
      orch.stampComplianceOnVersion(dataDir, enterprise_id, dataset_id, version, {
        compliance: {
          scannedAt: report.scannedAt,
          passed: report.passed,
          findingCounts: counts,
          ...(report.blockedBy !== undefined ? { blockedBy: report.blockedBy } : {}),
        },
        ...(provenance !== undefined ? { provenance } : {}),
      });
    }

    // gate 语义：阻断以 isError=true 表达（MCP 调用方可见的「不让训」信号）
    if (!report.passed) {
      return {
        text:
          `[sofagent] ⛔ 合规闸门阻断（${dataset_id}@${version}）：${report.blockedBy}\n` +
          report.findings
            .filter((f) => f.severity === 'critical' || f.severity === 'high')
            .map((f) => `  · [${f.severity}] ${f.matchedPattern} ×${f.sampleCount}——${f.advice}`)
            .join('\n') +
          '\n（数据不处理完不让训——处置后重扫通过再提交）',
        data: {
          isError: true,
          ok: false,
          issues: [report.blockedBy ?? '存在 critical/high 发现'],
          passed: false,
          blockedBy: report.blockedBy,
          findings: report.findings,
        },
      };
    }

    const critical = report.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
    const medium = report.findings.filter((f) => f.severity === 'medium').length;
    return {
      text:
        `[sofagent] 合规扫描通过 ✅（${dataset_id}@${version}，${report.sampleCount} 样本，来源 ${report.provenance}）` +
        (report.findings.length > 0
          ? `——${medium} 项 medium 建议（人工确认，不阻断）：\n` +
            report.findings.map((f) => `  · [${f.severity}] ${f.matchedPattern}——${f.advice}`).join('\n')
          : '——零风险项发现'),
      data: {
        isError: false,
        ok: true,
        issues: [],
        passed: true,
        findings: report.findings,
        provenance: report.provenance,
        ...(action === 'scan' ? { stampedVersion: `${version.endsWith('-c') ? version.slice(0, -2) : version}-c` } : {}),
        ...(critical === 0 && medium > 0 ? { findingCounts: { medium } } : {}),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_compliance 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
