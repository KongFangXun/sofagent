// ============================================================
// daemon/cron.ts — 定时任务调度
// v1.1.2: 支持 @weekly / @daily / @hourly 触发 Sub Agent 巡检
// v1.1.2：迁移至 @sofagent/daemon
//
// 从 .sofagent/watch.yml 读取 cron 配置段，按周期调度 Sub Agent。
// 默认运行 fde Agent 的 sustain 模式，产出周度巡检报告。
// ============================================================

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** 定时任务配置 */
export interface CronJob {
  schedule: '@weekly' | '@daily' | '@hourly';
  /** Sub Agent 名称，默认 'fde' */
  agent?: string;
  /** 运行模式，默认 'sustain' */
  mode?: string;
  /** 任务描述 */
  task: string;
}

/** 从 watch.yml 读取 cron 配置 */
export function loadCronConfig(projectDir: string): CronJob[] {
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return [];
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as any;
    return raw?.cron || [];
  } catch {
    return [];
  }
}

/** @weekly 等 alias 转 ms 间隔 */
function scheduleToMs(alias: string): number {
  const map: Record<string, number> = {
    '@hourly': 3600_000,
    '@daily': 86400_000,
    '@weekly': 604800_000,
  };
  return map[alias] || 0;
}

/** 启动定时巡检 */
export function startCron(projectDir: string): void {
  const jobs = loadCronConfig(projectDir);
  if (jobs.length === 0) return;

  for (const job of jobs) {
    const intervalMs = scheduleToMs(job.schedule);
    if (intervalMs === 0) continue;

    const agentName = job.agent || 'fde';
    const mode = job.mode || 'sustain';

    console.log(`[cron] ${job.schedule} → subagent run ${agentName} --mode ${mode}`);

    setInterval(async () => {
      try {
        const auditCli = join(__dirname, '..', 'index.js');
        const args = [
          auditCli, 'subagent', 'run', agentName,
          '--mode', mode,
          '--task', job.task,
        ];
        const output = execFileSync(process.execPath, args, {
          encoding: 'utf-8',
          cwd: projectDir,
          timeout: 300000,  // 5 分钟超时
        });
        console.log(`[cron] ${agentName} 巡检完成:\n${output}`);
      } catch (err) {
        console.error(`[cron] ${agentName} 巡检失败:`, (err as Error).message);
      }
    }, intervalMs);
  }
}
