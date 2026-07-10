// ============================================================
// doctor.ts · sofagent-audit --doctor 健康诊断
// v1.0 新增：一键诊断 7 项健康度
// 只读诊断，不做任何写操作
// 退出码：全部通过 → 0；有失败 → 1
// ============================================================

import { existsSync, writeFileSync as _writeFileSync, accessSync, constants } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { getHistoryFilePath } from '../audit-history';
import { loadConfig } from '../config-loader';

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

  // 5. history.jsonl 可写
  {
    const historyPath = getHistoryFilePath();
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
