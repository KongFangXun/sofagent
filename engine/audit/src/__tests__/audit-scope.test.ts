// ============================================================
// audit-scope.test.ts · 审计范围语义一等公民化（AuditScope）回归锁
// v1.5.3 第七章
// ============================================================
// 目的：把「审计范围 + 上下文输入」从「规则各自调 git」（A18 `git ls-tree HEAD` /
//   A5 `git log -1`）收口为一个**显式对象** `AuditScope`：
//   唯一构造**工厂** = scope.ts#createAuditScope（**规则侧**唯一 git 触达点），规则侧零 git。
//
// 本锁四条断言面（对 devlog §七 验收逐条对位）：
//   ① 构造唯一 + 懒解析：未消费的字段不触 git（注入面零 git；未注入面触 git 计数非空转）；
//   ② 规则侧零 git（**行为证据**，非仅静态 grep）：scanA5 / scanA18 / 全量 runRules 整跑，
//      scopeGitCallCount 恒为 0；
//   ③ 规则实现面零直接 git 调用原语（**静态证据**：rule-*.ts 无 execFileSync/child_process）；
//   ④ 重构前后判定逐字节一致（**回归锁**：整份 audit 输出 JSON diff=0，覆盖 A24）。
//   ⑤ 收口断言（D7 复核返工）：`actorSource` 观测面（explicit / unavailable，不空 catch）
//      + A5 无 scope 且无 commitMsg ⇒ 显式 SKIPPED（不静默 PASS）。
//
// 快照口径：
//   生成/刷新：cd engine/audit && SOFAGENT_SNAPSHOT_OUT=<path> npx vitest run audit-scope
//   常规运行：读快照并断言逐字节相等（diff 必须为 0）
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AuditConfig } from '@sofagent/core';
import { createAuditScope, resetScopeGitCallCount, scopeGitCallCount } from '../scope';
import type { AuditScope } from '../scope';
import { runRules } from '../reporter';
import type { AuditContext, RuleCheck } from '../rules/types';
import { scanA5 } from '../rules/rule-a5-honest-report';
import { scanA18 } from '../rules/rule-a18-junk-file';
import { makeCtx, makeDiffFile } from '../test-utils';

const HERE = dirname(fileURLToPath(import.meta.url));
/** rules/ 目录（规则实现面静态扫描根） */
const RULES_DIR = join(HERE, '..', 'rules');
/** 已落盘的回归快照（重构前口径固化；重构后必须 diff=0） */
const SNAPSHOT_PATH = join(HERE, '..', '..', '..', '..', 'docs', 'evidence', 'v1.5.3-audit-scope-snapshot.json');
/** 快照顶层标注（生成器**必须**产出——否则文档中的生成命令无法逐字节复现提交件） */
const SNAPSHOT_GENERATED_FOR = 'v1.5.3 第七章·审计范围语义一等公民化（AuditScope）——重构前后判定一致性回归锁';
const SNAPSHOT_NOTE =
  '审计范围语义一等公民化（AuditScope）的重构前后一致性快照。第 1 份由重构前逻辑（A18 规则内自调 `git ls-tree -r HEAD` 取豁免基线 / A5 内自调 `git log -1` 取 commit message）在固定 cwd 仓库产出；' +
  '第 2 份由重构后逻辑（规则侧零 git，输入恒经 ctx.scope）**以注入基线**复现——两份必须逐字节一致（diff=0）；证明「输入面收口到 AuditScope」零行为漂移。' +
  '（快照为确定性夹具：scope 的 commitMsg/actor/headTreeFiles 与 history 全部注入/固定，输出与 cwd、真实 git 状态无关。）' +
  '生成/刷新：cd engine/audit && SOFAGENT_SNAPSHOT_OUT=<path> npx vitest run src/__tests__/audit-scope.test.ts';

// ── 确定性夹具（覆盖 A18 垃圾豁免语义 + A24 交付物落点白名单 + A3/E1 告警）──
//   与重构前离线对照夹具（/tmp/scope_fixture）逐字段一致。
const FIXTURE_TASK = 'fixture task';
const FIXTURE_COMMIT = 'feat: add fixture files';

/** 夹具 diff：a.txt（垃圾候选·在基线→豁免）/ b.js（垃圾候选·不在基线→WARN）/
 *  src/index.ts（良性·触发 E1）/ notes.md（交付物·白名单外→A24 FAIL）/
 *  outputs/report.md（交付物·白名单内→A24 不误报） */
function fixtureDiff() {
  return [
    makeDiffFile('a.txt', ['+x'], 'added'),
    makeDiffFile('b.js', ['+y'], 'added'),
    makeDiffFile('src/index.ts', ['+export const x = 1;'], 'added'),
    makeDiffFile('notes.md', ['+note'], 'added'),
    makeDiffFile('outputs/report.md', ['+ok'], 'added'),
  ];
}

const FIXTURE_CONFIG: AuditConfig = {
  lowRiskPatterns: [],
  testPatterns: [],
  carefulModifyThreshold: 0.5,
  extendedRulesEnabled: true,
  A24: { enabled: true, allowed_dirs: ['outputs/'] },
};

/** 确定性 scope：输入面全部注入 → 输出与 cwd / 真实 git 无关，可逐字节复现 */
function fixtureScope(): AuditScope {
  return createAuditScope({
    diffRange: 'HEAD',
    commitMsg: FIXTURE_COMMIT,
    task: FIXTURE_TASK,
    actor: 'FixtureBot',
    headTreeFiles: () => new Set(['a.txt']),
  });
}

/** 跑夹具（对象签名，走真实审计聚合路径） */
function runFixture() {
  return runRules({
    diffFiles: fixtureDiff(),
    logEntries: [],
    task: FIXTURE_TASK,
    silent: true,
    commitMsg: FIXTURE_COMMIT,
    config: FIXTURE_CONFIG,
    history: [], // 固定空历史 → 排除 A17 跨审计聚合的环境依赖（可逐字节复现）
    scope: fixtureScope(),
  });
}

/** 归一化序列化（稳定排序：按 id）——与快照生成器共用，保证逐字节可复现 */
function serialize(result: { exitCode: number; rules: RuleCheck[] }): string {
  const normalized = {
    exitCode: result.exitCode,
    rules: result.rules
      .map((r) => ({ id: r.id ?? `#${r.number}:${r.name}`, status: r.status, details: r.details }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  return JSON.stringify(normalized, null, 2) + '\n';
}

describe('D7 · 审计范围语义一等公民化（AuditScope）', () => {
  beforeEach(() => resetScopeGitCallCount());
  afterEach(() => resetScopeGitCallCount());

  describe('① 构造唯一 + 惰性解析（未消费不触 git）', () => {
    it('createAuditScope 仅构造、未消费 → 零 git 调用', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({ diffRange: 'HEAD' });
      expect(scope.diffRange).toBe('HEAD');
      expect(scopeGitCallCount()).toBe(0);
    });

    it('显式注入 commitMsg → 读 commitMsg / commitMsgError 零 git（A5 输入面不触 git）', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({ commitMsg: FIXTURE_COMMIT });
      expect(scope.commitMsg).toBe(FIXTURE_COMMIT);
      expect(scope.commitMsgError).toBeUndefined();
      expect(scopeGitCallCount()).toBe(0);
    });

    it('显式注入 actor → 读 actor 零 git', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({ actor: 'FixtureBot' });
      expect(scope.actor).toBe('FixtureBot');
      expect(scopeGitCallCount()).toBe(0);
    });

    it('注入 headTreeFiles 提供者 → 读基线零 git', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({ headTreeFiles: () => new Set(['a.txt']) });
      expect(scope.headTreeFiles()).toEqual(new Set(['a.txt']));
      expect(scopeGitCallCount()).toBe(0);
    });

    it('记忆化：重复读 headTreeFiles 只解析一次（注入提供者仅被调用 1 次）', () => {
      let calls = 0;
      const scope = createAuditScope({
        headTreeFiles: () => {
          calls += 1;
          return new Set(['a.txt']);
        },
      });
      void scope.headTreeFiles();
      void scope.headTreeFiles();
      void scope.headTreeFiles();
      expect(calls).toBe(1);
    });

    it('未注入 commitMsg → 读 commitMsg 触达 git（计数器非空转：证明「零 git」证据有意义）', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({});
      // 触发解析：即使 git 不可用（非 git cwd），gitOut 也已计数 → 计数必定 ≥ 1
      void scope.commitMsg;
      expect(scopeGitCallCount()).toBeGreaterThanOrEqual(1);
    });

    it('显式注入 actor → actorSource=explicit 且零 git（来源可观测）', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({ actor: 'FixtureBot' });
      expect(scope.actorSource).toBe('explicit');
      expect(scope.actor).toBe('FixtureBot');
      expect(scopeGitCallCount()).toBe(0);
    });

    it('未注入 actor 且 git 不可用（PATH 清空）→ actor=unknown 且 actorSource=unavailable（不再空 catch 吞错）', () => {
      const savedPath = process.env.PATH;
      try {
        process.env.PATH = '/nonexistent-sofagent-audit-test';
        const scope = createAuditScope({});
        expect(scope.actor).toBe('unknown');
        expect(scope.actorSource).toBe('unavailable');
      } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
      }
    });

    it('未注入 actor 且 git 可用 → actorSource ∈ {ident,config,unset}（来源判定不静默）', () => {
      resetScopeGitCallCount();
      const scope = createAuditScope({});
      void scope.actor;
      expect(['ident', 'config', 'unset']).toContain(scope.actorSource);
      expect(scopeGitCallCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('② 规则侧零 git（行为证据）', () => {
    it('scanA5（scope.commitMsg 已注入）→ PASS 且零 git', () => {
      resetScopeGitCallCount();
      const ctx = makeCtx([], { scope: createAuditScope({ commitMsg: FIXTURE_COMMIT }) });
      const r = scanA5(ctx);
      expect(r.status).toBe('PASS');
      expect(scopeGitCallCount()).toBe(0);
    });

    it('scanA5 无 scope 且无 commitMsg → SKIPPED（显式未知，不静默 PASS——防 fail-open 退化）', () => {
      // 旧行为：此路静默返回 PASS（拿不到输入被当成通过）。收口后必须显式 SKIPPED + 原因。
      const ctx = { diffFiles: [], logEntries: [] } as unknown as AuditContext;
      const r = scanA5(ctx);
      expect(r.status).toBe('SKIPPED');
      expect(r.details.join('')).toContain('无法判定');
    });

    it('scanA18（基线已注入）→ WARN 且零 git（b.js 不在基线告警，行为与旧一致）', () => {
      resetScopeGitCallCount();
      const ctx = makeCtx([makeDiffFile('b.js', ['+y'], 'added')], {
        scope: createAuditScope({
          commitMsg: FIXTURE_COMMIT,
          headTreeFiles: () => new Set(['a.txt']),
        }),
      });
      const r = scanA18(ctx);
      expect(r.status).toBe('WARN');
      expect(r.details.join('')).toContain('b.js');
      expect(scopeGitCallCount()).toBe(0);
    });

    it('全量 runRules（scope 注入）整跑 → 零 scope-git 调用（输入面收口生效）', () => {
      resetScopeGitCallCount();
      const result = runFixture();
      expect(result.rules.length).toBeGreaterThan(20);
      expect(scopeGitCallCount()).toBe(0);
    });
  });

  describe('③ 规则实现面零直接 git 调用原语（静态证据）', () => {
    it('rules/rule-*.ts（非测试）不含 execFileSync/execSync/spawnSync/execFile/child_process 引入', () => {
      const ruleFiles = readdirSync(RULES_DIR).filter(
        (f) => f.startsWith('rule-') && f.endsWith('.ts') && !f.endsWith('.test.ts'),
      );
      expect(ruleFiles.length).toBeGreaterThan(20);
      // 只匹配「调用原语」，不匹配检测正则里的字符串字面（如 rule-a9 的
      //   `/require\s*\(\s*['"]child_process['"]/` 与 skill-safety 的 `/child_process\.exec/`
      //   ——二者是**被检测目标**的字符串，不是规则自身的 git 调用）。
      const PRIMITIVE =
        /\bexecFileSync\s*\(|\bexecSync\s*\(|\bspawnSync\s*\(|\bexecFile\s*\(|from\s+['"]child_process['"]|require\s*\(\s*['"]child_process['"]\s*\)/;
      const offenders = ruleFiles.filter((f) => PRIMITIVE.test(readFileSync(join(RULES_DIR, f), 'utf-8')));
      expect(offenders, `以下规则文件仍直接调 git（应收口到 AuditScope）：${offenders.join(', ')}`).toEqual([]);
    });
  });

  describe('④ 重构前后判定逐字节一致（回归锁·含 A24）', () => {
    it('固定夹具全量输出与固化快照逐字节一致（diff=0）', () => {
      const serialized = serialize(runFixture());
      const out = process.env.SOFAGENT_SNAPSHOT_OUT;
      if (out) {
        // 生成/刷新模式：写 { 标注 + result }（result 与常规运行读到的结构同构）
        writeFileSync(
          out,
          JSON.stringify({ generatedFor: SNAPSHOT_GENERATED_FOR, note: SNAPSHOT_NOTE, result: JSON.parse(serialized) }, null, 2) +
            '\n',
          'utf-8',
        );
        return;
      }
      const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as { result: unknown };
      expect(serialize(runFixture())).toBe(JSON.stringify(committed.result, null, 2) + '\n');
    });

    it('快照覆盖 A24（交付物落点 FAIL + 白名单内不误报）与 A18（垃圾豁免语义不变）', () => {
      const result = runFixture();

      // A24：notes.md 在白名单外 → FAIL；outputs/report.md 在白名单内 → 不误报
      const a24 = result.rules.find((r) => r.id === 'A24');
      expect(a24?.status).toBe('FAIL');
      const a24Details = a24?.details.join('') ?? '';
      expect(a24Details).toContain('白名单目录：outputs/');
      expect(a24Details).toContain('notes.md');
      expect(a24Details).not.toContain('outputs/report.md');

      // A18：b.js（不在 HEAD 基线）告警；a.txt（在基线）豁免——重构后语义逐字不变
      const a18 = result.rules.find((r) => r.id === 'A18');
      expect(a18?.status).toBe('WARN');
      const a18Details = a18?.details.join('') ?? '';
      expect(a18Details).toContain('b.js');
      expect(a18Details).not.toContain('a.txt');

      // 聚合判定：A24 FAIL（非拐杖，工程规范）→ exitCode 2
      expect(result.exitCode).toBe(2);
    });
  });
});
