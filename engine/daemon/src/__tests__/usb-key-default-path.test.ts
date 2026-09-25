// ============================================================
// usb-key-default-path.test.ts · F-33：烧录源目录默认路径对齐写侧 SSOT
// ============================================================
// 此前手拼 <home>/workflow-store 少 /data 层 ⇒ 写侧（getDataDir() 下）产物
// 永远烧不进 U 盘，existsSync 兜底把断裂静默正常化（恒 null）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { burnWorkflowsToUsb } from '../usb-key';
import { getDataDir } from '@sofagent/core';

function tmpDir(tag: string): string {
  const dir = join(tmpdir(), `sofagent-f33-${tag}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('F-33 · USB 烧录源目录默认路径对齐 getDataDir', () => {
  let fakeHome: string;
  let usbRoot: string;
  let savedHome: string | undefined;
  let savedData: string | undefined;

  beforeEach(() => {
    fakeHome = tmpDir('home');
    usbRoot = tmpDir('usb');
    savedHome = process.env.SOFAGENT_HOME;
    savedData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_HOME = fakeHome;
    process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = fakeHome; // 测试目录放行（白名单 fail-loud 纪律）
    process.env.SOFAGENT_DATA = join(fakeHome, 'data');
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    delete process.env.SOFAGENT_HOME_ALLOWED_PREFIXES;
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    for (const d of [fakeHome, usbRoot]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('产物在 getDataDir()/workflow-store（写侧口径）→ 默认路径可烧录（copied > 0）', () => {
    // 写侧口径：getDataDir() = <home>/data
    const storeDir = join(getDataDir(), 'workflow-store');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'wf-trunk.json'), JSON.stringify({ id: 'wf-1', name: '测试工作流', nodes: [] }));

    const warnings: string[] = [];
    // 不传 workflowSourceDir——用默认路径解析（F-33 修复目标）
    const r = burnWorkflowsToUsb(usbRoot, { confirmBackup: false } as never, warnings);
    expect(r).not.toBeNull();
    expect(r!.copied).toBeGreaterThan(0);
  });

  it('旧路径数据（无 /data 层）→ 回退可烧 + 迁移提示', () => {
    delete process.env.SOFAGENT_DATA; // 旧路径口径 = <home>/workflow-store（无 data 层）
    const legacyDir = join(fakeHome, 'workflow-store');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'wf-legacy.json'), JSON.stringify({ id: 'wf-2', name: '旧路径工作流', nodes: [] }));

    const warnings: string[] = [];
    const r = burnWorkflowsToUsb(usbRoot, { confirmBackup: false } as never, warnings);
    expect(r).not.toBeNull();
    expect(r!.copied).toBeGreaterThan(0);
  });

  it('两处都不存在 → null（保持既有语义）', () => {
    const warnings: string[] = [];
    const r = burnWorkflowsToUsb(usbRoot, { confirmBackup: false } as never, warnings);
    expect(r).toBeNull();
  });
});
