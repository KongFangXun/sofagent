// ============================================================
// benchmark/benchmark-designer.ts · 题库设计（v1.3.5 交付 9）
// ============================================================
//
// Benchmark 评测体系（PenguinHarness 方法论借鉴）：
//   statement / rubric 物理分离——statement 公开给被测 Agent，
//   rubric 私有（评分标准 + Gold 答案），被测 Agent 无法访问。
//
// 本文件职责：
//   - createBenchmark / addCase：题库设计（statement + rubric 分离）
//   - calibrateCase：Pilot 校准——初稿跑一轮 → 看 Agent 怎么解题 →
//     调难度 → 记录校准日志
//   - freezeBenchmark：校准满意后冻结 revision（冻结后 revision 递增）
//   - writeBenchmarkLayout / readBenchmarkLayout：文件布局
//     data/<project>/benchmarks/<benchmark_id>/
//       benchmark_config.toml + CASE-<nnn>-<name>/{statement,rubric}/README.md
//
// toml 解析用简单手写解析器（零新依赖——只覆盖本模块用到的键）。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Benchmark Case（statement 公开 / rubric 私有物理分离） */
export interface BenchmarkCase {
  /** Case ID（CASE-<nnn>-<name>） */
  id: string;
  /** Case 名称 */
  name: string;
  /** 公开给被测 Agent 的任务描述 */
  statement: string;
  /** 私有评分标准 + Gold 答案（绝不暴露给被测 Agent） */
  rubric: string;
  /** Gold 分值（校准参考；0..100） */
  goldScore?: number;
}

/** Pilot 校准记录 */
export interface CalibrationRecord {
  /** 校准的 Case ID */
  caseId: string;
  /** 校准后难度评级（easy / medium / hard） */
  difficulty: 'easy' | 'medium' | 'hard';
  /** 校准说明（观察到 Agent 怎么解题） */
  note: string;
  /** 校准时间（ISO 8601） */
  ts: string;
}

/** Benchmark 定义 */
export interface BenchmarkDefinition {
  /** Benchmark ID（目录名） */
  id: string;
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 每 Case 评测轮数（默认 1） */
  runs: number;
  /** revision——Freeze 后递增（version_changed 检测用） */
  revision: number;
  /** 是否已冻结（冻结后不得再改题） */
  frozen: boolean;
  /** Cases 列表 */
  cases: BenchmarkCase[];
  /** Pilot 校准记录 */
  calibrations: CalibrationRecord[];
}

/** createBenchmark 入参 */
export interface CreateBenchmarkOptions {
  /** 标题 */
  title: string;
  /** 描述 */
  description: string;
  /** 每 Case 评测轮数（默认 1） */
  runs?: number;
}

/** 难度评级 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * 创建 Benchmark 定义（初始 revision=1，未冻结）。
 *
 * @param id Benchmark ID（目录名，须为 [a-zA-Z0-9-_]）
 * @param options 标题/描述/轮数
 */
export function createBenchmark(id: string, options: CreateBenchmarkOptions): BenchmarkDefinition {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Benchmark ID 不合法：${id}（仅允许字母数字-_）`);
  }
  return {
    id,
    title: options.title,
    description: options.description,
    runs: options.runs ?? 1,
    revision: 1,
    frozen: false,
    cases: [],
    calibrations: [],
  };
}

/**
 * 添加一个 Case（statement 公开 / rubric 私有物理分离）。
 * 冻结后禁止改题（throw）。
 *
 * @param def Benchmark 定义
 * @param input Case 输入（name/statement/rubric/goldScore）
 * @returns 生成的 Case（id = CASE-<nnn>-<name>）
 */
export function addCase(
  def: BenchmarkDefinition,
  input: { name: string; statement: string; rubric: string; goldScore?: number },
): BenchmarkCase {
  if (def.frozen) {
    throw new Error(`Benchmark "${def.id}" 已冻结（revision=${def.revision}）——不得再改题`);
  }
  const seq = def.cases.length + 1;
  const id = `CASE-${String(seq).padStart(3, '0')}-${input.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const caseDef: BenchmarkCase = {
    id,
    name: input.name,
    statement: input.statement,
    rubric: input.rubric,
    ...(input.goldScore !== undefined ? { goldScore: input.goldScore } : {}),
  };
  def.cases.push(caseDef);
  return caseDef;
}

/**
 * Pilot 校准——初稿跑一轮 → 看 Agent 怎么解题 → 调难度 → 记录。
 * 冻结后禁止校准（throw）。
 *
 * @param def Benchmark 定义
 * @param caseId Case ID
 * @param difficulty 校准后难度
 * @param note 校准说明
 * @returns 校准记录
 */
export function calibrateCase(
  def: BenchmarkDefinition,
  caseId: string,
  difficulty: Difficulty,
  note: string,
): CalibrationRecord {
  if (def.frozen) {
    throw new Error(`Benchmark "${def.id}" 已冻结——不得再校准`);
  }
  const exists = def.cases.some((c) => c.id === caseId);
  if (!exists) {
    throw new Error(`Case "${caseId}" 不存在于 Benchmark "${def.id}"`);
  }
  const record: CalibrationRecord = {
    caseId,
    difficulty,
    note,
    ts: new Date().toISOString(),
  };
  def.calibrations.push(record);
  return record;
}

/**
 * Freeze——校准满意后冻结 revision（revision +1，frozen=true）。
 *
 * @param def Benchmark 定义
 * @returns 冻结后的 revision
 */
export function freezeBenchmark(def: BenchmarkDefinition): number {
  if (def.cases.length === 0) {
    throw new Error(`Benchmark "${def.id}" 无 Case——不能冻结空题库`);
  }
  def.frozen = true;
  def.revision += 1;
  return def.revision;
}

// ============================================================
// 文件布局（data/<project>/benchmarks/<benchmark_id>/）
// ============================================================

/** 默认 benchmarks 根目录：{dataDir}/benchmarks */
export function benchmarksRoot(dataDir: string): string {
  return join(dataDir, 'benchmarks');
}

/**
 * 落盘 Benchmark 文件布局：
 *   <root>/<id>/benchmark_config.toml
 *   <root>/<id>/CASE-<nnn>-<name>/statement/README.md（公开）
 *   <root>/<id>/CASE-<nnn>-<name>/rubric/README.md（私有）
 *
 * @param def Benchmark 定义
 * @param root benchmarks 根目录（如 {dataDir}/benchmarks）
 * @returns 落盘的文件路径列表
 */
export function writeBenchmarkLayout(def: BenchmarkDefinition, root: string): string[] {
  const written: string[] = [];
  const dir = join(root, def.id);
  mkdirSync(dir, { recursive: true });

  // benchmark_config.toml
  const configPath = join(dir, 'benchmark_config.toml');
  writeFileSync(configPath, serializeBenchmarkConfig(def), 'utf-8');
  written.push(configPath);

  // CASE 目录（statement 公开 / rubric 私有物理分离）
  for (const c of def.cases) {
    const statementPath = join(dir, c.id, 'statement', 'README.md');
    mkdirSync(join(dir, c.id, 'statement'), { recursive: true });
    writeFileSync(statementPath, c.statement, 'utf-8');
    written.push(statementPath);

    const rubricPath = join(dir, c.id, 'rubric', 'README.md');
    mkdirSync(join(dir, c.id, 'rubric'), { recursive: true });
    writeFileSync(rubricPath, c.rubric, 'utf-8');
    written.push(rubricPath);
  }
  return written;
}

/**
 * 从布局读回 Benchmark 定义（benchmark_config.toml + CASE 目录）。
 *
 * @param root benchmarks 根目录
 * @param id Benchmark ID
 * @returns BenchmarkDefinition；不存在返回 null
 */
export function readBenchmarkLayout(root: string, id: string): BenchmarkDefinition | null {
  const configPath = join(root, id, 'benchmark_config.toml');
  if (!existsSync(configPath)) return null;
  const parsed = parseBenchmarkConfig(readFileSync(configPath, 'utf-8'));
  const def: BenchmarkDefinition = {
    id: parsed.id,
    title: parsed.title,
    description: parsed.description,
    runs: parsed.runs,
    revision: parsed.revision,
    frozen: parsed.frozen,
    cases: [],
    calibrations: [],
  };
  for (const c of parsed.cases) {
    const statementPath = join(root, id, c.statement_file);
    const rubricPath = join(root, id, c.rubric_file);
    def.cases.push({
      id: c.id,
      name: c.name,
      statement: existsSync(statementPath) ? readFileSync(statementPath, 'utf-8') : '',
      rubric: existsSync(rubricPath) ? readFileSync(rubricPath, 'utf-8') : '',
      ...(c.gold_score !== undefined ? { goldScore: c.gold_score } : {}),
    });
  }
  return def;
}

// ============================================================
// 手写 toml 解析/序列化（零新依赖——覆盖本模块用到的键）
// ============================================================

/** 序列化 benchmark_config.toml */
export function serializeBenchmarkConfig(def: BenchmarkDefinition): string {
  const lines: string[] = [
    `id = "${def.id}"`,
    `title = "${escapeToml(def.title)}"`,
    `description = "${escapeToml(def.description)}"`,
    `runs = ${def.runs}`,
    `revision = ${def.revision}`,
    `frozen = ${def.frozen}`,
    '',
  ];
  for (const c of def.cases) {
    lines.push('[[case]]');
    lines.push(`id = "${c.id}"`);
    lines.push(`name = "${escapeToml(c.name)}"`);
    lines.push(`statement_file = "${c.id}/statement/README.md"`);
    lines.push(`rubric_file = "${c.id}/rubric/README.md"`);
    if (c.goldScore !== undefined) {
      lines.push(`gold_score = ${c.goldScore}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** toml 字符串转义（引号 + 反斜杠） */
function escapeToml(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 解析结果 */
export interface ParsedBenchmarkConfig {
  id: string;
  title: string;
  description: string;
  runs: number;
  revision: number;
  frozen: boolean;
  cases: Array<{
    id: string;
    name: string;
    statement_file: string;
    rubric_file: string;
    gold_score?: number;
  }>;
}

/**
 * 解析 benchmark_config.toml（手写解析器——扁平键 + [[case]] 表数组）。
 *
 * @param text toml 文本
 * @returns ParsedBenchmarkConfig
 */
export function parseBenchmarkConfig(text: string): ParsedBenchmarkConfig {
  const config: ParsedBenchmarkConfig = {
    id: '',
    title: '',
    description: '',
    runs: 1,
    revision: 1,
    frozen: false,
    cases: [],
  };

  let currentCase: ParsedBenchmarkConfig['cases'][number] | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line === '[[case]]') {
      currentCase = {
        id: '',
        name: '',
        statement_file: '',
        rubric_file: '',
      };
      config.cases.push(currentCase);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (currentCase) {
      switch (key) {
        case 'id': currentCase.id = unquote(value); break;
        case 'name': currentCase.name = unquote(value); break;
        case 'statement_file': currentCase.statement_file = unquote(value); break;
        case 'rubric_file': currentCase.rubric_file = unquote(value); break;
        case 'gold_score': currentCase.gold_score = Number(value); break;
      }
      continue;
    }

    switch (key) {
      case 'id': config.id = unquote(value); break;
      case 'title': config.title = unquote(value); break;
      case 'description': config.description = unquote(value); break;
      case 'runs': config.runs = Number(value); break;
      case 'revision': config.revision = Number(value); break;
      case 'frozen': config.frozen = value === 'true'; break;
    }
  }
  return config;
}

/** 去掉字符串首尾引号 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}
