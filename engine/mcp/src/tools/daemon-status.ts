// ============================================================
// daemon-status.ts · MCP tool：查询 daemon 运行状态（v1.3.1 新增）
// ============================================================
//
// 只读查询 daemon 健康自检文件（daemon-health.json），
// 复用 @sofagent/daemon 的 readHealthFile() + checkDaemonHealth()。
//
// 延迟 import @sofagent/daemon（optionalDependencies 模式）——
// daemon 未安装时返回友好提示，不崩溃。
//
// 安全约束：本 tool 只读，不包含 start/stop/spawn 等任何写操作。
// ============================================================

// ============================================================
// 类型定义
// ============================================================

export interface DaemonStatusResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    healthy: boolean;
    status: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 查询 daemon 运行状态
 *
 * 延迟导入 @sofagent/daemon（optionalDependencies）。
 * 未安装时返回友好提示——与 federation 的 optionalDependencies 模式一致。
 *
 * @returns 结构化结果（text + data）
 */
export async function daemonStatus(): Promise<DaemonStatusResult> {
  let checkDaemonHealth: () => {
    healthy: boolean;
    status: string;
    message: string;
    details?: unknown;
  };

  try {
    // daemon 包的 cli.ts 在 monorepo 联合编译时有重复声明问题（const args 冲突），
    // 导致 TS 无法推导完整导出签名。用类型断言绕过——runtime 有 typeof guard 保安全。
    const daemon = (await import('@sofagent/daemon')) as Record<string, unknown>;
    const fn = daemon.checkDaemonHealth;
    if (typeof fn !== 'function') {
      throw new Error('checkDaemonHealth 不可用');
    }
    checkDaemonHealth = fn as typeof checkDaemonHealth;
  } catch {
    return {
      text: '[sofagent] daemon 状态查询失败：@sofagent/daemon 未安装或不可用',
      data: {
        healthy: false,
        status: 'unavailable',
        message: '@sofagent/daemon 未安装或不可用',
      },
    };
  }

  try {
    const health = checkDaemonHealth();

    const lines: string[] = [];
    lines.push('[sofagent] daemon 状态');
    lines.push(`健康: ${health.healthy ? '✅ 正常' : '❌ 异常'}`);
    lines.push(`状态: ${health.status}`);
    lines.push(`详情: ${health.message}`);

    if (health.details && typeof health.details === 'object') {
      const d = health.details as Record<string, unknown>;
      if (d.pid) lines.push(`PID: ${d.pid}`);
      if (d.startTime) lines.push(`启动时间: ${d.startTime}`);
      if (d.version) lines.push(`版本: ${d.version}`);
      if (d.lastHeartbeat) lines.push(`最后心跳: ${d.lastHeartbeat}`);
      if (d.lastError) lines.push(`最近错误: ${d.lastError}`);
    }

    return {
      text: lines.join('\n'),
      data: health,
    };
  } catch (err) {
    return {
      text: `[sofagent] daemon 状态查询异常: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        healthy: false,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
