// ============================================================
// init.ts · sofagent-audit --init 一键初始化
// v1.3 新增：一条命令完成 3 步
//   1. 生成 .sofagent/config.yml 配置模板
//   2. 安装 git commit-msg hook
//   3. 冒烟测试——验证审计引擎可用
// v1.3.5: 新增仓库状态分类器（gstack 首次运行引导）
// v1.3.5 daemon 注册改为「确认后注册」——默认不装、非 TTY 不挂起、
//   已有 plist 询问不静默覆盖、npx 场景如实报错（不生成坏 plist、不打印假成功）、
//   修正 plist 路径前缀 sofagent/daemon/ → engine/daemon/。
// v1.2.5 --init 自动生成 HMAC 密钥（~/.sofagent-key，权限 600），
//   审计历史默认启用 HMAC-SHA256 强校验。
// ============================================================

import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync, appendFileSync, readSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync, execSync } from 'child_process';
import { homedir, platform } from 'os';
import { randomBytes } from 'crypto';
import { isatty } from 'tty';
import { CONFIG_TEMPLATE, HOOK_TEMPLATE, VERSION, generateWatchTemplate, resolveKnowledgeDir, resolveDaemonLog } from '@sofagent/core';
import { writeConfig } from '@sofagent/core';
import { defaultRules } from '../rules';

/**
 * 仓库状态分类（v1.0.5 新增）
 * 来源：gstack 的 bin/gstack-first-task-detect
 */
type RepoState = 'greenfield' | 'has_code' | 'has_uncommitted' | 'dirty' | 'clean';

/**
 * 确保 .sofagent/ 被 .gitignore 排除
 * v1.0.7 新增——防止首次 commit 时 A3 越界告警
 */
export function ensureGitignore(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.sofagent/';

  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  // 检查是否已包含
  if (content.includes('.sofagent/')) return;

  // 追加（带注释）
  const addition = content.endsWith('\n') || content === ''
    ? `\n# sofagent 审计数据（本地配置 + 知识库 + 审计历史）\n${entry}\n`
    : `\n\n# sofagent 审计数据（本地配置 + 知识库 + 审计历史）\n${entry}\n`;

  appendFileSync(gitignorePath, addition);
  console.log('  sofagent: .gitignore 已更新（排除 .sofagent/）');
}

function classifyRepo(): { state: RepoState; hint: string } {
  // 0. 检测是否在 git 仓库中
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
  } catch {
    return {
      state: 'greenfield',
      hint: '⚠️ 当前目录不是 git 仓库——sofagent 的审计基于 git diff，请先 git init 后再跑 --init。',
    };
  }

  // 1. 检测是否有 commit 历史
  let hasCommits = true;
  try { execFileSync('git', ['rev-parse', 'HEAD'], { stdio: 'pipe' }); } catch { hasCommits = false; }
  if (!hasCommits) {
    return {
      state: 'greenfield',
      hint: '📋 新仓库——sofagent 会从第一次 commit 开始审计。建议先跑 FORGE/playbook/acceptance-test.sh 验证安装。',
    };
  }

  // 2. 检测是否有未提交更改
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8', stdio: 'pipe' });
    if (status.trim().length > 0) {
      return {
        state: 'dirty',
        hint: '⚠️ 有未提交更改——请先 git commit 或 git stash 后再跑 --init，否则 commit-msg hook 可能误报。',
      };
    }
  } catch { /* 非 git 仓库，已在前面处理 */ }

  // 3. 检测是否有代码文件
  try {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf-8', stdio: 'pipe' });
    if (files.trim().length === 0) {
      return {
        state: 'greenfield',
        hint: '📋 新仓库——sofagent 会从第一次 commit 开始审计。建议先跑 FORGE/playbook/acceptance-test.sh 验证安装。',
      };
    }
  } catch { /* */ }

  return {
    state: 'has_code',
    hint: '📋 已有代码仓库——sofagent 会审计未来的 commit。历史 commit 不会追溯（除非手动跑 --diff）。',
  };
}

// ────────────────────────────────────────────────────────────
// 交互式确认（非 TTY 默认 N，不挂起）
// ────────────────────────────────────────────────────────────

/** 是否处于可交互终端（stdin 与 stdout 均为 TTY 才提示，避免脚本/CI 挂起） */
function isInteractive(): boolean {
  try {
    return process.stdin.isTTY === true && process.stdout.isTTY === true && isatty(0);
  } catch {
    return false;
  }
}

/**
 * 同步 y/N 确认。
 * 非交互（脚本/CI/npx 管道）→ 直接返回默认值，绝不等待 stdin。
 * @param question 提示语
 * @param defaultValue 默认值（'y' | 'n'）
 */
function promptYesNoSync(question: string, defaultValue: 'y' | 'n'): boolean {
  if (!isInteractive()) return defaultValue === 'y';
  process.stdout.write(`${question}（${defaultValue === 'y' ? 'Y/n' : 'y/N'}，默认 ${defaultValue === 'y' ? '是' : '否'}）: `);
  try {
    const buf = Buffer.alloc(64);
    const n = readSync(0, buf, 0, buf.length, null);
    const answer = buf.toString('utf-8', 0, n).trim().toLowerCase();
    if (answer === '') return defaultValue === 'y';
    return answer === 'y' || answer === 'yes';
  } catch {
    return defaultValue === 'y';
  }
}

/** 从 plist XML 中提取首个 <string> 内容（展示旧 daemon 指向用） */
function extractFirstPlistString(plistContent: string): string | null {
  const m = plistContent.match(/<string>([^<]*)<\/string>/);
  return m?.[1] ?? null;
}

// ────────────────────────────────────────────────────────────
// daemon 注册（确认后注册 + 路径修正 + 已有 plist 询问 + npx 如实报错）
// ────────────────────────────────────────────────────────────

/**
 * 解析 daemon 可执行入口。
 * 解析链：全局 sofagent-daemon → sofagent-audit 同 bin 目录下的 sofagent-daemon
 * → 项目内 engine/daemon/dist/cli.js（v1.2.5 修正：旧前缀 sofagent/daemon/ 已废弃）。
 * @returns { cliPath, args }——cliPath 为可执行文件绝对路径或 'node'（配合 args[0] 指向 dist）
 *         解析失败返回 null（npx 等未安装场景 → 如实报错，不生成坏 plist）
 */
function resolveDaemonEntry(cwd: string): { cliPath: string; args: string[] } | null {
  const candidates: string[] = [];

  // 1. 全局 sofagent-daemon
  try {
    const cmd = platform() === 'win32' ? 'where sofagent-daemon' : 'which sofagent-daemon';
    const p = (execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]) || '';
    if (p) candidates.push(p);
  } catch { /* 未安装 */ }

  // 2. sofagent-audit 同 bin 目录下的 sofagent-daemon
  try {
    const cmd = platform() === 'win32' ? 'where sofagent-audit' : 'which sofagent-audit';
    const auditPath = (execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0]) || '';
    const auditBinDir = auditPath.substring(0, auditPath.lastIndexOf('/'));
    const candidateDaemon = `${auditBinDir}/sofagent-daemon`;
    if (existsSync(candidateDaemon)) candidates.push(candidateDaemon);
  } catch { /* 未安装 */ }

  // 3. 项目内 engine/daemon/dist/cli.js（v1.2.5 修正前缀：旧结构 sofagent/daemon/ 已搬迁到 engine/daemon/）
  const projectDaemonEntry = join(cwd, 'engine', 'daemon', 'dist', 'cli.js');
  if (existsSync(projectDaemonEntry)) {
    const nodeBinDir = dirname(process.execPath);
    return {
      cliPath: nodeBinDir ? join(nodeBinDir, 'node') : 'node',
      args: [projectDaemonEntry, 'start'],
    };
  }

  // 4. 全局入口存在 → 用其绝对路径 + 'start'
  const globalEntry = candidates.find((p) => existsSync(p));
  if (globalEntry) {
    return { cliPath: globalEntry, args: ['start'] };
  }

  // 全部落空 → daemon 未安装（npx / 未全局安装场景）
  return null;
}

/**
 * 注册 macOS LaunchAgent(修复版）：
 *  - 已有 plist 时先询问是否覆盖（默认不覆盖，不静默卸载）
 *  - daemon 未安装（npx 场景）时如实报错，不生成坏 plist、不打印假成功
 */
function registerDaemon(cwd: string): void {
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
  if (!existsSync(launchAgentsDir)) {
    mkdirSync(launchAgentsDir, { recursive: true });
  }

  const plistPath = join(launchAgentsDir, 'com.sofagent.daemon.plist');
  const projectWorkingDir = cwd;

  // 已有 plist → 询问是否覆盖(单例互踩根因——不再静默卸载覆盖）
  if (existsSync(plistPath)) {
    let oldTarget = '(无法读取)';
    try {
      const oldContent = readFileSync(plistPath, 'utf-8');
      const prog = extractFirstPlistString(oldContent);
      if (prog) oldTarget = prog;
    } catch { /* 读不了就按未知处理 */ }
    if (!promptYesNoSync(`  已有 daemon 注册（指向 ${oldTarget}），是否覆盖为当前项目？`, 'n')) {
      console.log('  → 已保留现有 daemon 注册（如需重新注册请先手动删除 ~/Library/LaunchAgents/com.sofagent.daemon.plist）');
      return;
    }
    try {
      execFileSync('launchctl', ['unload', plistPath], { stdio: 'pipe' });
      console.log('  → 已卸载旧 daemon 注册');
    } catch {
      // 可能没有在运行，忽略
    }
  }

  // 解析 daemon 入口——未安装时如实报错（npx 场景：不生成坏 plist、不打印假成功）
  const entry = resolveDaemonEntry(cwd);
  if (!entry) {
    console.log('  ⚠️ daemon 未安装，跳过常驻服务注册');
    console.log('  → 如需 7×24 常驻监控，请先全局安装 daemon: npm install -g @sofagent/daemon');
    console.log('  → git commit 审计不受影响（hook 已安装）');
    return;
  }

  // v1.2.5 §8.3 plist 路径校验——写入前确认 daemon 入口文件确实存在
  // resolveDaemonEntry 已做候选筛选，但 node 路径可能解析为非标准路径，
  // 此处做最终防线：cliPath 不存在则 WARN 不注册（不打印假成功）
  if (entry.cliPath !== 'node' && !existsSync(entry.cliPath)) {
    console.log(`  ⚠️ daemon 入口不存在: ${entry.cliPath}，跳过 plist 写入（§8.3 路径校验）`);
    console.log('  → 请检查 daemon 安装是否完整，或手动注册 LaunchAgent');
    return;
  }

  // PATH 兜底：确保 node bin 目录可用
  const nodeBinDir = dirname(process.execPath);
  const safeNodeBinDir = nodeBinDir || '/usr/local/bin';
  const envPath = `${safeNodeBinDir}:/usr/local/bin:/usr/bin:/bin`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sofagent.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${entry.cliPath}</string>
${entry.args.map((a) => `        <string>${a}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${projectWorkingDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${resolveDaemonLog(cwd)}</string>
    <key>StandardErrorPath</key>
    <string>${resolveDaemonLog(cwd)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${envPath}</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
`;

  writeFileSync(plistPath, plistContent, 'utf-8');
  chmodSync(plistPath, 0o644);

  // 加载 LaunchAgent——如实报告结果
  try {
    execFileSync('launchctl', ['load', plistPath], { stdio: 'pipe' });
    console.log('  ✅ daemon 已注册并启动（下次开机自动运行）');
    console.log(`  → 监控项目: ${projectWorkingDir}`);
    console.log(`  → 日志: data/daemon.log`);
    console.log('  → 如需停用: launchctl unload ~/Library/LaunchAgents/com.sofagent.daemon.plist');
  } catch (err) {
    console.log(`  ⚠️ daemon 注册文件已创建，但启动失败: ${(err as Error).message}`);
    console.log('  → 手动启动: launchctl load ~/Library/LaunchAgents/com.sofagent.daemon.plist');
  }
}

/**
 * 运行初始化
 * 幂等：已存在的配置不覆盖，已安装的 hook 不重复写入
 *
 * v1.3.1 #2: 不再设置 SOFAGENT_INTERNAL_INIT 环境变量（可被任何进程设置，构成审计绕过）。
 * init 流程中的 git 操作改用 `git -c core.hooksPath=/dev/null commit`（Git 原生 hook 旁路）。
 */
export function runInit(): void {
  const cwd = process.cwd();

  // v1.3.1 #2: 移除 SOFAGENT_INTERNAL_INIT——改由调用方使用 git -c core.hooksPath=/dev/null 旁路。
  // 此处不再设置任何环境变量（原 process.env.SOFAGENT_INTERNAL_INIT = '1' 已删除）。

  console.log('');
  console.log(`sofagent v${VERSION}`);
  console.log('sofagent-audit · 初始化');
  console.log('');

  // v1.0.5: 仓库状态分类（gstack 首次运行引导）
  const repoState = classifyRepo();
  console.log(`  ${repoState.hint}`);

  let stepOk = 0;
  let stepSkipped = 0;

  // [1/5] 创建配置文件
  console.log('[1/5] 创建配置文件...');
  const configDir = join(cwd, '.sofagent');
  const configPath = join(configDir, 'config.yml');

  if (existsSync(configPath)) {
    console.log('  → .sofagent/config.yml 已存在，跳过（不覆盖你的配置）');
    console.log('  → 想重新生成？先删除: rm .sofagent/config.yml');
    stepSkipped++;
  } else {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeConfig(configPath, CONFIG_TEMPLATE);
    console.log(`  → .sofagent/config.yml 已生成（${defaultRules.length} 条规则默认全部启用）`);
    console.log('  → 这个配置控制哪些审计规则启用，直接编辑 .sofagent/config.yml 即可自定义');
    stepOk++;
  }

  // v1.1.3 新增：生成 watch.yml（daemon 文件监控配置）
  // 没 watch.yml 的话 daemon 会 fallback 到默认 paths=['src/','agents/','.sofagent/']
  // 但项目结构各异，默认 paths 往往不匹配——生成模板让 daemon 真正监控项目
  const watchConfigPath = join(configDir, 'watch.yml');
  if (existsSync(watchConfigPath)) {
    console.log('  → .sofagent/watch.yml 已存在，跳过（不覆盖你的配置）');
  } else {
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(watchConfigPath, generateWatchTemplate(), 'utf-8');
    console.log('  → .sofagent/watch.yml 已生成（daemon 文件监控配置）');
    console.log('  → 监控路径不匹配？编辑 .sofagent/watch.yml 的 watch.paths');
  }

  // 确保 .sofagent/ 被 gitignore
  ensureGitignore(cwd);

  // 自动生成 HMAC 密钥（~/.sofagent-key，权限 600）
  // 配合 修复形成完整防篡改链路：默认启用 HMAC-SHA256 强校验
  const hmacKeyPath = join(homedir(), '.sofagent-key');
  let hmacKeyGenerated = false;
  if (existsSync(hmacKeyPath)) {
    console.log('  → ~/.sofagent-key 已存在，不覆盖（审计历史继续使用现有密钥）');
  } else {
    try {
      const key = randomBytes(32).toString('hex');
      writeFileSync(hmacKeyPath, key + '\n', { mode: 0o600 });
      chmodSync(hmacKeyPath, 0o600);
      console.log('  ✅ HMAC 密钥已自动生成（~/.sofagent-key，权限 600）');
      console.log('  ℹ️  审计历史已启用 HMAC-SHA256 签名，篡改可检测');
      console.log('  ⚠️  请备份密钥文件，密钥丢失后历史记录将变为不可复验');
      hmacKeyGenerated = true;
    } catch (err) {
      console.log(`  ⚠️ HMAC 密钥生成失败: ${(err as Error).message}（审计历史降级为 SHA-256）`);
    }
  }

  // P1-A10: --init 时顺手对 config.yml 签名（消除 config 无签名警告）
  // HMAC 密钥已存在（刚生成或已有），自动签名避免每次 audit 都看到"config.yml 无防篡改签名"警告。
  if (existsSync(configPath)) {
    try {
      const { signConfig } = require('@sofagent/core');
      signConfig(configPath);
      console.log('  ✅ config.yml 已自动签名（消除防篡改警告）');
    } catch {
      // 签名失败不阻塞 init（可能密钥刚生成但权限问题）
      if (hmacKeyGenerated) {
        console.log('  ⚠️ config.yml 签名失败——运行 sofagent-audit --sign-config 手动签名');
      }
    }
  }

  // [2/5] 安装 git commit-msg hook
  console.log('');
  console.log('[2/5] 安装 git commit-msg hook...');

  // 检测 git 仓库
  let gitDir: string | null = null;
  let searchDir = cwd;
  while (true) {
    const candidate = join(searchDir, '.git');
    if (existsSync(candidate)) {
      gitDir = candidate;
      break;
    }
    const parent = dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  if (!gitDir) {
    console.log('  → 当前目录不在 git 仓库内，hook 已跳过');
    console.log('  ⚠️ 审计引擎在 git 项目中才能运行——配置已生成，但审计不可用');
    console.log('  → 初始化 git 仓库后重新跑: git init && sofagent-audit --init');
    // P1-C4: 非 git 目录残留清理——删除刚创建的 .sofagent/ 目录
    try {
      const createdDir = join(cwd, '.sofagent');
      if (existsSync(createdDir)) {
        const { rmSync } = require('fs');
        rmSync(createdDir, { recursive: true, force: true });
        console.log('  → 已清理 .sofagent/ 目录（非 git 仓库不应残留配置）');
      }
      // 清理可能追加到 .gitignore 的条目
      const gitignorePath = join(cwd, '.gitignore');
      if (existsSync(gitignorePath)) {
        let content = readFileSync(gitignorePath, 'utf-8');
        // 移除 sofagent 追加的行（如果 .gitignore 原本只有 sofagent 的条目则删除整个文件）
        if (content.includes('# sofagent 审计数据')) {
          content = content.replace(/\n?# sofagent 审计数据（本地配置 \+ 知识库 \+ 审计历史）\n\.sofagent\/\n?/g, '');
          if (content.trim() === '') {
            require('fs').unlinkSync(gitignorePath);
          } else {
            writeFileSync(gitignorePath, content, 'utf-8');
          }
          console.log('  → 已清理 .gitignore 中的 sofagent 条目');
        }
      }
    } catch { /* 清理失败不阻塞退出 */ }
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  ⚠️ 初始化未完成——当前不在 git 仓库      ║');
    console.log('║  请先 git init 后重跑 sofagent-audit --init ║');
    console.log('╚══════════════════════════════════════════╝');
    process.exit(1);
  } else {
    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // 迁移：移除旧版 pre-commit hook（含 sofagent 标识的）
    const legacyPath = join(hooksDir, 'pre-commit');
    if (existsSync(legacyPath)) {
      try {
        const legacyContent = readFileSync(legacyPath, 'utf-8');
        if (legacyContent.includes('sofagent')) {
          require('fs').unlinkSync(legacyPath);
          console.log('  → 已移除旧版 pre-commit hook（迁移到 commit-msg）');
        }
      } catch { /* 读不了就跳过 */ }
    }

    const hookPath = join(hooksDir, 'commit-msg');

    // 幂等检查：版本号比较——v1.0.8 以下覆盖，≥v1.0.8 保留
    // v1.3.1 #13: 额外验证 hook 文件实际包含审计调用逻辑（sofagent-audit 命令），
    //             防止占坑 hook（含版本号正则但不调审计）欺骗幂等检查。
    let hasSofagentHook = false;
    if (existsSync(hookPath)) {
      try {
        const content = readFileSync(hookPath, 'utf-8');
        // v1.3.1 #13: 先验证 hook 内容确实包含审计调用——占坑 hook 只含版本号字符串
        // 但不调用 sofagent-audit，应视为需要覆盖。
        const hasAuditCall = content.includes('sofagent-audit') || content.includes('AUDIT_CMD');
        const versionMatch = content.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1]!, 10);
          const minor = parseInt(versionMatch[2]!, 10);
          const patch = parseInt(versionMatch[3]!, 10);
          if (major < 1 || (major === 1 && minor === 0 && patch < 8)) {
            hasSofagentHook = false;  // 旧版本 → 覆盖
          } else if (!hasAuditCall) {
            hasSofagentHook = false;  // 版本号达标但无审计调用 → 占坑 hook，覆盖
          } else {
            hasSofagentHook = true;   // 版本达标且含审计调用 → 保留
          }
        } else {
          hasSofagentHook = false;  // 无版本号 → 覆盖
        }
      } catch {
        // 读不了就当不存在
      }
    }

    if (hasSofagentHook) {
      console.log(`  → commit-msg hook 已安装（检测到 sofagent 标识），跳过`);
      stepSkipped++;
    } else {
      writeFileSync(hookPath, HOOK_TEMPLATE, 'utf-8');
      chmodSync(hookPath, 0o755);
      console.log(`  → 检测到 git 仓库: ${gitDir.replace('/.git', '')}`);
      console.log('  → .git/hooks/commit-msg 已安装（可执行，含无声失败保护）');
      console.log('  → hook 会在每次 git commit 时自动运行审计');
      stepOk++;
    }

    // v1.2.9: post-commit hook 重写——commit hash 对账替代 timestamp 近邻匹配 + 读全局 history 路径
    // v1.2.9 对账逻辑适配 parentSha（commit-msg hook 记录的是父提交 SHA）
    const POST_COMMIT_TEMPLATE = `#!/bin/bash
# sofagent post-commit hook v${VERSION}
# 检测策略：commit hash 对账——检查当前 commit 的 SHA 是否在审计记录中有对应条目
# （commitSha 精确匹配 + commitPhase='pre-commit' 记录的 parentSha 匹配）
# 如果没有，判定为绕过（--no-verify 或 hook 被删/失效）
# 注意：git commit --no-verify 会绕过本 hook——CI 侧 sofagent-audit --diff 兜底是最终防线

# P1-A7: commit-msg hook 缺失自检——醒目告警（下次 commit 时）
COMMIT_MSG_HOOK=".git/hooks/commit-msg"
if [ ! -f "$COMMIT_MSG_HOOK" ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║  🔴 [sofagent] commit-msg hook 不存在！       ║"
  echo "  ║  审计引擎未运行——所有提交都不受审计约束      ║"
  echo "  ║  运行 sofagent-audit --init 重新安装          ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""
elif ! grep -q 'sofagent' "$COMMIT_MSG_HOOK" 2>/dev/null; then
  echo ""
  echo "  ⚠️ [sofagent] commit-msg hook 存在但不包含 sofagent 标识——"
  echo "  可能已被替换或覆盖。运行 sofagent-audit --init 恢复。"
  echo ""
fi

if ! command -v node &>/dev/null; then exit 0; fi

if command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD="sofagent-audit"
else
  exit 0
fi

# v1.2.8: 读全局 history 路径（不再读仓库相对路径 data/audit/history.jsonl）
SOFAGENT_HOME="\${SOFAGENT_HOME:-\$HOME/.sofagent}"
HISTORY_FILE="$SOFAGENT_HOME/data/audit/history.jsonl"
if [ ! -f "$HISTORY_FILE" ]; then exit 0; fi

# 当前 commit SHA（= 已创建的新提交自身）
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null)
if [ -z "$COMMIT_SHA" ]; then exit 0; fi

# v1.3.3 #13: 父提交 SHA——用于和 commit-msg hook 记录的 parentSha 对账。
# commit-msg hook 在 commit 对象生成前运行，记录的 parentSha = 审计时 HEAD = 新提交的父提交。
# post-commit 在 commit 生成后运行，HEAD = 新提交自身，因此需取 HEAD^ 才能对上 parentSha。
# 首次提交无父（unborn HEAD 场景）：HEAD^ 不存在，git rev-parse 返回非零并把字面量 "HEAD^"
# 写到 stdout（而非空串），必须检查退出码而非判空，否则兜底失效。
PARENT_SHA=''
if git rev-parse HEAD^ >/dev/null 2>&1; then
  PARENT_SHA=$(git rev-parse HEAD^ 2>/dev/null)
fi
if [ -z "\$PARENT_SHA" ]; then
  PARENT_SHA='4b825dc642cb6eb9a060e54bf8d69288fbee4904'
fi

# v1.3.3 #17E: SHA / 路径通过 process.env 传入 node -e，不再字符串拼接（命令注入加固）
# commit hash 对账：检查当前 commit 是否在审计记录中有对应条目
COMMIT_SHA="$COMMIT_SHA" PARENT_SHA="$PARENT_SHA" HISTORY_FILE="$HISTORY_FILE" node -e '
const fs = require("fs");
const COMMIT_SHA = process.env.COMMIT_SHA;
const PARENT_SHA = process.env.PARENT_SHA;
const HISTORY_FILE = process.env.HISTORY_FILE;
if (!HISTORY_FILE) process.exit(0);
const lines = fs.readFileSync(HISTORY_FILE, "utf-8").trim().split("\\n").filter(Boolean);
if (lines.length === 0) process.exit(0);
try {
  // 反向查找（最新记录在末尾）
  // 匹配规则（v1.3.3 #13 修正）：
  //   1. commitSha 精确匹配（手动 --diff 场景记录，HEAD 已存在）
  //   2. commitPhase=pre-commit 记录：parentSha = 审计时 HEAD = 新提交的父提交，
  //      post-commit 用 HEAD^（当前提交的父）与之对账——父子关系正确匹配。
  //   旧记录无 parentSha/commitPhase 字段时规则 2 不生效，行为与旧版一致。
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]);
    const entryCommit = entry.commitSha || "";
    if (entryCommit === COMMIT_SHA) {
      // v1.3.4 P1-8: 审计通过时输出轻量回声（可感知性——让用户知道 sofagent 在工作）
      console.log("  ✓ [sofagent] 审计通过");
      process.exit(0);  // 找到匹配——审计已运行
    }
    if (entry.commitPhase === "pre-commit" && entry.parentSha === PARENT_SHA) {
      // v1.3.5 #2: 假阳性回声修复——命中 pre-commit 记录时必须校验该次审计的结果。
      // 此前无脑输出「✓ 审计通过」：带 token 提交被 commit-msg 拦截（exit 2，
      // 拦截记录带 parentSha）→ 同内容 --no-verify 强推 → post-commit 命中那条
      // **失败**记录 → 输出假绿。现在按 exitCode 分流：
      //   0 = 审计真通过 → 回声；非 0 = 疑似绕过 → 不输出 ✓，提示复核。
      if (entry.exitCode === 0) {
        console.log("  ✓ [sofagent] 审计通过");
        process.exit(0);  // pre-commit 记录按父提交 SHA 对账命中且审计通过
      }
      console.log("");
      console.log("  ℹ️ [sofagent] 父提交存在审计拦截记录（exit " + entry.exitCode + "）但本次 commit 未走审计——疑似 --no-verify 绕过。");
      console.log("  可运行 sofagent-audit --verify-commit " + COMMIT_SHA + " 复核。");
      process.exit(0);  // post-commit 永不阻断 commit（只提示）
    }
  }
  // 未找到匹配——降级为 INFO 提示（避免狼来了）。真绕过仍由 --verify-commit 复核。
  console.log("");
  console.log("  ℹ️ [sofagent] 未确认审计记录（post-commit 对账未命中）。");
  console.log("  如未使用 --no-verify 可忽略；如需确认运行 sofagent-audit --verify-commit " + COMMIT_SHA);
} catch (e) {
  // 解析失败不影响提交
}
' 2>/dev/null

exit 0
`;

    // v1.0.7: 安装 post-commit hook
    const postCommitPath = join(hooksDir, 'post-commit');
    let hasPostCommitHook = false;
    if (existsSync(postCommitPath)) {
      try {
        const pcContent = readFileSync(postCommitPath, 'utf-8');
        // v1.0.8 修复：不再用模糊匹配 `includes('sofagent')`——旧 hook 也会命中，导致存量用户无法升级
        // 改为检查版本号：v1.0.7 及以下 → 覆盖为当前版本；v1.0.8 及以上 → 跳过
        // v1.3.1 #13: 额外验证 hook 内容含审计对账逻辑（占坑 hook 防护）
        const hasAuditCall = pcContent.includes('sofagent-audit') || pcContent.includes('HISTORY_FILE') || pcContent.includes('verify-commit');
        // v1.3.3 #13: 旧版 post-commit 用 $COMMIT_SHA 对账 parentSha（永远不匹配，假阳性），
        // v1.3.3 改为 HEAD^ + process.env.PARENT_SHA。检测旧逻辑标记以强制覆盖 v1.2.9–v1.3.2。
        const hasNewPARENT_SHALogic = pcContent.includes('PARENT_SHA');
        const versionMatch = pcContent.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1]!, 10);
          const minor = parseInt(versionMatch[2]!, 10);
          const patch = parseInt(versionMatch[3]!, 10);
        // v1.2.9: post-commit 大改（路径+对账机制），强制覆盖 1.2.7 及以下
        // v1.2.9 对账逻辑适配 parentSha，强制覆盖 1.2.8 及以下（否则 A8 误报自愈不生效）
        // v1.3.3 #13: parentSha 对账根因修复（HEAD^ + PARENT_SHA），强制覆盖 1.3.2 及以下
        if (major < 1 || (major === 1 && (minor < 3 || (minor === 3 && patch < 3)))) {
            hasPostCommitHook = false;  // 旧版本 → 覆盖
          } else if (!hasAuditCall) {
            hasPostCommitHook = false;  // 版本达标但无审计对账逻辑 → 占坑 hook，覆盖
          } else if (!hasNewPARENT_SHALogic) {
            hasPostCommitHook = false;  // 版本达标但仍是旧 $COMMIT_SHA 对账逻辑 → 覆盖为 HEAD^ 修复版
          } else {
            hasPostCommitHook = true;   // 当前版本或更新 → 保留
          }
        } else {
          // 没有版本号标记的 hook → 覆盖（非 sofagent hook 或太旧无法识别）
          hasPostCommitHook = false;
        }
      } catch {
        // 读不了就当不存在
      }
    }

    if (hasPostCommitHook) {
      console.log('  → post-commit hook 已安装（检测到 sofagent 标识），跳过');
    } else {
      writeFileSync(postCommitPath, POST_COMMIT_TEMPLATE, 'utf-8');
      chmodSync(postCommitPath, 0o755);
      console.log('  → .git/hooks/post-commit 已安装（--no-verify 绕过检测）');
    }
  }

  // [3/5] 创建知识库目录骨架（v1.0.1 新增；v1.2.2 迁移到 data/knowledge/）
  console.log('');
  console.log('[3/5] 创建知识库目录...');
  const knowledgeDir = resolveKnowledgeDir();
  if (existsSync(knowledgeDir)) {
    console.log('  → data/knowledge/ 已存在，跳过');
    stepSkipped++;
  } else {
    const subDirs = ['entities', 'concepts', 'comparisons', 'summaries'];
    for (const sub of subDirs) {
      mkdirSync(join(knowledgeDir, sub), { recursive: true });
    }
    // index.md 初始模板——与 file-deploy.sh _deploy_knowledge_skeleton 保持一致
    writeFileSync(
      join(knowledgeDir, 'index.md'),
      '# 知识库目录\n\n> 此页面由 AI 自动维护——新增知识页面时同步更新。\n> daemon Ingest 和 knowledge-maintain Skill 负责写入。\n\n| 页面 | 域 | 可访问节点 |\n|------|-----|------------|\n',
      'utf-8'
    );
    // log.md 初始模板——与 file-deploy.sh _deploy_knowledge_skeleton 保持一致
    writeFileSync(
      join(knowledgeDir, 'log.md'),
      '# 知识库操作日志\n\n> 自动追加——Ingest / Query / Lint 操作的时间戳记录。\n\n| 时间 | 操作 | 影响页面 | 详情 |\n|------|------|---------|------|\n',
      'utf-8'
    );
    console.log('  → data/knowledge/ 已创建（4 子目录 + index.md + log.md）');
    console.log('  → 知识库用于沉淀 Agent 的跨任务经验，由 daemon 自动维护');
    stepOk++;
  }

  // [4/5] 冒烟测试
  console.log('');
  console.log('[4/5] 冒烟测试...');

  let smokeOk = true;

  // Node.js 版本检测
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major >= 18) {
    console.log(`  ✅ Node.js ${nodeVersion}`);
  } else {
    console.log(`  ❌ Node.js ${nodeVersion}（需要 >= 18）`);
    smokeOk = false;
  }

  // 规则加载检测
  try {
    // 动态导入验证规则注册表可用
    const { defaultRules } = require('../rules');
    // v1.1.5: A18 提升为 defaultRules（v1.1.4=12 → v1.1.5=13）
    // v1.1.8: 动态引用 defaultRules.length，规则增减自动同步，不再硬编码
    const expectedDefaultRules = defaultRules.length;
    if (defaultRules && defaultRules.length === expectedDefaultRules) {
      console.log(`  ✅ ${expectedDefaultRules} 条默认规则全部加载`);
    } else {
      console.log(`  ⚠️ 规则数异常: ${defaultRules?.length ?? 0}（期望 ${expectedDefaultRules}）`);
      smokeOk = false;
    }
  } catch {
    console.log('  ❌ 规则加载失败');
    smokeOk = false;
  }

  // 审计引擎可用检测——尝试跑一次空 diff
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('  ✅ 审计引擎可用');
  } catch {
    console.log('  ⚠️ 非 git 仓库，审计引擎在 git 项目中才能运行');
  }

  if (smokeOk) stepOk++;

  // [5/5] 注册 daemon 文件系统监控（v1.0.8 新增；v1.2.5 改为确认后注册）
  console.log('');
  console.log('[5/5] 注册 daemon 文件系统监控...');

  const isMacOS = platform() === 'darwin';
  if (isMacOS) {
    // 默认不装——询问用户是否注册 daemon 常驻服务。
    // 非 TTY（脚本/CI/npx）默认 N，绝不挂起等待输入；也可用 --no-daemon 显式跳过。
    if (process.argv.includes('--no-daemon')) {
      console.log('  → 已指定 --no-daemon，跳过 daemon 常驻服务注册');
    } else if (!promptYesNoSync('  是否注册 daemon 常驻服务（后台监控文件变更，开机自启）？', 'n')) {
      console.log('  → 已跳过 daemon 注册（git commit 审计不受影响）');
      console.log('  → 如需常驻监控，重新运行 sofagent-audit --init 并选择注册');
    } else {
      try {
        registerDaemon(cwd);
      } catch (err) {
        console.log(`  ⚠️ daemon 注册失败: ${(err as Error).message}`);
        console.log('  → git hooks 仍可用，如需 daemon 请手动安装: npm install -g @sofagent/daemon');
      }
    }
  } else {
    console.log('  ⓘ 非 macOS 系统，跳过 LaunchAgent 注册');
    console.log('  → 请手动配置 daemon 自启动（systemd / Windows Service）');
  }

  // 完成 banner
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  sofagent-audit 初始化完成               ║');
  console.log('║  git commit 审计已就绪                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  💡 首次使用？先 cd 到你的项目目录跑 `sofagent-audit --init` 初始化审计。');
  console.log('  下一步：');
  console.log('    1. 改个文件，试试 git commit——你会看到审计引擎在提交前自动扫描');
  console.log('    2. 想测试拦截？echo "API_KEY=test" > .env && git add -f .env && git commit -m "test"');
  console.log('       （用 -f 强制添加以便演示拦截——.env 通常被 .gitignore 忽略）');
  console.log('    3. 想看全部命令？sofagent-audit --help');
  console.log('    4. 想管住 Agent 全流程？看 HANDBOOK → 场景一');
  console.log('');
}
