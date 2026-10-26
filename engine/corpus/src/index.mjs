// @sofagent/rsi-corpus · 语料管道（脱敏 L0/L1 → 三分拣）· v0.1.0
// ⚠️ 行为等价基准：factory 仓 rsi/corpus/pipeline.mjs v0.1.0。
//    判据 = cordis-plugin-sofagent-rsi-corpus/GOLDEN.json（输入/三产物的 64 位 sha + 字节数 + 记录数 2/4/2）。
//    改本文件必须先重算 golden 并在两仓同步登记，否则 B2 五判据⑤红。
// 移植纪律：L0 正则逐条同序、词典替换同构、三桶判定同构、
//    出料行 = {id, text, from}（from: 知识库/训练语料/弃权）——与 pipeline.mjs 的落盘行完全一致。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── L0 正则（与 pipeline.mjs 逐条相同；顺序即替换顺序）─────────
const L0 = [
  { name: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, ph: '[PRIVATE_KEY]' },
  { name: '云密钥', re: /\b(AKIA[0-9A-Z]{16})\b/g, ph: '[CLOUD_KEY]' },
  { name: 'sk 令牌', re: /\bsk-[A-Za-z0-9]{16,}\b/g, ph: '[API_TOKEN]' },
  { name: '邮箱', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ph: '[EMAIL]' },
  { name: '手机号', re: /\b1[3-9]\d{9}\b/g, ph: '[PHONE]' },
  { name: '身份证', re: /\b\d{17}[\dXx]\b/g, ph: '[ID_CARD]' },
  { name: '银行卡', re: /\b\d{16,19}\b/g, ph: '[BANK_CARD]' },
  { name: '凭证键值', re: /(api[_-]?key|secret|password|passwd)\s*[:=]\s*["']?[^\s"',;]{6,}/gi, ph: '[CREDENTIAL]' },
];
const JUDGE_WORDS = /(判定|结论|应当|不该|优先级|取舍|选型|是否合规|是否通过|评估|权衡|建议|驳回|采纳)/;
const SENSITIVE_WORDS = /(客户|甲方|乙方|合同编号|报价|底价|工资|薪酬|绩效分|身份证|银行账号|供应商名|联系人)/;

export const VERSION = '0.1.0';

/** 脱敏：L0 正则 + L1 专名词典（与 pipeline.mjs redact() 同构） */
export function redact(text, dict = []) {
  let out = text;
  const hits = [];
  for (const r of L0) {
    const m = out.match(r.re);
    if (m) { hits.push({ name: r.name, n: m.length, values: [...m] }); out = out.replace(r.re, r.ph); }
  }
  for (const t of dict) {
    if (t && out.includes(t)) { hits.push({ name: '专名词典', n: (out.split(t).length - 1), values: [t] }); out = out.split(t).join('[TERM]'); }
  }
  return { out, hits };
}

/** 三分拣（与 pipeline.mjs triage() 同构） */
export function triage(text) {
  const sens = SENSITIVE_WORDS.test(text), judg = JUDGE_WORDS.test(text);
  if (sens && judg) return 'ABSTAIN';
  if (sens) return 'SENSITIVE';
  if (judg) return 'JUDGEMENT';
  return 'ABSTAIN';
}

const FILE_OF = { SENSITIVE: 'sensitive.jsonl', JUDGEMENT: 'judgement.jsonl', ABSTAIN: 'abstain.jsonl' };
const FROM_OF = { SENSITIVE: '知识库', JUDGEMENT: '训练语料', ABSTAIN: '弃权' };

/**
 * 语料管道主入口（行为等价基准：'node rsi/corpus/pipeline.mjs --in ... --dict ... --out-dir ...'，仓外历史脚本的等价快照——该路径已随语料包并入迁出本仓）
 * 逐字节对齐点：行 = {id, text, from}；join('\n')+'\n'；空桶不落文件（与 pipeline.mjs 相同）。
 */
export function runPipeline({ in: inPath, dict: dictPath, outDir }) {
  const raw = fs.readFileSync(inPath, 'utf8');
  const rows = raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (!rows.length) { const e = new Error('0 行'); e.code = 'BLIND'; throw e; }
  let dict = [];
  if (dictPath && fs.existsSync(dictPath)) {
    dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
    if (!Array.isArray(dict) || dict.some((t) => typeof t !== 'string')) {
      const e = new Error('词典须为字符串数组'); e.code = 'BLIND'; throw e;
    }
  }
  const dictSkipped = !dict.length;

  const buckets = { SENSITIVE: [], JUDGEMENT: [], ABSTAIN: [] };
  const allValues = [];
  const hitStat = {};
  for (const r of rows) {
    const src = r.text ?? r.source ?? '';
    const { out, hits } = redact(String(src), dict);
    for (const h of hits) { hitStat[h.name] = (hitStat[h.name] || 0) + h.n; allValues.push(...h.values); }
    const k = triage(out);
    buckets[k].push({ id: r.id ?? null, text: out, from: FROM_OF[k] });
  }
  const corpusText = buckets.JUDGEMENT.map((x) => x.text).join('\n')
    + buckets.SENSITIVE.map((x) => x.text).join('\n')
    + buckets.ABSTAIN.map((x) => x.text).join('\n');
  const residual = [...new Set(allValues)].filter((v) => v && v.length >= 6 && corpusText.includes(v));

  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const [k, v] of Object.entries(buckets)) {
    if (!v.length) continue; // 与 pipeline.mjs 一致：空桶不落文件
    const content = v.map((x) => JSON.stringify(x)).join('\n') + '\n';
    const p = path.join(outDir, FILE_OF[k]);
    fs.writeFileSync(p, content);
    files.push({
      bucket: k.toLowerCase(), file: p, records: v.length,
      bytes: Buffer.byteLength(content),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }
  return {
    version: VERSION,
    total: rows.length,
    dictSkipped,
    buckets: { sensitive: buckets.SENSITIVE.length, judgement: buckets.JUDGEMENT.length, abstain: buckets.ABSTAIN.length },
    redactions: hitStat,
    residualCount: residual.length,
    residual: residual.slice(0, 5),
    files,
  };
}

export default { VERSION, redact, triage, runPipeline };
