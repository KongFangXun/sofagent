// quantify-core.ts · 量化四字段计算器（GUIDE §4.3）
// ============================================================
// v1.5.0 第 7 批（训练模块拆包）· 从 train/train-report.ts 原样搬出。
//
// 搬出理由：该计算器是 **FDE 侧 ROI 公式**（消费方为 fde-quantify /
// fde-workbench），与训练模块无任何逻辑耦合——它此前被放在 train/ 下，
// 导致 fde/fde-quantify.ts 反向 import train/train-report，构成
// train ⇄ fde 依赖环，是拆包（train → 独立包 @sofagent/train）的硬阻塞。
//
// 搬出后依赖方向单向：
//   train/train-report.ts ──import──▶ fde/quantify-core.ts
//   fde/fde-quantify.ts   ──import──▶ fde/quantify-core.ts
//   fde/quantify-core.ts  ──零 @sofagent 依赖（纯函数 + 类型）
//
// 根 barrel 兼容：index.ts 的 computeQuantification /
// QuantificationMetrics / QuantifyInput 三个 /* @public */ 导出改指
// 本文件——**符号集不变（非破坏）**，仓外 adopter 的
// `orch.computeQuantification(...)` 调用照常可用。
//
// 可测试性：纯函数（输入全注入），单测零 IO。
// ============================================================

/** 量化四字段（年节省 = 岗位真实市场年薪 × AI 接管工时占比） */
export interface QuantificationMetrics {
  /** 当前成本（人工程伴年成本口径——人读金额 + 数值双形态） */
  currentCost: { value: number; unit: string; display: string };
  /** AI 后成本（AI 方案年运行成本） */
  aiCost: { value: number; unit: string; display: string };
  /** 年节省（currentCost − aiCost；或按 GUIDE 公式独立填报） */
  annualSaving: { value: number; unit: string; display: string };
  /** 回本周期（投入 ÷ 年节省——月/年） */
  paybackPeriod: { value: number; unit: string; display: string };
}

/** 量化计算入参（岗位口径——GUIDE §4.3 公式） */
export interface QuantifyInput {
  /** 岗位真实市场年薪（元/年——追问真实数，不用平均工资拍脑袋） */
  annualSalary: number;
  /** AI 接管工时占比（0..1——如每天 2.7h/8h ≈ 0.3375） */
  takeoverRatio: number;
  /** AI 方案年运行成本（元/年——算力+订阅+运维） */
  aiAnnualCost: number;
  /** 一次性投入（元——训练成本/实施费；缺省 0 → 回本周期按无一次性投入计） */
  oneTimeInvestment?: number;
}

/**
 * 量化四字段计算器（GUIDE §4.3）：
 *   年节省 = 岗位真实市场年薪 × AI 接管工时占比
 *   回本周期 = 一次性投入 ÷ 年节省（年节省 ≤ 0 → 不适用）
 */
export function computeQuantification(input: QuantifyInput): QuantificationMetrics {
  const saving = input.annualSalary * input.takeoverRatio;
  const invest = input.oneTimeInvestment ?? 0;
  const paybackYears = saving > 0 ? invest / saving : Number.POSITIVE_INFINITY;
  const fmt = (n: number): string => {
    if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万元`;
    return `${n.toFixed(0)} 元`;
  };
  return {
    currentCost: { value: input.annualSalary, unit: '元/年', display: fmt(input.annualSalary) },
    aiCost: { value: input.aiAnnualCost, unit: '元/年', display: fmt(input.aiAnnualCost) },
    annualSaving: { value: saving, unit: '元/年', display: fmt(saving) },
    paybackPeriod: {
      value: Number.isFinite(paybackYears) ? paybackYears : -1,
      unit: '年',
      display: Number.isFinite(paybackYears)
        ? paybackYears >= 1
          ? `${paybackYears.toFixed(1)} 年`
          : `${(paybackYears * 12).toFixed(0)} 个月`
        : '不适用（年节省 ≤ 0）',
    },
  };
}
