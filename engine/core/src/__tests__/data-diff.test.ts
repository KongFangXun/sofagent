// ============================================================
// data-diff.test.ts · D1-D5 数据规则引擎测试（v1.2.4 S4 新增）
// ============================================================
//
// 覆盖：
// - D1 关键字段保护（FAIL）：entity domain/name 从有值改为空
// - D2 关联完整性（WARN）：belongs_to 空引用
// - D3 批量删除告警（WARN）：删除 >3 个 entity/concept
// - D4 格式一致性（WARN）：缺少 created_at/updated_at
// - D5 敏感信息检测（FAIL）：内容含 secret-like 串
// - diffDataChange 基础功能
// ============================================================

import { describe, it, expect } from 'vitest';
import { diffDataChange, runDataRules, type DataChange } from '../data-diff';

describe('diffDataChange', () => {
  it('create 动作：before=undefined → action=create', () => {
    const change = diffDataChange('entity', 'test', undefined, { name: 'test', domain: '财务' });
    expect(change.action).toBe('create');
    expect(change.before).toBeUndefined();
    expect(change.after).toBeDefined();
    expect(change.type).toBe('entity');
    expect(change.name).toBe('test');
  });

  it('delete 动作：after=undefined → action=delete', () => {
    const change = diffDataChange('concept', 'old', { name: 'old' }, undefined);
    expect(change.action).toBe('delete');
    expect(change.after).toBeUndefined();
    expect(change.before).toBeDefined();
  });

  it('update 动作：before 和 after 都有值 → action=update', () => {
    const change = diffDataChange('entity', 'test', { name: 'test' }, { name: 'test', domain: '新域' });
    expect(change.action).toBe('update');
    expect(change.before).toBeDefined();
    expect(change.after).toBeDefined();
  });

  it('timestamp 自动填充', () => {
    const change = diffDataChange('config', 'config.yml', undefined, { key: 'value' });
    expect(change.timestamp).toBeDefined();
    expect(typeof change.timestamp).toBe('string');
  });
});

describe('D1 关键字段保护', () => {
  it('entity domain 从有值改为空 → FAIL', () => {
    const change = diffDataChange('entity', 'test', {
      name: 'test', domain: '财务',
    }, {
      name: 'test', domain: '',
    });
    const result = runDataRules([change]);
    expect(result.hasFail).toBe(true);
    const d1 = result.violations.find((v) => v.rule === 'D1');
    expect(d1).toBeDefined();
    expect(d1!.severity).toBe('FAIL');
    expect(d1!.detail).toContain('domain');
  });

  it('entity name 从有值改为空 → FAIL', () => {
    const change = diffDataChange('entity', 'test', {
      name: 'test', domain: '财务',
    }, {
      name: '', domain: '财务',
    });
    const result = runDataRules([change]);
    expect(result.hasFail).toBe(true);
    const d1 = result.violations.find((v) => v.rule === 'D1');
    expect(d1).toBeDefined();
    expect(d1!.detail).toContain('name');
  });

  it('domain 从空改为有值 → 不触发 D1', () => {
    const change = diffDataChange('entity', 'test', {
      name: 'test', domain: '',
    }, {
      name: 'test', domain: '财务',
    });
    const result = runDataRules([change]);
    const d1 = result.violations.find((v) => v.rule === 'D1');
    expect(d1).toBeUndefined();
  });
});

describe('D2 关联完整性', () => {
  it('belongs_to 包含空字符串 → WARN', () => {
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      relations: { belongs_to: ['', 'target'] },
    });
    const result = runDataRules([change]);
    const d2 = result.violations.find((v) => v.rule === 'D2');
    expect(d2).toBeDefined();
    expect(d2!.severity).toBe('WARN');
  });

  it('belongs_to 无空引用 → 不触发 D2', () => {
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      relations: { belongs_to: ['parent'] },
    });
    const result = runDataRules([change]);
    const d2 = result.violations.find((v) => v.rule === 'D2');
    expect(d2).toBeUndefined();
  });
});

describe('D3 批量删除告警', () => {
  it('删除 4 个 entity → WARN', () => {
    const changes: DataChange[] = [];
    for (let i = 0; i < 4; i++) {
      changes.push(diffDataChange('entity', `entity-${i}`, { name: `entity-${i}` }, undefined));
    }
    const result = runDataRules(changes);
    const d3 = result.violations.find((v) => v.rule === 'D3');
    expect(d3).toBeDefined();
    expect(d3!.severity).toBe('WARN');
    expect(d3!.detail).toContain('4');
  });

  it('删除 3 个 entity → 不触发 D3', () => {
    const changes: DataChange[] = [];
    for (let i = 0; i < 3; i++) {
      changes.push(diffDataChange('entity', `entity-${i}`, { name: `entity-${i}` }, undefined));
    }
    const result = runDataRules(changes);
    const d3 = result.violations.find((v) => v.rule === 'D3');
    expect(d3).toBeUndefined();
  });
});

describe('D4 格式一致性', () => {
  it('entity 缺少 created_at → WARN', () => {
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      domain: '财务',
      updated_at: new Date().toISOString(),
    });
    const result = runDataRules([change]);
    const d4 = result.violations.find((v) => v.rule === 'D4' && v.detail.includes('created_at'));
    expect(d4).toBeDefined();
    expect(d4!.severity).toBe('WARN');
  });

  it('entity 缺少 updated_at → WARN', () => {
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      domain: '财务',
      created_at: new Date().toISOString(),
    });
    const result = runDataRules([change]);
    const d4 = result.violations.find((v) => v.rule === 'D4' && v.detail.includes('updated_at'));
    expect(d4).toBeDefined();
  });

  it('entity 含 created_at + updated_at → 不触发 D4', () => {
    const now = new Date().toISOString();
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      domain: '财务',
      created_at: now,
      updated_at: now,
    });
    const result = runDataRules([change]);
    const d4 = result.violations.find((v) => v.rule === 'D4');
    expect(d4).toBeUndefined();
  });
});

describe('D5 敏感信息检测', () => {
  it('内容含 API Key（sk- 前缀）→ FAIL', () => {
    // 运行时拼接避免 A2 误判
    const apiKey = ['sk-ant-api03-abcdef', 'ghijklmnopqrstuvwxyz123456'].join('');
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      content: `my key is ${apiKey}`,
    });
    const result = runDataRules([change]);
    expect(result.hasFail).toBe(true);
    const d5 = result.violations.find((v) => v.rule === 'D5');
    expect(d5).toBeDefined();
    expect(d5!.severity).toBe('FAIL');
  });

  it('内容含 password= 赋值 → FAIL', () => {
    // 运行时拼接避免 A2 误判
    const pw = ['password=', 'mysecretpass123'].join('');
    const change = diffDataChange('concept', 'test', undefined, {
      name: 'test',
      content: `database ${pw}`,
    });
    const result = runDataRules([change]);
    const d5 = result.violations.find((v) => v.rule === 'D5');
    expect(d5).toBeDefined();
  });

  it('内容含 AWS Access Key → FAIL', () => {
    // 运行时拼接避免 A2 误判（铁律：fixture 中 secret-like 串禁止字面量）
    const awsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      content: `AWS key: ${awsKey}`,
    });
    const result = runDataRules([change]);
    const d5 = result.violations.find((v) => v.rule === 'D5');
    expect(d5).toBeDefined();
  });

  it('正常内容不触发 D5', () => {
    const now = new Date().toISOString();
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      domain: '财务',
      created_at: now,
      updated_at: now,
      content: '这是一个正常的 entity 描述，不含敏感信息',
    });
    const result = runDataRules([change]);
    const d5 = result.violations.find((v) => v.rule === 'D5');
    expect(d5).toBeUndefined();
  });
});

describe('综合：无违规时返回 PASS', () => {
  it('合规变更 → hasFail=false, hasWarn=false', () => {
    const now = new Date().toISOString();
    const change = diffDataChange('entity', 'test', undefined, {
      name: 'test',
      domain: '财务',
      created_at: now,
      updated_at: now,
      content: '正常内容',
    });
    const result = runDataRules([change]);
    expect(result.hasFail).toBe(false);
    expect(result.hasWarn).toBe(false);
    expect(result.violations).toHaveLength(0);
  });
});
