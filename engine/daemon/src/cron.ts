// ============================================================
// daemon/cron.ts — 定时任务调度
// v1.4.5: 支持 @weekly / @daily / @hourly 触发 Sub Agent 巡检
// v1.4.5：迁移至 @sofagent/daemon
// v1.4.5 T1（P0 方案 A接线）：inspectors: 段 → L1/L2/L3 分层巡检调度
//   —— runAllLayers 此前「诞生即死」（存在但零生产调用），按 LAYER_SCHEDULE
//      默认 @daily/@weekly/@monthly 接线；enabled:false 可显式关闭。
// v1.4.5 T2（P0）：dream-cycle: 段 → runDreamCycle 调度
//   —— 同样零生产调用，默认 @daily 启用，产物落 data/knowledge/。
// v1.4.5 第五章：train-archive: 段 → runTrainArchiveTask 调度
//   —— 训练产物归档冷存（压缩不删除）+ 90 天覆写销毁 + 磁盘 80% 预警，
//      默认 @weekly 启用（企业级磁盘治理标配），task 实现在 tasks/train-archive.ts。
//
// 从 .sofagent/watch.yml 读取 cron 配置段，按周期调度 Sub Agent。
// 默认运行 fde Agent 的 sustain 模式，产出周度巡检报告。
// ============================================================

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { load as yamlLoad } from 'js-yaml';
import { LAYER_SCHEDULE, type InspectorLayer } from './inspector-layers';

const nodeRequire = createRequire(__filename);

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

// ────────────────────────────────────────────────────────────
// v1.4.5 T1（P0）：inspectors: 段配置
// ────────────────────────────────────────────────────────────

/** 分层巡检调度配置（watch.yml `inspectors:` 段） */
export interface InspectorsConfig {
  /** 总开关；缺省 true——段缺失也启用（零调度 bug 的修复语义） */
  enabled: boolean;
  /** 各层 cron 频率；缺省对齐 LAYER_SCHEDULE（L1=@daily / L2=@weekly / L3=@monthly） */
  layers: Record<InspectorLayer, '@daily' | '@weekly' | '@monthly'>;
}

/** v1.4.5 T2（P0）：Dream Cycle 调度配置（watch.yml `dream-cycle:` 段） */
export interface DreamCycleConfig {
  /** 总开关；缺省 true——段缺失也启用（零触发 bug 的修复语义） */
  enabled: boolean;
  /** cron 频率；缺省 @daily */
  schedule: '@daily' | '@weekly' | '@monthly';
}

/** watch.yml 顶层结构 */
interface WatchConfig {
  cron?: unknown[];
  inspectors?: unknown;
  'dream-cycle'?: unknown;
  'train-archive'?: unknown;
}

/** 巡检调度状态文件路径（lastSuccessAt 持久化——doctor 报告用） */
function resolveInspectorStatePath(): string {
  const dataDir = process.env.SOFAGENT_DATA
    || join(process.env.SOFAGENT_HOME || require('os').homedir() + '/.sofagent', 'data');
  return join(dataDir, 'dashboard', 'inspector-schedule.json');
}

interface InspectorStateFile {
  /** 各层最后成功执行时间（ISO 8601） */
  lastSuccessAt: Partial<Record<InspectorLayer, string>>;
}

/** 读取巡检调度状态文件（损坏/缺失 → 空状态） */
function loadInspectorState(): InspectorStateFile {
  try {
    const p = resolveInspectorStatePath();
    if (!existsSync(p)) return { lastSuccessAt: {} };
    return JSON.parse(readFileSync(p, 'utf-8')) as InspectorStateFile;
  } catch {
    return { lastSuccessAt: {} };
  }
}

/**
 * 记录某层巡检成功时间（v1.4.5 T1——daemon-health 衍生需求：
 * 调度任务维度 lastSuccessAt，--doctor 与 buildInspectorScheduleReport 消费）。
 */
export function recordInspectorSuccess(_projectDir: string, layer: InspectorLayer): void {
  try {
    const state = loadInspectorState();
    state.lastSuccessAt[layer] = new Date().toISOString();
    const p = resolveInspectorStatePath();
    const dir = dirname(p);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch {
    // 状态落盘失败不阻断巡检主流程（观测性 best-effort）
  }
}

/** 规范化层频率值：非法值回落到 LAYER_SCHEDULE 缺省 */
function normalizeLayerSchedule(layer: InspectorLayer, raw: unknown): '@daily' | '@weekly' | '@monthly' {
  if (raw === '@daily' || raw === '@weekly' || raw === '@monthly') return raw;
  return LAYER_SCHEDULE[layer];
}

/**
 * 读取 watch.yml `inspectors:` 段（v1.4.5 T1）。
 *
 * 语义：段缺失 / enabled 缺省 → 默认启用（P0「零调度」修复本体——
 * 此前 runAllLayers 零生产调用，巡检从未被调度）。显式 enabled: false 关闭。
 * 坏 YAML / 类型错误 fail-open 返回默认启用。
 */
export function loadInspectorsConfig(projectDir: string): InspectorsConfig {
  const defaults: InspectorsConfig = {
    enabled: true,
    layers: {
      L1: LAYER_SCHEDULE.L1,
      L2: LAYER_SCHEDULE.L2,
      L3: LAYER_SCHEDULE.L3,
    },
  };
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return defaults;
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfig | null;
    const section = raw?.inspectors;
    if (!section || typeof section !== 'object') return defaults;
    const s = section as Record<string, unknown>;
    const enabled = s.enabled === false ? false : true;
    const layersRaw = s.layers;
    const layers: InspectorsConfig['layers'] = { ...defaults.layers };
    if (layersRaw && typeof layersRaw === 'object') {
      const l = layersRaw as Record<string, unknown>;
      layers.L1 = normalizeLayerSchedule('L1', l.L1);
      layers.L2 = normalizeLayerSchedule('L2', l.L2);
      layers.L3 = normalizeLayerSchedule('L3', l.L3);
    }
    return { enabled, layers };
  } catch {
    return defaults;
  }
}

/**
 * 读取 watch.yml `dream-cycle:` 段（v1.4.5 T2）。
 *
 * 语义：段缺失 → 默认 @daily 启用（P0「零触发」修复本体）。
 * 显式 enabled: false 关闭。坏 YAML fail-open 返回默认启用。
 */
export function loadDreamCycleConfig(projectDir: string): DreamCycleConfig {
  const defaults: DreamCycleConfig = { enabled: true, schedule: '@daily' };
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return defaults;
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfig | null;
    const section = raw?.['dream-cycle'];
    if (!section || typeof section !== 'object') return defaults;
    const s = section as Record<string, unknown>;
    const enabled = s.enabled === false ? false : true;
    const schedule = s.schedule === '@weekly' || s.schedule === '@monthly' ? s.schedule : '@daily';
    return { enabled, schedule };
  } catch {
    return defaults;
  }
}

/**
 * 读取 watch.yml `train-archive:` 段（v1.4.5 第五章）。
 *
 * cron 调度视角的薄适配：段语义本体在 tasks/train-archive.ts 的
 * loadTrainArchiveConfig（purge/diskCheck 子开关）——本函数只解析
 * cron 关心的 enabled + schedule 两键（同 loadDreamCycleConfig 模式）。
 */
export function loadTrainArchiveCronConfig(
  projectDir: string,
): { enabled: boolean; schedule: '@daily' | '@weekly' | '@monthly' } {
  const defaults = { enabled: true, schedule: '@weekly' as const };
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return defaults;
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfig | null;
    const section = raw?.['train-archive'];
    if (!section || typeof section !== 'object') return defaults;
    const s = section as Record<string, unknown>;
    const enabled = s.enabled === false ? false : true;
    const schedule =
      s.schedule === '@daily' || s.schedule === '@monthly' ? s.schedule : '@weekly';
    return { enabled, schedule };
  } catch {
    return defaults;
  }
}

/** 巡检调度状态报告（--doctor 展示用） */
export interface InspectorScheduleReport {
  /** 总开关 */
  enabled: boolean;
  /** 各层调度状态 */
  layers: Array<{
    layer: InspectorLayer;
    schedule: '@daily' | '@weekly' | '@monthly';
    /** 最后成功执行时间；null = 从未执行（doctor 提示「从未巡检」） */
    lastSuccessAt: string | null;
  }>;
}

/**
 * 构建巡检调度状态报告（v1.4.5 T1——`--doctor` 巡检调度状态）。
 *
 * 合并 watch.yml `inspectors:` 段与 inspector-schedule.json 的 lastSuccessAt。
 */
export function buildInspectorScheduleReport(projectDir: string): InspectorScheduleReport {
  const config = loadInspectorsConfig(projectDir);
  const state = loadInspectorState();
  const layers: InspectorLayer[] = ['L1', 'L2', 'L3'];
  return {
    enabled: config.enabled,
    layers: layers.map((layer) => ({
      layer,
      schedule: config.layers[layer],
      lastSuccessAt: state.lastSuccessAt[layer] ?? null,
    })),
  };
}

/**
 * 首启缺省巡检配置注入（v1.4.5 T1——install.sh / daemon 首次启动调用）。
 *
 * watch.yml 不存在 → 写入含 `inspectors:` + `dream-cycle:` 缺省段的模板；
 * 已存在（含只有其他段的）→ 不动用户配置，返回 false。
 */
export function ensureDefaultInspectorsConfig(projectDir: string): boolean {
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (existsSync(watchYml)) return false;
  try {
    const dir = dirname(watchYml);
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(watchYml, [
      '# sofagent 文件监控配置（首启自动生成——可按需修改）',
      '',
      'watch:',
      '  paths:',
      '    - src/',
      '  ignore:',
      '    - node_modules/',
      '',
      '# 分层巡检调度（v1.4.5）：缺省启用，L1/L2/L3 频率可覆盖',
      'inspectors:',
      `  enabled: true`,
      '  layers:',
      `    L1: "${LAYER_SCHEDULE.L1}"`,
      `    L2: "${LAYER_SCHEDULE.L2}"`,
      `    L3: "${LAYER_SCHEDULE.L3}"`,
      '',
      '# Dream Cycle 知识蒸馏（v1.4.5）：默认每日；enabled: false 可关闭',
      'dream-cycle:',
      '  enabled: true',
      '  schedule: "@daily"',
      '',
      '# 训练产物归档（v1.4.5 第五章）：默认每周归档冷存 + 90 天覆写销毁 + 磁盘预警',
      'train-archive:',
      '  enabled: true',
      '  schedule: "@weekly"',
      '  purge: true',
      '  diskCheck: true',
      '',
    ].join('\n'), 'utf-8');
    return true;
  } catch {
    // 写失败不阻断 daemon 启动（下次启动重试）
    return false;
  }
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

/**
 * 启动定时巡检。
 *
 * v1.4.5 T4：返回实际调度任务数（inspectors 各层 + dream-cycle + cron 条目）——
 * 调用方据此决定打印（0 项时不再无条件打「✅ cron 已启动」假绿）。
 */
export function startCron(projectDir: string): number {
  let scheduled = 0;
  // ── v1.4.5 T1（P0）：分层巡检调度接线 ──
  // runAllLayers 此前零生产调用（「诞生即死」）——此处按 inspectors: 段
  // （缺省启用）逐层 setInterval，成功后 recordInspectorSuccess 落
  // lastSuccessAt（doctor / buildInspectorScheduleReport 消费）。
  const inspectorsConfig = loadInspectorsConfig(projectDir);
  if (inspectorsConfig.enabled) {
    const layers: InspectorLayer[] = ['L1', 'L2', 'L3'];
    for (const layer of layers) {
      const intervalMs = scheduleToMs(inspectorsConfig.layers[layer]);
      if (intervalMs === 0) continue;
      scheduled += 1;
      console.log(`[cron] ${inspectorsConfig.layers[layer]} → 巡检层 ${layer}（分层巡检）`);
      setInterval(() => {
        try {
          // 局部 require 避免循环依赖：inspector-layers 侧无 cron 引用，
          // 但保持与其他分支一致的延迟加载风格（daemon 启动不拖重）。
          const { runLayeredInspection } = require('./inspector-layers') as typeof import('./inspector-layers');
          const result = runLayeredInspection(projectDir, layer);
          recordInspectorSuccess(projectDir, layer);
          const failures = result.results.filter((r) => r.triggered && r.severity === 'warning' || r.severity === 'critical');
          console.log(`[cron] 巡检层 ${layer} 完成: ${result.results.length} 项，告警 ${failures.length} 项`);
        } catch (err) {
          console.error(`[cron] 巡检层 ${layer} 失败:`, (err as Error).message);
        }
      }, intervalMs);
    }
  } else {
    console.log('[cron] 分层巡检已禁用（inspectors.enabled=false）');
  }

  // ── v1.4.5 T2（P0）：Dream Cycle 调度接线 ──
  // runDreamCycle 此前零生产调用——此处按 dream-cycle: 段（缺省 @daily 启用）
  // setInterval，产物落 data/knowledge/（Views 层，state-machine 内部已处理）。
  const dreamConfig = loadDreamCycleConfig(projectDir);
  if (dreamConfig.enabled) {
    const intervalMs = scheduleToMs(dreamConfig.schedule);
    if (intervalMs > 0) {
      scheduled += 1;
      console.log(`[cron] ${dreamConfig.schedule} → dream-cycle（知识蒸馏）`);
      setInterval(() => {
        void (async () => {
          try {
            const { runDreamCycle } = (await import('./dream-cycle/state-machine')) as {
              runDreamCycle: (dir: string) => Promise<{
                cycleComplete: boolean;
                failedAt: string | null;
                counts: { concepts: number; atoms: number };
              }>;
            };
            const result = await runDreamCycle(projectDir);
            if (result.cycleComplete) {
              console.log(`[cron] dream-cycle 完成: ${result.counts.concepts} concept / ${result.counts.atoms} atom`);
            } else {
              console.error(`[cron] dream-cycle 中断于 ${result.failedAt ?? 'unknown'}（state.md 已落游标，下轮续跑）`);
            }
            // v1.4.5 第七章一：Dream Cycle 完成后采集当日进化样本
            //（eval passRate / 知识库增量 / 修正回流 → data/evolution/samples-<date>.json，
            //  cursor 跨重启续——evolution report 数据源）。采样失败不阻断调度（best-effort）。
            const { collectDailySample } = await import('./dream-cycle/continuous-sampler');
            const dataDir =
              process.env.SOFAGENT_DATA ||
              join(process.env.SOFAGENT_HOME || require('os').homedir() + '/.sofagent', 'data');
            const sample = await collectDailySample(dataDir, { skipDreamCycle: true });
            console.log(
              `[cron] evolution 采样完成: ${sample.cursor.daysSampled}/${7} 天` +
                (sample.cursor.mockDays > 0 ? `（⚠️ 降级轮 ${sample.cursor.mockDays} 天）` : ''),
            );
          } catch (err) {
            console.error(`[cron] dream-cycle 调度失败:`, (err as Error).message);
          }
        })();
      }, intervalMs);
    }
  } else {
    console.log('[cron] dream-cycle 已禁用（dream-cycle.enabled=false）');
  }

  // ── v1.4.5 第五章：训练产物归档调度接线（train-archive: 段，缺省 @weekly）──
  // 归档冷存（压缩不删除）+ 90 天覆写销毁 + 磁盘 80% 预警——retention-policy
  // 三动作的调度面（对齐 dream-cycle 接线模式：段缺失默认启用）。
  const trainArchiveConfig = loadTrainArchiveCronConfig(projectDir);
  if (trainArchiveConfig.enabled) {
    const intervalMs = scheduleToMs(trainArchiveConfig.schedule);
    if (intervalMs > 0) {
      scheduled += 1;
      console.log(`[cron] ${trainArchiveConfig.schedule} → train-archive（训练产物归档+清理+空间预警）`);
      setInterval(() => {
        void (async () => {
          try {
            const dataDir = process.env.SOFAGENT_DATA
              || join(process.env.SOFAGENT_HOME || require('os').homedir() + '/.sofagent', 'data');
            const { runTrainArchiveTask } = (await import('./tasks/train-archive')) as {
              runTrainArchiveTask: (
                dataDir: string,
                opts?: { config?: unknown },
              ) => Promise<{
                archives: Array<{ archived: number; failures: number }>;
                purges: Array<{ purged: number; failures: number }>;
                diskWarning: { warning: boolean };
              }>;
            };
            const result = await runTrainArchiveTask(dataDir);
            const archivedTotal = result.archives.reduce((s, a) => s + a.archived, 0);
            const purgedTotal = result.purges.reduce((s, p) => s + p.purged, 0);
            const diskTag = result.diskWarning.warning ? ' ⚠ 磁盘预警已打出' : '';
            console.log(
              `[cron] train-archive 完成: 归档 ${archivedTotal} 项 / 清理 ${purgedTotal} 项${diskTag}`,
            );
          } catch (err) {
            console.error(`[cron] train-archive 调度失败:`, (err as Error).message);
          }
        })();
      }, intervalMs);
    }
  } else {
    console.log('[cron] train-archive 已禁用（train-archive.enabled=false）');
  }

  const jobs = loadCronConfig(projectDir);
  if (jobs.length === 0) return scheduled;

  for (const job of jobs) {
    const intervalMs = scheduleToMs(job.schedule);
    if (intervalMs === 0) continue;

    // v1.1.8 新增：task === 'ab-schedule' 走 A/B 调度分支（真实任务探索-利用
    // 状态机），不走 subagent run 路径——调用 orchestrator 包的
    // runABScheduledTask，指标落 {SOFAGENT_DATA}/ab-history.jsonl。
    if (job.task === 'ab-schedule') {
      scheduled += 1;
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
      scheduled += 1;
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

    // v1.4.5 第二章：task === 'continuous-training' 走持续后训练分支——
    // 数据回流（worklog+decision-log+llm-calls）→ 触发判定（阈值/定时）→
    // 复用 train-job 编排 + 回退保护。编排本体在 orchestrator
    // train-continuous，daemon 只装配调度入口（对齐 decision-memory 模式）。
    if (job.task === 'continuous-training') {
      scheduled += 1;
      console.log(`[cron] ${job.schedule} → continuous-training（持续后训练飞轮）`);
      setInterval(() => {
        void (async () => {
          try {
            const { runContinuousTrainingTick } = (await import('./tasks/continuous-training')) as {
              runContinuousTrainingTick: (dir: string) => Promise<{ executed: boolean; reason: string }>;
            };
            const tick = await runContinuousTrainingTick(projectDir);
            console.log(`[cron] continuous-training: ${tick.executed ? '已执行' : '未执行'}——${tick.reason}`);
          } catch (err) {
            console.error(`[cron] continuous-training 失败:`, (err as Error).message);
          }
        })();
      }, intervalMs);
      continue;
    }

    const agentName = job.agent || 'fde';
    const mode = job.mode || 'sustain';
    scheduled += 1;

    console.log(`[cron] ${job.schedule} → subagent run ${agentName} --mode ${mode}`);

    setInterval(() => {
      void (async () => {
      try {
        // subagent run 命令真身在 @sofagent/orchestrator 的 CLI（dist/cli.js）。
        // 旧实现 join(__dirname, '..', 'index.js') 指向 daemon 自己的
        // dist/index.js——该文件无 CLI 入口，execFileSync 静默 exit 0，
        // 巡检从未真正执行（路径断链）。改经 createRequire 按包名解析，
        // workspace 提升与 npm 安装两种形态都命中。
        const orchCli = join(
          dirname(nodeRequire.resolve('@sofagent/orchestrator/package.json')),
          'dist', 'cli.js',
        );
        const args = [
          orchCli, 'subagent', 'run', agentName,
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

  return scheduled;
}
