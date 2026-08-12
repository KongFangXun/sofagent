// ============================================================
// mailbox/message-injector.ts · 节点开始前扫描邮箱 → 注入 system prompt
// v1.3.3 新建 · 功能 ⑨
//
// 消息注入流程：
//   1. SubAgent A 调 send() 投递消息 → 写入目标 agent inbox JSON 文件
//   2. 目标 agent 节点开始执行前，Node wrapper 调 injectMessages()
//   3. MessageInjector 调 readUnread() 扫描 inbox，过滤 read=false，按 priority 排序
//   4. 高优先级消息注入 system prompt 末尾（不中断执行，只补充上下文）
//   5. 调 markRead() 标记已读
//
// 非中断执行——邮箱扫描只补充上下文，不暂停当前节点
// ============================================================

import type { MailboxAPI, MailboxMessage } from './mailbox';

/**
 * 消息注入器——节点执行前扫描邮箱，注入高优先级消息到 system prompt。
 */
export class MessageInjector {
  constructor(private readonly mailbox: MailboxAPI) {}

  /**
   * 注入未读消息到 system prompt。
   *
   * 注入格式（追加到 system prompt 末尾）：
   *   <!-- mailbox messages -->
   *   ## 邮箱消息（来自其他 Agent）
   *   ### [HIGH] 来自 engineer: 发现问题...
   *   ### [NORMAL] 来自 reviewer: 审查建议...
   *
   * 非中断执行——只补充上下文，不暂停当前节点。
   *
   * @param agentName 接收者 agent 名称
   * @param systemPrompt 原始 system prompt
   * @returns 注入消息后的 system prompt（无消息时原样返回）
   */
  injectMessages(agentName: string, systemPrompt: string): string {
    const unread = this.mailbox.readUnread(agentName);

    if (unread.length === 0) return systemPrompt;

    // 构建注入文本
    const lines: string[] = [
      '',
      '<!-- mailbox messages -->',
      `## 邮箱消息（来自其他 Agent · ${unread.length} 条）`,
    ];

    for (const msg of unread) {
      const priorityTag = msg.priority.toUpperCase();
      const subject = msg.subject.length > 100 ? msg.subject.slice(0, 100) + '...' : msg.subject;
      lines.push(`### [${priorityTag}] 来自 ${msg.from}: ${subject}`);
      lines.push(msg.body);
      lines.push('');
    }

    // 标记已读（注入即已读）
    for (const msg of unread) {
      this.mailbox.markRead(agentName, msg.id);
    }

    return systemPrompt + '\n' + lines.join('\n');
  }

  /**
   * 获取未读消息数（不标记已读）。
   */
  getUnreadCount(agentName: string): number {
    return this.mailbox.readUnread(agentName).length;
  }

  /**
   * 获取未读消息列表（不标记已读）。
   */
  getUnreadMessages(agentName: string): MailboxMessage[] {
    return this.mailbox.readUnread(agentName);
  }
}
