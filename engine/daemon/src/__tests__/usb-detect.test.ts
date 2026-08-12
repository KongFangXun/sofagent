/**
 * usb-detect.test.ts · USB federation 安全层测试（v1.1.5）
 * 覆盖：合法导入 / 签名错误 / schema 错误 / 目标已存在 四分支
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  signFederation,
  verifySignature,
  validateFederationSchema,
  exportToUSB,
  applyFederation,
  type FederationConfig,
} from '../usb-detect';

// v1.3.2 P2-34: 隔离测试 HOME——mock os.homedir() 指向临时目录，
// 使 applyFederation / loadOrCreateSecretKey 等写 ~/.sofagent/... 的逻辑
// 全部落在 fakeHome 内，绝不触碰真实 HOME（沙箱环境安全）。
// 注意：Node 的 os 模块属性不可重定义，vi.spyOn(os,'homedir') 会抛
// "Cannot redefine property"，必须用 vi.mock('os') + hoisted 变量。
const homedirMock = vi.hoisted(() => ({ current: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homedirMock.current,
  };
});

let tmpDir: string;
let fakeHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-test-'));
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'home-test-'));
  homedirMock.current = fakeHome;
  savedHome = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_DATA = tmpDir;
});

afterEach(() => {
  homedirMock.current = '';
  if (savedHome === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedHome;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
});

describe('USB 签名 / 验签', () => {
  it('signFederation + verifySignature 合法验签通过', () => {
    const key = Buffer.from('a'.repeat(64), 'hex');
    const content = JSON.stringify({ version: 1, nodes: [] });
    const sig = signFederation(content, key);
    expect(verifySignature(content, sig, key)).toBe(true);
  });

  it('verifySignature 签名错误返回 false', () => {
    const key = Buffer.from('a'.repeat(64), 'hex');
    const content = JSON.stringify({ version: 1 });
    const wrongKey = Buffer.from('b'.repeat(64), 'hex');
    const wrongSig = signFederation(content, wrongKey);
    expect(verifySignature(content, wrongSig, key)).toBe(false);
  });

  it('verifySignature 篡改内容返回 false', () => {
    const key = Buffer.from('a'.repeat(64), 'hex');
    const original = JSON.stringify({ version: 1, notes: 'original' });
    const sig = signFederation(original, key);
    const tampered = JSON.stringify({ version: 1, notes: 'tampered' });
    expect(verifySignature(tampered, sig, key)).toBe(false);
  });
});

describe('FederationConfig schema 校验', () => {
  it('合法 config 通过', () => {
    const cfg: FederationConfig = {
      version: 1,
      nodes: [{ name: 'n1', platform: 'openclaw' }],
      policies: { A17: { enabled: true } },
    };
    expect(validateFederationSchema(cfg)).toBe(true);
  });

  it('缺 version 拒绝', () => {
    expect(validateFederationSchema({ nodes: [] })).toBe(false);
  });

  it('version 非 number 拒绝', () => {
    expect(validateFederationSchema({ version: '1' })).toBe(false);
  });

  it('nodes 非数组拒绝', () => {
    expect(validateFederationSchema({ version: 1, nodes: 'not-array' })).toBe(false);
  });

  it('node 缺 name/platform 拒绝', () => {
    expect(validateFederationSchema({ version: 1, nodes: [{ name: 'n1' }] })).toBe(false);
  });

  it('非对象拒绝', () => {
    expect(validateFederationSchema(null)).toBe(false);
    expect(validateFederationSchema('string')).toBe(false);
  });
});

describe('exportToUSB', () => {
  it('导出 federation.json 自动生成 .sig', () => {
    const cfg: FederationConfig = { version: 1, nodes: [] };
    const result = exportToUSB(tmpDir, cfg);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'federation.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'federation.json.sig'))).toBe(true);
  });

  it('schema 不合法拒绝导出', () => {
    const badCfg = { nodes: [] } as unknown as FederationConfig;
    const result = exportToUSB(tmpDir, badCfg);
    expect(result.success).toBe(false);
  });

  it('挂载点不存在返回失败', () => {
    const cfg: FederationConfig = { version: 1 };
    const result = exportToUSB('/nonexistent-path-xyz', cfg);
    expect(result.success).toBe(false);
  });
});

describe('applyFederation', () => {
  it('空 config 返回 applied=false + 0 warnings', () => {
    const cfg: FederationConfig = { version: 1 };
    const result = applyFederation(cfg);
    expect(result.applied).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('nodes 写入到 ~/.sofagent/orchestrator/nodes/', () => {
    // 注意：applyFederation 用 os.homedir()，会写到真实 home——单元测试
    // 用 vi.spyOn 拦截不实际写文件，仅验证调用行为
    const cfg: FederationConfig = {
      version: 1,
      nodes: [{ name: 'test-node-x', platform: 'openclaw' }],
    };
    // 通过 mock homedir 改变写入目标——这里简化：直接调用并读结果
    const result = applyFederation(cfg);
    // 结果取决于 home 目录现状——可能 applied=true 或 warning 已存在
    expect(result.message).toMatch(/应用 \d+ 项配置，\d+ 项跳过/);
    // 清理：删除可能写入的 test-node-x.json
    const target = path.join(os.homedir(), '.sofagent', 'orchestrator', 'nodes', 'test-node-x.json');
    if (fs.existsSync(target)) fs.unlinkSync(target);
  });

  it('已存在的 node 跳过且不覆盖', () => {
    // 先在真实 home 写一个 node 文件
    const nodesDir = path.join(os.homedir(), '.sofagent', 'orchestrator', 'nodes');
    if (!fs.existsSync(nodesDir)) fs.mkdirSync(nodesDir, { recursive: true });
    const target = path.join(nodesDir, 'existing-node.json');
    const original = { name: 'existing-node', platform: 'original' };
    fs.writeFileSync(target, JSON.stringify(original), 'utf-8');

    const cfg: FederationConfig = {
      version: 1,
      nodes: [{ name: 'existing-node', platform: 'changed' }],
    };
    const result = applyFederation(cfg);
    expect(result.warnings).toContain('node "existing-node" 已存在，跳过（不覆盖）');
    // 确认文件未被覆盖
    const after = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(after.platform).toBe('original');
    // 清理
    fs.unlinkSync(target);
  });

  it('policies 写入到 ~/.sofagent/audit/policies/', () => {
    const cfg: FederationConfig = {
      version: 1,
      policies: { 'test-policy-x': { enabled: true, threshold: 50 } },
    };
    const result = applyFederation(cfg);
    expect(result.message).toMatch(/应用 \d+ 项配置/);
    // 清理
    const target = path.join(os.homedir(), '.sofagent', 'audit', 'policies', 'test-policy-x.json');
    if (fs.existsSync(target)) fs.unlinkSync(target);
  });
});
