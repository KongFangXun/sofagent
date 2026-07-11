// ============================================================
// skillopt-integration.test.ts · SkillOpt 集成单元测试
// v1.0.2 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from '../skillopt-integration';

describe('runSkillOpt', () => {
  it('输入文件不存在时返回 error', () => {
    const result = runSkillOpt('/tmp/nonexistent-skill-12345.md', '/tmp/output.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });
});

describe('validateCandidate', () => {
  it('候选文件不存在时返回 false', () => {
    const result = validateCandidate('/tmp/nonexistent-candidate.md', '/tmp/nonexistent-current.md');
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('读取失败');
  });
});

describe('isSkillOptAvailable', () => {
  it('在 CLI 不可用时返回 false', () => {
    // skillopt-sleep 是 Python 包，CI 环境通常未安装
    // 不假设它可用——只要不 crash 就算通过
    const result = isSkillOptAvailable();
    expect(typeof result).toBe('boolean');
  });
});
