// ============================================================
// workflow-lineage.test.ts · G1 血缘记录测试（v1.4.9 T5）
// ============================================================
//
// 覆盖面（changelog 十二章验收 ③ + 铁律 8 故障注入）：
//   1. appendLineageEvent / readLineageEvents 往返 + 坏行剔除计数
//   2. traceLineage：本地 fork 链逐层回溯（fork→fork→fork）
//   3. traceLineage：import 链头含跨企业祖先（bundle 续链）
//   4. buildBundleLineage：原生模板 forkDepth=0 / 派生链 forkDepth=N
//   5. chainFromBundle：头插 importedAs + 包内祖先去重
//   6. 环防护（恶意/损坏事件造环不死循环）
//   7. lineage.jsonl 不存在 → 空谱系（fail-closed 缺省态）
//   8. 坏行（半行 JSON / 非 JSON）故障注入——读取不阻断
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-lineage-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

// 环境变量设置后再 import 被测模块（与 workflow-crud.test.ts 同纪律）
const {
  lineagePath,
  appendLineageEvent,
  readLineageEvents,
  traceLineage,
  buildBundleLineage,
  chainFromBundle,
} = await import('../workflow/lineage');

describe('G1 血缘事件：append / read 往返', () => {
  beforeEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); mkdirSync(ISO_DIR, { recursive: true }); });
  afterEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); });

  it('export / import / fork 三类事件各追加一行，读取往返完整', () => {
    appendLineageEvent({ type: 'export', workflowId: 'wf-a', actor: 'op', enterprise: 'ent-1', version: 3 }, ISO_DIR);
    appendLineageEvent({ type: 'import', workflowId: 'wf-a', importedAs: 'wf-b', actor: 'op2', enterprise: 'ent-1', version: 3, ancestors: [] }, ISO_DIR);
    appendLineageEvent({ type: 'fork', workflowId: 'wf-b', actor: 'op3', enterprise: 'ent-2', version: 1, ancestors: [{ workflowId: 'wf-a', enterprise: 'ent-1', version: 3, forkedAt: '2026-01-01T00:00:00Z' }] }, ISO_DIR);
    const { events, corruptLines } = readLineageEvents(ISO_DIR);
    expect(events.length).toBe(3);
    expect(corruptLines).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['export', 'import', 'fork']);
    expect(events.every((e) => e.eventId.startsWith('lineage-'))).toBe(true);
    expect(events.every((e) => typeof e.occurredAt === 'string')).toBe(true);
  });

  it('eventId 幂等键不重复（连续追加 100 个）', () => {
    for (let i = 0; i < 100; i++) {
      appendLineageEvent({ type: 'fork', workflowId: `wf-${i}`, actor: 'op', enterprise: 'e', version: 1 }, ISO_DIR);
    }
    const { events } = readLineageEvents(ISO_DIR);
    expect(events.length).toBe(100);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(100);
  });

  it('故障注入：坏行（半行 JSON / 纯文本）剔除计数不阻断读取', () => {
    appendLineageEvent({ type: 'fork', workflowId: 'wf-good', actor: 'op', enterprise: 'e', version: 1 }, ISO_DIR);
    const p = lineagePath(ISO_DIR);
    const good = readFileSync(p, 'utf-8');
    // 追加 2 行坏行：半行 JSON（跨行拼接后仅 2 个非空块）+ 纯文本
    writeFileSync(p, good + '{"type": "fork", "eventId": "half\nplain garbage text\n', 'utf-8');
    const { events, corruptLines } = readLineageEvents(ISO_DIR);
    expect(events.length).toBe(1);
    expect(events[0]!.workflowId).toBe('wf-good');
    expect(corruptLines).toBe(2);
  });

  it('lineage.jsonl 不存在 → 空事件流（fail-closed 缺省态）', () => {
    const { events, corruptLines } = readLineageEvents(ISO_DIR);
    expect(events).toEqual([]);
    expect(corruptLines).toBe(0);
  });

  it('workflow-store 目录不存在时追加自动建目录', () => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
    appendLineageEvent({ type: 'export', workflowId: 'wf-x', actor: 'op', enterprise: 'e', version: 1 }, ISO_DIR);
    expect(existsSync(lineagePath(ISO_DIR))).toBe(true);
  });
});

describe('G1 谱系回溯：traceLineage', () => {
  beforeEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); mkdirSync(ISO_DIR, { recursive: true }); });
  afterEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); });

  it('本地 fork 链逐层回溯（wf-c ← wf-b ← wf-a，时间升序输出）', () => {
    // wf-a 原生（无 fork 事件）→ wf-b fork 自 wf-a → wf-c fork 自 wf-b
    appendLineageEvent({
      type: 'fork', workflowId: 'wf-b', actor: 'u1', enterprise: 'ent-1', version: 1,
      ancestors: [{ workflowId: 'wf-a', enterprise: 'ent-1', version: 2, forkedAt: '2026-01-01T00:00:00Z' }],
    }, ISO_DIR);
    appendLineageEvent({
      type: 'fork', workflowId: 'wf-c', actor: 'u2', enterprise: 'ent-1', version: 1,
      ancestors: [{ workflowId: 'wf-b', enterprise: 'ent-1', version: 1, forkedAt: '2026-01-02T00:00:00Z' }],
    }, ISO_DIR);
    const chain = traceLineage('wf-c', ISO_DIR);
    expect(chain.length).toBe(2);
    // 时间升序：最早的 wf-a 祖先在前
    expect(chain[0]!.workflowId).toBe('wf-a');
    expect(chain[1]!.workflowId).toBe('wf-b');
  });

  it('import 链：包内祖先整段接入（跨企业源在链头可回溯——验收 ③）', () => {
    appendLineageEvent({
      type: 'import', workflowId: 'remote-wf', importedAs: 'local-wf', actor: 'u', enterprise: 'partner-co', version: 7,
      ancestors: [
        { workflowId: 'local-wf', enterprise: 'partner-co', version: 7, forkedAt: '2026-02-01T00:00:00Z' },
        { workflowId: 'remote-wf', enterprise: 'partner-co', version: 5, forkedAt: '2026-01-15T00:00:00Z' },
        { workflowId: 'ancient-wf', enterprise: 'origin-co', version: 1, forkedAt: '2026-01-01T00:00:00Z' },
      ],
    }, ISO_DIR);
    const chain = traceLineage('local-wf', ISO_DIR);
    expect(chain.length).toBe(3);
    // 链头（最早）是跨企业源头 origin-co
    expect(chain[0]!.enterprise).toBe('origin-co');
    expect(chain[0]!.workflowId).toBe('ancient-wf');
    // 源版本可回溯
    expect(chain.some((a) => a.enterprise === 'partner-co' && a.version === 7)).toBe(true);
  });

  it('import 后再 fork：混合链（本地 fork 接 import 链头）', () => {
    appendLineageEvent({
      type: 'import', workflowId: 'src', importedAs: 'imp', actor: 'u', enterprise: 'ent-x', version: 2,
      ancestors: [
        { workflowId: 'imp', enterprise: 'ent-x', version: 2, forkedAt: '2026-02-01T00:00:00Z' },
        { workflowId: 'src', enterprise: 'ent-x', version: 2, forkedAt: '2026-01-01T00:00:00Z' },
      ],
    }, ISO_DIR);
    appendLineageEvent({
      type: 'fork', workflowId: 'imp-v2', actor: 'u', enterprise: 'ent-local', version: 1,
      ancestors: [{ workflowId: 'imp', enterprise: 'ent-x', version: 2, forkedAt: '2026-03-01T00:00:00Z' }],
    }, ISO_DIR);
    const chain = traceLineage('imp-v2', ISO_DIR);
    // fork 层：imp（ent-x）→ import 层：imp（同名同企业被复合键去重）
    // + src——可见谱系 = imp@ent-x + src@ent-x，时间升序 src 在前
    expect(chain.length).toBe(2);
    expect(chain[0]!.workflowId).toBe('src');
    expect(chain[1]!.workflowId).toBe('imp');
    expect(chain[1]!.enterprise).toBe('ent-x');
  });

  it('无血缘记录 → 空谱系（原生模板）', () => {
    expect(traceLineage('never-forked', ISO_DIR)).toEqual([]);
  });

  it('环防护：恶意事件自指/互指不死循环（seen 集合截断，链长有界）', () => {
    // 构造 wf-a ← wf-b ← wf-a 的环
    appendLineageEvent({
      type: 'fork', workflowId: 'wf-a', actor: 'u', enterprise: 'e', version: 1,
      ancestors: [{ workflowId: 'wf-b', enterprise: 'e', version: 1, forkedAt: '2026-01-02T00:00:00Z' }],
    }, ISO_DIR);
    appendLineageEvent({
      type: 'fork', workflowId: 'wf-b', actor: 'u', enterprise: 'e', version: 1,
      ancestors: [{ workflowId: 'wf-a', enterprise: 'e', version: 1, forkedAt: '2026-01-01T00:00:00Z' }],
    }, ISO_DIR);
    const chain = traceLineage('wf-a', ISO_DIR);
    // 环截断：回溯终止（第二圈同键命中 seen 即 break）——链长严格小于
    // 环周长的 2 倍（2 节点环至多记 2 层后停），不死循环即过
    expect(chain.length).toBeLessThanOrEqual(2);
    expect(new Set(chain.map((a) => `${a.workflowId}@${a.enterprise}`)).size).toBe(chain.length);
  });
});

describe('G1 导出包血缘：buildBundleLineage / chainFromBundle', () => {
  beforeEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); mkdirSync(ISO_DIR, { recursive: true }); });
  afterEach(() => { rmSync(ISO_DIR, { recursive: true, force: true }); });

  it('原生模板：forkDepth=0，祖先链只含自身', () => {
    const bl = buildBundleLineage('native-wf', 3, 'my-co', ISO_DIR);
    expect(bl.forkDepth).toBe(0);
    expect(bl.ancestors.length).toBe(1);
    expect(bl.ancestors[0]!.workflowId).toBe('native-wf');
    expect(bl.sourceEnterprise).toBe('my-co');
    expect(bl.sourceVersion).toBe(3);
  });

  it('派生模板：forkDepth=N（既有谱系续入包）', () => {
    appendLineageEvent({
      type: 'fork', workflowId: 'derived', actor: 'u', enterprise: 'my-co', version: 1,
      ancestors: [{ workflowId: 'base', enterprise: 'my-co', version: 4, forkedAt: '2026-01-01T00:00:00Z' }],
    }, ISO_DIR);
    const bl = buildBundleLineage('derived', 2, 'my-co', ISO_DIR);
    expect(bl.forkDepth).toBe(1);
    expect(bl.ancestors.map((a) => a.workflowId)).toEqual(['base', 'derived']);
  });

  it('chainFromBundle：importedAs 头插 + 包内祖先去重', () => {
    const bundleAncestors = [
      { workflowId: 'same-id', enterprise: 'a', version: 1, forkedAt: '2026-01-01T00:00:00Z' },
      { workflowId: 'same-id', enterprise: 'a', version: 1, forkedAt: '2026-01-01T00:00:00Z' }, // 重复构造
      { workflowId: 'other', enterprise: 'b', version: 2, forkedAt: '2026-01-02T00:00:00Z' },
    ];
    const chain = chainFromBundle(
      { exportedAt: 'now', sourceEnterprise: 'a', sourceWorkflowId: 'same-id', sourceVersion: 1, forkDepth: 1, ancestors: bundleAncestors },
      'same-id', // importedAs 与祖先同名——头插去重
    );
    expect(chain[0]!.workflowId).toBe('same-id');
    expect(chain.filter((a) => a.workflowId === 'same-id').length).toBe(1);
    expect(chain.some((a) => a.workflowId === 'other')).toBe(true);
  });
});
