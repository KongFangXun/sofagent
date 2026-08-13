// ============================================================
// federation-injection.test.ts · 联邦知识加载链注入测试
// v1.1.8 新增
//
// 覆盖用例（共 2 case）：
//   1. knowledge/federation/ 存在时 → 注入且 <untrusted source="federation"> 包裹，
//      位置在本地 knowledge/ 之前
//   2. knowledge/federation/ 不存在 → 静默跳过，不影响其余加载链
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { buildConstrainedSystemPrompt } from '../index';

describe('联邦知识注入（加载链第 3 层）', () => {
  let tmpRoot: string;
  let skillDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fed-'));
    skillDir = path.join(tmpRoot, '.sofagent');
    fs.mkdirSync(path.join(skillDir, 'knowledge', 'federation'), { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  // 用例 1：联邦知识包裹注入（v1.3.1 交付 14 渐进加载——热点全文含联邦时仍强制 untrusted 包裹）
  it('federation 热点内容 → <untrusted source="federation"> 包裹注入；本地知识不包裹', () => {
    // 联邦文件设较新 mtime——确保进入「热点全文」注入
    const fedPath = path.join(skillDir, 'knowledge', 'federation', 'peer-note.md');
    fs.writeFileSync(fedPath, 'peer 跨设备经验');
    fs.writeFileSync(path.join(skillDir, 'knowledge', 'local-note.md'), '本机沉淀');
    const newer = new Date(Date.now() + 60_000);
    fs.utimesSync(fedPath, newer, newer);

    const prompt = buildConstrainedSystemPrompt(tmpRoot);
    // 热点全文（含联邦）→ untrusted 包裹
    expect(prompt).toContain('<untrusted source="federation">');
    expect(prompt).toContain('peer 跨设备经验');
    expect(prompt).toContain('</untrusted>');
    // 本地知识不包裹
    expect(prompt).not.toContain('<untrusted source="federation">\n本机沉淀');
    // 本地知识仍注入（热点或索引可寻址）
    expect(prompt).toContain('本机沉淀');
  });

  // 用例 2：无 federation 目录 → 静默跳过
  it('无 federation 目录 → 不注入 untrusted 块，其余加载链不受影响', () => {
    fs.rmSync(path.join(skillDir, 'knowledge', 'federation'), { recursive: true, force: true });
    fs.writeFileSync(path.join(skillDir, 'knowledge', 'local-note.md'), '本机沉淀');
    const prompt = buildConstrainedSystemPrompt(tmpRoot);
    expect(prompt).not.toContain('untrusted');
    expect(prompt).toContain('本机沉淀');
  });

  // ────────────────────────────────────────────────────────────
  // v1.3.4 P1-18: 行为断言——联邦知识包裹正确性（不只测标签存在，测包裹语义）
  // ────────────────────────────────────────────────────────────

  it('federation 内容被完整包裹——开标签在前内容在中闭标签在后（P1-18 行为断言）', () => {
    const fedPath = path.join(skillDir, 'knowledge', 'federation', 'peer-note.md');
    fs.writeFileSync(fedPath, '联邦敏感数据 ABC123');
    const newer = new Date(Date.now() + 60_000);
    fs.utimesSync(fedPath, newer, newer);

    const prompt = buildConstrainedSystemPrompt(tmpRoot);

    // 行为断言：包裹顺序正确（开标签 → 内容 → 闭标签），而非只是标签存在
    const openPos = prompt.indexOf('<untrusted source="federation">');
    const contentPos = prompt.indexOf('联邦敏感数据 ABC123');
    const closePos = prompt.indexOf('</untrusted>');

    expect(openPos).toBeGreaterThanOrEqual(0);
    expect(contentPos).toBeGreaterThan(openPos);
    expect(closePos).toBeGreaterThan(contentPos);
  });

  it('联邦知识注入不泄漏到本地知识段——隔离正确（P1-18 行为断言）', () => {
    const fedPath = path.join(skillDir, 'knowledge', 'federation', 'secret.md');
    fs.writeFileSync(fedPath, 'FEDERATION_ONLY_SECRET');
    fs.writeFileSync(path.join(skillDir, 'knowledge', 'local.md'), 'LOCAL_KNOWLEDGE');
    const newer = new Date(Date.now() + 60_000);
    fs.utimesSync(fedPath, newer, newer);

    const prompt = buildConstrainedSystemPrompt(tmpRoot);

    // 行为断言：联邦内容只在 untrusted 包裹内出现，不会裸露到本地知识段
    expect(prompt).toContain('FEDERATION_ONLY_SECRET');
    const wrappedStart = prompt.indexOf('<untrusted source="federation">');
    const wrappedEnd = prompt.indexOf('</untrusted>');
    const fedContentPos = prompt.indexOf('FEDERATION_ONLY_SECRET');

    // 联邦内容必须在包裹区间内
    expect(fedContentPos).toBeGreaterThan(wrappedStart);
    expect(fedContentPos).toBeLessThan(wrappedEnd);
  });
});
