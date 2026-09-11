// ============================================================
// crypto-init.ts · daemon 首启数据加密引导
// v1.3.8 交付二 新增
//
// 职责（dev-prompt 交付二第 3 条）：
//   首次运行无密钥 → 引导生成（打印 SHA-256 指纹前 16 位 + 要求确认
//   已备份）；非交互环境（CI / 无 TTY）跳过生成 + WARN 不 FAIL
//   （不能因为没密钥把 CI 搞红——加密是渐进启用的能力）。
//   完成后写 initialized 标记，此后不再重复引导。
//
// 接线点：daemon start（cli.ts）启动时调用。加密挂点在
//   engine/audit/src/audit-history.ts（appendHistory/loadHistory）——
//   本模块只管密钥生命周期，不管数据读写。
// ============================================================

import {
  generateDataKey,
  loadDataKey,
  keyFingerprint,
  writeInitializedMarker,
  isInitialized,
  initializedMarkerPath,
} from '@sofagent/core';

/** 引导结果 */
export interface CryptoInitResult {
  /** ok = 密钥就绪；warn = 跳过（非交互无密钥——不 FAIL） */
  status: 'ok' | 'warn';
  /** generated = 本次生成 / already-initialized = 已就绪 / skipped-non-interactive = 非交互跳过 / skipped-unconfirmed = 确认未通过（超时/拒绝/无效 env） */
  action: 'generated' | 'already-initialized' | 'skipped-non-interactive' | 'skipped-unconfirmed';
  /** 密钥指纹前 16 位（核对备份用；skipped 时无） */
  fingerprint?: string;
  /** 人读消息（daemon 日志输出） */
  message: string;
}

export interface CryptoInitOptions {
  /**
   * 是否交互环境（有 TTY 可走「指纹确认 + 备份确认」引导）。
   * 默认按 process.stdout.isTTY 判定；测试可显式注入。
   */
  interactive?: boolean;
  /**
   * v1.4.8 F-20: 确认回调注入点——缺省走真实 stdin 交互；测试注入 () => true
   * 模拟用户确认（无 stdin 的自动化环境不挂起）。回调返回 true = 已确认备份。
   */
  confirmBackupInput?: () => boolean;
}

/**
 * 首启加密引导。
 *
 * 决策表：
 *   - 有密钥 → ok / already-initialized（幂等）
 *   - 无密钥 + interactive → 生成（confirmBackup=true——交互引导已展示指纹，
 *     由本函数代表用户完成确认落盘）+ 写标记 → ok / generated
 *   - 无密钥 + 非交互 → WARN 不 FAIL（跳过生成——密钥生成必须有人确认备份，
 *     无人值守环境静默生成一个没人备份的密钥比不加密更危险）
 *
 * @param sofagentHome SOFAGENT_HOME 目录（默认 ~/.sofagent）
 * @param options interactive 覆盖
 */
export function initDataEncryption(
  sofagentHome: string,
  options: CryptoInitOptions = {},
): CryptoInitResult {
  const interactive = options.interactive ?? Boolean(process.stdout.isTTY);

  // 1) 已有密钥——幂等直接 ok（补写标记防半程中断残留）
  const existing = loadDataKey(sofagentHome);
  if (existing !== null) {
    if (!isInitialized(sofagentHome)) writeInitializedMarker(sofagentHome);
    const fingerprint = keyFingerprint(existing);
    return {
      status: 'ok',
      action: 'already-initialized',
      fingerprint,
      message: `数据加密密钥就绪（指纹 ${fingerprint}）——审计数据将以 AES-256-GCM 落盘`,
    };
  }

  if (process.env.SOFAGENT_CONFIRM_BACKUP === '1') {
    const generated = generateDataKey(sofagentHome, { confirmBackup: true });
    writeInitializedMarker(sofagentHome);
    console.log(`🔐 [crypto-init] 数据加密密钥已生成（SOFAGENT_CONFIRM_BACKUP=1 显式确认）`);
    console.log(`    指纹（SHA-256 前 16 位）：${generated.fingerprint}`);
    console.log(`    ⚠️ 请立即离线备份该密钥（丢失后加密数据永久不可读）：见 keys/data.key`);
    return {
      status: 'ok',
      action: 'generated',
      fingerprint: generated.fingerprint,
      message: `数据加密密钥已生成（指纹 ${generated.fingerprint}）——env 显式确认通道`,
    };
  }
  if (process.env.SOFAGENT_CONFIRM_BACKUP !== undefined && process.env.SOFAGENT_CONFIRM_BACKUP !== '1') {
    const message =
      '数据加密未初始化——SOFAGENT_CONFIRM_BACKUP 已设置但值非 "1"（不视为有效确认）。' +
      '密钥生成需显式确认备份（SOFAGENT_CONFIRM_BACKUP=1），或在本机交互运行引导。';
    console.warn(`⚠️  [crypto-init] ${message}`);
    return { status: 'warn', action: 'skipped-unconfirmed', message };
  }
  // 2) 无密钥 + 非交互——WARN 跳过（CI 不红）
  if (!interactive) {
    const message =
      '数据加密未初始化（非交互环境跳过密钥生成）——审计数据暂以明文落盘。' +
      `首次在本机交互运行时将自动引导生成，或手动执行 init 后写入 ${initializedMarkerPath(sofagentHome)}`;
    console.warn(`⚠️  [crypto-init] ${message}`);
    return { status: 'warn', action: 'skipped-non-interactive', message };
  }

  // 3) 无密钥 + 交互——引导生成。
  //    v1.4.8 F-20: 真实确认门落地——此前注释假设「daemon 首启话术已取得确认」
  //    直接 confirmBackup=true 断言架空强制备份门（密钥先落盘、指纹后打印、
  //    全程零交互；用户丢机 = 加密数据永久不可读）。现在：
  //      - 交互 TTY：先打印指纹预览不可行（密钥未生成）——改为生成前显式
  //        readline 等待用户输入确认「我已理解密钥须离线备份」；
  //      - 非交互 + SOFAGENT_CONFIRM_BACKUP=1：无头部署显式确认通道
  //        （enterprise-deploy.md 批量激活 SOP 引用本 env）；
  //      - 非交互 + 未设 env：保持 WARN 跳过（上方分支，措辞已含风险）。
  // 交互 TTY：同步等待用户确认（30s 超时降级 WARN——无人应答不落盘）；
  // 测试/自动化注入 confirmBackupInput 通道优先
  const confirmed = options.confirmBackupInput
    ? options.confirmBackupInput()
    : awaitInteractiveBackupConfirm(sofagentHome);
  if (!confirmed) {
    const message =
      '数据加密未初始化（备份确认超时/被拒）——密钥未生成。' +
      `重新运行 daemon start 并确认，或无头环境设 SOFAGENT_CONFIRM_BACKUP=1`;
    console.warn(`⚠️  [crypto-init] ${message}`);
    return { status: 'warn', action: 'skipped-unconfirmed', message };
  }
  const generated = generateDataKey(sofagentHome, { confirmBackup: true });
  writeInitializedMarker(sofagentHome);
  console.log(`🔐 [crypto-init] 数据加密密钥已生成`);
  console.log(`    指纹（SHA-256 前 16 位）：${generated.fingerprint}`);
  console.log(`    ⚠️ 请立即离线备份该密钥（丢失后加密数据永久不可读）：见 keys/data.key`);
  return {
    status: 'ok',
    action: 'generated',
    fingerprint: generated.fingerprint,
    message: `数据加密密钥已生成（指纹 ${generated.fingerprint}）——请确认已离线备份`,
  };
}


// ============================================================
// v1.4.8 F-20: 交互备份确认门——同步 readline + 30s 超时降级
// ============================================================

/**
 * 交互 TTY 下等待用户确认「已理解密钥须离线备份」。
 * 任何输入以 y/yes/是 开头视为确认；其余（含超时静默）视为拒绝。
 * 非真实 TTY 直接返回 false（防脚本管道里 readFileSync(0) 挂死）。
 */
function awaitInteractiveBackupConfirm(sofagentHome: string): boolean {
  const { createInterface } = require('readline') as typeof import('readline');
  console.log(`🔐 [crypto-init] 即将生成数据加密密钥（落盘 ${sofagentHome}/keys/data.key）`);
  console.log('    ⚠️ 密钥丢失 = 加密数据永久不可读——生成前请确认你已理解须离线备份。');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answered = false;
  let confirmed = false;
  const timer = setTimeout(() => {
    if (!answered) {
      rl.close();
    }
  }, 30_000);
  try {
    // execSync 形态的单问题同步等待——daemon 启动路径不能改异步签名（调用方为同步流）
    const { execSync } = require('child_process') as typeof import('child_process');
    let answer = '';
    try {
      answer = execSync('head -1 /dev/stdin', {
        input: undefined,
        timeout: 30_000,
        stdio: ['inherit', 'pipe', 'pipe'],
      }).toString().trim();
    } catch {
      return false;
    }
    answered = true;
    confirmed = /^(y|yes|是)/i.test(answer);
  } finally {
    clearTimeout(timer);
    try { rl.close(); } catch { /* 已关 */ }
  }
  return confirmed;
}
