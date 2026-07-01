#!/usr/bin/env node
// ============================================================
// sofagent-verify · 装后验证脚本（TypeScript 版）
// ============================================================
// 验证 sofagent 安装完整性（9 个检查类别，50 项）。
// 由 verify.sh (923 行 bash) + windows/verify.ps1 合并而来，
// 注册为 npm 包 bin。零运行时依赖——只用 Node.js 内置模块。
//
// 用法：
//   sofagent-verify              彩色终端输出，显示所有检查项
//   sofagent-verify --json       JSON 机器可读输出（CI/CD 用）
//   sofagent-verify --quiet      只输出失败和警告，全通过时静默
//   sofagent-verify --quick      快速模式——仅 4 项核心检查
//   sofagent-verify --platform X 手动指定平台（openclaw/workbuddy/claude/codex/hermes）
//   sofagent-verify --help       显示此帮助
//
// 退出码：
//   0 = 全部通过
//   1 = 存在失败项
// ============================================================

import { existsSync, readFileSync, statSync, readdirSync, type Dirent } from 'fs';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { homedir } from 'os';

const VERSION = '0.99.2';

// ── 颜色（与 index.ts 风格一致）──
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

// ── 检查状态类型 ──
type CheckStatus = 'pass' | 'fail' | 'warn';

interface CheckItem {
  status: CheckStatus;
  item: string;
}

interface VerifyResult {
  pass: number;
  warn: number;
  fail: number;
  total: number;
  checks: CheckItem[];
}

// ── 参数解析 ──
interface Args {
  json: boolean;
  quiet: boolean;
  quick: boolean;
  platform: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, quiet: false, quick: false, platform: '' };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) { i++; continue; }
    if (arg === '--json') {
      args.json = true;
      i++;
    } else if (arg === '--quiet') {
      args.quiet = true;
      i++;
    } else if (arg === '--quick') {
      args.quick = true;
      i++;
    } else if (arg === '--platform') {
      const next = argv[i + 1];
      if (next !== undefined) {
        args.platform = next.toLowerCase();
        i += 2;
      } else {
        i++;
      }
    } else if (arg.startsWith('--platform=')) {
      args.platform = arg.slice('--platform='.length).toLowerCase();
      i++;
    } else if (arg === '--help') {
      console.log(`sofagent verify v${VERSION}`);
      console.log('  正常模式  彩色终端，显示所有检查项');
      console.log('  --json    JSON 机器可读输出（CI/CD 用）');
      console.log('  --quiet   只输出失败和警告，全通过时静默');
      console.log('  --quick   快速模式——仅 4 项核心检查（SKILL.md / .sofagent/ / ao compose / fde.md）');
      console.log('  --platform <name>  手动指定平台（openclaw/workbuddy/claude/codex/hermes）');
      console.log('  --help    显示此帮助');
      console.log('退出码: 0=全部通过 1=存在失败项');
      process.exit(0);
    } else {
      // 未知参数静默忽略
      i++;
    }
  }
  return args;
}

// ── 路径工具 ──
const HOME = homedir();

/** 安全执行命令，返回 stdout 字符串或 null（执行失败时）。 */
function tryExec(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch {
    return null;
  }
}

/** 检测命令是否可用（替代 `command -v`）。 */
function commandAvailable(cmd: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(which, [cmd], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  return result.status === 0;
}

/** 计算文件字符数（替代 `wc -m`）。 */
function countChars(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.length;
  } catch {
    return 0;
  }
}

/** 计算文件行数（替代 `wc -l`）。 */
function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/** 获取文件权限数字（如 "644"）。 */
function getFileMode(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return (stat.mode & 0o777).toString(8);
  } catch {
    return '???';
  }
}

/** 统计目录下匹配后缀的文件数（替代 `find ... | wc -l`）。 */
function countFilesInDir(dir: string, suffix: string): number {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.filter((e: Dirent) => e.isFile() && e.name.endsWith(suffix)).length;
  } catch {
    return 0;
  }
}

/** 检查文件是否可执行。 */
function isExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return (stat.mode & 0o111) !== 0; // 任意 x 位
  } catch {
    return false;
  }
}

/** 列出目录下近 N 天修改过的匹配文件（替代 `find -mtime`）。 */
function findRecentFiles(dir: string, matchPattern: RegExp, days: number): string[] {
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
      } catch {
        // 跳过不可读文件
      }
    }
  } catch {
    // 目录不存在
  }
  return results;
}

/** 读取文件内容，失败返回空字符串。 */
function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ── 数据目录解析 ──
/**
 * 解析 SOFAGENT_DATA 目录。
 * 优先从 ~/.openclaw/skills/sofagent/ 下查找已安装的 SKILL.md 定位 repoRoot，
 * 回退到 ${repoRoot}/.sofagent，再回退到 ${cwd}/.sofagent。
 */
function resolveSofagentData(platformDir: string): string {
  // 1. 尝试从已安装的 SKILL.md 定位（repoRoot/.sofagent）
  const installedSkill = join(platformDir, 'skills', 'sofagent', 'SKILL.md');
  if (existsSync(installedSkill)) {
    // 已安装到 ~/.openclaw，数据目录用 cwd/.sofagent（用户运行 verify 时在 repo root）
    const cwdData = join(process.cwd(), '.sofagent');
    if (existsSync(cwdData)) return cwdData;
  }

  // 2. 尝试 cwd/.sofagent
  const cwdData = join(process.cwd(), '.sofagent');
  if (existsSync(cwdData)) return cwdData;

  // 3. 回退：返回默认路径（即使不存在，用于 warning 检查）
  return cwdData;
}

// ── 验证器主类 ──
class Verifier {
  private passCount = 0;
  private warnCount = 0;
  private failCount = 0;
  private checks: CheckItem[] = [];
  private jsonMode: boolean;
  private quietMode: boolean;

  constructor(jsonMode: boolean, quietMode: boolean) {
    this.jsonMode = jsonMode;
    this.quietMode = quietMode;
  }

  /** 记录通过项。 */
  checkPass(desc: string): void {
    this.passCount++;
    this.checks.push({ status: 'pass', item: desc });
    if (!this.jsonMode && !this.quietMode) {
      console.log(`  ${GREEN}✓${NC} ${desc}`);
    }
  }

  /** 记录失败项。 */
  checkFail(desc: string): void {
    this.failCount++;
    this.checks.push({ status: 'fail', item: desc });
    if (this.jsonMode) {
      // JSON 模式不输出单项
    } else if (this.quietMode) {
      console.log(`  ${RED}✗${NC} ${desc}`);
    } else {
      console.log(`  ${RED}✗${NC} ${desc}`);
    }
  }

  /** 记录警告项。 */
  checkWarn(desc: string): void {
    this.warnCount++;
    this.checks.push({ status: 'warn', item: desc });
    if (this.jsonMode) {
      // JSON 模式不输出单项
    } else if (this.quietMode) {
      console.log(`  ${YELLOW}⚠${NC} ${desc}`);
    } else {
      console.log(`  ${YELLOW}⚠${NC} ${desc}`);
    }
  }

  /** 输出 banner。 */
  printBanner(): void {
    if (this.jsonMode || this.quietMode) return;
    console.log('');
    console.log('  ╔═══════════════════════════════════╗');
    console.log('  ║   sofagent · verify              ║');
    console.log('  ╚═══════════════════════════════════╝');
    console.log('');
  }

  /** 输出平台信息。 */
  printPlatformInfo(platform: string, target: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`  平台: ${platform} | 目标: ${target}`);
    console.log('');
  }

  /** 输出 section 标题。 */
  section(title: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`── ${title} ──`);
  }

  /** 输出空行分隔符。 */
  hr(): void {
    if (this.jsonMode || this.quietMode) return;
    console.log('');
  }

  /** 输出粗体黄色标题。 */
  printBoldYellow(title: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`${BOLD}${YELLOW}${title}${NC}`);
  }

  /** 获取检查结果。 */
  getResult(): VerifyResult {
    return {
      pass: this.passCount,
      warn: this.warnCount,
      fail: this.failCount,
      total: this.passCount + this.warnCount + this.failCount,
      checks: this.checks,
    };
  }

  /** 获取失败计数。 */
  get failTotal(): number { return this.failCount; }
  /** 获取通过计数。 */
  get passTotal(): number { return this.passCount; }
  /** 获取警告计数。 */
  get warnTotal(): number { return this.warnCount; }
  /** 获取总检查数。 */
  get total(): number { return this.passCount + this.warnCount + this.failCount; }

  /** 输出 JSON 结果。 */
  outputJson(): void {
    const result = this.getResult();
    const jsonOutput = {
      summary: {
        pass: result.pass,
        warn: result.warn,
        fail: result.fail,
        total: result.total,
      },
      checks: result.checks,
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  }

  /** 输出文本总结。 */
  outputSummary(): void {
    if (this.jsonMode) return;
    console.log('───────────────────────────────────────');
    console.log('');
    console.log(`  结果: ${GREEN}${this.passCount} 通过${NC} / ${YELLOW}${this.warnCount} 警告${NC} / ${RED}${this.failCount} 失败${NC}（共 ${this.total} 项）`);
    console.log('');
  }
}

// ── 脱敏函数测试（10.1 的 6 条正则）──
/**
 * 模拟 sed 链脱敏——与 verify.sh _test_sanitize 完全一致。
 * 不依赖 config.sh，直接用正则测试。
 */
function testSanitize(input: string): string {
  let s = input;
  // 1. OpenAI / Anthropic API Key (sk- / sk-ant- / sk-ant-api-)
  s = s.replace(/sk-(ant(-api)?-)?[a-zA-Z0-9_-]{20,}/g, 'sk-***REDACTED***');
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

// ════════════════════════════════════════
// 主函数
// ════════════════════════════════════════
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const v = new Verifier(args.json, args.quiet);

  // ── 平台探测 ──
  let platform = args.platform;
  if (!platform) {
    if (existsSync(join(HOME, '.openclaw'))) platform = 'openclaw';
    else if (existsSync(join(HOME, '.workbuddy'))) platform = 'workbuddy';
    else if (existsSync(join(HOME, '.claude'))) platform = 'claude';
    else if (existsSync(join(HOME, '.codex'))) platform = 'codex';
    else if (existsSync(join(HOME, '.hermes'))) platform = 'hermes';
    else platform = 'openclaw'; // 默认回退
  }

  // ── 按平台确定目标路径 ──
  let target = '';
  switch (platform) {
    case 'openclaw':
      target = process.env.OPENCLAW_STATE_DIR || join(HOME, '.openclaw');
      break;
    case 'workbuddy':
      target = ''; // 工作区数据目录，不做系统级检查
      break;
    case 'claude':
      target = join(HOME, '.claude');
      break;
    case 'codex':
      target = join(HOME, '.codex');
      break;
    case 'hermes':
      target = join(HOME, '.hermes');
      break;
    default:
      target = process.env.OPENCLAW_STATE_DIR || join(HOME, '.openclaw');
      platform = 'openclaw';
      break;
  }

  const openclawDir = target || join(HOME, '.openclaw');
  const sofagentData = resolveSofagentData(openclawDir);

  // ── banner + 平台信息 ──
  v.printBanner();
  v.printPlatformInfo(platform, target || '工作区');

  // ════════════════════════════════════════
  // --quick 模式：仅 4 项核心检查
  // ════════════════════════════════════════
  if (args.quick) {
    if (!args.json && !args.quiet) console.log('  ⚡ 快速模式 — 4 项核心检查');
    v.hr();

    // 1. SKILL.md 存在且含宪法关键词
    const skillQuick = join(openclawDir, 'skills', 'sofagent', 'SKILL.md');
    const skillContent = readFileContent(skillQuick);
    if (existsSync(skillQuick) && (/4.*底线|6.*铁律/.test(skillContent))) {
      v.checkPass('SKILL.md 存在且含宪法（4底线+6则铁律）');
    } else {
      v.checkFail('SKILL.md 缺失或宪法关键词不全');
    }

    // 2. .sofagent/ 数据目录存在
    if (existsSync(sofagentData)) {
      v.checkPass('.sofagent/ 数据目录存在');
    } else {
      v.checkWarn('.sofagent/ 数据目录不存在（首次使用会自动创建）');
    }

    // 3. ao compose 可用
    if (commandAvailable('ao')) {
      const aoVer = tryExec('ao', ['--version']) || 'unknown';
      v.checkPass(`ao compose 可用 — v${aoVer}`);
    } else {
      v.checkWarn('ao compose 不可用——编排引擎降级为默认编排');
    }

    // 4. fde.md 可读
    let rulesQuick = '';
    const fdeCandidates = [
      join(openclawDir, 'skills', 'sofagent', 'fde.md'),
      join(HOME, '.workbuddy', 'skills', 'sofagent', 'fde.md'),
      join(HOME, '.openclaw', 'fde.md'),
    ];
    for (const c of fdeCandidates) {
      if (existsSync(c)) { rulesQuick = c; break; }
    }
    if (rulesQuick && existsSync(rulesQuick)) {
      try { readFileSync(rulesQuick, 'utf-8'); v.checkPass(`fde.md 可读 — ${rulesQuick}`); }
      catch { v.checkWarn('fde.md 未找到或不可读（未配置自定义规则）'); }
    } else {
      v.checkWarn('fde.md 未找到或不可读（未配置自定义规则）');
    }

    // 输出总结并退出
    if (args.json) {
      v.outputJson();
    } else {
      v.outputSummary();
      if (v.failTotal === 0) {
        console.log('  ✅ quick 模式通过！运行 sofagent-verify（无 --quick）获取完整检查。');
      } else {
        console.log(`  ❌ 发现 ${v.failTotal} 项失败。请先运行 install.sh 修复。`);
      }
      console.log('');
    }
    process.exit(v.failTotal > 0 ? 1 : 0);
  }

  // ════════════════════════════════════════
  // WorkBuddy 平台专属检查（5 项后直接退出）
  // ════════════════════════════════════════
  if (platform === 'workbuddy') {
    v.checkPass('WorkBuddy 平台——宪法/Hook/断路器由 SKILL.md 入口流程管理');

    // SKILL.md 已部署+含宪法
    const wbSkill = join(HOME, '.workbuddy', 'skills', 'sofagent', 'SKILL.md');
    if (existsSync(wbSkill) && statSync(wbSkill).size > 0) {
      const content = readFileContent(wbSkill);
      if (/4 底线|6 则铁律/.test(content)) {
        v.checkPass('SKILL.md 已部署且含宪法（4底线+6则铁律内联）');
      } else {
        v.checkWarn('SKILL.md 已部署但宪法内容缺失');
      }
    } else {
      v.checkWarn('SKILL.md 未部署到 ~/.workbuddy/skills/sofagent/');
    }

    // fde.md 已部署+字符数
    const wbRules = join(HOME, '.workbuddy', 'fde.md');
    if (existsSync(wbRules) && statSync(wbRules).size > 0) {
      const chars = countChars(wbRules);
      v.checkPass(`fde.md 已部署（${chars} 字符）`);
    } else {
      v.checkWarn('fde.md 未部署到 ~/.workbuddy/');
    }

    // Skills 目录 .md 文件数
    const wbSkillsDir = join(HOME, '.workbuddy', 'skills', 'sofagent');
    if (existsSync(wbSkillsDir)) {
      const count = countFilesInDir(wbSkillsDir, '.md');
      v.checkPass(`Skills 目录已部署（${count} 个 .md 文件）`);
    } else {
      v.checkWarn('Skills 目录不存在');
    }

    // .sofagent/ 目录存在
    if (existsSync(sofagentData)) {
      v.checkPass('.sofagent/ 数据目录存在');
    } else {
      v.checkWarn('.sofagent/ 数据目录不存在（首次使用会自动创建）');
    }

    // 输出总结并退出
    if (args.json) {
      v.outputJson();
    } else {
      v.outputSummary();
      if (v.failTotal === 0) {
        console.log('  ✅ sofagent WorkBuddy 部署验证通过！');
        console.log('');
        console.log('  下一步:');
        console.log('    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）');
        console.log('    2. 试用 /goal 命令开始第一个任务');
      } else {
        console.log(`  ❌ 发现 ${v.failTotal} 项失败。请先运行 install.sh 修复。`);
      }
      console.log('');
    }
    process.exit(v.failTotal > 0 ? 1 : 0);
  }

  // ════════════════════════════════════════
  // §1 宪法文件（fde.md）
  // ════════════════════════════════════════
  v.section('宪法文件（v0.62：宪法内联在 SKILL.md，此处只检查 fde.md）');

  {
    const f = 'fde.md';
    let rulesPath = join(openclawDir, 'skills', 'sofagent', f);
    if (!existsSync(rulesPath)) {
      rulesPath = join(openclawDir, f); // 兼容旧版安装路径
    }
    if (existsSync(rulesPath) && statSync(rulesPath).size > 0) {
      const chars = countChars(rulesPath);
      const lines = countLines(rulesPath);
      v.checkPass(`${f} (${chars} 字符, ${lines} 行)`);

      // 权限检查：宪法文件不应 world-writable
      const perms = getFileMode(rulesPath);
      const lastDigit = perms.slice(-1);
      if (['7', '6', '3', '2'].includes(lastDigit)) {
        v.checkWarn(`${f} 权限过于宽松 (${perms})，建议 chmod 644`);
      }

      // 500 字原则（宪法层因含铁律+底线，阈值放宽至 1200）
      if (chars > 1200) {
        v.checkWarn(`${f} 超过 1200 字符（${chars}），宪法层因含 6 则铁律 + 4 条底线，阈值放宽至 1200`);
      }
    } else {
      v.checkFail(`${f} — 缺失或为空`);
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §2 Skill 文件
  // ════════════════════════════════════════
  v.section('Skill 文件');

  {
    const skillsDir = join(openclawDir, 'skills');
    if (existsSync(skillsDir)) {
      const skillCount = countFilesInDir(skillsDir, '.md');
      v.checkPass(`Skills 目录存在: ${skillCount} 个 .md 文件`);
    } else {
      v.checkFail(`Skills 目录不存在: ${skillsDir}`);
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §3 配套脚本
  // ════════════════════════════════════════
  v.section('配套脚本');

  {
    const scriptsDir = join(openclawDir, 'scripts');
    if (existsSync(scriptsDir)) {
      const scriptCount = countFilesInDir(scriptsDir, '.sh');
      v.checkPass(`scripts/ 目录存在: ${scriptCount} 个 .sh 文件`);

      const taskRecord = join(scriptsDir, 'task-record.sh');
      if (existsSync(taskRecord) && isExecutable(taskRecord)) {
        v.checkPass('  task-record.sh 已部署且可执行');
      } else {
        v.checkWarn('  task-record.sh 缺失或不可执行');
      }
    } else {
      v.checkWarn('scripts/ 目录不存在，部分功能可能不可用');
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §4 加载链 Hook（仅 openclaw 平台）
  // ════════════════════════════════════════
  v.section('加载链 Hook（2026.6.x 内部 hook）');

  if (platform !== 'openclaw') {
    v.checkPass(`${platform} 平台无需内部 hook（靠 skill 系统 / 种子指令加载）`);
  } else {
    // hook 目录文件
    const hookDir = join(openclawDir, 'hooks', 'sofagent-load-chain');
    let hookFilesOk = 0;
    if (existsSync(join(hookDir, 'HOOK.md'))) hookFilesOk++;
    if (existsSync(join(hookDir, 'handler.ts'))) hookFilesOk++;

    if (hookFilesOk === 2) {
      v.checkPass('hook 目录就绪: hooks/sofagent-load-chain/（HOOK.md + handler.ts）');
    } else {
      v.checkFail(`hook 文件缺失（期望 HOOK.md + handler.ts，实际 ${hookFilesOk}/2）`);
    }

    // openclaw.json 注册
    const ocConfig = join(openclawDir, 'openclaw.json');
    if (existsSync(ocConfig)) {
      const configContent = readFileContent(ocConfig);
      if (configContent.includes('sofagent-load-chain')) {
        v.checkPass('openclaw.json 已注册 sofagent-load-chain hook');
      } else {
        v.checkWarn('openclaw.json 未注册 sofagent-load-chain（加载链第 2、3 层不会自动注入）');
      }
    } else {
      v.checkWarn('openclaw.json 不存在（hook 注册无从检查）');
    }

    // fde.md 权威路径
    const rulesAuthority = join(openclawDir, 'skills', 'sofagent', 'fde.md');
    if (existsSync(rulesAuthority)) {
      v.checkPass(`fde.md 权威路径就绪（${countChars(rulesAuthority)} 字符）`);
    } else {
      v.checkWarn(`fde.md 未部署到权威路径（${rulesAuthority}）`);
      // 兼容检查：老版本部署到 ~/.openclaw/fde.md
      const legacyRules = join(openclawDir, 'fde.md');
      if (existsSync(legacyRules)) {
        v.checkWarn(`  发现遗留路径（${legacyRules}）——建议运行 install.sh 升级到 v0.73 扁平化路径`);
      }
      // v0.71-0.72 残留
      const legacyConst = join(openclawDir, 'skills', 'sofagent', 'constitution', 'fde.md');
      if (existsSync(legacyConst)) {
        v.checkWarn(`  发现 v0.72 前安装残留（${legacyConst}）——建议运行 install.sh 升级，旧路径将自动迁移`);
      }
    }

    // think.md 检查
    const thinkFile = join(sofagentData, 'think.md');
    if (existsSync(thinkFile)) {
      v.checkPass(`think.md 存在（${countChars(thinkFile)} 字符）`);
    } else {
      v.checkWarn('think.md 不存在（首次运行后由 B1 创建）');
    }

    // handler.ts 回归验证：扫描 OpenClaw 日志
    const logDir = join(openclawDir, 'logs');
    if (existsSync(logDir)) {
      const recentLogs = findRecentFiles(logDir, /\.(log|jsonl)$/, 30);
      if (recentLogs.length > 0) {
        let hookTriggered = false;
        let layer2Found = false;
        let layer3Found = false;

        for (const logFile of recentLogs.slice(0, 5)) {
          const logContent = readFileContent(logFile);
          if (logContent.includes('sofagent-load-chain')) hookTriggered = true;
          if (logContent.includes('think.md')) layer2Found = true;
          // bash 里写的是 rules.md，实际 fde.md 是权威文件——保留原行为
          if (logContent.includes('rules.md') || logContent.includes('fde.md')) layer3Found = true;
          if (hookTriggered && layer2Found && layer3Found) break;
        }

        if (hookTriggered) {
          v.checkPass('handler.ts 回归：sofagent-load-chain hook 已被触发');
          if (layer2Found && layer3Found) {
            v.checkPass('handler.ts 回归：第 2/3 层出现在注入列表中');
          } else {
            const missingLayers: string[] = [];
            if (!layer2Found) missingLayers.push('第2层(think.md)');
            if (!layer3Found) missingLayers.push('第3层(fde.md)');
            v.checkWarn(`handler.ts 回归：${missingLayers.join(', ')}未在注入列表中出现`);
            v.checkWarn('handler.ts 回归：日志格式可能已变化（字符串匹配依赖固定格式），如使用非标准 OpenClaw 版本请手动确认加载链是否生效');
          }
        } else {
          v.checkWarn('handler.ts 回归：sofagent-load-chain hook 在最近日志中未检测到触发');
        }
      } else {
        v.checkWarn('handler.ts 回归：最近 30 天无 OpenClaw 日志，跳过');
      }
    } else {
      v.checkPass('handler.ts 回归：OpenClaw 日志目录不存在，跳过（非 OpenClaw 平台或未启动过）');
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §5 外部依赖
  // ════════════════════════════════════════
  v.section('外部依赖');

  if (commandAvailable('ao')) {
    const aoVer = tryExec('ao', ['--version']) || 'unknown';
    v.checkPass(`agency-orchestrator (ao) 可用 — v${aoVer}`);

    // ao compose 健康检查
    const aoComposeOut = tryExec('ao', ['compose', '--version']);
    if (aoComposeOut) {
      v.checkPass('ao compose 健康检查通过');
    } else {
      v.checkWarn('ao compose --version 失败——编排引擎可能不可用（约束层不受影响）');
    }

    // ao 版本下限检查（install.sh pin agency-orchestrator@0.7.5）
    const aoClean = aoVer.replace(/^v/, '');
    const aoParts = aoClean.split('.');
    const aoMajor = parseInt(aoParts[0] || '0', 10) || 0;
    const aoMinor = parseInt(aoParts[1] || '0', 10) || 0;
    const aoPatch = parseInt(aoParts[2] || '0', 10) || 0;
    if (aoMajor === 0 && (aoMinor < 7 || (aoMinor === 7 && aoPatch < 5))) {
      v.checkWarn(`ao 版本低于 0.7.5（当前 ${aoVer}），建议升级：npm install -g agency-orchestrator@0.7.5`);
    }

    // 烟雾测试：ao 能否列出角色
    const rolesOut = tryExec('ao', ['roles']);
    if (rolesOut) {
      const roleLines = rolesOut.split('\n').filter(line => line.includes('|')).length;
      if (roleLines > 10) {
        v.checkPass(`ao 角色库正常 (${roleLines}+ 角色)`);
      } else {
        v.checkPass('ao 角色库可用（输出格式可能已变化，无法精确计数）');
      }
    } else {
      v.checkWarn('ao 角色库异常或未初始化，运行 ao init 初始化');
    }
  } else {
    v.checkWarn('ao 命令不可用 — 编排功能将不可用');
  }

  if (commandAvailable('node')) {
    const nodeVer = tryExec('node', ['--version']) || '?';
    v.checkPass(`Node.js ${nodeVer}`);
  } else {
    v.checkFail('Node.js 不可用');
  }

  v.hr();

  // ════════════════════════════════════════
  // §6 平台兼容性
  // ════════════════════════════════════════
  v.section('平台兼容性');

  // OpenClaw
  if (commandAvailable('openclaw')) {
    const ocPath = tryExec('which', ['openclaw']) || '';
    const ocVer = tryExec('openclaw', ['--version']) || '?';
    if (ocPath.includes('.workbuddy')) {
      v.checkPass(`OpenClaw v${ocVer}（WorkBuddy 内嵌）`);
    } else {
      v.checkPass(`OpenClaw 已安装: v${ocVer}`);
    }
  } else {
    v.checkWarn('OpenClaw 未检测到 — 加载链 Hook 需手动注册');
  }

  // WorkBuddy
  if (existsSync(join(HOME, '.workbuddy')) || process.env.WORKBUDDY_DIR) {
    v.checkPass('WorkBuddy 环境已检测');
  } else {
    v.checkWarn('WorkBuddy 未检测 — 如不使用请忽略');
  }

  // Claude Code
  if (commandAvailable('claude')) {
    const ccVer = tryExec('claude', ['--version']) || '?';
    v.checkPass(`Claude Code CLI 已安装: v${ccVer}`);
  } else if (commandAvailable('claude-code')) {
    v.checkPass('Claude Code 已安装');
  } else {
    v.checkWarn('Claude Code 未检测 — 如不使用请忽略');
  }

  // Codex
  if (commandAvailable('codex')) {
    v.checkPass('Codex CLI 已安装');
  } else {
    v.checkWarn('Codex 未检测 — 如不使用请忽略');
  }

  // Hermes
  if (commandAvailable('hermes')) {
    v.checkPass('Hermes CLI 已安装');
  } else {
    v.checkWarn('Hermes 未检测 — 如不使用请忽略');
  }

  v.hr();

  // ════════════════════════════════════════
  // §7 数据目录
  // ════════════════════════════════════════
  v.section('数据目录');

  if (existsSync(sofagentData)) {
    v.checkPass('.sofagent/ 数据目录存在');
    for (const sub of ['task', 'logs', 'orchestrator']) {
      const subDir = join(sofagentData, sub);
      if (existsSync(subDir)) {
        v.checkPass(`  .sofagent/${sub}/ 就绪`);
      } else {
        v.checkWarn(`  .sofagent/${sub}/ 缺失`);
      }
    }
  } else {
    v.checkWarn('.sofagent/ 数据目录不存在（首次使用会自动创建）');
  }

  v.hr();

  // ════════════════════════════════════════
  // §8 断路器配置
  // ════════════════════════════════════════
  v.section('断路器配置');

  {
    const configFile = join(openclawDir, 'config.json');
    const hasJq = commandAvailable('jq');

    if (hasJq) {
      v.checkPass('jq 可用');

      if (existsSync(configFile)) {
        // 用 jq 检查 loopDetection.enabled
        const enabledCheck = tryExec('jq', ['-e', '.tools.loopDetection.enabled', configFile]);
        if (enabledCheck !== null) {
          v.checkPass('loopDetection 已启用');

          // 检查检测器
          for (const d of ['genericRepeat', 'pingPong', 'knownPollNoProgress']) {
            const detectorCheck = tryExec('jq', ['-e', `.tools.loopDetection.detectors.${d}`, configFile]);
            if (detectorCheck !== null) {
              v.checkPass(`  检测器 ${d}: 已激活`);
            } else {
              v.checkWarn(`  检测器 ${d}: 未启用`);
            }
          }

          // 阈值检查
          const threshold = tryExec('jq', ['-r', '.tools.loopDetection.globalCircuitBreakerThreshold', configFile]) || '?';
          v.checkPass(`  全局熔断阈值: ${threshold} 步`);
        } else {
          v.checkFail('loopDetection 未配置或未启用');
        }
      } else {
        v.checkWarn('config.json 不存在，请运行 install.sh');
      }
    } else {
      v.checkWarn('jq 不可用，跳过 loopDetection 检查');
      if (existsSync(configFile)) {
        const configContent = readFileContent(configFile);
        if (configContent.includes('loopDetection')) {
          v.checkPass('loopDetection 配置存在（grep 检测）');
        } else {
          v.checkWarn('无法确认 loopDetection 状态（安装 jq 以获得完整验证）');
        }
      } else {
        v.checkWarn('无法确认 loopDetection 状态（安装 jq 以获得完整验证）');
      }
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §9 约束实效验证
  // ════════════════════════════════════════
  if (platform !== 'workbuddy') {
    v.printBoldYellow('约束验证');
  }

  // 9.1 SKILL.md 宪法关键词完整性
  {
    const skillFile = join(openclawDir, 'skills', 'sofagent', 'SKILL.md');
    if (existsSync(skillFile)) {
      const content = readFileContent(skillFile);
      if (/4.*底线|6.*铁律/.test(content)) {
        v.checkPass('契约层关键词完整（4底线+6则铁律内联在 SKILL.md）');
      } else {
        v.checkFail('SKILL.md 内容异常——宪法关键词缺失');
      }
    } else {
      v.checkWarn('SKILL.md 不存在，无法验证宪法内容');
    }
  }

  // 9.2 闸门通过率——最近7天任务记录数
  {
    const taskLogsDir = join(sofagentData, 'task', 'logs');
    if (existsSync(taskLogsDir)) {
      const recentTasks = findRecentFiles(taskLogsDir, /\.md$/, 7);
      if (recentTasks.length > 0) {
        v.checkPass(`最近7天有 ${recentTasks.length} 条任务记录`);
      } else {
        v.checkWarn('最近7天无任务记录——数据层可能空转');
      }
    } else {
      v.checkWarn('task/logs/ 目录不存在——尚未运行过任务');
    }
  }

  // 9.3 反思更新频率
  {
    const thinkFile = join(sofagentData, 'think.md');
    if (existsSync(thinkFile)) {
      try {
        const stat = statSync(thinkFile);
        const modifiedMs = Date.now() - stat.mtimeMs;
        const modifiedDays = Math.floor(modifiedMs / 86400_000);
        if (modifiedDays <= 3) {
          v.checkPass(`think.md ${modifiedDays} 天前更新（活跃）`);
        } else if (modifiedDays <= 14) {
          v.checkWarn(`think.md ${modifiedDays} 天前更新（较不活跃）`);
        } else {
          v.checkWarn(`think.md ${modifiedDays} 天前更新——闭环可能未正常运转`);
        }
      } catch {
        v.checkWarn('think.md 不可读');
      }
    } else {
      v.checkWarn('think.md 不存在——尚未触发过闭环反思');
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §10 企业合规验证
  // ════════════════════════════════════════
  v.printBoldYellow('企业合规');

  // 确定脚本目录（verify.sh 里的 VERIFY_SCRIPT_DIR）
  const verifyScriptDir = join(__dirname, '..', '..'); // dist/ → repo root → scripts parent
  const scriptsLibDir = join(verifyScriptDir, 'scripts', 'lib');

  // 10.1 config.sh 共享配置加载器存在
  {
    const configSh = join(scriptsLibDir, 'config.sh');
    if (existsSync(configSh)) {
      v.checkPass('config.sh 共享配置加载器存在');
    } else {
      // 也检查 scripts/ 同级
      const altConfigSh = join(verifyScriptDir, 'scripts', 'config.sh');
      if (existsSync(altConfigSh)) {
        v.checkPass('config.sh 共享配置加载器存在');
      } else {
        v.checkWarn('config.sh 不存在');
      }
    }
  }

  // 10.2 脱敏函数验证（6 条正则测试）
  {
    // 测试 1: API Key 打码
    const sanitySk = testSanitize('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
    if (sanitySk.includes('REDACTED')) {
      v.checkPass('脱敏: API Key 打码正常 (sk- → sk-***REDACTED***)');
    } else {
      v.checkFail('脱敏: API Key 未打码');
    }

    // 测试 2: 凭证打码
    const sanityPwd = testSanitize('password=mysecret123');
    if (sanityPwd.includes('REDACTED') && !sanityPwd.includes('mysecret123')) {
      v.checkPass('脱敏: 凭证打码正常 (password= → password=***REDACTED***)');
    } else {
      v.checkFail('脱敏: 凭证未打码');
    }

    // 测试 3: 手机号打码
    const sanityPhone = testSanitize('用户电话 13812345678 请回拨');
    if (sanityPhone.includes('PHONE-REDACTED') && !sanityPhone.includes('13812345678')) {
      v.checkPass('脱敏: 手机号打码正常 (1[3-9]xxxxxxxxx → [PHONE-REDACTED])');
    } else {
      v.checkFail('脱敏: 手机号未打码');
    }

    // 测试 4: 11 位订单号不误伤
    const sanityNoFalsePositive = testSanitize('订单号 28012345678 已生成');
    if (!sanityNoFalsePositive.includes('PHONE-REDACTED')) {
      v.checkPass('脱敏: 11 位订单号（非 1[3-9] 开头）未被误伤');
    } else {
      v.checkWarn('脱敏: 11 位订单号被误伤（可能误打码）');
    }

    // 测试 5: 词边界防误伤——monkey=foo 不应被打码
    const sanityKeyword = testSanitize('monkey=foo 这是任务名');
    if (!sanityKeyword.includes('REDACTED')) {
      v.checkPass('脱敏: 词边界保护（monkey=foo 不被误伤）');
    } else {
      v.checkWarn('脱敏: 词边界失效（monkey=foo 被误伤）');
    }

    // 测试 6: 普通文本原样通过
    const sanityPass = testSanitize('普通文本无敏感信息');
    if (sanityPass === '普通文本无敏感信息') {
      v.checkPass('脱敏: 无敏感信息文本原样通过');
    } else {
      v.checkWarn('脱敏: 无敏感信息文本被修改');
    }
  }

  // 10.3 cleanup.sh 存在性检查
  {
    const cleanupScript = join(verifyScriptDir, 'scripts', 'cleanup.sh');
    if (existsSync(cleanupScript) && isExecutable(cleanupScript)) {
      v.checkPass('cleanup.sh 存在且可执行');
      const cleanupHelp = tryExec('bash', [cleanupScript, '--help']);
      if (cleanupHelp && cleanupHelp.includes('dry-run')) {
        v.checkPass('cleanup.sh --dry-run 参数可用');
      } else {
        v.checkWarn('cleanup.sh --dry-run 参数不可用');
      }
    } else {
      v.checkFail('cleanup.sh 缺失或不可执行');
    }
  }

  // 10.4 audit.sh 存在性检查
  {
    const auditScript = join(verifyScriptDir, 'scripts', 'audit.sh');
    if (existsSync(auditScript) && isExecutable(auditScript)) {
      v.checkPass('audit.sh 存在且可执行');
      const auditHelp = tryExec('bash', [auditScript, '--help']);
      if (auditHelp && auditHelp.includes('operation')) {
        v.checkPass('audit.sh --operation 参数可用');
      } else {
        v.checkWarn('audit.sh --operation 参数不可用');
      }
    } else {
      v.checkFail('audit.sh 缺失或不可执行');
    }
  }

  // 10.5 默认关闭确认
  {
    const sofaSanitize = process.env.SOFA_SANITIZE;
    const sofaAuditEnabled = process.env.SOFA_AUDIT_ENABLED;
    const sofaCleanupOnRecord = process.env.SOFA_CLEANUP_ON_RECORD;

    if (sofaSanitize !== 'true' && sofaAuditEnabled !== 'true' && sofaCleanupOnRecord !== 'true') {
      v.checkPass('默认关闭: 合规功能全部关闭（向后兼容）');
    } else {
      if (sofaSanitize === 'true') {
        v.checkWarn('脱敏已启用 (log_sanitize=true)');
      }
      if (sofaAuditEnabled === 'true') {
        v.checkWarn('审计已启用 (audit_enabled=true)');
      }
      if (sofaCleanupOnRecord === 'true') {
        v.checkWarn('清理触发已启用 (data_cleanup_on_record=true)');
      }
    }
  }

  // 10.6 fde.md 合规配置段完整性
  {
    const complianceKeys = [
      'log_sanitize',
      'log_sanitize_ips',
      'data_retention_days',
      'data_retention_max_entries',
      'data_cleanup_on_record',
      'data_cleanup_frequency',
      'audit_enabled',
    ];

    let rulesFile = '';
    const candidates = [
      join(process.cwd(), 'sofagent', 'skill', 'fde.md'),
      join(HOME, '.openclaw', 'skills', 'sofagent', 'fde.md'),
      join(HOME, '.workbuddy', 'skills', 'sofagent', 'fde.md'),
      join(process.cwd(), 'sofagent', 'skill', 'constitution', 'fde.md'),
      join(HOME, '.openclaw', 'skills', 'sofagent', 'constitution', 'fde.md'),
      join(HOME, '.workbuddy', 'skills', 'sofagent', 'constitution', 'fde.md'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) { rulesFile = c; break; }
    }

    if (rulesFile) {
      const content = readFileContent(rulesFile);
      let missing = 0;
      for (const key of complianceKeys) {
        if (!content.includes(`${key}:`)) {
          missing++;
        }
      }
      if (missing === 0) {
        v.checkPass('fde.md 合规配置段完整（7/7 配置项）');
      } else {
        v.checkWarn(`fde.md 合规配置段不完整（缺少 ${missing}/7 项）`);
      }
    } else {
      v.checkWarn('fde.md 未找到，无法验证合规配置段');
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // §11 daemon 状态检查
  // ════════════════════════════════════════
  if (!args.json && !args.quiet) console.log('');
  v.printBoldYellow('daemon 状态');

  {
    const daemonPidFile = join(sofagentData, 'daemon.pid');
    const daemonJson = join(sofagentData, 'daemon.json');

    // daemon.sh 安装位置
    let daemonScript = join(openclawDir, 'scripts', 'daemon.sh');
    if (!existsSync(daemonScript)) {
      daemonScript = join(process.cwd(), 'sofagent', 'scripts', 'daemon.sh');
    }

    if (existsSync(daemonScript)) {
      v.checkPass('daemon.sh 已安装');

      // daemon 是否运行
      if (existsSync(daemonPidFile)) {
        const daemonPidStr = readFileContent(daemonPidFile).trim();
        const daemonPid = parseInt(daemonPidStr, 10);
        if (daemonPid && daemonPid > 0) {
          // 用 kill -0 检查进程存活
          try {
            process.kill(daemonPid, 0);
            v.checkPass(`daemon 运行中 (PID ${daemonPid})`);
          } catch {
            v.checkWarn('daemon PID 文件存在但进程未运行（可能已崩溃）');
          }
        } else {
          v.checkWarn('daemon PID 文件存在但进程未运行（可能已崩溃）');
        }
      } else {
        v.checkWarn('daemon 未运行（可选功能，不影响约束层）——运行 daemon.sh start 启动');
      }

      // daemon.json 可读
      if (existsSync(daemonJson)) {
        try {
          readFileSync(daemonJson, 'utf-8');
          v.checkPass('daemon.json 可读');
        } catch {
          if (existsSync(daemonPidFile)) {
            v.checkWarn('daemon.json 不可读');
          }
        }
      } else if (existsSync(daemonPidFile)) {
        v.checkWarn('daemon.json 不可读');
      }
    } else {
      v.checkWarn('daemon.sh 未安装（可选功能）——运行 daemon-install.sh 安装');
    }
  }

  v.hr();

  // ════════════════════════════════════════
  // 总结
  // ════════════════════════════════════════
  if (args.json) {
    v.outputJson();
  } else {
    v.outputSummary();

    if (v.failTotal === 0) {
      if (!args.quiet) {
        console.log('  ✅ sofagent 安装验证通过！');
        console.log('');
        switch (platform) {
          case 'openclaw':
            console.log('  下一步:');
            console.log('    1. 注册 before_prompt_build Hook（见 install.sh 输出）');
            console.log('    2. 启动 OpenClaw，检查 system prompt 是否包含 sofagent 底线规则');
            console.log('    3. 运行 ao compose 测试编排是否正常');
            break;
          case 'workbuddy':
            console.log('  下一步:');
            console.log('    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）');
            console.log('    2. 试用 /goal 命令开始第一个任务');
            break;
          case 'claude':
          case 'codex':
          case 'hermes':
            console.log('  下一步:');
            console.log('    1. 将种子指令粘贴到配置文件（见 install.sh 输出）');
            console.log('    2. 在下一轮对话中回复「sofagent」验证加载');
            break;
        }
        console.log('');
        console.log('  📊 纪律层占用：~3,000 token（128K 窗口的 2.5%）');
        console.log('');
      } else if (v.passTotal > 0) {
        console.log(`  ✅ ${v.passTotal} 项全部通过`);
        console.log('');
      }
    } else {
      console.log(`  ❌ 发现 ${v.failTotal} 项失败。请先运行 install.sh 修复。`);
      console.log('');
    }
  }

  process.exit(v.failTotal > 0 ? 1 : 0);
}

main();
