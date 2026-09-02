// ============================================================
// model-registry.test.ts · 模型注册表单测（v1.3.6 交付 ④）
//
// 覆盖验收标准：
//   ① registerModel 写入注册表（原子写 + 事件留痕）
//   ② switchModel 灰度比例生效（percent<100 → canary）
//   ③ 晋升强制人审（percent=100 无人审挂起，对齐 v1.3.5 promote_ab）
//   ④ 切换可回滚（rollback 恢复上一活动模型）
//   ⑤ retireModel 退役标记生效（不参与路由，可恢复；强制人审）
//   ⑥ 每次操作事件留痕（register/switch/promote/rollback/retire/restore）
//   ⑦ local-path 扩展位预留（可注册，不可切换）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  registerModel,
  switchModel,
  rollbackModel,
  retireModel,
  restoreModel,
  loadRegistry,
  saveRegistry,
  resolveModelRegistryPath,
  readActiveEndpoints,
} from '../model-registry';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-model-registry-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('模型注册', () => {
  it('注册成功 → 原子写入注册表 + register 事件留痕', () => {
    const result = registerModel(
      { name: 'ft-model-v1', endpoint: 'http://localhost:8000/v1', model: 'ft-001', clientType: 'openai-compatible' },
      { dataDir, actor: 'fde-test', comment: '后训练模型首版' },
    );
    expect(result.ok).toBe(true);
    expect(result.awaitingHuman).toBe(false);

    // 文件落盘（原子写产物可读）
    const filePath = resolveModelRegistryPath(dataDir);
    expect(existsSync(filePath)).toBe(true);
    const file = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(file.models['ft-model-v1'].status).toBe('registered');

    // 事件留痕
    expect(file.events.length).toBe(1);
    expect(file.events[0].op).toBe('register');
    expect(file.events[0].actor).toBe('fde-test');
    expect(file.events[0].comment).toBe('后训练模型首版');
  });

  it('注册参数非法 → 结构化错误不写文件', () => {
    const result = registerModel({ name: '', endpoint: '', model: '' }, { dataDir });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(existsSync(resolveModelRegistryPath(dataDir))).toBe(false);
  });

  it('重复注册 = 更新（保留 registeredAt 首次时间）', () => {
    registerModel({ name: 'm', endpoint: 'http://a', model: 'x' }, { dataDir });
    const first = loadRegistry(dataDir).models['m'].registeredAt;
    registerModel({ name: 'm', endpoint: 'http://b', model: 'y' }, { dataDir });
    const reg = loadRegistry(dataDir);
    expect(reg.models['m'].endpoint).toBe('http://b');
    expect(reg.models['m'].registeredAt).toBe(first);
    expect(reg.events.length).toBe(2); // 两次 register 事件
  });

  it('local-path 注册：缺 weightsDir 拒绝（权重目录规范强制）', () => {
    const result = registerModel(
      { name: 'local-w', endpoint: '/weights/dir', model: 'w', source: 'local-path' },
      { dataDir },
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('weights_dir');
  });

  it('local-path 注册：无 manifest 的目录拒绝（供应链红线）', () => {
    const emptyDir = join(dataDir, 'no-manifest');
    const result = registerModel(
      { name: 'local-w', endpoint: 'http://localhost:8000', model: 'w', source: 'local-path', weightsDir: emptyDir },
      { dataDir },
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('manifest.json');
  });
});

describe('灰度切换与晋升', () => {
  beforeEach(() => {
    registerModel({ name: 'base', endpoint: 'http://base', model: 'base' }, { dataDir });
    registerModel({ name: 'cand', endpoint: 'http://cand', model: 'cand' }, { dataDir });
  });

  it('灰度切换（percent=10）直接生效 → canary 状态', () => {
    const result = switchModel('cand', 'executor', 10, { dataDir });
    expect(result.ok).toBe(true);
    expect(result.awaitingHuman).toBe(false);
    const reg = loadRegistry(dataDir);
    expect(reg.active.executor).toBe('cand');
    expect(reg.models['cand'].status).toBe('canary');
    expect(reg.models['cand'].canaryPercent).toBe(10);
    expect(reg.events.at(-1).op).toBe('switch');
  });

  it('晋升（percent=100）🔴 强制人审——无确认挂起不执行', () => {
    switchModel('base', 'executor', 100, { dataDir, humanConfirmed: true });
    const result = switchModel('cand', 'executor', 100, { dataDir });
    expect(result.ok).toBe(true);
    expect(result.awaitingHuman).toBe(true);
    // 未执行：活动模型仍是 base
    expect(loadRegistry(dataDir).active.executor).toBe('base');
  });

  it('晋升（percent=100）人审确认 → 执行 + 原活动模型降级', () => {
    switchModel('base', 'executor', 100, { dataDir, humanConfirmed: true });
    const result = switchModel('cand', 'executor', 100, { dataDir, humanConfirmed: true, comment: '评测通过' });
    expect(result.ok).toBe(true);
    expect(result.awaitingHuman).toBe(false);
    const reg = loadRegistry(dataDir);
    expect(reg.active.executor).toBe('cand');
    expect(reg.models['cand'].status).toBe('active');
    expect(reg.models['base'].status).toBe('registered'); // 降级
    const ev = reg.events.at(-1);
    expect(ev.op).toBe('promote');
    expect(ev.previousModel).toBe('base');
    expect(ev.comment).toBe('评测通过');
  });

  it('未注册模型切换 → 结构化错误', () => {
    const result = switchModel('ghost', 'executor', 10, { dataDir });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('未注册');
  });

  it('percent 非法（0/101/小数）→ 拒绝', () => {
    expect(switchModel('cand', 'executor', 0, { dataDir }).ok).toBe(false);
    expect(switchModel('cand', 'executor', 101, { dataDir }).ok).toBe(false);
    expect(switchModel('cand', 'executor', 10.5, { dataDir }).ok).toBe(false);
  });

  it('local-path 模型缺合规权重目录时切换被拦截', () => {
    // 直接手写注册表条目（绕过注册校验）模拟脏数据——切换时重校验拦截
    const reg = loadRegistry(dataDir);
    reg.models['lw'] = {
      name: 'lw', endpoint: '/w', clientType: 'ollama', model: 'w',
      source: 'local-path', localWeights: { dir: join(dataDir, 'ghost-weights'), currentVersion: 'v1', versionCount: 1 },
      status: 'registered', registeredAt: new Date().toISOString(),
    };
    saveRegistry(dataDir, reg);
    const result = switchModel('lw', 'executor', 10, { dataDir });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('manifest.json');
  });
});

describe('回滚', () => {
  beforeEach(() => {
    registerModel({ name: 'old', endpoint: 'http://old', model: 'old' }, { dataDir });
    registerModel({ name: 'new', endpoint: 'http://new', model: 'new' }, { dataDir });
    switchModel('old', 'executor', 100, { dataDir, humanConfirmed: true });
    switchModel('new', 'executor', 100, { dataDir, humanConfirmed: true });
  });

  it('回滚恢复上一活动模型（止损直接生效，不要求人审）', () => {
    const result = rollbackModel('executor', { dataDir });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('old');
    const reg = loadRegistry(dataDir);
    expect(reg.active.executor).toBe('old');
    expect(reg.models['old'].status).toBe('active');
    expect(reg.models['new'].status).toBe('registered');
    expect(reg.events.at(-1).op).toBe('rollback');
  });

  it('无历史 → 回滚失败有明确提示', () => {
    const freshDir = mkdtempSync(join(tmpdir(), 'sofagent-mr-fresh-'));
    expect(rollbackModel('executor', { dataDir: freshDir }).ok).toBe(false);
    rmSync(freshDir, { recursive: true, force: true });
  });
});

describe('退役与恢复', () => {
  beforeEach(() => {
    registerModel({ name: 'victim', endpoint: 'http://v', model: 'v' }, { dataDir });
    switchModel('victim', 'pipeline', 100, { dataDir, humanConfirmed: true });
  });

  it('退役 🔴 强制人审——无确认挂起', () => {
    const result = retireModel('victim', { dataDir });
    expect(result.ok).toBe(true);
    expect(result.awaitingHuman).toBe(true);
    expect(loadRegistry(dataDir).models['victim'].status).toBe('active'); // 未变
  });

  it('退役确认 → 摘除活动档位 + 不再参与路由', () => {
    const result = retireModel('victim', { dataDir, humanConfirmed: true, comment: '评测走低' });
    expect(result.ok).toBe(true);
    const reg = loadRegistry(dataDir);
    expect(reg.models['victim'].status).toBe('retired');
    expect(reg.models['victim'].retiredAt).toBeTruthy();
    expect(reg.active.pipeline).toBeUndefined(); // 摘除
    expect(reg.events.at(-1).op).toBe('retire');
    // readActiveEndpoints 不返回退役模型
    expect(readActiveEndpoints(dataDir).pipeline).toBeUndefined();
  });

  it('退役模型不可切换', () => {
    retireModel('victim', { dataDir, humanConfirmed: true });
    expect(switchModel('victim', 'executor', 10, { dataDir }).ok).toBe(false);
  });

  it('恢复 🔴 强制人审 + 确认后可重新注册态', () => {
    retireModel('victim', { dataDir, humanConfirmed: true });
    expect(restoreModel('victim', { dataDir }).awaitingHuman).toBe(true);
    const result = restoreModel('victim', { dataDir, humanConfirmed: true });
    expect(result.ok).toBe(true);
    const entry = loadRegistry(dataDir).models['victim'];
    expect(entry.status).toBe('registered');
    expect(entry.retiredAt).toBeUndefined();
    expect(loadRegistry(dataDir).events.at(-1).op).toBe('restore');
  });
});

describe('readActiveEndpoints · router 消费面', () => {
  it('活动模型可读（executor/pipeline 双档位独立）', () => {
    registerModel({ name: 'e', endpoint: 'http://e', model: 'e' }, { dataDir });
    registerModel({ name: 'p', endpoint: 'http://p', model: 'p' }, { dataDir });
    switchModel('e', 'executor', 100, { dataDir, humanConfirmed: true });
    switchModel('p', 'pipeline', 100, { dataDir, humanConfirmed: true });
    const active = readActiveEndpoints(dataDir);
    expect(active.executor?.name).toBe('e');
    expect(active.pipeline?.name).toBe('p');
  });
});

describe('applyRegistryOverrides · 活动模型从注册表读取', () => {
  it('有活动模型 → 覆盖 local 档位连接信息（policy 原样保留）', async () => {
    const { applyRegistryOverrides, DEFAULT_ROUTER_CONFIG } = await import('../model-router-config');
    registerModel({ name: 'ov', endpoint: 'http://override:9000/v1', model: 'ft-override', clientType: 'openai-compatible' }, { dataDir });
    switchModel('ov', 'executor', 100, { dataDir, humanConfirmed: true });

    const next = applyRegistryOverrides(DEFAULT_ROUTER_CONFIG, dataDir);
    expect(next.local.executor.endpoint).toBe('http://override:9000/v1');
    expect(next.local.executor.model).toBe('ft-override');
    expect(next.local.executor.client_type).toBe('openai-compatible');
    // 数据主权铁律不逃逸——policy 原样
    expect(next.policy.fallbackOnLocalFailure.restricted).toBe('block-and-alert');
    // 未覆盖档位保持原配置
    expect(next.local.pipeline).toEqual(DEFAULT_ROUTER_CONFIG.local.pipeline);
  });

  it('无活动模型 → 返回原配置引用（降级不破坏）', async () => {
    const { applyRegistryOverrides, DEFAULT_ROUTER_CONFIG } = await import('../model-router-config');
    const next = applyRegistryOverrides(DEFAULT_ROUTER_CONFIG, dataDir);
    expect(next).toBe(DEFAULT_ROUTER_CONFIG);
  });

  it('注册表损坏 → 降级用基础配置（绝不阻塞路由）', async () => {
    const { applyRegistryOverrides, DEFAULT_ROUTER_CONFIG } = await import('../model-router-config');
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    writeFileSync(join(dataDir, 'config', 'model-registry.json'), '{broken json', 'utf-8');
    const next = applyRegistryOverrides(DEFAULT_ROUTER_CONFIG, dataDir);
    expect(next).toBe(DEFAULT_ROUTER_CONFIG);
  });
});
