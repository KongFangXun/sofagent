// weights-deploy.test.ts · 企业模型本地权重部署链路测试
//
// 覆盖（changelog 第二章验收对齐）：
// 1. 权重目录规范（manifest 读写 + 校验 + 哈希）
// 2. model_register local-path 注册（校验通过/失败两路）
// 3. local-path 模型切换（解除「不可切换」限制——校验通过即挂载）
// 4. 权重版本回滚（rollbackWeightsVersion：默认回拨/显式目标/边界）
// 5. 端到端电池厂场景（LoRA → 注册 → 灰度 → 晋升 → 版本回滚 → 全程事件链）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  checkWeightsDir,
  hashDir,
  appendVersion,
  manifestPath,
} from '../weights-manifest';
import {
  registerModel,
  switchModel,
  rollbackWeightsVersion,
  rollbackModel,
  loadRegistry,
  saveRegistry,
} from '../model-registry';

let dataDir: string;
let weightsDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-weights-test-'));
  weightsDir = mkdtempSync(join(tmpdir(), 'sofagent-weights-pkg-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(weightsDir, { recursive: true, force: true });
});

/** 造一个合规权重版本目录（模拟 LoRA adapter 产物） */
function makeVersion(id: string, opts?: { trainJobId?: string; evalScore?: number }): string {
  const vdir = join(weightsDir, id);
  mkdirSync(vdir, { recursive: true });
  writeFileSync(join(vdir, 'adapter_model.safetensors'), `fake-lora-weights-${id}-${Math.random()}`);
  writeFileSync(join(vdir, 'adapter_config.json'), JSON.stringify({ base: 'qwen3-8b', lora_r: 16 }));
  writeFileSync(join(vdir, 'training_meta.json'), JSON.stringify({
    trainJobId: opts?.trainJobId ?? `job-${id}`,
    evalScore: opts?.evalScore ?? 85,
  }));
  return vdir;
}

/** 登记版本进 manifest（appendVersion 自动算哈希） */
function registerVersion(id: string, opts?: { trainJobId?: string; evalScore?: number; setCurrent?: boolean }): void {
  const vdir = makeVersion(id, opts);
  const size = 1024; // 近似值——manifest 记录用
  appendVersion(weightsDir, {
    id,
    createdAt: new Date().toISOString(),
    sha256: hashDir(vdir),
    sizeBytes: size,
    ...(opts ? { meta: { ...(opts.trainJobId ? { trainJobId: opts.trainJobId } : {}), ...(opts.evalScore !== undefined ? { evalScore: opts.evalScore } : {}) } } : {}),
  }, { setCurrent: opts?.setCurrent !== false });
}

describe('权重目录规范（weights-manifest）', () => {
  it('缺 manifest 拒绝', () => {
    const check = checkWeightsDir(weightsDir);
    expect(check.ok).toBe(false);
    expect(check.issues[0]).toContain('manifest.json');
  });

  it('合规目录 + 哈希校验通过', () => {
    registerVersion('v1');
    const check = checkWeightsDir(weightsDir, { verifyHash: true });
    expect(check.ok).toBe(true);
    expect(check.manifest?.current).toBe('v1');
    expect(check.manifest?.versions).toHaveLength(1);
    expect(check.currentPath).toBe(join(weightsDir, 'v1'));
  });

  it('权重篡改 → 哈希校验失败', () => {
    registerVersion('v1');
    // 篡改权重文件
    writeFileSync(join(weightsDir, 'v1', 'adapter_model.safetensors'), 'tampered');
    const check = checkWeightsDir(weightsDir, { verifyHash: true });
    expect(check.ok).toBe(false);
    expect(check.issues[0]).toContain('完整性校验失败');
  });

  it('appendVersion 幂等（同 id 更新）+ 多版本 current 指针', () => {
    registerVersion('v1');
    registerVersion('v2');
    let m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions).toHaveLength(2);
    expect(m.current).toBe('v2');
    // 重登 v1（幂等更新 + setCurrent）
    registerVersion('v1');
    m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.versions).toHaveLength(2); // 不重复
    expect(m.current).toBe('v1');
  });

  it('appendVersion model 参数（新建清单写入 + 已有清单空值补写）', () => {
    // fresh-eyes 视角16-2 修复行为锁：manifest.model 此前恒空串无消费校验——
    // 注册链路传入注册名，下游按 manifest.model 展示/路由不再拿空值
    const wdir = mkdtempSync(join(tmpdir(), 'sofagent-wm-model-'));
    try {
      // 新建清单：opts.model 直接写入
      const v1 = join(wdir, 'v1');
      mkdirSync(v1, { recursive: true });
      writeFileSync(join(v1, 'adapter.safetensors'), 'v1-weights');
      appendVersion(wdir, { id: 'v1', createdAt: new Date().toISOString(), sha256: hashDir(v1), sizeBytes: 1 }, { setCurrent: true, model: 'battery-lora' });
      let m = JSON.parse(readFileSync(manifestPath(wdir), 'utf-8'));
      expect(m.model).toBe('battery-lora');
      // 已有清单：非空 model 不被覆盖（首个正式登记方定档）
      const v2 = join(wdir, 'v2');
      mkdirSync(v2, { recursive: true });
      writeFileSync(join(v2, 'adapter.safetensors'), 'v2-weights');
      appendVersion(wdir, { id: 'v2', createdAt: new Date().toISOString(), sha256: hashDir(v2), sizeBytes: 1 }, { setCurrent: true, model: 'other-name' });
      m = JSON.parse(readFileSync(manifestPath(wdir), 'utf-8'));
      expect(m.model).toBe('battery-lora');
      // model 空仅告警不阻断（阻断/告警显式分离——versions 空/current 缺位才是阻断项）
      m.model = '';
      const { atomicWriteSync } = require('@sofagent/core') as { atomicWriteSync: (p: string, d: string) => void };
      atomicWriteSync(manifestPath(wdir), JSON.stringify(m));
      const check = checkWeightsDir(wdir, { verifyHash: false });
      expect(check.ok).toBe(true); // 告警不阻断
      expect(check.issues.join(' ')).toContain('model'); // 告警在案
    } finally {
      rmSync(wdir, { recursive: true, force: true });
    }
  });

  it('switchModel 空 localWeights.dir 前置判空（准确报错不误导）', () => {
    // fresh-eyes 视角7-3 修复行为锁：旧条目无 localWeights 字段时 dir=''
    // 此前报「缺 manifest.json: manifest.json」误导排障——现在前置判空给
    // 「请重新注册」的准确提示。独立 weightsDir（别的用例可能已篡改共享目录）
    const wdir = mkdtempSync(join(tmpdir(), 'sofagent-sw-empty-'));
    try {
      const v1 = join(wdir, 'v1');
      mkdirSync(v1, { recursive: true });
      writeFileSync(join(v1, 'adapter.safetensors'), 'w1');
      appendVersion(wdir, { id: 'v1', createdAt: new Date().toISOString(), sha256: hashDir(v1), sizeBytes: 1 }, { setCurrent: true });
      registerModel(
        { name: 'legacy-weights', endpoint: 'http://localhost:8000', model: 'legacy:v1', source: 'local-path', weightsDir: wdir },
        { dataDir },
      );
      // 手工清空 localWeights.dir 模拟 v1.4.1 扩展位时代的旧条目
      const reg = loadRegistry(dataDir);
      reg.models['legacy-weights'].localWeights = { ...reg.models['legacy-weights'].localWeights!, dir: '' };
      saveRegistry(dataDir, reg);
      const sw = switchModel('legacy-weights', 'pipeline', 100, { dataDir });
      expect(sw.ok).toBe(false);
      expect(sw.message).toContain('重新注册');
      expect(sw.message).not.toContain('manifest.json: manifest.json'); // 误导提示不再出现
    } finally {
      rmSync(wdir, { recursive: true, force: true });
    }
  });

  it('hashDir 确定性（同内容同哈希 / 内容变哈希变）', () => {
    const d1 = join(dataDir, 'h1');
    mkdirSync(d1, { recursive: true });
    writeFileSync(join(d1, 'a.txt'), 'same');
    const h1 = hashDir(d1);
    const h1b = hashDir(d1);
    expect(h1).toBe(h1b);
    writeFileSync(join(d1, 'a.txt'), 'different');
    expect(hashDir(d1)).not.toBe(h1);
  });
});

describe('model_register local-path 注册', () => {
  it('缺 weights_dir 拒绝', () => {
    const r = registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path' },
      { dataDir },
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('weights_dir');
  });

  it('manifest 缺失拒绝注册（供应链红线）', () => {
    const r = registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('manifest.json');
  });

  it('合规注册：localWeights 落档（版本数/当前版本）', () => {
    registerVersion('v1', { trainJobId: 'job-battery-001', evalScore: 87.5 });
    registerVersion('v2', { trainJobId: 'job-battery-002', evalScore: 91.2 });
    const r = registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-qwen3-8b', source: 'local-path', weightsDir: weightsDir, clientType: 'openai-compatible', meta: { evalScore: 91.2 } },
      { dataDir },
    );
    expect(r.ok).toBe(true);
    const reg = loadRegistry(dataDir);
    const entry = reg.models['battery-lora'];
    expect(entry.source).toBe('local-path');
    expect(entry.localWeights).toEqual({ dir: weightsDir, currentVersion: 'v2', versionCount: 2 });
    expect(entry.clientType).toBe('openai-compatible');
  });

  it('哈希不匹配拒绝注册（默认 verifyHash=true）', () => {
    registerVersion('v1');
    writeFileSync(join(weightsDir, 'v1', 'adapter_model.safetensors'), 'tampered');
    const r = registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('完整性校验失败');
  });
});

describe('local-path 模型切换（限制解除）', () => {
  it('校验通过可灰度/晋升——「不可切换」限制解除', () => {
    registerVersion('v1');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-qwen3-8b', source: 'local-path', weightsDir: weightsDir, clientType: 'openai-compatible' },
      { dataDir },
    );
    // 灰度 20%（可逆运维——直接生效）
    const sw = switchModel('battery-lora', 'executor', 20, { dataDir });
    expect(sw.ok).toBe(true);
    expect(sw.awaitingHuman).toBe(false);
    const reg = loadRegistry(dataDir);
    expect(reg.models['battery-lora'].status).toBe('canary');
    expect(reg.active.executor).toBe('battery-lora');
  });

  it('晋升 percent=100 仍强制人审（local-path 不豁免）', () => {
    registerVersion('v1');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-qwen3-8b', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    const sw = switchModel('battery-lora', 'executor', 100, { dataDir });
    expect(sw.ok).toBe(true);
    expect(sw.awaitingHuman).toBe(true); // 挂起等人审
    // 确认后晋升
    const sw2 = switchModel('battery-lora', 'executor', 100, { dataDir, humanConfirmed: true });
    expect(sw2.ok).toBe(true);
    expect(loadRegistry(dataDir).models['battery-lora'].status).toBe('active');
  });

  it('权重目录损坏时切换被拦截', () => {
    registerVersion('v1');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    // 删 manifest → 切换时重校验失败
    rmSync(manifestPath(weightsDir));
    const sw = switchModel('battery-lora', 'executor', 20, { dataDir });
    expect(sw.ok).toBe(false);
    expect(sw.issues[0]).toContain('manifest.json');
  });
});

describe('权重版本回滚（rollbackWeightsVersion）', () => {
  it('默认回拨上一版本', () => {
    registerVersion('v1');
    registerVersion('v2');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-qwen3-8b', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    const rb = rollbackWeightsVersion('battery-lora', { dataDir });
    expect(rb.ok).toBe(true);
    expect(rb.message).toContain('v2 → v1');
    // manifest current 指针回拨 + 注册表同步
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.current).toBe('v1');
    expect(loadRegistry(dataDir).models['battery-lora'].localWeights?.currentVersion).toBe('v1');
  });

  it('显式目标版本（跳版回滚）', () => {
    registerVersion('v1');
    registerVersion('v2');
    registerVersion('v3');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    const rb = rollbackWeightsVersion('battery-lora', { dataDir, targetVersion: 'v1' });
    expect(rb.ok).toBe(true);
    expect(rb.message).toContain('v3 → v1');
  });

  it('首个版本无上一版可回滚', () => {
    registerVersion('v1');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir: weightsDir },
      { dataDir },
    );
    const rb = rollbackWeightsVersion('battery-lora', { dataDir });
    expect(rb.ok).toBe(false);
    expect(rb.message).toContain('首个版本');
  });

  it('endpoint 型模型无权重面拒绝', () => {
    registerModel(
      { name: 'cloud-model', endpoint: 'https://api.example.com', model: 'gpt-x' },
      { dataDir },
    );
    const rb = rollbackWeightsVersion('cloud-model', { dataDir });
    expect(rb.ok).toBe(false);
    expect(rb.message).toContain('非 local-path');
  });

  it('回滚目标版本目录被篡改 → 哈希直验拒绝（供应链三路径无旁路）', () => {
    // fresh-eyes 视角2-1/7-1 修复行为锁：checkWeightsDir 只验 current 版本，
    // 回滚恰好指向非 current 历史版本——目标目录必须 hashDir 单独直验，
    // 被篡改即拒（「合法回滚」不能成为挂载坏权重的旁路）
    registerVersion('v1');
    registerVersion('v2');
    registerModel(
      { name: 'battery-lora', endpoint: 'http://localhost:8000', model: 'battery-lora-v1', source: 'local-path', weightsDir },
      { dataDir },
    );
    // 篡改历史版本 v1（回滚目标）——current 是 v2，checkWeightsDir 不覆盖它
    writeFileSync(join(weightsDir, 'v1', 'adapter_model.safetensors'), 'TAMPERED-WEIGHTS');
    const rb = rollbackWeightsVersion('battery-lora', { dataDir });
    expect(rb.ok).toBe(false);
    expect(rb.message).toContain('完整性校验失败');
    // manifest current 指针未被动（拒绝即无副作用）
    const m = JSON.parse(readFileSync(manifestPath(weightsDir), 'utf-8'));
    expect(m.current).toBe('v2');
  });
});

describe('端到端：电池厂场景（验收第 4 条）', () => {
  it('4090 训 LoRA → 注册 → 灰度 → 晋升 → 版本回滚——全程 model_registry 事件链', () => {
    // ── 场景：一张 4090 + 电芯数据训出 LoRA ──
    // 训练 v1（首轮，85 分）
    registerVersion('v1', { trainJobId: 'job-battery-001', evalScore: 85 });
    // 训练 v2（数据扩充，91 分）
    registerVersion('v2', { trainJobId: 'job-battery-002', evalScore: 91.2 });

    // 注册（本地 vLLM 端点承接加载）
    const reg1 = registerModel(
      {
        name: 'battery-lora-qwen3-8b',
        endpoint: 'http://localhost:8000', // vLLM 本地端点
        model: 'battery-lora-qwen3-8b',
        clientType: 'openai-compatible',
        source: 'local-path',
        weightsDir: weightsDir,
        meta: { evalScore: 91.2, notes: '电池厂产线校准节点——电芯数据 4090 单卡训练' },
      },
      { dataDir, actor: 'fde-battery-plant', comment: '电池厂专属模型注册' },
    );
    expect(reg1.ok).toBe(true);

    // 灰度 20% 到产线校准节点
    const sw1 = switchModel('battery-lora-qwen3-8b', 'pipeline', 20, { dataDir, actor: 'fde-battery-plant' });
    expect(sw1.ok).toBe(true);

    // 晋升 100%（人工确认）
    const sw2 = switchModel('battery-lora-qwen3-8b', 'pipeline', 100, { dataDir, actor: 'fde-battery-plant', humanConfirmed: true });
    expect(sw2.ok).toBe(true);

    // v2 产线翻车 → 权重版本回滚到 v1（止损不要求人审）
    const rb = rollbackWeightsVersion('battery-lora-qwen3-8b', { dataDir, actor: 'fde-battery-plant', comment: 'v2 产线良率异常' });
    expect(rb.ok).toBe(true);
    expect(rb.message).toContain('v2 → v1');

    // ── 全程事件链断言 ──
    const reg = loadRegistry(dataDir);
    const ops = reg.events.map((e) => e.op);
    expect(ops).toEqual(['register', 'switch', 'promote', 'rollback']);
    // 事件细节
    expect(reg.events[0].actor).toBe('fde-battery-plant');
    expect(reg.events[1].lane).toBe('pipeline');
    expect(reg.events[1].percent).toBe(20);
    expect(reg.events[3].comment).toContain('权重版本回滚');
    // 最终态：模型 active + 权重 current=v1
    expect(reg.models['battery-lora-qwen3-8b'].status).toBe('active');
    expect(reg.models['battery-lora-qwen3-8b'].localWeights?.currentVersion).toBe('v1');
    expect(reg.active.pipeline).toBe('battery-lora-qwen3-8b');
  });
});
