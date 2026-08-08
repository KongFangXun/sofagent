// ============================================================
// daemon-status.test.ts · daemon_status tool 测试
// v1.2.9 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { daemonStatus } from '../tools/daemon-status';

describe('daemon_status tool（v1.2.6）', () => {
  // 用例：daemon 未安装时返回友好提示（测试环境下 @sofagent/daemon 可能不可用）
  it('返回结构包含 [sofagent] 前缀和 text/data 字段', async () => {
    const result = await daemonStatus();
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('data');
    expect(result.text).toMatch(/^\[sofagent\]/);
    expect(result.data).toHaveProperty('healthy');
    expect(result.data).toHaveProperty('status');
    expect(result.data).toHaveProperty('message');
  });

  // 用例：text 首行包含 [sofagent] 前缀（三层签名铁律）
  it('text 首行以 [sofagent] 开头', async () => {
    const result = await daemonStatus();
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });
});
