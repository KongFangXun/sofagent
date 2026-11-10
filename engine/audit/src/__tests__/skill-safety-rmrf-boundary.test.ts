// ============================================================
// skill-safety-rmrf-boundary.test.ts · F-18 豁免边界收紧回归锁
// fresh-eyes R3 视角7 + R4 复验：原前瞻 `(?!tmp|home\/\w+\/\.)` 无边界约束，
// 13 探针中 5 条恶意形态漏判（/tmpdata、/tmp/../../etc、/home/user/.ssh、
// /home/user/.config、/home/user/../../etc）。收紧为「精确形态收口」：
//   豁免仅限 /tmp（可选尾斜杠）与 /home/<w>/.（目录本身），子路径与相对跳转一律拦。
// 两处扫描器（skill-safety/rules.ts + agent-shield.ts）口径同步（v1.3.7 统一纪律）。
// ⚠️ 探针口径声明：任务书执行段的「/home/u/.cache → MISS」与「.ssh → HIT」
// 在正则上同构互斥（均为点开头的子路径），按任务书总表 13 探针的保守口径
// 取「目录本身豁免」——.cache 同判 HIT，偏差已在施工回执登记。
// ============================================================
import { describe, it, expect } from 'vitest';
import { COMPILED_RULES } from '../skill-safety/rules';
import { createAgentShield } from '../agent-shield';

/** 取 rm -rf 危险删除规则（skill-safety 侧） */
const rmrfRule = COMPILED_RULES.find(
  (r) => r.category === '恶意命令' && /rm -rf/.test(r.description),
);
if (!rmrfRule) throw new Error('未找到 rm -rf 危险删除规则——rules.ts 结构变化须同步本测试');

/** agent-shield 侧同款规则（经 hookRules 面取，缺则 skip 该组） */
const shield = createAgentShield() as unknown as {
  hookRules?: Array<{ pattern: RegExp; message: string }>;
};
const shieldRmrf = shield.hookRules?.find((r) => /rm/.test(r.message)) ?? null;

describe('F-18 · rm -rf 豁免边界收紧（skill-safety 侧 13 探针·总表口径）', () => {
  // ① 恶意应拦（3+1）
  it.each(['rm -rf /etc', 'rm -rf /var', 'rm -rf /usr', 'rm -rf /'])('%s → HIT', (cmd) => {
    expect(rmrfRule.pattern.test(cmd)).toBe(true);
  });
  // ② 设计豁免精确形态应放（3）
  it.each(['rm -rf /tmp', 'rm -rf /tmp/', 'rm -rf /home/user/.'])('%s → MISS', (cmd) => {
    expect(rmrfRule.pattern.test(cmd)).toBe(false);
  });
  // ③ 原漏判形态修复后应 HIT（5）
  it.each([
    'rm -rf /tmpdata',
    'rm -rf /tmp/../../etc',
    'rm -rf /home/user/.ssh',
    'rm -rf /home/user/.config',
    'rm -rf /home/user/../../etc',
  ])('%s → HIT（原漏判，收紧后必须拦）', (cmd) => {
    expect(rmrfRule.pattern.test(cmd)).toBe(true);
  });
  // ④ 子路径与跳转一律回判（同构面声明——.cache 与 .ssh 同判，见文件头口径声明）
  it('rm -rf /tmp/x 与 /home/user/.cache → HIT（豁免仅目录本身；.cache 与 .ssh 正则同构）', () => {
    expect(rmrfRule.pattern.test('rm -rf /tmp/x')).toBe(true);
    expect(rmrfRule.pattern.test('rm -rf /home/user/.cache')).toBe(true);
  });
});

describe.skipIf(!shieldRmrf)('F-18 · agent-shield 侧同款探针（口径同步）', () => {
  it.each(['rm -rf /tmpdata', 'rm -rf /tmp/../../etc', 'rm -rf /home/user/.ssh'])(
    '%s → HIT（shield 侧同步收紧）',
    (cmd) => {
      expect(shieldRmrf!.pattern.test(cmd)).toBe(true);
    },
  );
  it.each(['rm -rf /tmp', 'rm -rf /home/user/.'])('%s → MISS（shield 侧精确形态豁免）', (cmd) => {
    expect(shieldRmrf!.pattern.test(cmd)).toBe(false);
  });
});
