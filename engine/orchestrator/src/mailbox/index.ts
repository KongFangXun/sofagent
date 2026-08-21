// ============================================================
// mailbox/index.ts · Agent Mailbox 导出 + 类型
// v1.3.9 新建 · 功能 ⑨
// ============================================================

import { MailboxStore } from './mailbox';
import { MessageInjector } from './message-injector';

export type { MailboxAPI, MailboxMessage, MessagePriority } from './mailbox';
export { MailboxStore } from './mailbox';
export { MessageInjector } from './message-injector';

/**
 * 创建 MailboxStore + MessageInjector 组合实例。
 * @param dataDir 数据目录（baseDir = dataDir/agent-mailbox/）
 */
export function createMailbox(dataDir: string): {
  store: MailboxStore;
  injector: MessageInjector;
} {
  const { join } = require('path');
  const baseDir = join(dataDir, 'agent-mailbox');
  const store = new MailboxStore(baseDir);
  const injector = new MessageInjector(store);
  return { store, injector };
}
