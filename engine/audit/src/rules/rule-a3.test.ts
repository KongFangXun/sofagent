// ============================================================
// rule-a3.test.ts · A3 不改越界——中英匹配 + 阈值 + 中文路径测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA3 } from './rule-a3-careful-modify';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A3 不改越界', () => {
  it('无 task 参数 → PASS（跳过检查）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')]);
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('未提供');
  });

  it('任务描述含英文文件名 + diff 文件匹配 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/components/login.tsx')],
      '修复 login.tsx 的 bug'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('任务描述含中文关键词 + diff 文件路径含英文 → 中文关键词无法匹配英文路径，触发 WARN', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/auth/session.ts')],
      { task: '修复登录认证逻辑' }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('1/1');
  });

  it('20% 阈值：5 个文件中 1 个不匹配 → PASS（20% 不超过阈值）', () => {
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('src/session.ts'),
      makeDiffFile('src/token.ts'),
      makeDiffFile('README.md'), // 不在任务范围
    ];
    const ctx = makeCtx(files, { task: 'login auth session token' });
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('20% 阈值：5 个文件中 2 个不匹配 → WARN（40% 超过阈值）', () => {
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('README.md'),
      makeDiffFile('CHANGELOG.md'),
      makeDiffFile('src/unrelated.ts'),
    ];
    const ctx = makeCtx(files, { task: 'login auth' });
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('1/3');
  });

  it('低风险文件（package-lock.json）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('package-lock.json')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（README.md）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('README.md')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（LICENSE 全大写）被正确识别', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('LICENSE')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（Readme.md 混合大小写）被正确识别', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('Readme.md')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（CHANGELOG.md）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('CHANGELOG.md')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件在子目录也排除（无 ^ 锚点）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('packages/foo/README.md')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('低风险文件（tsconfig.json）不计入检查', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts'), makeDiffFile('tsconfig.json')],
      '修复 login 模块'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('路径模式匹配：任务描述含路径片段', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/components/Button.tsx'), makeDiffFile('src/components/Input.tsx')],
      '重构 src/components 目录下的组件'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('阈值不是 30%：3 个文件中 1 个不匹配 → WARN（33% > 20% 阈值）', () => {
    const files = [
      makeDiffFile('src/login.ts'),
      makeDiffFile('src/auth.ts'),
      makeDiffFile('src/unrelated.ts'),
    ];
    const ctx = makeCtx(files, { task: 'login auth' });
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
  });

  // 中文路径测试（v0.95 新增）
  it('中文路径文件：任务描述含中文路径 + diff 文件路径含中文 → basename 匹配 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/工具/helper.ts')],
      '修改 src/工具/helper.ts 的工具函数'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('中文路径文件：任务描述含中文文件名 + diff 文件匹配 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/组件/登录.ts')],
      '修复 登录.ts 组件'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('中文路径文件：多个中文路径文件大部分匹配 → PASS', () => {
    const ctx = makeCtx(
      [
        makeDiffFile('src/工具/config.ts'),
        makeDiffFile('src/工具/utils.ts'),
        makeDiffFile('src/工具/helper.ts'),
      ],
      '修改 src/工具/config.ts 和 src/工具/utils.ts 和 src/工具/helper.ts'
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('*.log 低风险模式不误匹配 auth/login.ts（glob 转义回归测试）', () => {
    const ctx = makeCtx(
      [makeDiffFile('auth/login.ts')],
      { task: '修复认证模块的会话逻辑' }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
  });

  // v0.97 追加 test cases
  it('空字符串 task → PASS（跳过检查）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { task: '' });
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('未提供');
  });

  it('undefined task → PASS（跳过检查）', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts')], { task: undefined });
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('未提供');
  });

  it('+ 号分割关键词 → 匹配成功 PASS', () => {
    // commit message 中用 + 连接组件名（项目惯用格式）：SKILL+engage+FDE+install
    // 此前 + 不是分割符导致整串不匹配 → 误报 WARN
    const ctx = makeCtx(
      [makeDiffFile('FDE/GUIDE.md')],
      { task: 'v1.1.3: SKILL+engage+FDE+install+审查体系' }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('路径关键词匹配但不同文件 → WARN（关键词 auth 匹配 auth.ts 但任务只提 login）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/auth.ts')],
      { task: '修复 login 的登录逻辑' }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
  });

  // ---- commitMsg 关联测试（v1.x：A3 不再只匹配 subject，也匹配 commit body）----

  it('commit message body 含文件名 -> 即使 subject 未提也判定相关 -> PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('FORGE/FORGE.md')],
      {
        task: 'docs: orchestrator 编排引擎实现原理补全',
        commitMsg: 'docs: orchestrator 编排引擎实现原理补全\n\n- FORGE/FORGE.md: 删"计划中"段\n- ARCHITECTURE.md: +5 子节',
      }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });

  it('commit message body 也未提及文件 -> 仍然 WARN（不因有 commitMsg 就放行）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/unrelated.ts')],
      {
        task: '修复 login 模块',
        commitMsg: '修复 login 模块\n\n仅改了 login.ts 和 auth.ts',
      }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('WARN');
  });

  it('commitMsg 为 undefined -> 回退到仅 task 匹配（向后兼容）', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/login.ts')],
      { task: '修复 login.ts', commitMsg: undefined }
    );
    const result = checkRuleA3(ctx);
    expect(result.status).toBe('PASS');
  });
});
