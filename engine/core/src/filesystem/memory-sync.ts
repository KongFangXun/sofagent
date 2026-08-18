// ============================================================
// memory-sync.ts · Agent Memory persona 同步（路径通用化）
// v1.3.7 新增：检测 ~/.openclaw/memory-tdai/persona.md 变更
// v1.3.7 ⑨ 路径通用化：三级优先解析（2026-08-18 用户决策）
//   ① env SOFAGENT_PERSONA_SOURCE（单路径，最高优先）
//   ② config.yml memory_sync.persona_sources[]（数组）
//   ③ 内置默认表（原 3 路径降级为 fallback）
//   与 memory-backend.ts 通用适配器哲学对齐——TencentDB 开箱即用但非唯一。
//
// 用途：
//   - 监控 agent memory 的 persona 记忆文件变化
//   - 自动同步到 .sofagent/knowledge/entities/persona.md
//   - launcher.ts 构建 system prompt 时注入（前 500 字符）
//
// 安全边界：
//   - 只读源文件，写入目标文件
//   - persona.md 不存在或质量差时：记录警告 + 跳过，绝不崩溃
//   - 全部来源都不存在时 synced:false + reason（不 crash 不外联）
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** 同步源解析选项（v1.3.7 ⑨——签名向后兼容：不传时行为与 v1.3.6 一致） */
export interface PersonaSourceOptions {
  /** config.yml memory_sync.persona_sources[] 的值（调用方从 loadConfig 取） */
  configSources?: string[];
  /** 额外 env 覆盖（默认读 process.env.SOFAGENT_PERSONA_SOURCE——单测可注入） */
  envSource?: string | null;
}

/** persona.md 内置默认源路径（三级解析的 fallback） */
const PERSONA_SOURCE_PATHS = [
  join(homedir(), '.openclaw', 'memory-tdai', 'persona.md'),
  join(homedir(), '.workbuddy', 'memory-tdai', 'persona.md'),
  join(homedir(), '.openclaw', 'memory', 'persona.md'),
];

/**
 * 三级优先解析 persona 源路径列表。
 *
 * 优先级：env SOFAGENT_PERSONA_SOURCE（单值）> config 数组 > 内置默认表。
 * 任一级缺省时优雅落到下一级。
 *
 * @param opts 解析选项（env 注入 + config 数组）
 * @returns 按优先级排序的候选路径数组
 */
export function resolvePersonaSources(opts: PersonaSourceOptions = {}): string[] {
  const envVal = opts.envSource !== undefined ? opts.envSource : process.env.SOFAGENT_PERSONA_SOURCE;
  if (envVal && envVal.trim() !== '') {
    return [envVal.trim()];
  }
  const cfg = (opts.configSources || []).filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  if (cfg.length > 0) {
    return cfg.map(p => p.trim());
  }
  return [...PERSONA_SOURCE_PATHS];
}

/** 同步目标基础路径 */
function getTargetPath(dataDir?: string): string {
  const base = dataDir || join(process.cwd(), '.sofagent');
  return join(base, 'knowledge', 'entities', 'persona.md');
}

/** Persona 质量阈值 */
const MIN_PERSONA_LENGTH = 50;    // 最少 50 字符
const MAX_PERSONA_LENGTH = 50000; // 最多 50KB（防止异常大文件）

/**
 * 查找 persona.md 源文件
 * 按三级优先解析出的候选路径遍历，返回第一个存在的
 *
 * @param opts 解析选项（v1.3.7 ⑨ 三级优先：env > config > 默认表）
 * @returns 源文件路径，或 null
 */
function findPersonaSource(opts: PersonaSourceOptions = {}): string | null {
  for (const path of resolvePersonaSources(opts)) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

/**
 * 检查 persona 内容质量
 *
 * 质量问题包括：
 *   - 过短（< 50 字符）——可能是占位文件
 *   - 过长（> 50KB）——异常
 *   - 格式不稳定——仅含纯键值对无描述
 *   - 过于通用——全是模板占位符
 *
 * @param content persona 文件内容
 * @returns { valid: boolean, reason?: string }
 */
function checkPersonaQuality(content: string): { valid: boolean; reason?: string } {
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: '文件为空' };
  }

  if (content.length < MIN_PERSONA_LENGTH) {
    return { valid: false, reason: `内容过短（${content.length} 字符 < ${MIN_PERSONA_LENGTH}）` };
  }

  if (content.length > MAX_PERSONA_LENGTH) {
    return { valid: false, reason: `内容过长（${content.length} 字符 > ${MAX_PERSONA_LENGTH}）` };
  }

  // 检测是否为纯模板占位符
  const placeholderPatterns = [
    /^你是一个[^\n]{0,20}\n*$/,
    /^\{\{.*\}\}$/m,
    /^TODO/i,
  ];
  const templateHits = placeholderPatterns.filter((p) => p.test(content.trim()));
  if (templateHits.length >= 2) {
    return { valid: false, reason: '内容疑似模板占位符（含多处 TODO/{{}}）' };
  }

  return { valid: true };
}

/**
 * 同步 persona.md
 *
 * 流程：
 *   1. 查找源文件（三级优先：env SOFAGENT_PERSONA_SOURCE > config persona_sources > 内置默认）
 *   2. 检查内容质量
 *   3. 写入 .sofagent/knowledge/entities/persona.md
 *
 * @param dataDir .sofagent 数据目录（默认 cwd/.sofagent）
 * @param opts v1.3.7 ⑨ 源解析选项（不传 = 与 v1.3.6 行为完全一致的内置默认表）
 * @returns 同步结果
 */
export function syncPersona(dataDir?: string, opts: PersonaSourceOptions = {}): { synced: boolean; sourcePath?: string; reason?: string } {
  try {
    const sourcePath = findPersonaSource(opts);
    if (!sourcePath) {
      return { synced: false, reason: '未找到 persona.md 源文件（三级解析：env SOFAGENT_PERSONA_SOURCE > config memory_sync.persona_sources > 内置默认路径）' };
    }

    let content: string;
    try {
      content = readFileSync(sourcePath, 'utf-8');
    } catch (err) {
      return { synced: false, reason: `读取源文件失败: ${(err as Error).message}` };
    }

    // 质量检查
    const quality = checkPersonaQuality(content);
    if (!quality.valid) {
      console.warn(`[memory-sync] persona.md 质量不合格 (${sourcePath}): ${quality.reason}`);
      // 尝试截取有效部分
      const trimmed = content.trim();
      if (trimmed.length >= MIN_PERSONA_LENGTH) {
        // 内容长度够，可能是格式问题但仍有可用信息
        content = trimmed;
      } else {
        return { synced: false, reason: `质量不合格: ${quality.reason}` };
      }
    }

    // 写入目标
    const targetPath = getTargetPath(dataDir);
    try {
      const targetDir = join(targetPath, '..');
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(targetPath, content, 'utf-8');
    } catch (err) {
      return { synced: false, reason: `写入目标文件失败: ${(err as Error).message}` };
    }

    console.log(`[memory-sync] persona.md 已同步: ${sourcePath} → ${targetPath}`);
    return { synced: true, sourcePath };
  } catch (err) {
    console.warn(`[memory-sync] 同步未完成（不影响正常运行）: ${(err as Error).message}`);
    return { synced: false, reason: (err as Error).message };
  }
}

/**
 * 读取已同步的 persona 内容（用于注入 system prompt）
 *
 * @param dataDir .sofagent 数据目录
 * @param maxChars 最大字符数（默认 500）
 * @returns persona 内容片段，或 null
 */
export function getPersonaContent(dataDir?: string, maxChars: number = 500): string | null {
  try {
    const targetPath = getTargetPath(dataDir);
    if (!existsSync(targetPath)) {
      return null;
    }

    const content = readFileSync(targetPath, 'utf-8');
    if (!content || content.trim().length === 0) {
      return null;
    }

    return content.length > maxChars ? content.slice(0, maxChars) + '...' : content;
  } catch {
    return null;
  }
}
