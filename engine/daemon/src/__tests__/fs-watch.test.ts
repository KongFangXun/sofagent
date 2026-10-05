// ============================================================
// fs-watch.test.ts · v1.5.7 F26：文件监听最小测试（临时目录 + 短窗口）
// ============================================================
// 覆盖（不做长跑监听）：
//   1. 触发路径：监控目录内文件变更 → 防抖后回调收到相对路径
//   2. 忽略规则：ignore 命中的变更不进回调
//   3. watchedCount：目录在位 = 1；paths 全不存在 = 0（空转判定面）
//
// 手法：临时目录 + 项目级 watch.yml 写小 debounceMs（300ms）压短窗口；
//   回调 Promise 化 + 超时兜底，跑完 stop() 清理 watcher。
//   竞态规避：mkdir 完成后等待 150ms 再 startWatching——macOS fs.watch 会
//   把 watcher 建立前瞬间的目录创建残留事件重放（实测 BATCH=["src/src"]），
//   settle 后再建 watcher 可让用例只断言「受控写入」产生的事件。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startWatching } from '../fs-watch';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  }
});

function mkProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fswatch-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  // 项目级 watch.yml：监控 src/，忽略 *.log，防抖 300ms（压短测试窗口）
  fs.mkdirSync(path.join(dir, '.sofagent'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.sofagent', 'watch.yml'),
    [
      'watch:',
      '  paths: ["src/"]',
      '  ignore: ["*.log"]',
      '  debounceMs: 300',
      '  mode: changed_only',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('fs-watch 最小行为（F26：触发路径 + 忽略规则 + 空转判定）', () => {
  it('watchedCount：src/ 在位 = 1', () => {
    const dir = mkProject();
    const w = startWatching(dir, () => {});
    expect(w.watchedCount).toBe(1);
    w.stop();
  });

  it('watchedCount：paths 全不存在 = 0（空转判定面）', () => {
    const dir = mkProject();
    fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true });
    const w = startWatching(dir, () => {});
    expect(w.watchedCount).toBe(0);
    w.stop();
  });

  it('触发路径：src 内写文件 → 防抖后回调收到相对路径', async () => {
    const dir = mkProject();
    // settle：等 mkdir 残留事件窗口过去再建 watcher（见文件头注释）
    await new Promise((r) => setTimeout(r, 150));
    const received = new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        w.stop();
        reject(new Error('timeout: 未收到变更回调'));
      }, 5000);
      const w = startWatching(dir, (files) => {
        clearTimeout(timer);
        w.stop();
        resolve(files);
      });
      // 触发：watcher 建立后受控写入
      setTimeout(() => fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const x = 1;\n'), 100);
    });
    const files = await received;
    expect(files.some((f) => f.includes('a.ts'))).toBe(true);
  });

  it('忽略规则：*.log 命中的变更不进回调', async () => {
    const dir = mkProject();
    await new Promise((r) => setTimeout(r, 150)); // settle（同上）
    let got = false;
    const w = startWatching(dir, () => { got = true; });
    // 触发被 ignore 的写入，等一个防抖窗口（300ms 配置 + 余量）
    fs.writeFileSync(path.join(dir, 'src', 'debug.log'), 'noise\n');
    await new Promise((r) => setTimeout(r, 800));
    expect(got).toBe(false);
    w.stop();
  });
});
