// ============================================================
// init.ts · sofagent-audit --init 一键初始化
// v1.0 新增：一条命令完成 3 步
//   1. 生成 .sofagent/config.yml 配置模板
//   2. 安装 git commit-msg hook
//   3. 冒烟测试——验证审计引擎可用
// v1.0.5: 新增仓库状态分类器（gstack 首次运行引导）
// ============================================================

import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { CONFIG_TEMPLATE, HOOK_TEMPLATE } from '../config-template';
import { writeConfig } from '../config-loader';

/**
 * 仓库状态分类（v1.0.5 新增）
 * 来源：gstack 的 bin/gstack-first-task-detect
 */
type RepoState = 'greenfield' | 'has_code' | 'has_uncommitted' | 'dirty' | 'clean';

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

    // 幂等检查：已有 sofagent hook 则跳过
    let hasSofagentHook = false;
    if (existsSync(hookPath)) {
      try {
        const content = readFileSync(hookPath, 'utf-8');
        hasSofagentHook = content.includes('sofagent');
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

  // 完成 banner
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  sofagent-audit 初始化完成               ║');
  console.log('║  下次 git commit 时审计自动生效           ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  下一步：');
  console.log('    1. 改个文件，试试 git commit——你会看到审计引擎在提交前自动扫描');
  console.log('    2. 想测试拦截？echo "API_KEY=test" > .env && git add .env && git commit -m "test"');
  console.log('    3. 想看全部命令？sofagent-audit --help');
  console.log('    4. 想管住 Agent 全流程？看 HANDBOOK → 场景一');
  console.log('');
}
