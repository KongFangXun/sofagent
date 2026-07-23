// ============================================================
// tool-sensitive-file.test.ts · 敏感文件保护规则测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { toolSensitiveFile } from '../rules/tool-sensitive-file';
import type { ToolCallContext } from '../types';

function makeCtx(args: Record<string, unknown>): ToolCallContext {
  return { toolName: 'write_file', args, agentName: 'engineer', taskDesc: 'test', cwd: '/tmp' };
}

describe('tool-sensitive-file', () => {
  it('普通文件路径 → PASS', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: 'src/index.ts' })).status).toBe('PASS');
  });

  it('.env 文件 → FAIL', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: '.env' })).status).toBe('FAIL');
  });

  it('.env.local → FAIL', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: '.env.local' })).status).toBe('FAIL');
  });

  it('.sofagent/config.yml → FAIL', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: '.sofagent/config.yml' })).status).toBe('FAIL');
  });

  it('id_rsa → FAIL', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: '~/.ssh/id_rsa' })).status).toBe('FAIL');
  });

  it('.pem 文件 → FAIL', () => {
    expect(toolSensitiveFile.check(makeCtx({ path: 'certs/server.pem' })).status).toBe('FAIL');
  });

  it('嵌套 args 中的敏感路径 → FAIL', () => {
    expect(
      toolSensitiveFile.check(makeCtx({ options: { file: '.env.production' } })).status,
    ).toBe('FAIL');
  });

  it('多文件中只有一个敏感 → FAIL 且 details 含该文件', () => {
    const result = toolSensitiveFile.check(makeCtx({ files: ['src/index.ts', '.env'] }));
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('.env');
  });
});
