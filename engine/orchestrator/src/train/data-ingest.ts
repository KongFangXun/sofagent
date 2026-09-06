// data-ingest.ts · v1.4.5 章一 · 企业数据 → 训练集管道（异构接入 → 统一中间格式）
//
// 定位：训练引擎的数据入口——「有数据没能力」的企业客户手里是异构数据
// （电芯充放电曲线 CSV / 产线校准参数 Excel / 工艺配方 JSON / 运行日志文本），
// 本文件把它们全部归一到统一中间格式 IngestRecord，供 dataset-builder 构建
// 训练集（instruction / DPO / RL）。
//
// 支持格式：
//   - CSV  ：RFC 4180 手写解析器（引号转义 / CRLF / 嵌入逗号——零依赖）
//   - Excel（.xlsx）：手写 ZIP 读取器（EOCD → 中央目录 → 本地头）+ zlib
//     inflateRaw 解压 + 最小 XML 单元格解析（sharedStrings / inlineStr /
//     数值 / 布尔）。零新依赖——对齐 benchmark-designer 手写 toml 解析器先例。
//   - JSON：对象数组 → 记录数组（嵌套对象 JSON.stringify 保留）
//   - 文本：逐行 → 单字段记录（field 名可配，缺省 'text'）
//
// 列映射 + 类型推断 + 空值处理：
//   - 类型推断（CSV/文本单元格）：空串与空值标记 → null；数字形态 → number；
//     true/false → boolean；其余 → string
//   - 空值标记集合可配（缺省 ''/'NA'/'N/A'/'null'/'NULL'/'None'/'-'）
//
// 复用来源：
//   - 管道产物结构与 train-audit.computeDataSourceHash 的输入口径对齐
//     （dataset-builder 产出的训练集文件即数据源指纹的计算对象）
//   - 目录规范沿用 train-job 的 data/train/<enterpriseId>/ 分区纪律

import { readFileSync } from 'fs';
import { extname } from 'path';
import { inflateRawSync } from 'node:zlib';

// ══════════════════════════════════════
// 中间格式（统一数据模型）
// ══════════════════════════════════════

/** 单元格推断类型（CSV/文本/DB/API 通用） */
export type CellValue = string | number | boolean | null;

/** 中间格式单行记录（所有数据源的归一形态） */
export interface IngestRecord {
  /** 行标识（<source>#<行号>，从 1 计） */
  id: string;
  /** 来源描述（文件路径 / DB 表 / API URL——溯源与审计用） */
  source: string;
  /** 列名 → 单元格值（null = 空值） */
  fields: Record<string, CellValue>;
}

/** 接入选项（空值标记 + 文本字段名） */
export interface IngestOptions {
  /** 空值标记集合（这些字符串值归一为 null；缺省见 DEFAULT_EMPTY_MARKERS） */
  emptyMarkers?: string[];
  /** 纯文本接入的单字段名（缺省 'text'） */
  textFieldName?: string;
  /** Excel 工作表序号（1 基，缺省第 1 张） */
  sheetIndex?: number;
}

/** 缺省空值标记（企业数据常见占位形态） */
export const DEFAULT_EMPTY_MARKERS: readonly string[] = [
  '',
  'NA',
  'N/A',
  'null',
  'NULL',
  'None',
  '-',
];

/** 接入结果（记录 + 跳过行说明——质量闸门前的人类可读摘要） */
export interface IngestResult {
  records: IngestRecord[];
  /** 数据行数（不含表头） */
  rowCount: number;
  /** 跳过的完全空行数 */
  skippedEmptyRows: number;
  /** 检测到的列名（表头；文本接入为单字段名） */
  columns: string[];
}

// ══════════════════════════════════════
// 类型推断 + 空值处理（纯函数）
// ══════════════════════════════════════

/**
 * 单元格类型推断：空值标记 → null；整数/小数/科学计数 → number；
 * true/false（大小写不敏感）→ boolean；其余原样 string。
 */
export function inferCellType(raw: string, emptyMarkers: readonly string[] = DEFAULT_EMPTY_MARKERS): CellValue {
  const trimmed = raw.trim();
  if (emptyMarkers.includes(trimmed)) return null;
  if (/^[+-]?\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(n) ? n : trimmed;
  }
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    const f = Number.parseFloat(trimmed);
    return Number.isFinite(f) ? f : trimmed;
  }
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;
  return raw;
}

/** 任意值归一为 CellValue（JSON/DB/API 通用：嵌套对象 → JSON 字符串） */
export function normalizeValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return Number(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ══════════════════════════════════════
// CSV 解析（RFC 4180 手写——零依赖）
// ══════════════════════════════════════

/**
 * 解析 CSV 文本为二维字符串矩阵（RFC 4180：双引号包裹、引号转义 ""、
 * 嵌入逗号/换行、CRLF 兼容）。状态机逐字符扫描——不依赖正则回溯。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i <= len) {
    const ch = i < len ? text[i] : '\n';
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // CRLF：\r 后跟 \n 合并为一个换行
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      // 文本尾部的空行不产出空记录
      if (row.length > 1 || (row[0] ?? '') !== '') rows.push(row);
      row = [];
      i += 1;
      if (i >= len) break;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // 末行无换行符收尾
  if (row.length > 0 && (row.length > 1 || (row[0] ?? '') !== '')) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * CSV 文本 → 中间格式记录（首行为表头；类型推断 + 空值归一）。
 */
export function ingestCsv(text: string, source: string, options: IngestOptions = {}): IngestResult {
  const markers = options.emptyMarkers ?? DEFAULT_EMPTY_MARKERS;
  const matrix = parseCsv(text);
  if (matrix.length === 0) {
    return { records: [], rowCount: 0, skippedEmptyRows: 0, columns: [] };
  }
  const header = (matrix[0] ?? []).map((h, idx) => (h.trim() !== '' ? h.trim() : `col_${idx}`));
  const records: IngestRecord[] = [];
  let skipped = 0;
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const fields: Record<string, CellValue> = {};
    let allEmpty = true;
    for (let c = 0; c < header.length; c++) {
      const key = header[c] ?? `col_${c}`;
      const typed = inferCellType(row[c] ?? '', markers);
      fields[key] = typed;
      if (typed !== null) allEmpty = false;
    }
    if (allEmpty) {
      skipped += 1;
      continue;
    }
    records.push({ id: `${source}#${r}`, source, fields });
  }
  return { records, rowCount: records.length, skippedEmptyRows: skipped, columns: header };
}

// ══════════════════════════════════════
// Excel（.xlsx）解析——手写 ZIP 读取器 + 最小 XML 单元格解析
// ══════════════════════════════════════

/** ZIP 中央目录条目（内部解析结构） */
interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

/** EOCD 签名 / 中央目录签名 / 本地文件头签名（小端） */
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CDIR_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;

/**
 * 最小 ZIP 读取器：EOCD 定位 → 中央目录遍历 → 本地头偏移 → 解压。
 * 支持 method 0（stored）与 8（deflate，zlib.inflateRawSync）。
 * 局限（注释声明）：不支持 zip64（xlsx 规模远用不到）与加密条目。
 */
export function unzipEntries(buf: Buffer): Map<string, Buffer> {
  // ── 1. 从尾部找 EOCD（最小 22 字节，签名倒扫——尾部可能有档案注释）──
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 22 - 65_536);
  for (let p = buf.length - 22; p >= scanStart; p--) {
    if (buf.readUInt32LE(p) === ZIP_EOCD_SIG) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('[data-ingest] xlsx 非法：未找到 ZIP EOCD（文件损坏或非 xlsx 格式）');
  }
  const entryCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  // ── 2. 遍历中央目录（尺寸权威——本地头的尺寸可能被 data descriptor 延迟）──
  const entries: ZipEntry[] = [];
  for (let e = 0; e < entryCount; e++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== ZIP_CDIR_SIG) {
      throw new Error(`[data-ingest] xlsx 非法：中央目录第 ${e} 项签名错位`);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, uncompSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  // ── 3. 逐条目读本地头 → 数据区 → 解压 ──
  const out = new Map<string, Buffer>();
  for (const entry of entries) {
    const lo = entry.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== ZIP_LOCAL_SIG) {
      throw new Error(`[data-ingest] xlsx 非法：条目 ${entry.name} 本地头签名错位`);
    }
    const lnameLen = buf.readUInt16LE(lo + 26);
    const lextraLen = buf.readUInt16LE(lo + 28);
    const dataStart = lo + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) {
      out.set(entry.name, Buffer.from(raw));
    } else if (entry.method === 8) {
      const inflated = inflateRawSync(raw);
      out.set(entry.name, entry.uncompSize > 0 ? inflated.subarray(0, entry.uncompSize) : inflated);
    }
    // 目录条目（名字以 / 结尾）无数据区——跳过
  }
  return out;
}

/** XML 实体解码（sharedStrings / 单元格文本） */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 解析 xl/sharedStrings.xml → 字符串数组（富文本 <r><t> 拼接） */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const body = m[1] ?? '';
    let text = '';
    for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
      text += decodeXmlEntities(t[1] ?? '');
    }
    out.push(text);
  }
  return out;
}

/** Excel 列字母 → 0 基列号（A=0 … Z=25, AA=26 …） */
export function excelColumnToIndex(letters: string): number {
  let idx = 0;
  for (const ch of letters.toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

/**
 * 解析 worksheet XML → 二维矩阵（string[][]，按单元格引用对齐；空单元格为 ''）。
 * 覆盖 t="s"（共享串）/ t="inlineStr" / t="str"（公式串）/ t="b"（布尔）/ 数值。
 */
export function parseSheetXml(xml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1] ?? '';
    const cells: string[] = [];
    for (const cm of rowXml.matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const colLetters = cm[1] ?? 'A';
      const attrs = cm[2] ?? '';
      const body = cm[3] ?? '';
      const colIdx = excelColumnToIndex(colLetters);
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const type = typeMatch?.[1] ?? 'n';
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      const v = vMatch?.[1] ?? '';
      let value = '';
      if (type === 's') {
        const idx = Number.parseInt(v, 10);
        value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        const tMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        value = decodeXmlEntities(tMatch?.[1] ?? '');
      } else if (type === 'str' || type === 'e') {
        value = decodeXmlEntities(v);
      } else if (type === 'b') {
        value = v === '1' ? 'true' : 'false';
      } else {
        value = v.trim();
      }
      // 稀疏单元格按列号对齐（前导空位补 ''）
      for (let fill = cells.length; fill < colIdx; fill++) cells[fill] = '';
      cells[colIdx] = value;
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** 解析 xl/workbook.xml 的 rel 映射 + 序号 → sheetN.xml 文件名（缺省 sheet1.xml） */
function resolveSheetTarget(workbookXml: string, relsXml: string, sheetIndex: number): string {
  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => m[0]);
  const target = sheets[sheetIndex - 1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  const idMatch = /r:id="(rId\d+)"/.exec(target);
  const relId = idMatch?.[1];
  if (!relId) return 'xl/worksheets/sheet1.xml';
  for (const rm of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const rel = rm[0] ?? '';
    if (rel.includes(`Id="${relId}"`)) {
      const tm = /Target="([^"]+)"/.exec(rel);
      const t = tm?.[1] ?? '';
      if (t.startsWith('/')) return t.slice(1);
      return `xl/${t.replace(/^\.\//, '')}`;
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

/**
 * Excel（.xlsx）Buffer → 中间格式记录（首行表头；sharedStrings 解引用）。
 */
export function ingestExcel(
  fileBuffer: Buffer,
  source: string,
  options: IngestOptions = {},
): IngestResult {
  const markers = options.emptyMarkers ?? DEFAULT_EMPTY_MARKERS;
  const zip = unzipEntries(fileBuffer);
  const workbook = zip.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = zip.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const sharedXml = zip.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheetName = resolveSheetTarget(workbook, rels, options.sheetIndex ?? 1);
  const sheetXml = zip.get(sheetName)?.toString('utf8');
  if (sheetXml === undefined) {
    throw new Error(`[data-ingest] xlsx 非法：工作表 ${sheetName} 不存在`);
  }
  const matrix = parseSheetXml(sheetXml, sharedStrings);
  if (matrix.length === 0) {
    return { records: [], rowCount: 0, skippedEmptyRows: 0, columns: [] };
  }
  const header = (matrix[0] ?? []).map((h, idx) => (h.trim() !== '' ? h.trim() : `col_${idx}`));
  const records: IngestRecord[] = [];
  let skipped = 0;
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const fields: Record<string, CellValue> = {};
    let allEmpty = true;
    for (let c = 0; c < header.length; c++) {
      const key = header[c] ?? `col_${c}`;
      const typed = inferCellType(row[c] ?? '', markers);
      fields[key] = typed;
      if (typed !== null) allEmpty = false;
    }
    if (allEmpty) {
      skipped += 1;
      continue;
    }
    records.push({ id: `${source}#${r}`, source, fields });
  }
  return { records, rowCount: records.length, skippedEmptyRows: skipped, columns: header };
}

// ══════════════════════════════════════
// JSON / 文本接入
// ══════════════════════════════════════

/**
 * JSON 文本 → 中间格式记录（顶层对象数组；单对象包装为单元素数组；
 * 非对象元素结构化拒绝——训练集需要命名字段）。
 */
export function ingestJson(text: string, source: string, options: IngestOptions = {}): IngestResult {
  const markers = options.emptyMarkers ?? DEFAULT_EMPTY_MARKERS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `[data-ingest] JSON 解析失败（${source}）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const records: IngestRecord[] = [];
  const columns = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(
        `[data-ingest] JSON 第 ${i + 1} 项不是对象（训练集需要命名字段的记录数组）`,
      );
    }
    const fields: Record<string, CellValue> = {};
    let allEmpty = true;
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      let cell = normalizeValue(v);
      if (typeof cell === 'string' && markers.includes(cell.trim())) cell = null;
      fields[k] = cell;
      columns.add(k);
      if (cell !== null) allEmpty = false;
    }
    if (allEmpty) continue;
    records.push({ id: `${source}#${i + 1}`, source, fields });
  }
  return {
    records,
    rowCount: records.length,
    skippedEmptyRows: arr.length - records.length,
    columns: [...columns],
  };
}

/**
 * 纯文本 → 中间格式记录（逐行单字段；空行跳过；不做类型推断——文本即 string）。
 */
export function ingestText(text: string, source: string, options: IngestOptions = {}): IngestResult {
  const fieldName = options.textFieldName ?? 'text';
  const markers = options.emptyMarkers ?? DEFAULT_EMPTY_MARKERS;
  const records: IngestRecord[] = [];
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '' || markers.includes(trimmed)) {
      skipped += 1;
      continue;
    }
    records.push({ id: `${source}#${i + 1}`, source, fields: { [fieldName]: line } });
  }
  return { records, rowCount: records.length, skippedEmptyRows: skipped, columns: [fieldName] };
}

// ══════════════════════════════════════
// 文件接入统一入口（按扩展名路由）
// ══════════════════════════════════════

/**
 * 文件接入统一入口：按扩展名路由到 CSV / Excel / JSON / 文本解析器。
 * 不支持的扩展名结构化拒绝（不猜格式——错误的数据比没有数据更糟）。
 */
export function ingestFile(filePath: string, options: IngestOptions = {}): IngestResult {
  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath); // Buffer（Excel 二进制；其余 utf8 解码）
  switch (ext) {
    case '.csv':
    case '.tsv': {
      const text = content.toString('utf8');
      return ext === '.tsv'
        ? ingestCsv(text.replace(/\t/g, ','), filePath, options)
        : ingestCsv(text, filePath, options);
    }
    case '.xlsx':
      return ingestExcel(content, filePath, options);
    case '.json':
    case '.jsonl': {
      const text = content.toString('utf8');
      if (ext === '.jsonl') {
        // JSON Lines：逐行 JSON 对象 → 数组语义复用 ingestJson
        const items: unknown[] = text
          .split(/\r?\n/)
          .filter((l) => l.trim() !== '')
          .map((l) => {
            try {
              return JSON.parse(l) as unknown;
            } catch (err) {
              throw new Error(
                `[data-ingest] JSONL 第 ${l.slice(0, 32)}… 行解析失败：${err instanceof Error ? err.message : String(err)}`,
              );
            }
          });
        return ingestJson(JSON.stringify(items), filePath, options);
      }
      return ingestJson(text, filePath, options);
    }
    case '.txt':
    case '.md':
    case '.log':
      return ingestText(content.toString('utf8'), filePath, options);
    default:
      throw new Error(
        `[data-ingest] 不支持的数据文件格式：${ext || '(无扩展名)'}（支持 .csv/.tsv/.xlsx/.json/.jsonl/.txt/.md/.log）`,
      );
  }
}
