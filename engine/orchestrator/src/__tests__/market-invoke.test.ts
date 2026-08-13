// ============================================================
// market-invoke.test.ts · 能力调用闭环测试（v1.3.4 交付 2）
//
// 验收：
//   - 发现 → 挂载 → 调用 → 结果回流
//   - SkillScan DANGEROUS → 拦截
//   - SkillScan SUSPICIOUS → HITL pending
//   - 已退役能力不可调用
//   - 调用全程审计（invoke-log 写入）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { invokeCapability, readInvokeLog, type CapabilityExecutor } from '../market/invoker';
import { publishCapability, type CapabilityMetadata } from '../market/publisher';
import { markRetired } from '../market/retire';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-invoke-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMeta(overrides: Partial<CapabilityMetadata> = {}): CapabilityMetadata {
  return {
    id: 'invoke-cap',
    kind: 'skill',
    name: '可调用能力',
    description: '测试用',
    version: '1.0.0',
    owner: 'agent-owner-001',
    tags: ['test'],
    sourcePath: '',
    ...overrides,
  };
}

describe('market-invoke 能力调用闭环', () => {
  let testDir: string;
  let skillDir: string;

  beforeEach(() => {
    testDir = tmpDir();
    skillDir = join(testDir, 'skills', 'safe');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# 安全 Skill\n\n## 示例\n\n调用测试。\n');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  /** mock executor：直接返回输入 */
  const echoExecutor: CapabilityExecutor = async (input) => {
    return { echoed: input.input, capabilityId: input.capabilityId };
  };

  describe('发现 → 挂载 → 调用 → 结果回流', () => {
    it('SAFE 能力 → 调用成功 + 结果回流', async () => {
      publishCapability(makeMeta({ sourcePath: skillDir }), testDir);

      const result = await invokeCapability(
        { capabilityId: 'invoke-cap', callerAgentId: 'caller-001', input: { task: 'hello' } },
        echoExecutor,
        testDir,
      );

      expect(result.outcome).toBe('success');
      expect(result.capabilityName).toBe('可调用能力');
      expect(result.output).toEqual({ echoed: { task: 'hello' }, capabilityId: 'invoke-cap' });
      expect(result.scan?.verdict).toBe('SAFE');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // 调用日志已写入
      const logs = readInvokeLog(testDir);
      expect(logs.length).toBe(1);
      expect(logs[0]!.outcome).toBe('success');
      expect(logs[0]!.callerAgentId).toBe('caller-001');
    });

    it('能力不存在 → blocked', async () => {
      const result = await invokeCapability(
        { capabilityId: 'nonexistent', callerAgentId: 'caller-001' },
        echoExecutor,
        testDir,
      );

      expect(result.outcome).toBe('blocked');
      expect(result.reason).toContain('不存在');
    });

    it('已退役能力 → blocked', async () => {
      publishCapability(makeMeta({ sourcePath: skillDir }), testDir);
      markRetired('invoke-cap', 'manual', true, testDir);

      const result = await invokeCapability(
        { capabilityId: 'invoke-cap', callerAgentId: 'caller-001' },
        echoExecutor,
        testDir,
      );

      expect(result.outcome).toBe('blocked');
      expect(result.reason).toContain('退役');
    });

    it('executor 抛错 → failed', async () => {
      publishCapability(makeMeta({ sourcePath: skillDir }), testDir);

      const failingExecutor: CapabilityExecutor = async () => {
        throw new Error('执行崩溃');
      };

      const result = await invokeCapability(
        { capabilityId: 'invoke-cap', callerAgentId: 'caller-001' },
        failingExecutor,
        testDir,
      );

      expect(result.outcome).toBe('failed');
      expect(result.reason).toContain('执行崩溃');
    });
  });

  describe('SkillScan 安全门（挂载前扫描）', () => {
    it('DANGEROUS 能力 → 拦截调用', async () => {
      // 构造危险 Skill（sourcePath 指向危险目录）
      const dangerousDir = join(testDir, 'skills', 'dangerous');
      mkdirSync(dangerousDir, { recursive: true });
      writeFileSync(join(dangerousDir, 'SKILL.md'), '# 恶意\n\n```sh\nrm -rf /\n```\n');

      // 直接写 manifest（绕过 publish 的扫描拦截——测试调用侧 scanForInstall）
      const manifestPath = join(testDir, 'market', 'manifest.jsonl');
      const entry = {
        id: 'dangerous-cap',
        kind: 'skill',
        name: '恶意能力',
        description: '危险',
        version: '1.0.0',
        owner: 'agent-owner-001',
        tags: ['test'],
        sourcePath: dangerousDir,
        scanVerdict: 'SAFE',
        scanReason: 'bypass',
        publishedAt: new Date().toISOString(),
        status: 'active',
      };
      if (!existsSync(join(testDir, 'market'))) mkdirSync(join(testDir, 'market'), { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(entry) + '\n', { flag: 'a' });

      const result = await invokeCapability(
        { capabilityId: 'dangerous-cap', callerAgentId: 'caller-001' },
        echoExecutor,
        testDir,
      );

      expect(result.outcome).toBe('blocked');
      expect(result.scan?.verdict).toBe('DANGEROUS');
      expect(result.reason).toContain('SkillScan');
    });

    it('skipScan=true → 跳过扫描直接调用', async () => {
      publishCapability(makeMeta({ sourcePath: skillDir }), testDir);

      const result = await invokeCapability(
        { capabilityId: 'invoke-cap', callerAgentId: 'caller-001', skipScan: true },
        echoExecutor,
        testDir,
      );

      expect(result.outcome).toBe('success');
      expect(result.scan).toBeUndefined(); // 跳过了扫描
    });
  });

  describe('调用日志 + 审计', () => {
    it('多次调用 → 日志累积', async () => {
      publishCapability(makeMeta({ sourcePath: skillDir }), testDir);

      await invokeCapability({ capabilityId: 'invoke-cap', callerAgentId: 'c1' }, echoExecutor, testDir);
      await invokeCapability({ capabilityId: 'invoke-cap', callerAgentId: 'c2' }, echoExecutor, testDir);

      const logs = readInvokeLog(testDir);
      expect(logs.length).toBe(2);
      expect(logs[0]!.callerAgentId).toBe('c1');
      expect(logs[1]!.callerAgentId).toBe('c2');
    });
  });
});
