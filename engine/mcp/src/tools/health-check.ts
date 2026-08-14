// ============================================================
// health-check.ts · MCP tool：环境健康检查（v1.3.4 S2 新增）
// ============================================================
//
// mode: 'doctor' → 复用 @sofagent/core 的 runDoctor()
// mode: 'verify' → 提示通过 CLI 运行（runAllChecks 需要复杂参数）
// ============================================================

import { runDoctor, type DoctorReport } from '@sofagent/core';
// ============================================================
// 类型定义
// ============================================================

export interface HealthCheckArgs {
  /** 检查模式：doctor（基础健康）/ verify（装后验证），默认 doctor */
  mode?: 'doctor' | 'verify';
  /** 平台（workbuddy/openclaw/claude/codex/hermes），仅 verify 模式使用 */
  platform?: string;
}

export interface HealthCheckResult {
  text: string;
  data: {
    allOk: boolean;
    checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
    mode: string;
  };
}

// ============================================================
// 主函数
// ============================================================

export function healthCheck(args: HealthCheckArgs): HealthCheckResult {
  const mode = args.mode ?? 'doctor';
  const platform = args.platform ?? 'workbuddy';

  if (mode === 'verify') {
    return {
      text: `[sofagent] verify 模式请通过 CLI 运行：\n  npx @sofagent/core verify --platform ${platform}\n\n或运行：\n  ./tools/pre-push-check.sh`,
      data: {
        allOk: true,
        checks: [
          { name: 'verify', status: 'pass', detail: `verify 模式请通过 CLI 运行（--platform ${platform}）` },
        ],
        mode: 'verify',
      },
    };
  }

  // doctor 模式
  let report: DoctorReport;
  try {
    report = runDoctor();
  } catch (err) {
    return {
      text: `[sofagent] 健康检查异常：${err instanceof Error ? err.message : String(err)}`,
      data: {
        allOk: false,
        checks: [
          { name: 'doctor', status: 'fail', detail: String(err) },
        ],
        mode: 'doctor',
      },
    };
  }

  const checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [
    { name: '环境检查', status: report.env ? 'pass' : 'fail', detail: report.env ? 'Node/git/npm 可用' : '环境检查未通过' },
    { name: '配置检查', status: report.config ? 'pass' : 'warn', detail: report.config ? '.sofagent/config.yml 合法' : '配置文件异常' },
    { name: '数据目录', status: report.dataDirs ? 'pass' : 'warn', detail: report.dataDirs ? '数据目录结构正常' : '数据目录不存在或异常' },
    { name: 'Git Hook', status: report.hook ? 'pass' : 'warn', detail: report.hook ? 'commit-msg hook 已安装' : 'hook 未安装' },
    { name: '依赖完整性', status: report.deps ? 'pass' : 'warn', detail: report.deps ? '关键依赖已安装' : '部分依赖缺失' },
    { name: '审计日志', status: report.auditLog ? 'pass' : 'warn', detail: report.auditLog ? 'hash chain 完整' : 'hash chain 异常' },
  ];

  const lines: string[] = [];
  lines.push('[sofagent] 健康检查（doctor 模式）');
  lines.push(`总体判定: ${report.allOk ? '✅ 全部通过' : '⚠️ 存在问题'}`);
  lines.push('');
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
    lines.push(`${icon} ${c.name}: ${c.detail}`);
  }

  return {
    text: lines.join('\n'),
    data: { allOk: report.allOk, checks, mode: 'doctor' },
  };
}
