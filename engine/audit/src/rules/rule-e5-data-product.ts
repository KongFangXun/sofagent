// ============================================================
// E5 数据产物审计（扩展层 · 工程规范）· v1.5.7 章一新增
// SMB（中小企业）场景——没有代码仓库，Agent 的交付物是 AI 生成的数据文件
// （CSV / JSON / 报表）。三类判据：
//   ① 数值勾稽（合计/明细一致）：「合计/总计/小计」行 ≠ 明细行数值之和 → FAIL
//   ② 来源可溯（每个数字可回溯源数据）：数据行缺 source/来源 引用 → WARN
//   ③ 口径一致（同名字段同口径）：同名字段的 unit/口径 标注互相冲突 → FAIL
//
// 编号归属（devlog 章一交付 1）：默认规则编号已用到 A24，扩展位 A14-A17/A24/
//   E1/E2/E4 已占用——本规则用扩展位 E5（number = 200 + 5 = 205），归
//   extendedRules（opt-in 扩展规则集），不占默认位。
//
// evidenceMode: git-diff（纯 diff 判定，不依赖日志、不读 cwd/fs/git）
// ============================================================

import { isDiffFileHeader } from '@sofagent/core';
import type { AuditContext, RuleScan, RuleStatus } from './types';

/** 数据产物类文件扩展名（判定面只对这些文件生效——普通源码不进判定） */
const DATA_PRODUCT_EXTENSIONS: string[] = ['.csv', '.json', '.tsv', '.jsonl'];

/** 数值勾稽容差——浮点求和舍入误差容忍（比例） */
const RECONCILE_TOLERANCE = 0.005;

/**
 * 取文件扩展名（小写，含点；无扩展名返回空串）
 * 与 rule-a24 的 extOf 同款实现（本文件不 import A24——叶子模块不横向依赖）
 */
function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** 是否数据产物类文件 */
function isDataProductFile(path: string): boolean {
  return DATA_PRODUCT_EXTENSIONS.includes(extOf(path));
}

/**
 * 从一行文本提取 `key: value` / `"key": value` / `key=value` 的数值。
 * 值须为纯数字（含小数/负号/千分位逗号）——字符串值（如 "Q3"）不进勾稽面。
 * @returns 键 → 数值（同行同名键取后值——CSV 语义同列名）
 */
function extractNumericFields(line: string): Map<string, number> {
  const out = new Map<string, number>();
  // JSON 形态："key": 123  /  転置形态 key: 123 / key=123
  const re = /"?([\w\u4e00-\u9fff-]+)"?\s*[:=]\s*(-?\d[\d,]*\.?\d*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const key = m[1]!;
    const rawNum = m[2]!.replace(/,/g, '');
    const num = Number(rawNum);
    if (Number.isFinite(num)) out.set(key, num);
  }
  return out;
}

/**
 * CSV/TSV 形态提取（v1.5.7 章一）：文件内首个非空、非数值行视为表头（列名表），
 * 后续行按列位映射——`列名 → 该行此列的数值`（非数值单元格不进勾稽面）。
 * 表头识别纪律：表头行的单元格须**全为非纯数字**（含数字的表头如 "2024Q3" 合法，
 * 纯数字单元格如 "100" 说明它是数据行不是表头——按数据行跳过列映射）。
 * @returns 行数组：每行 = 列名 → 数值（无数值的行不出现在结果里）；
 *          空数组 = 无带表头的数据行（首行即表头、或全为表头前的行）
 */
function extractCsvRows(lines: string[]): Array<Map<string, number>> {
  const rows: Array<Map<string, number>> = [];
  let header: string[] | null = null;
  for (const line of lines) {
    const cells = line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (header === null) {
      // 候选表头：非空 + 全部单元格都不是纯数字
      const isHeader =
        cells.length > 1 &&
        cells.every((c) => c !== '' && !/^-?\d[\d,]*\.?\d*$/.test(c));
      if (isHeader) header = cells;
      continue; // 表头前的行（或不像表头的行）不参与
    }
    const row = new Map<string, number>();
    cells.forEach((cell, i) => {
      const key = header![i];
      if (!key) return;
      if (/^-?\d[\d,]*\.?\d*$/.test(cell)) {
        const num = Number(cell.replace(/,/g, ''));
        if (Number.isFinite(num)) row.set(key, num);
      }
    });
    if (row.size > 0) rows.push(row);
  }
  return rows;
}

/**
 * 裸形态提取（v1.5.7 章一）：行内 `label,value` 逗号二元组——首 cell 为标签、
 * 纯数值 cell 归入该标签的键桶（`amount,100` → amount=100；`north,100,x` 同理）。
 * 无表头 CSV（extractCsvRows 未识别出表头）与稀疏 kv 混合行共用本提取器。
 * @returns 标签 → 数值（同标签多值取后值——与 kv 形态同口径）
 */
function extractBarePairs(line: string): Map<string, number> {
  const out = new Map<string, number>();
  const cells = line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
  if (cells.length < 2) return out;
  const label = cells[0]!;
  if (label === '') return out;
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i]!;
    if (/^-?\d[\d,]*\.?\d*$/.test(cell)) {
      const num = Number(cell.replace(/,/g, ''));
      if (Number.isFinite(num)) out.set(label, num);
    }
  }
  return out;
}

/** 数值 cell 形态（纯数字串，供行内「任一 cell 命中合计词」判定复用） */
const NUMERIC_CELL_RE = /^-?\d[\d,]*\.?\d*$/;

/** 拆分 CSV/TSV 行为 cells（去首尾空白与包裹引号——与 extractCsvRows 同口径） */
function splitCells(line: string): string[] {
  return line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
}

/**
 * CSV 表头探测（与 extractCsvRows 同判据）：文件内首个「非空且全非纯数字」行 = 表头。
 * @returns 表头 cells；未识别（无这样的行）→ null（调用方退裸形态）
 */
function csvHeaderOf(lines: string[]): string[] | null {
  for (const line of lines) {
    const cells = splitCells(line);
    if (cells.length > 1 && cells.every((c) => c !== '' && !NUMERIC_CELL_RE.test(c))) {
      return cells;
    }
  }
  return null;
}

/** 合计行的键名模式（命中即视为「合计」声明，参与勾稽比对） */
const TOTAL_KEY_RE = /^(合计|总计|小计|总额|total|subtotal|sum)$/i;

/** 来源引用模式——数据行携带 source/来源/来源文件 引用即视为可溯源
 * （键名可带引号：JSON 形态 `"source": "x"` 的闭引号在分隔符前，须显式放过） */
const SOURCE_REF_RE = /(source|来源|src|origin)"?\s*[:=]/i;

/**
 * 口径标注提取——`<字段>.unit: xxx` / `<字段>_unit: xxx` / `unit(<字段>): xxx`
 * 键名可带引号（`"amount.unit": "CNY"`）——unit/括号后的闭引号在分隔符前，须显式放过。
 */
const UNIT_RE = /"?([\w\u4e00-\u9fff-]+)"?\s*[._]\s*unit"?\s*[:=]\s*"?([^\s,",}]+)"?|unit\s*\(\s*"?([\w\u4e00-\u9fff-]+)"?\s*\)\s*"?\s*[:=]\s*"?([^\s,",}]+)/gi;

/**
 * 规则判定本体（v1.4.8 条目 7 形态）：只产出 status/details——
 * 前置块（name/number/evidenceMode/ruleClass）由 assembleCheck 从注册表 meta 装配。
 *
 * 形态路由（三形态统一判定面，v1.5.7 章一）：
 *   · kv 形态（.json/.jsonl 及一切含 `key: value` 的行）——extractNumericFields
 *   · CSV/TSV 带表头（.csv/.tsv）——extractCsvRows：列名 = 键，首个「非空且全非
 *     纯数字」行 = 表头；表头未识别（首行即唯一数据形态）→ 退裸形态
 *   · 裸形态（无表头 CSV）——extractBarePairs：`label,value` 逗号二元组，
 *     首 cell 为标签、纯数值 cell 入该标签键桶（无键名的合计声明也走这里）
 *
 * 判定序（三类判据按「先硬后软」执行，最严者胜）：
 *   ① 勾稽：合计行（任一标签/键/cell 命中 TOTAL_KEY_RE）的声明值 ≠ 明细和
 *      （超容差 max(|sum|*0.5%, 0.01)）→ FAIL。比对序：先「同键明细桶」，
 *      该键无明细桶时比「全部明细数值总和」（裸形态合计无键名，恒走总和比对）。
 *      无任何明细 → 跳过不判（证据不足纪律）。
 *   ② 溯源：携带数值的明细行若无任何 source/来源 引用 → WARN（AI 编造数字的信号），
 *      三形态统一；合计行本身是衍生行，不做溯源判。
 *   ③ 口径：同一字段在不同行的 unit 标注不一致 → FAIL（同名不同义）。
 *      —— 判据③不依赖口径表声明：diff 内自相矛盾即可判（硬证据在 diff 里）。
 */
export function scanE5(ctx: AuditContext): RuleScan {
  const { diffFiles } = ctx;
  const details: string[] = [];
  let worst: RuleStatus = 'PASS';

  for (const file of diffFiles) {
    if (!isDataProductFile(file.path)) continue;

    /** 明细行累计：键 → { sum, count }（新增行 only）；另记全部明细数值总和（无键桶回退用） */
    const detailSums = new Map<string, { sum: number; count: number }>();
    let allDetailSum = 0;
    let allDetailCount = 0;
    /** 合计行声明：键 → 声明值（可能多条——任一不匹配即 FAIL）；无键合计 → 「*」桶 */
    const totalClaims = new Map<string, number[]>();
    /** 携带数值但无来源引用的明细行（溯源判据） */
    const unTracedRows: number[] = [];
    /** 字段 → unit 标注集合（口径判据；归一值 → 原值组——判重归一、举证原值） */
    const unitDecls = new Map<string, Map<string, string[]>>();

    const addedLines = file.lines.filter(
      (l) => l.startsWith('+') && !isDiffFileHeader(l),
    );
    const contents = addedLines.map((l) => l.substring(1));
    const ext = extOf(file.path);

    // ── 形态路由：CSV/TSV 先探测表头（列位映射基础）；.json/.jsonl 恒走 kv（不施加 CSV 表头逻辑）──
    const isCsvLike = ext === '.csv' || ext === '.tsv';
    const csvHeader = isCsvLike ? csvHeaderOf(contents) : null;

    /** 全部数值明细总和（勾稽回退比对面） */
    const accumulateDetail = (key: string, value: number) => {
      const acc = detailSums.get(key) ?? { sum: 0, count: 0 };
      acc.sum += value;
      acc.count += 1;
      detailSums.set(key, acc);
      allDetailSum += value;
      allDetailCount += 1;
    };

    /** 勾稽比对：同键桶优先，无桶回退全量和；无任何明细 → 跳过（证据不足纪律） */
    const reconcile = (key: string | null, claimed: number) => {
      const bucket = key !== null ? detailSums.get(key) : undefined;
      const sum = bucket ? bucket.sum : allDetailSum;
      const count = bucket ? bucket.count : allDetailCount;
      if (count === 0) return; // 无明细可比 → 不硬判
      const tolerance = Math.max(Math.abs(sum) * RECONCILE_TOLERANCE, 0.01);
      if (Math.abs(claimed - sum) > tolerance) {
        worst = 'FAIL';
        const keyLabel = key ?? '全部明细';
        details.push(
          `${file.path}: 数值勾稽不一致——键「${keyLabel}」合计声明 ${claimed} ≠ 明细之和 ${sum}（${count} 行明细）`,
        );
      }
    };

    // ── 判据③（口径）：unit 标注独立预扫（不依赖数值提取——与形态路由无关） ──
    for (const content of contents) {
      UNIT_RE.lastIndex = 0;
      let um: RegExpExecArray | null;
      while ((um = UNIT_RE.exec(content)) !== null) {
        const field = (um[1] ?? um[3])!;
        const unit = (um[2] ?? um[4])!;
        if (!field || !unit) continue;
        const byNorm = unitDecls.get(field) ?? new Map<string, string[]>();
        const originals = byNorm.get(unit.toLowerCase()) ?? [];
        originals.push(unit);
        byNorm.set(unit.toLowerCase(), originals);
        unitDecls.set(field, byNorm);
      }
    }

    if (csvHeader) {
      // CSV 带表头路径。合计行判定按「行的任一 cell 命中 TOTAL_KEY_RE」——合计词
      // 常在值位（如 `合计,300` 的「合计」在首列），只看列名（键位）会漏判。
      // 声明键 = 数值 cell 所在列的列名（列名本身是合计词时）；普通列上的数值
      // 属「合计行的衍生值」→ 无键声明（比对走全部明细总和）。
      const headerRowText = csvHeader.join(',');
      const detailLines: string[] = [];
      contents.forEach((content, idx) => {
        if (content === headerRowText) return; // 表头行自身不参与
        const cells = splitCells(content);
        if (cells.every((c) => c === '')) return; // 空行
        const hasNumeric = cells.some((c) => NUMERIC_CELL_RE.test(c));
        if (!hasNumeric) return; // 无数值行不参与

        if (cells.some((c) => TOTAL_KEY_RE.test(c))) {
          // 合计行：行内每个数值 cell 是一条合计声明
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]!;
            if (!NUMERIC_CELL_RE.test(cell)) continue;
            const colName = csvHeader[i];
            const num = Number(cell.replace(/,/g, ''));
            const key =
              colName !== undefined && TOTAL_KEY_RE.test(colName) ? colName : '*';
            const arr = totalClaims.get(key) ?? [];
            arr.push(num);
            totalClaims.set(key, arr);
          }
          return; // 合计行不计入明细、也不做溯源判（衍生行）
        }

        // 明细行：溯源检查在此（保留原始行号），列位映射交给 extractCsvRows
        if (!SOURCE_REF_RE.test(content)) unTracedRows.push(idx + 1);
        detailLines.push(content);
      });
      // 表头 + 明细行喂给 extractCsvRows（列位映射的唯一实现，不在分支里重写）
      for (const row of extractCsvRows([headerRowText, ...detailLines])) {
        for (const [k, v] of row) accumulateDetail(k, v);
      }
    } else {
      // kv / 裸形态路径：逐行提取（kv 优先——同行两种形态并存时 kv 键名更精确）
      contents.forEach((content, idx) => {
        // ── 数值提取（判据①②共用）：kv 优先，无 kv 命中且为 CSV 系文件时走裸形态 ──
        const nums = extractNumericFields(content);
        if (nums.size === 0 && isCsvLike) {
          const bare = extractBarePairs(content);
          if (bare.size === 0) return; // 无数值行不参与三类判据
          // 裸形态：行内 `label,value` 二元组，首 cell 为标签
          const isTotalRow =
            TOTAL_KEY_RE.test([...bare.keys()][0]!) ||
            splitCells(content).some((c) => TOTAL_KEY_RE.test(c));
          if (isTotalRow) {
            // 裸形态合计：标签即键（`total,500` → 键 total）；合计词在标签位
            // 之外的 cell（如 `汇总,total,999`）→ 无键声明
            const label = [...bare.keys()][0]!;
            const key = TOTAL_KEY_RE.test(label) ? label : '*';
            const arr = totalClaims.get(key) ?? [];
            arr.push(bare.get(label)!);
            totalClaims.set(key, arr);
            return; // 合计行不计入明细、也不做溯源判
          }
          for (const [k, v] of bare) accumulateDetail(k, v);
          if (!SOURCE_REF_RE.test(content)) unTracedRows.push(idx + 1);
          return;
        }
        if (nums.size === 0) return; // 无数值行不参与三类判据

        // kv 形态合计行：任一键命中 TOTAL_KEY_RE
        const totalKeys = [...nums.keys()].filter((k) => TOTAL_KEY_RE.test(k));
        if (totalKeys.length > 0) {
          for (const k of totalKeys) {
            const arr = totalClaims.get(k) ?? [];
            arr.push(nums.get(k)!);
            totalClaims.set(k, arr);
          }
          return; // 合计行不计入明细、也不做溯源判
        }

        // 明细行：累计勾稽 + 溯源检查
        for (const [k, v] of nums) accumulateDetail(k, v);
        if (!SOURCE_REF_RE.test(content)) {
          unTracedRows.push(idx + 1);
        }
      });
    }

    // ── 判据① 裁决：合计声明 vs 明细和（同键桶优先，无桶回退全量和）──
    for (const [key, claims] of totalClaims) {
      for (const claimed of claims) {
        reconcile(key === '*' ? null : key, claimed);
      }
    }

    // ── 判据② 裁决：来源可溯 ──
    if (unTracedRows.length > 0) {
      if (worst === 'PASS') worst = 'WARN';
      details.push(
        `${file.path}: ${unTracedRows.length} 行数据缺来源引用（source/来源）——AI 生成数据须逐行可回溯源数据，` +
          `疑点行号（新增行序）: ${unTracedRows.slice(0, 5).join(', ')}${unTracedRows.length > 5 ? '…' : ''}`,
      );
    }

    // ── 判据③ 裁决：口径一致（判重按归一值，举证保留原值） ──
    for (const [field, byNorm] of unitDecls) {
      if (byNorm.size > 1) {
        worst = 'FAIL';
        const allOriginals = [...byNorm.values()].flat();
        details.push(
          `${file.path}: 口径冲突——字段「${field}」存在多个 unit 标注: ${allOriginals.join(' / ')}（同名字段须同口径）`,
        );
      }
    }
  }

  if (details.length === 0) {
    return { status: 'PASS', details: [] };
  }
  return { status: worst, details };
}
