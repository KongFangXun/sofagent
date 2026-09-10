// train-cloud-registry.test.ts · 云 VM 注册表两态行为测试（v1.4.7 批次 I）
// 覆盖：损坏 JSON → WARN + .corrupt 备份留证 + 空表重建；不存在 → 首次初始化无备份
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 隔离 SOFAGENT_DATA（getDataDir SSOT 解析链：显式 > SOFAGENT_DATA > SOFAGENT_HOME/data）
const ISO_DIR = join(tmpdir(), `sofagent-mcp-train-cloud-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

// 环境变量设置后再 import 被测模块（registryPath 经 getDataDir 读环境）
const { trainCloud } = await import('../tools/train-cloud');

const regDir = join(ISO_DIR, 'train', 'cloud');
const regPath = join(regDir, 'registry.json');

describe('train_cloud 注册表两态（损坏可辨 · v1.4.7 批次 I）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(regDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('损坏 JSON → list 返回空表 + .corrupt 备份留证', async () => {
    writeFileSync(regPath, '{{{not json', 'utf-8');
    const result = await trainCloud({ action: 'list' });
    // 行为面：不报错（isError=false）返回空表
    expect(result.data.isError).toBe(false);
    expect(result.data.vms).toEqual([]);
    // 留证面：损坏文件改名 .corrupt-<ts>.bak，原路径腾空
    const bak = readdirSync(regDir).find(
      (f) => f.startsWith('registry.json.corrupt-') && f.endsWith('.bak'),
    );
    expect(bak).toBeDefined();
    expect(readFileSync(join(regDir, bak!), 'utf-8')).toBe('{{{not json');
  });

  it('注册表不存在 → 首次初始化（无 .corrupt 备份产生）', async () => {
    const result = await trainCloud({ action: 'list' });
    expect(result.data.isError).toBe(false);
    expect(result.data.vms).toEqual([]);
    // 不存在 = 首次正常运行，绝不产生备份文件
    expect(readdirSync(regDir).filter((f) => f.includes('.corrupt-'))).toEqual([]);
  });
});
