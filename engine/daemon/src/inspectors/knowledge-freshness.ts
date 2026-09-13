// ============================================================
// knowledge-freshness.ts · 知识库新鲜度检查
// 检查 knowledge/ 目录是否有 30 天以上的陈旧知识
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

import { resolveKnowledgeDir } from '@sofagent/core';
import type { InspectorResult } from './types';

export function checkKnowledgeFreshness(projectDir: string): InspectorResult {
  // v1.4.9 P1-14：知识库为全局共享数据（{SOFAGENT_HOME}/data/knowledge），v1.2.1 数据目录
  // 重构时本处漏网（手拼 `.sofagent/knowledge`）⇒ 生产恒「No knowledge directory」，
  // 陈旧知识检测长期失效。改用 SSOT 解析器；projectDir 保留仅为 InspectorFn 签名兼容。
  void projectDir;
  const knowledgeDir = resolveKnowledgeDir();
  if (!fs.existsSync(knowledgeDir)) {
    return {
      name: 'knowledge-freshness',
      triggered: false,
      message: 'No knowledge directory',
      severity: 'info',
    };
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let newest = 0;

  function scan(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'shared') continue; // skip shared dir
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else {
        try {
          newest = Math.max(newest, fs.statSync(full).mtimeMs);
        } catch {
          // 跳过无法 stat 的文件
        }
      }
    }
  }
  scan(knowledgeDir);

  if (newest > 0 && newest < thirtyDaysAgo) {
    return {
      name: 'knowledge-freshness',
      triggered: true,
      message:
        'Knowledge has not been updated in 30+ days. Consider running FDE update.',
      severity: 'warning',
    };
  }
  return {
    name: 'knowledge-freshness',
    triggered: false,
    message: 'Knowledge is fresh',
    severity: 'info',
  };
}
