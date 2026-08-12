// ============================================================
// mailbox/mailbox.ts · SubAgent 间异步消息邮箱
// v1.3.3 新建 · 功能 ⑨
//
// 邮箱目录：data/agent-mailbox/<agent-name>/inbox/*.json
// 文件名：<timestamp>-<uuid>.json
//
// 消息保留策略：v1.3.3 不自动清理（只标记 read），手动清理留 v1.3.3
// ============================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

/** 消息优先级 */
export type MessagePriority = 'high' | 'normal' | 'low';

/** 邮箱消息 */
export interface MailboxMessage {
  /** UUID 或时间戳 */
  id: string;
  /** 发送者 agent name */
  from: string;
  /** 接收者 agent name */
  to: string;
  /** 主题（≤100 字符） */
  subject: string;
  /** 正文 */
  body: string;
  /** 优先级 */
  priority: MessagePriority;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 是否已读 */
  read: boolean;
}

/** 邮箱 API 接口 */
export interface MailboxAPI {
  /** 发送消息 */
  send(msg: Omit<MailboxMessage, 'id' | 'timestamp' | 'read'>): string;
  /** 读取所有消息 */
  read(agentName: string): MailboxMessage[];
  /** 读取未读消息 */
  readUnread(agentName: string): MailboxMessage[];
  /** 标记已读 */
  markRead(agentName: string, msgId: string): void;
}

/** 优先级排序权重 */
const PRIORITY_WEIGHT: Record<MessagePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * 邮箱存储实现（文件系统持久化）。
 * baseDir = data/agent-mailbox/
 */
export class MailboxStore implements MailboxAPI {
  constructor(private readonly baseDir: string) {}

  /** 获取 agent 的 inbox 目录 */
  private inboxDir(agentName: string): string {
    return join(this.baseDir, agentName, 'inbox');
  }

  /** 确保目录存在 */
  private ensureDir(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /**
   * 发送消息——写入目标 agent 的 inbox。
   * @returns 消息 ID
   */
  send(msg: Omit<MailboxMessage, 'id' | 'timestamp' | 'read'>): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const fullMsg: MailboxMessage = {
      ...msg,
      id,
      timestamp,
      read: false,
    };

    const dir = this.inboxDir(msg.to);
    this.ensureDir(dir);

    const filename = `${timestamp.replace(/[:.]/g, '-')}-${id}.json`;
    const filepath = join(dir, filename);
    writeFileSync(filepath, JSON.stringify(fullMsg, null, 2));

    return id;
  }

  /**
   * 读取 agent 的所有消息（按优先级 + 时间排序）。
   */
  read(agentName: string): MailboxMessage[] {
    const dir = this.inboxDir(agentName);
    if (!existsSync(dir)) return [];

    const messages: MailboxMessage[] = [];
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        messages.push(JSON.parse(content) as MailboxMessage);
      } catch {
        // 损坏文件跳过
      }
    }

    // 按优先级排序，同优先级按时间排序
    return messages.sort((a, b) => {
      const prioDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (prioDiff !== 0) return prioDiff;
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  /**
   * 读取未读消息（按优先级排序）。
   */
  readUnread(agentName: string): MailboxMessage[] {
    return this.read(agentName).filter((m) => !m.read);
  }

  /**
   * 标记消息已读。
   */
  markRead(agentName: string, msgId: string): void {
    const dir = this.inboxDir(agentName);
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filepath = join(dir, file);
      try {
        const content = readFileSync(filepath, 'utf-8');
        const msg = JSON.parse(content) as MailboxMessage;
        if (msg.id === msgId && !msg.read) {
          msg.read = true;
          writeFileSync(filepath, JSON.stringify(msg, null, 2));
          return;
        }
      } catch {
        // 损坏文件跳过
      }
    }
  }
}
