// ============================================================
// fde-registry-daily.ts · FDE 节点注册表巡检（v1.3.6 交付 5 #4）
// ============================================================
//
// @daily：读取 .sofagent/fde-registry.yaml（经 orchestrator 公开出口
// loadFDERegistry 解析校验），按 cadence=@daily 的节点巡检：
//   - 每节点输出检查结果（human_gates 数量 / skills 完备性声明）
//   - risk=high 的节点巡检异常时 severity 升级为 warning
//
// 注册表不存在/不合法 → triggered=false（info/warning），不阻断 daemon。
// ============================================================

import type { InspectorResult } from './types';
import { loadFDERegistry, highRiskNodes, type FDERegistryParseResult } from '../fde-registry-loader';

/**
 * FDE 节点注册表巡检器（@daily）。
 *
 * @param projectDir 项目根目录（注册表从 {projectDir}/.sofagent/fde-registry.yaml 读取）
 * @returns InspectorResult
 */
export function runFdeRegistryDaily(projectDir: string): InspectorResult {
  // 经编译产物动态引入（daemon → orchestrator 公开出口，cron.ts 同范式）
  // 注意：fde-registry-loader 是本地薄封装（见文件头说明）
  const result: FDERegistryParseResult = loadFDERegistry(projectDir);

  if (!result.ok) {
    const missing = result.errors.some((e) => e.includes('不存在'));
    return {
      name: 'fde-registry-daily',
      triggered: false,
      message: missing
        ? 'fde-registry.yaml 不存在，FDE 节点巡检跳过'
        : `fde-registry.yaml 校验失败：${result.errors.join('；')}`,
      severity: missing ? 'info' : 'warning',
    };
  }

  const daily = result.nodes.filter((n) => n.cadence === '@daily');
  const highRisk = highRiskNodes(daily);
  const noGates = daily.filter((n) => n.humanGates.length === 0);
  const noSkills = daily.filter((n) => n.skills.length === 0);

  const lines: string[] = [
    `注册节点 ${result.nodes.length} 个，每日巡检 ${daily.length} 个（high risk ${highRisk.length} 个）`,
  ];
  if (noGates.length > 0) {
    lines.push(`⚠️ 无 human_gates 的日巡节点：${noGates.map((n) => n.id).join(', ')}`);
  }
  if (noSkills.length > 0) {
    lines.push(`⚠️ 未声明 skills 的日巡节点：${noSkills.map((n) => n.id).join(', ')}`);
  }

  // 高风险节点缺门禁 → warning（高风险必须有人审点）
  const severity: InspectorResult['severity'] =
    highRisk.some((n) => n.humanGates.length === 0) ? 'warning' : 'info';

  return {
    name: 'fde-registry-daily',
    triggered: true,
    message: lines.join('；'),
    severity,
  };
}
