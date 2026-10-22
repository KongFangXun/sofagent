// B2 五判据测试（cordis-plugin-sofagent-rsi-corpus · v0.1.0）
// ① 接入形态合法 ② 生成物一致 ③ 注册面对账 ④ 可编排调用 ⑤ 行为等价逐字节
// golden = ../GOLDEN.json（重算记录见其 description；改实现必须先重算并同步登记）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import plugin, { pluginMeta, capability, invoke } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(path.join(HERE, '..', 'GOLDEN.json'), 'utf8'));
// golden 输入在 factory 仓（行为等价的基准侧）；测试用相对路径解析
const FACTORY = process.env.FACTORY_ROOT
  ?? '/Users/kongfangxun/Library/Mobile Documents/com~apple~CloudDocs/WorkBuddy/factory';

describe('B2 五判据', () => {
  it('① 接入形态合法：seam=non-seam:tool-set + kit 契约', () => {
    expect(pluginMeta.id).toBe('cordis-plugin-sofagent-rsi-corpus');
    expect(pluginMeta.seam).toBe('non-seam:tool-set');
    expect(typeof plugin.apply).toBe('function'); // DSH Cordis 插件契约
    expect(capability).toContain('语料管道');
  });

  it('② 生成物一致：package.json / cordis.patch.yml 与 meta 对账', () => {
    const pkg = JSON.parse(readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
    expect(pkg.name).toBe(pluginMeta.id);
    expect(pkg.sofagent.seam).toBe(pluginMeta.seam);
    const patch = readFileSync(path.join(HERE, '..', 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain(`name: '${pluginMeta.id}'`);
    expect(patch).toContain(pluginMeta.seam);
  });

  it('③ 注册面对账：plugins.json 含本插件且 seam 一致', () => {
    const list = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'plugins.json'), 'utf8'));
    const entry = list.plugins.find((p: { id: string }) => p.id === pluginMeta.id);
    expect(entry).toBeTruthy();
    expect(entry.seam).toBe(pluginMeta.seam);
  });

  it('④ 可编排调用：invoke 桥接到 runPipeline（真实调用 + 缺依赖降级不抛）', async () => {
    // 真实编排调用：走 kit.invoke 的桥接路径（与 DSH 宿主同一条链）
    const FACTORY2 = FACTORY;
    const outDir = path.join(HERE, '..', 'node_modules', '.b2-tmp-invoke');
    const r = await invoke({
      in: path.join(FACTORY2, 'rsi/corpus/sample-raw.jsonl'),
      dict: path.join(FACTORY2, 'rsi/corpus/sample-terms.json'),
      outDir,
    });
    expect(r.total).toBe(8);
    expect([r.buckets.sensitive, r.buckets.judgement, r.buckets.abstain]).toEqual([2, 4, 2]);
  });

  it('⑤ 行为等价逐字节：三产物 sha/bytes/records 与 golden 全等', async () => {
    const m = await import('@sofagent/rsi-corpus');
    const outDir = path.join(HERE, '..', 'node_modules', '.b2-tmp');
    const r = m.runPipeline({
      in: path.join(FACTORY, 'rsi/corpus/sample-raw.jsonl'),
      dict: path.join(FACTORY, 'rsi/corpus/sample-terms.json'),
      outDir,
    });
    expect([r.buckets.sensitive, r.buckets.judgement, r.buckets.abstain]).toEqual([2, 4, 2]);
    expect(r.residualCount).toBe(0);
    for (const g of GOLDEN.outputs) {
      const got = r.files.find((f: { bucket: string }) => f.bucket === g.name);
      expect(got, `缺产物 ${g.name}`).toBeTruthy();
      expect(got.records).toBe(g.records);
      expect(got.bytes).toBe(g.bytes);
      expect(got.sha256).toBe(g.sha256); // 64 位逐字节等价
    }
  });
});

// 输入侧冻结复核（golden 的 inputs 段不得漂移）
describe('golden 输入冻结', () => {
  for (const inp of GOLDEN.inputs) {
    it(`输入 ${inp.role} sha 不变`, () => {
      const buf = readFileSync(path.join(FACTORY, inp.path));
      expect(createHash('sha256').update(buf).digest('hex')).toBe(inp.sha256);
      expect(buf.byteLength).toBe(inp.bytes);
    });
  }
});
