#!/usr/bin/env node
// ============================================================
// mcp-push-poc.ts · MCP 推送层概念验证
// POC: 不处理边界情况，只验证「文件变化 → 推送」链路
// 监听 task/logs 目录，新文件出现时推送钉钉 webhook
//
// 用法：node dist/mcp-push-poc.js --webhook-url <url>
// 终止：Ctrl+C
// ============================================================

import { watch, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// POC: 不处理边界情况，只验证链路

const DATA_DIR = process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
const LOGS_DIR = join(DATA_DIR, 'task', 'logs');

// --- 解析 --webhook-url 参数 ---
const urlIdx = process.argv.indexOf('--webhook-url');
const webhookUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : undefined;

if (!webhookUrl) {
  console.error('用法: node dist/mcp-push-poc.js --webhook-url <dingtalk-webhook-url>');
  console.error('也可设置 SOFAGENT_WEBHOOK_URL 环境变量');
  process.exit(1);
}

if (!existsSync(LOGS_DIR)) {
  console.error(`目录不存在: ${LOGS_DIR}`);
  console.error('请确保 SOFAGENT_DATA 环境变量指向正确的 .sofagent 目录');
  process.exit(1);
}

console.log(`🔔 MCP 推送层 POC 启动`);
console.log(`   监听目录: ${LOGS_DIR}`);
console.log(`   推送目标: ${webhookUrl}`);
console.log('   等待新日志文件... (Ctrl+C 终止)\n');

// --- 监听目录变化 ---
watch(LOGS_DIR, (eventType, filename) => {
  // POC: 不处理边界情况，只验证链路
  if (!filename) return;

  const filepath = join(LOGS_DIR, filename);
  let content: string;
  try {
    content = readFileSync(filepath, 'utf-8');
  } catch {
    return; // 文件可能在 rename 事件中暂时不存在
  }

  // 提取摘要：第一行作为 task 描述
  const summary = content.split('\n')[0] || '(空文件)';

  console.log(`📄 [检测到变化] ${filename}: ${summary}`);

  // 推送到钉钉群
  const body = {
    msgtype: 'text',
    text: {
      content: `📝 sofagent 新任务日志\n${summary}`,
    },
  };

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
    .then(() => console.log(`✅ [推送成功] ${filename}`))
    .catch(() => console.warn(`⚠️  [推送失败] ${filename}（不阻塞）`));
});
