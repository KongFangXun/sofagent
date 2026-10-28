// ============================================================
// isomorphic-git-restore-guard.test.ts · SEC-14 恢复关口防线回归测试
// ============================================================
//
// 背景（为什么必须有这个文件）：
//   F52 的读侧验签（loadSnapshots）覆盖「带签名条目被篡改」，但恢复链仍有
//   缺口：① revertToSnapshot 无独立验签——依赖单点防线；② staging 循环
//   join(dir, relativePath) 后无 traversal 校验——v1 形态重写（删 version +
//   条目改 files 直存 + 塞 `../../evil` 越界路径）可完全绕过签名把恶意内容
//   写出工作区外。
//
// SEC-14 修复后的防线（恢复关口 verifyRestoreIntegrity + 路径边界校验）：
//   1. HMAC 签名复算——非 legacy 条目在「完整 SHA 定位之后、staging 写入
//      之前」用与写入侧同一实现（computeSnapshotHmac）对磁盘原文复算，
//      失配抛「快照指纹校验失败——可能被篡改，拒绝恢复」；
//   2. 条目 sha 内容复算——v2 fileIndex 形态从 blob 内容按写入侧同款
//      （无前缀哈希）重算；v2 store 内的 files 直存形态（v1 伪装攻击）
//      按内容重算——篡改 path / 内容 / sha 任一域在此暴露；
//   3. 路径边界——staging 循环内 relative(dir, finalPath) 不得越界
//      （.. 开头 / 绝对路径），越界立即中止，工作目录零触碰。
//
// 覆盖（写入→恢复 round-trip 不回归 + 三族攻击面全部拦截）：
// - ① 篡改快照 JSON 内容后 restore 应 throw（含「指纹校验失败」断言）
// - ② relativePath=../../evil.txt 的快照条目应 throw 且越界路径不存在
// - ③ 正常 round-trip 不回归（多快照 + 无变化跳过幂等）
// - ④ legacy 快照 warn + 原样恢复不变（既有契约）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { commitSnapshot, listSnapshots, revertToSnapshot } from './isomorphic-git';

let tmpRoot: string;
let keyDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-sec14-guard-'));
  // 密钥隔离（与 mcp snapshot-restore-hmac.test.ts 同款姿态）——不隔离则
  // 签名行为随宿主环境（~/.sofagent-key 在场与否）漂移，用例结论不可复现。
  // 密钥文件放**独立 tmp 目录**（不在 tmpRoot 内）——scanFiles 会把工作区
  // 顶层文件收进快照，密钥混进去会污染 round-trip 断言。
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-sec14-key-'));
  const keyPath = path.join(keyDir, 'hmac-key');
  fs.writeFileSync(keyPath, 'sec14-test-hmac-key-0123456789abcdef');
  process.env.SOFAGENT_KEY_PATH = keyPath;
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** snapshots.json 的 shadow 存储路径（.sofagent/.git-shadow/） */
const snapshotsJsonOf = (dir: string): string =>
  path.join(dir, '.sofagent', '.git-shadow', 'snapshots.json');

describe('SEC-14 · 恢复关口完整性验证 + 路径边界（revertToSnapshot）', () => {
  it('test_revertToSnapshot_篡改快照条目内容_指纹校验失败拒绝恢复', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击：篡改磁盘原文条目（改 label 域）——剥掉 hmacSig 的 v2 条目在
    // loadSnapshots 是 legacy 放行语义，但恢复关口对「带签名条目」复算。
    // 此处保留 hmacSig、只改 label——签名输入域变了，恢复关口 HMAC 复算必失配。
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    store.snapshots[0].label = 'evil-tampered';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpRoot, sha);
    } catch (err) {
      threw = err as Error;
    }
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain('快照指纹校验失败');
    expect(threw!.message).toContain('拒绝恢复');
    // 工作区未被污染（恢复中止发生在任何写入之前）
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_revertToSnapshot_篡改blob内容_指纹校验失败拒绝恢复', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击变体：偷换 blob 池内容（内容变、索引不动）——条目 HMAC 本身
    // 不失效（签名域是索引），恢复关口的 blob 池比对在此暴露。
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const firstBlobKey = Object.keys(store.blobs)[0]!;
    store.blobs[firstBlobKey] = '恶意注入 PAYLOAD';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpRoot, sha);
    } catch (err) {
      threw = err as Error;
    }
    expect(threw).not.toBeNull();
    // blob 偷换走 blob 族报错（条目签名不失效——索引域没动，内容域失配）
    expect(threw!.message).toContain('快照完整性校验失败');
    expect(threw!.message).toContain('blob 池被偷换');
    // 工作区未被污染
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_revertToSnapshot_v2重写为v1形态塞越界路径_抛错且越界路径不存在', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击：整份 store 重写为 v1 形态——删 version/blobs/fileIndex/hmacSig，
    // 条目改 files 直存 + 塞越界 relativePath。loadSnapshots 对 v1 形态
    // 无签名可验（全放行 + hmacLegacy 标记）——恢复关口的 sha 内容复算
    // （v2 store 内的 files 形态条目）+ 路径边界校验是仅存的防线。
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const entry = store.snapshots[0];
    const rewritten = {
      snapshots: [
        {
          sha: entry.sha,
          timestamp: entry.timestamp,
          files: { '../../evil.txt': '恶意内容 PAYLOAD' },
        },
      ],
    };
    fs.writeFileSync(storePath, JSON.stringify(rewritten, null, 2));

    // 越界目标（工作区外）——断言其不被写出
    const escapePath = path.resolve(tmpRoot, '..', '..', 'evil.txt');

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpRoot, sha);
    } catch (err) {
      threw = err as Error;
    }
    // 必须抛错（sha 复算失配或路径越界——两道防线至少一道拦截）
    expect(threw).not.toBeNull();
    expect(
      threw!.message.includes('快照指纹校验失败') || threw!.message.includes('路径越界'),
    ).toBe(true);
    // 🔴 越界路径不存在（攻击未得手）
    expect(fs.existsSync(escapePath)).toBe(false);
    // 工作区未被污染
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_revertToSnapshot_条目带越界路径但签名域合法_路径越界拦截', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击变体（有密钥的攻击者）：重签一个带越界路径的条目——HMAC 与
    // sha 复算都过（攻击者掌握密钥 + 重算 sha），仅剩路径边界校验这道
    // 结构性防线。构造：fileIndex 指向既有 blob（内容合法），path 塞 ../..
    // 并同步重算 sha 使内容域自洽（模拟密钥泄露场景）。
    const { createHash, createHmac } = require('crypto') as typeof import('crypto');
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const entry = store.snapshots[0];
    const blobHash = Object.values(entry.fileIndex)[0]!;
    const evilPath = '../../evil-signed.txt';
    // 与写入侧同款哈希域（commitSnapshot：path:computeHash(content)，无前缀）
    const computeHash = (content: string): string =>
      createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
    const evilSha = computeHash(`${evilPath}:${computeHash(store.blobs[blobHash])}`);
    const keyText = fs.readFileSync(process.env.SOFAGENT_KEY_PATH!, 'utf-8').trim();
    const stableStringify = (value: unknown): string => {
      const sortKeys = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(sortKeys);
        if (input && typeof input === 'object' && input.constructor === Object) {
          const sorted: Record<string, unknown> = {};
          for (const k of Object.keys(input as Record<string, unknown>).sort()) {
            sorted[k] = sortKeys((input as Record<string, unknown>)[k]);
          }
          return sorted;
        }
        return input;
      };
      return JSON.stringify(sortKeys(value));
    };
    const recordForSig = { sha: evilSha, timestamp: entry.timestamp, fileIndex: { [evilPath]: blobHash } };
    const hmacSig = createHmac('sha256', keyText)
      .update(stableStringify(recordForSig))
      .digest('hex')
      .slice(0, 32);
    store.snapshots[0] = {
      sha: evilSha,
      timestamp: entry.timestamp,
      fileIndex: { [evilPath]: blobHash },
      hmacSig,
    };
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    const escapePath = path.resolve(tmpRoot, '..', '..', 'evil-signed.txt');

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpRoot, evilSha);
    } catch (err) {
      threw = err as Error;
    }
    // 必须抛「路径越界」——内容域自洽（HMAC/复算都过），只留边界校验拦截
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain('路径越界');
    expect(fs.existsSync(escapePath)).toBe(false);
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_revertToSnapshot_v2剥签名伪标legacy_完整SHA定位后拒绝恢复（v3 攻击形态）', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 🔴 v3 攻击形态（team-lead 黑盒攻防打回）：v2 store 内保留 fileIndex/
    // version 不动，仅删 hmacSig + 伪标 hmacLegacy:true——旧实现走 legacy
    // warn 分支原样恢复，完全绕过。伪标字段不具证明力（磁盘明文可任写）。
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    delete store.snapshots[0].hmacSig;
    (store.snapshots[0] as Record<string, unknown>).hmacLegacy = true;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpRoot, sha);
    } catch (err) {
      threw = err as Error;
    }
    // 必须抛「签名被剥离」——v2 写入侧（密钥可用时）恒带签名，无签名 = 剥签
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain('疑似签名被剥离');
    expect(threw!.message).toContain('拒绝');
    // 🔴 工作区零改动（拒绝发生在任何 staging 写入之前）
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_revertToSnapshot_v2无签名但密钥不在场_降级窗口legacy放行不误杀', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '降级窗口内容');
    const sha = commitSnapshot(tmpRoot);

    // 合法降级窗口模拟：写入时密钥在场（带签名），随后密钥文件消失——
    // saveSnapshots 的既有降级契约（密钥不可得 → 条目不带签名 → 读取按
    // legacy 放行）。构造：剥掉签名 + 删密钥文件，复现「降级窗口写入的
    // v2 store + 密钥至今未恢复」形态——须放行（否则降级模式快照功能瘫痪）。
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    for (const s of store.snapshots) delete s.hmacSig;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    fs.rmSync(process.env.SOFAGENT_KEY_PATH!);

    const warnSpy: MockInstance = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(tmpRoot, 'app.md'), '改过了');
      const restored = revertToSnapshot(tmpRoot, sha);
      expect(restored).toContain('app.md');
      expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('降级窗口内容');
      const warned = warnSpy.mock.calls.some((c) => String(c[0]).includes('legacy'));
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('test_revertToSnapshot_正常round-trip多快照幂等_不回归', () => {
    // v1 内容 + 嵌套子目录
    fs.mkdirSync(path.join(tmpRoot, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), 'v1 内容');
    fs.writeFileSync(path.join(tmpRoot, 'sub', 'b.txt'), 'nested-1');
    const sha1 = commitSnapshot(tmpRoot);

    // v2 内容（新快照）
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), 'v2 内容');
    const sha2 = commitSnapshot(tmpRoot);
    expect(sha1).not.toBe(sha2);
    expect(listSnapshots(tmpRoot)).toHaveLength(2);

    // 无变化跳过（幂等——同内容再 commit 不追加条目）
    const sha2again = commitSnapshot(tmpRoot);
    expect(sha2again).toBe(sha2);
    expect(listSnapshots(tmpRoot)).toHaveLength(2);

    // 恢复到 sha1（跨一代）
    const restored = revertToSnapshot(tmpRoot, sha1);
    expect(restored.sort()).toEqual(['app.md', path.join('sub', 'b.txt')].sort());
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('v1 内容');
    expect(fs.readFileSync(path.join(tmpRoot, 'sub', 'b.txt'), 'utf-8')).toBe('nested-1');

    // 恢复后再恢复到 sha2（往返不回归）
    revertToSnapshot(tmpRoot, sha2);
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('v2 内容');

    // staging 无残留（正常路径清理）
    expect(fs.existsSync(path.join(tmpRoot, '.sofagent', '.revert-staging'))).toBe(false);
  });

  it('test_revertToSnapshot_legacy快照无签名_warn并原样恢复不变', () => {
    fs.writeFileSync(path.join(tmpRoot, 'legacy.md'), 'legacy 内容');
    const sha = commitSnapshot(tmpRoot);

    // 真 legacy 形态：整份 store 重写为 v1（无 version 字段、files 直存、
    // 无签名）——F52 之前写入的历史存量。注：「v2 store + 剥签名」构造在
    // SEC-14 补丁后按签名剥离攻击拒绝（见 v3 用例）——合法 legacy 只能是
    // 真 v1 store（或密钥不在场降级窗口的 v2，见上一用例）。
    const storePath = snapshotsJsonOf(tmpRoot);
    const v1Store = {
      snapshots: [
        { sha, timestamp: new Date().toISOString(), files: { 'legacy.md': 'legacy 内容' } },
      ],
    };
    fs.writeFileSync(storePath, JSON.stringify(v1Store, null, 2));

    // 条目被标记 legacy（读侧既有行为——v1 分支恒标）
    expect(listSnapshots(tmpRoot)[0]!.hmacLegacy).toBe(true);

    // warn + 原样恢复（既有契约——legacy 无签名可验，不拦截）
    const warnSpy: MockInstance = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(tmpRoot, 'legacy.md'), '改过了');
      const restored = revertToSnapshot(tmpRoot, sha);
      expect(restored).toContain('legacy.md');
      expect(fs.readFileSync(path.join(tmpRoot, 'legacy.md'), 'utf-8')).toBe('legacy 内容');
      const warned = warnSpy.mock.calls.some((c) => String(c[0]).includes('legacy'));
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
