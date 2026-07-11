// ============================================================
// doctor.ts · sofagent-audit --doctor 健康诊断
// v1.0 新增：一键诊断 7 项健康度
// v1.0.1 新增：第 9 项——知识库访问矩阵
// 只读诊断，不做任何写操作
// 退出码：全部通过 → 0；有失败 → 1
// ============================================================

import { existsSync, accessSync, constants, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { loadHistory } from '../audit-history';
import { loadConfig, loadEnvConfig } from '../config-loader';
import { load as yamlLoad } from 'js-yaml';

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

  // 3. pre-commit hook
  if (inGitRepo) {
    let hookPath = '';
    try {
      const gitCommonDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      hookPath = join(cwd, gitCommonDir, 'pre-commit');
    } catch {
      // fallback
    }

    if (hookPath && existsSync(hookPath)) {
      // 检查是否 sofagent hook
      let isSofagent = false;
      try {
        const content = require('fs').readFileSync(hookPath, 'utf-8');
        isSofagent = content.includes('sofagent');
      } catch { /* */ }

      // 检查可执行
      try {
        accessSync(hookPath, constants.X_OK);
        if (isSofagent) {
          results.push({ ok: true, warning: false, label: 'pre-commit hook', detail: '已安装（可执行，含 sofagent 审计）' });
        } else {
          results.push({
            ok: false, warning: true, label: 'pre-commit hook', detail: '已存在但非 sofagent hook',
            fixHint: '运行 sofagent-audit --init 安装 sofagent hook',
          });
        }
      } catch {
        results.push({
          ok: false, warning: false, label: 'pre-commit hook', detail: '存在但不可执行',
          fixHint: 'chmod +x .git/hooks/pre-commit',
        });
      }
    } else {
      results.push({
        ok: false, warning: true, label: 'pre-commit hook', detail: '未找到',
        fixHint: '运行 sofagent-audit --init 安装 hook',
      });
    }
  } else {
    results.push({ ok: false, warning: true, label: 'pre-commit hook', detail: '跳过（非 git 仓库）' });
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
        ok: true, warning: true, label: 'config.yml', detail: '未找到，使用默认配置（11 条规则全启用）',
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
      } catch {
        // fallback 到 cwd
      }
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
        const auditedShas = new Set<string>();
        for (const entry of history) {
          // diffRange 格式如 "HEAD~1..HEAD" 或包含 SHA 的变体
          const range = entry.diffRange || '';
          // 提取 40 位 hex SHA
          const shaMatches = range.match(/[0-9a-f]{7,40}/gi);
          if (shaMatches) {
            for (const sha of shaMatches) {
              auditedShas.add(sha);
            }
          }
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
          results.push({
            ok: false, warning: true, label: 'commit 审计追溯',
            detail: `${unauditedShas.length} 条 commit 未经审计: ${unauditedShas.join(', ')}`,
            fixHint: '可能使用了 git commit --no-verify 绕过审计，或审计历史已清理',
          });
        }
      }
    } catch {
      results.push({ ok: true, warning: true, label: 'commit 审计追溯', detail: '无法读取 git log，跳过' });
    }
  } else {
    results.push({ ok: true, warning: true, label: 'commit 审计追溯', detail: '跳过（非 git 仓库）' });
  }

  // 9. 知识库访问矩阵（读取 workflow.yml 展示各节点的 knowledge-domain）
  {
    try {
      const dataDir = loadEnvConfig().dataDir;
      const workflowPath = join(dataDir, 'orchestrator', 'workflows', 'workflow.yml');

      if (!existsSync(workflowPath)) {
        results.push({ ok: true, warning: true, label: '知识库访问矩阵', detail: '未找到 workflow.yml，跳过（FDE 部署配置，普通用户可忽略）' });
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
  const warned = results.filter((r) => r.warning).length;
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
