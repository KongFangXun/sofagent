// push-target.ts · MCP push target 路由（v1.3.3 新增）
// workflow.yml 节点支持 output.target，daemon 监听任务完成事件按配置路由推送
//
// 支持目标：
//   - webhook:dingtalk  → 钉钉机器人 webhook
//   - webhook:feishu    → 飞书机器人 webhook
//   - webhook:wecom     → 企业微信机器人 webhook
//   - openclaw:im       → OpenClaw IM channel
//   - daemon:notice     → daemon 本地通知（console + log）
//
// 环境变量：
//   SOFAGENT_WEBHOOK_DINGTALK / SOFAGENT_WEBHOOK_FEISHU / SOFAGENT_WEBHOOK_WECOM
//
// v1.2.5 §8.2.1：推送函数包裹 withRetry（指数退避 + jitter）
// v1.2.5 §8.5：im-outbox 生命周期增强——推送成功后删除源文件 / 失败移入 failed/
// ============================================================

import { notify } from './notify';
import { DATA_DIR } from '@sofagent/core';
import { withRetry, withRetryBestEffort } from './with-retry';

export type PushTargetKind =
  | 'webhook:dingtalk'
  | 'webhook:feishu'
  | 'webhook:wecom'
  | 'openclaw:im'
  | 'daemon:notice';

export interface PushOptions {
  target: PushTargetKind;
  title: string;
  message: string;
  /** 推送失败时是否抛错（默认 false——target 配错不阻断主流程） */
  throwOnError?: boolean;
}

const ENV_KEY: Record<'webhook:dingtalk' | 'webhook:feishu' | 'webhook:wecom', string> = {
  'webhook:dingtalk': 'SOFAGENT_WEBHOOK_DINGTALK',
  'webhook:feishu': 'SOFAGENT_WEBHOOK_FEISHU',
  'webhook:wecom': 'SOFAGENT_WEBHOOK_WECOM',
};

/** 解析 output.target 字符串为 PushTargetKind */
export function parsePushTarget(target: string | undefined): PushTargetKind | null {
  if (!target) return null;
  const valid: PushTargetKind[] = [
    'webhook:dingtalk',
    'webhook:feishu',
    'webhook:wecom',
    'openclaw:im',
    'daemon:notice',
  ];
  return valid.includes(target as PushTargetKind) ? (target as PushTargetKind) : null;
}

/**
 * 推送消息到指定 target
 * - 失败时默认 warning 不抛错（push target 是辅助通道，不该阻断任务）
 * - 返回 true/false 表示推送是否成功
 * - v1.2.5 §8.2.1：webhook 推送包裹 withRetry（3 次重试 + 指数退避）
 */
export async function pushToTarget(options: PushOptions): Promise<boolean> {
  const { target, title, message, throwOnError = false } = options;
  try {
    switch (target) {
      case 'webhook:dingtalk':
      case 'webhook:feishu':
      case 'webhook:wecom':
        // §8.2.1：webhook 包裹 withRetry（指数退避 + jitter）
        return await withRetry(
          () => pushWebhook(target, title, message),
          { context: `push-webhook:${target}` },
        );
      case 'openclaw:im':
        return await pushOpenClawIM(title, message);
      case 'daemon:notice':
        notify(`${title}: ${message}`, { source: 'push-target', level: 'info' });
        return true;
      default:
        notify(`未知 push target: ${target}`, { source: 'push-target', level: 'warn' });
        return false;
    }
  } catch (err) {
    const msg = (err as Error).message;
    notify(`push target ${target} 失败: ${msg}`, { source: 'push-target', level: 'warn' });
    if (throwOnError) throw err;
    return false;
  }
}

async function pushWebhook(
  target: 'webhook:dingtalk' | 'webhook:feishu' | 'webhook:wecom',
  title: string,
  message: string
): Promise<boolean> {
  const envKey = ENV_KEY[target];
  const webhookUrl = process.env[envKey];
  if (!webhookUrl) {
    notify(`webhook ${target} 未配置环境变量 ${envKey}`, { source: 'push-target', level: 'warn' });
    return false;
  }

  // 三种 IM 的 payload 格式不同
  let body: string;
  if (target === 'webhook:dingtalk') {
    body = JSON.stringify({
      msgtype: 'markdown',
      markdown: { title, text: `## ${title}\n\n${message}` },
    });
  } else if (target === 'webhook:feishu') {
    body = JSON.stringify({
      msg_type: 'text',
      content: { text: `${title}\n\n${message}` },
    });
  } else {
    // wecom
    body = JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: `## ${title}\n\n${message}` },
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      notify(`webhook ${target} HTTP ${res.status}`, { source: 'push-target', level: 'warn' });
      return false;
    }
    return true;
  } catch (err) {
    notify(`webhook ${target} 请求失败: ${(err as Error).message}`, { source: 'push-target', level: 'warn' });
    return false;
  }
}

/** im-outbox 保留天数——超过自动清理(+ §8.5） */
const OUTBOX_RETENTION_DAYS = 7;

/** im-outbox 单目录文件数上限——超过告警并停止写入 */
const OUTBOX_MAX_FILES = 100;

/**
 * §8.5 im-outbox 生命周期增强：
 * 推送成功后从 outbox 删除文件（不只是标记），推送失败移入 failed/ 目录。
 *
 * 本函数在 im-outbox 中创建消息文件，并返回文件名，
 * 调用方（dream-cycle 或推送循环）在确认 OpenClaw 端拉取成功后调用 deleteOutboxFile，
 * 或在拉取失败时调用 moveOutboxToFailed。
 */

/**
 * 删除 im-outbox 中指定的文件（推送成功后调用）。
 *
 * @param filename im-outbox 目录中的文件名
 * @returns 删除成功返回 true
 */
export function deleteOutboxFile(filename: string): boolean {
  const fs = require('fs');
  const { join } = require('path');
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  const outboxDir = join(dataDir, 'im-outbox');
  const filePath = join(outboxDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      notify(`im-outbox 文件已删除（推送成功）: ${filename}`, { source: 'push-target', level: 'info' });
      return true;
    }
    return false;
  } catch (err) {
    notify(`im-outbox 文件删除失败: ${(err as Error).message}`, { source: 'push-target', level: 'warn' });
    return false;
  }
}

/**
 * 将 im-outbox 中的文件移入 failed/ 子目录（推送失败且重试耗尽后调用）。
 *
 * @param filename im-outbox 目录中的文件名
 * @returns 移动成功返回 true
 */
export function moveOutboxToFailed(filename: string): boolean {
  const fs = require('fs');
  const { join } = require('path');
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  const outboxDir = join(dataDir, 'im-outbox');
  const failedDir = join(outboxDir, 'failed');
  const srcPath = join(outboxDir, filename);
  const dstPath = join(failedDir, filename);
  try {
    if (!fs.existsSync(failedDir)) {
      fs.mkdirSync(failedDir, { recursive: true });
    }
    if (fs.existsSync(srcPath)) {
      fs.renameSync(srcPath, dstPath);
      notify(`im-outbox 文件已移入 failed/（推送失败）: ${filename}`, { source: 'push-target', level: 'warn' });
      return true;
    }
    return false;
  } catch (err) {
    notify(`im-outbox 文件移入 failed/ 失败: ${(err as Error).message}`, { source: 'push-target', level: 'warn' });
    return false;
  }
}

/**
 * 清理 im-outbox/failed/ 目录中超过保留期的文件。
 * 由 cron 定期调用。
 */
export function cleanupFailedOutbox(): number {
  const fs = require('fs');
  const { join } = require('path');
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  const outboxDir = join(dataDir, 'im-outbox');
  const failedDir = join(outboxDir, 'failed');
  if (!fs.existsSync(failedDir)) return 0;

  const now = Date.now();
  const retentionMs = OUTBOX_RETENTION_DAYS * 24 * 3600 * 1000;
  let cleaned = 0;

  try {
    const files = fs.readdirSync(failedDir) as string[];
    for (const f of files) {
      try {
        const st = fs.statSync(join(failedDir, f));
        if (now - st.mtimeMs > retentionMs) {
          fs.rmSync(join(failedDir, f), { force: true });
          cleaned++;
        }
      } catch {
        // 单个文件读不了不影响清理流程
      }
    }
  } catch {
    // 目录读取失败忽略
  }

  if (cleaned > 0) {
    notify(`im-outbox/failed/ 清理 ${cleaned} 个过期文件`, { source: 'push-target', level: 'info' });
  }
  return cleaned;
}

async function pushOpenClawIM(title: string, message: string): Promise<boolean> {
  // OpenClaw IM channel——通过本地 socket / 配置文件桥接
  // v1.1.5 最小实现：写入 im-outbox/ 由 OpenClaw 端拉取
  // v1.2.1：默认输出目录从 .sofagent/im-outbox/ 迁移到 data/im-outbox/
  // v1.2.5 im-outbox 数据爆炸修复——加保留策略 + 上限 + 去重：
  //   ① 写入前清理超过 7 天的旧文件（保留策略）
  //   ② 单目录文件数达上限（100）时告警并停止写入（上限）
  //   ③ 同内容文件已存在则跳过写入（去重——知识沉淀周报不再重复落盘）
  // v1.2.5 §8.5：im-outbox 生命周期增强——成功删除源文件接口 + 失败移入 failed/
  //   ④ 提供 deleteOutboxFile() / moveOutboxToFailed() 供调用方管理生命周期
  const { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync, statSync } = await import('fs');
  const { join } = await import('path');
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  const outboxDir = join(dataDir, 'im-outbox');
  try {
    if (!existsSync(outboxDir)) mkdirSync(outboxDir, { recursive: true });

    const now = Date.now();
    const retentionMs = OUTBOX_RETENTION_DAYS * 24 * 3600 * 1000;
    let fileList = readdirSync(outboxDir).filter((f) => f.endsWith('.md'));

    // ① 保留策略：清理超过保留期的旧文件
    const survivors: string[] = [];
    for (const f of fileList) {
      try {
        const st = statSync(join(outboxDir, f));
        if (now - st.mtimeMs > retentionMs) {
          rmSync(join(outboxDir, f), { force: true });
        } else {
          survivors.push(f);
        }
      } catch {
        survivors.push(f); // 读不了状态的不删（保守）
      }
    }
    fileList = survivors;

    // ② 上限：超过阈值告警并停止写入（防数据爆炸）
    if (fileList.length >= OUTBOX_MAX_FILES) {
      notify(
        `im-outbox 文件数达上限（${fileList.length}/${OUTBOX_MAX_FILES}），停止写入——请检查 OpenClaw 端是否正常拉取`,
        { source: 'push-target', level: 'warn' },
      );
      return false;
    }

    // ③ 去重：同内容已存在则跳过（幂等，不再重复落盘）
    const body = `# ${title}\n\n${message}\n`;
    for (const f of fileList) {
      try {
        if (readFileSync(join(outboxDir, f), 'utf-8') === body) {
          return true; // 已存在相同内容——跳过写入
        }
      } catch {
        // 单个文件读不了不影响去重流程
      }
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
    writeFileSync(join(outboxDir, filename), body);
    return true;
  } catch (err) {
    notify(`openclaw:im 写入失败: ${(err as Error).message}`, { source: 'push-target', level: 'warn' });
    return false;
  }
}
