// ============================================================
// team-create.test.ts · v1.5.5 阶段三 F8 · team_create 真实建队行为锁
// ============================================================
// 验收：
//   ① 声明 formation 时 MCP 路径真实调用 createTeam——formation.json 落盘存在
//      （此前只写 team.yml 就宣告 formationFile 成功，纸面承诺）。
//   ② 未声明 formation 时不产生 formationSummary.formationFile（如实——没有阵型
//      就没有阵型文件），team.yml 正常写入。
//   ③ 阵型实例化失败时如实报错（isError=true），不假成功。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { teamCreate } from '../tools/team-create';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'team-mcp-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const TEAM_YAML = (formation?: string) => [
  'name: mcp测试团队',
  'team_id: m1',
  ...(formation ? [`formation: ${formation}`] : []),
  ...(formation ? [] : [
    'members:',
    '  - agent_id: a1',
    '    role: leader',
    '    trust: 0.9',
  ]),
].join('\n');

describe('v1.5.5 阶段三 F8 · team_create 真实建队', () => {
  it('声明 formation ⇒ createTeam 被真实调用（formation.json 落盘 + handoffs 非空）', () => {
    const r = teamCreate({ teamYaml: TEAM_YAML('commander-crews'), dataDir: dir });
    expect(r.isError).toBeFalsy();
    expect(r.data.ok).toBe(true);
    const fp = join(dir, 'teams', 'm1', 'formation.json');
    expect(existsSync(fp)).toBe(true); // 真实落盘（此前纸面承诺）
    const rec = JSON.parse(readFileSync(fp, 'utf-8')) as {
      formation: string; handoffs: unknown[]; members: Array<{ role: string }>;
    };
    expect(rec.formation).toBe('commander-crews');
    expect(rec.handoffs.length).toBe(2); // F10b：模板边全部落盘面可见
    // F9：兜底态首个成员 leader
    expect(rec.members.filter((m) => m.role === 'leader')).toHaveLength(1);
  });

  it('未声明 formation ⇒ 不产 formationFile 字段（如实），team.yml 正常写入', () => {
    const r = teamCreate({ teamYaml: TEAM_YAML(), dataDir: dir });
    expect(r.isError).toBeFalsy();
    expect(r.data.ok).toBe(true);
    expect(existsSync(join(dir, 'teams', 'm1', 'team.yml'))).toBe(true);
    expect(existsSync(join(dir, 'teams', 'm1', 'formation.json'))).toBe(false);
    expect(JSON.stringify(r.data)).not.toContain('formationFile');
  });

  it('阵型非法 ⇒ fail-closed 如实报错（isError=true），不假成功', () => {
    const r = teamCreate({ teamYaml: TEAM_YAML('nonexistent-formation'), dataDir: dir });
    expect(r.isError).toBe(true);
    expect(r.data.ok).toBe(false);
    expect((r.data.error ?? '') !== '').toBe(true);
  });
});
