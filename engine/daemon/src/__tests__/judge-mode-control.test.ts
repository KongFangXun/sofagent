import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { bootJudgeMode, switchJudgeModeLive } from '../judge-mode-control';
import { getJudgeMode, setJudgeMode } from '@sofagent/orchestrator';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'judge-mode-control-'));
  setJudgeMode('shadow');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('F6.5 #5 · 挂-4 live 装载与切档', () => {
  it('空台账启动 ⇒ reconciled=0（默认 shadow，active 门保持拒绝）', () => {
    const r = bootJudgeMode(dir);
    expect(r.reconciled).toBe(0);
    expect(r.mode).toBe('shadow');
  });

  it('live 切档带对账 ⇒ 同一调用内落账并切档（reconciled 1）', () => {
    const r = switchJudgeModeLive(dir, { mode: 'active', shadow: 'ALLOW', actual: 'ASK', ts: '2026-11-04T00:00:00Z' });
    expect(r.recorded).toBe(true);
    expect(r.reconciled).toBe(1);
    expect(r.mode).toBe('active');
    expect(getJudgeMode()).toBe('active');
    expect(existsSync(join(dir, 'judge'))).toBe(true);
  });

  it('重启装载 ⇒ 对账面不归零（落盘可见）', () => {
    switchJudgeModeLive(dir, { mode: 'shadow', shadow: 'ALLOW', actual: 'ALLOW', ts: '2026-11-04T00:00:00Z' });
    switchJudgeModeLive(dir, { mode: 'shadow', shadow: 'DENY', actual: 'ASK', ts: '2026-11-04T00:00:01Z' });
    const boot = bootJudgeMode(dir);
    expect(boot.reconciled).toBe(2);
  });

  it('只切档不给对账信息 ⇒ 不落账（reconciled 保持原值，不因切档而变）', () => {
    const before = bootJudgeMode(dir).reconciled;
    const r = switchJudgeModeLive(dir, { mode: 'off' });
    expect(r.recorded).toBe(false);
    expect(r.reconciled).toBe(before);
    expect(r.mode).toBe('off');
  });
});
