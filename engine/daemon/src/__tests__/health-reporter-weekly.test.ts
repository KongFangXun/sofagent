// ============================================================
// health-reporter-weekly.test.ts · F48-③ 同日覆盖 + 按周轮转行为锁
// ============================================================
// 用例：
//   一、同周重复写 → 覆盖当前档（无新周档产生）
//   二、跨周 → 当前档归位为上周周档（daemon-health-<ISO周>.json）
//   三、周档超 4 份 → 最旧被清理（保留 4）
// 消费方语义：Dashboard 读当前档（daemon-health.json）不变。
//
// 🔴 隔离纪律：DASHBOARD_DIR 是 core 模块加载时快照（DATA_DIR 常量），
// env 注入晚于 import 无效——**必须 vi.mock '@sofagent/core' 固定该常量到
// 临时目录**，否则测试写真实 ~/.sofagent/data/dashboard/（本测试首版实锤
// 污染，已清理并改为本形态——真实 HOME 的数据面一个字节都不能碰）。
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// vi.mock 工厂提升到文件顶——一切函数声明（hoisted）+ 全局变量（无 TDZ）形态：
// getDashDir 用 function 声明（提升安全），目录挂 globalThis（mock 工厂与测试
// 两侧同源取值，进程内单例）。
function getDashDir(): string {
  const g = globalThis as { __sofHrDash?: string };
  if (!g.__sofHrDash) {
    g.__sofHrDash = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-hr-'));
  }
  return g.__sofHrDash;
}

vi.mock('@sofagent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/core')>();
  return {
    ...actual,
    DASHBOARD_DIR: getDashDir(),
    resolveDaemonJson: () => path.join(getDashDir(), 'daemon.json'),
  };
});

// mock 在 import 链生效后引入被测模块
import { runHealthReport } from '../inspectors/health-reporter';

/** 测试侧取同一隔离目录（与 mock 工厂同源） */
const DASH = getDashDir();

function seedCurrent(marker: string, mtime: Date): void {
  fs.mkdirSync(DASH, { recursive: true });
  const p = path.join(DASH, 'daemon-health.json');
  fs.writeFileSync(p, JSON.stringify({ marker }), 'utf-8');
  fs.utimesSync(p, mtime, mtime);
}

/** ISO 周号（与实现同算法） */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

describe('F48-③ · health-report 同日覆盖 + 按周轮转', () => {
  beforeEach(() => {
    fs.rmSync(DASH, { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(DASH, { recursive: true, force: true });
  });

  it('一、同周重复写 → 覆盖当前档（无新周档产生）', () => {
    const r1 = runHealthReport("/tmp");
    expect(r1).not.toBeNull();
    const r2 = runHealthReport("/tmp");
    expect(r2).not.toBeNull();
    const files = fs.readdirSync(DASH).filter((f) => f.startsWith('daemon-health'));
    expect(files).toEqual(['daemon-health.json']); // 只当前档
  });

  it('二、跨周 → 当前档归位为上周周档', () => {
    const lastWeek = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    seedCurrent('old-frame', lastWeek);
    runHealthReport("/tmp");
    const archived = `daemon-health-${isoWeek(lastWeek)}.json`;
    expect(fs.existsSync(path.join(DASH, archived))).toBe(true);
    const archivedContent = JSON.parse(fs.readFileSync(path.join(DASH, archived), 'utf-8'));
    expect(archivedContent.marker).toBe('old-frame');
    expect(fs.existsSync(path.join(DASH, 'daemon-health.json'))).toBe(true);
  });

  it('三、周档超 4 份 → 最旧被清理（保留 4）', () => {
    fs.mkdirSync(DASH, { recursive: true });
    for (const w of ['2026-W01', '2026-W02', '2026-W03', '2026-W04', '2026-W05', '2026-W06']) {
      fs.writeFileSync(path.join(DASH, `daemon-health-${w}.json`), '{}', 'utf-8');
    }
    const lastWeek = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    seedCurrent('cross-week', lastWeek);
    runHealthReport("/tmp");
    const archives = fs.readdirSync(DASH)
      .filter((f) => f.startsWith('daemon-health-') && f.endsWith('.json'))
      .sort();
    expect(archives.some((f) => f.includes('2026-W01'))).toBe(false);
    expect(archives.some((f) => f.includes('2026-W02'))).toBe(false);
    expect(archives.length).toBeLessThanOrEqual(5); // 保留 4 + 本轮归位 1
  });
});
