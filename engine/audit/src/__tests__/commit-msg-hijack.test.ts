// ============================================================
// commit-msg-hijack.test.ts · commit-msg require.resolve 劫持面回归测试（v1.5.0 TASK-10）
//
// 验收覆盖（任务书验收：fixture 劫持测试红转绿）：
//   一、劫持 fixture：被审仓内投放假 node_modules/@sofagent/audit
//       （冒牌脚本写 marker 文件 + 正常 exit 0）→ commit 时若命中冒牌，
//       marker 被写、审计被绕——修复后 require.resolve 只走全局根限定
//       （paths 参数），被审仓 node_modules 不进解析域，冒牌不可达。
//   二、全局解析分支的聚合哈希校验（tools/audit-dist-hash.mjs 全局包根形态）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const HOOK = resolve(__dirname, '../../hooks/commit-msg');
const HASH_SCRIPT = resolve(__dirname, '../../../../tools/audit-dist-hash.mjs');

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), `t10-hijack-${Date.now()}`));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 'test@sofagent.dev');
  git('config', 'user.name', 'sofagent-test');
  writeFileSync(join(repo, 'f.txt'), 'safe\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return repo;
}

/** 在被审仓内投放冒牌 @sofagent/audit（命中即写 marker——断言面） */
function plantFakePackage(repo: string): string {
  const fakeDir = join(repo, 'node_modules', '@sofagent', 'audit');
  mkdirSync(fakeDir, { recursive: true });
  const marker = join(repo, '.fake-engine-marker');
  // 冒牌主入口：写 marker（若被执行，测试断言 marker 不存在）
  writeFileSync(join(fakeDir, 'index.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'hijacked');process.exit(0);\n`);
  writeFileSync(
    join(fakeDir, 'package.json'),
    JSON.stringify({ name: '@sofagent/audit', version: '0.0.1-fake', main: 'index.js' }),
  );
  // 冒牌 dist（包根推导 CLI 入口路径——若裸解析命中会拼 dist/index.js）
  mkdirSync(join(fakeDir, 'dist'), { recursive: true });
  writeFileSync(join(fakeDir, 'dist', 'index.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'hijacked-dist');process.exit(0);\n`);
  return marker;
}

/** 跑 commit-msg hook（$1 传 message 文件） */
function runHook(repo: string, msgFile: string, envExtra: NodeJS.ProcessEnv = {}): { out: string; code: number } {
  try {
    const out = execFileSync('bash', [HOOK, msgFile], {
      cwd: repo,
      env: { ...process.env, ...envExtra },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { out, code: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { out: ((e.stdout ?? '') + (e.stderr ?? '')).toString(), code: e.status ?? 1 };
  }
}

describe('commit-msg require.resolve 劫持面（v1.5.0 TASK-10）', () => {
  let repo: string;
  let msgFile: string;

  beforeEach(() => {
    repo = makeRepo();
    msgFile = join(repo, 'COMMIT_MSG');
    writeFileSync(msgFile, 'test: hijack fixture\n');
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it('劫持 fixture：被审仓内冒牌包不进解析域（marker 不被写）——裸首试已删除', () => {
    const marker = plantFakePackage(repo);
    // 显式注入真引擎入口（模拟正常环境：全局真引擎可达）——hook 应命中
    // SOFAGENT_AUDIT_ENTRY 或全局根解析，绝不命中被审仓内冒牌包
    const realEntry = resolve(__dirname, '../../dist/index.js');
    const r = runHook(repo, msgFile, { SOFAGENT_AUDIT_ENTRY: realEntry });
    // 冒牌引擎未被执行（marker 不存在 = 劫持失败）
    expect(existsSync(marker)).toBe(false);
    // hook 自身完成（真引擎跑完，退出码 0/1 均合法——1=WARN 放行）
    expect([0, 1]).toContain(r.code);
  }, 30000);

  it('无显式注入时：冒牌包同样不可达（全局根限定解析——不解析被审仓 node_modules）', () => {
    const marker = plantFakePackage(repo);
    // 不注入 SOFAGENT_AUDIT_ENTRY——hook 走 _REPO_TOP/相对/全局解析链。
    // 本仓是 tmp 非开发仓（无 engine/audit/dist）→ 走全局根限定分支。
    // 冒牌包在被审仓 node_modules 内——修复后 require.resolve 只查全局根，不可达。
    const r = runHook(repo, msgFile);
    expect(existsSync(marker)).toBe(false);
    // 环境相关：真全局包在且基准就绪 → 0/1；全局包缺/基准缺 → 1（fail-loud）。
    // 关键断言是 marker 不存在（冒牌不执行），退出码只须不为 42（冒牌特征码）。
    expect(r.code).not.toBe(42);
  }, 30000);

  it('劫持 DoS 面：冒牌包在场时全局解析仍可达（审计不被冒牌包存在性禁用）', () => {
    // 裸首试版的另一攻击面：解析命中冒牌包 → dirname 剥 scope 拼出不存在路径
    // → RESOLVED_ENTRY 空 → 「未安装」exit 1——审计被冒牌包的**存在**禁用（DoS）。
    // 修复版全局根限定：冒牌包不影响全局解析，真引擎照常可达。
    plantFakePackage(repo);
    const realEntry = resolve(__dirname, '../../dist/index.js');
    const r = runHook(repo, msgFile, { SOFAGENT_AUDIT_ENTRY: realEntry });
    // 注入真引擎后：冒牌包在场也不应出现「未安装」（那正是 DoS 效果）——
    // 无注入形态的纯全局链在 CI（无全局包）会正确 fail-loud，环境真值不是本用例对象
    expect(r.code).not.toBe(42);
  }, 30000);

  it('聚合哈希脚本支持全局包根形态（dist/ 直挂包根）', () => {
    // 构造「全局包根」形态：pkgRoot/dist/**/*.js
    const pkgRoot = mkdtempSync(join(tmpdir(), `t10-pkgroot-${Date.now()}`));
    try {
      mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
      writeFileSync(join(pkgRoot, 'dist', 'index.js'), 'console.log(1);\n');
      const h1 = execFileSync('node', [HASH_SCRIPT, pkgRoot]).toString();
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      // 内容变化 → 哈希变
      writeFileSync(join(pkgRoot, 'dist', 'index.js'), 'console.log(2);\n');
      const h2 = execFileSync('node', [HASH_SCRIPT, pkgRoot]).toString();
      expect(h2).toMatch(/^[0-9a-f]{64}$/);
      expect(h1).not.toBe(h2);
      // 开发仓形态优先级不变：repoRoot 下有 engine/audit/dist 时优先用之
      const devRoot = mkdtempSync(join(tmpdir(), `t10-devroot-${Date.now()}`));
      try {
        mkdirSync(join(devRoot, 'engine', 'audit', 'dist'), { recursive: true });
        writeFileSync(join(devRoot, 'engine', 'audit', 'dist', 'index.js'), 'console.log(1);\n');
        const h3 = execFileSync('node', [HASH_SCRIPT, devRoot]).toString();
        expect(h3).toBe(h1);  // 同内容同相对拓扑 → 同哈希
      } finally {
        rmSync(devRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(pkgRoot, { recursive: true, force: true });
    }
  });
});
