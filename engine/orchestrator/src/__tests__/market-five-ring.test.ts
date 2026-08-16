// ============================================================
// market-five-ring.test.ts · 端到端五环集成测试（v1.3.4 dev-prompt 全局验收第 1 条）
//
// QA 报告：当前只有单块单测（publish / invoke / rating / owner 各自独立），
// 没有串联五环的集成测试。dev-prompt 全局验收第 1 条要求：
//   「一个 Skill 完整走通五环——发布→发现→调用→评价→退役/恢复」
//
// 五环流程（用 mock executor + 隔离的 SOFAGENT_DATA）：
//   1. 发布  publishCapability → manifest.jsonl
//   2. 发现  searchCatalog      → 读 manifest.jsonl
//   3. 调用  invokeCapability    → 写 invoke-counts.jsonl + invoke-log.jsonl
//   4. 评价  addRating           → 写 ratings.jsonl → updateTrustOnRating 写 owners.jsonl
//   5. 退役+恢复 markRetired / restoreCapability → manifest.jsonl status 覆盖
//
// 跨文件数据流验证点（这是集成测试的核心价值——单测覆盖不到的衔接）：
//   - manifest.jsonl（publish 写）→ catalog 读（search）
//   - invoke-counts.jsonl（invoke 写）→ rating 读（aggregateRating）
//   - ratings.jsonl（rate 写）→ rating 读（aggregateRating）
//   - owners.jsonl（trust 更新）→ rating 读（getTrustForRating）
//   - retired 标记（retire 写）→ restore 清 → catalog 过滤
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  publishCapability,
  type CapabilityMetadata,
} from '../market/publisher';
import {
  searchCatalog,
  searchByTag,
  getCapability,
  readCatalog,
} from '../market/catalog';
import {
  invokeCapability,
  readInvokeLog,
  type CapabilityExecutor,
} from '../market/invoker';
import {
  addRating,
  readRatingsForCapability,
  aggregateRating,
  readInvokeCounts,
  appendInvokeCount,
} from '../market/rating';
import {
  declareOwner,
  getTrust,
  classifyTrust,
  getOwner,
  TRUST_INITIAL,
  TRUST_GOOD_THRESHOLD,
  updateTrustOnRating,
} from '../market/owner';
import {
  markRetired,
  restoreCapability,
  getCapabilityStatus,
} from '../market/retire';

/** 构造隔离的临时数据目录 */
function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `sofagent-five-ring-${Date.now()}-${randomBytes(4).toString('hex')}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// v1.3.5 阶段五：全量并行 IO 争用偶发超时——文件级 timeout 20s
describe('market-five-ring 端到端五环集成测试', { timeout: 20000 }, () => {
  let testDir: string;
  let skillDir: string;
  let stubbedEnv: string;

  beforeEach(() => {
    testDir = tmpDir();
    stubbedEnv = testDir;
    vi.stubEnv('SOFAGENT_DATA', stubbedEnv);

    // 构造干净的 mock sourcePath 目录 + 空 SKILL.md
    // （invokeCapability 会过 SkillScan，sourcePath 必须指向安全的 Skill 内容）
    skillDir = join(testDir, 'skills', 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# 测试 Skill\n\n这是一个安全的能力，用于五环集成测试。\n\n## 用途\n\n验证完整链路。\n',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* 忽略清理失败 */
    }
  });

  /** mock executor：调用成功时返回固定结果 */
  const mockExecutor: CapabilityExecutor = async (input) => {
    return { ok: true, result: 'mock-done', input };
  };

  /** 构造合法元数据 */
  const makeMeta = (): CapabilityMetadata => ({
    id: 'test-skill',
    kind: 'skill',
    name: '测试能力 Skill',
    description: '五环集成测试用能力',
    version: '1.0.0',
    owner: 'agent-001',
    tags: ['test', 'integration'],
    sourcePath: skillDir,
  });

  // ──────────────────────────────────────────────────────────
  // 五环完整链路（主验收）
  // ──────────────────────────────────────────────────────────
  it('一个 Skill 完整走通五环：发布→发现→调用→评价→退役+恢复', async () => {
    // ────────────────── 第 1 环：发布 ──────────────────
    const meta = makeMeta();
    const pub = publishCapability(meta, testDir);

    // 发布成功
    expect(pub.ok).toBe(true);
    expect(pub.capabilityId).toBe('test-skill');
    expect(pub.scan?.verdict).toBe('SAFE');

    // 跨文件数据流①：manifest.jsonl 已写入（publish 写）
    const manifestPath = join(testDir, 'market', 'manifest.jsonl');
    expect(existsSync(manifestPath)).toBe(true);
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    expect(manifestContent).toContain('test-skill');
    expect(manifestContent).toContain('"status":"active"');

    // ────────────────── 第 2 环：发现 ──────────────────
    // 跨文件数据流①：catalog 读 manifest.jsonl
    const searchResult = searchCatalog('test', testDir);
    expect(searchResult.count).toBeGreaterThanOrEqual(1);
    const found = searchResult.matches.find((m) => m.id === 'test-skill');
    expect(found).toBeDefined();
    expect(found!.name).toBe('测试能力 Skill');
    expect(found!.owner).toBe('agent-001');
    expect(found!.sourcePath).toBe(skillDir);

    // 按标签也能搜到
    const tagResult = searchByTag('integration', testDir);
    expect(tagResult.matches.some((m) => m.id === 'test-skill')).toBe(true);

    // 按 ID 获取详情
    const detail = getCapability('test-skill', testDir);
    expect(detail).not.toBeNull();
    expect(detail!.version).toBe('1.0.0');

    // ────────────────── 第 3 环：调用 ──────────────────
    // SkillScan 在调用前过——sourcePath 指向干净的 mock 目录
    const invokeResult = await invokeCapability(
      { capabilityId: 'test-skill', callerAgentId: 'caller-001', input: { task: 'five-ring' } },
      mockExecutor,
      testDir,
    );

    expect(invokeResult.outcome).toBe('success');
    expect(invokeResult.capabilityName).toBe('测试能力 Skill');
    expect(invokeResult.output).toEqual({
      ok: true,
      result: 'mock-done',
      input: { capabilityId: 'test-skill', sourcePath: skillDir, input: { task: 'five-ring' } },
    });

    // 跨文件数据流②：invoke-counts.jsonl 已写入（invoke 写）
    const invokeCounts = readInvokeCounts(testDir);
    expect(invokeCounts.get('test-skill')).toBe(1);

    // 调用日志也已写入
    const invokeLogs = readInvokeLog(testDir);
    expect(invokeLogs.length).toBe(1);
    expect(invokeLogs[0]!.outcome).toBe('success');

    // ────────────────── 第 4 环：评价（累积好评 → trust 上调）──────────────────
    // owner 必须先声明（trust 机制依赖 owners.jsonl）
    declareOwner('agent-001', '五环测试 owner', testDir);
    expect(getTrust('agent-001', testDir)).toBe(TRUST_INITIAL);
    expect(classifyTrust(getTrust('agent-001', testDir))).toBe('initial');

    // 累积 5 条好评（不同 raterId——防刷只保留同 rater 最后一票）
    const raters = ['rater-01', 'rater-02', 'rater-03', 'rater-04', 'rater-05'];
    for (const raterId of raters) {
      // 跨文件数据流③：ratings.jsonl（rate 写）
      addRating(
        { capabilityId: 'test-skill', raterId, score: 0.9 },
        testDir,
      );
      // 跨文件数据流④：owners.jsonl（trust 更新）→ rating 读
      updateTrustOnRating('agent-001', 0.9, testDir);
    }

    // 5 条好评后 trust 上调到 ≥ 0.6
    const trustAfterRatings = getTrust('agent-001', testDir);
    expect(trustAfterRatings).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);
    expect(classifyTrust(trustAfterRatings)).toBe('good');

    // 跨文件数据流验证：ratings.jsonl 读取去重后应为 5 票
    const ratings = readRatingsForCapability('test-skill', testDir);
    expect(ratings.length).toBe(5);

    // 跨文件数据流②③④聚合：aggregateRating 综合读取 invoke-counts + ratings + owners
    const agg = aggregateRating('test-skill', 'agent-001', testDir);
    expect(agg.count).toBe(5);
    expect(agg.averageScore).toBeCloseTo(0.9, 5);
    expect(agg.invokeCount).toBe(1);
    expect(agg.trust).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);
    expect(agg.rankScore).toBeGreaterThan(0);

    // ────────────────── 第 5 环：退役 + 恢复 ──────────────────
    // 退役前状态
    expect(getCapabilityStatus('test-skill', testDir)).toBe('active');

    // owner 确认 → 退役成功
    const retireResult = markRetired('test-skill', 'owner_request', true, testDir);
    expect(retireResult.ok).toBe(true);
    expect(getCapabilityStatus('test-skill', testDir)).toBe('retired');

    // 跨文件数据流⑤：retired 标记写入 manifest.jsonl → searchCatalog 默认排除
    const searchAfterRetire = searchCatalog('test', testDir);
    expect(searchAfterRetire.matches.some((m) => m.id === 'test-skill')).toBe(false);

    // 但 includeRetired=true 时能读到（退役不删除——保留审计轨迹）
    const catalogWithRetired = readCatalog(testDir, true);
    expect(catalogWithRetired.some((e) => e.id === 'test-skill')).toBe(true);

    // 恢复
    const restoreResult = restoreCapability('test-skill', testDir);
    expect(restoreResult.ok).toBe(true);
    expect(getCapabilityStatus('test-skill', testDir)).toBe('active');

    // 恢复后又能搜到
    const searchAfterRestore = searchCatalog('test', testDir);
    expect(searchAfterRestore.matches.some((m) => m.id === 'test-skill')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────
  // 跨文件数据流专项验证（集成测试的增量价值）
  // ──────────────────────────────────────────────────────────
  describe('跨文件数据流验证', () => {
    it('manifest.jsonl（publish 写）→ catalog 读（search 命中）', () => {
      publishCapability(makeMeta(), testDir);
      const result = searchCatalog('integration', testDir);
      expect(result.count).toBe(1);
      expect(result.matches[0]!.id).toBe('test-skill');
    });

    it('invoke-counts.jsonl（invoke 写）→ aggregateRating 读（调用量纳入排序分）', async () => {
      publishCapability(makeMeta(), testDir);
      declareOwner('agent-001', undefined, testDir);

      await invokeCapability(
        { capabilityId: 'test-skill', callerAgentId: 'c1' },
        mockExecutor,
        testDir,
      );
      await invokeCapability(
        { capabilityId: 'test-skill', callerAgentId: 'c2' },
        mockExecutor,
        testDir,
      );

      // invoke 写入的调用量被 aggregateRating 正确读取
      const agg = aggregateRating('test-skill', 'agent-001', testDir);
      expect(agg.invokeCount).toBe(2);
    });

    it('ratings.jsonl（rate 写）→ aggregateRating 读（平均分纳入排序分）', () => {
      publishCapability(makeMeta(), testDir);
      declareOwner('agent-001', undefined, testDir);

      addRating({ capabilityId: 'test-skill', raterId: 'r1', score: 0.8 }, testDir);
      addRating({ capabilityId: 'test-skill', raterId: 'r2', score: 0.6 }, testDir);

      const agg = aggregateRating('test-skill', 'agent-001', testDir);
      expect(agg.count).toBe(2);
      expect(agg.averageScore).toBeCloseTo(0.7, 5);
    });

    it('owners.jsonl（trust 更新）→ getTrustForRating 读（trust 纳入排序分）', () => {
      publishCapability(makeMeta(), testDir);
      declareOwner('agent-001', undefined, testDir);

      // 评价 + 调用量数据（让 rankScore 非 0，才能观察 trust 上调的效果）
      addRating({ capabilityId: 'test-skill', raterId: 'r1', score: 0.8 }, testDir);
      appendInvokeCount('test-skill', testDir);

      // trust 初始 0.5 → rankScore 基于 trust=0.5
      const aggBefore = aggregateRating('test-skill', 'agent-001', testDir);
      expect(aggBefore.trust).toBe(TRUST_INITIAL);
      expect(aggBefore.rankScore).toBeGreaterThan(0);

      // 5 条好评 → trust ≥ 0.6 → rankScore 应增大
      for (let i = 0; i < 5; i++) {
        updateTrustOnRating('agent-001', 0.9, testDir);
      }
      const aggAfter = aggregateRating('test-skill', 'agent-001', testDir);
      expect(aggAfter.trust).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);
      expect(aggAfter.rankScore).toBeGreaterThan(aggBefore.rankScore);
    });

    it('retired 标记（retire 写）→ restore 清 → catalog 过滤生效', () => {
      publishCapability(makeMeta(), testDir);

      // 退役后 searchCatalog 排除
      markRetired('test-skill', 'manual', true, testDir);
      expect(searchCatalog('test', testDir).count).toBe(0);

      // 恢复后 searchCatalog 重新可见
      restoreCapability('test-skill', testDir);
      expect(searchCatalog('test', testDir).count).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 退役后不可调用（调用环与退役环的衔接验证）
  // ──────────────────────────────────────────────────────────
  it('退役后的能力不可调用（调用环读退役状态）', async () => {
    publishCapability(makeMeta(), testDir);
    markRetired('test-skill', 'low_rating', true, testDir);

    const result = await invokeCapability(
      { capabilityId: 'test-skill', callerAgentId: 'caller-001' },
      mockExecutor,
      testDir,
    );

    expect(result.outcome).toBe('blocked');
    expect(result.reason).toContain('退役');
  });

  // ──────────────────────────────────────────────────────────
  // trust 三态贯穿五环（owner 声明 → 评价上调 → 退役下调）
  // ──────────────────────────────────────────────────────────
  it('trust 三态贯穿五环：初始 → 评价上调 → 退役下调', () => {
    publishCapability(makeMeta(), testDir);
    declareOwner('agent-001', undefined, testDir);

    // 初始 0.5
    expect(getTrust('agent-001', testDir)).toBe(TRUST_INITIAL);

    // 5 条好评 → ≥ 0.6
    for (let i = 0; i < 5; i++) {
      updateTrustOnRating('agent-001', 0.9, testDir);
    }
    const trustGood = getTrust('agent-001', testDir);
    expect(trustGood).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);

    // 退役 → trust 下调（markRetired 内部调 penalizeOnRetire）
    const ownerBefore = getOwner('agent-001', testDir);
    markRetired('test-skill', 'owner_request', true, testDir);
    const ownerAfter = getOwner('agent-001', testDir);
    expect(ownerAfter!.trust).toBeLessThan(ownerBefore!.trust);
  });
});
