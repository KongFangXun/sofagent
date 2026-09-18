// ============================================================
// device-data-tools.test.ts · device_data_query / device_data_push MCP tool 测试
// v1.4.9 G10/G11（T2/T3）新增
// ============================================================
//
// 覆盖面（MCP 面的验收透传 + 铁律）：
//   1. 两 tool 的 text 首行 [sofagent] 前缀（三层签名铁律）
//   2. device_data_query：空白名单 → 拒绝（验收 ① 经 MCP 面透传）
//   3. device_data_query：白名单内读取 + 脱敏（sk- 密钥不出设备——验收 ③）
//   4. device_data_query：白名单外路径 → 拒绝（验收 ②）
//   5. device_data_query：未注册设备 → gateDevice 拒绝
//   6. device_data_push：空采集声明 → 拒绝（T3 验收 ①）
//   7. device_data_push：声明内入队 + 加密（WAL 只存密文——验收 ④）
//   8. device_data_push：传输回调送达 → ack 推进（验收 ③ 续传）
//   9. registry 注册面：TOOLS 数组含两 tool（铁律 9 接线存在性）
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateAgentIdentity,
  saveDeviceDataPolicy,
  saveDeviceUploadPolicy,
  type AgentIdentity,
} from '@sofagent/core';
import { deviceDataQuery } from '../tools/device-data-query';
import { deviceDataPush } from '../tools/device-data-push';
import { TOOLS } from '../tool-registry';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-device-data-tools-'));
  tmpDirs.push(dir);
  return dir;
}

describe('device_data_query / device_data_push MCP tools（v1.4.9 G10/G11）', () => {
  let dataDir: string;
  let legal: AgentIdentity;
  let foreign: AgentIdentity;
  let allowedFile: string;

  beforeAll(() => {
    dataDir = mkDataDir();
    process.env.SOFAGENT_DATA = dataDir;
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
    tmpDirs.push(keyDir);
    fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');

    legal = generateAgentIdentity('device-data-legal', { principal: 'enterprise-g10' });
    foreign = generateAgentIdentity('device-data-foreign', { principal: 'enterprise-g10' });

    // 注册 legal 设备（走 daemon registerDevice——与生产链路一致）
    const daemon = require('@sofagent/daemon') as { registerDevice: (i: AgentIdentity, o: Record<string, unknown>, d?: string) => { ok: boolean } };
    const reg = daemon.registerDevice(legal, { kind: 'pc', capabilities: ['data-source'], tenant: 'default' }, dataDir);
    expect(reg.ok).toBe(true);

    // 准备白名单目录 + 测试文件（含密钥格式敏感串）
    allowedFile = path.join(dataDir, 'reports', 'sample.txt');
    fs.mkdirSync(path.dirname(allowedFile), { recursive: true });
    fs.writeFileSync(allowedFile, '月度报告：客户A采购100件。API key: sk-abcdefghij0123456789 结束', 'utf-8');
    // 白名单外文件
    fs.writeFileSync(path.join(dataDir, 'secret.txt'), 'top secret payload', 'utf-8');
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  describe('device_data_query（G10 授权读取）', () => {
    it('验收 ①：空白名单 → 拒绝（empty-policy 经 MCP 面透传）', async () => {
      const r = await deviceDataQuery({ identity: legal as unknown as Record<string, unknown>, path: allowedFile });
      expect(r.data.ok).toBe(false);
      expect(r.data.reason).toBe('empty-policy');
      expect(r.text.startsWith('[sofagent]')).toBe(true);
    });

    it('验收 ③：白名单内读取 + 脱敏（sk- 密钥不出设备）', async () => {
      saveDeviceDataPolicy({ version: 1, deviceId: legal.agentId, allowedDirs: [path.join(dataDir, 'reports')] }, dataDir);
      const r = await deviceDataQuery({ identity: legal as unknown as Record<string, unknown>, path: allowedFile });
      expect(r.data.ok).toBe(true);
      expect(r.data.content).toContain('月度报告');
      expect(r.data.content).not.toContain('sk-abcdefghij');
      expect(r.data.redactHits).toBeGreaterThan(0);
      expect(r.data.allowedDir).toBe(path.join(dataDir, 'reports'));
    });

    it('验收 ②：白名单外路径 → 拒绝', async () => {
      const r = await deviceDataQuery({ identity: legal as unknown as Record<string, unknown>, path: path.join(dataDir, 'secret.txt') });
      expect(r.data.ok).toBe(false);
      expect(r.data.reason).toBe('path-not-allowed');
    });

    it('未注册设备 → gateDevice 拒绝（not-registered）', async () => {
      const r = await deviceDataQuery({ identity: foreign as unknown as Record<string, unknown>, path: allowedFile });
      expect(r.data.ok).toBe(false);
      expect(r.data.reason).toBe('not-registered');
    });

    it('参数缺失 → invalid-params', async () => {
      const r = await deviceDataQuery({ identity: legal as unknown as Record<string, unknown>, path: '' });
      expect(r.data.reason).toBe('invalid-params');
    });

    it('文件不存在 → not-found', async () => {
      const r = await deviceDataQuery({ identity: legal as unknown as Record<string, unknown>, path: path.join(dataDir, 'reports', 'nope.txt') });
      expect(r.data.reason).toBe('not-found');
    });
  });

  describe('device_data_push（G11 上行通道）', () => {
    it('验收 ①：空采集声明 → 拒绝（empty-policy）', async () => {
      const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload: 'cpu=80%' });
      expect(r.data.ok).toBe(false);
      expect(r.data.reason).toBe('empty-policy');
      expect(r.text.startsWith('[sofagent]')).toBe(true);
    });

    it('验收 ④：声明内入队 + 加密（WAL 只存密文）', async () => {
      saveDeviceUploadPolicy(
        { version: 1, deviceId: legal.agentId, declarations: [{ category: 'metrics', destination: 'platform-ingest' }] },
        dataDir,
      );
      const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload: 'cpu=80% key=sk-abcdefghij0123456789' });
      expect(r.data.ok).toBe(true);
      expect(r.data.seq).toBeGreaterThan(0);
      expect(r.data.delivery).toBe('queued');
      const walContent = fs.readFileSync(path.join(dataDir, 'upload-wal.jsonl'), 'utf-8');
      expect(walContent).not.toContain('cpu=80%');
      expect(walContent).not.toContain('sk-abcdefghij');
    });

    it('验收 ③：传输回调送达 → ack 推进 + 已 ack 段不重传', async () => {
      const sentSeqs: number[] = [];
      const transport = (entry: { seq: number }): boolean => {
        sentSeqs.push(entry.seq);
        return true;
      };
      const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload: 'cpu=90%', transport });
      expect(r.data.ok).toBe(true);
      expect(r.data.delivery).toBe('sent');
      expect(r.data.pending).toBe(0);
      // 再推一条：前一条已 ack 不重传（sentSeqs 只含新条目）
      const r2 = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload: 'cpu=95%', transport });
      expect(r2.data.ok).toBe(true);
      // 续传不变量：已 ack 段无重复发送 + 第二次传输只送新 seq
      expect(new Set(sentSeqs).size).toBe(sentSeqs.length);
      expect(sentSeqs[sentSeqs.length - 1]).toBe(r2.data.seq);
      expect(r2.data.seq!).toBeGreaterThan(r.data.seq!);
    });

    it('传输回调全部失败 → queued（断网暂存语义）', async () => {
      const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload: 'x', transport: () => false });
      expect(r.data.ok).toBe(true);
      expect(r.data.delivery).toBe('queued');
      expect((r.data.pending ?? 0)).toBeGreaterThan(0);
    });

    it('声明外类别 → 拒绝（category-not-declared）', async () => {
      const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'inference-result', payload: '结论' });
      expect(r.data.reason).toBe('category-not-declared');
    });

    it('未注册设备 → gateDevice 拒绝', async () => {
      const r = await deviceDataPush({ identity: foreign as unknown as Record<string, unknown>, category: 'metrics', payload: 'x' });
      expect(r.data.reason).toBe('not-registered');
    });
  });

  describe('registry 接线（铁律 9：生产调用点存在性）', () => {
    it('TOOLS 数组含 device_data_query / device_data_push', () => {
      const names = TOOLS.map((t) => t.name);
      expect(names).toContain('device_data_query');
      expect(names).toContain('device_data_push');
      expect(TOOLS.length).toBe(105);
    });
  });
});
