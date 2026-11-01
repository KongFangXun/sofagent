// ============================================================
// env-fingerprint-cache.test.ts · 环境指纹进程内缓存（含 cwd 分键）回归锁
// ============================================================
//
// 背景：getEnvFingerprint 每次现算都要起一个 `git rev-parse` 子进程（~13.6ms），
// appendLlmCallRecord 连调 500 次实测 7.5s 全花在这上面。加进程内缓存后
// 500 次降到 231ms。
//
// 本文件锁四件事：
//   ① 同 cwd 连调两次 → 底层 execSync 只执行 1 次（缓存真的生效）
//   ② clearEnvFingerprintCache() 后再调 → 重新计算（缓存可显式失效）
//   ③ **chdir 到不同 git 环境的目录后调 → 必须返回不同指纹**（最重要：锁住
//      「key 含 cwd」这个安全性前提。若不成立，chdir 后拿到陈旧指纹，签名/验链
//      会静默判 unverifiable——这正是当初拒绝「无 key 全局缓存」的理由）
//   ④ **超过 TTL(60s) → 重新计算**（锁住「同 cwd 下 git init 的陈旧窗口 ≤60s」；
//      该场景 key 不变，只能靠 TTL 自愈，因为 clearEnvFingerprintCache 不在包出口）
//
// 计数方式：vi.mock 包装 node 内置 child_process.execSync（行为透传真实实现）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// vi.mock 被提升到 import 之前：计数器必须用 vi.hoisted 声明
const execCounter = vi.hoisted(() => ({ calls: 0 }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const wrapped = (...args: unknown[]): unknown => {
    execCounter.calls += 1;
    return (actual.execSync as unknown as (...a: unknown[]) => unknown)(...args);
  };
  return {
    ...actual,
    execSync: wrapped as unknown as typeof actual.execSync,
    default: { ...(actual as unknown as Record<string, unknown>), execSync: wrapped },
  };
});

// 被测模块必须在 vi.mock 之后 import（vi.mock 已提升，顺序安全）
import { getEnvFingerprint, clearEnvFingerprintCache } from '../audit-history';

describe('getEnvFingerprint · 进程内缓存（key 含 cwd）', () => {
  let prevCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fp-cache-'));
    clearEnvFingerprintCache();
    execCounter.calls = 0;
  });

  afterEach(() => {
    process.chdir(prevCwd); // 防用例失败时把 cwd 留在临时目录
    clearEnvFingerprintCache();
    execCounter.calls = 0;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('① 同 cwd 连调两次 → execSync 只执行 1 次', () => {
    const first = getEnvFingerprint();
    const second = getEnvFingerprint();

    expect(second).toBe(first); // 值稳定
    expect(execCounter.calls).toBe(1); // 第二次命中缓存，未起子进程

    // 第三次仍命中
    expect(getEnvFingerprint()).toBe(first);
    expect(execCounter.calls).toBe(1);
  });

  it('② clearEnvFingerprintCache() 后再调 → 重新计算（值不变、子进程再起一次）', () => {
    const first = getEnvFingerprint();
    expect(execCounter.calls).toBe(1);

    clearEnvFingerprintCache();
    const second = getEnvFingerprint();

    expect(second).toBe(first); // 环境没变 → 值一致
    expect(execCounter.calls).toBe(2); // 但确实重算了
  });

  it('③ chdir 到不同 git 环境的目录 → 返回不同指纹（key 含 cwd 的安全性前提）', () => {
    // 前提说明（防误读）：两个不同的**非 git** 目录互相 chdir，指纹**相同**——
    // 指纹只由 gitDir 决定（base = hostname-user-gitDir-dataDir），cwd 本身不进 base。
    // cwd 的作用仅是让缓存 key 能区分「不同 git 环境」，从而在 chdir 后重新计算。
    // 本用例构造的是「仓库 → 非 git 临时目录」，差异来自 git 环境。
    const atRepoCwd = getEnvFingerprint();
    const callsAtRepoCwd = execCounter.calls;

    // 切到一个非 git 的临时目录（git rev-parse 结果必然不同）
    process.chdir(tmpDir);
    const atTmpCwd = getEnvFingerprint();

    expect(atTmpCwd).not.toBe(atRepoCwd); // ← 若 key 去掉 cwd，这里会拿到陈旧值而变红
    expect(execCounter.calls).toBe(callsAtRepoCwd + 1); // 换了 cwd → 重新计算而非复用

    // 切回来：原 cwd 的缓存仍在（值不变，且不再起子进程）
    process.chdir(prevCwd);
    expect(getEnvFingerprint()).toBe(atRepoCwd);
    expect(execCounter.calls).toBe(callsAtRepoCwd + 1);
  });

  it('④ 缓存条目超过 TTL(60s) → 重新执行 execSync（同 cwd 下 git init 的陈旧窗口 ≤60s）', () => {
    // 这条锁防的是「同 cwd 下 git init 后指纹永久陈旧」：key 不变时只能靠 TTL 自愈。
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const t0 = Date.now();
      const first = getEnvFingerprint();
      expect(execCounter.calls).toBe(1);

      // TTL 内（30s）：仍命中缓存
      vi.setSystemTime(new Date(t0 + 30_000));
      expect(getEnvFingerprint()).toBe(first);
      expect(execCounter.calls).toBe(1);

      // 跨过 TTL（61s）：必须重算（值不变——环境没变，只是重新采了一次）
      vi.setSystemTime(new Date(t0 + 61_000));
      expect(getEnvFingerprint()).toBe(first);
      expect(execCounter.calls).toBe(2); // ← 把 ENV_FP_TTL_MS 改成 Infinity 会让这里变 1（红）
    } finally {
      vi.useRealTimers();
    }
  });
});
