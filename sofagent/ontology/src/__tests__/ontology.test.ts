// ============================================================
// ontology.test.ts · 本体合并引擎测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { checkOntologyStatus, generateOntologyView } from '../index';

describe('checkOntologyStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ont-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('ontology 目录不存在时返回全部 false', () => {
    const configDir = path.join(tmpDir, '.sofagent');
    fs.mkdirSync(configDir, { recursive: true });
    const status = checkOntologyStatus(configDir);
    expect(status.exists).toBe(false);
    expect(status.fresh).toBe(false);
    expect(status.objectCount).toBe(0);
  });

  it('ontology 文件存在时 exists 为 true', () => {
    const configDir = path.join(tmpDir, '.sofagent');
    const ontologyDir = path.join(tmpDir, 'ontology');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(ontologyDir, { recursive: true });
    fs.writeFileSync(path.join(ontologyDir, 'objects.yml'), '- {}\n');
    fs.writeFileSync(path.join(ontologyDir, 'actions.yml'), '- {}\n');
    fs.writeFileSync(path.join(ontologyDir, 'constraints.yml'), '- {}\n');
    const status = checkOntologyStatus(configDir);
    expect(status.exists).toBe(true);
  });
});

describe('generateOntologyView', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ont-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('无 ontology 目录时返回未初始化提示', () => {
    const result = generateOntologyView(tmpDir);
    expect(result).toContain('not yet initialized');
  });

  it('有 ontology 文件时返回 Markdown 报告', () => {
    const ontologyDir = path.join(tmpDir, '.sofagent', 'ontology');
    fs.mkdirSync(ontologyDir, { recursive: true });
    fs.writeFileSync(path.join(ontologyDir, 'objects.yml'), '- name: test\n  type: entity\n');
    fs.writeFileSync(path.join(ontologyDir, 'actions.yml'), '- name: do_something\n');
    fs.writeFileSync(path.join(ontologyDir, 'constraints.yml'), '- type: domain\n  severity: error\n');
    const result = generateOntologyView(tmpDir);
    expect(result).toContain('Ontology 本体视图');
    expect(result).toContain('test');
    expect(result).toContain('do_something');
  });

  it('统计摘要包含正确数量', () => {
    const ontologyDir = path.join(tmpDir, '.sofagent', 'ontology');
    fs.mkdirSync(ontologyDir, { recursive: true });
    fs.writeFileSync(path.join(ontologyDir, 'objects.yml'), '- name: a\n- name: b\n');
    fs.writeFileSync(path.join(ontologyDir, 'actions.yml'), '- name: x\n- name: y\n- name: z\n');
    fs.writeFileSync(path.join(ontologyDir, 'constraints.yml'), '- type: r\n');
    const result = generateOntologyView(tmpDir);
    expect(result).toContain('实体 (objects)');
    expect(result).toContain('| 2 |');
    expect(result).toContain('动作 (actions)');
    expect(result).toContain('| 3 |');
    expect(result).toContain('约束 (constraints)');
    expect(result).toContain('| 1 |');
  });
});
