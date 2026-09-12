// ============================================================
// tool-bijection.test.ts · 注册↔分发双射守卫（v1.4.8 深模块条目 5 第 0 步）
// ============================================================
// 替换「人工纪律」：每条 TOOLS 必有 handler（迁移完成态）+ name 唯一 +
// 迁移期双轨（handler 或 switch case 至少其一）。
// 骨架阶段断言：name 唯一 + 已迁工具 handler 在位；迁移完成后收紧为全量必填。
// ============================================================
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../tool-registry';
import * as fs from 'fs';
import * as path from 'path';

describe('条目 5 · 注册↔分发双射守卫（第 0 步）', () => {
  it('TOOLS 恰为 95（门禁锚——不可变）', () => {
    expect(TOOLS).toHaveLength(95);
  });

  it('name 全局唯一（双射前提）', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('已迁 handler 的工具：handler 是函数（形态校验）', () => {
    const migrated = TOOLS.filter((t) => t.handler !== undefined);
    for (const t of migrated) {
      expect(typeof t.handler).toBe('function');
    }
    // 骨架阶段已迁 ≥0（本批首批迁移后该下界上调）
    expect(migrated.length).toBeGreaterThanOrEqual(0);
  });

  it('双轨完整性：每条 TOOLS 有 handler 或 mcp-server 有对应 case（迁移期不变式）', () => {
    const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', 'mcp-server.ts'), 'utf8');
    const missing: string[] = [];
    for (const t of TOOLS) {
      if (typeof t.handler === 'function') continue; // handler 在位
      if (serverSrc.includes(`case '${t.name}'`)) continue; // switch 兜底在位
      missing.push(t.name);
    }
    expect(missing).toEqual([]); // 任何工具既无 handler 又无 case = 分发黑洞
  });
});
