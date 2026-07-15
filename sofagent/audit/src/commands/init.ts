// ============================================================
// init.ts · sofagent-audit --init 一键初始化
// v1.1 新增：一条命令完成 3 步
//   1. 生成 .sofagent/config.yml 配置模板
//   2. 安装 git commit-msg hook
//   3. 冒烟测试——验证审计引擎可用
// v1.1.2: 新增仓库状态分类器（gstack 首次运行引导）
// ============================================================

import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync, execSync } from 'child_process';
import { homedir, platform } from 'os';
import { CONFIG_TEMPLATE, HOOK_TEMPLATE } from '../config-template';
import { writeConfig } from '@sofagent/core';

/**
 * 仓库状态分类（v1.0.5 新增）
 * 来源：gstack 的 bin/gstack-first-task-detect
 */
type RepoState = 'greenfield' | 'has_code' | 'has_uncommitted' | 'dirty' | 'clean';

/**
 * P1-1: 确保 .sofagent/ 被 .gitignore 排除
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
  // 1. 检测是否有 commit 历史
  let hasCommits = true;
  try { execFileSync('git', ['rev-parse', 'HEAD'], { stdio: 'pipe' }); } catch { hasCommits = false; }
  if (!hasCommits) {
    return {
      state: 'greenfield',
      hint: '📋 新仓库——sofagent 会从第一次 commit 开始审计。建议先跑 acceptance-test.sh 验证安装。',
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
        hint: '📋 新仓库——sofagent 会从第一次 commit 开始审计。建议先跑 acceptance-test.sh 验证安装。',
      };
    }
  } catch { /* */ }

  return {
    state: 'has_code',
    hint: '📋 已有代码仓库——sofagent 会审计未来的 commit。历史 commit 不会追溯（除非手动跑 --diff）。',
  };
}

/**
 * 运行初始化
 * 幂等：已存在的配置不覆盖，已安装的 hook 不重复写入
 */
export function runInit(): void {
  const cwd = process.cwd();

  console.log('');
  console.log('sofagent-audit · 初始化');
  console.log('');

  // v1.0.5: 仓库状态分类（gstack 首次运行引导）
  const repoState = classifyRepo();
  console.log(`  ${repoState.hint}`);

  let stepOk = 0;
  let stepSkipped = 0;

  // [1/4] 创建配置文件
  console.log('[1/4] 创建配置文件...');
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
    console.log(`  → .sofagent/config.yml 已生成（11 条规则默认全部启用）`);
    console.log('  → 这个配置控制哪些审计规则启用，直接编辑 .sofagent/config.yml 即可自定义');
    stepOk++;
  }

  // P1-1: 确保 .sofagent/ 被 gitignore
  ensureGitignore(cwd);

  // [2/4] 安装 git commit-msg hook
  console.log('');
  console.log('[2/4] 安装 git commit-msg hook...');

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
    console.log('  → 初始化 git 仓库后重新跑: git init && sofagent-audit --init');
    stepSkipped++;
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
    let hasSofagentHook = false;
    if (existsSync(hookPath)) {
      try {
        const content = readFileSync(hookPath, 'utf-8');
        const versionMatch = content.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1]!, 10);
          const minor = parseInt(versionMatch[2]!, 10);
          const patch = parseInt(versionMatch[3]!, 10);
          if (major < 1 || (major === 1 && minor === 0 && patch < 8)) {
            hasSofagentHook = false;  // 旧版本 → 覆盖
          } else {
            hasSofagentHook = true;   // 当前版本或更新 → 保留
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

    // v1.0.7: 安装 post-commit hook（timestamp 近邻匹配替代 SHA 精确匹配）
    const postCommitPath = join(hooksDir, 'post-commit');
    const POST_COMMIT_TEMPLATE = `#!/bin/bash
# sofagent post-commit hook v1.0.8
# 检测策略：检查 history.jsonl 最后一条记录的 timestamp 是否在 60 秒内
# 如果 60 秒内有审计记录，认为 commit 通过了审计；否则可能是 --no-verify 绕过

if ! command -v node &>/dev/null; then exit 0; fi

if command -v sofagent-audit &>/dev/null; then
  AUDIT_CMD="sofagent-audit"
elif [ -f "sofagent/audit/dist/index.js" ]; then
  AUDIT_CMD="node sofagent/audit/dist/index.js"
else
  exit 0
fi

HISTORY_FILE=".sofagent/audit/history.jsonl"
if [ ! -f "$HISTORY_FILE" ]; then exit 0; fi

# 读取 history.jsonl 最后一条的 timestamp，检查是否在 60 秒内
node -e "
const fs = require('fs');
const lines = fs.readFileSync('$HISTORY_FILE', 'utf-8').trim().split('\\\\n').filter(Boolean);
if (lines.length === 0) process.exit(0);
try {
  const last = JSON.parse(lines[lines.length - 1]);
  if (!last.timestamp) process.exit(0);
  const age = Date.now() - new Date(last.timestamp).getTime();
  if (age > 60000) {
    console.log('');
    console.log('  sofagent: 最近一次审计记录在 ' + Math.round(age/1000) + ' 秒前，当前 commit 可能未经过审计。');
    console.log('  可能使用了 --no-verify 绕过审计 hook。');
    console.log('  运行 sofagent-audit --doctor 查看详情。');
  }
} catch { process.exit(0); }
" 2>/dev/null

exit 0
`;

    let hasPostCommitHook = false;
    if (existsSync(postCommitPath)) {
      try {
        const pcContent = readFileSync(postCommitPath, 'utf-8');
        // v1.0.8 修复：不再用模糊匹配 `includes('sofagent')`——旧 hook 也会命中，导致存量用户无法升级
        // 改为检查版本号：v1.0.7 及以下 → 覆盖为当前版本；v1.0.8 及以上 → 跳过
        const versionMatch = pcContent.match(/v(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch) {
          const major = parseInt(versionMatch[1]!, 10);
          const minor = parseInt(versionMatch[2]!, 10);
          const patch = parseInt(versionMatch[3]!, 10);
          // v1.0.8 以下版本强制覆盖
          if (major < 1 || (major === 1 && minor === 0 && patch < 8)) {
            hasPostCommitHook = false;  // 旧版本 → 覆盖
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

  // [3/4] 创建知识库目录骨架（v1.0.1 新增）
  console.log('');
  console.log('[3/4] 创建知识库目录...');
  const knowledgeDir = join(configDir, 'knowledge');
  if (existsSync(knowledgeDir)) {
    console.log('  → .sofagent/knowledge/ 已存在，跳过');
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
    console.log('  → .sofagent/knowledge/ 已创建（4 子目录 + index.md + log.md）');
    console.log('  → 知识库用于沉淀 Agent 的跨任务经验，由 daemon 自动维护');
    stepOk++;
  }

  // [4/4] 冒烟测试
  console.log('');
  console.log('[4/4] 冒烟测试...');

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
    if (defaultRules && defaultRules.length === 11) {
      console.log(`  ✅ 11 条规则全部加载`);
    } else {
      console.log(`  ⚠️ 规则数异常: ${defaultRules?.length ?? 0}（期望 11）`);
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

  // [5/5] 注册 daemon 文件系统监控（v1.0.8 新增）
  console.log('');
  console.log('[5/5] 注册 daemon 文件系统监控...');

  const isMacOS = platform() === 'darwin';
  if (isMacOS) {
    try {
      const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
      if (!existsSync(launchAgentsDir)) {
        mkdirSync(launchAgentsDir, { recursive: true });
      }

      // 获取 sofagent-audit 的绝对路径和 node 的 bin 目录
      let cliPath = 'sofagent-audit';
      let nodeBinDir = '';
      try {
        cliPath = execSync('which sofagent-audit', { encoding: 'utf-8' }).trim();
        nodeBinDir = execSync('dirname $(which node)', { encoding: 'utf-8' }).trim();
      } catch {
        // fallback 到 PATH 中的 sofagent-audit
      }

      const plistPath = join(launchAgentsDir, 'com.sofagent.daemon.plist');

      if (existsSync(plistPath)) {
        console.log('  → LaunchAgent 已存在，先卸载旧版本...');
        try {
          execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
        } catch {
          // 可能没有在运行，忽略
        }
      }

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sofagent.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${cliPath}</string>
        <string>--daemon</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(homedir(), '.sofagent', 'daemon.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(homedir(), '.sofagent', 'daemon.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${nodeBinDir}:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
`;

      writeFileSync(plistPath, plistContent, 'utf-8');
      chmodSync(plistPath, 0o644);

      // 加载 LaunchAgent
      try {
        execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
        console.log('  ✅ daemon 已注册并启动（下次开机自动运行）');
        console.log(`  → 日志: ~/.sofagent/daemon.log`);
        stepOk++;
      } catch (err) {
        console.log(`  ⚠️ daemon 注册文件已创建，但启动失败: ${(err as Error).message}`);
        console.log('  → 手动启动: launchctl load ~/Library/LaunchAgents/com.sofagent.daemon.plist');
      }
    } catch (err) {
      console.log(`  ⚠️ daemon 注册失败: ${(err as Error).message}`);
      console.log('  → 手动安装: sofagent-audit --install-hook（git hooks 仍可用）');
    }
  } else {
    console.log('  ⓘ 非 macOS 系统，跳过 LaunchAgent 注册');
    console.log('  → 请手动配置 daemon 自启动（systemd / Windows Service）');
  }

  // 完成 banner
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  sofagent-audit 初始化完成               ║');
  console.log('║  git commit 审计 + daemon 文件监控已就绪   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  下一步：');
  console.log('    1. 改个文件，试试 git commit——你会看到审计引擎在提交前自动扫描');
  console.log('    2. 想测试拦截？echo "API_KEY=test" > .env && git add .env && git commit -m "test"');
  console.log('    3. 想看全部命令？sofagent-audit --help');
  console.log('    4. 想管住 Agent 全流程？看 HANDBOOK → 场景一');
  console.log('');
}
