import { describe, expect, it } from 'vitest';
import type { AuditContext } from '../rules/types';
import { scanA2 } from '../rules/rule-a2-secret-leak';

/**
 * A2 对抗性 golden-set（v1.4.8 bugfix 批 · 红队成果固化）
 *
 * 来源：四轮独立审查第四批安全级三连（R1/R2/R3）——攻击样本固化为永久回归资产：
 * - R1 头引号逃逸：值剥离正则 `$` 锚定只剥尾不剥头，`awsSecretKey = "QUtJ..."` 带引号
 *   形态（Python/JS 最常见密钥写法 × base64 最常见混淆手段）恰好逃逸 base64 校验。
 * - R2 Cyrillic 同形字：`рсk-proj-...`（рс 为 Cyrillic）骗过前缀锚与赋值值起点；
 *   NFKC 只折叠全角不折叠跨字母系统同形字，需附加折叠表。
 * - 混合编码：头引号 + 同形字 + zero-width 组合形态。
 * - 对照组：同形字出现在普通注释文本中不应误报（折叠只影响检测候选，不放大误报面）。
 */

function ctxWith(lines: string[]): AuditContext {
  return {
    diffFiles: [{ path: 'probe.py', status: 'added', lines }],
  } as unknown as AuditContext;
}

describe('A2 对抗性 golden-set（R1/R2 红队成果固化）', () => {
  it('R1: 带头引号 base64 AWS Secret Key 被拦截（修复前逃逸）', () => {
    const rule = scanA2(
      ctxWith(['+awsSecretKey = "QUtJQVc5WEFNUExFS0VZMTIzNDU2"']),
    );
    expect(rule.status).toBe('FAIL');
    expect(rule.details.join(' ')).toContain('AWS Access Key');
  });

  it('R1: 单引号与反引号形态同样被拦截', () => {
    const single = scanA2(ctxWith(["+awsSecretKey = 'QUtJQVc5WEFNUExFS0VZMTIzNDU2'"]));
    expect(single.status).toBe('FAIL');
    const backtick = scanA2(ctxWith(['+awsSecretKey = `QUtJQVc5WEFNUExFS0VZMTIzNDU2`']));
    expect(backtick.status).toBe('FAIL');
  });

  it('R1: 无引号裸值形态保持被拦截（回归防倒退）', () => {
    const rule = scanA2(ctxWith(['+awsSecretKey = QUtJQVc5WEFNUExFS0VZMTIzNDU2']));
    expect(rule.status).toBe('FAIL');
  });

  it('R2: Cyrillic 同形前缀 рсk-proj- 被拦截（NFKC 不折叠跨字母同形）', () => {
    const rule = scanA2(
      ctxWith(['+api_key = "рсk-proj-abcdefghij0123456789ABCDEFGHIJ"']),
    );
    expect(rule.status).toBe('FAIL');
  });

  it('R2: 同形字混入 sk- 前缀主体被拦截', () => {
    const rule = scanA2(
      ctxWith(['+apiKey = "sk-рrоj-abcdefghij0123456789ABCDEFGHIJ"']),
    );
    expect(rule.status).toBe('FAIL');
  });

  it('R2+R1 混合：头引号 + Cyrillic 同形组合逃逸被拦截', () => {
    const rule = scanA2(
      ctxWith(['+secret = "рсk-proj-QUtJQVc5WEFNUExFS0VZMTIzNDU2"']),
    );
    expect(rule.status).toBe('FAIL');
  });

  it('对照组: 普通注释文本含 Cyrillic 同形字不误报', () => {
    const rule = scanA2(ctxWith(['+note = "рсk 示例文本，非密钥形态"']));
    expect(rule.status).toBe('PASS');
  });

  it('对照组: 短占位值与 env 引用不误报', () => {
    const rule = scanA2(ctxWith(['+token = "short"']));
    expect(rule.status).toBe('PASS');
  });
});
