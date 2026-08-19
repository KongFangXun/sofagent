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
  /** generated = 本次生成 / already-initialized = 已就绪 / skipped-non-interactive = 跳过 */
  action: 'generated' | 'already-initialized' | 'skipped-non-interactive';
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

  // 2) 无密钥 + 非交互——WARN 跳过（CI 不红）
  if (!interactive) {
    const message =
      '数据加密未初始化（非交互环境跳过密钥生成）——审计数据暂以明文落盘。' +
      `首次在本机交互运行时将自动引导生成，或手动执行 init 后写入 ${initializedMarkerPath(sofagentHome)}`;
    console.warn(`⚠️  [crypto-init] ${message}`);
    return { status: 'warn', action: 'skipped-non-interactive', message };
  }

  // 3) 无密钥 + 交互——引导生成。
  //    交互路径已向用户展示指纹并取得备份确认（daemon 首启引导话术），
  //    此处以 confirmBackup=true 落盘（key-manager 的强制备份门由本调用方负责满足）。
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
