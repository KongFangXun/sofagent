// ============================================================
// formations.test.ts · 六阵型实例化 + 审计留痕测试（v1.4.8 第三章）
// ============================================================
import { describe, expect, it } from 'vitest';
import { validateFormation, parseFormation, FORMATION_NAMES } from '../formations/schema';
import { instantiateFormation, FORMATION_TEMPLATES } from '../formations/registry';
import { runFormationCommand } from '../formations/command';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';
import { join } from 'path';

describe('第三章 · 阵型 schema 校验', () => {
  it('六种合法阵型名', () => {
    expect(FORMATION_NAMES).toHaveLength(6);
    expect(FORMATION_NAMES).toContain('commander-crews');
    expect(FORMATION_NAMES).toContain('cost-pyramid');
  });

  it('合法配置通过', () => {
    const v = validateFormation({
      formation: 'driver-advisor',
      members: [
        { role: 'driver', agentType: 'engineer' },
        { role: 'advisor', agentType: 'reviewer' },
      ],
      edges: [{ from: 'advisor', to: 'driver', protocol: 'review' }],
    });
    expect(v.valid).toBe(true);
  });

  it('未识别阵型名报错并列出六种合法值', () => {
    const v = validateFormation({ formation: 'nonexistent', members: [{ role: 'a', agentType: 'x' }], edges: [] });
    expect(v.valid).toBe(false);
    if (!v.valid) {
      expect(v.errors[0]).toContain('nonexistent');
      for (const name of FORMATION_NAMES) expect(v.errors[0]).toContain(name);
    }
  });

  it('成员空/角色重复/边端点漂移各报错', () => {
    expect(validateFormation({ formation: 'cross-review', members: [], edges: [] }).valid).toBe(false);
    const dup = validateFormation({
      formation: 'cross-review',
      members: [
        { role: 'a', agentType: 'x' },
        { role: 'a', agentType: 'y' },
      ],
      edges: [],
    });
    expect(dup.valid).toBe(false);
    const badEdge = validateFormation({
      formation: 'cross-review',
      members: [{ role: 'a', agentType: 'x' }],
      edges: [{ from: 'a', to: 'ghost', protocol: 'async' }],
    });
    expect(badEdge.valid).toBe(false);
  });

  it('YAML 解析（注入式 yamlLoad）', () => {
    const v = parseFormation(
      'formation: bake-off\nmembers:\n  - role: judge\n    agentType: reviewer\nedges: []\n',
      (s) => JSON.parse(s) as unknown,
    );
    // JSON.parse 对 yaml 文本会抛——走解析失败分支
    expect(v.valid).toBe(false);
  });
});

describe('第三章 · 六阵型实例化 + 审计留痕', () => {
  it('六阵型全部可实例化（模板兜底）', () => {
    for (const name of FORMATION_NAMES) {
      const inst = instantiateFormation({ formation: name, members: [], edges: [] });
      expect(inst.formation).toBe(name);
      expect(inst.members.length).toBeGreaterThanOrEqual(2);
      expect(inst.members.every((m) => m.state === 'open')).toBe(true);
    }
  });

  it('自定义 members 优先于模板', () => {
    const inst = instantiateFormation({
      formation: 'commander-crews',
      members: [
        { role: '主将', agentType: 'engineer' },
        { role: '兵卒', agentType: 'engineer' },
      ],
      edges: [],
    });
    expect(inst.members.map((m) => m.role)).toEqual(['主将', '兵卒']);
  });

  it('跨成员派发/交接留痕（who-派发-who 可回溯）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['commander-crews']);
    inst.recordHandoff({ from: 'commander', to: 'crew-1', protocol: 'sync' }, 'commander');
    inst.recordHandoff({ from: 'commander', to: 'crew-2', protocol: 'sync' }, 'commander');
    const audit = inst.exportFormationAudit();
    expect(audit.handoffs).toHaveLength(2);
    expect(audit.handoffs[0]?.dispatchedBy).toBe('commander');
    expect(audit.handoffs[1]?.from).toBe('commander');
  });

  it('边生命周期管理（open → closed）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['driver-advisor']);
    inst.closeMember('advisor');
    const audit = inst.exportFormationAudit();
    expect(audit.members.find((m) => m.role === 'advisor')?.state).toBe('closed');
    expect(audit.members.find((m) => m.role === 'driver')?.state).toBe('open');
  });

  it('bake-off 阵型拓扑对接 A/B 形态（judge 汇聚双候选）', () => {
    const inst = instantiateFormation(FORMATION_TEMPLATES['bake-off']);
    const judge = inst.members.find((m) => m.role === 'judge');
    expect(judge).toBeDefined();
    // 双候选 → judge 两条 async 边（择优由调用方接 v1.3.5 A/B 基建）
    expect(FORMATION_TEMPLATES['bake-off'].edges.filter((e) => e.to === 'judge')).toHaveLength(2);
  });
});

describe('v1.5.4 接线批 · formation CLI 子命令（command.ts）', () => {
  const collect = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };

  it('--list 列出六种内置阵型（含成员与交接边）', async () => {
    const { out, io } = collect();
    const rc = await runFormationCommand(['formation', '--list'], io);
    expect(rc).toBe(0);
    const text = out.join('\n');
    for (const n of FORMATION_NAMES) expect(text).toContain(n);
    expect(text).toContain('交接:');
  });

  it('--name <合法阵型> --json ⇒ rc=0 且审计 JSON 三键齐（formation/members/handoffs）', async () => {
    const { out, io } = collect();
    const rc = await runFormationCommand(['formation', '--name', 'driver-advisor', '--json'], io);
    expect(rc).toBe(0);
    const audit = JSON.parse(out.join('\n'));
    expect(audit.formation).toBe('driver-advisor');
    expect(audit.members).toHaveLength(2);
    expect(audit.members.every((m: { state: string }) => m.state === 'open')).toBe(true);
    expect(audit.handoffs).toEqual([]);
  });

  it('--name <非法阵型> ⇒ rc=1 且错误列出六合法值（fail-closed，不静默放行）', async () => {
    const { err, io } = collect();
    const rc = await runFormationCommand(['formation', '--name', 'not-a-formation'], io);
    expect(rc).toBe(1);
    const text = err.join('\n');
    expect(text).toContain('阵型配置非法');
    for (const n of FORMATION_NAMES) expect(text).toContain(n);
  });

  it('无参数 ⇒ rc=1 且打印用法', async () => {
    const { out, io } = collect();
    const rc = await runFormationCommand(['formation'], io);
    expect(rc).toBe(1);
    expect(out.join('\n')).toContain('用法:');
  });

  it('--out <file> ⇒ 审计 JSON 落盘且内容与 stdout 同源', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sof-formation-cli-'));
    const file = join(dir, 'nested', 'formation-audit.json');
    try {
      const { out, io } = collect();
      const rc = await runFormationCommand(['formation', '--name', 'cost-pyramid', '--out', file], io);
      expect(rc).toBe(0);
      expect(out.join('\n')).toContain('审计 JSON 已落盘');
      const written = JSON.parse(readFileSync(file, 'utf8'));
      expect(written.formation).toBe('cost-pyramid');
      expect(written.members.length).toBeGreaterThan(0);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 沙箱 shim 下清理失败不阻断（与既有测试同容错语义） */ }
    }
  });
});

describe('v1.5.4 接线批 · 最小形态（模板兜底）契约修正', () => {
  it('最小形态：只声明阵型名 ⇒ 合法（模板兜底，此前被 validator 误拒）', () => {
    const v = validateFormation({ formation: 'driver-advisor' });
    expect(v.valid).toBe(true);
  });

  it('端到端：最小形态经 instantiateFormation ⇒ 成员来自内置模板', () => {
    const verdict = parseFormation('formation: cross-review\n', (s) => yaml.load(s));
    expect(verdict.valid).toBe(true);
    const inst = instantiateFormation(verdict.config!);
    expect(inst.members.map((m) => m.role)).toEqual(
      FORMATION_TEMPLATES['cross-review'].members.map((m) => m.role),
    );
  });

  it('放宽探针①·超界仍红：显式空数组 ⇒ 非法（不得静默兜底成模板）', () => {
    const v = validateFormation({ formation: 'driver-advisor', members: [] });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('非空数组');
  });

  it('放宽探针②·超界仍红：给 edges 缺 members ⇒ 非法（边端点无成员表可校验）', () => {
    const v = validateFormation({
      formation: 'driver-advisor',
      edges: [{ from: 'a', to: 'b', protocol: 'sync' }],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('members 不可缺省');
  });

  it('放宽探针③·未越界不误伤：坏成员仍逐项拦（缺 agentType）', () => {
    const v = validateFormation({ formation: 'driver-advisor', members: [{ role: 'driver' }] });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('role 或 agentType');
  });
});
