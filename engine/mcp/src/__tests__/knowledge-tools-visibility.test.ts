// knowledge-tools-visibility.test.ts · W8 BUG-38：读侧吞错收口——stderr 信号回归锁
// 验收：知识目录不可读时，searchKnowledge 不崩、结果可能不全，但 **stderr 必须有
// 「知识目录不可读，结果可能不全」信号**——静默空结果（调用方以为「真的没匹配」）
// 是 BUG-38 病灶。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { searchKnowledge } from '../tools/knowledge-tools';

// searchKnowledge 经 @sofagent/core getDataDir() 定位知识目录——
// vitest-setup.mjs 已预置 SOFAGENT_DATA（全局隔离面），本测试重指到临时面。
function makeKb(): string {
  const home = mkdtempSync(join(tmpdir(), 'mcp-kb-'));
  const kb = join(home, 'knowledge');
  mkdirSync(join(kb, 'entities'), { recursive: true });
  writeFileSync(join(kb, 'entities', 'alpha.md'), '# Alpha\n实体内容', 'utf-8');
  vi.stubEnv('SOFAGENT_DATA', home);
  return home;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('W8 BUG-38 · searchKnowledge 吞错可见性', () => {
  it('目录不可读 → stderr 有「知识目录不可读」信号 + 工具仍返回（不崩）', () => {
    const home = makeKb();
    cleanups.push(() => {
      chmodSync(join(home, 'knowledge', 'entities'), 0o755);
      rmSync(home, { recursive: true, force: true });
    });
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    // 锁目录：readdirSync 抛 EACCES → 旧行为静默 continue（假「零匹配」）
    chmodSync(join(home, 'knowledge', 'entities'), 0o000);

    const r = searchKnowledge({ query: 'alpha' });
    expect(r).not.toHaveProperty('error'); // 不崩、正常返回结果对象
    expect(stderrLines.some((l) => l.includes('知识目录不可读') && l.includes('结果可能不全'))).toBe(true);
  });

  it('正常可读 → 无 stderr 噪音（信号只在实际故障时出现）', () => {
    const home = makeKb();
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const stderrLines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const r = searchKnowledge({ query: 'alpha' });
    expect(r).toHaveProperty('text');
    expect((r as { text: string }).text).toContain('alpha');
    expect(stderrLines.filter((l) => l.includes('不可读'))).toHaveLength(0);
  });
});
