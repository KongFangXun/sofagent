// @sofagent/rsi-corpus · 行为等价 golden 测试
// ============================================================
// 目的（B2 五判据⑤）：本包的对外承诺是「与 factory 仓 rsi/corpus/pipeline.mjs v0.1.0
// 行为等价」。等价性不能靠自述，只能靠冻结基准逐字节比对——基准即
// engine/dsh-plugins/cordis-plugin-sofagent-rsi-corpus/GOLDEN.json
// （输入 / 三产物的 sha256 + 字节数 + 记录数 2-4-2）。
//
// 为什么夹具写在源码里而不放 test/fixtures/：
//   基准输入含 `AKIA…` 形态的**假密钥**（它正是 L0「云密钥」正则的测试素材），
//   放进数据文件会被 A2「不泄密钥」判为硬 FAIL；写成 `.test.mjs` 内的字面量，
//   则落到 A2 的**测试文件豁免**（降级 WARN + 要求人工确认）——既让扫描器看得见，
//   又符合它「测试夹具可含密钥形态」的设计意图。**不用 base64 编码规避扫描**：
//   那等于向安全门禁隐瞒内容。
//
// 纪律：
//   1. `RAW` / `DICT` 是 golden 的**输入原件**（从 factory 仓逐字节转录）。
//      改它们等于改基准 ⇒ 必须先在 factory 侧重算 golden 并在两仓同批登记。
//   2. 第二个用例断言「转录件字节数 / sha == GOLDEN.inputs」——转录错字会先在这里红，
//      不会伪装成实现漂移。
//   3. 改 src/index.mjs 后若金标红，正确动作是重算 golden 并两仓同步登记，
//      **不是**改测试期望值（改测试 = 把门禁改成擦鞋垫）。
//   4. 跑法 = 仓内统一口径 `vitest run`（与 eval / think 等零依赖包一致，
//      vitest 由根 workspace 提升供给，本包不新增 devDependency）。
// ============================================================

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { VERSION, redact, triage, runPipeline } from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const GOLDEN_PATH = path.resolve(PKG, '../dsh-plugins/cordis-plugin-sofagent-rsi-corpus/GOLDEN.json');

const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** golden 输入原件 · 语料（8 行 JSONL，行间 \n，**结尾无换行**） */
const RAW = [
  '{"id":"sample-001","text":"这条改动应当驳回，因为它超出声明范围，优先级低于安全闸"}',
  '{"id":"sample-002","text":"甲方客户合同编号 HT-2026-001，联系人张三，报价底价 12.5 元"}',
  '{"id":"sample-003","text":"客户甲方认为该判定应当驳回，某某电池厂有异议"}',
  '{"id":"sample-004","text":"联系 13800138000 或 a@b.com，云密钥 AKIAABCDEFGHIJKLMNOP"}',
  '{"id":"sample-005","text":"本次结论：选型建议采用方案 A，权衡后取舍为去权重"}',
  '{"id":"sample-006","text":"某某电池厂反馈该条款优先级应当上移，建议采纳而非驳回"}',
  '{"id":"sample-007","text":"供应商名华强北供应链，合同编号 HT-2026-042，工资与绩效分明细待核"}',
  '{"id":"sample-008","text":"达远智造的交付边界尚不清晰，建议评估后明确是否通过"}',
].join('\n');

/** golden 输入原件 · L1 专名词典（单行 JSON 数组，**结尾无换行**） */
const DICT = '["某某电池厂", "华强北供应链", "深圳测试科技", "孔放勋", "达远智造"]';

/** 把两份转录件落到一次性目录，返回可供 runPipeline 取用的路径 */
function materialize() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsi-corpus-'));
  const rawPath = path.join(dir, 'sample-raw.jsonl');
  const dictPath = path.join(dir, 'sample-terms.json');
  fs.writeFileSync(rawPath, RAW);
  fs.writeFileSync(dictPath, DICT);
  return { dir, rawPath, dictPath };
}

describe('rsi-corpus · 契约面', () => {
  it('VERSION 与 golden 记载的生成器版本一致', () => {
    expect(VERSION).toBe(GOLDEN.generator.version);
  });

  it('转录件即 golden 输入原件（字节数 + sha256 双断言，防转录漂移伪装成实现漂移）', () => {
    const byRole = { corpus: RAW, dict: DICT };
    for (const inp of GOLDEN.inputs) {
      const text = byRole[inp.role];
      expect(text, `golden 声明了未转录的输入角色：${inp.role}`).toBeTruthy();
      const buf = Buffer.from(text, 'utf8');
      expect(buf.length, `${inp.role} 字节数漂移（转录错字？）`).toBe(inp.bytes);
      expect(sha256(buf), `${inp.role} sha256 漂移`).toBe(inp.sha256);
    }
  });
});

describe('rsi-corpus · 脱敏与分拣', () => {
  it('redact 覆盖全部 L0 类别且命中值零残留', () => {
    const samples = [
      ['私钥', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----', '[PRIVATE_KEY]'],
      ['云密钥', 'id AKIAABCDEFGHIJKLMNOP end', '[CLOUD_KEY]'],
      ['sk 令牌', 'token sk-abcdefghijklmnopqrst end', '[API_TOKEN]'],
      ['邮箱', 'mail a.b-c@example.co end', '[EMAIL]'],
      ['手机号', 'tel 13800138000 end', '[PHONE]'],
      ['身份证', 'id 110101199003074512 end', '[ID_CARD]'],
      ['银行卡', 'card 6222021234567890 end', '[BANK_CARD]'],
      ['凭证键值', 'api_key = "s3cr3tvalue" end', '[CREDENTIAL]'],
    ];
    for (const [name, raw, ph] of samples) {
      const { out, hits } = redact(raw);
      expect(hits.some((h) => h.name === name), `${name} 未命中`).toBe(true);
      expect(out.includes(ph), `${name} 未替换为 ${ph}：${out}`).toBe(true);
      // 残留断言：命中的原值不得出现在输出里
      for (const h of hits) for (const v of h.values) expect(out.includes(v), `${name} 原值残留`).toBe(false);
    }
  });

  it('redact 支持 L1 专名词典替换', () => {
    const { out, hits } = redact('甲乙双方约定由某某科技承建', ['某某科技']);
    expect(out).toBe('甲乙双方约定由[TERM]承建');
    expect(hits.map((h) => h.name)).toEqual(['专名词典']);
  });

  it('triage 四态判定（含敏感+判定双真 ⇒ ABSTAIN）', () => {
    expect(triage('客户要求应当优先保障合规')).toBe('ABSTAIN'); // 双真应弃权
    expect(triage('客户合同编号为 A-1')).toBe('SENSITIVE');
    expect(triage('结论是应当先做取舍')).toBe('JUDGEMENT');
    expect(triage('今天天气不错')).toBe('ABSTAIN'); // 两假亦弃权
  });
});

describe('rsi-corpus · 端到端与 golden 等价', () => {
  it('runPipeline 与 golden 逐字节一致（记录数 / 字节数 / sha256）', () => {
    const { rawPath, dictPath } = materialize();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsi-corpus-out-'));
    const res = runPipeline({ in: rawPath, dict: dictPath, outDir });

    expect(res.total, '总记录数不符').toBe(GOLDEN.invariants.records_total);
    expect(res.dictSkipped, '词典应被加载').toBe(false);
    expect(
      [res.buckets.sensitive, res.buckets.judgement, res.buckets.abstain].join('/'),
      '三桶拆分不符',
    ).toBe(GOLDEN.invariants.records_split);
    expect(res.residualCount, 'golden 要求命中原值零残留').toBe(0);

    for (const exp of GOLDEN.outputs) {
      const got = res.files.find((f) => f.bucket === exp.name);
      expect(got, `缺少产物桶：${exp.name}`).toBeTruthy();
      expect(got.records, `${exp.name} 记录数`).toBe(exp.records);
      expect(got.bytes, `${exp.name} 字节数`).toBe(exp.bytes);
      expect(got.sha256, `${exp.name} sha256（实现与基准不等价）`).toBe(exp.sha256);
      // 落盘文件与返回的度量必须是同一份字节
      expect(sha256(fs.readFileSync(got.file)), `${exp.name} 落盘字节与度量不一致`).toBe(exp.sha256);
    }
  });

  it('runPipeline 对空输入抛 BLIND 错误（口径：不许静默产空语料）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsi-corpus-empty-'));
    const empty = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(empty, '\n\n');
    let err;
    try {
      runPipeline({ in: empty, outDir: dir });
    } catch (e) {
      err = e;
    }
    expect(err, '空输入应抛错而不是静默产出空语料').toBeTruthy();
    expect(err.code).toBe('BLIND');
    expect(err.message).toMatch(/0 行/);
  });

  it('runPipeline 空词典标记 dictSkipped 且不中断', () => {
    const { rawPath } = materialize();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsi-corpus-nodict-'));
    const res = runPipeline({ in: rawPath, dict: null, outDir });
    expect(res.dictSkipped).toBe(true);
    expect(res.total).toBe(GOLDEN.invariants.records_total);
  });
});
