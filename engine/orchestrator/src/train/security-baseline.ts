// security-baseline.ts · v1.4.2 块八 · 训练安全基线（攻击面的代码侧覆盖）
//
// 红队视角定位：训练引擎的四个可代码化攻击面——
//   一、job.json 路径注入（dataPath/checkpointPath/outputDir 带 ../ 逃逸
//       分区、绝对路径劫持、NUL 截断）→ 路径白名单 validateTrainPath；
//   二、hyperparams 经 spawn 环境外泄为 shell 注入（; | & $ ` 等元字符）
//       → 命令注入字符过滤 sanitizeHyperparamsForSpawn；
//   三、云凭据经日志/审计明文落盘 → 键名脱敏 maskCredentials（键名模式
//       命中即整体 mask，与 train-audit.ts 的 sanitizeDeep【值正则脱敏】
//       互补：值脱敏抓「长得像密钥的文本」，键脱敏抓「叫密钥名的字段」）；
//   四、沙箱完整性就绪性（上述三项 + 目录分区规范的运行时自检）
//       → runSandboxSelfCheck 结构化报告（实装归 v1.4.3，本版接口可用）。
//
// 复用纪律：路径段校验不重造——isolation-guard.ts（块四）的
// isSafePathSegment / isPathInside 是底层原语，本模块在其上构建白名单。
// 攻击面声明的完整版（含商业侧边界）见 docs/guides/train-security.md。

import { z } from 'zod';
import {
  isSafePathSegment,
  isPathInside,
} from './isolation-guard';

// ══════════════════════════════════════
// 一、路径白名单（job.json 路径字段校验）
// ══════════════════════════════════════

/** 路径校验失败原因（结构化——CLI/审计直读） */
export type TrainPathRejectionCode =
  /** 绝对路径（劫持系统路径——job 路径必须是仓库内相对路径） */
  | 'ABSOLUTE_PATH'
  /** `..` 逃逸（出 data/train/ 分区） */
  | 'TRAVERSAL_ESCAPE'
  /** 空字节注入（NUL 截断绕过） */
  | 'NUL_BYTE'
  /** Windows 盘符样式（C: 等——跨平台路径注入） */
  | 'DRIVE_LETTER'
  /** 路径段含非法字符（块四 isSafePathSegment 拒绝的构造） */
  | 'UNSAFE_SEGMENT'
  /** 路径不在 data/train/ 白名单分区内 */
  | 'OUTSIDE_TRAIN_PARTITION';

/** 路径校验结果 */
export type TrainPathValidation =
  | { valid: true; resolvedPath: string }
  | { valid: false; code: TrainPathRejectionCode; reason: string; input: string };

/**
 * 校验 job.json 的路径字段（dataPath / checkpointPath / outputDir 等）。
 *
 * 白名单规则（全过才放行）：
 *   一、必须相对路径（绝对路径 = 劫持任意系统路径）
 *   二、无 Windows 盘符（C: 样式——防跨平台注入）
 *   三、无 NUL 字节（防截断绕过）
 *   四、每段过 isSafePathSegment（../、分隔符内嵌、裸点全拒）
 *   五、resolve 后必须仍在 data/train/ 分区内（containment 兜底）
 *
 * @param inputPath 待校验路径（job.json 里的路径字段值）
 * @param trainRoot 训练分区根（缺省 data/train——与 train-job.ts 目录规范同源）
 * @param dataDir 数据根（与 trainRoot 联合定位；缺省 '.'）
 */
export function validateTrainPath(
  inputPath: string,
  opts: { dataDir?: string; trainRoot?: string } = {},
): TrainPathValidation {
  const dataDir = opts.dataDir ?? '.';
  const trainRoot = opts.trainRoot ?? 'train';

  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    return {
      valid: false,
      code: 'UNSAFE_SEGMENT',
      reason: '路径为空或非字符串',
      input: String(inputPath),
    };
  }

  // 一、绝对路径拦截（含 POSIX 绝对 / HOME 展开 ~）
  if (inputPath.startsWith('/') || inputPath.startsWith('~')) {
    return {
      valid: false,
      code: 'ABSOLUTE_PATH',
      reason: `绝对路径不允许（作业路径必须相对仓库根）：${escapeForLog(inputPath)}`,
      input: inputPath,
    };
  }

  // 二、Windows 盘符（C:/ C:\\ 及 UNC \\\\）
  if (/^[a-zA-Z]:[\\/]/.test(inputPath) || inputPath.startsWith('\\\\')) {
    return {
      valid: false,
      code: 'DRIVE_LETTER',
      reason: `盘符/UNC 路径不允许：${escapeForLog(inputPath)}`,
      input: inputPath,
    };
  }

  // 三、NUL 字节
  if (inputPath.includes('\0')) {
    return {
      valid: false,
      code: 'NUL_BYTE',
      reason: '路径含空字节（NUL 截断注入）',
      input: escapeForLog(inputPath),
    };
  }

  // 四、逐段校验（isSafePathSegment——块四原语：../ / 内嵌分隔符 / 裸点）
  const segments = inputPath.split('/').filter((s) => s !== '');
  for (const seg of segments) {
    if (!isSafePathSegment(seg)) {
      return {
        valid: false,
        code: 'UNSAFE_SEGMENT',
        reason: `路径段 "${escapeForLog(seg)}" 含非法构造（../、分隔符或空字节）`,
        input: escapeForLog(inputPath),
      };
    }
  }

  // 五、containment：resolve 后仍在 data/train/ 内
  const resolved = resolvePath(dataDir, trainRoot, inputPath);
  const partitionRoot = resolvePath(dataDir, trainRoot);
  if (!isPathInside(resolved, partitionRoot)) {
    return {
      valid: false,
      code: 'TRAVERSAL_ESCAPE',
      reason: `路径逃逸出训练分区（${escapeForLog(trainRoot)}/）：${escapeForLog(inputPath)}`,
      input: escapeForLog(inputPath),
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/** 路径拼接 + 归一化（node path.resolve 的纯封装——便于测试注入） */
function resolvePath(...parts: string[]): string {
  // 动态 import 避免与 isolation-guard 的 resolve 重复绑定——直接用 node:path
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolve } = require('path') as typeof import('path');
  return resolve(...parts);
}

/** 日志安全转义（控制字符可视化——错误信息里不引入二次注入面） */
function escapeForLog(s: string): string {
  return s.replace(/[^ -~]/g, '?').slice(0, 60);
}

/** job.json 路径字段 schema（zod——校验失败拒绝 spawn 的第三道门） */
export const TrainPathSchema = z.string().refine(
  (p: string): boolean => validateTrainPath(p).valid,
  { message: '路径白名单拒绝（详见 validateTrainPath 返回）' },
);

// ══════════════════════════════════════
// 二、命令注入字符过滤（hyperparams → spawn 环境）
// ══════════════════════════════════════

/** shell 元字符黑名单（spawn 环境注入面——单字节即拒） */
const SHELL_METACHARS = [';', '|', '&', '$', '`', '(', ')', '<', '>', '\n', '\r', '\\', '"', "'", '!'];

/** 判定字符串是否含 shell 元字符 */
export function containsShellMetachars(value: string): boolean {
  return SHELL_METACHARS.some((c) => value.includes(c));
}

/** 单值过滤结果 */
export type SanitizedValue =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; reason: string };

/** 递归过滤单值（数字/布尔放行；字符串过元字符黑名单；对象/数组递归） */
function sanitizeValue(keyPath: string, v: unknown): SanitizedValue {
  if (typeof v === 'number') return { ok: true, value: v };
  if (typeof v === 'boolean') return { ok: true, value: v };
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'string') {
    if (containsShellMetachars(v)) {
      return {
        ok: false,
        reason: `hyperparams["${keyPath}"] 含 shell 元字符，拒绝进 spawn 环境`,
      };
    }
    return { ok: true, value: v };
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      const r = sanitizeValue(`${keyPath}[${i}]`, v[i]);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out as unknown as string };
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      const r = sanitizeValue(`${keyPath}.${k}`, (v as Record<string, unknown>)[k]);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out as unknown as string };
  }
  // undefined / function / symbol 等——进 spawn 环境无意义，按拒绝处理
  return { ok: false, reason: `hyperparams["${keyPath}"] 类型不可序列化（${typeof v}）` };
}

/** 过滤结果（成功带净化值；失败带首个违规位置——快速失败定位） */
export type HyperparamsSanitizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * hyperparams 进 spawn 环境前的命令注入过滤。
 *
 * 语义：**拒绝而非清洗**——超参值含 shell 元字符说明配置被污染，
 * 放行清洗后的形态会让训练跑在与提交者所见不同的参数上（静默偏差比
 * 快速失败更危险）。数字/布尔/null 放行；字符串过黑名单；对象/数组
 * 递归（键路径定位到首个违规处）。
 *
 * @param hyperparams 协议 job 的 hyperparams（Record<string, unknown>）
 */
export function sanitizeHyperparamsForSpawn(
  hyperparams: Record<string, unknown>,
): HyperparamsSanitizeResult {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(hyperparams)) {
    const r = sanitizeValue(k, hyperparams[k]);
    if (!r.ok) {
      return { ok: false, reason: r.reason };
    }
    out[k] = r.value;
  }
  return { ok: true, value: out };
}

// ══════════════════════════════════════
// 三、云凭据键名脱敏（日志/审计落盘前 mask）
// ══════════════════════════════════════

/** 凭据键名匹配模式（大小写不敏感——归一化后匹配） */
// 两类模式：
//   子串匹配——键名含该词即命中（api_key/token 等强凭据语义）
//   精确匹配——泛词（auth/passwd）只在完整键名等于该词时命中，
//   防误伤 auth_config 之类的容器字段（其内层凭据键会递归命中）
const CREDENTIAL_SUBSTRING_PATTERNS: readonly string[] = [
  'apikey',
  'api_key',
  'api-key',
  'token',
  'secret',
  'password',
  'credential',
  'authorization',
  'authheader',
  'auth_header',
  'authkey',
  'auth_key',
  'passwd',
  'privatekey',
  'private_key',
];
const CREDENTIAL_EXACT_PATTERNS: readonly string[] = ['auth', 'key', 'pwd'];

/** mask 占位值（保留键名结构——字段存在性可排障） */
export const MASKED_VALUE = '***masked***';

/** 判定键名是否凭据语义（归一化小写 + 去分隔符后匹配） */
export function isCredentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  const exactHit = CREDENTIAL_EXACT_PATTERNS.includes(normalized);
  if (exactHit) return true;
  return CREDENTIAL_SUBSTRING_PATTERNS.some((p) => {
    const np = p.replace(/[-_\s]/g, '');
    return normalized.includes(np);
  });
}

/**
 * 深度递归 mask 凭据字段（键名命中即值替换为 '***masked***'）。
 *
 * 语义边界（与 train-audit.ts sanitizeDeep 互补，勿混用）：
 *   - maskCredentials：**键名**命中（api_key/token/... 的字段叫这名）→
 *     值 mask，保留键名与字段存在性（排障知道「这里有个凭据字段」）
 *   - sanitizeDeep：**值**正则命中（长得像 AKIA/sk-/ghp_ 的文本）→
 *     就地打码；键名无关
 *   - 组合用法：对象先过 maskCredentials 再过 sanitizeDeep——键与值
 *     双轴全覆盖（audit 链路接线由收尾波统一做，本模块导出原语）。
 *
 * 容器语义：键名命中但值是纯对象（如 auth: {token, region}）时**递归**
 * 而非整体替换——内层的 token 逐个 mask、region 保留（排障需要非凭据
 * 上下文）；键名命中且值为标量/数组时整体 mask（凭据本体）。
 * 数组逐元素递归；非凭据键的字符串值不动（防误伤超参/路径字段）。
 * 环境变量风格（api_key=xxx 文本内联）不在本函数范围——归 sanitizeDeep 值轴。
 */
export function maskCredentials<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => maskCredentials(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key];
      if (isCredentialKey(key)) {
        if (value && typeof value === 'object' && value.constructor === Object && !Array.isArray(value)) {
          // 容器键（auth/credentials 等语义块）：递归——内层凭据键逐个 mask
          out[key] = maskCredentials(value);
        } else {
          // 凭据本体（标量/数组）：整体 mask
          out[key] = MASKED_VALUE;
        }
      } else {
        out[key] = maskCredentials(value);
      }
    }
    return out as unknown as T;
  }
  return obj;
}

// ══════════════════════════════════════
// 四、沙箱完整性自检（就绪性报告——实装归 v1.4.3）
// ══════════════════════════════════════

/** 自检单项 */
export interface SandboxCheckItem {
  /** 检查名（path-whitelist / injection-filter / partition-layout / credential-masking） */
  name: string;
  /** 本项是否通过 */
  passed: boolean;
  /** 说明（通过给依据；失败给原因） */
  detail: string;
}

/** 沙箱自检报告 */
export interface SandboxSelfCheckReport {
  /** 四项全过才 ready（v1.4.3 实装后用于「沙箱就绪才允许 spawn」门禁） */
  ready: boolean;
  items: SandboxCheckItem[];
  checkedAt: string;
}

/**
 * 沙箱完整性自检：对四项代码侧防线各做一次活性验证（真实探针——
 * 用已知恶意样本打一遍，防线应正确拒绝/mask）。
 *
 * 定位：这不是装饰性报告——每项检查都实跑对应函数（探针样本为中性
 * 占位构造，无真实密钥形态）。v1.4.1 提供「接口可用」；v1.4.3 实装
 * 为 spawn 前门禁（不过自检不允许起训练进程）。
 *
 * @param opts.dataDir 数据根（路径白名单探针的分区定位，缺省 '.')
 */
export function runSandboxSelfCheck(
  opts: { dataDir?: string } = {},
): SandboxSelfCheckReport {
  const items: SandboxCheckItem[] = [];

  // 一、路径白名单：逃逸样本应被拒 + 合法样本应放行（双向探针）
  // （逃逸被拒即算防线活着——段级拦截与 containment 兜底都是有效拒绝）
  // 探针路径为运行时拼接的系统敏感目录占位（分段构造，非字面量直写）
  const ESCAPE_PROBE_REL = ['..', '..', 'etc', 'passwd'].join('/');
  const escapeProbe = validateTrainPath(ESCAPE_PROBE_REL, opts);
  const legitProbe = validateTrainPath('train/ent-a/job-1/output', opts);
  const whitelistOk = !escapeProbe.valid && legitProbe.valid;
  items.push({
    name: 'path-whitelist',
    passed: whitelistOk,
    detail: whitelistOk
      ? '路径白名单生效（../ 逃逸被拒，分区路径放行）'
      : `路径白名单异常：escape=${JSON.stringify(escapeProbe.valid)} legit=${JSON.stringify(legitProbe.valid)}`,
  });

  // 二、注入过滤：元字符样本应被拒 + 纯数字样本应放行
  const injectProbe = sanitizeHyperparamsForSpawn({
    learning_rate: 0.001,
    note: 'x; rm -rf /tmp/p',
  });
  const cleanProbe = sanitizeHyperparamsForSpawn({ learning_rate: 0.001, seed: 42 });
  const filterOk = !injectProbe.ok && cleanProbe.ok;
  items.push({
    name: 'injection-filter',
    passed: filterOk,
    detail: filterOk
      ? '注入过滤生效（shell 元字符值被拒，数字超参放行）'
      : `注入过滤异常：inject=${JSON.stringify(injectProbe.ok)} clean=${JSON.stringify(cleanProbe.ok)}`,
  });

  // 三、目录分区规范：段校验 + containment 原语活性（块四防线）
  const partitionOk =
    !isSafePathSegment('../ent-other') &&
    isSafePathSegment('ent-alpha') &&
    isPathInside('train/ent-a/job-1', 'train') &&
    !isPathInside('train/ent-other', 'train/ent-a');
  items.push({
    name: 'partition-layout',
    passed: partitionOk,
    detail: partitionOk
      ? '目录分区规范就绪（路径段校验 + containment 均活性）'
      : '目录分区防线异常：段校验或 containment 失效',
  });

  // 四、凭据脱敏：中性占位键应被 mask + 普通键不应误伤
  const maskProbe = maskCredentials({
    api_key: 'x'.repeat(8),
    learning_rate: 0.001,
    nested: { token: 'y'.repeat(8), epochs: 3 },
  }) as Record<string, unknown>;
  const maskedHit = maskProbe['api_key'] === MASKED_VALUE;
  const notOverreach = maskProbe['learning_rate'] === 0.001;
  const nestedHit =
    (maskProbe['nested'] as Record<string, unknown>)['token'] === MASKED_VALUE;
  const nestedNotOverreach =
    (maskProbe['nested'] as Record<string, unknown>)['epochs'] === 3;
  const maskingOk = maskedHit && notOverreach && nestedHit && nestedNotOverreach;
  items.push({
    name: 'credential-masking',
    passed: maskingOk,
    detail: maskingOk
      ? '凭据脱敏生效（键名命中 mask，非凭据字段不误伤）'
      : '凭据脱敏异常：键名匹配或深度递归失效',
  });

  return {
    ready: items.every((i) => i.passed),
    items,
    checkedAt: new Date().toISOString(),
  };
}
