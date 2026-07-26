#!/usr/bin/env node
// ============================================================
// sign-config.mjs · config.yml 签名颁发 CLI (DP-2)
// ============================================================
// 用法:
//   node tools/sign-config.mjs path/to/config.yml
//   node tools/sign-config.mjs .sofagent/config.yml
//
// 功能:
//   读 ~/.sofagent-key，对指定 config.yml 算 HMAC-SHA256 签名，
//   把 signature: <hex> 写回 config.yml 顶层。
//
// 签名算法与 @sofagent/core 的 verifyConfigSignature 完全对称：
//   YAML 解析 → 剔除 signature → stableStringify → HMAC-SHA256
//
// 前置条件:
//   - ~/.sofagent-key 存在（chmod 600）
//   - 如不存在，先创建:
//       openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key
// ============================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('用法: node tools/sign-config.mjs <config.yml 路径>');
  console.log('');
  console.log('对 config.yml 计算 HMAC-SHA256 签名并写回顶层 signature 字段。');
  console.log('密钥来源: ~/.sofagent-key');
  console.log('');
  console.log('首次创建密钥:');
  console.log('  openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key');
  process.exit(0);
}

const configPath = args[0];

if (!existsSync(configPath)) {
  console.error(`❌ 配置文件不存在: ${configPath}`);
  process.exit(1);
}

// 密钥预检——给出友好提示
const keyPath = join(homedir(), '.sofagent-key');
if (!existsSync(keyPath)) {
  console.error('❌ 无 ~/.sofagent-key——无法签名。');
  console.error('   先创建密钥:');
  console.error('     openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key');
  process.exit(1);
}

// 动态导入 @sofagent/core（workspace 包，从仓库根运行时可解析）
let signConfig;
try {
  const core = await import('@sofagent/core');
  signConfig = core.signConfig;
} catch {
  // 开发模式下 @sofagent/core 可能未 link，尝试直接从 dist 加载
  try {
    const core = await import(new URL('../engine/core/dist/index.js', import.meta.url).href);
    signConfig = core.signConfig;
  } catch {
    console.error('❌ 无法加载 @sofagent/core。请先构建: npm run build --workspace=engine/core');
    process.exit(1);
  }
}

if (typeof signConfig !== 'function') {
  console.error('❌ @sofagent/core 未导出 signConfig 函数。请确认 core 已构建到最新版本。');
  process.exit(1);
}

try {
  const result = signConfig(configPath);
  if (result === 'updated') {
    console.log(`✅ 签名已更新: ${configPath}`);
  } else {
    console.log(`✅ 已签名: ${configPath}`);
  }
} catch (err) {
  console.error(`❌ 签名失败: ${err.message}`);
  process.exit(1);
}
