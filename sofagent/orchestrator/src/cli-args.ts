// ============================================================
// cli-args.ts · CLI 参数解析（纯函数，可单测）
// v1.1.4 审-8：抽出 subagent run 的 --mode <deploy|sustain> 解析
// ============================================================

/** subagent run 命令的解析结果 */
export interface SubagentRunArgs {
  agentName: string;
  task: string;
  mode: 'deploy' | 'sustain';
}

/**
 * 解析 `subagent run` 的参数。
 *
 * 接受形如：
 *   ['run', 'fde', '--task', '...']
 *   ['run', 'fde', '--mode', 'sustain', '--task', '...']
 *
 * 规则：
 * - agentName 必填（args[0] 之后的第一个位置参数）
 * - --task 必填
 * - --mode 可选，缺省时默认 'deploy'（向后兼容 v1.1.4 行为）
 * - --mode 仅接受 'deploy' | 'sustain'，其他值抛错
 *
 * @param args process.argv.slice(2) 中 'subagent' 之后的部分（即 ['run', '<name>', ...]）
 * @returns 解析结果
 * @throws Error 参数缺失或 mode 非法
 */
export function parseSubagentRunArgs(args: string[]): SubagentRunArgs {
  const agentName = args[0];
  if (!agentName) {
    throw new Error('subagent run 需要 <name> 参数');
  }

  const taskIdx = args.indexOf('--task');
  const task = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
  if (!task) {
    throw new Error('subagent run 需要 --task <描述> 参数');
  }

  let mode: 'deploy' | 'sustain' = 'deploy';
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1) {
    const modeValue = args[modeIdx + 1];
    if (modeValue !== 'deploy' && modeValue !== 'sustain') {
      throw new Error(
        `--mode 仅支持 deploy | sustain，收到: "${modeValue ?? ''}"`
      );
    }
    mode = modeValue;
  }

  return { agentName, task, mode };
}
