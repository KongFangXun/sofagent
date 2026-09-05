// retention-policy.ts · v1.4.5 第五章 · 训练产物保留策略（解析 + 归档标记 + 过期清理 + 空间预警）
//
// 定位：训练跑多了会堆积大量历史 checkpoint 和旧训练集——「保留多少个回滚点、
// 旧 checkpoint 留多久、过期谁清」此前无定义（devlog 第五章定位段）。本文件
// 把保留策略代码化：
//
//   一、策略解析：train-retention.json（企业级可配）——默认保留
//       ① 最近 N 个 checkpoint（默认 5）
//       ② 当前生产权重（model-registry active 引用的 weightsDir + 版本）
//       ③ eval 基线对应训练集（dataset-version 台账中被基线 eval 引用的版本）
//       ④ FDE 交付包标记的回滚点（markRollbackPoint 登记的权重版本/job）
//       其余 checkpoint / 旧训练集 → 标记为可归档（archive 不删除——压缩冷存）
//   二、过期清理：归档超二次保留期（默认 90 天）→ train cleanup 覆写标准销毁
//       （复用 v1.4.1 ⑤ cleanup.ts 的 wipeFile——单遍随机覆写+截断+重命名+unlink）
//   三、空间预警：磁盘占用超阈值（默认 80%）→ 告警 + 建议清理（列最大可归档项）
//
// 与第四章交付包的衔接：train-deliverable 的「权重清单」含本文件标记的回滚点
// （依赖序：本文件先做标记接口，交付包消费）。
//
// 接口签名（spec-first）：
//   loadRetentionConfig(dataDir, enterpriseId): RetentionConfig
//   saveRetentionConfig(dataDir, enterpriseId, cfg): void
//   markRollbackPoint(dataDir, enterpriseId, input): RetentionMarker   ← 章四消费
//   queryRetentionDecision(dataDir, enterpriseId, now?): RetentionDecision ← 章四消费（回滚点列表）
//   archiveExpired(dataDir, enterpriseId, opts?): ArchiveReport        （daemon @weekly 调用）
//   purgeExpiredArchives(dataDir, enterpriseId, opts?): PurgeReport    （归档超 90 天覆写销毁）
//   checkDiskPressure(dataDir, opts?): DiskPressureReport              （空间预警）
//
// 数据结构：
//   RetentionConfig   = { keepCheckpoints, archiveAfterDays, purgeAfterDays, diskWarnPercent }
//   RetentionDecision = { keep: RetentionItem[], archive: RetentionItem[], rollbackPoints: RollbackPointRef[] }
//   RetentionItem     = { kind: 'checkpoint'|'dataset', path, trainJobId?, datasetId?, sizeBytes, reason }

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createHash, createHmac } from 'crypto';
import { join } from 'path';
import { atomicWriteSync, getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { trainJobDir, listTrainJobRecords } from './train-job';
import { wipeFile } from './cleanup';
import { buildZip } from './zip-writer';
import { readDatasetVersions } from './dataset-version';
import { loadRegistry } from '../model-registry';

// ════════════════════════════════════════
// 配置模型（train-retention.json）
// ════════════════════════════════════════

/** 保留策略配置（data/train/<enterpriseId>/train-retention.json） */
export interface RetentionConfig {
  /** 保留最近 N 个 checkpoint（每 job 维度；默认 5——devlog 第五章交付表） */
  keepCheckpoints: number;
  /** 归档二次保留期（天；归档包超此天数覆写销毁；默认 90） */
  purgeAfterDays: number;
  /** 磁盘空间预警阈值（0..1；默认 0.8 = 80%） */
  diskWarnPercent: number;
  /** 是否启用自动归档（daemon @weekly 消费；缺省 true） */
  autoArchive: boolean;
}

/** 缺省保留策略（devlog 第五章：最近 5 checkpoint + 90 天二次保留 + 80% 告警） */
export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  keepCheckpoints: 5,
  purgeAfterDays: 90,
  diskWarnPercent: 0.8,
  autoArchive: true,
};

/** 配置文件路径：data/train/<enterpriseId>/train-retention.json */
export function retentionConfigPath(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', enterpriseId, 'train-retention.json');
}

/**
 * 读取保留策略（段缺失/坏 JSON/字段非法 → 逐字段回落缺省值——fail-open，
 * 治理策略损坏不应阻断训练主链，回落即最保守的默认保留）。
 */
export function loadRetentionConfig(dataDir: string, enterpriseId: string): RetentionConfig {
  const file = retentionConfigPath(dataDir, enterpriseId);
  if (!existsSync(file)) return { ...DEFAULT_RETENTION_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<RetentionConfig>;
    const keep = Number(raw.keepCheckpoints);
    const purge = Number(raw.purgeAfterDays);
    const warn = Number(raw.diskWarnPercent);
    return {
      keepCheckpoints: Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_RETENTION_CONFIG.keepCheckpoints,
      purgeAfterDays: Number.isInteger(purge) && purge > 0 ? purge : DEFAULT_RETENTION_CONFIG.purgeAfterDays,
      diskWarnPercent: warn > 0 && warn <= 1 ? warn : DEFAULT_RETENTION_CONFIG.diskWarnPercent,
      autoArchive: typeof raw.autoArchive === 'boolean' ? raw.autoArchive : true,
    };
  } catch {
    return { ...DEFAULT_RETENTION_CONFIG };
  }
}

/** 持久化保留策略（原子写——企业级配置变更留痕在文件本身） */
export function saveRetentionConfig(dataDir: string, enterpriseId: string, cfg: RetentionConfig): void {
  const dir = join(dataDir, 'train', enterpriseId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(retentionConfigPath(dataDir, enterpriseId), JSON.stringify(cfg, null, 2));
}

// ════════════════════════════════════════
// 回滚点标记（章四交付包消费的接口）
// ════════════════════════════════════════

/** 回滚点引用（交付包权重清单的一等公民——被标记的版本永不归档） */
export interface RollbackPointRef {
  /** 标记对象类型：checkpoint 目录 / 权重版本目录 */
  kind: 'checkpoint' | 'weights';
  /** 对象相对路径（相对 data/train/<enterpriseId>/ 或权重根——清单引用键） */
  path: string;
  /** 关联训练任务（checkpoint 必填；weights 可空） */
  trainJobId?: string;
  /** 标记原因（交付包名 / 人工理由——审计可读） */
  reason: string;
  /** 标记时间（ISO） */
  markedAt: string;
}

/** 回滚点登记台账（data/train/<enterpriseId>/retention-markers.jsonl，append-only） */
export interface RetentionMarker {
  /** 台账行标识（sha256 前 16 位——幂等键） */
  id: string;
  /** 回滚点引用本体 */
  point: RollbackPointRef;
  /** HMAC 签名（防篡改——与 train-audit 同密钥同构造） */
  hmacSig: string;
}

/** markRollbackPoint 入参 */
export interface MarkRollbackPointInput {
  /** 对象类型 */
  kind: 'checkpoint' | 'weights';
  /** 对象相对路径 */
  path: string;
  /** 关联训练任务 */
  trainJobId?: string;
  /** 标记原因 */
  reason: string;
  /** 标记时间（缺省当前——测试可注入） */
  markedAt?: string;
}

/** 标记台账路径：data/train/<enterpriseId>/retention-markers.jsonl */
export function retentionMarkersPath(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', enterpriseId, 'retention-markers.jsonl');
}

/**
 * 标记回滚点（章四交付包生成时调用——被标记的 checkpoint/权重版本
// 进入永久保留集，永不归档永不清理）。
 *
 * 幂等：同 (kind, path) 已标记 → 返回既有行不重复追加。
 * 签名：point 经 stableStringify + 环境指纹 HMAC（与 train-audit 同密钥
 * ~/.sofagent-key——密钥不可用时签名记 'unsigned' 并照常写入，读取侧
 * 标记 unverifiable 但不阻断保留判定——标记的存在性比签名的完备性优先）。
 */
export function markRollbackPoint(
  dataDir: string,
  enterpriseId: string,
  input: MarkRollbackPointInput,
): RetentionMarker {
  if (typeof input.path !== 'string' || input.path.trim() === '') {
    throw new Error('[retention-policy] markRollbackPoint 拒绝：path 必填且非空');
  }
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw new Error('[retention-policy] markRollbackPoint 拒绝：reason 必填（审计可读）');
  }
  const point: RollbackPointRef = {
    kind: input.kind,
    path: input.path,
    ...(input.trainJobId !== undefined ? { trainJobId: input.trainJobId } : {}),
    reason: input.reason,
    markedAt: input.markedAt ?? new Date().toISOString(),
  };

  const file = retentionMarkersPath(dataDir, enterpriseId);
  const existing = readRetentionMarkers(dataDir, enterpriseId);
  const prior = existing.find((m) => m.point.kind === point.kind && m.point.path === point.path);
  if (prior) return prior;

  const hmacKey = getHmacKey();
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey)
        .update(stableStringify(point) + '|' + fingerprint)
        .digest('hex')
        .slice(0, 32)
    : 'unsigned';
  const id = createHash('sha256').update(`${point.kind}:${point.path}`).digest('hex').slice(0, 16);

  const marker: RetentionMarker = { id, point, hmacSig };
  const dir = join(dataDir, 'train', enterpriseId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // append-only 台账（文件不存在时首行起写；存在时读旧拼新——JSONL 逐行）
  const existingLines = existsSync(file) ? readFileSync(file, 'utf-8').trim() : '';
  writeFileSync(
    file,
    (existingLines.length > 0 ? existingLines + '\n' : '') + JSON.stringify(marker) + '\n',
    'utf-8',
  );
  return marker;
}

/** 读取全部回滚点标记（坏行跳过——查询侧容错，与 readTrainAudit 同语义） */
export function readRetentionMarkers(dataDir: string, enterpriseId: string): RetentionMarker[] {
  const file = retentionMarkersPath(dataDir, enterpriseId);
  if (!existsSync(file)) return [];
  const out: RetentionMarker[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RetentionMarker;
      if (parsed && typeof parsed.id === 'string' && parsed.point && typeof parsed.point.path === 'string') {
        out.push(parsed);
      }
    } catch {
      // 坏行跳过（台账容错——治理不因单行损坏全量失效）
    }
  }
  return out;
}

// ════════════════════════════════════════
// 保留判定（keep / archive 双列 + 回滚点列表）
// ════════════════════════════════════════

/** 保留判定条目（keep=保留不归档 / archive=可归档冷存） */
export interface RetentionItem {
  /** 条目类型：checkpoint 目录 / 数据集版本目录 */
  kind: 'checkpoint' | 'dataset';
  /** 绝对路径（归档动作的源路径） */
  path: string;
  /** 关联训练任务（checkpoint 有；dataset 无） */
  trainJobId?: string;
  /** 关联数据集（dataset 有） */
  datasetId?: string;
  /** 占用字节数（空间预警排序依据） */
  sizeBytes: number;
  /** 判定理由（人读——报告与审计消费） */
  reason: string;
}

/** 保留决策结果（queryRetentionDecision 输出——daemon 归档与交付包共用） */
export interface RetentionDecision {
  /** 企业标识 */
  enterpriseId: string;
  /** 生效策略（解析后——含回落） */
  config: RetentionConfig;
  /** 保留集（永不归档：最近 N checkpoint + 生产权重 + 基线训练集 + 回滚点） */
  keep: RetentionItem[];
  /** 可归档集（超保留期的旧 checkpoint / 旧训练集） */
  archive: RetentionItem[];
  /** 已标记的回滚点清单（章四交付包权重清单直接引用） */
  rollbackPoints: RollbackPointRef[];
  /** 生产权重目录（model-registry active 引用——保留集特例单列） */
  productionWeightsDir: string | null;
}

/** 目录递归字节数（含文件——符号链接按 stat 本身，不追内容防越界） */
function dirSize(dir: string): number {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    try {
      const st = statSync(full);
      total += e.isDirectory() ? dirSize(full) : st.size;
    } catch {
      // 单项 stat 失败跳过（大小估算尽力而为）
    }
  }
  return total;
}

/**
 * 保留判定（纯查询——不动磁盘）。
 *
 * 判定规则（devlog 第五章交付表逐条）：
 *   一、checkpoint：每 job 目录下按目录名倒序（时间序代理），最近
 *       keepCheckpoints 个进 keep，其余进 archive
 *   二、生产权重：model-registry 中 status=active 的 local-path 条目
 *       localWeights.dir 整目录进 keep（全部版本——切版本即回滚点）
 *   三、eval 基线训练集：dataset-version 台账最新一条（版本链尾）进 keep；
 *       其余旧版本进 archive
 *   四、回滚点：retention-markers.jsonl 登记的 path 命中的 checkpoint/
 *       权重版本强制进 keep（从 archive 集中剔除）
 */
export function queryRetentionDecision(
  dataDir: string,
  enterpriseId: string,
  _now?: Date,
): RetentionDecision {
  const config = loadRetentionConfig(dataDir, enterpriseId);
  const markers = readRetentionMarkers(dataDir, enterpriseId);
  const rollbackPaths = new Set(markers.map((m) => m.point.path));

  const keep: RetentionItem[] = [];
  const archive: RetentionItem[] = [];

  // ── 一、checkpoint（逐 job）──
  const jobs = listTrainJobRecords(dataDir, enterpriseId);
  for (const job of jobs) {
    const checkpointsRoot = join(trainJobDir(dataDir, enterpriseId, job.jobId), 'checkpoints');
    if (!existsSync(checkpointsRoot)) continue;
    // 检查点目录名通常按步数递增（step-100/step-200…）；名字序即时间序代理
    const entries = readdirSync(checkpointsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // 倒序——最新在前
    entries.forEach((name, idx) => {
      const path = join(checkpointsRoot, name);
      // 相对路径（回滚点标记的对齐键——checkpoints/<jobId>/<name> 与标记侧约定一致）
      const rel = `checkpoints/${job.jobId}/${name}`;
      const item: RetentionItem = {
        kind: 'checkpoint',
        path,
        trainJobId: job.jobId,
        sizeBytes: dirSize(path),
        reason: '',
      };
      if (idx < config.keepCheckpoints) {
        item.reason = `最近第 ${idx + 1} 个 checkpoint（策略保留 ${config.keepCheckpoints} 个）`;
        keep.push(item);
      } else if (rollbackPaths.has(rel)) {
        item.reason = `回滚点标记命中（${markers.find((m) => m.point.path === rel)?.point.reason ?? ''}）`;
        keep.push(item);
      } else {
        item.reason = `超保留期（第 ${idx + 1} 个 > 保留 ${config.keepCheckpoints} 个）`;
        archive.push(item);
      }
    });
  }

  // ── 二、生产权重（model-registry active 条目）──
  let productionWeightsDir: string | null = null;
  try {
    const registry = loadRegistry(dataDir);
    for (const entry of Object.values(registry.models)) {
      if (entry.status === 'active' && entry.localWeights) {
        productionWeightsDir = entry.localWeights.dir;
        if (existsSync(entry.localWeights.dir)) {
          keep.push({
            kind: 'checkpoint', // 权重目录按 checkpoint 语义保留（复用条目类型）
            path: entry.localWeights.dir,
            trainJobId: undefined,
            sizeBytes: dirSize(entry.localWeights.dir),
            reason: `生产权重（注册表 active：${entry.name} @ ${entry.localWeights.currentVersion}）`,
          });
        }
        break; // 单生产权重假设（registry.active 双档位同权重目录的多数场景）
      }
    }
  } catch {
    // 注册表损坏 → 生产权重保留判定跳过（宁可少判不误删）
  }

  // ── 三、数据集版本（版本链尾保留，旧版本可归档）──
  try {
    const versions = readDatasetVersions(dataDir, enterpriseId);
    // 台账天然 append 序（旧→新）；逐 datasetId 取链尾
    const latestByDataset = new Map<string, string>();
    for (const v of versions) {
      latestByDataset.set(v.datasetId, v.version);
    }
    for (const v of versions) {
      const dsDir = join(dataDir, 'train', enterpriseId, 'datasets', v.datasetId);
      const item: RetentionItem = {
        kind: 'dataset',
        path: dsDir,
        datasetId: v.datasetId,
        sizeBytes: dirSize(dsDir),
        reason: '',
      };
      if (v.version === latestByDataset.get(v.datasetId)) {
        item.reason = `eval 基线对应训练集（${v.datasetId} 链尾版本 ${v.version}）`;
        keep.push(item);
      } else {
        item.reason = `旧版本（${v.datasetId} 版本 ${v.version}——非链尾）`;
        archive.push(item);
      }
    }
  } catch {
    // 版本台账损坏 → 数据集判定跳过（同上——治理容错）
  }

  // ── 四、回滚点兜底（weights 类标记——不在 checkpoint 集内的直接进 keep）──
  for (const marker of markers) {
    if (marker.point.kind !== 'weights') continue;
    const abs = marker.point.path.startsWith('/')
      ? marker.point.path
      : join(dataDir, marker.point.path);
    if (!existsSync(abs)) continue;
    if (keep.some((k) => k.path === abs) || archive.some((a) => a.path === abs)) continue;
    keep.push({
      kind: 'checkpoint',
      path: abs,
      ...(marker.point.trainJobId !== undefined ? { trainJobId: marker.point.trainJobId } : {}),
      sizeBytes: dirSize(abs),
      reason: `回滚点标记（weights：${marker.point.reason}）`,
    });
  }

  // 归档集二次剔除（回滚点绝对路径兜底——防相对/绝对两种登记形态穿透）
  const rollbackAbsPaths = new Set(
    markers.map((m) =>
      m.point.path.startsWith('/') ? m.point.path : join(dataDir, 'train', enterpriseId, m.point.path),
    ),
  );
  const filteredArchive = archive.filter((a) => !rollbackAbsPaths.has(a.path));
  const ejected = archive.filter((a) => rollbackAbsPaths.has(a.path));
  for (const e of ejected) {
    // 回滚点从 archive 集剔除后归入 keep（判定透明——保留理由带原判定）
    keep.push({ ...e, reason: `回滚点标记命中（原判定：${e.reason}）` });
  }

  return {
    enterpriseId,
    config,
    keep,
    archive: filteredArchive,
    rollbackPoints: markers.map((m) => m.point),
    productionWeightsDir,
  };
}

// ════════════════════════════════════════
// 归档动作（daemon @weekly 调用——压缩冷存 + 审计）
// ════════════════════════════════════════

/** 归档目录：data/train/archive/<enterpriseId>/（企业分区隔离同源） */
export function trainArchiveDir(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', 'archive', enterpriseId);
}

/** 归档报告（archiveExpired 输出） */
export interface ArchiveReport {
  /** 本轮归档条目 */
  archived: Array<{
    /** 源路径（归档后已删除） */
    source: string;
    /** 归档包路径（data/train/archive/<ent>/ 下） */
    archiveFile: string;
    /** 压缩前字节数 */
    originalBytes: number;
    /** 压缩后字节数 */
    archivedBytes: number;
  }>;
  /** 归档失败项（如实报告不静默） */
  failures: Array<{ source: string; reason: string }>;
  /** 归档审计事件（emitTrainAudit type=train_archive——防篡改链） */
  auditEventId: string | null;
  /** 执行时间戳 */
  ranAt: string;
}

/**
 * 归档过期产物（决策 archive 集逐项：目录 → zip 冷存 → 源目录 rm）。
 *
 * 归档不删除（devlog 第五章交付表）——压缩冷存语义：
 *   一、逐项收集目录内全部文件（相对路径排序——确定性清单）
 *   二、buildZip 压缩 → data/train/archive/<ent>/<jobId>-<name>.zip
 *   三、写归档台账行（archive-<hash>.json：源路径/原尺寸/归档时间/zip sha256）
 *   四、源目录删除（内容已在冷存——rm 即可，覆写留给 90 天后的 purge）
 *
 * 审计：归档完成写 train-audit 的扩展事件（v1.4.5 新增 train_archive 类型
 * 已占位扩展位语义；实现侧经 emitTrainAudit 落 audit.jsonl 链）。⚠️ 事件
 * 类型字段沿用既有 union（train_job_checkpoint 近义）会失真——本函数审计
 * 落 data/train/archive/<ent>/archive-audit.jsonl 自持台账（HMAC 链同构），
 * 不侵入 train-audit.ts 的类型 union（D1 线在动 train-audit，避免撞文件）。
 */
export function archiveExpired(
  dataDir: string,
  enterpriseId: string,
  opts: { now?: Date } = {},
): ArchiveReport {
  const ranAt = (opts.now ?? new Date()).toISOString();
  const decision = queryRetentionDecision(dataDir, enterpriseId);
  const report: ArchiveReport = { archived: [], failures: [], auditEventId: null, ranAt };

  if (!decision.config.autoArchive) return report; // 策略显式关闭——空跑
  if (decision.archive.length === 0) return report;

  const archiveDir = trainArchiveDir(dataDir, enterpriseId);
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  for (const item of decision.archive) {
    try {
      // ── 收集文件（相对路径排序）──
      const files: Array<{ name: string; data: Buffer }> = [];
      const collect = (dir: string, prefix: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
          if (e.isDirectory()) collect(full, rel);
          else if (e.isFile()) files.push({ name: rel, data: readFileSync(full) });
        }
      };
      collect(item.path, '');
      if (files.length === 0) {
        throw new Error('目录为空或不可读（无可归档内容）');
      }

      // ── zip 冷存 ──
      const zip = buildZip(files, { at: opts.now ?? new Date() });
      const label = item.kind === 'checkpoint'
        ? `${item.trainJobId ?? 'job'}-${item.path.split('/').pop() ?? 'ckpt'}`
        : `${item.datasetId ?? 'ds'}`;
      const archiveFile = join(archiveDir, `${label}.zip`);
      writeFileSync(archiveFile, zip, { flag: 'wx' }); // 不覆盖既有归档（幂等保护）

      // ── 台账行（purge 判 90 天的依据）──
      const entry = {
        source: item.path,
        archiveFile,
        originalBytes: item.sizeBytes,
        archivedBytes: zip.length,
        zipSha256: createHash('sha256').update(zip).digest('hex'),
        archivedAt: ranAt,
      };
      const ledger = join(archiveDir, 'archive-ledger.jsonl');
      writeFileSync(ledger, JSON.stringify(entry) + '\n', { flag: 'a' });

      // ── 源目录删除（内容已冷存）──
      rmSync(item.path, { recursive: true, force: true });
      report.archived.push({
        source: item.path,
        archiveFile,
        originalBytes: entry.originalBytes,
        archivedBytes: entry.archivedBytes,
      });
    } catch (e) {
      report.failures.push({
        source: item.path,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── 归档审计（自持台账——HMAC 链同构，见函数头注释）──
  if (report.archived.length > 0) {
    try {
      const hmacKey = getHmacKey();
      const fingerprint = getEnvFingerprint(dataDir);
      const record = {
        ts: ranAt,
        type: 'train_archive',
        enterpriseId,
        archived: report.archived.map((a) => ({ source: a.source, archiveFile: a.archiveFile })),
        failures: report.failures,
      };
      const hmacSig = hmacKey
        ? createHmac('sha256', hmacKey)
            .update(stableStringify(record) + '|' + fingerprint)
            .digest('hex')
            .slice(0, 32)
        : 'unsigned';
      const auditFile = join(archiveDir, 'archive-audit.jsonl');
      writeFileSync(auditFile, JSON.stringify({ ...record, hmacSig }) + '\n', { flag: 'a' });
      report.auditEventId = `${ranAt}:${report.archived.length}`;
    } catch {
      // 审计写失败不回滚归档（归档已完成是事实——审计缺失在 failures 如实可见）
    }
  }

  return report;
}

// ════════════════════════════════════════
// 过期清理（归档超 90 天 → 覆写销毁）
// ════════════════════════════════════════

/** 清理报告（purgeExpiredArchives 输出） */
export interface PurgeReport {
  /** 已覆写销毁的归档包 */
  purged: Array<{ archiveFile: string; archivedAt: string; ageDays: number }>;
  /** 清理失败项（如实报告） */
  failures: Array<{ archiveFile: string; reason: string }>;
  /** 二次保留期（天——本次生效值） */
  purgeAfterDays: number;
  ranAt: string;
}

/**
 * 覆写销毁超期归档（train cleanup 覆写标准——复用 cleanup.ts wipeFile：
 * 单遍随机覆写 + 截断 + 重命名 + unlink；zip 台账行同步抹除）。
 *
 * 判定：archive-ledger.jsonl 逐行读 archivedAt，now - archivedAt >
 * purgeAfterDays（默认 90 天）→ 归档 zip 过 wipeFile 销毁 + 台账行删除。
 * 台账行删除采用重写（过滤后原子写回——append-only 在销毁语境下让位，
 * 销毁事实本身即审计信号：行消失 = 包已销毁）。
 */
export function purgeExpiredArchives(
  dataDir: string,
  enterpriseId: string,
  opts: { now?: Date } = {},
): PurgeReport {
  const now = opts.now ?? new Date();
  const config = loadRetentionConfig(dataDir, enterpriseId);
  const report: PurgeReport = {
    purged: [],
    failures: [],
    purgeAfterDays: config.purgeAfterDays,
    ranAt: now.toISOString(),
  };

  const archiveDir = trainArchiveDir(dataDir, enterpriseId);
  const ledger = join(archiveDir, 'archive-ledger.jsonl');
  if (!existsSync(ledger)) return report;

  const lines = readFileSync(ledger, 'utf-8').split('\n').filter((l) => l.trim() !== '');
  const kept: string[] = [];
  const purgeMs = config.purgeAfterDays * 24 * 60 * 60 * 1000;

  for (const line of lines) {
    let entry: { archiveFile: string; archivedAt: string };
    try {
      entry = JSON.parse(line) as { archiveFile: string; archivedAt: string };
    } catch {
      kept.push(line); // 坏行保留（不因清理丢台账）
      continue;
    }
    const ageMs = now.getTime() - Date.parse(entry.archivedAt);
    if (!Number.isNaN(ageMs) && ageMs > purgeMs) {
      try {
        if (existsSync(entry.archiveFile)) {
          wipeFile(entry.archiveFile); // v1.4.1 ⑤ 覆写标准（单遍随机+截断+混淆+unlink）
        }
        report.purged.push({
          archiveFile: entry.archiveFile,
          archivedAt: entry.archivedAt,
          ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
        });
        // 台账行不进 kept（包已销毁——行随包走）
      } catch (e) {
        report.failures.push({
          archiveFile: entry.archiveFile,
          reason: e instanceof Error ? e.message : String(e),
        });
        kept.push(line); // 销毁失败保留台账行（下轮重试）
      }
    } else {
      kept.push(line);
    }
  }

  if (report.purged.length > 0 || report.failures.length > 0) {
    atomicWriteSync(ledger, kept.length > 0 ? kept.join('\n') + '\n' : '');
  }
  return report;
}

// ════════════════════════════════════════
// 空间预警（磁盘超 80% 告警 + 清理建议）
// ════════════════════════════════════════

/** 空间预警报告（checkDiskPressure 输出） */
export interface DiskPressureReport {
  /** 是否告警（usedRatio ≥ 阈值） */
  warning: boolean;
  /** 数据盘占用比（0..1——statfsSync 不可用时 null） */
  usedRatio: number | null;
  /** 告警阈值（0..1） */
  threshold: number;
  /** 数据盘路径 */
  dir: string;
  /** 告警消息（warning=true 时非空——人读） */
  message: string | null;
  /** 清理建议：最大可归档项（降序——空间预警的行动指引） */
  suggestions: Array<{
    /** 归档候选项（retention 决策的 archive 集） */
    path: string;
    sizeBytes: number;
    /** 建议动作（人读） */
    action: string;
  }>;
}

/**
 * 空间预警（磁盘占用超阈值 → 告警 + 清理建议）。
 *
 * 实现：fs.statfsSync（Node ≥ 18.15 / ≥ 19.6——本仓 engines.node ≥ 18 与
 * 运行时 24.x 满足；不可用时降级 null 比例 + 不告警——预警失明比误报好）。
 * 建议：按 queryRetentionDecision 的 archive 集按 sizeBytes 降序列最大项
 * （「列最大的可归档项」——devlog 第五章交付表原文）。
 */
export function checkDiskPressure(
  dataDir: string,
  opts: { threshold?: number; enterpriseId?: string } = {},
): DiskPressureReport {
  const threshold = opts.threshold ?? DEFAULT_RETENTION_CONFIG.diskWarnPercent;
  const report: DiskPressureReport = {
    warning: false,
    usedRatio: null,
    threshold,
    dir: dataDir,
    message: null,
    suggestions: [],
  };

  // ── 占用比探测（降级容错）──
  let usedRatio: number | null = null;
  try {
    // 局部 require 防低版本类型面报错（statfsSync 在 @types/node 24 在场）
    const fsStat = require('fs') as { statfsSync?: (p: string) => { bavail: number; blocks: number } };
    if (typeof fsStat.statfsSync === 'function') {
      const st = fsStat.statfsSync(dataDir);
      const total = st.blocks;
      if (total > 0) usedRatio = 1 - st.bavail / total;
    }
  } catch {
    usedRatio = null; // 降级——见函数头
  }
  report.usedRatio = usedRatio;

  // ── 告警判定 + 建议 ──
  if (usedRatio !== null && usedRatio >= threshold) {
    report.warning = true;
    report.message = `磁盘占用 ${(usedRatio * 100).toFixed(1)}% 超阈值 ${(threshold * 100).toFixed(0)}%——建议归档以下最大项释放空间`;
    if (opts.enterpriseId !== undefined) {
      const decision = queryRetentionDecision(dataDir, opts.enterpriseId);
      report.suggestions = [...decision.archive]
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .map((item) => ({
          path: item.path,
          sizeBytes: item.sizeBytes,
          action: `归档冷存（${item.reason}，约 ${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB）`,
        }));
    }
  }
  return report;
}
