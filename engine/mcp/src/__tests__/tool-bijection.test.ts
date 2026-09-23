// ============================================================
// tool-bijection.test.ts · 注册↔分发双射守卫（v1.4.8 深模块条目 5 第 0 步）
// ============================================================
// 替换「人工纪律」：每条 TOOLS 必有 handler（迁移完成态——分发单一来源）
// + name 唯一 + mcp-server 的 switch 回退已退场。
// 迁移期曾为双轨（handler 或 switch case 至少其一）；本批收口后收紧为全量必填。
// ============================================================
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../tool-registry';
import * as fs from 'fs';
import * as path from 'path';

describe('条目 5 · 注册↔分发双射守卫（第 0 步）', () => {
  it('TOOLS 恰为 107（门禁锚——不可变；v1.4.9 95→104 + v1.5.0 章八 trace 对账 104→105 + v1.5.2 章一/章二 audit_query/ruleset_export 105→107）', () => {
    expect(TOOLS).toHaveLength(107);
  });

  it('name 全局唯一（双射前提）', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('全量迁移完成：107 条 TOOLS 全部有 handler（必填——分发单一来源）', () => {
    const migrated = TOOLS.filter((t) => t.handler !== undefined);
    for (const t of migrated) {
      expect(typeof t.handler).toBe('function');
    }
    expect(migrated).toHaveLength(TOOLS.length);
    expect(migrated.length).toBe(107);
  });

  it('mcp-server 的 switch 分发表已退场（registry handler 为唯一分发源）', () => {
    const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', 'mcp-server.ts'), 'utf8');
    expect(serverSrc).not.toContain('switch (toolName)');
    for (const t of TOOLS) {
      expect(serverSrc).not.toContain(`case '${t.name}'`);
    }
  });
});
