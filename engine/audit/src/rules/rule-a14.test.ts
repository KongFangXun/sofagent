// ============================================================
// rule-a14.test.ts · A14 知识库越权访问——测试
// 覆盖：空日志跳过 / 无 workflow 跳过 / 有 workflow 越权检测 / 域内访问 PASS
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkRuleA14 } from './rule-a14-kb-cross-domain';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 构造带 knowledge/ 路径引用的日志条目
function makeKbEntry(path: string): LogEntry {
  return {
    timestamp: new Date(),
    operation: 'read',
    file: path,
    raw: `读取知识库页面 knowledge/${path}`,
  };
}

// 测试用临时目录——模拟 SOFAGENT_DATA
let tempDataDir: string;

function setupWorkflowYml(content: string): void {
  const wfDir = join(tempDataDir, 'orchestrator', 'workflows');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, 'workflow.yml'), content, 'utf-8');
}

beforeEach(() => {
  // 每个测试创建独立临时目录
  tempDataDir = mkdtempSync(join(tmpdir(), 'sofagent-a14-test-'));
  process.env.SOFAGENT_DATA = tempDataDir;
});

afterEach(() => {
  delete process.env.SOFAGENT_DATA;
  if (existsSync(tempDataDir)) {
    rmSync(tempDataDir, { recursive: true, force: true });
  }
});

describe('A14 知识库越权', () => {
  it('空日志 → 跳过（hybrid 降级）', () => {
    const ctx = makeCtx([makeDiffFile('src/main.ts')], { logEntries: [] });
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('跳过');
  });

  it('有日志但无 workflow.yml → 跳过', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [makeKbEntry('entities/user.md')] }
    );
    // tempDataDir 存在但无 workflow.yml
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('跳过');
  });

  it('有日志 + workflow.yml 无 knowledge-domain 配置 → 跳过', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
  - id: review
`);
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [makeKbEntry('entities/user.md')] }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('跳过');
  });

  it('越权访问：节点 exclude 了 entities/ 但日志引用了 → WARN', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
    knowledgeDomain:
      include:
        - "concepts/**"
        - "summaries/**"
      exclude:
        - "entities/**"
`);
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [makeKbEntry('entities/user.md')] }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('越权');
  });

  it('域内访问：include 包含的路径 → PASS', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
    knowledgeDomain:
      include:
        - "concepts/**"
        - "entities/**"
`);
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [makeKbEntry('concepts/architecture.md')] }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
  });

  it('无 knowledgeDomain 的节点不影响判定', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
  - id: review
    knowledgeDomain:
      include:
        - "concepts/**"
      exclude:
        - "entities/**"
`);
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [makeKbEntry('concepts/test.md')] }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
  });

  it('多条越权 → WARN + 汇总输出', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
    knowledgeDomain:
      include:
        - "summaries/**"
      exclude:
        - "entities/**"
        - "concepts/**"
`);
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      {
        logEntries: [
          makeKbEntry('entities/a.md'),
          makeKbEntry('entities/b.md'),
          makeKbEntry('concepts/c.md'),
          makeKbEntry('concepts/d.md'),
        ],
      }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('越权');
  });

  it('evidenceMode 标注为 hybrid', () => {
    const ctx = makeCtx([makeDiffFile('src/main.ts')], { logEntries: [] });
    const result = checkRuleA14(ctx);
    expect(result.evidenceMode).toBe('hybrid');
  });

  it('ruleClass 标注为 能力拐杖', () => {
    const ctx = makeCtx([makeDiffFile('src/main.ts')], { logEntries: [] });
    const result = checkRuleA14(ctx);
    expect(result.ruleClass).toBe('能力拐杖');
  });

  it('日志中无 knowledge/ 路径引用 → PASS', () => {
    setupWorkflowYml(`
nodes:
  - id: dev
    knowledgeDomain:
      include:
        - "concepts/**"
      exclude:
        - "entities/**"
`);
    const normalEntry: LogEntry = {
      timestamp: new Date(),
      operation: 'write',
      file: 'src/main.ts',
      raw: '修改了 src/main.ts 文件',
    };
    const ctx = makeCtx(
      [makeDiffFile('src/main.ts')],
      { logEntries: [normalEntry] }
    );
    const result = checkRuleA14(ctx);
    expect(result.status).toBe('PASS');
  });
});
