// ============================================================
// judge-replay-cli.test.ts · F-9 接线批（fresh-eyes R2 P1-3）
// ============================================================
// CLI 冒烟用例：judge-replay 子命令「临时 manifest + 快照 → 输出含概率分布 +
// 指纹核对 ok」与「指纹不符 → exit 2」的 fail-closed 断言。
// 实现面在 cli.ts case 'judge-replay'（薄壳：参数解析 + checkWeightsDir +
// replayDecision 调用 + JSON 输出）；本用例经 spawnSubcommand 驱动真实 CLI 入口。
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashDir } from '../weights-manifest';

/** 用 dist 的 CLI 真实入口（build 后存在；缺则 skip——CI 无构建态时不断言假读数） */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CLI_JS = join(__dirname, '..', '..', '..', '..', 'engine', 'orchestrator', 'dist', 'cli.js');
const cliAvailable = existsSync(CLI_JS);

let tmp = '';

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'judge-replay-cli-'));
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** 构造最小权重目录：v1/weights.bin + manifest.json（sha256 用 hashDir 实算） */
function buildWeights(root: string): string {
  const weightsDir = join(root, 'weights');
  mkdirSync(join(weightsDir, 'v1'), { recursive: true });
  writeFileSync(join(weightsDir, 'v1', 'weights.bin'), 'fake-weights-bytes');
  const sha = hashDir(join(weightsDir, 'v1'));
  writeFileSync(
    join(weightsDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      model: 'test-judge',
      versions: [{ id: 'v1', createdAt: '2026-11-10T00:00:00Z', sha256: sha, sizeBytes: 18 }],
      current: 'v1',
    }),
  );
  return weightsDir;
}

const SNAPSHOT = {
  state: '重放验证：把订单按金额分档。',
  questions: [
    { id: 'q1', kind: 'noul', question: '是否人工复核' },
    { id: 'q2', kind: 'score', question: '置信度', min: 0, max: 10 },
  ],
  criteriaVersion: 'criteria/2026-11-10',
  redactionVersion: 'redaction/v1',
};

describe.skipIf(!cliAvailable)('judge-replay CLI · F-9 接线批冒烟', () => {
  it('指纹核对 ok + 快照 → stdout 输出含概率分布 JSON（RC=0）', () => {
    const weightsDir = buildWeights(tmp);
    const snapPath = join(tmp, 'snapshot.json');
    writeFileSync(snapPath, JSON.stringify(SNAPSHOT));
    const r = spawnSync(process.execPath, [CLI_JS, 'judge-replay', '--weights', weightsDir, '--state', snapPath], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(true);
    expect(out.manifestOk).toBe(true);
    expect(out.answers).toHaveLength(2);
    expect(out.answers[0].kind).toBe('noul');
    expect(out.answers[1].kind).toBe('score');
  });

  it('权重被篡改（指纹不符）→ exit 2 + 差异明细（fail-closed）', () => {
    const weightsDir = buildWeights(join(tmp, 'bad'));
    writeFileSync(join(weightsDir, 'v1', 'weights.bin'), 'tampered-content');
    const snapPath = join(tmp, 'snapshot.json');
    const r = spawnSync(process.execPath, [CLI_JS, 'judge-replay', '--weights', weightsDir, '--state', snapPath], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('"ok": false');
    expect(r.stdout).toContain('完整性校验失败');
  });

  it('缺参 → exit 1 + 用法提示', () => {
    const r = spawnSync(process.execPath, [CLI_JS, 'judge-replay'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--weights');
    expect(r.stderr).toContain('--state');
  });
});
