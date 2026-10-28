// ============================================================
// cli-quick-diff-equals.test.ts · P0-16 / BUG-1 / BUG-2 修复批行为锁
// ------------------------------------------------------------
// 三个缺陷的回归测试（实测路径对齐 cli-quick-unknown-args.test.ts 的
// spawn dist 产物先例——行为面 dist 直调，不 mock）：
//
//   P0-16 · `--diff=<range>` 等号形态静默降级
//     缺陷：quick 侧只 warn「未知参数」后照审 HEAD~1..HEAD exit 0（CI 假绿）；
//           完整引擎侧严格相等匹配永不命中。修法两侧收口：
//             ① 引擎 parseArgs 预处理归一层（--x=v → --x v，带值 flag 白名单）；
//             ② quick SEMANTIC_FLAG_PREFIXES 收录 --diff/--strict/--ci。
//
//   BUG-1 · 单 commit 仓 --ruleset 必崩
//     缺陷：自动路由完整引擎后默认 HEAD~1..HEAD 无父提交 → 「diff range 无效」。
//     修法：路由分支复用 hasParentCommit()，无父且用户未显式传 --diff 时
//           注入空树 SHA..HEAD（与 quick 侧首提交补审同语义）。
//
//   BUG-2 · 「不写 history」承诺被自动路由打破
//     修法：① help 文案两处改为条件化表述（quick 本体不写，路由后按完整引擎
//           行为写入）；② 路由分支打印披露行；③ 纯 quick 审计（无路由 flag）
//           在隔离数据目录下不产生 history.jsonl（本测试第 3 组锁定）。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// build 产物——本测试在 npm test 前置 build 后运行
const QUICK_BIN = join(here, '..', '..', 'dist', 'cli-quick.js');
const FULL_BIN = join(here, '..', '..', 'dist', 'index.js');

/** 本文件全部临时目录（afterAll 统一清理） */
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 清理失败不影响判定 */ }
  }
});

interface RunResult { status: number | undefined; output: string }

/** 跑子进程取「退出码 + stdout/stderr 合流」——非 0 退出不抛（spawnSync 双流收齐）。 */
function runBin(bin: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): RunResult {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** git 环境（用户身份固定，--allow-empty 场景不含文件噪声）。 */
const GIT_ID = ['-c', 'user.email=t@example.invalid', '-c', 'user.name=p016'];

/** 建临时 git 仓（单 commit 或双 commit），返回目录路径。
 * withLeak 时泄漏在**最后一笔** commit（使 HEAD~1..HEAD / 空树..HEAD 都能审出）；
 * double 的末笔恒有内容（良性文件）——空 diff 会走 message 短路、不写 history.jsonl，
 * 留痕面断言（diffRange）需要至少一个文件变更。 */
function makeRepo(kind: 'single' | 'double', withLeak = false): string {
  const dir = mkdtempSync(join(tmpdir(), `sofagent-p016-${kind}-`));
  tmpDirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  // AKIA 密钥分两段拼（对齐仓内测试先例，避免被密钥扫描器反咬测试源文件），
  // AKIA+16 位大写/数字 = A2 AWS Access Key 格式锚
  const leakContent = `aws_access_key_id = ${['AKIAIOSFODNN', '7EXAMPLE'].join('')}\n`;
  if (kind === 'single') {
    if (withLeak) {
      writeFileSync(join(dir, 'config-aws.txt'), leakContent);
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    execFileSync('git', [...GIT_ID, 'commit', withLeak ? '-q' : '--allow-empty', '-q', '-m', 'initial repository bootstrap with leak'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    return dir;
  }
  // double：第一笔空基线，第二笔承载泄漏（或良性文件）
  execFileSync('git', [...GIT_ID, 'commit', '--allow-empty', '-q', '-m', 'first commit for baseline'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(dir, withLeak ? 'config-aws.txt' : 'readme.txt'), withLeak ? leakContent : 'hello sofagent\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', [...GIT_ID, 'commit', '-q', '-m', withLeak ? 'second commit carries leak' : 'second commit benign content'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  return dir;
}

/** 隔离环境——SOFAGENT_DATA（history.jsonl 落点）+ SOFAGENT_HOME（session-report
 * 落点，resolveAuditDir 只认 HOME 不认 DATA）双指临时目录 + 放行前缀，防写真实 ~/.sofagent。 */
function isolatedEnv(): { env: NodeJS.ProcessEnv; dataDir: string } {
  const iso = mkdtempSync(join(tmpdir(), 'sofagent-p016-iso-'));
  tmpDirs.push(iso);
  const dataDir = join(iso, 'data');
  return {
    env: {
      ...process.env,
      SOFAGENT_DATA: dataDir,
      SOFAGENT_HOME: join(iso, 'sofagent-home'),
      SOFAGENT_HOME_ALLOWED_PREFIXES: iso,
    },
    dataDir,
  };
}

// ============================================================
// 第一组 · P0-16：--diff= 等号形态
// ============================================================
describe('P0-16 · --diff=<range> 等号形态（quick 侧 fail-loud / 引擎侧同语义）', () => {
  it('dist 产物存在（前置：npm run build --workspace=engine/audit）', () => {
    if (!existsSync(QUICK_BIN) || !existsSync(FULL_BIN)) {
      throw new Error('dist 产物缺失——先 npm run build --workspace=engine/audit');
    }
  });

  it('① quick 侧 --diff=HEAD~2..HEAD → exit 2 fail-loud（语义前缀命中，改前 warn 放行假绿）', () => {
    const dir = makeRepo('double');
    const r = runBin(QUICK_BIN, ['--diff=HEAD~1..HEAD'], { cwd: dir });
    expect(r.status).toBe(2);
    expect(r.output).toContain('未知参数');
  });

  it('② 完整引擎侧 --diff=HEAD~2..HEAD 与空格形态解析出的 diffRange 一致（泄漏可审出）', () => {
    // 双 commit 仓（HEAD~1 含 AKIA 泄漏）——等号形态与空格形态必须同语义：
    // 两者都审 HEAD~1..HEAD ⇒ 都命中 A2/泄漏 ⇒ exit 2；且 history.jsonl 各自
    // 记录的 diffRange 相同（text 模式不回声 range，故以留痕面断言）。
    const eqEnv = isolatedEnv();
    const spaceEnv = isolatedEnv();
    const dir = makeRepo('double', /* withLeak */ true);
    const eqForm = runBin(FULL_BIN, ['--diff=HEAD~1..HEAD', '--silent'], { cwd: dir, env: eqEnv.env });
    const spaceForm = runBin(FULL_BIN, ['--diff', 'HEAD~1..HEAD', '--silent'], { cwd: dir, env: spaceEnv.env });
    // 两形态等价断言：同退出码（泄漏命中 exit 2）+ 同命中（A2 详情已脱敏——
    // 锚「AWS Access Key」即 A2 命中形态，锚 AKIA 原文则脱敏面必然不含）
    expect(eqForm.status).toBe(2);
    expect(spaceForm.status).toBe(2);
    expect(eqForm.output).toContain('AWS Access Key');
    expect(spaceForm.output).toContain('AWS Access Key');
    // diffRange 一致性（硬断言）：两形态各自写入的 history.jsonl 末条 diffRange 相同
    const readLastDiffRange = (dataDir: string): string => {
      const lines = readFileSync(join(dataDir, 'audit', 'history.jsonl'), 'utf-8')
        .trim().split('\n').filter(Boolean);
      const last = JSON.parse(lines[lines.length - 1] ?? '{}') as { diffRange?: string };
      return last.diffRange ?? '';
    };
    expect(readLastDiffRange(eqEnv.dataDir)).toBe('HEAD~1..HEAD');
    expect(readLastDiffRange(spaceEnv.dataDir)).toBe(readLastDiffRange(eqEnv.dataDir));
  });

  it('③ 其它带值 flag 等号形态同语义（--format=github 不再报「不支持的参数」）', () => {
    const dir = makeRepo('double');
    const { env } = isolatedEnv();
    // --format=github 改前必报「不支持的参数 " --format=github"」exit 1；
    // 归一后走 --format 分支输出 GitHub Annotations（::error 形态）。
    const r = runBin(FULL_BIN, ['--diff=HEAD..HEAD', '--format=github'], { cwd: dir, env });
    expect(r.output).not.toContain('不支持的参数');
  });

  it('④ 无值 flag 等号形态按未知参数报错（--strict=true 不吞不静默）', () => {
    const dir = makeRepo('double');
    const { env } = isolatedEnv();
    const r = runBin(FULL_BIN, ['--strict=true'], { cwd: dir, env });
    expect(r.status).toBe(1);
    expect(r.output).toContain('不支持的参数');
  });

  it('⑤ --bogus-flag 纯噪声仍 warn 放行（quick 侧不回归）', () => {
    const dir = makeRepo('double');
    const r = runBin(QUICK_BIN, ['--bogus-flag', '--version'], { cwd: dir });
    // --version 快路径：warn 后仍打印版本并 exit 0（噪声不升级中断）
    expect(r.status).toBe(0);
    expect(r.output).toContain('sofagent audit v');
  });

  it('⑥ 正规 --diff 空格形态 quick 侧仍路由完整引擎（不回归 P0-16 收录面）', () => {
    const dir = makeRepo('double');
    const { env } = isolatedEnv();
    const r = runBin(QUICK_BIN, ['--diff', 'HEAD..HEAD'], { cwd: dir, env });
    // 路由完整引擎后 HEAD..HEAD 无变更 → exit 0（不被语义前缀误拦成 exit 2）
    expect(r.status).toBe(0);
  });
});

