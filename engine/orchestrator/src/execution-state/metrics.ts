// ============================================================
// execution-state/metrics.ts · v1.5.5 章一 · 全局度量落盘
// ============================================================
// 每节点 token 曲线（对齐论文 O(1) 平线）/ 轮次稳定性 / 结果质量对比
// （stateful vs legacy）落 data/evolution/stateful-metrics.jsonl——
// Dashboard 可见（serve-dashboard 的 evolution 面消费 data/evolution/ 既有通道）。
//
// 写入为 append-only JSONL（一行一节点一次执行的度量快照）。
// ============================================================

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

/** 单节点一次执行的度量记录 */
export interface StatefulMetricRecord {
  timestamp: string;
  /** 节点标识 */
  node: string;
  /** 节点类型 */
  kind: string;
  /** 执行模式（stateful / legacy） */
  mode: 'stateful' | 'legacy';
  /** 是否经自动降级 */
  autoDegraded: boolean;
  /** 每步 prompt token 估算曲线（stateful 应近似平线 O(1)） */
  stepTokens: number[];
  /** 总轮次 */
  steps: number;
  /** 补丁拒绝次数 */
  patchRejections: number;
  /** 成功与否 */
  success: boolean;
  /** 耗时 ms */
  durationMs: number;
}

/** 度量接收器（测试可注入；缺省落 data/evolution/stateful-metrics.jsonl） */
export interface MetricsSink {
  write(record: StatefulMetricRecord): void;
}

/** 文件 sink（生产路径）——dataDir 解析失败时降级 stderr 留痕（不静默丢） */
export function fileSink(dataDir?: string): MetricsSink {
  return {
    write(record) {
      try {
        const dir = dataDir
          ? join(dataDir, 'evolution')
          : join(process.env.SOFAGENT_DATA ?? 'data', 'evolution');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'stateful-metrics.jsonl'), JSON.stringify(record) + '\n');
      } catch (err) {
        process.stderr.write(
          `[sofagent] stateful-metrics 落盘失败（本次度量丢失，不阻塞执行）: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },
  };
}

/** 估算一段文本的 token 数（无 tokenizer 依赖的粗估——中英混排按字符加权） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 粗估口径：CJK 字符 ≈1 token/字，拉丁词 ≈1.3 token/词（对齐常见 tokenizer 经验值）
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;
  return Math.ceil(cjk + words * 1.3);
}
