// ============================================================
// watch-config.test.ts · watch.yml 写读键名归一（v1.5.4 复查批 #30 行为锁）
// ============================================================
// 缺陷背景：模板写侧 snake_case（`debounce_ms`）vs 读侧 camelCase（`debounceMs`）
//   ⇒ 用户照模板调防抖静默失效（落默认 5000）且无提示。本测试锁死「两种键名都生效」。
// 判据：模板原样 yml 能真实生效；snake / camel 两种写法都生效；非法值回落默认。
// 环境纪律：全部用例走**临时 cwd 的项目级配置**（`<tmp>/.sofagent/watch.yml`）——
//   项目级命中即返回，永不落到 homedir 全局配置分支 ⇒ 无宿主环境耦合（不读真实 ~/.sofagent）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadWatchConfig, generateWatchTemplate, DEFAULT_WATCH_CONFIG } from '../config/watch-config';

describe('watch-config · debounce 键名归一（模板 snake_case ↔ 内部 camelCase）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sof-watchcfg-'));
    mkdirSync(join(dir, '.sofagent'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 写项目级 watch.yml（loadWatchConfig 的第一优先级路径） */
  const writeYml = (body: string) => {
    writeFileSync(join(dir, '.sofagent', 'watch.yml'), body, 'utf-8');
    return dir;
  };

  it('snake_case（模板口径）生效：debounce_ms: 3000 ⇒ debounceMs === 3000', () => {
    const cwd = writeYml('watch:\n  debounce_ms: 3000\n');
    expect(loadWatchConfig(cwd).debounceMs).toBe(3000);
  });

  it('camelCase（内部口径）同样生效：debounceMs: 2500 ⇒ 2500', () => {
    const cwd = writeYml('watch:\n  debounceMs: 2500\n');
    expect(loadWatchConfig(cwd).debounceMs).toBe(2500);
  });

  it('generateWatchTemplate 产出的 yml 原样可用 ⇒ 落模板声明值（键名错配即红）', () => {
    const tmpl = generateWatchTemplate();
    const cwd = writeYml(tmpl);
    const declared = Number((tmpl.match(/debounce_ms:\s*(\d+)/) ?? [])[1]);
    expect(Number.isFinite(declared)).toBe(true);
    expect(loadWatchConfig(cwd).debounceMs).toBe(declared);
  });

  it('两键同写时 camelCase 优先（显式内部口径胜出）', () => {
    const cwd = writeYml('watch:\n  debounceMs: 2000\n  debounce_ms: 8000\n');
    expect(loadWatchConfig(cwd).debounceMs).toBe(2000);
  });

  it('非法值回落默认（不把字符串当数字用）', () => {
    const cwd = writeYml('watch:\n  debounce_ms: "abc"\n');
    expect(loadWatchConfig(cwd).debounceMs).toBe(DEFAULT_WATCH_CONFIG.debounceMs);
  });
});
