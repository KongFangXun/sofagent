// ============================================================
// agent-identity.test.ts · Agent 身份码测试（v1.2.8 §3.1）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  generateAgentIdentity,
  computeFingerprint,
  computeShortCode,
  extractConstraintsFromPrompt,
} from '../agent-identity';

describe('§3.1 Agent 身份码', () => {
  describe('generateAgentIdentity', () => {
    it('生成完整身份码对象', () => {
      const identity = generateAgentIdentity('customer-intake', {
        systemPrompt: '你是客户接单 Agent',
        tools: ['Read', 'Write'],
      });

      expect(identity.agentId).toBeTruthy();
      expect(identity.displayName).toBe('customer-intake');
      expect(identity.principal).toBe('enterprise');
      expect(identity.fingerprint).toHaveLength(16);
      expect(identity.shortCode).toHaveLength(6);
      expect(identity.createdAt).toBeTruthy();
      expect(identity.constraints).toEqual([]);
    });

    it('自定义 principal', () => {
      const identity = generateAgentIdentity('agent-x', {
        principal: 'acme-corp',
      });
      expect(identity.principal).toBe('acme-corp');
    });
  });

  describe('computeFingerprint — 幂等性', () => {
    it('相同输入 → 相同指纹', () => {
      const fp1 = computeFingerprint('agent-a', 'prompt-x', ['Read'], ['constraint-1']);
      const fp2 = computeFingerprint('agent-a', 'prompt-x', ['Read'], ['constraint-1']);
      expect(fp1).toBe(fp2);
    });

    it('不同 agentName → 不同指纹', () => {
      const fp1 = computeFingerprint('agent-a', 'prompt-x', ['Read'], []);
      const fp2 = computeFingerprint('agent-b', 'prompt-x', ['Read'], []);
      expect(fp1).not.toBe(fp2);
    });

    it('不同 systemPrompt → 不同指纹', () => {
      const fp1 = computeFingerprint('agent-a', 'prompt-1', ['Read'], []);
      const fp2 = computeFingerprint('agent-a', 'prompt-2', ['Read'], []);
      expect(fp1).not.toBe(fp2);
    });

    it('不同 tools → 不同指纹', () => {
      const fp1 = computeFingerprint('agent-a', 'prompt-x', ['Read'], []);
      const fp2 = computeFingerprint('agent-a', 'prompt-x', ['Write'], []);
      expect(fp1).not.toBe(fp2);
    });

    it('指纹为 16 位十六进制', () => {
      const fp = computeFingerprint('test', 'prompt', ['tool'], []);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('computeShortCode', () => {
    it('生成 6 位 Base36 短码', () => {
      const sc = computeShortCode('agent-a', 'abcdef0123456789');
      expect(sc).toHaveLength(6);
      expect(sc).toMatch(/^[0-9a-z]{6}$/);
    });

    it('相同输入 → 相同短码', () => {
      const sc1 = computeShortCode('agent-a', 'abcdef0123456789');
      const sc2 = computeShortCode('agent-a', 'abcdef0123456789');
      expect(sc1).toBe(sc2);
    });
  });

  describe('extractConstraintsFromPrompt', () => {
    it('从 systemPrompt 中提取知识域约束', () => {
      const prompt = `
[Agent: test — 测试]
你是测试 Agent。

## 知识域约束
允许访问的知识域: 客户信息, 订单格式
禁止访问的知识域: 其他客户数据
`;
      const constraints = extractConstraintsFromPrompt(prompt);
      expect(constraints).toHaveLength(2);
      expect(constraints[0]).toContain('允许');
      expect(constraints[1]).toContain('禁止');
    });

    it('无知识域约束段时返回空数组', () => {
      const prompt = '你是测试 Agent，没有约束段落。';
      const constraints = extractConstraintsFromPrompt(prompt);
      expect(constraints).toEqual([]);
    });

    it('限制最大提取条数', () => {
      const prompt = `
## 知识域约束
允许访问的知识域: a
允许访问的知识域: b
允许访问的知识域: c
允许访问的知识域: d
允许访问的知识域: e
允许访问的知识域: f
`;
      const constraints = extractConstraintsFromPrompt(prompt, 3);
      expect(constraints).toHaveLength(3);
    });
  });

  describe('重复 activate 幂等性验证', () => {
    it('相同参数多次生成 → fingerprint 不变', () => {
      const opts = {
        systemPrompt: '你是客户接单 Agent',
        tools: ['Read', 'Write', 'Bash'],
        constraints: ['允许: 客户信息', '禁止: 其他数据'],
      };

      const id1 = generateAgentIdentity('customer-intake', opts);
      const id2 = generateAgentIdentity('customer-intake', opts);

      // agentId 是 UUID（每次不同），但 fingerprint 和 shortCode 应相同
      expect(id1.fingerprint).toBe(id2.fingerprint);
      expect(id1.shortCode).toBe(id2.shortCode);
      expect(id1.agentId).not.toBe(id2.agentId);
    });
  });
});
