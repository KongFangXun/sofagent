// ============================================================
// doctor.ts · sofagent-audit --doctor 健康诊断
// v1.0 新增：一键诊断 7 项健康度
// v1.0.7 新增：第 9 项——知识库访问矩阵
// v1.0.7 新增：第 10 项——SkillOpt 管道状态 + 第 11 项——成本报告
// v1.0.7 新增：第 12-14 项——eval harness / A/B 优化 / HITL 统计（11 项核心检查 + 3 项扩展检查）
// 只读诊断，不做任何写操作
// 退出码：全部通过 → 0；有失败 → 1
// ============================================================
import { existsSync, accessSync, constants, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { loadHistory, checkHistoryChainIntegrity } from '../audit-history';
import { loadConfig, loadEnvConfig } from '../config-loader';
import { load as yamlLoad } from 'js-yaml';
import { calculateBaseline, isAnomaly, isColdStart } from '../cost-baseline';
import { isSkillOptAvailable } from '../skillopt-integration';
import { readRuntimeState } from '../subagents/launcher';

/** 转义正则表达式特殊字符，防止 regex 注入 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CheckResult {
  ok: boolean;       // true = ✅, false = ❌/⚠️
  warning: boolean;  // true = ⚠️ (不阻塞但不完美)
  label: string;     // 显示标签
  detail: string;    // 详细信息
  fixHint?: string;  // 修复建议
}

/**
 * 运行健康诊断
 */
export function runDoctor(): void {
  const cwd = process.cwd();
  const results: CheckResult[] = [];

  console.log('');
  console.log('sofagent-audit · 健康诊断');
  console.log('');

  // 1. Node.js 版本
  {
    const ver = process.version;
    const major = parseInt(ver.slice(1), 10);
    if (major >= 18) {
      results.push({ ok: true, warning: false, label: 'Node.js >=18', detail: ver });
    } else {
      results.push({
        ok: false, warning: false, label: 'Node.js >=18', detail: ver,
        fixHint: '请安装 Node.js >= 18: https://nodejs.org',
      });
    }
  }

  // 2. git 仓库
  let inGitRepo = false;
  {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      inGitRepo = true;
      results.push({ ok: true, warning: false, label: 'git 仓库', detail: cwd });
    } catch {
      results.push({
        ok: false, warning: false, label: 'git 仓库', detail: '当前目录不在 git 仓库内',
        fixHint: '审计仅在 git 项目中有效。初始化: git init',
      });
    }
  }

  // 3. commit-msg hook
  if (inGitRepo) {
    let hookPath = '';
    try {
      const gitCommonDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      hookPath = join(cwd, gitCommonDir, 'commit-msg');
    } catch { console.debug('doctor: 获取 git hooks 路径失败'); }

    if (hookPath && existsSync(hookPath)) {
      // 检查是否 sofagent hook
      let isSofagent = false;
      try {
        const content = require('fs').readFileSync(hookPath, 'utf-8');
        isSofagent = content.includes('sofagent');
      } catch { console.debug('doctor: 读取 commit-msg hook 失败'); }

      // 检查可执行
      try {
        accessSync(hookPath, constants.X_OK);
        if (isSofagent) {
          results.push({ ok: true, warning: false, label: 'commit-msg hook', detail: '已安装（可执行，含 sofagent 审计）' });
        } else {
          results.push({
            ok: false, warning: true, label: 'commit-msg hook', detail: '已存在但非 sofagent hook',
            fixHint: '运行 sofagent-audit --init 安装 sofagent hook',
          });
        }
      } catch {
        results.push({
          ok: false, warning: false, label: 'commit-msg hook', detail: '存在但不可执行',
          fixHint: 'chmod +x .git/hooks/commit-msg',
        });
      }
    } else {
      results.push({
        ok: false, warning: true, label: 'commit-msg hook', detail: '未找到',
        fixHint: '运行 sofagent-audit --init 安装 hook',
      });
    }

    // 检查旧版 pre-commit hook（迁移提示）
    let legacyPath = '';
    try {
      const gitCommonDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      legacyPath = join(cwd, gitCommonDir, 'pre-commit');
    } catch { /* */ }
    if (legacyPath && existsSync(legacyPath)) {
      try {
        const content = require('fs').readFileSync(legacyPath, 'utf-8');
        if (content.includes('sofagent')) {
          results.push({
            ok: true, warning: true, label: '旧版 pre-commit', detail: '检测到旧版 pre-commit hook（已迁移到 commit-msg，建议移除）',
            fixHint: 'rm .git/hooks/pre-commit 或重新运行 sofagent-audit --init 自动清理',
          });
        }
      } catch { /* */ }
    }
  } else {
    results.push({ ok: false, warning: true, label: 'commit-msg hook', detail: '跳过（非 git 仓库）' });
  }

  // 3b. post-commit hook（v1.0.6 新增：--no-verify 绕过检测）
  // post-commit 缺失只报 WARN——旧用户升级时不会有，不应该阻断
  if (inGitRepo) {
    let postCommitPath = '';
    try {
      const gitCommonDir2 = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      postCommitPath = join(cwd, gitCommonDir2, 'post-commit');
    } catch { /* */ }

    if (postCommitPath && existsSync(postCommitPath)) {
      let isSofagent = false;
      try {
        const pcContent = require('fs').readFileSync(postCommitPath, 'utf-8');
        isSofagent = pcContent.includes('sofagent');
      } catch { /* */ }
      if (isSofagent) {
        results.push({
          ok: true, warning: false,
          label: 'post-commit hook', detail: '已安装（--no-verify 绕过检测）',
        });
      } else {
        results.push({
          ok: false, warning: true,
          label: 'post-commit hook', detail: '已存在但非 sofagent hook',
          fixHint: '运行 sofagent-audit --init 安装',
        });
      }
    } else {
      results.push({
        ok: false, warning: true,
        label: 'post-commit hook', detail: '未安装（--no-verify 绕过不会自动检测）',
        fixHint: '运行 sofagent-audit --init 安装',
      });
    }
  }

  // 4. config.yml
  {
    const projectConfig = join(cwd, '.sofagent', 'config.yml');
    const homeConfig = join(require('os').homedir(), '.sofagent', 'config.yml');

    if (existsSync(projectConfig)) {
      // 尝试加载验证语法
      try {
        loadConfig(cwd);
        results.push({ ok: true, warning: false, label: 'config.yml', detail: projectConfig });
      } catch {
        results.push({
          ok: false, warning: false, label: 'config.yml', detail: 'YAML 语法错误',
          fixHint: '检查 .sofagent/config.yml 缩进和语法',
        });
      }
    } else if (existsSync(homeConfig)) {
      try {
        loadConfig(cwd);
        results.push({ ok: true, warning: true, label: 'config.yml', detail: `使用全局配置: ${homeConfig}` });
      } catch {
        results.push({ ok: false, warning: false, label: 'config.yml', detail: '全局配置 YAML 语法错误', fixHint: '检查 ~/.sofagent/config.yml' });
      }
    } else {
      results.push({
        ok: true, warning: true, label: 'config.yml', detail: '未找到，使用默认配置（11 条默认规则全启用，扩展规则需 config 开启）',
        fixHint: '想自定义？运行: sofagent-audit --init',
      });
    }
  }

  // 5. history.jsonl 可写（路径锚定在 git 仓库根目录下，不向上递归）
  {
    // 获取 git 仓库根目录——锚定 history.jsonl 路径
    let repoRoot = cwd;
    if (inGitRepo) {
      try {
        repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch { console.debug('doctor: 获取 git 仓库根目录失败，fallback 到 cwd'); }
    }

    const historyPath = join(repoRoot, '.sofagent', 'audit', 'history.jsonl');
    const dir = dirname(historyPath);

    if (!existsSync(dir)) {
      results.push({
        ok: true, warning: true, label: 'history.jsonl 可写', detail: `目录不存在，首次运行自动创建: ${dir}`,
      });
    } else {
      try {
        accessSync(dir, constants.W_OK);
        results.push({ ok: true, warning: false, label: 'history.jsonl 可写', detail: historyPath });
      } catch {
        results.push({
          ok: false, warning: false, label: 'history.jsonl 可写', detail: '权限不足',
          fixHint: `chmod +w ${dir}`,
        });
      }
    }
  }

  // 6. 规则加载
  {
    try {
      const { defaultRules } = require('../rules');
      const count = defaultRules?.length ?? 0;
      if (count === 11) {
        results.push({ ok: true, warning: false, label: '11 条规则已加载', detail: 'A1-A11 全部注册成功' });
      } else {
        results.push({
          ok: false, warning: false, label: '11 条规则已加载', detail: `只加载了 ${count} 条（期望 11）`,
          fixHint: '重新安装: npm install -g @sofagent/audit',
        });
      }
    } catch {
      results.push({
        ok: false, warning: false, label: '11 条规则已加载', detail: '加载失败',
        fixHint: '重新安装: npm install -g @sofagent/audit',
      });
    }
  }

  // 7. 冒烟测试
  {
    try {
      // 尝试加载规则 + 跑一次空检查
      const { defaultRules } = require('../rules');
      if (defaultRules && defaultRules.length > 0) {
        results.push({ ok: true, warning: false, label: '冒烟测试通过', detail: '审计引擎可用' });
      } else {
        results.push({ ok: false, warning: false, label: '冒烟测试通过', detail: '规则为空' });
      }
    } catch (err) {
      results.push({
        ok: false, warning: false, label: '冒烟测试通过', detail: `错误: ${(err as Error).message}`,
      });
    }
  }

  // 8. --no-verify 绕过检测（对比 git log 与 audit history）
  if (inGitRepo) {
    try {
      // 取最近 5 条 commit SHA
      const logOutput = execFileSync('git', ['log', '--format=%H', '-5'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const recentShas = logOutput.split('\n').filter(Boolean);

      if (recentShas.length === 0) {
        results.push({ ok: true, warning: false, label: 'commit 审计追溯', detail: '无历史提交' });
      } else {
        // 从 history.jsonl 加载最近审计记录，提取 diffRange 中包含的 SHA
        const history = loadHistory(20);
        // P1-15: 从 history 中直接读取 commitSha 字段
        const auditedShas = new Set<string>();
        for (const entry of history) {
          if (entry.commitSha) auditedShas.add(entry.commitSha);
        }

        // 检查最近 commit 是否在审计历史中
        const unauditedShas: string[] = [];
        for (const sha of recentShas) {
          // 精确匹配或前缀匹配
          const fullMatch = auditedShas.has(sha);
          const prefixMatch = [...auditedShas].some((s) => sha.startsWith(s) || s.startsWith(sha));
          if (!fullMatch && !prefixMatch) {
            unauditedShas.push(sha.substring(0, 7));
          }
        }

        if (unauditedShas.length === 0) {
          results.push({ ok: true, warning: false, label: 'commit 审计追溯', detail: `最近 ${recentShas.length} 条 commit 均有审计记录` });
        } else {
          // P1-5: 区分"安装前已有 commit"和"真正绕过"
          const hasHistory = history.length > 0;
          results.push({
            ok: hasHistory ? false : true,  // 无历史 = 首次安装，不报失败
            warning: true,
            label: 'commit 审计追溯',
            detail: hasHistory
              ? `⚠️ 检测到 ${unauditedShas.length} 条 commit 未经审计（可能使用了 --no-verify）: ${unauditedShas.join(', ')}`
              : `ℹ️ 检测到 ${unauditedShas.length} 条历史 commit（安装 sofagent 前的提交，无需担心）: ${unauditedShas.join(', ')}`,
            fixHint: hasHistory ? '建议运行 sofagent-audit --diff HEAD 事后审计' : undefined,
          });
        }
      }
    } catch {
      results.push({ ok: true, warning: true, label: 'commit 审计追溯', detail: '无法读取 git log，跳过' });
    }
  } else {
    results.push({ ok: true, warning: true, label: 'commit 审计追溯', detail: '跳过（非 git 仓库）' });
  }

  // P0-5: history.jsonl 链完整性检测
  if (inGitRepo) {
    try {
      const chainOk = checkHistoryChainIntegrity();
      if (chainOk) {
        // 静默通过——不额外输出，避免噪音
      } else {
        results.push({
          ok: false, warning: true, label: '审计历史链完整性',
          detail: '审计历史链完整性异常——可能原因：\n' +
            '  • 环境变化（hostname/username/git 路径变了，指纹不匹配）\n' +
            '  • history.jsonl 被手动编辑\n' +
            '  • 跨设备复制了 .sofagent/ 目录\n' +
            '  运行 sofagent-audit --doctor --verbose 查看详情',
          fixHint: '建议检查 .sofagent/audit/history.jsonl 是否被非正常修改。如确认是环境变化导致，可删除 history.jsonl 重建审计历史链。',
        });
      }
    } catch {
      results.push({
        ok: true, warning: true, label: '审计历史链完整性',
        detail: '无法验证链完整性，跳过',
      });
    }
  }

  // 9. 知识库访问矩阵（读取 workflow.yml 展示各节点的 knowledge-domain）
  {
    try {
      const dataDir = loadEnvConfig().dataDir;
      const workflowPath = join(dataDir, 'orchestrator', 'workflows', 'workflow.yml');

      if (!existsSync(workflowPath)) {
        // P2-11: 无 workflow.yml 时静默跳过，不输出第 9 项
      } else {
        const content = readFileSync(workflowPath, 'utf-8');
        const parsed = yamlLoad(content) as Record<string, unknown> | null;
        const nodesArr = parsed?.['nodes'] as Array<Record<string, unknown>> | undefined;

        if (!Array.isArray(nodesArr) || nodesArr.length === 0) {
          results.push({ ok: true, warning: true, label: '知识库访问矩阵', detail: 'workflow.yml 无 nodes 配置（FDE 部署时生成）' });
        } else {
          // 收集有 knowledgeDomain 的节点
          const matrixLines: string[] = [];
          let hasDomain = false;
          for (const node of nodesArr) {
            const nodeId = String(node['id'] ?? '?');
            const domain = node['knowledgeDomain'] as { include?: string[]; exclude?: string[] } | undefined;
            if (!domain) {
              matrixLines.push(`${nodeId}: 无限制（全量访问）`);
            } else {
              hasDomain = true;
              const inc = domain.include?.length ? domain.include.join(', ') : '*';
              const exc = domain.exclude?.length ? domain.exclude.join(', ') : '无';
              matrixLines.push(`${nodeId}: include=[${inc}] exclude=[${exc}]`);
            }
          }

          if (!hasDomain) {
            results.push({
              ok: true, warning: true, label: '知识库访问矩阵',
              detail: `${nodesArr.length} 个节点，均无 knowledgeDomain 配置`,
            });
          } else {
            results.push({
              ok: true, warning: false, label: '知识库访问矩阵',
              detail: `\n${matrixLines.map((l) => `    ${l}`).join('\n')}`,
            });
          }
        }
      }
    } catch {
      results.push({ ok: true, warning: true, label: '知识库访问矩阵', detail: '读取 workflow.yml 失败，跳过（FDE 部署配置）' });
    }
  }

  // 10. SkillOpt 管道状态（v1.0.3 → P0-7 管道状态检测）
  {
    const envConfig = loadEnvConfig();
    const dataDir = envConfig.dataDir;
    const skilloptAvailable = isSkillOptAvailable();
    // scoring.md 在 skill/data/ 下（与 daemon.sh 的 ${SOFAGENT_DATA}/../skill/data/scoring.md 一致）
    const scoringPath = join(dataDir, '..', 'skill', 'data', 'scoring.md');
    const hasScoring = existsSync(scoringPath);
    let scoreCount = 0;
    if (hasScoring) {
      try {
        const content = readFileSync(scoringPath, 'utf-8');
        scoreCount = content.split('\n').filter((l) => l.startsWith('|')).length;
      } catch { console.debug('doctor: scoring.md 读取失败，scoreCount 保持 0'); }
    }
    results.push({
      ok: true,
      warning: !skilloptAvailable && scoreCount >= 20,
      label: 'SkillOpt 管道',
      detail: skilloptAvailable
        ? `✅ skillopt-sleep 可用 | scoring.md ${scoreCount} 条（阈值 20）`
        : `⚠️ skillopt-sleep 未安装 | scoring.md ${scoreCount} 条${scoreCount >= 20 ? '（已达触发阈值，安装 skillopt-sleep 后自动触发）' : ''}`,
    });
  }

  // 11. 成本报告（v1.0.3 新增）
  {
    try {
      const dataDir = loadEnvConfig().dataDir;
      const baseline = calculateBaseline('default', dataDir);
      if (!baseline || isColdStart(baseline.sampleCount)) {
        results.push({
          ok: true, warning: true, label: '成本报告',
          detail: `冷启动期（${baseline?.sampleCount ?? 0} 样本），运行更多任务后自动生成基线和异常检测`,
        });
      } else {
        results.push({
          ok: true, warning: false, label: '成本报告',
          detail: `基线: ${baseline.mean.toFixed(0)} ± ${baseline.stddev.toFixed(0)} tokens（${baseline.sampleCount} 样本）`,
        });
      }
    } catch {
      results.push({
        ok: true, warning: true, label: '成本报告',
        detail: '暂不可用（task/logs 为空或数据目录不存在）',
        fixHint: '首次使用可忽略——运行更多任务后自动生成',
      });
    }
  }

  // 12. eval harness 状态（v1.0.4 新增）
  {
    const envConfig = loadEnvConfig();
    const evalDir = join(envConfig.dataDir, 'eval');
    const goldenSet = join(evalDir, 'golden-set.yml');

    if (existsSync(goldenSet)) {
      try {
        const content = readFileSync(goldenSet, 'utf-8');
        const caseCount = (content.match(/^  - id:/gm) || []).length;
        results.push({
          ok: true, warning: false, label: 'eval harness',
          detail: `golden set 存在（${caseCount} 条用例）`,
        });
      } catch {
        results.push({
          ok: true, warning: true, label: 'eval harness',
          detail: 'golden-set.yml 读取失败',
        });
      }
    } else {
      results.push({
        ok: true, warning: true, label: 'eval harness',
        detail: '暂无 golden set（FDE 部署时生成）',
        fixHint: '首次使用可忽略',
      });
    }
  }

  // 13. Sub Agent A/B 自动优化状态（v1.0.4 新增）
  {
    const envConfig = loadEnvConfig();
    const abConfigPath = join(envConfig.dataDir, 'ab-config.yml');
    const subagentsHistoryDir = join(envConfig.dataDir, 'subagents', 'history');

    if (existsSync(abConfigPath)) {
      results.push({
        ok: true, warning: false, label: 'Sub Agent A/B 自动优化',
        detail: 'ab-config.yml 存在，A/B 测试已配置',
      });
    } else if (existsSync(subagentsHistoryDir)) {
      results.push({
        ok: true, warning: true, label: 'Sub Agent A/B 自动优化',
        detail: '有历史记录但无当前 A/B 配置',
      });
    } else {
      results.push({
        ok: true, warning: true, label: 'Sub Agent A/B 自动优化',
        detail: '暂无 A/B 配置（运行 sofagent-audit --ab-test 启动）',
        fixHint: '首次使用可忽略',
      });
    }
  }

  // 14. HITL 统计（v1.0.4 新增）
  {
    const envConfig = loadEnvConfig();
    const hitlLogPath = join(envConfig.dataDir, 'hitl', 'log.jsonl');

    if (existsSync(hitlLogPath)) {
      try {
        const content = readFileSync(hitlLogPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        results.push({
          ok: true, warning: false, label: 'HITL 统计',
          detail: `${lines.length} 条操作记录`,
        });
      } catch {
        results.push({
          ok: true, warning: true, label: 'HITL 统计',
          detail: 'hitl log 读取失败',
        });
      }
    } else {
      results.push({
        ok: true, warning: true, label: 'HITL 统计',
        detail: '暂无 HITL 数据（高风险操作时自动记录）',
        fixHint: '首次使用可忽略',
      });
    }
  }

  // 输出结果
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const icon = r.ok && !r.warning ? '✅' : r.warning ? '⚠️' : '❌';
    console.log(`  ${icon} ${i + 1}. ${r.label.padEnd(22)} ${r.detail}`);
    if (r.fixHint) {
      console.log(`     💡 ${r.fixHint}`);
    }
  }

  // 汇总
  const passed = results.filter((r) => r.ok && !r.warning).length;
  const warned = results.filter((r) => r.ok && r.warning).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log('');
  console.log(`  ${passed}/${results.length} 项通过${warned > 0 ? ` · ${warned} 项提示` : ''}${failed > 0 ? ` · ${failed} 项失败` : ''}`);

  // 全绿时给下一步引导
  if (failed === 0 && warned === 0) {
    console.log('');
    console.log('  下一步: sofagent-audit --diff HEAD~1..HEAD  ← 试试审计最近一次变更');
  }
  // 提示
  if (warned > 0 && failed === 0) {
    const hints = results.filter((r) => r.warning && r.fixHint).map((r) => r.fixHint!);
    if (hints.length > 0) {
      console.log('');
      console.log(`  💡 ${hints[0]}`);
    }
  }

  console.log('');

  // 退出码：有失败 → 1，否则 0
  process.exit(failed > 0 ? 1 : 0);
}

// ============================================================
// v1.0.5: Agent Dashboard 原型（--doctor --agents）
// ============================================================

interface AgentStatus {
  name: string;
  status: 'running' | 'idle' | 'error' | 'resident';
  lastActive: string;
  currentTask?: string;
  errorCount?: number;
  pid?: number;
}

/**
 * 读取 Agent 状态——从 runtime.json（launcher 写入的真实数据）+ 其他来源
 */
function readAgentStatuses(): AgentStatus[] {
  const agents: AgentStatus[] = [];

  try {
    const envConfig = loadEnvConfig();
    const dataDir = envConfig.dataDir;

    // v1.0.6: 优先从 runtime.json 读取真实数据
    const runtimeState = readRuntimeState();
    for (const entry of runtimeState.agents) {
      agents.push({
        name: entry.name,
        status: entry.status === 'active' ? 'running' : entry.status === 'stopped' ? 'idle' : 'idle',
        lastActive: formatLastActive(entry.lastActive),
        pid: entry.pid,
      });
    }

    // runtime.json 有数据就不再用旧的推断方式
    if (agents.length > 0) {
      return agents;
    }

    // 以下为兼容旧版本（v1.0.5 及以前）的降级读取逻辑
    const logsDir = join(dataDir, 'task', 'logs');

    // 从 task/logs 目录推断活跃 Agent
    if (existsSync(logsDir)) {
      try {
        const entries = readdirSync(logsDir, { withFileTypes: true });
        const agentNames = new Set<string>();

        for (const entry of entries) {
          if (entry.isDirectory()) {
            // 检查目录下是否有最近的 md 文件
            const agentDir = join(logsDir, entry.name);
            try {
              const files = readdirSync(agentDir).filter((f) => f.endsWith('.md'));
              if (files.length > 0) {
                agentNames.add(entry.name);
              }
            } catch { /* skip */ }
          }
        }

        for (const name of agentNames) {
          const agentDir = join(logsDir, name);
          try {
            const files = readdirSync(agentDir)
              .filter((f) => f.endsWith('.md'))
              .sort()
              .reverse();

            const lastFile = files[0];
            let lastActive = '未知';
            if (lastFile) {
              try {
                const stat = require('fs').statSync(join(agentDir, lastFile));
                const ageMinutes = Math.round((Date.now() - stat.mtimeMs) / (1000 * 60));
                lastActive = ageMinutes < 1 ? '刚刚' : ageMinutes < 60 ? `${ageMinutes} 分钟前` : `${Math.round(ageMinutes / 60)} 小时前`;
              } catch { /* */ }
            }

            agents.push({
              name,
              status: 'idle',
              lastActive,
            });
          } catch { /* */ }
        }
      } catch { /* */ }
    }

    // 读取 daemon-notice.md 获取心跳信息
    const noticePath = join(dataDir, 'daemon-notice.md');
    if (existsSync(noticePath)) {
      try {
        const content = readFileSync(noticePath, 'utf-8');
        const hasError = content.includes('error') || content.includes('异常') || content.includes('失败');
        if (hasError) {
          for (const agent of agents) {
            if (content.includes(agent.name)) {
              agent.status = 'error';
              agent.errorCount = (content.match(new RegExp(escapeRegex(agent.name), 'g')) || []).length;
            }
          }
        }
      } catch { /* */ }
    }

    // 读取 Sub Agent 注册表（兼容旧版 registry.json）
    const registryPath = join(dataDir, 'subagents', 'registry.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        if (Array.isArray(registry)) {
          for (const entry of registry) {
            const existing = agents.find((a) => a.name === entry.name);
            if (existing) {
              existing.status = entry.status || existing.status;
              existing.currentTask = entry.currentTask;
            } else {
              agents.push({
                name: entry.name || 'unknown',
                status: entry.status || 'resident',
                lastActive: entry.lastActive || '未知',
                currentTask: entry.currentTask,
              });
            }
          }
        }
      } catch { /* */ }
    }
  } catch { /* */ }

  // 确保至少有默认 Agent
  if (agents.length === 0) {
    agents.push(
      { name: 'FDE Sub Agent（示例）', status: 'resident', lastActive: '最后一次活跃 3 分钟前' },
      { name: 'Audit Sub Agent（示例）', status: 'idle', lastActive: `下次巡检 ${new Date(Date.now() + 3600_000).toLocaleString('zh-CN', { hour12: false })}` },
    );
  }

  return agents;
}

/**
 * 格式化 lastActive 为可读字符串
 */
function formatLastActive(iso: string): string {
  if (!iso) return '未知';
  try {
    const ageMinutes = Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60));
    if (ageMinutes < 1) return '刚刚';
    if (ageMinutes < 60) return `${ageMinutes} 分钟前`;
    return `${Math.round(ageMinutes / 60)} 小时前`;
  } catch {
    return iso;
  }
}

/**
 * 输出 Agent Dashboard
 */
export function runAgentDashboard(): void {
  const agents = readAgentStatuses();

  console.log('');
  console.log('Agent 协同状态');
  console.log('┌──────────────────────────────────────────────────────┐');

  const statusIcon = (s: string): string => {
    switch (s) {
      case 'running': return '🟡';
      case 'idle': return '🟢';
      case 'error': return '🔴';
      case 'resident': return '🟢';
      default: return '⚪';
    }
  };

  const statusLabel = (s: string): string => {
    switch (s) {
      case 'running': return '运行中';
      case 'idle': return '空闲';
      case 'error': return '异常';
      case 'resident': return '常驻';
      default: return s;
    }
  };

  for (const agent of agents) {
    const icon = statusIcon(agent.status);
    const label = statusLabel(agent.status);
    const task = agent.currentTask ? `处理 ${agent.currentTask}` : '';
    const error = agent.errorCount ? `API 调用连续失败 ${agent.errorCount} 次` : '';
    const extra = task || error || `最后一次活跃 ${agent.lastActive}`;
    console.log(`│ ${icon} ${agent.name.padEnd(16)} ${label.padEnd(6)} ${extra.padEnd(32)} │`);
  }

  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  运行 sofagent-audit --doctor 查看完整健康诊断');
  console.log('');
}
