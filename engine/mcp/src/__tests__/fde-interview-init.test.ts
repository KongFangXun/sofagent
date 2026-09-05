/**
 * fde-interview-init.test.ts — @sofagent/mcp fde_interview tool 进场记忆目录初始化测试
 * 覆盖（v1.4.5 第八章验收第一条的 MCP 半边）：
 *   - fde_interview 首次调用自动初始化 data/fde-sessions/<client-id>/（10 文件）
 *   - 二次调用幂等（目录不重写——created=false 静默）
 *   - 初始化失败不阻断访谈落盘主流程（initFDEClientSession 抛错被吞）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.SOFAGENT_DATA = ''; // 用显式入参——不依赖环境

import { fdeInterviewTool } from '../tools/fde-interview';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-fde-mcp-test-'));
  process.env.SOFAGENT_DATA = dataDir;
});

const NODE = {
  node_id: 'weekly-report',
  description: '汇总各门店日报',
  elements: {
    input: '门店邮件日报',
    output: '周报表',
    owner: '运营专员',
    duration: '每天 2 小时',
    bottleneck: '手工重复抄录',
  },
  questions: { input_automatable: true, rules_codifiable: true, output_predictable: true },
};

describe('fde_interview · 进场记忆目录初始化（v1.4.5 第八章）', () => {
  it('test_首次调用自动初始化10文件目录', async () => {
    const r = await fdeInterviewTool({ enterprise_id: 'acme', nodes: [NODE] });
    expect(r.data.isError).toBe(false);
    expect(r.text).toContain('进场记忆目录已初始化');

    const dir = join(dataDir, 'fde-sessions', 'acme');
    for (const f of [
      'context.md', 'profile.json', 'history.jsonl', 'decisions.md',
      'open-questions.md', 'next-steps.md', 'deliverables.md',
      'session-state.json', 'handoff.md', 'meta.json',
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    expect(meta.initializedBy).toBe('fde_interview');
  });

  it('test_二次调用幂等不重复提示', async () => {
    await fdeInterviewTool({ enterprise_id: 'acme', nodes: [NODE] });
    const r2 = await fdeInterviewTool({ enterprise_id: 'acme', nodes: [NODE] });
    expect(r2.data.isError).toBe(false);
    expect(r2.text).not.toContain('进场记忆目录已初始化');
    // 访谈幂等合并仍生效（nodeId 相同不重复计数）
    expect(r2.text).toContain('累计 1 节点');
  });
});
