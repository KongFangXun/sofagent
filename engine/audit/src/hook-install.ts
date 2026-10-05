// ============================================================
// hook-install.ts · git hook 安装核心（v1.5.6 T1/T4 抽取）
// 从 index.ts installHook 与 commands/init.ts 抽出的共享安装逻辑：
//   - resolveHooksDir：尊重 core.hooksPath（T1——此前硬编码 .git/hooks，
//     repo 配置了自定义 hooks 目录时装到 .git/hooks，git 根本不会执行，
//     等于没装、doctor 还误报未安装）
//   - preserveUserHook + buildChainedContent：接管既有用户自有 hook 时
//     链式保留（T4——此前直接覆盖，用户自己的 pre-commit/commit-msg 静默丢失）
// index.ts 的 --install-hook 与 init.ts 的 hooksDir 定位统一消费本模块。
// ============================================================

import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { computeDistAggregateHash } from '@sofagent/core';

/**
 * 解析**全局安装**的 `@sofagent/audit` 包根（v1.5.4 #14）。
 * 与 `engine/audit/hooks/commit-msg` 的全局分支**同源解析**：只走显式全局根
 * （execPath 推导 lib/node_modules + `npm root -g`），**不走 PATH**、不含被审仓
 * node_modules（防投放冒牌包）。解析不到 → null。
 */
function resolveGlobalAuditPkg(): string | null {
  try {
    const out = execFileSync(
      'node',
      [
        '-e',
        [
          "const p=require('path');let e=null;",
          "const r=[p.resolve(p.dirname(process.execPath),'..','lib','node_modules')];",
          "try{r.push(require('child_process').execSync('npm root -g',{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())}catch(x){/*为何可静默：该候选根不可用，解析链按序试下一个根*/}",
          "for(const q of r){try{e=require.resolve('@sofagent/audit',{paths:[q]});break}catch(x){/*为何可静默：该候选根不可用，解析链按序试下一个根*/}}",
          "if(e)process.stdout.write(p.dirname(p.dirname(e)))",
        ].join(''),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** hooks 目录解析结果 */
export interface HooksDirResolution {
  /** git 仓库根（工作树顶层——相对 hooksPath 以此为基准展开） */
  repoRoot: string;
  /** .git 目录绝对路径 */
  gitDir: string;
  /** hook 安装目标目录（core.hooksPath 优先，缺省 $gitDir/hooks） */
  hooksDir: string;
  /** hooksDir 是否来自 core.hooksPath 显式配置 */
  configured: boolean;
  /** core.hooksPath 原始配置值（configured 时存在） */
  configuredValue?: string;
}

/** 从 cwd 向上查找 .git 目录——返回 null 表示不在 git 仓库 */
export function findGitDir(cwd: string): string | null {
  let currentDir: string = cwd;
  for (;;) {
    const candidate = join(currentDir, '.git');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(currentDir);
    if (parent === currentDir) return null;
    currentDir = parent;
  }
}

/**
 * 展开 git config 值中的 ~ / $VAR 前缀——
 * git 自身对 core.hooksPath 支持这类展开，这里对齐同一语义。
 */
function expandConfigPath(value: string): string {
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  if (value.startsWith('~')) return join(homedir(), value.slice(1));
  const envMatch = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (envMatch) {
    const envName = envMatch[1] ?? '';
    const envVal = process.env[envName] ?? '';
    const rest = (envMatch[2] ?? '').replace(/^[/\\]/, '');
    return join(envVal, rest);
  }
  return value;
}

/**
 * git 公共目录（**worktree 安全**）：`--git-common-dir` 是唯一同时覆盖「普通检出」
 * 与「worktree」两种形态的口径——前者返回 `.git`，后者返回主仓的 `.git` 目录。
 * 失败（非 git 仓库 / 旧版 git）返回 null，由调用方退回向上查找结果。
 */
function resolveCommonGitDir(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    }).trim();
    if (!out) return null;
    return isAbsolute(out) ? out : resolve(cwd, out);
  } catch {
    return null;
  }
}

/**
 * 解析 hook 安装目录（T1 核心）：
 *   1. 从 cwd 向上找 .git（与旧 installHook 行为一致）
 *   2. 读 git config core.hooksPath（local/system/global 任一层配置都生效）
 *      - 已配置：相对路径以 repo 顶层为基准 resolve；~ / $VAR 先展开
 *      - 未配置：$gitDir/hooks（git 缺省行为）
 * 非 git 仓库返回 null。
 */
export function resolveHooksDir(cwd: string): HooksDirResolution | null {
  const walked = findGitDir(cwd);
  // worktree 安全：`.git` 在 worktree 里是**文件指针**而非目录，向上找 `.git` 会命中一个
  // 不可用路径 ⇒ hooksDir = `<worktree>/.git/hooks` ⇒ 安装时 ENOTDIR。`--git-common-dir`
  // 在普通检出返回 ".git"、在 worktree 返回**主仓** .git 目录 —— 都指向 git 真正读 hook 的位置。
  const gitDir = resolveCommonGitDir(cwd) ?? walked;
  if (!gitDir) return null;

  let repoRoot = dirname(gitDir);
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    }).trim();
    if (top) repoRoot = top;
  } catch {
    // rev-parse 失败（如 .git 是文件而非目录的 worktree 场景）——退化用 .git 父目录
  }

  let configuredValue: string | undefined;
  try {
    const v = execFileSync('git', ['config', 'core.hooksPath'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    }).trim();
    if (v) configuredValue = v;
  } catch {
    // 未配置——走缺省 .git/hooks
  }

  if (configuredValue) {
    const expanded = expandConfigPath(configuredValue);
    const hooksDir = isAbsolute(expanded) ? expanded : resolve(repoRoot, expanded);
    return { repoRoot, gitDir, hooksDir, configured: true, configuredValue };
  }
  return { repoRoot, gitDir, hooksDir: join(gitDir, 'hooks'), configured: false };
}

/**
 * 检测目标 hook 是否为「非 sofagent 的用户自有 hook」——
 * 是则保存为 <destName>.pre-sofagent（保留可执行位）并返回其文件名，供链式调用；
 * 否则返回 null（无用户 hook 需要保留 / 已是 sofagent hook 走升级覆盖路径）。
 */
export function preserveUserHook(hooksDir: string, destName: string): string | null {
  const destPath = join(hooksDir, destName);
  if (!existsSync(destPath)) return null;
  // F-21②：读失败（权限等）不再按「不存在」处理——原路径会直接覆盖用户 hook，
  // 用户的钩子静默消失。改为保守路径：无法读取 → 也走备份（改名保留原文件）后返回，
  // 让用户能人工核对；copyFileSync 失败时退化为旧行为（不阻塞安装）。
  let content = '';
  let readable = true;
  try {
    content = readFileSync(destPath, 'utf-8');
  } catch {
    readable = false;
    console.warn(`⚠️ [sofagent] 无法读取既有 hook（${destName}）——已按保守路径备份保留，请人工核对`);
  }
  // F-21②：自家 hook 判定从「子串含 sofagent」改为匹配已知头部标记行
  // （子串判定会把用户 hook 里提了一句 sofagent 的情况误判为自家 hook → 覆盖丢失）
  if (readable && /^#\s*sofagent .*hook v[0-9]/m.test(content)) return null; // 自家 hook——升级覆盖
  const preName = `${destName}.pre-sofagent`;
  const prePath = join(hooksDir, preName);
  try {
    copyFileSync(destPath, prePath);
  } catch {
    return null; // 备份失败不阻塞安装（退化为旧行为：直接覆盖）
  }
  try {
    chmodSync(prePath, 0o755); // 保留可执行位——copyFileSync 不保证携带源权限
  } catch {
    // chmod 失败尽力而为（源文件可能本就 644 不可执行，保持原样）
  }
  return preName;
}

/** 链式策略：short-circuit = 用户 hook 失败则短路退出；ignore-rc = 永不因用户 hook 失败退出 */
export type ChainPolicy = 'short-circuit' | 'ignore-rc';

/**
 * 生成链式 hook 内容（T4）：先执行被接管的用户 hook（.pre-sofagent），
 * 再进入 sofagent 模板主体逻辑。
 * - short-circuit：用户 hook 非零退出 → 以同一退出码短路（尊重用户 hook 的阻断语义）
 * - ignore-rc：忽略用户 hook 退出码（post-commit「永不阻断」语义）
 */
export function buildChainedContent(templateContent: string, preHookName: string, policy: ChainPolicy): string {
  const invokeBlock =
    policy === 'short-circuit'
      ? `  "$_SOFAGENT_PRE" "$@"\n  _SOFAGENT_PRE_RC=$?\n  if [ $_SOFAGENT_PRE_RC -ne 0 ]; then exit $_SOFAGENT_PRE_RC; fi`
      : `  "$_SOFAGENT_PRE" "$@" || true`;
  // 剥掉模板自带 shebang——链式 wrapper 自己的 shebang 在第一行
  const body = templateContent.replace(/^#![^\n]*\n/, '');
  return `#!/bin/bash
# ⛓ sofagent hook 链式保留段（安装器自动生成）——安装前检测到用户自有 hook，
#    已保存为 ${preHookName}；本段先执行用户 hook，再进入 sofagent 主体逻辑。
_HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
_SOFAGENT_PRE="$_HOOK_DIR/${preHookName}"
if [ -f "$_SOFAGENT_PRE" ]; then
${invokeBlock}
fi

${body}`;
}

/** 三层防线安装清单（与 v1.4.4 H-01 对齐） */
const HOOK_FILES = ['pre-commit', 'commit-msg', 'post-commit'] as const;

/** 各 hook 的链式策略：post-commit 永不阻断（CRITICAL 契约），其余尊重用户 hook 阻断语义 */
const CHAIN_POLICY: Record<(typeof HOOK_FILES)[number], ChainPolicy> = {
  'pre-commit': 'short-circuit',
  'commit-msg': 'short-circuit',
  'post-commit': 'ignore-rc',
};

/** 安装结果 */
export interface InstallHooksResult {
  /** hook 实际安装目录（core.hooksPath 生效时为配置目录） */
  hooksDir: string;
  /** 是否来自 core.hooksPath 显式配置 */
  configured: boolean;
  /** core.hooksPath 配置的原始值（configured=true 时存在——CLI 提示用） */
  configuredValue?: string;
  /** 各 hook 安装明细 */
  installed: { destName: string; destPath: string; chained: boolean }[];
}

/** 安装选项 */
export interface InstallHooksOptions {
  /** 工作目录（从这里向上找 .git） */
  cwd: string;
  /** hook 模板目录（需含 pre-commit / commit-msg / post-commit 三个文件） */
  templateDir: string;
  /** 日志输出（缺省 console.log；测试注入收集器） */
  log?: (msg: string) => void;
  /** 覆盖既有 sofagent hook 前是否备份 .bak（缺省 true——保持 v1.2.9 起的行为） */
  backupExisting?: boolean;
}

/**
 * 安装三层防线 hook（installOneHook 的共享实现）：
 *   1. resolveHooksDir 定位目标目录（T1：尊重 core.hooksPath）
 *   2. 用户自有 hook → .pre-sofagent 保存 + 链式 wrapper（T4）
 *   3. 旧版 sofagent hook → 升级覆盖前备份 .bak（旧行为保留）
 *   4. 写入模板 + chmod 755
 * @throws 不在 git 仓库 / 模板缺失时抛错（调用方决定退出码与文案）
 */
export function installHooks(opts: InstallHooksOptions): InstallHooksResult {
  const resolution = resolveHooksDir(opts.cwd);
  if (!resolution) {
    throw new Error('当前目录不是 git 仓库。请在 git 仓库内运行此命令，或先 git init。');
  }
  const { hooksDir, configured, configuredValue } = resolution;
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
  const log = opts.log ?? ((m: string) => console.log(m));
  const installed: InstallHooksResult['installed'] = [];

  for (const name of HOOK_FILES) {
    const templatePath = join(opts.templateDir, name);
    if (!existsSync(templatePath)) {
      throw new Error(`hook 模板文件缺失——${templatePath}`);
    }
    const destPath = join(hooksDir, name);

    // T4: 接管用户自有 hook → 保存 .pre-sofagent + 链式 wrapper
    const preName = preserveUserHook(hooksDir, name);
    let content = readFileSync(templatePath, 'utf-8');
    if (preName) {
      content = buildChainedContent(content, preName, CHAIN_POLICY[name]);
      log(`  ⛓ 检测到既有 ${name} hook（非 sofagent）——已保留为 ${preName}，sofagent hook 会先执行它再进入主体逻辑`);
    } else if (existsSync(destPath) && opts.backupExisting !== false) {
      // 旧版 sofagent hook 升级覆盖前备份 .bak（v1.2.9 行为保留）
      try {
        copyFileSync(destPath, join(hooksDir, `${name}.bak`));
        log(`  → 已备份旧 ${name} hook 到 ${join(hooksDir, `${name}.bak`)}`);
      } catch {
        // 备份失败不阻塞安装
      }
    }

    writeFileSync(destPath, content, 'utf-8');
    chmodSync(destPath, 0o755);
    log(`✅ ${name} hook 已安装到 ${destPath}`);
    installed.push({ destName: name, destPath, chained: preName !== null });
  }

  // ── v1.5.4 #28：源码指纹脚本**落地副本** ──────────────────────────
  // hook 只能从可信源执行指纹脚本（原实现按 cwd 相对路径读**被审仓** tools/ 下同名脚本
  // ⇒ 恶意仓可投放 payload 实现任意代码执行 + fail-open 翻转）。故安装时把随包分发的
  // `hooks/audit-src-fingerprint.mjs` 拷到 `$SOFAGENT_HOME/internal/`，hook 优先执行该副本。
  const sofaHome = process.env.SOFAGENT_HOME ?? join(homedir(), '.sofagent');
  const internalDir = join(sofaHome, 'internal');
  try {
    mkdirSync(internalDir, { recursive: true });
    const fpSrc = join(opts.templateDir, 'audit-src-fingerprint.mjs');
    if (existsSync(fpSrc)) {
      const fpDest = join(internalDir, 'audit-src-fingerprint.mjs');
      copyFileSync(fpSrc, fpDest);
      chmodSync(fpDest, 0o755);
      log(`✅ 源码指纹脚本已落地：${fpDest}（hook 只从此副本执行，不执行被审仓内同名脚本）`);
    } else {
      log(`⚠️ 指纹模板缺失（${fpSrc}）——hook 将跳过源码指纹信号（走更严的 fail-closed 分支）`);
    }
  } catch (err) {
    log(`⚠️ 指纹脚本落地失败（${err instanceof Error ? err.message : String(err)}）——hook 将跳过源码指纹信号`);
  }

  // ── v1.5.4 #14 方向 A：安装时建立**全局引擎基准** ──────────────────
  // 死锁根因：全局分支要求 `$SOFAGENT_HOME/internal/audit-global-dist-hash.txt`，而唯一
  // 生成器在仓库 tools/（不在 npm 分发面）⇒ 全局用户无路可建。**安装 hook 这一刻本身就是
  // 用户显式确认「此刻的包可信」的时刻**（与 `--doctor --baseline` 同构），故在此建立。
  // 纪律两条：① 只对**可解析的全局包**建立（解析式与 hook 同源）；② 已有基准**不覆盖**
  // （不重开「用当前哈希自动落锚」的口子——那会把已污染 dist 固化为合法基线）。
  try {
    const globalPkg = resolveGlobalAuditPkg();
    if (globalPkg) {
      const record = join(internalDir, 'audit-global-dist-hash.txt');
      if (existsSync(record)) {
        // F21：原「如需重置」指引指向 `--doctor --baseline`，而旧版 doctor 的全局锚刷新分支
        // 被本地 dist 缺失短路（跑不到）⇒ 两处互相指路成闭环、三路皆不可执行。改为给出
        // **同一可达路径**（与 commit-msg hook 的恢复指引同源）：
        log('ℹ️ 全局引擎基准已存在——本次不覆盖');
        log('   如需刷新（全局包升级后锚陈旧），任选其一：');
        log('     · 仓库内：bash tools/audit-baseline-sync.sh --global（同步全局安装包口径信任锚，不污染本仓锚）');
        log('     · 通用：rm -f ~/.sofagent/internal/audit-global-dist-hash.txt && sofagent audit --install-hook');
        log('     · 通用：sofagent audit --doctor --baseline（新版已脱离本地 dist 依赖）');
        log('   ⚠️ 同版本 npm install -g @sofagent/audit 无效：包内容不变 ⇒ 聚合哈希不变 ⇒ 仍被拦。');
      } else {
        const h = computeDistAggregateHash(join(globalPkg, 'dist'));
        if (h) {
          writeFileSync(record, h + '\n', 'utf-8');
          chmodSync(record, 0o600);
          log(`✅ 全局引擎基准已建立（${record}，聚合哈希 ${h.slice(0, 12)}…）——全局安装用户首次提交不再被「基准缺失」阻断`);
        }
      }
    }
  } catch {
    /* 为何可静默：建立失败不阻塞安装——hook 会给出可达指引（--install-hook / --doctor --baseline），
       且「基准缺失 ⇒ 拦截」语义不因本处失败而放松 */
  }

  return { hooksDir, configured, configuredValue, installed };
}
