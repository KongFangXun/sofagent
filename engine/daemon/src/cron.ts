// ============================================================
// daemon/cron.ts — 定时任务调度
// v1.4.1: 支持 @weekly / @daily / @hourly 触发 Sub Agent 巡检
// v1.4.1：迁移至 @sofagent/daemon
//
// 从 .sofagent/watch.yml 读取 cron 配置段，按周期调度 Sub Agent。
// 默认运行 fde Agent 的 sustain 模式，产出周度巡检报告。
// ============================================================

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** A/B 调度配置（task === 'ab-schedule' 时生效 · v1.1.8 新增） */
export interface ABCronConfig {
  /** 单方案运行阈值 N（默认 10；初期建议 5 降低试错成本） */
  threshold?: number;
  /** 探索候选队列（默认 ['B-domain', 'C-risk', 'D-tdd']） */
  variants?: string[];
  /** promote 连续胜出阈值（默认 2，对齐 CONSECUTIVE_WINS_REQUIRED） */
  promoteThreshold?: number;
}

/** 定时任务配置 */
export interface CronJob {
  schedule: '@weekly' | '@daily' | '@hourly' | '@monthly';
  /** Sub Agent 名称，默认 'fde' */
  agent?: string;
  /** 运行模式，默认 'sustain' */
  mode?: string;
  /** 任务描述；'ab-schedule' 为保留值——走 A/B 调度分支而非 subagent run */
  task: string;
  /** A/B 调度配置（仅 task === 'ab-schedule' 时读取 · v1.1.8 新增） */
  config?: ABCronConfig;
}

/** watch.yml 顶层结构 */
interface WatchConfig {
  cron?: unknown[];
}

/** 从 watch.yml 读取 cron 配置 */
export function loadCronConfig(projectDir: string): CronJob[] {
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return [];
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfig | null;
    const cron = raw?.cron;
    if (!Array.isArray(cron)) return [];
    // 运行时校验：确保每条 cron 条目至少包含 schedule 和 task 字段
    return cron.filter((entry): entry is CronJob => {
      if (!entry || typeof entry !== 'object') return false;
      const e = entry as Record<string, unknown>;
      return typeof e.schedule === 'string' && typeof e.task === 'string';
    });
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
    '@monthly': 2_592_000_000,
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

    // v1.1.8 新增：task === 'ab-schedule' 走 A/B 调度分支（真实任务探索-利用
    // 状态机），不走 subagent run 路径——调用 orchestrator 包的
    // runABScheduledTask，指标落 {SOFAGENT_DATA}/ab-history.jsonl。
    if (job.task === 'ab-schedule') {
      console.log(`[cron] ${job.schedule} → ab-schedule（A/B 自动调度）`);
      setInterval(() => {
        void (async () => {
          try {
            // 经编译产物 dist 动态引入（orchestrator 新增导出随 dist 重建生效）
            const orchestrator = (await import('@sofagent/orchestrator')) as unknown as {
              runABScheduledTask: (
                statePath?: string,
                config?: { threshold?: number; variants?: string[]; promoteThreshold?: number; task?: string },
              ) => Promise<{
                lastPhase: string;
                currentPlan: string;
                currentRunCount: number;
                candidatePlan: string | null;
                candidateRunCount: number;
              }>;
            };
            const state = await orchestrator.runABScheduledTask(undefined, {
              threshold: job.config?.threshold,
              variants: job.config?.variants,
              promoteThreshold: job.config?.promoteThreshold,
              task: '',
            });
            console.log(
              `[cron] ab-schedule 完成: phase=${state.lastPhase} current=${state.currentPlan}(${state.currentRunCount}) candidate=${state.candidatePlan ?? '—'}(${state.candidateRunCount})`,
            );
          } catch (err) {
            console.error(`[cron] ab-schedule 调度失败:`, (err as Error).message);
          }
        })();
      }, intervalMs);
      continue;
    }

    // v1.3.0 (交付 10 MA5)：task === 'decision-memory' 走决策记忆回灌分支——
    // @daily 扫描 decision-log.jsonl 提取高频模式 + 规则上下文写入 Memory。
    // Memory 后端未配置 / 不可达 → 优雅降级（warn + skip），不 crash。
    if (job.task === 'decision-memory') {
      console.log(`[cron] ${job.schedule} → decision-memory（决策记忆回灌 MA5/MA7）`);
      setInterval(() => {
        void (async () => {
          try {
            const { runDailyMemoryExtraction } = (await import('./extractors/decision-memory-extractor')) as {
              runDailyMemoryExtraction: () => Promise<unknown>;
            };
            const entries = await runDailyMemoryExtraction();
            console.log(`[cron] decision-memory 完成: ${Array.isArray(entries) ? entries.length : 0} 条提取`);
          } catch (err) {
            console.error(`[cron] decision-memory 回灌失败:`, (err as Error).message);
          }
        })();
      }, intervalMs);
      continue;
    }

    const agentName = job.agent || 'fde';
    const mode = job.mode || 'sustain';

    console.log(`[cron] ${job.schedule} → subagent run ${agentName} --mode ${mode}`);

    setInterval(() => {
      void (async () => {
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
      })();
    }, intervalMs);
  }
}
