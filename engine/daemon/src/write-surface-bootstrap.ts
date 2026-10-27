// ============================================================
// write-surface-bootstrap.ts · 章一写面留痕接线 · daemon 侧进程引导点（v1.7.0）
// ============================================================
// 一处引导、两个落点：
//   ① core 注入点：把 audit 侧的落盘 sink 注入 core 的 tracer 注册表——
//      写面留痕生效前提（未接线时 core 按遗留态放行，见 core.loadchain-write-hook）。
//   ⑤ 章二对接：sink 内把章一 WriteSurfaceTrace **投影**为章二 CapabilityChangeEvent，
//      回调 createBaselineSnapshot（写面变更 → 能力基线版本线节点 id）。
//      payload 用**事件对象**、不 import 章一实现——章二模块不耦合章一（两侧各自演进）。
//
// 引导点为何选 daemon（composition root）：进化循环（`sofagent daemon evolve`）、
// @weekly inspector（含 knowledge-health）等写面动作都在 daemon 进程内发生；core 的
// tracer 是**进程内单例**，引导点必须是这些写动作所在进程的入口。daemon cli.ts 的
// main() 在 version/help 之后、命令分派之前注入，一处覆盖全部子命令。
//
// 失败口径（两级）：
//   · 章一落盘（recordChain）失败 ⇒ 照实上抛——由 core.guardWriteSurface 回退 + 告警
//     （写面留痕的 fail-closed，章一契约）。
//   · 章二基线投影失败 ⇒ **可见告警但不阻断**（写面链已落盘；基线四层采集是下游派生，
//     不应让每次写面变更都因采集失败而被拖垮）。
// ============================================================

import { setWriteSurfaceTracer, type WriteSurfaceTrace } from '@sofagent/core';
// ⚠️ 临时：章一 createWriteSurfaceTracer 尚未从 @sofagent/audit 的 public-api 导出，
// 跨包取不到（已请 dev-writesurface 补 barrel 导出）。此处走包 exports 声明的
// `"./dist/*.js"` 子路径（package.json exports 内已开放），barrel 导出到位后切回惯用面。
import { createWriteSurfaceTracer } from '@sofagent/audit/dist/write-surface-log.js';
import { createBaselineSnapshot, type CapabilityChangeEventInput } from '@sofagent/evolve';

export interface WriteSurfaceTracingOptions {
  /** 数据根目录（缺省 core getDataDir()——与写盘同源） */
  dataDir?: string;
  /** 技能根覆盖（透传章二四层采集；缺省 resolveSkillRoot()） */
  skillRoot?: string;
}

/**
 * 章一 WriteSurfaceTrace → 章二 CapabilityChangeEvent 的投影。
 * before/after 取 diff 的**摘要**（entry-level 直取；field-level 拼字段级变更）。
 */
function projectTraceToEvent(trace: WriteSurfaceTrace): CapabilityChangeEventInput {
  const diff = (trace.diff ?? {}) as Record<string, unknown>;
  let before: string | null = null;
  let after: string | null = null;
  if (diff.mode === 'entry-level') {
    before = diff.before === undefined || diff.before === null ? null : String(diff.before);
    after = diff.after === undefined || diff.after === null ? null : String(diff.after);
  } else if (diff.mode === 'field-level') {
    const changes = Array.isArray(diff.changes)
      ? (diff.changes as Array<{ field?: unknown; before?: unknown; after?: unknown }>)
      : [];
    const b = changes.map((c) => `${String(c.field)}=${String(c.before)}`).join('; ');
    const a = changes.map((c) => `${String(c.field)}=${String(c.after)}`).join('; ');
    before = b === '' ? null : b;
    after = a === '' ? null : a;
  }
  return {
    kind: 'write-surface',
    actor: trace.actor,
    source: trace.origin,
    at: trace.ts,
    surface: trace.surface,
    target: trace.target,
    before,
    after,
    refTrace: trace.traceId,
  };
}

/**
 * 安装写面留痕接线（幂等——重复调用以最后一次为准，registry 为进程内单例）。
 * 须在发生写面动作的进程入口调用一次（daemon cli.ts main()）。
 */
export function installWriteSurfaceTracing(opts: WriteSurfaceTracingOptions = {}): void {
  const recordChain = createWriteSurfaceTracer(opts.dataDir);
  // v1.8.0（Q29 日志止血）：同一错误消息 1 小时内不重复打印——分钟级 daemon 周期
  // 反复撞同一失败时只记一次（本机实锤 13 万行重复 warn / 30MB 日志）。
  let lastErrMsg = '';
  let lastErrAt = 0;
  const THROTTLE_MS = 60 * 60 * 1000;
  setWriteSurfaceTracer((trace) => {
    // ① 章一：写面链落盘（fail-closed——抛错由 guardWriteSurface 回退 + 告警）
    recordChain(trace);
    // ⑤ 章二：落链成功后投影为能力变更事件 → 基线快照（best-effort，失败可见不阻断）
    try {
      createBaselineSnapshot(projectTraceToEvent(trace), {
        dataDir: opts.dataDir,
        ...(opts.skillRoot !== undefined ? { skillRoot: opts.skillRoot } : {}),
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== lastErrMsg || Date.now() - lastErrAt > THROTTLE_MS) {
          lastErrMsg = msg;
          lastErrAt = Date.now();
          console.error(
            `[write-surface-bootstrap] ⚠️ 基线快照生成失败（写面链已落盘，跳过章二投影）：${msg}`,
          );
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastErrMsg || Date.now() - lastErrAt > THROTTLE_MS) {
        lastErrMsg = msg;
        lastErrAt = Date.now();
        console.error(
          `[write-surface-bootstrap] ⚠️ 基线快照生成失败（写面链已落盘，跳过章二投影）：${msg}`,
        );
      }
    }
  });
}
