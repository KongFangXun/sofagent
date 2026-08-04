// ============================================================
// FORGE/src/visibility.mjs · 可见性核心层（agent 无关）
//
// 设计原则：任何能读文件的 Agent 都能消费进度。
// driver 在每个 hook 点调用 visibility.emit()，本模块负责：
//   1. 追加一行事件到 progress.jsonl（永久事件流）
//   2. 覆盖写 status.json（当前状态快照）
//   3. 调用所有已加载的适配器（可选推送）
//
// 适配器接口：reporter.emit(event) — 按需实现推送逻辑
// ============================================================

import {
  appendFileSync, writeFileSync, readFileSync,
  existsSync, mkdirSync,
} from 'fs';
import { join } from 'path';

/**
 * 事件类型常量 —— driver 7 个 hook 点 + 启动/结束
 */
export const EVENTS = {
  RUN_START:    'run-start',     // 整个循环启动
  ROUND_START:  'round-start',   // 某轮开始
  STEP_DONE:    'step-done',     // 某步骤完成（①②③④⑤）
  ROUND_END:    'round-end',     // 某轮结束（含停止判定）
  LOOP_END:     'loop-end',      // 整个循环结束
  ERROR:        'error',         // 错误
};

/**
 * 创建可见性管理器。
 *
 * @param {string} runDir       本次 run 的根目录（progress.jsonl / status.json 写在这里）
 * @param {Array}  reporters    已加载的适配器实例数组（可为空）
 * @returns {{emit: Function, getStatus: Function}}
 */
export function createVisibility(runDir, reporters = []) {
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });

  const progressPath = join(runDir, 'progress.jsonl');
  const statusPath   = join(runDir, 'status.json');

  /**
   * 发出一个进度事件。
   * 同时写 jsonl（追加）+ status.json（覆盖）+ 调用适配器。
   *
   * @param {string} event    EVENTS 常量之一
   * @param {object} detail   事件详情（round / step / counts / message 等）
   */
  function emit(event, detail = {}) {
    const timestamp = new Date().toISOString();
    const record = { timestamp, event, ...detail };

    // 1. 追加到 progress.jsonl
    try {
      appendFileSync(progressPath, JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      // 写文件失败不应该中断主流程
      console.error(`[visibility] 写 progress.jsonl 失败: ${err.message}`);
    }

    // 2. 覆盖写 status.json（当前状态快照）
    try {
      const status = buildStatusSnapshot(event, detail, timestamp);
      writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[visibility] 写 status.json 失败: ${err.message}`);
    }

    // 3. 调用适配器（适配器失败不中断主流程）
    for (const reporter of reporters) {
      try {
        reporter.emit(event, detail, timestamp);
      } catch (err) {
        console.error(`[visibility] 适配器 ${reporter.name} 失败: ${err.message}`);
      }
    }
  }

  /**
   * 读取当前状态（从 status.json）。
   * 供外部工具或 Agent 查询用。
   */
  function getStatus() {
    if (!existsSync(statusPath)) return null;
    try {
      return JSON.parse(readFileSync(statusPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 🔴 v1.2.7 心跳更新（SIGKILL 场景必备）。
   * 只更新 status.json 的 heartbeat + lastUpdate 字段，
   * 不写 progress.jsonl（避免事件流被心跳污染）。
   *
   * 用途：driver 主循环每 15s 调一次，监控端发现 heartbeat
   * 超过 60s 没更新 → driver 已被 SIGKILL。
   */
  function heartbeat() {
    try {
      const current = getStatus();
      if (!current) return;  // status.json 还不存在，跳过
      const now = new Date().toISOString();
      current.heartbeat = now;
      current.lastUpdate = now;
      writeFileSync(statusPath, JSON.stringify(current, null, 2) + '\n', 'utf-8');
    } catch {
      // 心跳失败不中断主流程
    }
  }

  return { emit, getStatus, heartbeat };
}

/**
 * 构建 status.json 快照。
 * 保留最近状态 + 累计统计 + 心跳时间戳。
 *
 * 🔴 v1.2.7 教训（run-01 SIGKILL 事件）：
 * driver 被 SIGKILL 时所有 Node handler 都来不及执行，
 * status.json 停在最后一次 emit 的状态，监控端无法区分
 * "在跑"和"已死"。解法：heartbeat 字段让监控端做超时判断。
 */
function buildStatusSnapshot(event, detail, timestamp) {
  const snapshot = {
    lastUpdate: timestamp,
    heartbeat: timestamp,  // 🔴 心跳：监控端用此字段判断 driver 是否存活
    event,
    ...detail,
  };

  // 根据事件类型补充 phase 字段
  if (event === EVENTS.RUN_START) {
    snapshot.phase = 'starting';
  } else if (event === EVENTS.ROUND_START) {
    snapshot.phase = `round-${detail.round}-running`;
  } else if (event === EVENTS.STEP_DONE) {
    snapshot.phase = `round-${detail.round}/step-${detail.step}-done`;
  } else if (event === EVENTS.ROUND_END) {
    snapshot.phase = detail.isClean
      ? `round-${detail.round}-clean`
      : `round-${detail.round}-issues`;
  } else if (event === EVENTS.LOOP_END) {
    snapshot.phase = 'completed';
  } else if (event === EVENTS.ERROR) {
    snapshot.phase = 'error';
  }

  return snapshot;
}
