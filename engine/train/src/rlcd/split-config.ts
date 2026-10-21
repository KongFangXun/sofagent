// split-config.ts · v1.7.0 §六 · 训练集/校准集切分口径（家族级键切分 · 可复算）
// ============================================================
// 定位：训练/校准同源于判据集池，切分规则落配置并可脚本复算——
//   1. 家族级键切分（§二「轨迹/租户粒度」的落实现，v1.7.0 §五同构）：
//      同一来源家族（familyKey）整体留同一侧，不跨训练/校准切；
//   2. 比例 + 随机种子落配置（同配置同切分——确定性）；
//   3. 两侧 id 清单输出 + 交集 == ∅ 断言（§三门禁同批断言面）。
// 直跑复算：npm run build && node engine/train/dist/rlcd/split-config.js
// ============================================================
/** 切分配置（比例与种子落配置——可复现的单一事实源） */
export interface SplitConfig {
  /** 校准侧目标占比（0–1 开区间；缺省 0.2） */
  calibRatio: number;
  /** 随机种子（确定性切分的种子——同种子同切分） */
  seed: number;
}

/** 缺省切分配置（0.2 / 42——校准侧两成，种子 42） */
export const DEFAULT_SPLIT_CONFIG: SplitConfig = { calibRatio: 0.2, seed: 42 };

/** 切分结果（两侧 id 清单——交集必空） */
export interface SplitResult {
  /** 训练侧样本 id 清单 */
  trainIds: string[];
  /** 校准侧样本 id 清单 */
  calibIds: string[];
  /** 交集（恒空——非空即切分实现缺陷） */
  intersection: string[];
  /** 配置回显（复算对账用） */
  config: SplitConfig;
}

/**
 * 确定性伪随机数（mulberry32——同种子同序列，仓内自实现不引依赖）。
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 家族级键切分：把样本按 familyKey 分组，家族整体分配到同一侧
 * （同家族不跨侧——防泄漏的家族级落实现）。
 * 输入：familyKey → 样本 id 列表（分组已由调用方完成）；
 * 输出：两侧 id 清单 + 交集（恒空断言面）。
 */
export function splitByFamily(
  families: ReadonlyMap<string, readonly string[]>,
  config?: Partial<SplitConfig>,
): SplitResult {
  const cfg: SplitConfig = {
    calibRatio: config?.calibRatio ?? DEFAULT_SPLIT_CONFIG.calibRatio,
    seed: config?.seed ?? DEFAULT_SPLIT_CONFIG.seed,
  };
  if (!(0 < cfg.calibRatio && cfg.calibRatio < 1)) {
    throw new Error(`[split-config] calibRatio=${cfg.calibRatio} 非法（须 0–1 开区间）`);
  }
  // 家族键排序（确定性——不依赖 Map 插入序）
  const keys = [...families.keys()].sort();
  const rand = mulberry32(cfg.seed);
  const trainIds: string[] = [];
  const calibIds: string[] = [];
  for (const key of keys) {
    // 家族整体留同侧（同家族样本永不跨侧）
    const side = rand() < cfg.calibRatio ? 'calib' : 'train';
    const ids = families.get(key) ?? [];
    (side === 'calib' ? calibIds : trainIds).push(...ids);
  }
  const trainSet = new Set(trainIds);
  const intersection = calibIds.filter((id) => trainSet.has(id));
  return { trainIds, calibIds, intersection, config: cfg };
}

// ════════════════════════════════════════
// CLI 直跑面（node 直跑复算：给定配置输出两侧 id 清单 + 交集断言）
// ════════════════════════════════════════

function main() {
  // 从最小子集 questions.jsonl 读入，按 criterionId 家族分组（判据派生集的
  // 家族级键 = criterionId——同判据题同侧）
  const path = process.argv[2];
  if (!path) {
    console.error('用法: node split-config.js <questions.jsonl 路径> [calibRatio] [seed]');
    process.exit(1);
  }
  const { readFileSync } = require('fs') as typeof import('fs');
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const families = new Map<string, string[]>();
  for (const line of lines) {
    const q = JSON.parse(line) as { id: string; criterionId: string };
    const bucket = families.get(q.criterionId) ?? [];
    bucket.push(q.id);
    families.set(q.criterionId, bucket);
  }
  const result = splitByFamily(families, {
    calibRatio: process.argv[3] !== undefined ? Number(process.argv[3]) : undefined,
    seed: process.argv[4] !== undefined ? Number(process.argv[4]) : undefined,
  });
  console.log(JSON.stringify({
    config: result.config,
    trainCount: result.trainIds.length,
    calibCount: result.calibIds.length,
    intersection: result.intersection,
    intersectionEmpty: result.intersection.length === 0,
    calibFamilies: [...families.keys()].filter((k) => result.calibIds.includes((families.get(k) ?? [''])[0]!)),
  }, null, 2));
  if (result.intersection.length !== 0) {
    console.error('[split-config] ✗ 交集非空——切分实现缺陷');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
