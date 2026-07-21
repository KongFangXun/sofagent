// push-target.ts · MCP push target 路由（v1.1.8 新增）
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
// ============================================================

import { notify } from './notify';

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
 */
export async function pushToTarget(options: PushOptions): Promise<boolean> {
  const { target, title, message, throwOnError = false } = options;
  try {
    switch (target) {
      case 'webhook:dingtalk':
      case 'webhook:feishu':
      case 'webhook:wecom':
        return await pushWebhook(target, title, message);
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

async function pushOpenClawIM(title: string, message: string): Promise<boolean> {
  // OpenClaw IM channel——通过本地 socket / 配置文件桥接
  // v1.1.5 最小实现：写入 .sofagent/im-outbox/ 由 OpenClaw 端拉取
  const { writeFileSync, mkdirSync, existsSync } = await import('fs');
  const { join } = await import('path');
  const dataDir = process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
  const outboxDir = join(dataDir, 'im-outbox');
  try {
    if (!existsSync(outboxDir)) mkdirSync(outboxDir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
    writeFileSync(join(outboxDir, filename), `# ${title}\n\n${message}\n`);
    return true;
  } catch (err) {
    notify(`openclaw:im 写入失败: ${(err as Error).message}`, { source: 'push-target', level: 'warn' });
    return false;
  }
}
