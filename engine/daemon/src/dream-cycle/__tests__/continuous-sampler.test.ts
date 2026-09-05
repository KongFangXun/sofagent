// ============================================================
// dream-cycle/__tests__/continuous-sampler.test.ts · 持续采样器测试
// v1.4.5 第七章一新增
//
// 覆盖用例（共 6 case）：
//   一、日样本结构：三轴统计（eval passRate/知识库增量/修正回流）落盘
//   二、幂等：同日重采不推进天数（cursor 天数不变）
//   三、跨重启续跑：新目录句柄（模拟 daemon 重启）从 cursor 续采，
//       天数累积、基线延续
//   四、mock 7 天数据生成：连续 7 天采满 → daysSampled=7 且
//       mockDays 标注 → targetReached=false（降级轮不算达标）
//   五、eval 缺数如实记 null（不造假日样本）
//   六、readAllSamples + summarizeSamples：曲线序列 + 降级标注汇总
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  collectDailySample,
  loadCursor,
  readAllSamples,
  summarizeSamples,
  sampleFilePath,
  cursorFilePath,
  collectDailyDetails,
} from '../continuous-sampler';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-sampler-'));
}

/** 造一条当日 eval 记录（写入 benchmarks/<id>/evaluation-log.jsonl） */
function seedEvalRecord(dataDir: string, benchmarkId: string, date: string, score: number): void {
  const dir = path.join(dataDir, 'benchmarks', benchmarkId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, 'evaluation-log.jsonl'),
    JSON.stringify({ ts: `${date}T10:00:00.000Z`, benchmarkId, caseId: 'CASE-001', revision: 1, score }) + '\n',
    'utf-8',
  );
}

/** 造 knowledge entities 条目 */
function seedEntities(dataDir: string, count: number): void {
  const dir = path.join(dataDir, 'knowledge', 'entities');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, `concept-${i}.md`), `---\nsource: test\n---\n\n# concept ${i}\n`, 'utf-8');
  }
}

/** 造错题本条目 */
function seedFailureLog(dataDir: string, count: number): void {
  const dir = path.join(dataDir, 'instinct');
  fs.mkdirSync(dir, { recursive: true });
  const lines = Array.from({ length: count }, (_, i) => JSON.stringify({ ts: `2026-09-0${i + 1}T00:00:00Z`, pattern: `p${i}` }));
  fs.writeFileSync(path.join(dir, 'failure-log.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

/** 本地时区今日（与 sampler 内部 todayISO 同口径——采样按自然日切分） */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('continuous-sampler（持续样本采集）', () => {
  let home: string;
  let dataDir: string;

  beforeEach(() => {
    home = tmpDir();
    process.env.SOFAGENT_HOME = home;
    dataDir = path.join(home, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SOFAGENT_HOME;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例一：日样本结构——三轴统计落盘
  it('采集日样本：eval passRate + 知识库增量 + 修正回流三轴齐落 samples-<date>.json', async () => {
    const today = localToday();
    seedEvalRecord(dataDir, 'bench-main', today, 75);
    seedEvalRecord(dataDir, 'bench-main', today, 90);
    seedEvalRecord(dataDir, 'bench-main', today, 40);
    seedEntities(dataDir, 5);
    seedFailureLog(dataDir, 3);

    const result = await collectDailySample(dataDir, { skipDreamCycle: true });

    // 三轴断言
    expect(result.sample.evalPassRate).toBeCloseTo(2 / 3, 5); // 75/90 过（>=60），40 不过
    expect(result.sample.evalCaseCount).toBe(3);
    expect(result.sample.knowledgeEntities).toBe(5);
    expect(result.sample.knowledgeDelta).toBe(5); // 首日全量为基线
    expect(result.sample.correctionReflows).toBe(3);

    // 落盘断言（JSONL 一行）
    const filePath = sampleFilePath(dataDir, today);
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).evalPassRate).toBeCloseTo(2 / 3, 5);

    // 游标断言
    const cursor = loadCursor(dataDir);
    expect(cursor.daysSampled).toBe(1);
    expect(cursor.lastSampleDate).toBe(today);
  });

  // 用例二：同日幂等——不推进天数
  it('同日重采：cursor 天数不推进（幂等）', async () => {
    await collectDailySample(dataDir, { skipDreamCycle: true });
    await collectDailySample(dataDir, { skipDreamCycle: true });
    const cursor = loadCursor(dataDir);
    expect(cursor.daysSampled).toBe(1);
  });

  // 用例三：跨重启续跑——cursor 累积
  it('跨 daemon 重启续跑：cursor 天数累积、基线延续（delta 相对前日）', async () => {
    // 第一次采样（首日 5 条 entities）
    seedEntities(dataDir, 5);
    await collectDailySample(dataDir, { skipDreamCycle: true });

    // 模拟重启：换一个 sampler 调用周期（同 dataDir，cursor 从盘读）
    // 手动改 cursor 日期为昨天，使今日采样算新的一天
    const cursorPath = cursorFilePath(dataDir);
    const cursor = JSON.parse(fs.readFileSync(cursorPath, 'utf-8'));
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    cursor.lastSampleDate = yesterdayStr;
    fs.writeFileSync(cursorPath, JSON.stringify(cursor));

    // 新增 2 条 entities（当日增量）
    seedEntities(dataDir, 7);

    const result = await collectDailySample(dataDir, { skipDreamCycle: true });
    expect(result.cursor.daysSampled).toBe(2);
    expect(result.sample.knowledgeDelta).toBe(2); // 7 - 5（前日基线）
    expect(result.cursor.baselineEntities).toBe(7);
  });

  // 用例四：mock 7 天数据生成——降级轮不算达标
  it('连续 7 天采满（含降级轮）→ daysSampled=7、mockDays 标注、targetReached=false', async () => {
    // 直接构造 7 天样本文件（mock 7 天数据生成场景——验证汇总与达标判定）
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    dates.forEach((date, idx) => {
      const sample = {
        date,
        evalPassRate: 0.6 + idx * 0.02,
        evalCaseCount: 10,
        knowledgeEntities: 10 + idx,
        knowledgeDelta: idx === 0 ? 10 : 1,
        correctionReflows: idx,
        dreamCycleComplete: true,
        providerStatus: idx === 3 ? 'mock' : 'real', // 第 4 天降级
        sampledAt: `${date}T23:00:00.000Z`,
      };
      fs.mkdirSync(path.join(dataDir, 'evolution'), { recursive: true });
      fs.appendFileSync(sampleFilePath(dataDir, date), JSON.stringify(sample) + '\n');
    });

    const samples = readAllSamples(dataDir);
    expect(samples.length).toBe(7);
    const summary = summarizeSamples(samples);
    expect(summary.days).toBe(7);
    expect(summary.mockDays).toBe(1);
    expect(summary.targetReached).toBe(false); // 有降级轮——不达标
    expect(summary.passRateSeries.length).toBe(7);
  });

  // 用例五：eval 缺数如实记 null
  it('当日无 eval 记录 → evalPassRate=null（如实记缺数不造假）', async () => {
    const result = await collectDailySample(dataDir, { skipDreamCycle: true });
    expect(result.sample.evalPassRate).toBeNull();
    expect(result.sample.evalCaseCount).toBe(0);
  });

  // 用例六：达标判定——7 天全真脑
  it('7 天全真脑样本 → targetReached=true（达标口径：无降级轮）', () => {
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    dates.forEach((date, idx) => {
      const sample = {
        date,
        evalPassRate: 0.7,
        evalCaseCount: 10,
        knowledgeEntities: 10 + idx,
        knowledgeDelta: 1,
        correctionReflows: idx,
        dreamCycleComplete: true,
        providerStatus: 'real',
        sampledAt: `${date}T23:00:00.000Z`,
      };
      fs.mkdirSync(path.join(dataDir, 'evolution'), { recursive: true });
      fs.appendFileSync(sampleFilePath(dataDir, date), JSON.stringify(sample) + '\n');
    });
    const summary = summarizeSamples(readAllSamples(dataDir));
    expect(summary.days).toBe(7);
    expect(summary.mockDays).toBe(0);
    expect(summary.targetReached).toBe(true);
  });
});

describe('明细四件（Phase 4 尾巴 · D4 桥消费面对齐）', () => {
  let home: string;
  let dataDir: string;

  beforeEach(() => {
    home = tmpDir();
    process.env.SOFAGENT_HOME = home;
    dataDir = path.join(home, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SOFAGENT_HOME;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  /** 造 commons 三源明细数据 */
  function seedDetailSources(date: string): void {
    // ratings.jsonl：当日一条低分带 comment（→ lowScoreFeedback + correctionBackflow 双收），
    // 一条高分（不收），一条他日低分（不收——日期过滤）
    const ratingsDir = path.join(dataDir, 'commons');
    fs.mkdirSync(ratingsDir, { recursive: true });
    const ratings = [
      { capabilityId: 'cap-x', raterId: 'rater-1', score: 0.3, ratedAt: `${date}T10:00:00.000Z`, comment: '输出结构错误，应为 JSON' },
      { capabilityId: 'cap-y', raterId: 'rater-1', score: 0.9, ratedAt: `${date}T11:00:00.000Z` },
      { capabilityId: 'cap-z', raterId: 'rater-2', score: 0.2, ratedAt: '2000-01-01T00:00:00.000Z' },
    ];
    fs.writeFileSync(path.join(ratingsDir, 'ratings.jsonl'), ratings.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

    // invoke-log.jsonl：cap-x 当日 2 failed（→ repeatFailures + toolUsage），
    // cap-w 当日 3 success（→ 仅 toolUsage），他日 1 failed（不收）
    const invokes = [
      { ts: `${date}T09:00:00.000Z`, capabilityId: 'cap-x', callerAgentId: 'a1', outcome: 'failed', durationMs: 100, scanVerdict: '参数不合法' },
      { ts: `${date}T09:30:00.000Z`, capabilityId: 'cap-x', callerAgentId: 'a1', outcome: 'failed', durationMs: 90, scanVerdict: '参数不合法' },
      { ts: `${date}T10:00:00.000Z`, capabilityId: 'cap-x', callerAgentId: 'a2', outcome: 'success', durationMs: 50 },
      { ts: `${date}T11:00:00.000Z`, capabilityId: 'cap-w', callerAgentId: 'a1', outcome: 'success', durationMs: 30 },
      { ts: `${date}T11:30:00.000Z`, capabilityId: 'cap-w', callerAgentId: 'a2', outcome: 'success', durationMs: 25 },
      { ts: `${date}T12:00:00.000Z`, capabilityId: 'cap-w', callerAgentId: 'a3', outcome: 'success', durationMs: 20 },
      { ts: `2000-01-01T00:00:00.000Z`, capabilityId: 'cap-old', callerAgentId: 'a1', outcome: 'failed', durationMs: 10 },
    ];
    fs.writeFileSync(path.join(ratingsDir, 'invoke-log.jsonl'), invokes.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

    // failure-log.jsonl：当日一条 + 他日一条
    const instinctDir = path.join(dataDir, 'instinct');
    fs.mkdirSync(instinctDir, { recursive: true });
    const failures = [
      { id: 'f1', pattern: '未跑测试就提交', source: 'audit', context: 'A11 规则', timestamp: `${date}T08:00:00.000Z` },
      { id: 'f0', pattern: '旧记录', source: 'audit', context: '', timestamp: '2000-01-01T00:00:00.000Z' },
    ];
    fs.writeFileSync(path.join(instinctDir, 'failure-log.jsonl'), failures.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  }

  // 用例七：明细四件全链收集（有则填）
  it('collectDailyDetails：ratings/invoke-log/failure-log 当日明细正确聚合（日期过滤 + 阈值口径）', () => {
    const today = localToday();
    seedDetailSources(today);
    const details = collectDailyDetails(dataDir, today);

    // lowScoreFeedback：仅当日 score<0.5（cap-x 0.3 一条；cap-y 0.9 高分不收；cap-z 他日不收）
    expect(details.lowScoreFeedback.length).toBe(1);
    expect(details.lowScoreFeedback[0]!.capabilityId).toBe('cap-x');
    expect(details.lowScoreFeedback[0]!.comment).toContain('JSON');

    // correctionBackflow：cap-x 带 comment 低分（评分纠正源）+ failure-log 当日一条（错题本兜底源）= 2
    expect(details.correctionBackflow.length).toBe(2);
    const correctedIds = details.correctionBackflow.map((c) => c.capabilityId);
    expect(correctedIds).toContain('cap-x');
    expect(correctedIds.some((id) => id.startsWith('failure-pattern:'))).toBe(true);

    // repeatFailures：cap-x 当日 2 failed ≥2 收；cap-w 0 failed 不收；cap-old 他日不收
    expect(details.repeatFailures.length).toBe(1);
    expect(details.repeatFailures[0]!.capabilityId).toBe('cap-x');
    expect(details.repeatFailures[0]!.failCount).toBe(2);
    expect(details.repeatFailures[0]!.lastReason).toBe('参数不合法');

    // toolUsage：cap-x（3 调 1 成功→2/3）+ cap-w（3 调 3 成功→1.0）；cap-old 他日不收
    expect(details.toolUsage.length).toBe(2);
    const capX = details.toolUsage.find((t) => t.toolName === 'cap-x');
    const capW = details.toolUsage.find((t) => t.toolName === 'cap-w');
    expect(capX!.invokeCount).toBe(3);
    expect(capX!.successRate).toBeCloseTo(1 / 3, 5);
    expect(capW!.successRate).toBe(1);
  });

  // 用例八：源缺失 → 空明细（无则空）
  it('collectDailyDetails：三源缺失 → 四件全空（不造数不崩）', () => {
    const details = collectDailyDetails(dataDir, localToday());
    expect(details.correctionBackflow).toEqual([]);
    expect(details.lowScoreFeedback).toEqual([]);
    expect(details.repeatFailures).toEqual([]);
    expect(details.toolUsage).toEqual([]);
  });

  // 用例九：collectDailySample 携带明细落盘（字段级透传）
  it('collectDailySample：明细四件进 DailySample 落盘（有则填字段，空则省略）', async () => {
    const today = localToday();
    seedDetailSources(today);
    const result = await collectDailySample(dataDir, { skipDreamCycle: true });
    // 有明细：四字段齐落
    expect(result.sample.correctionBackflow!.length).toBe(2);
    expect(result.sample.lowScoreFeedback!.length).toBe(1);
    expect(result.sample.repeatFailures!.length).toBe(1);
    expect(result.sample.toolUsage!.length).toBe(2);
    // 落盘行透传（JSONL 行解析回读）
    const lines = fs.readFileSync(sampleFilePath(dataDir, today), 'utf-8').trim().split('\n');
    const persisted = JSON.parse(lines[lines.length - 1]!);
    expect(persisted.toolUsage.length).toBe(2);
    expect(persisted.repeatFailures[0].failCount).toBe(2);
  });

  // 用例十：skipDetails 逃生门 + 空明细省略字段（向后兼容）
  it('collectDailySample：skipDetails=true → 明细字段省略（旧读侧零感知）', async () => {
    const result = await collectDailySample(dataDir, { skipDreamCycle: true, skipDetails: true });
    expect(result.sample.correctionBackflow).toBeUndefined();
    expect(result.sample.lowScoreFeedback).toBeUndefined();
    expect(result.sample.repeatFailures).toBeUndefined();
    expect(result.sample.toolUsage).toBeUndefined();
  });

  // 用例十一：源在场但当日无匹配 → 空数组省略字段（有则填无则空的「无」）
  it('collectDailySample：源在场他日记录 → 字段省略（当日无明细）', async () => {
    const today = localToday();
    seedDetailSources(today);
    // 采样他日（构造无当日数据的采样调用）
    const otherDay = '2001-02-03';
    const details = collectDailyDetails(dataDir, otherDay);
    expect(details.lowScoreFeedback).toEqual([]);
    expect(details.toolUsage).toEqual([]);
  });
});
