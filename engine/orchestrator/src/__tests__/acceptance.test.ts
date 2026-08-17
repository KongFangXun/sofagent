// acceptance.test.ts · v1.3.6 交付⑨ 测试
//
// 验收标准逐条覆盖：
// - define_acceptance：zod schema 校验 + 持久化 + 重复定义覆盖
// - check_acceptance：四类条件（test/build/grep-absent/schema）结构化结果
// - 未定义 taskId → failedCount=-1（区别于定义了但失败）
// - 通用 MCP tool 定位：纯函数核心不依赖宿主（DSH/LangGraph 均可经 MCP 调）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  validateAcceptanceDefinition,
  saveAcceptanceDefinition,
  loadAcceptanceDefinition,
  checkAcceptance,
} from '../acceptance/acceptance';

// ── 测试隔离工具 ──

let dataDir: string;
let projectRoot: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-acceptance-data-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'sofagent-acceptance-root-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

// ============================================================
// validateAcceptanceDefinition（define 侧 schema 校验）
// ============================================================

describe('validateAcceptanceDefinition', () => {
  it('四类合法条件均通过校验', () => {
    const def = validateAcceptanceDefinition({
      taskId: 'task-1',
      criteria: [
        { type: 'test' },
        { type: 'build', command: 'npm run build' },
        { type: 'grep-absent', pattern: 'TODO-PRODUCT' },
        { type: 'schema', file: 'package.json', requiredFields: ['name', 'version'] },
      ],
    });
    expect(def.taskId).toBe('task-1');
    expect(def.criteria.length).toBe(4);
  });

  it('空 criteria → 校验失败（空条件集合无判定意义）', () => {
    expect(() => validateAcceptanceDefinition({ taskId: 'task-1', criteria: [] })).toThrow();
  });

  it('缺 taskId → 校验失败', () => {
    expect(() => validateAcceptanceDefinition({ criteria: [{ type: 'test' }] })).toThrow();
  });

  it('未知条件类型 → 校验失败', () => {
    expect(() => validateAcceptanceDefinition({ taskId: 't', criteria: [{ type: 'unknown' }] })).toThrow();
  });

  it('grep-absent 缺 pattern → 校验失败', () => {
    expect(() => validateAcceptanceDefinition({ taskId: 't', criteria: [{ type: 'grep-absent' }] })).toThrow();
  });
});

// ============================================================
// 持久化（save / load / 覆盖更新）
// ============================================================

describe('验收定义持久化', () => {
  it('save → load 往返一致', () => {
    const def = validateAcceptanceDefinition({
      taskId: 'task-rt',
      criteria: [{ type: 'schema', file: 'package.json', requiredFields: ['name'] }],
      notes: '往返测试',
    });
    saveAcceptanceDefinition(dataDir, def);
    const loaded = loadAcceptanceDefinition(dataDir, 'task-rt');
    expect(loaded?.taskId).toBe('task-rt');
    expect(loaded?.criteria.length).toBe(1);
    expect(loaded?.notes).toBe('往返测试');
    expect(typeof loaded?.definedAt).toBe('string');
  });

  it('重复 define = 覆盖更新（后写生效）', () => {
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'task-ov', criteria: [{ type: 'test' }], notes: '第一版',
    }));
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'task-ov', criteria: [{ type: 'build' }, { type: 'test' }], notes: '第二版',
    }));
    const loaded = loadAcceptanceDefinition(dataDir, 'task-ov');
    expect(loaded?.notes).toBe('第二版');
    expect(loaded?.criteria.length).toBe(2);
  });

  it('taskId 特殊字符安全化（防路径穿越）', () => {
    const def = validateAcceptanceDefinition({
      taskId: '../evil/path', criteria: [{ type: 'test' }],
    });
    const filePath = saveAcceptanceDefinition(dataDir, def);
    // 文件名不含路径分隔符——落在 acceptance 目录内
    expect(filePath.startsWith(join(dataDir, 'acceptance'))).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  it('未定义的 taskId → load 返回 undefined', () => {
    expect(loadAcceptanceDefinition(dataDir, 'no-such-task')).toBeUndefined();
  });
});

// ============================================================
// checkAcceptance 四类条件执行
// ============================================================

describe('checkAcceptance — grep-absent 条件', () => {
  it('pattern 零命中 → 通过', () => {
    writeFileSync(join(projectRoot, 'clean.txt'), 'nothing bad here');
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'grep-ok', criteria: [{ type: 'grep-absent', pattern: 'FORBIDDEN' }],
    }));
    const r = checkAcceptance(dataDir, 'grep-ok', projectRoot);
    expect(r.ok).toBe(true);
    expect(r.results[0]!.pass).toBe(true);
    expect(r.failedCount).toBe(0);
  });

  it('pattern 命中 → 失败 + detail 含命中文件', () => {
    writeFileSync(join(projectRoot, 'bad.txt'), 'this has FORBIDDEN content');
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'grep-bad', criteria: [{ type: 'grep-absent', pattern: 'FORBIDDEN' }],
    }));
    const r = checkAcceptance(dataDir, 'grep-bad', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.failedCount).toBe(1);
    expect(r.results[0]!.detail).toContain('bad.txt');
  });

  it('指定 path 限定搜索范围（范围外的命中不计入）', () => {
    mkdirSync(join(projectRoot, 'sub'));
    writeFileSync(join(projectRoot, 'sub', 'ok.txt'), 'sub 目录干净');
    writeFileSync(join(projectRoot, 'root-bad.txt'), 'FORBIDDEN 只在根目录');
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'grep-scope',
      criteria: [{ type: 'grep-absent', pattern: 'FORBIDDEN', path: 'sub' }],
    }));
    // 只搜 sub（干净）→ 通过；根目录的 root-bad.txt 被 path 限定排除
    const r = checkAcceptance(dataDir, 'grep-scope', projectRoot);
    expect(r.ok).toBe(true);
    expect(r.results[0]!.pass).toBe(true);
  });
});

describe('checkAcceptance — schema 条件', () => {
  it('必需字段全在 → 通过', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'schema-ok',
      criteria: [{ type: 'schema', file: 'package.json', requiredFields: ['name', 'version'] }],
    }));
    const r = checkAcceptance(dataDir, 'schema-ok', projectRoot);
    expect(r.ok).toBe(true);
  });

  it('缺字段 → 失败 + detail 列出缺失字段', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x' }));
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'schema-bad',
      criteria: [{ type: 'schema', file: 'package.json', requiredFields: ['name', 'version'] }],
    }));
    const r = checkAcceptance(dataDir, 'schema-bad', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.results[0]!.detail).toContain('version');
  });

  it('文件不存在 → 失败', () => {
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'schema-missing',
      criteria: [{ type: 'schema', file: 'nope.json', requiredFields: ['a'] }],
    }));
    const r = checkAcceptance(dataDir, 'schema-missing', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.results[0]!.detail).toContain('不存在');
  });
});

describe('checkAcceptance — test/build 条件（轻量命令）', () => {
  it('exit 0 命令 → test 条件通过', () => {
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'cmd-ok',
      criteria: [{ type: 'test', command: 'true' }],
    }));
    const r = checkAcceptance(dataDir, 'cmd-ok', projectRoot);
    expect(r.ok).toBe(true);
    expect(r.results[0]!.pass).toBe(true);
  });

  it('exit 非 0 命令 → build 条件失败', () => {
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'cmd-bad',
      criteria: [{ type: 'build', command: 'false' }],
    }));
    const r = checkAcceptance(dataDir, 'cmd-bad', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.results[0]!.pass).toBe(false);
    expect(r.results[0]!.detail).toContain('exit');
  });
});

describe('checkAcceptance — 聚合与边界', () => {
  it('多条件全过 → ok=true；一条失败 → ok=false', () => {
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'x' }));
    saveAcceptanceDefinition(dataDir, validateAcceptanceDefinition({
      taskId: 'multi',
      criteria: [
        { type: 'schema', file: 'package.json', requiredFields: ['name'] },
        { type: 'grep-absent', pattern: 'ZZZ_NEVER_THERE' },
        { type: 'test', command: 'false' }, // 必败条件
      ],
    }));
    const r = checkAcceptance(dataDir, 'multi', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.failedCount).toBe(1);
    expect(r.results.length).toBe(3);
    expect(r.results[0]!.pass).toBe(true);
    expect(r.results[1]!.pass).toBe(true);
    expect(r.results[2]!.pass).toBe(false);
  });

  it('未定义 taskId → failedCount=-1（区别于定义了但失败）', () => {
    const r = checkAcceptance(dataDir, 'never-defined', projectRoot);
    expect(r.ok).toBe(false);
    expect(r.failedCount).toBe(-1);
    expect(r.results.length).toBe(0);
  });
});
