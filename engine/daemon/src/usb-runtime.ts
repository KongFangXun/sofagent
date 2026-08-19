// ============================================================
// usb-runtime.ts · U 盘便携运行时启动器
// v1.1.9 新增
// ============================================================
//
// 交付一（USB 完整运行时）的运行侧。由 CLI `start --usb-root <path>`
// 进入，流程（严格按架构设计 §4.2 时序）：
//
//   1. verifyUsbSignature() 全量验签——fail-closed：
//      任一失败 → 写安全事件到 <U盘>/.sofagent/security-events.jsonl
//      → process.exit(1)
//   2. 从 <U盘>/federation.json 读 AES key + HMAC key（U 盘即信任根）
//   3. decryptKnowledgeToMemory()——knowledge/*.enc 逐文件解密到
//      内存 Map（明文绝不落盘）
//   4. setupPortableEnv()——在任何 daemon 子系统初始化之前设置
//      SOFAGENT_DATA=<U盘>/.sofagent / OPENCLAW_HOME=<U盘>/.openclaw，
//      后续所有路径解析经 loadEnvConfig().dataDir 自动指向 U 盘
//   5. 启动 daemon 主循环（startCron + startWatching，复用现有路径）
//   6. process.on('exit') → cleanupMemoryKeys()——Buffer.fill(0)
//      清空内存密钥与明文，本机零残留
//
// OpenClaw 便携化审计结论（Q5，T02 验收要求记录）：
//   daemon 不直接 import OpenClaw SDK——channel.ts 经动态 import 加载，
//   本仓内不存在 ~/.openclaw 硬编码路径。config-loader.ts 的标记文件
//   查找涉及 ~/.openclaw/skills/sofagent/.sofagent-data-path，但其
//   优先级低于 SOFAGENT_DATA env——setupPortableEnv() 在 Step 4 已
//   显式设置该 env，OpenClaw 侧若需便携化由 OPENCLAW_HOME env 覆盖
//   （OpenClaw 自身实现职责，本仓只保证注入 env）。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { decryptPayload } from '@sofagent/core';
import { verifyUsbSignature, type VerifyResult } from './usb-signature';
import { parseEncFrame } from './usb-key';
import type { UsbFederationConfig } from './usb-key';

/** 内存中的 knowledge 明文视图（文件名 → 明文 Buffer） */
export type KnowledgeMemoryView = Map<string, Buffer>;

/** 内存密钥持有器——集中管理，退出时统一清零 */
interface MemoryKeyHolder {
  aesKey: Buffer | null;
  hmacKey: Buffer | null;
  knowledge: KnowledgeMemoryView;
}

/** 模块级持有器（cleanupMemoryKeys 需要访问） */
const holder: MemoryKeyHolder = {
  aesKey: null,
  hmacKey: null,
  knowledge: new Map(),
};

let exitHookInstalled = false;

/**
 * U 盘便携运行时主入口。
 *
 * @param usbRoot U 盘根目录（start.command/.sh/.bat 传入的 $PWD）
 * @param projectDir daemon 工作目录（缺省 = usbRoot——监控 U 盘自身）
 */
export async function startUsbRuntime(usbRoot: string, projectDir?: string): Promise<void> {
  const root = path.resolve(usbRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`U 盘根目录不存在：${root}`);
  }

  // ── Step 1: 全量验签（fail-closed） ─────────────────────────
  // 验签密钥来自 U 盘 federation.json 的 hmacKey 字段（U 盘即信任根）
  const federation = loadFederationFromUsb(root);
  if (!federation.hmacKey) {
    writeSecurityEvent(root, 'hmac-key-missing', 'federation.json 缺 hmacKey 字段');
    exitWithRefusal('federation.json 缺 hmacKey 字段——U 盘未经 create-usb-key 正确初始化');
  }
  holder.hmacKey = Buffer.from(federation.hmacKey!, 'hex');

  const verifyResult = verifyUsbSignature(root, holder.hmacKey);
  if (!verifyResult.ok) {
    writeSecurityEvent(root, `verify-failed:${verifyResult.reason ?? 'unknown'}`, describeVerifyFailure(verifyResult));
    exitWithRefusal(`U 盘验签失败（${verifyResult.reason}）——拒绝启动。${describeVerifyFailure(verifyResult)}`);
  }

  // ── Step 2: 加载 AES 密钥到内存 ─────────────────────────────
  if (!federation.key) {
    writeSecurityEvent(root, 'aes-key-missing', 'federation.json 缺 key 字段');
    exitWithRefusal('federation.json 缺 key 字段——无法解密 knowledge/');
  }
  holder.aesKey = Buffer.from(federation.key!, 'hex');

  // ── Step 3: knowledge/ 内存解密（明文不落盘） ────────────────
  const knowledgeView = decryptKnowledgeToMemory(root, holder.aesKey);
  holder.knowledge = knowledgeView;

  // ── Step 4: 便携化 env（必须先于任何 daemon 子系统初始化） ───
  setupPortableEnv(root);

  // ── Step 5: 退出清零钩子（零残留） ───────────────────────────
  installExitHook();

  // ── Step 6: 启动 daemon 主循环（复用现有 cron + fs-watch） ───
  const workDir = projectDir ?? root;
  const { startCron } = await import('./cron');
  const { startWatching } = await import('./fs-watch');
  const { runFilesystemAudit } = await import('./run-fs-audit');

  console.log(`  ✅ U 盘验签通过（${knowledgeView.size} 个 knowledge 文件已内存解密）`);
  startCron(workDir);
  console.log('  ✅ cron 定时任务已启动（USB 便携模式）');

  const watcher = startWatching(workDir, (changedFiles) => {
    console.log(`  📁 检测到 ${changedFiles.length} 个文件变更`);
    const result = runFilesystemAudit(changedFiles, workDir);
    if (result.exitCode > 0) {
      console.warn(`  ⚠️  审计发现问题: ${result.rules.filter((r) => r.status !== 'PASS').length} 项`);
    } else {
      console.log('  ✅ 审计通过');
    }
  });
  console.log('  ✅ 文件监听已启动');
  console.log('  🔐 联邦在线（U 盘身份 + 知识已加载）——拔盘前请 Ctrl+C 停止');

  process.on('SIGINT', () => {
    console.log('\n  正在停止守护进程（USB 模式）...');
    watcher.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    watcher.stop();
    process.exit(0);
  });

  // 保持进程运行
  setInterval(() => {}, 60000);
}

/**
 * 解密 knowledge/*.enc 到内存 Map。
 *
 * 单文件解密失败（帧损坏 / tag 不匹配）不阻塞启动——记 warning
 * 跳过该文件（best-effort；验签已过说明文件未被篡改，失败多为
 * 密钥轮换遗留）。
 *
 * @returns 文件名（不含 .enc 后缀）→ 明文 Buffer
 */
export function decryptKnowledgeToMemory(usbRoot: string, aesKey: Buffer): KnowledgeMemoryView {
  const view: KnowledgeMemoryView = new Map();
  const knowledgeDir = path.join(usbRoot, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return view;
  for (const name of fs.readdirSync(knowledgeDir)) {
    if (!name.endsWith('.enc')) continue;
    const absPath = path.join(knowledgeDir, name);
    if (!fs.statSync(absPath).isFile()) continue;
    const frame = fs.readFileSync(absPath);
    const parsed = parseEncFrame(frame);
    if (!parsed) {
      console.warn(`  ⚠️  knowledge/${name} 帧格式损坏——跳过`);
      continue;
    }
    try {
      const plaintext = decryptPayload(aesKey, parsed.iv, parsed.ciphertext, parsed.tag);
      view.set(name.slice(0, -'.enc'.length), plaintext);
    } catch (err) {
      console.warn(`  ⚠️  knowledge/${name} 解密失败：${(err as Error).message}——跳过`);
    }
  }
  return view;
}

/**
 * 设置便携化 env——所有路径指向 U 盘，禁用本机 ~/.sofagent / ~/.openclaw。
 *
 * 必须在任何 daemon 子系统（cron / fs-watch / federation / loadEnvConfig）
 * 初始化之前调用——loadEnvConfig().dataDir 读 SOFAGENT_DATA env，
 * 设置后全链路自动指向 U 盘。
 */
export function setupPortableEnv(usbRoot: string): void {
  const root = path.resolve(usbRoot);
  const sofagentData = path.join(root, '.sofagent');
  const openclawHome = path.join(root, '.openclaw');
  fs.mkdirSync(sofagentData, { recursive: true });
  fs.mkdirSync(openclawHome, { recursive: true });
  process.env.SOFAGENT_DATA = sofagentData;
  process.env.OPENCLAW_HOME = openclawHome;
}

/**
 * 清空内存密钥与 knowledge 明文（Buffer.fill(0)）。
 * process.on('exit') 注册——正常退出 / SIGINT / SIGTERM 均触发。
 */
export function cleanupMemoryKeys(): void {
  if (holder.aesKey) {
    holder.aesKey.fill(0);
    holder.aesKey = null;
  }
  if (holder.hmacKey) {
    holder.hmacKey.fill(0);
    holder.hmacKey = null;
  }
  for (const plaintext of holder.knowledge.values()) {
    plaintext.fill(0);
  }
  holder.knowledge.clear();
}

// ============================================================
// 内部实现
// ============================================================

/** 从 U 盘读 federation.json（含 key / hmacKey 扩展字段） */
function loadFederationFromUsb(usbRoot: string): UsbFederationConfig {
  const fedPath = path.join(usbRoot, 'federation.json');
  if (!fs.existsSync(fedPath)) {
    exitWithRefusal(`federation.json 不存在（${fedPath}）——非 sofagent U 盘或已格式化`);
  }
  try {
    return JSON.parse(fs.readFileSync(fedPath, 'utf-8')) as UsbFederationConfig;
  } catch {
    exitWithRefusal('federation.json JSON 解析失败——文件损坏');
  }
}

/** 写安全事件到 <U盘>/.sofagent/security-events.jsonl（best-effort） */
function writeSecurityEvent(usbRoot: string, event: string, detail: string): void {
  try {
    const dir = path.join(usbRoot, '.sofagent');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), event, detail }) + '\n';
    fs.appendFileSync(path.join(dir, 'security-events.jsonl'), line, 'utf-8');
  } catch {
    // U 盘只读等场景——安全事件写不进去也不影响 fail-closed 退出
  }
}

/** fail-closed 拒绝启动（exit 前清内存密钥） */
function exitWithRefusal(message: string): never {
  console.error(`  ⛔ ${message}`);
  cleanupMemoryKeys();
  process.exit(1);
}

/** 验签失败的人类可读描述 */
function describeVerifyFailure(result: VerifyResult): string {
  const files = result.mismatchedFiles?.slice(0, 5).join(', ') ?? '';
  const suffix = result.mismatchedFiles && result.mismatchedFiles.length > 5 ? ` 等 ${result.mismatchedFiles.length} 个` : '';
  switch (result.reason) {
    case 'signature-missing':
      return '签名文件 .sofagent-signature 缺失（整盘格式化或非 sofagent U 盘）';
    case 'parse-error':
      return '签名文件损坏（非合法 JSON）';
    case 'file-missing':
      return `签名清单内文件被删除：${files}${suffix}`;
    case 'file-added':
      return `多余文件被拖入：${files}${suffix}`;
    case 'signature-mismatch':
      return `文件内容被篡改：${files}${suffix}`;
    default:
      return '未知验签失败';
  }
}

/** 注册退出清零钩子（幂等） */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', cleanupMemoryKeys);
}
