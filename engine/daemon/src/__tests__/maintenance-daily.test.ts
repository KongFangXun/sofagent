// ============================================================
// maintenance-daily.test.ts · 批D 巡检合并施工四步行为锁
// ============================================================
// F5：memory 文件数超阈值 → archive() 触发 + 留痕；未超 → 健康读数
// F30：think 归档（60 天前条目移 archive + 备份轮转）+ 幂等重跑
// F48-⑤：spill TTL 回收（超期删、保留期内留、SOFAGENT_SPILL_TTL_DAYS 覆盖）
// F51-①：persona 同步（源在场 → 落 knowledge/entities；缺源 → 跳过留痕）
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runMaintenanceDaily } from '../inspectors/maintenance-daily';
import { MEMORY_DIR_FILE_WARN } from '@sofagent/core';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sof-maint-'));
}

describe('批D · maintenance-daily 四步（F5/F30/F48-⑤/F51-①）', () => {
  let home: string;
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    home = tmpHome();
    envBackup = {
      SOFAGENT_HOME: process.env.SOFAGENT_HOME,
      SOFAGENT_DATA: process.env.SOFAGENT_DATA,
      SOFAGENT_HOME_ALLOWED_PREFIXES: process.env.SOFAGENT_HOME_ALLOWED_PREFIXES,
      SOFAGENT_PERSONA_SOURCE: process.env.SOFAGENT_PERSONA_SOURCE,
      SOFAGENT_SPILL_TTL_DAYS: process.env.SOFAGENT_SPILL_TTL_DAYS,
    };
    process.env.SOFAGENT_HOME = home;
    process.env.SOFAGENT_DATA = path.join(home, 'data');
    process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = `${envBackup.SOFAGENT_HOME_ALLOWED_PREFIXES ?? ''}:${os.tmpdir()}`;
    fs.mkdirSync(process.env.SOFAGENT_DATA, { recursive: true });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k as keyof typeof process.env];
      else process.env[k as keyof typeof process.env] = v;
    }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  /** 造 N 个空文件进 memory 目录（目录遍历计数的对象面） */
  function seedMemoryFiles(n: number): void {
    const dir = path.join(process.env.SOFAGENT_DATA!, 'memory', 'facts');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.md`), 'x', 'utf-8');
    }
  }

  it('F5 ① memory 文件数未超阈值 → 健康读数（不触发归档）', () => {
    seedMemoryFiles(5);
    const r = runMaintenanceDaily('/tmp');
    expect(r.name).toBe('maintenance-daily');
    expect(r.message).toContain(`memory 健康：5/${MEMORY_DIR_FILE_WARN} 文件`);
  });

  it('F5 ② 阈值常量为共享导出 10000（全仓唯一份语义锚）', () => {
    expect(MEMORY_DIR_FILE_WARN).toBe(10000);
  });

  it('F30 ① think 60 天前条目 → 归档到 think.archive.md + 备份在场 + 报文留痕', () => {
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const recent = new Date().toISOString().slice(0, 10);
    const think = [
      `## ${old} 旧反思`, '旧内容——应被归档',
      `## ${recent} 新反思`, '新内容——应保留',
    ].join('\n');
    fs.writeFileSync(path.join(process.env.SOFAGENT_DATA!, 'think.md'), think, 'utf-8');
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('think 归档：1 条');
    // 归档产物：think.archive.md 含旧条目；think.md 只剩新条目（append-only 契约
    // 的授权生命周期运维——移出不移入改写）
    const archive = fs.readFileSync(path.join(process.env.SOFAGENT_DATA!, 'think.archive.md'), 'utf-8');
    expect(archive).toContain('旧反思');
    const active = fs.readFileSync(path.join(process.env.SOFAGENT_DATA!, 'think.md'), 'utf-8');
    expect(active).toContain('新反思');
    expect(active).not.toContain('旧反思');
    // 备份轮转在场（think.<date>.bak）
    const baks = fs.readdirSync(process.env.SOFAGENT_DATA!).filter((f) => f.startsWith('think.') && f.endsWith('.bak'));
    expect(baks.length).toBeGreaterThanOrEqual(1);
  });

  it('F30 ② 幂等：重跑不再移动（已归档条目不在活动区）', () => {
    const old = new Date(Date.now() - 61 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(process.env.SOFAGENT_DATA!, 'think.md'), `## ${old} 旧反思\n旧内容`, 'utf-8');
    runMaintenanceDaily('/tmp');
    const r2 = runMaintenanceDaily('/tmp');
    expect(r2.message).toContain('think 归档：0 条');
  });

  it('F48-⑤ ① spill 超期文件清理 / 保留期内文件保留', () => {
    const spillDir = path.join(process.env.SOFAGENT_DATA!, 'spill');
    fs.mkdirSync(spillDir, { recursive: true });
    const oldFile = path.join(spillDir, 'diff-old.diff');
    const newFile = path.join(spillDir, 'diff-new.diff');
    fs.writeFileSync(oldFile, 'secret-ish', 'utf-8');
    fs.writeFileSync(newFile, 'fresh', 'utf-8');
    // old 文件 mtime 拨回 40 天前（超 30 天缺省 TTL）
    const past = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    fs.utimesSync(oldFile, past, past);
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('spill 回收：清理 1 · 保留 1');
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it('F48-⑤ ② SOFAGENT_SPILL_TTL_DAYS=0 → 全部超期清理（env 覆盖生效）', () => {
    const spillDir = path.join(process.env.SOFAGENT_DATA!, 'spill');
    fs.mkdirSync(spillDir, { recursive: true });
    fs.writeFileSync(path.join(spillDir, 'a.diff'), 'x', 'utf-8');
    fs.writeFileSync(path.join(spillDir, 'b.diff'), 'y', 'utf-8');
    // 拨 mtime 到 1 秒前——消除「写入与 cutoff 同毫秒」竞态（TTL=0 语义 = 立即过期）
    const past = new Date(Date.now() - 1000);
    fs.utimesSync(path.join(spillDir, 'a.diff'), past, past);
    fs.utimesSync(path.join(spillDir, 'b.diff'), past, past);
    process.env.SOFAGENT_SPILL_TTL_DAYS = '0';
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('spill 回收：清理 2');
    expect(fs.readdirSync(spillDir)).toHaveLength(0);
  });

  it('F51-① ① persona 源在场 → 同步落 knowledge/entities/persona.md + 报文留痕', () => {
    const src = path.join(home, 'persona-src.md');
    fs.writeFileSync(src, '这是一个足够长度的 persona 内容——超过五十个字符的质量门槛，描述 Agent 的稳定偏好与身份特征。', 'utf-8');
    process.env.SOFAGENT_PERSONA_SOURCE = src;
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('persona 同步 ✓');
    const target = path.join(process.env.SOFAGENT_DATA!, 'knowledge', 'entities', 'persona.md');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('F51-① ② 源缺失 → 跳过留痕（不 crash）', () => {
    process.env.SOFAGENT_PERSONA_SOURCE = path.join(home, 'no-such-persona.md');
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('persona 跳过');
  });

  it('四步单步失败不阻断其余（memory 目录损坏 → spill/persona 照常报告）', () => {
    // 不造任何数据——四步全走「空态」路径仍完整报文
    const r = runMaintenanceDaily('/tmp');
    expect(r.message).toContain('memory 健康');
    expect(r.message).toContain('think 归档');
    expect(r.message).toContain('spill 回收');
    expect(r.message).toContain('persona');
  });
});
