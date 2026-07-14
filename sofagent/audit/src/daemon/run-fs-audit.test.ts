// ============================================================
// run-fs-audit.test.ts · F1/F2 集成测试
// v1.0.9 修复验证：
//   F2：runRules 的 ctx.history 必须被填充，A17 跨审计聚合（历史累计文件数）必须生效。
//   F1：runFilesystemAudit 必须把 "文件变更 → 跑审计 → 写历史" 打通（冒烟）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runRules } from '../rules/runner';
import { clearHistory, appendHistory, loadHistory } from '../audit-history';
import type { AuditConfig } from '../config-loader';
import type { DiffFile } from '../diff-parser';
import { runFilesystemAudit } from './run-fs-audit';

// 独立数据目录，避免污染真实 history.jsonl
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'sofagent-fs-audit-'));

// A17 仅在 extendedRulesEnabled=true 且 A17.enabled=true 时参与运行
const config: AuditConfig = {
  lowRiskPatterns: [],
  testPatterns: [],
  carefulModifyThreshold: 0.2,
  extendedRulesEnabled: true,
  A17: { enabled: true, bulk_threshold: 50, bulk_window_ms: 300000 },
};

function makeFiles(n: number): DiffFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/file${i}.ts`,
    status: 'modified' as const,
    lines: [],
  }));
}

function findA17(rules: { number: number; status: string; details: string[] }[]) {
  return rules.find((r) => r.number === 17);
}

describe('F2: runRules ctx.history 填充 → A17 跨审计聚合并非死代码', () => {
  beforeEach(() => {
    clearHistory(TEST_DATA_DIR);
  });

  it('历史 30 + 当前 30 = 60 ≥ 阈值 50 → A17 必须 WARN，且文案含「历史 30」', () => {
    // 写入一条窗口内（现在）的历史审计，累计 30 个文件变更
    appendHistory(
      {
        timestamp: new Date().toISOString(),
        diffRange: 'daemon:/proj',
        exitCode: 0,
        ruleResults: [],
        diffFileCount: 30,
      },
      TEST_DATA_DIR,
    );

    const diffFiles = makeFiles(30);
    // 显式传入 loadHistory(undefined, TEST_DATA_DIR)，模拟 daemon 侧已写入的历史
    // （注意 loadHistory 签名是 loadHistory(limit?, dataDir?)）
    const results = runRules(diffFiles, [], undefined, false, false, undefined, config, loadHistory(undefined, TEST_DATA_DIR));

    const a17 = findA17(results.rules);
    expect(a17).toBeDefined();
    expect(a17!.status).toBe('WARN');
    // A17 文案：本次 ${current} + 历史 ${history}
    expect(a17!.details.join(' ')).toContain('历史 30');
  });

  it('反向用例：清空历史后仅 30 个当前文件（< 50）→ A17 不应 WARN', () => {
    clearHistory(TEST_DATA_DIR);

    const diffFiles = makeFiles(30);
    const results = runRules(diffFiles, [], undefined, false, false, undefined, config, loadHistory(undefined, TEST_DATA_DIR));

    const a17 = findA17(results.rules);
    expect(a17).toBeDefined();
    expect(a17!.status).not.toBe('WARN');
  });
});

describe('F1: runFilesystemAudit 集成（daemon 复用入口）', () => {
  it('导出可用且签名正确（冒烟，不污染真实历史）', () => {
    expect(typeof runFilesystemAudit).toBe('function');
    // 传入空变更列表不应抛错（daemon 去抖后可能拿到空批次）
    const results = runFilesystemAudit([], process.cwd());
    expect(results).toBeDefined();
    expect(Array.isArray(results.rules)).toBe(true);
    expect(typeof results.exitCode).toBe('number');
  });
});

// ============================================================
// F1 回归（QA Edward）：runFilesystemAudit 的默认配置必须启用 A17
// 根因：原实现调 loadConfig(undefined,false) 命 DEFAULT_CONFIG，其
//   extendedRulesEnabled=false 且无 A17 段 → A17 永远不进规则集 →
//   daemon 默认配置下 A17 是空跑。修复后应在 loadConfig 之后强制启用。
// 本用例不向 runFilesystemAudit 注入 config，强制走默认 loadConfig 路径，
// 证明「默认配置下的 A17 聚合」端到端生效。
// ============================================================
describe('F1 回归（QA Edward）：runFilesystemAudit 默认配置必须启用 A17', () => {
  // 把审计数据目录指向测试临时目录，避免污染真实 history.jsonl
  const ORIG_SOFAGENT_DATA = process.env.SOFAGENT_DATA;

  beforeEach(() => {
    process.env.SOFAGENT_DATA = TEST_DATA_DIR;
    clearHistory(); // 无 dataDir → 走 SOFAGENT_DATA 解析（TEST_DATA_DIR）
  });

  afterEach(() => {
    clearHistory();
    // 还原环境变量，避免影响其他测试块
    if (ORIG_SOFAGENT_DATA === undefined) {
      delete process.env.SOFAGENT_DATA;
    } else {
      process.env.SOFAGENT_DATA = ORIG_SOFAGENT_DATA;
    }
  });

  it('不注入 config（默认 loadConfig）时，历史 30 + 当前 30 ≥ 50 → A17 必须 WARN', () => {
    // 模拟 daemon 此前已累计的 30 个文件变更（窗口内），写入默认数据目录
    appendHistory({
      timestamp: new Date().toISOString(),
      diffRange: 'daemon:/proj',
      exitCode: 0,
      ruleResults: [],
      diffFileCount: 30,
    });

    // 关键：不向 runFilesystemAudit 注入 config，强制走默认 loadConfig 路径。
    // 若 F1 的默认配置未启用 extendedRules + A17，A17 不进规则集，不会 WARN。
    const results = runFilesystemAudit(makeFiles(30).map((f) => f.path), process.cwd());

    const a17 = findA17(results.rules);
    expect(a17).toBeDefined();
    expect(a17!.status).toBe('WARN');
    // A17 文案：本次 ${current} + 历史 ${history}
    expect(a17!.details.join(' ')).toContain('历史 30');
  });
});
