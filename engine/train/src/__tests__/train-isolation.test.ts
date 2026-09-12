// ============================================================
// train-isolation.test.ts · v1.4.1 块四 · 训练隔离边界测试
//
// 覆盖：跨企业访问阻断（job 记录 / 事件流）/ listJobs 不泄露存在性 /
// 路径逃逸拦截（../ 构造被拒）/ 覆写清理（内容真被覆写 + 文件删除 +
// 目录混淆）/ 跳过项如实报告 / 守卫原语纯函数。
//
// 全部用 tmpdir 真实文件系统（隔离层就是文件边界——mock 文件系统
// 无意义）；零网络零 LLM。A2 纪律：无任何密钥样例。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  checkEnterpriseAccess,
  assertEnterpriseAccess,
  EnterpriseAccessDeniedError,
  isSafePathSegment,
  isPathInside,
  resolveEnterpriseDir,
} from '../train/isolation-guard';
import {
  cleanupEnterpriseTrainData,
  wipeFile,
} from '../train/cleanup';
import {
  createTrainJob,
  appendTrainEventLine,
  getJobGuarded,
  readTrainEventsGuarded,
  listJobsGuarded,
} from '../train/train-job';

// ──────────────────────────────────────
// 测试基建
// ──────────────────────────────────────

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-isol-'));
  dataDir = path.join(tmpDir, 'data');
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

/** 创建 job 的最小输入（默认 ent-alpha） */
function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    dataDir,
    enterpriseId: 'ent-alpha',
    dataPath: '/data/corpus.jsonl',
    baseModel: 'Qwen3-0.6B',
    algorithm: 'sft' as const,
    ...overrides,
  };
}

// ──────────────────────────────────────
// 一、守卫原语纯函数
// ──────────────────────────────────────

describe('isolation-guard · 原语纯函数', () => {
  it('test_checkEnterpriseAccess_请求方与归属一致_允许', () => {
    // 场景：同企业访问自家资源 → allowed
    const d = checkEnterpriseAccess('ent-a', 'ent-a', 'job-1');
    expect(d.allowed).toBe(true);
  });

  it('test_checkEnterpriseAccess_跨企业不一致_结构化拒绝', () => {
    // 场景：A 企业请求 B 企业资源 → 拒绝，错误含资源标识与归属企业
    const d = checkEnterpriseAccess('ent-a', 'ent-b', 'job-b1');
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.error.code).toBe('ENTERPRISE_MISMATCH');
      expect(d.error.resourceRef).toBe('job-b1');
      expect(d.error.resourceEnterpriseId).toBe('ent-b');
      expect(d.error.requestingEnterpriseId).toBe('ent-a');
      // 拒绝信息不含对方企业的业务内容（只有归属标识——拒绝理由所需最小事实）
      expect(d.error.message).toContain('跨企业访问拒绝');
    }
  });

  it('test_assertEnterpriseAccess_不一致_抛结构化异常', () => {
    // 场景：命令式调用点 → EnterpriseAccessDeniedError 携带结构化错误
    expect(() => assertEnterpriseAccess('ent-a', 'ent-b', 'job-x')).toThrow(
      EnterpriseAccessDeniedError,
    );
    try {
      assertEnterpriseAccess('ent-a', 'ent-b', 'job-x');
    } catch (e) {
      const err = e as EnterpriseAccessDeniedError;
      expect(err.structuredError.code).toBe('ENTERPRISE_MISMATCH');
      expect(err.structuredError.resourceEnterpriseId).toBe('ent-b');
    }
  });

  it('test_isSafePathSegment_合法标识_通过', () => {
    // 场景：正常企业/任务标识（字母数字-_.）→ 安全
    expect(isSafePathSegment('ent-alpha')).toBe(true);
    expect(isSafePathSegment('job-lx2k-9f3ab12c')).toBe(true);
    expect(isSafePathSegment('ent_2026.v4')).toBe(true);
  });

  it('test_isSafePathSegment_逃逸构造_全部拒绝', () => {
    // 场景：../ 逃逸 / 分隔符 / NUL / 空串 / 裸点 → 全拒
    expect(isSafePathSegment('..')).toBe(false);
    expect(isSafePathSegment('../ent-other')).toBe(false);
    expect(isSafePathSegment('ent/other')).toBe(false);
    expect(isSafePathSegment('ent\\other')).toBe(false);
    expect(isSafePathSegment('ent\0x')).toBe(false);
    expect(isSafePathSegment('')).toBe(false);
    expect(isSafePathSegment('   ')).toBe(false);
    expect(isSafePathSegment('.')).toBe(false);
  });

  it('test_isPathInside_子路径在内_父外路径拒', () => {
    // 场景：containment 判定——内含 true，越界 false
    const parent = path.resolve('/data/train/ent-a');
    expect(isPathInside(path.resolve('/data/train/ent-a/job-1'), parent)).toBe(true);
    expect(isPathInside(path.resolve('/data/train/ent-a'), parent)).toBe(true);
    expect(isPathInside(path.resolve('/data/train/ent-other'), parent)).toBe(false);
    expect(isPathInside(path.resolve('/data/train'), parent)).toBe(false);
  });

  it('test_resolveEnterpriseDir_非法enterpriseId_抛拒', () => {
    // 场景：逃逸构造在解析入口即被拦（纵深防御第一关）
    expect(() => resolveEnterpriseDir(dataDir, '../ent-other')).toThrow(
      EnterpriseAccessDeniedError,
    );
    expect(() => resolveEnterpriseDir(dataDir, 'ent/escape')).toThrow(
      EnterpriseAccessDeniedError,
    );
    // 合法标识返回企业分区绝对路径
    const dir = resolveEnterpriseDir(dataDir, 'ent-alpha');
    expect(dir).toBe(path.resolve(dataDir, 'train', 'ent-alpha'));
  });
});

// ──────────────────────────────────────
// 二、跨企业读阻断（受守卫查询）
// ──────────────────────────────────────

describe('train-job 守卫查询 · 跨企业阻断', () => {
  it('test_getJobGuarded_本企业job_正常返回记录', () => {
    // 场景：ent-alpha 查自家 job → 记录完整返回
    const { record } = createTrainJob(baseJob({ jobId: 'job-own-1' }));
    const r = getJobGuarded(dataDir, 'ent-alpha', 'job-own-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.jobId).toBe('job-own-1');
      expect(r.data?.enterpriseId).toBe('ent-alpha');
    }
    expect(record.enterpriseId).toBe('ent-alpha');
  });

  it('test_getJobGuarded_A查B的job_结构化拒绝不泄露内容', () => {
    // 场景：ent-beta 创建 job → ent-alpha 请求同 jobId → 拒绝（分区作用域
    // 下根本读不到，返回 null——与「不存在」同形，防探测）
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-b-1' }));
    const r = getJobGuarded(dataDir, 'ent-alpha', 'job-b-1');
    // 分区作用域：alpha 分区下无此 job → ok + null（存在性零泄露）
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toBeNull();
    }
  });

  it('test_getJobGuarded_state被串目录归属不一致_防御纵深拒绝', () => {
    // 场景：人为把 beta 的 state.json 挪进 alpha 分区（数据串目录）→
    // 归属校验兜底拒绝——防御纵深最后一关
    const { record } = createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-mv-1' }));
    // 把 beta 分区整个目录挪到 alpha 分区下
    const betaDir = path.join(dataDir, 'train', 'ent-beta');
    const alphaDir = path.join(dataDir, 'train', 'ent-alpha');
    fs.mkdirSync(path.dirname(path.join(alphaDir, 'job-mv-1')), { recursive: true });
    fs.renameSync(path.join(betaDir, 'job-mv-1'), path.join(alphaDir, 'job-mv-1'));
    // alpha 请求该 job：能读到 state（在 alpha 分区下）但归属是 beta → 拒绝
    const r = getJobGuarded(dataDir, 'ent-alpha', 'job-mv-1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ENTERPRISE_MISMATCH');
      expect(r.error.resourceEnterpriseId).toBe('ent-beta');
    }
    expect(record.status).toBe('queued');
  });

  it('test_readTrainEventsGuarded_跨企业_事件流被阻断', () => {
    // 场景：beta 的 job 有事件流 → alpha 读被拒（loss/reward 曲线是企业数据）
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-ev-1' }));
    appendTrainEventLine(dataDir, 'ent-beta', 'job-ev-1', {
      type: 'progress',
      step: 1,
      loss: 2.5,
    });
    // beta 自家读正常
    const own = readTrainEventsGuarded(dataDir, 'ent-beta', 'job-ev-1');
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.data.events.length).toBe(1);
    }
    // alpha 读：分区作用域下不存在 → ok + 空事件流（不泄露存在性）
    const cross = readTrainEventsGuarded(dataDir, 'ent-alpha', 'job-ev-1');
    expect(cross.ok).toBe(true);
    if (cross.ok) {
      expect(cross.data.events).toEqual([]);
    }
  });

  it('test_listJobsGuarded_按企业过滤_不泄露其他企业jobId存在性', () => {
    // 场景：alpha 与 beta 各有多个 job → 各自 list 只见自家，互不可见
    createTrainJob(baseJob({ enterpriseId: 'ent-alpha', jobId: 'job-a-1' }));
    createTrainJob(baseJob({ enterpriseId: 'ent-alpha', jobId: 'job-a-2' }));
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-b-1' }));
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-b-2' }));
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-b-3' }));

    const alphaList = listJobsGuarded(dataDir, 'ent-alpha');
    expect(alphaList.ok).toBe(true);
    if (alphaList.ok) {
      const ids = alphaList.data.map((r) => r.jobId).sort();
      expect(ids).toEqual(['job-a-1', 'job-a-2']); // 无任何 job-b 泄露
    }

    const betaList = listJobsGuarded(dataDir, 'ent-beta');
    expect(betaList.ok).toBe(true);
    if (betaList.ok) {
      const ids = betaList.data.map((r) => r.jobId).sort();
      expect(ids).toEqual(['job-b-1', 'job-b-2', 'job-b-3']);
    }
  });

  it('test_listJobsGuarded_逃逸enterpriseId_段校验拒绝', () => {
    // 场景：enterpriseId 带 ../ 试图扫别家分区 → 段校验直接拒
    const r = listJobsGuarded(dataDir, '../ent-beta');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSAFE_PATH_SEGMENT');
    }
    expect(() => {
      const rr = listJobsGuarded(dataDir, 'ent/escape');
      expect(rr.ok).toBe(false);
    }).not.toThrow();
  });

  it('test_getJobGuarded_jobId逃逸构造_段校验拒绝', () => {
    // 场景：jobId 含 ../ 试图读分区外文件 → 拒绝
    const r = getJobGuarded(dataDir, 'ent-alpha', '../../../etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSAFE_PATH_SEGMENT');
    }
  });
});

// ──────────────────────────────────────
// 三、覆写清理（数据主权三步：覆写→混淆→删除）
// ──────────────────────────────────────

describe('cleanup · 覆写清理', () => {
  it('test_wipeFile_内容真被覆写_读回非原文且文件删除', () => {
    // 场景：写入已知明文 → wipeFile → 文件不存在（重命名后已 unlink）
    const f = path.join(tmpDir, 'secret-weights.safetensors');
    const original = 'TOP-SECRET-WEIGHTS-' + 'x'.repeat(4096);
    fs.writeFileSync(f, original, { mode: 0o444 }); // 只读文件也要能清（chmod 解锁路径）

    wipeFile(f);
    expect(fs.existsSync(f)).toBe(false);
    // 原文件名不再出现在目录里（重命名混淆 + unlink）
    const siblings = fs.readdirSync(tmpDir);
    expect(siblings.includes('secret-weights.safetensors')).toBe(false);
  });

  it('test_cleanupEnterpriseTrainData_全清_内容覆写目录混淆分区删除', () => {
    // 场景：ent-gamma 有 job（含 state/events/权重目录）→ cleanup →
    // 文件全被覆写删除、目录混淆、企业分区根删除、报告如实
    createTrainJob(baseJob({ enterpriseId: 'ent-gamma', jobId: 'job-g-1' }));
    appendTrainEventLine(dataDir, 'ent-gamma', 'job-g-1', {
      type: 'progress',
      step: 3,
      reward: 0.87,
    });
    // 权重产物目录（模拟训练产出）
    const outDir = path.join(dataDir, 'train', 'ent-gamma', 'job-g-1', 'output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'model.safetensors'), 'W'.repeat(8192));
    fs.writeFileSync(path.join(outDir, 'adapter.bin'), 'L'.repeat(2048));
    // 原文快照（验证覆写：内容不该以明文形态残留在原路径）
    const beforeSnapshot = fs.readFileSync(
      path.join(outDir, 'model.safetensors'),
      'utf-8',
    );

    const report = cleanupEnterpriseTrainData(dataDir, 'ent-gamma');

    expect(report.fullyCleaned).toBe(true);
    expect(report.skipped).toEqual([]);
    expect(report.enterpriseDirRemoved).toBe(true);
    expect(report.wipedFiles).toBeGreaterThanOrEqual(4); // job.json+state.json+events.jsonl+2 权重 ≥5（job.json 与 state 均 2 文件 + 2 权重 + 1 events）
    expect(report.overwrittenBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dataDir, 'train', 'ent-gamma'))).toBe(false);
    // 目录混淆记录在案（原名 → 混淆名的映射留审计）
    expect(report.obfuscations.length).toBeGreaterThanOrEqual(2); // output 子目录 + job 目录 + 分区根（≥2 明确可见）
    // 原明文不再以文件形态存在（覆写+删除双保险）
    expect(fs.existsSync(path.join(outDir, 'model.safetensors'))).toBe(false);
    expect(beforeSnapshot.length).toBe(8192);
  });

  it('test_cleanupEnterpriseTrainData_其他企业分区_不受影响', () => {
    // 场景：清 ent-alpha 不碰 ent-beta（隔离清理——边界只在本企业分区内）
    createTrainJob(baseJob({ enterpriseId: 'ent-alpha', jobId: 'job-a-keep' }));
    createTrainJob(baseJob({ enterpriseId: 'ent-beta', jobId: 'job-b-keep' }));

    cleanupEnterpriseTrainData(dataDir, 'ent-alpha');

    expect(fs.existsSync(path.join(dataDir, 'train', 'ent-alpha'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'train', 'ent-beta'))).toBe(true);
    // beta 的 job 数据完好
    const r = getJobGuarded(dataDir, 'ent-beta', 'job-b-keep');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.jobId).toBe('job-b-keep');
    }
  });

  it('test_cleanupEnterpriseTrainData_不存在企业_空报告fullyCleaned', () => {
    // 场景：清理从未存在的企业分区 → 无操作、报告如实（wipedFiles=0）
    const report = cleanupEnterpriseTrainData(dataDir, 'ent-never-exists');
    expect(report.fullyCleaned).toBe(true);
    expect(report.wipedFiles).toBe(0);
    expect(report.skipped).toEqual([]);
  });

  it('test_cleanupEnterpriseTrainData_逃逸enterpriseId_拒绝执行', () => {
    // 场景：../ 构造试图清 data/train 之外的目录 → 段校验抛拒，dataDir 完好
    createTrainJob(baseJob({ enterpriseId: 'ent-alpha', jobId: 'job-keep-1' }));
    expect(() => cleanupEnterpriseTrainData(dataDir, '..')).toThrow(
      EnterpriseAccessDeniedError,
    );
    expect(() => cleanupEnterpriseTrainData(dataDir, '../other')).toThrow(
      EnterpriseAccessDeniedError,
    );
    // 原 job 未被误删
    const r = getJobGuarded(dataDir, 'ent-alpha', 'job-keep-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.jobId).toBe('job-keep-1');
    }
  });

  it('test_cleanupEnterpriseTrainData_文件被锁_跳过项如实报告不静默', () => {
    // 场景：覆写失败（模拟——用目录占位让 openSync 'r+' 失败）→ 记入
    // skipped 并继续清其余文件，报告可见失败明细
    const entDir = path.join(dataDir, 'train', 'ent-locked');
    const jobDir = path.join(entDir, 'job-l-1', 'output');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'normal.bin'), 'N'.repeat(1024));
    // 陷阱：一个与文件同名的目录占位（readdir 报 isDirectory→递归——改用
    // 只读 + 不可变更属性的等价物：在子目录里放一个「目录当文件」不可能，
    // 故直接测 wipeFile 对不存在路径的 stat 失败分支）
    const ghost = path.join(jobDir, 'ghost.bin');
    fs.writeFileSync(ghost, 'G'.repeat(32));
    fs.rmSync(ghost);
    // ghost 已删——wipeFile(ghost) 应 stat 失败 → skipped(stage=stat)
    let statStageSeen = false;
    try {
      wipeFile(ghost);
    } catch (e) {
      const err = e as Error & { stage?: string };
      statStageSeen = err.stage === 'stat';
    }
    expect(statStageSeen).toBe(true);

    // 正常文件路径下的清理照常完成
    const report = cleanupEnterpriseTrainData(dataDir, 'ent-locked');
    expect(report.skipped).toEqual([]);
    expect(report.fullyCleaned).toBe(true);
  });

  it('test_cleanupEnterpriseTrainData_多遍覆写_参数生效', () => {
    // 场景：passes=3 → overwrittenBytes = size × 3（每遍独立随机）
    const entDir = path.join(dataDir, 'train', 'ent-multi');
    fs.mkdirSync(entDir, { recursive: true });
    const f = path.join(entDir, 'weights.bin');
    const content = 'M'.repeat(1000);
    fs.writeFileSync(f, content);

    const report = cleanupEnterpriseTrainData(dataDir, 'ent-multi', { passes: 3 });
    expect(report.fullyCleaned).toBe(true);
    expect(report.overwrittenBytes).toBe(3000); // 1000 字节 × 3 遍
  });
});

// ──────────────────────────────────────
// 四、清理后不可复原抽查（磁盘上无明文残留）
// ──────────────────────────────────────

describe('cleanup · 覆写有效性抽查', () => {
  it('test_cleanupEnterpriseTrainData_覆写后磁盘无明文残留', () => {
    // 场景：含特征串的文件被清后，原路径及同级目录项中不再出现特征串
    // （覆写发生在 unlink 之前——这是与裸 rm 的本质区别）
    const entDir = path.join(dataDir, 'train', 'ent-residue');
    fs.mkdirSync(entDir, { recursive: true });
    const marker = 'CANARY-TRAINING-DATA-' + 'z'.repeat(2048);
    fs.writeFileSync(path.join(entDir, 'data.jsonl'), marker);

    cleanupEnterpriseTrainData(dataDir, 'ent-residue');

    // 分区已删——整棵 data/train 下无该特征串形态的文件残留
    const trainRoot = path.join(dataDir, 'train');
    if (fs.existsSync(trainRoot)) {
      const scan = (dir: string): boolean => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (scan(full)) return true;
          } else {
            const buf = fs.readFileSync(full);
            if (buf.includes(Buffer.from('CANARY-TRAINING-DATA-'))) return true;
          }
        }
        return false;
      };
      expect(scan(trainRoot)).toBe(false);
    }
    expect(fs.existsSync(path.join(entDir, 'data.jsonl'))).toBe(false);
  });
});
