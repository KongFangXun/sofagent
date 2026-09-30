// ============================================================
// team-formation.test.ts · v1.5.5 章四 · 阵型消费面接线行为锁
// ============================================================
// 验收标准对账（devlog 第四章）：
//   ① formation 声明 + members 缺省 ⇒ 建队成员拓扑 == 内置模板（六阵型各一例）
//   ② 显式 members 与模板并存 ⇒ 以显式为准 + 偏离被记录
//   ③ 非法阵型名 ⇒ fail-closed（拒绝 + 报六合法值），不静默降级
//   ④ 未声明 formation 的既有 team.yml ⇒ 行为零变化（存量回归）
//   ⑤ formation.json 落盘可查
//   ⑥ 交接事件 recordHandoff（audit 导出可查）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseTeamYaml, createTeam, TeamYamlError } from '../team/team-manager';
import { FORMATION_NAMES } from '../formations/schema';
import { FORMATION_TEMPLATES, instantiateFormation } from '../formations/registry';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'team-f-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const BASE = (formation?: string, membersYaml?: string) => [
  'name: 测试团队',
  'team_id: t1',
  ...(formation ? [`formation: ${formation}`] : []),
  ...(membersYaml ? [membersYaml] : []),
].join('\n');

const EXPLICIT_MEMBERS = [
  'members:',
  '  - agent_id: a1',
  '    role: leader',
  '    trust: 0.9',
  '  - agent_id: a2',
  '    role: member',
  '    trust: 0.5',
].join('\n');

describe('v1.5.5 章四 · 六阵型模板兜底（验收 ①）', () => {
  for (const name of FORMATION_NAMES) {
    it(`formation: ${name} + members 缺省 ⇒ 成员拓扑 == 内置模板`, () => {
      const y = parseTeamYaml(BASE(name));
      expect(y.formation).toBe(name);
      const tpl = FORMATION_TEMPLATES[name];
      expect(y.members).toHaveLength(tpl.members.length);
      // 角色序列一致（leader 在模板的承担位）
      expect(y.members.map((m) => m.role)).toEqual(
        tpl.members.map((m) => (m.role === 'leader' ? 'leader' : 'member')),
      );
      // agent_id 按约定生成 + trust 缺省 0.5
      expect(y.members.every((m) => m.agent_id.startsWith('t1-'))).toBe(true);
      expect(y.members.every((m) => m.trust === 0.5)).toBe(true);
    });
  }
});

describe('v1.5.5 章四 · 显式覆盖与偏离记录（验收 ②）', () => {
  it('显式 members 并存 ⇒ 以显式为准', () => {
    const y = parseTeamYaml(BASE('cross-review', EXPLICIT_MEMBERS));
    expect(y.members.map((m) => m.agent_id)).toEqual(['a1', 'a2']);
    expect(y.members[0]!.trust).toBe(0.9); // 显式值不被模板覆盖
  });

  it('偏离落 formation.json 的 template_deviation（可查）', () => {
    const mgr = createTeam(BASE('cross-review', EXPLICIT_MEMBERS), { dataDir: dir });
    void mgr;
    const p = join(dir, 'teams', 't1', 'formation.json');
    expect(existsSync(p)).toBe(true);
    const rec = JSON.parse(readFileSync(p, 'utf-8')) as { formation: string; template_deviation: { template: string; actual: string } | null };
    expect(rec.formation).toBe('cross-review');
    expect(rec.template_deviation).not.toBeNull(); // 偏离被记录（不静默覆盖）
  });
});

describe('v1.5.5 章四 · fail-closed（验收 ③）', () => {
  it('非法阵型名 ⇒ TeamYamlError 报六合法值', () => {
    try {
      parseTeamYaml(BASE('nonexistent-formation'));
      expect.unreachable('应抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(TeamYamlError);
      const msg = (e as Error).message;
      for (const n of FORMATION_NAMES) expect(msg).toContain(n); // 六合法值全列
      expect(msg).toContain('nonexistent-formation');
    }
  });
});

describe('v1.5.5 章四 · 存量回归（验收 ④）', () => {
  it('未声明 formation 的既有 team.yml ⇒ 行为零变化', () => {
    const y = parseTeamYaml(BASE(undefined, EXPLICIT_MEMBERS));
    expect(y.formation).toBeUndefined();
    expect(y.members.map((m) => m.agent_id)).toEqual(['a1', 'a2']);
  });

  it('未声明 formation 且 members 缺省 ⇒ 既有报错不变（不被阵型兜底吞掉）', () => {
    expect(() => parseTeamYaml(BASE())).toThrow(/members 缺失或为空数组/);
  });

  it('未声明 formation ⇒ formation.json 不落盘（零变化）', () => {
    const mgr = createTeam(BASE(undefined, EXPLICIT_MEMBERS), { dataDir: dir });
    void mgr;
    expect(existsSync(join(dir, 'teams', 't1', 'formation.json'))).toBe(false);
  });
});

describe('v1.5.5 章四 · 落盘与交接留痕（验收 ⑤⑥）', () => {
  it('formation.json 结构完整（成员拓扑 + 交接边 + 时间戳）', () => {
    const mgr = createTeam(BASE('commander-crews'), { dataDir: dir });
    void mgr;
    const rec = JSON.parse(readFileSync(join(dir, 'teams', 't1', 'formation.json'), 'utf-8')) as {
      team_id: string; formation: string; instantiated_at: string;
      members: unknown[]; handoffs: unknown[];
    };
    expect(rec.team_id).toBe('t1');
    expect(rec.formation).toBe('commander-crews');
    expect(rec.instantiated_at).toBeTruthy();
    expect(Array.isArray(rec.members)).toBe(true);
    expect(rec.members.length).toBeGreaterThan(0);
  });

  it('交接事件经 recordHandoff 可查（instantiateFormation 审计面）', () => {
    const tpl = FORMATION_TEMPLATES['driver-advisor'];
    const instance = instantiateFormation({
      formation: 'driver-advisor',
      members: tpl.members,
      edges: tpl.edges,
    });
    for (const edge of tpl.edges) instance.recordHandoff(edge);
    const audit = instance.exportFormationAudit();
    expect(audit.formation).toBe('driver-advisor');
    expect(audit.handoffs.length).toBe(tpl.edges.length); // 每条模板边都有留痕
  });
});
