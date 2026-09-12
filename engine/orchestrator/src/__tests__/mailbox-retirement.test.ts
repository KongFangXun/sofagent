// ============================================================
// mailbox-retirement.test.ts · 条目 1 第 0 步：未接线兜底断言（深模块批一）
// ============================================================
// 背景：Agent Mailbox（v1.2.5）自引入起既无生产者也无消费者——
// graph.ts buildDeps 曾尝试初始化 mailboxInjector，但节点侧从未
// 消费（零 .injectMessages 调用）。本批整块退场。
// 本测试把「未接线」固化为显式契约：buildDeps 不再产出 mailboxInjector
// ——防止日后有人只加类型又当交付（幽灵缝防复发）。
// ============================================================
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('mailbox 退场契约（条目 1）', () => {
  it('mailbox 模块目录不存在（整块退场）', () => {
    expect(fs.existsSync(path.resolve(__dirname, '..', 'mailbox'))).toBe(false);
  });

  it('buildDeps 不产出 mailboxInjector（未接线固化为契约）', async () => {
    // 从 graph.ts 源码断言：不再有 mailboxInjector 初始化段
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'loop', 'graph.ts'), 'utf-8');
    expect(src).not.toContain('mailboxInjector');
    expect(src).not.toContain("require('../mailbox')");
  });

  it('nodes.ts 无 mailboxInjector 字段声明', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'loop', 'nodes.ts'), 'utf-8');
    expect(src).not.toContain('mailboxInjector');
  });

  it('全包源码零 mailbox 残留引用（.ts 活面）', () => {
    // 递归扫 orchestrator src（排除测试自身）
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
      }
      return out;
    };
    const files = walk(path.resolve(__dirname, '..'));
    const offenders = files.filter((f) => {
      const s = fs.readFileSync(f, 'utf-8');
      return s.includes('mailbox') || s.includes('Mailbox');
    });
    expect(offenders).toEqual([]);
  });
});
