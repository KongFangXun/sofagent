// ============================================================
// write-surface.test.ts · 自进化写面变更留痕单测（v1.5.9 章一）
// ============================================================
// 三组：
//   一、两类契约——prompt 面（字段级 before/after）/ memory 面（条目级 新增/修订/失效）
//       含配置写入捕获（before/after + 越界检测具名）
//   二、无留痕回退——fail-closed 负向探针（留痕失败 ⇒ 回退 + 告警 + 抛错），
//       及「未接线遗留态放行」的零回归对照
//   三、举证导出——自描述 bundle + 第三方零依赖验签器独立复算 + 防「验签器恒真」
//       篡改注入 + 第三通道（写面 diff → 既有规则输入面，判定逻辑零改动）
//
// 隔离纪律：每用例独立 mkdtemp；HMAC 密钥经 SOFAGENT_KEY_PATH 指向临时密钥文件
// （真实 ~/.sofagent-key 零接触）；sink 注册表在每个用例后复位。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

import {
  createMemoryStore,
  diffLoadChainFields,
  captureLoadChainWrite,
  guardWriteSurface,
  emitWriteSurfaceTrace,
  setWriteSurfaceTracer,
  LoadChainBoundaryError,
  WriteSurfaceUntracedError,
} from '@sofagent/core';
import {
  recordWriteSurfaceChange,
  loadWriteSurfaceLog,
  verifyWriteSurfaceChain,
  exportWriteSurfaceEvidence,
  writeSurfaceToDiffFiles,
  getWriteSurfaceLogPath,
  createWriteSurfaceTracer,
  WriteSurfaceContractError,
  type WriteSurfaceEntry,
  type WriteSurfaceChangeInput,
} from '../write-surface-log';
import { scanA2 } from '../rules/rule-a2-secret-leak';
import type { AuditContext } from '../rules/types';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → src → audit → engine → 仓库根（四级）
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const VERIFY_CHAIN = join(REPO_ROOT, 'tools', 'verify', 'verify-chain.mjs');

/** 固定 HMAC 密钥（经 SOFAGENT_KEY_PATH 注入——不读真实密钥） */
const GOLDEN_KEY = 'write-surface-test-key-0123456789abcdef';

let dataDir: string;
let keyPath: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'sofagent-write-surface-'));
  dataDir = join(base, 'data');
  mkdirSync(dataDir, { recursive: true });
  keyPath = join(base, 'key');
  writeFileSync(keyPath, GOLDEN_KEY, 'utf-8');
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = keyPath;
  setWriteSurfaceTracer(null);
});

afterEach(() => {
  setWriteSurfaceTracer(null);
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  rmSync(dirname(dataDir), { recursive: true, force: true });
});

/** 构造一条 prompt 面字段级变更入参 */
function promptChange(over: Partial<WriteSurfaceChangeInput> = {}): WriteSurfaceChangeInput {
  return {
    surface: 'prompt',
    target: 'SKILL.md',
    actor: 'agent-1',
    origin: 'self-improvement',
    diff: { mode: 'field-level', changes: [{ field: 'skillDir', before: '.sofagent', after: '/srv/skill' }] },
    ts: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// ════════════════════════════════════════
// 一、两类契约
// ════════════════════════════════════════

describe('write-surface · 两类写面契约', () => {
  it('prompt 面：字段级 diff 挂链，kind=prompt-write，摘要含字段名与前后值', () => {
    const entry = recordWriteSurfaceChange(promptChange(), dataDir);
    expect(entry.kind).toBe('prompt-write');
    expect(entry.surface).toBe('prompt');
    expect(entry.target).toBe('SKILL.md');
    expect(entry.actor).toBe('agent-1');
    expect(entry.origin).toBe('self-improvement');
    expect(entry.summary).toContain('skillDir');
    expect(entry.summary).toContain('.sofagent');
    expect(entry.summary).toContain('/srv/skill');
    // 链字段由 chain-kernel 承载（复用既有链内核，不自造协议）
    expect(entry.prevHash).toBe('genesis');
    expect(entry.hashVersion).toBe(2);
    expect(typeof entry.hmacSig).toBe('string');
    expect(entry.hmacSig!.length).toBe(32);
  });

  it('memory 面：条目级 diff（新增）挂链，kind=memory-write', () => {
    const entry = recordWriteSurfaceChange(
      {
        surface: 'memory',
        target: '用户偏好.前端框架',
        actor: 'agent-1',
        origin: 'self-improvement',
        diff: { mode: 'entry-level', op: 'add', entryKey: '用户偏好.前端框架', before: null, after: 'React' },
      },
      dataDir,
    );
    expect(entry.kind).toBe('memory-write');
    expect(entry.diff.mode).toBe('entry-level');
    expect(entry.summary).toContain('add');
    expect(entry.summary).toContain('React');
  });

  it('契约不符：prompt 面传条目级 diff ⇒ WriteSurfaceContractError（不写文件）', () => {
    expect(() =>
      recordWriteSurfaceChange(
        {
          surface: 'prompt',
          target: 'SKILL.md',
          actor: 'a',
          origin: 'human',
          diff: { mode: 'entry-level', op: 'add', entryKey: 'k', before: null, after: 'v' },
        },
        dataDir,
      ),
    ).toThrow(WriteSurfaceContractError);
    // 不写文件（契约门在挂链之前）
    expect(existsSync(getWriteSurfaceLogPath(dataDir))).toBe(false);
  });

  it('契约不符：memory 面传字段级 diff ⇒ 拒绝', () => {
    expect(() =>
      recordWriteSurfaceChange(
        {
          surface: 'memory',
          target: 'k',
          actor: 'a',
          origin: 'human',
          diff: { mode: 'field-level', changes: [] },
        },
        dataDir,
      ),
    ).toThrow(WriteSurfaceContractError);
  });

  it('契约不符：memory 面 op 非法 / 缺 entryKey ⇒ 拒绝', () => {
    expect(() =>
      recordWriteSurfaceChange(
        {
          surface: 'memory',
          target: 'k',
          actor: 'a',
          origin: 'human',
          diff: { mode: 'entry-level', op: 'bogus' as never, entryKey: 'k', before: null, after: 'v' },
        },
        dataDir,
      ),
    ).toThrow(WriteSurfaceContractError);
    expect(() =>
      recordWriteSurfaceChange(
        {
          surface: 'memory',
          target: 'k',
          actor: 'a',
          origin: 'human',
          diff: { mode: 'entry-level', op: 'add', entryKey: '', before: null, after: 'v' },
        },
        dataDir,
      ),
    ).toThrow(WriteSurfaceContractError);
  });

  it('证据三要素缺失：actor 空 / origin 非法 ⇒ 拒绝', () => {
    expect(() => recordWriteSurfaceChange(promptChange({ actor: '  ' }), dataDir)).toThrow(WriteSurfaceContractError);
    expect(() =>
      recordWriteSurfaceChange(promptChange({ origin: 'nope' as never }), dataDir),
    ).toThrow(WriteSurfaceContractError);
  });

  it('配置写入捕获：diffLoadChainFields 字段级 before/after + 越界检测具名', () => {
    const diff = diffLoadChainFields('SKILL.md', { skillDir: '.sofagent' }, { skillDir: '/srv/skill' });
    expect(diff.mode).toBe('field-level');
    expect(diff.layer).toBe('SKILL.md');
    expect(diff.changes).toEqual([{ field: 'skillDir', before: '.sofagent', after: '/srv/skill' }]);

    // 仅保留变化字段
    const none = diffLoadChainFields('knowledge', { knowledgeHotEntries: 2 }, { knowledgeHotEntries: 2 });
    expect(none.changes).toEqual([]);

    // 越界：skillDir 归 SKILL.md，写入 fde.md ⇒ 具名拒绝（复用章三 schema）
    expect(() => diffLoadChainFields('fde.md', {}, { skillDir: 'x' })).toThrow(LoadChainBoundaryError);
    // 未登记字段同样拒绝
    expect(() => diffLoadChainFields('SKILL.md', {}, { notARegisteredField: 1 })).toThrow();
  });

  it('captureLoadChainWrite：产出 prompt 面 trace，且与改进链绑定（refTrace）', () => {
    const { trace, diff } = captureLoadChainWrite({
      layer: 'SKILL.md',
      before: { SOFAGENT_CONTEXT_BUDGET_RATIO: 0.03 },
      after: { SOFAGENT_CONTEXT_BUDGET_RATIO: 0.05 },
      actor: 'agent-7',
      origin: 'self-improvement',
      refTrace: 'decision:promotion-42',
    });
    expect(trace.surface).toBe('prompt');
    expect(trace.target).toBe('SKILL.md');
    expect(trace.actor).toBe('agent-7');
    expect(trace.refTrace).toBe('decision:promotion-42');
    expect(diff.changes).toEqual([
      { field: 'SOFAGENT_CONTEXT_BUDGET_RATIO', before: 0.03, after: 0.05 },
    ]);
    expect(trace.diff).toEqual(diff);
  });
});

// ════════════════════════════════════════
// 二、无留痕回退（fail-closed 负向探针）
// ════════════════════════════════════════

describe('write-surface · 无留痕 ⇒ 回退 + 告警（fail-closed）', () => {
  it('guardWriteSurface：留痕失败 ⇒ 回退 + 告警 + 抛 WriteSurfaceUntracedError', () => {
    const alert = vi.fn();
    let reverted = false;
    expect(() =>
      guardWriteSurface(
        { surface: 'prompt', target: 'SKILL.md', actor: 'a', origin: 'system', diff: { mode: 'field-level', changes: [] } },
        () => 'written',
        () => {
          reverted = true;
        },
        { alert, requireTrace: true, makeTraceId: () => 'tid-probe' },
      ),
    ).toThrow(WriteSurfaceUntracedError);
    expect(reverted).toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]![0])).toContain('无留痕');
    expect(String(alert.mock.calls[0]![0])).toContain('已回退');
  });

  it('guardWriteSurface：未接线遗留态（无 sink 且 requireTrace=false）⇒ 放行（零回归）', () => {
    let reverted = false;
    const result = guardWriteSurface(
      { surface: 'prompt', target: 'x', actor: 'a', origin: 'system', diff: { mode: 'field-level', changes: [] } },
      () => 'ok',
      () => {
        reverted = true;
      },
    );
    expect(result).toBe('ok');
    expect(reverted).toBe(false);
  });

  it('记忆写入负向探针：注册抛错 tracer ⇒ set 回退（事实未落盘）+ 告警', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      setWriteSurfaceTracer(() => {
        throw new Error('留痕落盘失败（负向探针）');
      });
      const store = createMemoryStore(dataDir, { scope: 'global' });
      expect(() =>
        store.set({ key: '用户偏好.前端框架', value: 'React', source: 'agent-1', confidence: 0.9, tags: [] }),
      ).toThrow(WriteSurfaceUntracedError);
      // 回退：事实未落盘（净效果 = 无痕写入被拒绝）
      expect(store.get('用户偏好.前端框架')).toBeNull();
      expect(store.stats().facts).toBe(0);
      expect(errSpy).toHaveBeenCalled();
      expect(String(errSpy.mock.calls[0]![0])).toContain('无留痕');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('记忆失效负向探针：delete 留痕失败 ⇒ 回退（事实仍在）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 先无痕写入一条（遗留态）
      const store = createMemoryStore(dataDir, { scope: 'global' });
      store.set({ key: 'k.1', value: 'v1', source: 'agent-1', confidence: 0.5, tags: [] });
      // 再注册抛错 tracer 后删除
      setWriteSurfaceTracer(() => {
        throw new Error('留痕落盘失败（负向探针）');
      });
      expect(() => store.delete('k.1')).toThrow(WriteSurfaceUntracedError);
      // 回退：事实仍在
      expect(store.get('k.1')?.value).toBe('v1');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('接线后正向：记忆写入（新增/修订/失效）各落一条 memory-write 留痕', () => {
    setWriteSurfaceTracer(createWriteSurfaceTracer(dataDir));
    const store = createMemoryStore(dataDir, { scope: 'global' });
    store.set({ key: 'k.1', value: 'v1', source: 'agent-1', confidence: 0.5, tags: [] }); // add
    store.set({ key: 'k.1', value: 'v2', source: 'agent-1', confidence: 0.6, tags: [] }); // revise
    store.delete('k.1'); // invalidate

    const log = loadWriteSurfaceLog(dataDir);
    expect(log).toHaveLength(3);
    expect(log.every((e) => e.surface === 'memory')).toBe(true);
    const ops = log.map((e) => (e.diff.mode === 'entry-level' ? e.diff.op : null));
    expect(ops).toEqual(['add', 'revise', 'invalidate']);
    // 链完整
    expect(verifyWriteSurfaceChain(undefined, dataDir).status).toBe('ok');
  });

  it('emitWriteSurfaceTrace：未接线返回 false；接线后落留痕并返回 true（晋级/考核判定即留痕）', () => {
    const change = {
      surface: 'memory' as const,
      target: 'promotion:item-42',
      actor: 'evolve-loop',
      origin: 'self-improvement' as const,
      diff: { mode: 'entry-level', op: 'revise', entryKey: 'item-42', before: 'layer=skill', after: 'promote-skill' },
      refTrace: 'decision:ts-1',
    };
    // 未接线：返回 false（遗留态，不抛）
    expect(emitWriteSurfaceTrace(change)).toBe(false);
    // 接线后：落留痕 + 返回 true，且 refTrace 与改进链绑定
    setWriteSurfaceTracer(createWriteSurfaceTracer(dataDir));
    expect(emitWriteSurfaceTrace(change, { now: () => '2026-01-01T00:00:00.000Z', makeTraceId: () => 'tid-x' })).toBe(true);
    const log = loadWriteSurfaceLog(dataDir);
    expect(log).toHaveLength(1);
    expect(log[0]!.refTrace).toBe('decision:ts-1');
    expect(log[0]!.surface).toBe('memory');
  });
});

// ════════════════════════════════════════
// 三、举证导出 + 第三通道
// ════════════════════════════════════════

describe('write-surface · 举证导出（第三方无需安装 sofagent）', () => {
  it('bundle 自描述 + 第三方零依赖验签器独立复算为「链完整」', () => {
    recordWriteSurfaceChange(promptChange({ ts: '2026-01-01T00:00:00.000Z' }), dataDir);
    recordWriteSurfaceChange(
      promptChange({
        target: 'fde.md',
        ts: '2026-01-01T00:00:01.000Z',
        diff: { mode: 'field-level', changes: [{ field: 'fdeFileName', before: 'fde.md', after: 'fde-v2.md' }] },
      }),
      dataDir,
    );
    recordWriteSurfaceChange(
      {
        surface: 'memory',
        target: 'k.1',
        actor: 'agent-9',
        origin: 'human',
        diff: { mode: 'entry-level', op: 'add', entryKey: 'k.1', before: null, after: 'v1' },
        ts: '2026-01-01T00:00:02.000Z',
      },
      dataDir,
    );

    const outFile = join(dataDir, 'evidence', 'write-surface.jsonl');
    const bundle = exportWriteSurfaceEvidence({ dataDir, outFile });

    expect(bundle.format).toBe('sofagent.write-surface-evidence');
    expect(bundle.version).toBe(1);
    expect(bundle.protocol).toBe('hmac-sha256-stable-v2');
    expect(bundle.recordCount).toBe(3);
    expect(bundle.hmacKeyPresent).toBe(true);
    expect(bundle.verdict.status).toBe('ok');
    expect(bundle.independentVerification.command).toContain('verify-chain.mjs');
    expect(bundle.independentVerification.howto.length).toBeGreaterThanOrEqual(3);
    expect(existsSync(outFile)).toBe(true);

    // 第三方独立验签器（裸 node，零依赖，不 import 任何引擎包）实际复算：
    // 把导出的 JSONL + 指纹 + 密钥喂给它 → 报「链完整」（对齐 v1.5.2 章二独立验签语义）
    const raw = execFileSync(
      process.execPath,
      [VERIFY_CHAIN, '--history', outFile, '--key', keyPath, '--fingerprint', bundle.fingerprint, '--json'],
      { encoding: 'utf-8' },
    );
    const parsed = JSON.parse(raw) as { exitCode: number; results: { status: string }[] };
    expect(parsed.exitCode).toBe(0);
    expect(parsed.results[0]!.status).toBe('ok');
  });

  it('防「验签器恒真」：篡改写面链任一条目 ⇒ verdict=tampered', () => {
    recordWriteSurfaceChange(promptChange({ ts: '2026-01-01T00:00:00.000Z' }), dataDir);
    recordWriteSurfaceChange(promptChange({ target: 'fde.md', ts: '2026-01-01T00:00:01.000Z' }), dataDir);

    const p = getWriteSurfaceLogPath(dataDir);
    const lines = readFileSync(p, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
    tampered.target = '被篡改';
    lines[1] = JSON.stringify(tampered);
    writeFileSync(p, lines.join('\n') + '\n', 'utf-8');

    const bundle = exportWriteSurfaceEvidence({ dataDir });
    expect(bundle.verdict.status).toBe('tampered');
    expect(bundle.verdict.index).toBe(1);
  });

  it('第三通道：写面 diff 转既有规则输入面（DiffFile），被既有规则消费——判定逻辑零改动', () => {
    // 一条写面变更（memory 面，新增一条含 AWS Access Key 形态的「经验」）
    const entry: WriteSurfaceEntry = recordWriteSurfaceChange(
      {
        surface: 'memory',
        target: 'config.aws',
        actor: 'agent-1',
        origin: 'self-improvement',
        diff: { mode: 'entry-level', op: 'add', entryKey: 'awsKey', before: null, after: 'AKIAIOSFODNN7EXAMPLE' },
      },
      dataDir,
    );

    // 转成既有规则的输入面（DiffFile）——第三通道：规则判定逻辑一行不改，只扩输入面
    const diffFiles = writeSurfaceToDiffFiles([entry]);
    expect(diffFiles).toHaveLength(1);
    expect(diffFiles[0]!.status).toBe('added');
    expect(diffFiles[0]!.path).toContain('.sofagent/write-surface/memory/');
    expect(diffFiles[0]!.lines.length).toBeGreaterThan(0);

    // 喂给既有 A2 密钥检测规则——同一份规则逻辑照常判定（零改动即消费新输入面）
    const rule = scanA2({ diffFiles } as unknown as AuditContext);
    expect(rule.status).toBe('FAIL');
    expect(rule.details.join(' ')).toContain('AWS Access Key');

    // 对照：无密钥的写面变更不被误报（第三通道不放大误报面）
    const clean = recordWriteSurfaceChange(
      {
        surface: 'prompt',
        target: 'SKILL.md',
        actor: 'agent-1',
        origin: 'self-improvement',
        diff: { mode: 'field-level', changes: [{ field: 'knowledgeHotEntries', before: '2', after: '3' }] },
      },
      dataDir,
    );
    const cleanRule = scanA2({ diffFiles: writeSurfaceToDiffFiles([clean]) } as unknown as AuditContext);
    expect(cleanRule.status).not.toBe('FAIL');
  });
});
