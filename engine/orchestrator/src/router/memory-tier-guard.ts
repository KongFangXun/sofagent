/**
 * 内存档守卫（v1.8.0 L228 收口补件 · 2026-11-06）
 *
 * 为什么要有这个模块：
 *   v1.8.0 的无 GPU 单机档验收项要求「该档是否触发降级（有断言）」。此前只有
 *   「实测 9 次判定 0 次触发」的事实读数，没有**可断言的判定路径**——「内存不足
 *   时到底会怎样」没有代码给出答案。本模块补的就是这条路径：**超阈拒绝加载并以
 *   非 0 退出**。
 *
 * 为什么按「档位预算」而不是「此刻空闲」判（2026-11-06 实测修正）：
 *   macOS 的 `os.freemem()` 只算真正空闲页，系统会大量占用 cache，实测本机 8GB 档
 *   仅报 ~190 MB 空闲。若按 freemem 判，8GB 档跑 1.7B 会被**误拒**——而该档实测
 *   确实跑得动（p50 13.81 s）。故判据改为「**档位物理可能**」：
 *     budget = totalMem × usableRatio（默认 0.8，为系统与其他进程留 20%）
 *   freemem 仅作参考读数进 detail，**不参与判定**（它是瞬时量，加载器可回收 cache）。
 *
 * 口径四条：
 *   ① 判据是「是否触发降级」，答案是「不降档、直接拒绝」——拒绝也是「不触发降级」
 *      的可断言实现，且比静默降档更安全（判定件不带着不确定的内存状态跑）。
 *   ② 余量 headroomRatio 默认 1.25×（覆盖 KV cache 与运行时开销的粗估）；该系数是
 *      **工程经验值**，不是实测标定值——标定需目标机型，属 not-measured。
 *   ③ usableRatio 默认 0.8，同为经验值，不冒充实测。
 *   ④ 非法输入返回 invalid-input（不抛错），便于 CLI 统一 exit 码。
 */

/** 内存档标签（与 VALIDATION「内存档位对照」同命名口径） */
export type MemoryTierLabel = '4gb' | '8gb' | '16gb' | '32gb+' | 'unknown';

export interface MemoryTierInput {
  /** 系统总内存（字节）——生产传 os.totalmem() */
  totalMemBytes: number;
  /** 系统空闲内存（字节）——生产传 os.freemem()；**仅参考，不参与判定** */
  freeMemBytes: number;
  /** 待加载判定件体积（字节）——通常来自 weights-manifest 的 sizeBytes */
  modelSizeBytes: number;
  /** 加载余量系数（默认 1.25；<1 视为非法） */
  headroomRatio?: number;
  /** 档位可用比例（默认 0.8；(0,1] 之外视为非法） */
  usableRatio?: number;
}

export interface MemoryTierVerdict {
  /** true = 可加载；false = 超阈，调用方须拒绝加载并以非 0 退出 */
  ok: boolean;
  /** 拒绝原因（ok=true 时缺省） */
  reason?: 'insufficient-memory' | 'invalid-input';
  /** 档位标签（按总内存分档，与 VALIDATION 对照表同口径） */
  tier: MemoryTierLabel;
  /** 本次判定所需内存（modelSizeBytes × headroomRatio，向上取整） */
  requiredBytes: number;
  /** 档位可用预算（totalMemBytes × usableRatio，向上取整）——**判定依据** */
  budgetBytes: number;
  /** 参考读数：当前空闲（不参与判定） */
  freeMemBytes: number;
  /** 人读说明（含三个数字：需 / 预算 / 当前空闲） */
  detail: string;
}

const DEFAULT_HEADROOM = 1.25;
const DEFAULT_USABLE = 0.8;

const MB = 1024 ** 2;

/** 按总内存分档（6 / 12 / 24 GB 为界；低于 6 归 4GB 档，避免 8GB 机因系统占用被误判） */
export function tierOf(totalMemBytes: number): MemoryTierLabel {
  const gb = totalMemBytes / 1024 ** 3;
  if (gb < 6) return '4gb';
  if (gb < 12) return '8gb';
  if (gb < 24) return '16gb';
  return '32gb+';
}

/**
 * 内存档判定：档位预算够则 ok，不够则拒绝（**不降档**——本仓无双模型常驻，降档无对象）。
 */
export function checkMemoryTier(input: MemoryTierInput): MemoryTierVerdict {
  const { totalMemBytes, freeMemBytes, modelSizeBytes } = input;
  const headroom = input.headroomRatio ?? DEFAULT_HEADROOM;
  const usable = input.usableRatio ?? DEFAULT_USABLE;

  const valid =
    Number.isFinite(totalMemBytes) &&
    Number.isFinite(freeMemBytes) &&
    Number.isFinite(modelSizeBytes) &&
    Number.isFinite(headroom) &&
    Number.isFinite(usable) &&
    totalMemBytes > 0 &&
    freeMemBytes >= 0 &&
    modelSizeBytes > 0 &&
    headroom >= 1 &&
    usable > 0 &&
    usable <= 1;

  if (!valid) {
    return {
      ok: false,
      reason: 'invalid-input',
      tier: 'unknown',
      requiredBytes: 0,
      budgetBytes: 0,
      freeMemBytes: 0,
      detail: `输入非法（total=${totalMemBytes} free=${freeMemBytes} model=${modelSizeBytes} headroom=${headroom} usable=${usable}）——要求 total>0、free>=0、model>0、headroom>=1、0<usable<=1`,
    };
  }

  const requiredBytes = Math.ceil(modelSizeBytes * headroom);
  const budgetBytes = Math.floor(totalMemBytes * usable);
  const tier = tierOf(totalMemBytes);

  if (requiredBytes > budgetBytes) {
    return {
      ok: false,
      reason: 'insufficient-memory',
      tier,
      requiredBytes,
      budgetBytes,
      freeMemBytes,
      detail: `拒绝加载：需 ${(requiredBytes / MB).toFixed(0)} MB（模型 ${(modelSizeBytes / MB).toFixed(0)} MB × 余量 ${headroom}），档位 ${tier} 预算 ${(budgetBytes / MB).toFixed(0)} MB（总内存 × ${usable}），缺口 ${((requiredBytes - budgetBytes) / MB).toFixed(0)} MB；当前空闲 ${(freeMemBytes / MB).toFixed(0)} MB（不参与判定）`,
    };
  }

  return {
    ok: true,
    tier,
    requiredBytes,
    budgetBytes,
    freeMemBytes,
    detail: `可加载：需 ${(requiredBytes / MB).toFixed(0)} MB，档位 ${tier} 预算 ${(budgetBytes / MB).toFixed(0)} MB，余 ${((budgetBytes - requiredBytes) / MB).toFixed(0)} MB；当前空闲 ${(freeMemBytes / MB).toFixed(0)} MB（不参与判定）`,
  };
}
