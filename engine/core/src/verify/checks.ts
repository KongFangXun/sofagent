// ============================================================
// verify/checks.ts · 验证检查逻辑（§1-§11 + quick + WorkBuddy）
// v1.4.3 从 sofagent/audit/src/verify/checks.ts 迁出
// ============================================================
// 从 verify.ts main() 函数中提取的检查逻辑。
// 每个函数接收 Verifier 实例和上下文参数，调用 v.checkPass/Fail/Warn。

import { resolveEnvVar } from '../shared/env';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { VERSION } from '../shared/constants.js';
import { getThinkPath } from '../memory-contract.js';
import { Verifier } from './verifier.js';
import type { Args } from './types.js';
import {
  HOME,
  tryExec,
  commandAvailable,
  countChars,
  countLines,
  getFileMode,
  countFilesInDir,
  isExecutable,
  findRecentFiles,
  readFileContent,
  testSanitize,
} from './utils.js';

// ════════════════════════════════════════
// quick 模式：4 项核心检查
// ════════════════════════════════════════
export function runQuickChecks(
  v: Verifier,
  args: Args,
  openclawDir: string,
  sofagentData: string,
): void {
  // 1. SKILL.md 存在且含宪法关键词
  // 多平台候选路径——install.sh 将 SKILL.md 部署到平台目录（~/.workbuddy/ 或 ~/.openclaw/）
  const skillCandidates = [
    join(openclawDir, 'skills', 'sofagent', 'SKILL.md'),
    join(HOME, '.workbuddy', 'skills', 'sofagent', 'SKILL.md'),
    join(HOME, '.openclaw', 'skills', 'sofagent', 'SKILL.md'),
    join(HOME, '.sofagent', 'skill', 'SKILL.md'),
  ];
  let skillQuick = '';
  for (const c of skillCandidates) {
    if (existsSync(c)) { skillQuick = c; break; }
  }
  const skillContent = readFileContent(skillQuick);
  if (skillQuick && existsSync(skillQuick) && (/4.*底线|6.*铁律/.test(skillContent))) {
    v.checkPass(`SKILL.md 存在且含宪法（4底线+6则铁律）— ${skillQuick}`);
  } else {
    v.checkFail('SKILL.md 缺失或宪法关键词不全（已查找 ~/.workbuddy/skills/sofagent/ 和 ~/.openclaw/skills/sofagent/）');
  }

  // 2. data/ 数据目录存在（v1.2.1 起，原 .sofagent/）
  if (existsSync(sofagentData)) {
    v.checkPass('data/ 数据目录存在');
  } else {
    v.checkWarn('data/ 数据目录不存在（首次使用会自动创建）');
  }

  // 3. createReactAgent 编排引擎可用
  if (commandAvailable('node')) {
    v.checkPass('Node.js 可用——编排引擎就绪（createReactAgent）');
  } else {
    v.checkWarn('Node.js 不可用——编排引擎降级');
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

  // 5. config.yml 完整性检查（v1.2.2 新增）
  // 检查 .sofagent/config.yml 是否存在且包含关键字段（rules 数组）
  const configYmlPath = join(sofagentData, 'config.yml');
  if (existsSync(configYmlPath)) {
    try {
      const configContent = readFileSync(configYmlPath, 'utf-8');
      if (configContent.includes('rules')) {
        v.checkPass('config.yml 存在且含 rules 配置段');
      } else {
        v.checkWarn('config.yml 存在但缺少 rules 配置段');
      }
    } catch {
      v.checkWarn('config.yml 不可读');
    }
  } else {
    // config.yml 可选——不存在不是错误，使用默认配置
    v.checkPass('config.yml 不存在（使用默认配置，无需创建）');
  }
}

// ════════════════════════════════════════
// WorkBuddy 平台专属检查（5 项）
// ════════════════════════════════════════
export function runWorkBuddyChecks(
  v: Verifier,
  openclawDir: string,
  sofagentData: string,
): void {
  v.checkPass('WorkBuddy 平台——宪法/Hook/断路器由 SKILL.md 入口流程管理');

  // SKILL.md 已部署+含宪法
  const wbSkill = join(HOME, '.workbuddy', 'skills', 'sofagent', 'SKILL.md');
  if (existsSync(wbSkill) && statSync(wbSkill).size > 0) {
    const content = readFileContent(wbSkill);
    if (/4 底线|7 则铁律/.test(content)) {
      v.checkPass('SKILL.md 已部署且含宪法（4底线+6则铁律内联）');
    } else {
      v.checkWarn('SKILL.md 已部署但宪法内容缺失');
    }
  } else {
    v.checkWarn('SKILL.md 未部署到 ~/.workbuddy/skills/sofagent/');
  }

  // fde.md 已部署+字符数（v1.2.0: 路径与 install.sh 部署目标对齐）
  const wbRules = join(HOME, '.workbuddy', 'skills', 'sofagent', 'fde.md');
  if (existsSync(wbRules) && statSync(wbRules).size > 0) {
    const chars = countChars(wbRules);
    v.checkPass(`fde.md 已部署（${chars} 字符）`);
  } else {
    v.checkWarn('fde.md 未部署到 ~/.workbuddy/skills/sofagent/');
  }

  // Skills 目录 .md 文件数
  const wbSkillsDir = join(HOME, '.workbuddy', 'skills', 'sofagent');
  if (existsSync(wbSkillsDir)) {
    const count = countFilesInDir(wbSkillsDir, '.md');
    v.checkPass(`Skills 目录已部署（${count} 个 .md 文件）`);
  } else {
    v.checkWarn('Skills 目录不存在');
  }

  // data/ 目录存在（v1.2.1 起，原 .sofagent/）
  if (existsSync(sofagentData)) {
    v.checkPass('data/ 数据目录存在');
  } else {
    v.checkWarn('data/ 数据目录不存在（首次使用会自动创建）');
  }
}

// ════════════════════════════════════════
// 全量检查 §1-§11
// ════════════════════════════════════════
export function runAllChecks(
  v: Verifier,
  args: Args,
  platform: string,
  target: string,
  openclawDir: string,
  sofagentData: string,
): void {
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

      // 字符上限（宪法层 fde.md 是 FDE 部署模板，含完整配置项 + 示例注释，90 行可承载大量注释行——合理上限 3200 字符）
      if (chars > 3200) {
        v.checkWarn(`${f} 超过 3200 字符（${chars}），fde.md 行数上限 90 行，建议精简示例注释`);
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
    const thinkFile = getThinkPath(sofagentData);
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

  // v1.0.7: createReactAgent 为正式编排引擎（ao 已退役）
  if (commandAvailable('node')) {
    const nodeVer = tryExec('node', ['--version']) || '?';
    v.checkPass(`Node.js ${nodeVer}（编排引擎: createReactAgent）`);
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
    v.checkPass('data/ 数据目录存在');
    // v1.2.1：子目录口径与 data/ 目录结构对齐（原 .sofagent/ 的 task/logs/orchestrator）
    for (const sub of ['task', 'knowledge', 'orchestrator', 'audit']) {
      const subDir = join(sofagentData, sub);
      if (existsSync(subDir)) {
        v.checkPass(`  data/${sub}/ 就绪`);
      } else {
        v.checkWarn(`  data/${sub}/ 缺失`);
      }
    }
  } else {
    v.checkWarn('data/ 数据目录不存在（首次使用会自动创建）');
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
    const thinkFile = getThinkPath(sofagentData);
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
  // 兼容两种布局：仓库源码态 scripts/ 在 repo root 下；部署态在 ~/.openclaw/scripts/。
  // 旧逻辑 join(__dirname,'..','..') 假设 dist 仅一层，实际 checks.ts 编译在 dist/verify/，
  // 两个 '..' 只到 audit 包目录，少一级 → 源码直跑时 scripts 解析错误（verify 自检误报缺失）。
  // 改为：部署锚点优先 + 从 __dirname 向上遍历查找含 cleanup.sh/audit.sh 的 scripts/ 父目录。
  const verifyScriptDir = (() => {
    const deployedScripts = join(HOME, '.openclaw', 'scripts');
    if (existsSync(join(deployedScripts, 'cleanup.sh')) || existsSync(join(deployedScripts, 'audit.sh'))) {
      return dirname(deployedScripts); // 部署态：scripts 父目录 = ~/.openclaw
    }
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      const cand = join(dir, 'scripts');
      if (existsSync(join(cand, 'cleanup.sh')) || existsSync(join(cand, 'audit.sh'))) {
        return dir; // 找到 scripts/ 的父目录
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return join(__dirname, '..', '..', '..'); // 兜底：源码态正确深度（dist/verify → repo root）
  })();
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
    const sanitySk = testSanitize('sk-***REDACTED***');
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
    const sanityPhone = testSanitize('用户电话 1**REDACTED*** 请回拨');
    if (sanityPhone.includes('PHONE-REDACTED') && !sanityPhone.includes('1**REDACTED***')) {
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
    // SOFAGENT_* 主名优先，SOFA_* 别名兜底
    const sofaSanitize = resolveEnvVar('SOFAGENT_SANITIZE', 'SOFA_SANITIZE');
    const sofaAuditEnabled = resolveEnvVar('SOFAGENT_AUDIT_ENABLED', 'SOFA_AUDIT_ENABLED');
    const sofaCleanupOnRecord = resolveEnvVar('SOFAGENT_CLEANUP_ON_RECORD', 'SOFA_CLEANUP_ON_RECORD');

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
        v.checkWarn('[INFO] daemon 未运行（可选功能，不影响约束层）——运行 daemon.sh start 启动');
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
}
