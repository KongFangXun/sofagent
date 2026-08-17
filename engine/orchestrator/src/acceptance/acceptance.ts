// ============================================================
// acceptance/acceptance.ts · 验收条件定义与执行（v1.3.6 交付⑨）
//
// 收敛鸿沟的直接解——任务创建时附机器可判定的验收条件，修改后
// 跑验收返回结构化结果。四类条件（复用 Benchmark 判定引擎的判定
// 结构：测试通过 / build 成功 / grep 无 X / schema 校验）：
//   - test         测试通过（spawnSync command，默认 npm test）
//   - build        build 成功（spawnSync command，默认 npm run build）
//   - grep-absent  指定 pattern 在指定路径零命中
//   - schema       JSON 文件经 schema 校验（zod 风格轻量校验）
//
// 定位：通用能力（任何宿主可调）。DSH Agent 经 v1.3.5 MCP 互通获得
// 软约束版验收（Agent 主动调用）；v1.4.0 cordis-plugin 升级为硬门禁
// （agent/turn-stopping serial 检查点拦截关轮）。
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { z } from 'zod';

// ============================================================
// Schema（四类机器可判定条件）
// ============================================================

/** 测试通过类条件 */
const TestCriterionSchema = z.object({
  type: z.literal('test'),
  /** 测试命令（缺省 npm test） */
  command: z.string().min(1).optional(),
  /** 说明（人读） */
  description: z.string().optional(),
});

/** build 成功类条件 */
const BuildCriterionSchema = z.object({
  type: z.literal('build'),
  /** build 命令（缺省 npm run build） */
  command: z.string().min(1).optional(),
  description: z.string().optional(),
});

/** grep 无 X 类条件——pattern 在 path 下零命中才通过 */
const GrepAbsentCriterionSchema = z.object({
  type: z.literal('grep-absent'),
  /** 搜索模式（字面量子串匹配——不引入正则依赖，降低误配置风险） */
  pattern: z.string().min(1),
  /** 搜索路径（缺省项目根；文件或目录均可） */
  path: z.string().min(1).optional(),
  description: z.string().optional(),
});

/** schema 校验类条件——目标 JSON 文件必须满足字段约束 */
const SchemaCriterionSchema = z.object({
  type: z.literal('schema'),
  /** 待校验的 JSON 文件路径 */
  file: z.string().min(1),
  /** 必需字段列表（缺任一 → 不通过） */
  requiredFields: z.array(z.string().min(1)).min(1),
  description: z.string().optional(),
});

export const AcceptanceCriterionSchema = z.discriminatedUnion('type', [
  TestCriterionSchema,
  BuildCriterionSchema,
  GrepAbsentCriterionSchema,
  SchemaCriterionSchema,
]);

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

/** 验收定义——任务创建时附的机器可判定验收条件集合 */
const AcceptanceDefinitionSchema = z.object({
  /** 任务标识（同一 taskId 重复 define = 覆盖更新） */
  taskId: z.string().min(1),
  /** 验收条件列表（至少一条——空条件集合无判定意义） */
  criteria: z.array(AcceptanceCriterionSchema).min(1),
  /** 备注（验收意图说明，审计可读） */
  notes: z.string().optional(),
});

export type AcceptanceDefinition = z.infer<typeof AcceptanceDefinitionSchema>;

// ============================================================
// 持久化（data/acceptance/<taskId>.json）
// ============================================================

/** 验收定义存储目录 */
function acceptanceDir(dataDir: string): string {
  return join(dataDir, 'acceptance');
}

/** taskId 安全化（防路径穿越——只保留安全字符） */
function safeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 保存验收定义（原子写——tmp + rename） */
export function saveAcceptanceDefinition(dataDir: string, def: AcceptanceDefinition): string {
  const dir = acceptanceDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeTaskId(def.taskId)}.json`);
  const tmpPath = `${filePath}.tmp-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify({ ...def, definedAt: new Date().toISOString() }, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
  return filePath;
}

/** 加载验收定义（不存在返回 undefined） */
export function loadAcceptanceDefinition(dataDir: string, taskId: string): (AcceptanceDefinition & { definedAt?: string }) | undefined {
  const filePath = join(acceptanceDir(dataDir), `${safeTaskId(taskId)}.json`);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as AcceptanceDefinition & { definedAt?: string };
    // 读侧再校验一次（防手工改坏）；parse 会剥离 definedAt，单独保留
    const validated = AcceptanceDefinitionSchema.parse(parsed);
    return { ...validated, ...(typeof parsed.definedAt === 'string' ? { definedAt: parsed.definedAt } : {}) };
  } catch {
    return undefined;
  }
}

// ============================================================
// 执行（checkAcceptance）
// ============================================================

/** 单条条件的执行结果 */
export interface CriterionResult {
  criterion: AcceptanceCriterion;
  pass: boolean;
  /** 人读详情（通过/不通过原因） */
  detail: string;
  /** 执行耗时 ms */
  durationMs: number;
}

/** 验收检查总结果 */
export interface AcceptanceCheckResult {
  taskId: string;
  /** 全部条件通过 = 验收通过 */
  ok: boolean;
  results: CriterionResult[];
  /** 总耗时 ms */
  durationMs: number;
  /** 未通过条件数 */
  failedCount: number;
}

/** 命令超时默认值（test/build 可能较慢，给 5 分钟） */
const COMMAND_TIMEOUT_MS = 300_000;

/** 执行 test/build 类条件（spawnSync，exit 0 = 通过） */
function runCommandCriterion(criterion: Extract<AcceptanceCriterion, { type: 'test' | 'build' }>, projectRoot: string): CriterionResult {
  const start = Date.now();
  const defaultCommand = criterion.type === 'test' ? 'npm test' : 'npm run build';
  const command = criterion.command ?? defaultCommand;
  try {
    const result = spawnSync(command, {
      cwd: projectRoot,
      shell: true,
      timeout: COMMAND_TIMEOUT_MS,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const exitCode = result.status ?? -1;
    const outputTail = ((result.stdout ?? '') + (result.stderr ?? '')).slice(-500);
    const pass = exitCode === 0;
    return {
      criterion,
      pass,
      detail: pass
        ? `${criterion.type} 通过（command: ${command}，exit 0）`
        : `${criterion.type} 失败（command: ${command}，exit ${exitCode}）${outputTail ? `\n输出尾部: ${outputTail}` : ''}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      criterion,
      pass: false,
      detail: `${criterion.type} 执行异常（command: ${command}）：${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/** 递归收集文件（grep-absent 用；跳过 node_modules/.git/dist） */
function collectFiles(root: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 8) return acc; // 深度上限——防超深目录拖垮
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        collectFiles(full, acc, depth + 1);
      } else if (st.isFile() && st.size < 2 * 1024 * 1024) {
        acc.push(full); // 单文件 2MB 上限——跳过巨型产物
      }
    } catch {
      // 不可读跳过
    }
  }
  return acc;
}

/** 执行 grep-absent 条件（pattern 零命中 = 通过） */
function runGrepAbsentCriterion(criterion: Extract<AcceptanceCriterion, { type: 'grep-absent' }>, projectRoot: string): CriterionResult {
  const start = Date.now();
  const target = criterion.path ? join(projectRoot, criterion.path) : projectRoot;
  try {
    if (!existsSync(target)) {
      return {
        criterion,
        pass: true,
        detail: `grep-absent 通过（目标路径不存在，视为零命中）：${criterion.path ?? projectRoot}`,
        durationMs: Date.now() - start,
      };
    }
    const st = statSync(target);
    const files = st.isDirectory() ? collectFiles(target) : [target];
    const hits: string[] = [];
    for (const f of files) {
      if (hits.length >= 5) break; // 最多记 5 处命中（详情够用即可）
      try {
        const content = readFileSync(f, 'utf-8');
        if (content.includes(criterion.pattern)) hits.push(f);
      } catch {
        // 二进制/不可读跳过
      }
    }
    const pass = hits.length === 0;
    return {
      criterion,
      pass,
      detail: pass
        ? `grep-absent 通过（pattern「${criterion.pattern}」零命中）`
        : `grep-absent 失败（pattern「${criterion.pattern}」命中 ${hits.length} 处：${hits.join(', ')}）`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      criterion,
      pass: false,
      detail: `grep-absent 执行异常：${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/** 执行 schema 条件（必需字段全在 = 通过） */
function runSchemaCriterion(criterion: Extract<AcceptanceCriterion, { type: 'schema' }>, projectRoot: string): CriterionResult {
  const start = Date.now();
  const filePath = join(projectRoot, criterion.file);
  try {
    if (!existsSync(filePath)) {
      return { criterion, pass: false, detail: `schema 失败：文件不存在 ${criterion.file}`, durationMs: Date.now() - start };
    }
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const missing = criterion.requiredFields.filter((f) => !(f in parsed));
    const pass = missing.length === 0;
    return {
      criterion,
      pass,
      detail: pass
        ? `schema 通过（${criterion.file} 含全部必需字段 ${criterion.requiredFields.join(', ')}）`
        : `schema 失败（${criterion.file} 缺字段：${missing.join(', ')}）`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      criterion,
      pass: false,
      detail: `schema 执行异常（${criterion.file}）：${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * 校验验收定义入参（zod strict 校验，对齐 workflow_submit 模式）。
 * @returns 校验通过的 AcceptanceDefinition；失败抛 Error（调用方捕获转结构化错误）
 */
export function validateAcceptanceDefinition(input: unknown): AcceptanceDefinition {
  const result = AcceptanceDefinitionSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`验收定义校验失败：${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  return result.data;
}

/**
 * 执行验收检查——逐条跑验收条件，返回结构化结果。
 *
 * @param dataDir 数据目录（验收定义存储位置）
 * @param taskId 任务标识
 * @param projectRoot 项目根（test/build/grep/schema 的执行工作目录）
 * @returns AcceptanceCheckResult；taskId 无定义时 ok=false + failedCount=-1 标记
 */
export function checkAcceptance(dataDir: string, taskId: string, projectRoot: string): AcceptanceCheckResult {
  const start = Date.now();
  const def = loadAcceptanceDefinition(dataDir, taskId);
  if (!def) {
    return {
      taskId,
      ok: false,
      results: [],
      durationMs: Date.now() - start,
      failedCount: -1, // -1 = 未定义（区别于「有定义但失败」）
    };
  }

  const results: CriterionResult[] = def.criteria.map((criterion) => {
    switch (criterion.type) {
      case 'test':
      case 'build':
        return runCommandCriterion(criterion, projectRoot);
      case 'grep-absent':
        return runGrepAbsentCriterion(criterion, projectRoot);
      case 'schema':
        return runSchemaCriterion(criterion, projectRoot);
    }
  });

  const failedCount = results.filter((r) => !r.pass).length;
  return {
    taskId,
    ok: failedCount === 0,
    results,
    durationMs: Date.now() - start,
    failedCount,
  };
}
