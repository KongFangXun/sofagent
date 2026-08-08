// ============================================================
// verify/utils.ts · 验证脚本的工具函数集合
// v1.2.8 从 sofagent/audit/src/verify/utils.ts 迁出
// ============================================================
// 从 verify.ts 中提取的路径工具、命令执行、文件操作等纯工具函数。

import { existsSync, readFileSync, statSync, readdirSync, type Dirent } from 'fs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { homedir } from 'os';
import { DATA_DIR } from '../data-paths';

// ── 路径工具 ──
export const HOME = homedir();

/** 安全执行命令，返回 stdout 字符串或 null（执行失败时）。 */
export function tryExec(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch (err) {
    console.error(`[verify] 命令执行失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 检测命令是否可用（替代 `command -v`）。 */
export function commandAvailable(cmd: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(which, [cmd], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  return result.status === 0;
}

/** 计算文件字符数（替代 `wc -m`）。 */
export function countChars(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.length;
  } catch (err) {
    console.error(`[verify] 读取文件字符数失败: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** 计算文件行数（替代 `wc -l`）。 */
export function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch (err) {
    console.error(`[verify] 计算文件行数失败: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** 获取文件权限数字（如 "644"）。 */
export function getFileMode(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return (stat.mode & 0o777).toString(8);
  } catch (err) {
    console.error(`[verify] 获取文件权限失败: ${err instanceof Error ? err.message : String(err)}`);
    return '???';
  }
}

/** 统计目录下匹配后缀的文件数（替代 `find ... | wc -l`）。 */
export function countFilesInDir(dir: string, suffix: string): number {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.filter((e: Dirent) => e.isFile() && e.name.endsWith(suffix)).length;
  } catch (err) {
    console.error(`[verify] 统计目录文件数失败: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** 检查文件是否可执行。 */
export function isExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return (stat.mode & 0o111) !== 0; // 任意 x 位
  } catch (err) {
    console.error(`[verify] 检查可执行权限失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 列出目录下近 N 天修改过的匹配文件（替代 `find -mtime`）。 */
export function findRecentFiles(dir: string, matchPattern: RegExp, days: number): string[] {
  const cutoff = Date.now() - days * 86400_000;
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!matchPattern.test(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs >= cutoff) {
          results.push(fullPath);
        }
      } catch (err) {
        console.error(`[verify] 读取文件元信息失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    console.error(`[verify] 扫描目录失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  return results;
}

/** 读取文件内容，失败返回空字符串。 */
export function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`[verify] 读取文件失败: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

// ── 数据目录解析 ──
/**
 * 解析数据根目录（v1.2.1：从 ${cwd}/.sofagent 迁移到 ${cwd}/data）。
 * 优先从 ~/.openclaw/skills/sofagent/ 下查找已安装的 SKILL.md 定位 repoRoot，
 * 再按 ${cwd}/data → ${cwd}/.sofagent（遗留兼容）顺序解析。
 */
export function resolveSofagentData(platformDir: string): string {
  const cwdData = DATA_DIR;
  const legacyData = join(process.cwd(), '.sofagent');

  // 1. 尝试从已安装的 SKILL.md 定位（repoRoot/data）
  const installedSkill = join(platformDir, 'skills', 'sofagent', 'SKILL.md');
  if (existsSync(installedSkill)) {
    // 已安装到 ~/.openclaw，数据目录用 cwd/data（用户运行 verify 时在 repo root）
    if (existsSync(cwdData)) return cwdData;
    // 遗留兼容：老安装只有 .sofagent/ 数据目录
    if (existsSync(legacyData)) return legacyData;
  }

  // 2. 尝试 cwd/data（v1.2.1 起规范位置），再退 cwd/.sofagent（遗留）
  if (existsSync(cwdData)) return cwdData;
  if (existsSync(legacyData)) return legacyData;

  // 3. 回退：返回默认路径（即使不存在，用于 warning 检查）
  return cwdData;
}

// ── 脱敏函数测试（10.1 的 6 条正则）──
/**
 * 模拟 sed 链脱敏——与 verify.sh _test_sanitize 完全一致。
 * 不依赖 config.sh，直接用正则测试。
 */
export function testSanitize(input: string): string {
  let s = input;
  // 1. OpenAI / Anthropic API Key (sk- / sk-ant- / sk-ant-api-)
  s = s.replace(/sk-(ant(-api-)?-)?[a-zA-Z0-9_-]{20,}/g, 'sk-***REDACTED***');
  // 2. Bearer token
  s = s.replace(/Bearer +[a-zA-Z0-9._~+/-]+=*/g, 'Bearer ***REDACTED***');
  // 3. JWT token（eyJ 开头的 base64url 三段式）
  s = s.replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '***JWT-REDACTED***');
  // 4. AWS Access Key（AKIA 开头，16 字符后缀）
  s = s.replace(/AKIA[0-9A-Z]{16}/g, '***AWS-KEY-REDACTED***');
  // 5. 凭证赋值（^|非字母数字 保证不误伤 monkey=key 之类）
  s = s.replace(/(^|[^a-zA-Z0-9_])(password|token|secret|api_key|key)[=:][^ \n]+/g,
    '$1$2=***REDACTED***');
  // 6. 私钥块
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '***PRIVATE-KEY-BLOCK-REDACTED***');
  // 7. 中国大陆手机号（1[3-9] 开头 + 9 位数字，共 11 位）
  s = s.replace(/1[3-9][0-9]{9}/g, '[PHONE-REDACTED]');
  return s;
}
