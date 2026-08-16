// ============================================================
// persistence.ts · ab-test 结果持久化
// v1.3.6 新增
//
// 写 data/ab-test/latest.json（覆盖写）
// ============================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { AB_TEST_LATEST } from '@sofagent/core';
import type { ABTestResult } from './types';

/**
 * 持久化 ab-test 结果
 *
 * 写 data/ab-test/latest.json（覆盖写），包含：
 * - timestamp
 * - winner / currentScore / candidateScore / margin / consecutiveWins
 *
 * @param result A/B 测试结果
 */
export function persistABTestResult(result: ABTestResult): void {
  const latestPath = AB_TEST_LATEST;

  // 确保目录存在
  const dir = dirname(latestPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const payload = {
    timestamp: new Date().toISOString(),
    winner: result.winner,
    currentScore: result.currentScore,
    candidateScore: result.candidateScore,
    margin: result.margin,
    consecutiveWins: result.consecutiveWins,
  };

  writeFileSync(latestPath, JSON.stringify(payload, null, 2), 'utf-8');
}
