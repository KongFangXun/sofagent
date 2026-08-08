// mailbox.test.ts · Agent Mailbox 发送/接收/注入全流程单测
// v1.2.9 新建 · 功能 ⑨

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MailboxStore } from '../mailbox/mailbox';
import { MessageInjector } from '../mailbox/message-injector';
import type { MailboxMessage, MessagePriority } from '../mailbox/mailbox';

describe('Agent Mailbox', () => {
  let tmpDir: string;
  let store: MailboxStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mailbox-'));
    store = new MailboxStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── MailboxStore ──────────────────────────────

  describe('MailboxStore', () => {
    describe('send', () => {
      it('发送消息返回 ID', () => {
        const id = store.send({
          from: 'agent-a',
          to: 'agent-b',
          subject: '测试消息',
          body: '这是消息内容',
          priority: 'normal',
        });
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
      });

      it('发送后消息文件存在于 inbox 目录', () => {
        store.send({
          from: 'agent-a',
          to: 'agent-b',
          subject: '测试',
          body: '内容',
          priority: 'high',
        });
        const messages = store.read('agent-b');
        expect(messages).toHaveLength(1);
      });
    });

    describe('read', () => {
      it('读取所有消息（按优先级排序）', () => {
        store.send({
          from: 'a', to: 'b', subject: 'low msg', body: 'x', priority: 'low',
        });
        store.send({
          from: 'a', to: 'b', subject: 'high msg', body: 'x', priority: 'high',
        });
        store.send({
          from: 'a', to: 'b', subject: 'normal msg', body: 'x', priority: 'normal',
        });

        const messages = store.read('b');
        expect(messages).toHaveLength(3);
        // high 排最前
        expect(messages[0]!.priority).toBe('high');
        expect(messages[1]!.priority).toBe('normal');
        expect(messages[2]!.priority).toBe('low');
      });

      it('空 inbox 返回空数组', () => {
        expect(store.read('nonexistent-agent')).toEqual([]);
      });
    });

    describe('readUnread', () => {
      it('只返回未读消息', () => {
        // 使用不同 priority 确保排序确定性（避免同毫秒时间戳导致 localeCompare 不稳定）
        store.send({
          from: 'a', to: 'b', subject: 'msg1', body: 'x', priority: 'high',
        });
        store.send({
          from: 'a', to: 'b', subject: 'msg2', body: 'x', priority: 'normal',
        });

        // 标记第一条（high 排序后必定是 all[0]）已读
        const all = store.read('b');
        store.markRead('b', all[0]!.id);

        const unread = store.readUnread('b');
        expect(unread).toHaveLength(1);
        expect(unread[0]!.subject).toBe('msg2');
      });

      it('全部已读时返回空数组', () => {
        store.send({
          from: 'a', to: 'b', subject: 'msg', body: 'x', priority: 'normal',
        });
        const all = store.read('b');
        store.markRead('b', all[0]!.id);

        expect(store.readUnread('b')).toEqual([]);
      });
    });

    describe('markRead', () => {
      it('标记后 read=true', () => {
        const id = store.send({
          from: 'a', to: 'b', subject: 'msg', body: 'x', priority: 'normal',
        });
        store.markRead('b', id);
        const all = store.read('b');
        expect(all[0]!.read).toBe(true);
      });

      it('标记不存在的消息 ID 不报错', () => {
        expect(() => store.markRead('b', 'nonexistent-id')).not.toThrow();
      });
    });
  });

  // ── MessageInjector ──────────────────────────────

  describe('MessageInjector', () => {
    it('无未读消息时 system prompt 原样返回', () => {
      const injector = new MessageInjector(store);
      const prompt = '原始 system prompt';
      const result = injector.injectMessages('agent-b', prompt);
      expect(result).toBe(prompt);
    });

    it('有未读消息时注入到 system prompt 末尾', () => {
      store.send({
        from: 'agent-a',
        to: 'agent-b',
        subject: '发现问题',
        body: '请检查文件 X',
        priority: 'high',
      });

      const injector = new MessageInjector(store);
      const prompt = '你是 agent-b';
      const result = injector.injectMessages('agent-b', prompt);

      expect(result).toContain('你是 agent-b');
      expect(result).toContain('邮箱消息');
      expect(result).toContain('[HIGH]');
      expect(result).toContain('发现问题');
      expect(result).toContain('请检查文件 X');
    });

    it('注入后消息标记为已读', () => {
      const id = store.send({
        from: 'a', to: 'b', subject: 'msg', body: 'x', priority: 'normal',
      });

      const injector = new MessageInjector(store);
      injector.injectMessages('b', 'prompt');

      // 再次注入应该没有未读消息
      const result2 = injector.injectMessages('b', 'prompt');
      expect(result2).toBe('prompt');
    });

    it('多条消息按优先级排序注入', () => {
      store.send({ from: 'a', to: 'b', subject: 'low', body: 'L', priority: 'low' });
      store.send({ from: 'a', to: 'b', subject: 'high', body: 'H', priority: 'high' });

      const injector = new MessageInjector(store);
      const result = injector.injectMessages('b', 'prompt');

      // high 在前
      const highIdx = result.indexOf('[HIGH]');
      const lowIdx = result.indexOf('[LOW]');
      expect(highIdx).toBeGreaterThan(-1);
      expect(lowIdx).toBeGreaterThan(-1);
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it('getUnreadCount 返回未读数', () => {
      store.send({ from: 'a', to: 'b', subject: 'msg1', body: 'x', priority: 'normal' });
      store.send({ from: 'a', to: 'b', subject: 'msg2', body: 'x', priority: 'normal' });

      const injector = new MessageInjector(store);
      expect(injector.getUnreadCount('b')).toBe(2);
    });
  });

  // ── 并发投递 ──────────────────────────────

  describe('并发投递', () => {
    it('多条消息并发写入不丢消息', () => {
      // 模拟并发投递（顺序写入，验证不丢）
      for (let i = 0; i < 10; i++) {
        store.send({
          from: 'a',
          to: 'b',
          subject: `msg-${i}`,
          body: `body-${i}`,
          priority: 'normal' as MessagePriority,
        });
      }

      const all = store.read('b');
      expect(all).toHaveLength(10);
    });
  });
});
