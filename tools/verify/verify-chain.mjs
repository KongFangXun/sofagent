#!/usr/bin/env node
// ============================================================
// verify-chain.mjs - 独立 HMAC 审计链验签器（单文件 · 零依赖）
// ============================================================
// 用途：第三方（审计师 / 监管 / 法院技术顾问）无需安装 sofagent 即可对外举证。
//   输入 history.jsonl（历史链）+ decision-log.jsonl（决策链），独立重算
//   HMAC 哈希链完整性——可信根是密码学与副本算法，不是「信任 sofagent」。
//
// 零依赖铁律：只 import node 内置模块（node:crypto / node:fs / node:os /
//   node:path / node:child_process / node:process），绝不 import 任何
//   @sofagent 包或引擎源码。
//
// 算法与 engine/audit/src/chain-kernel.ts 逐字节对齐（协议 SSOT）：
//   1) prevHash[i] = sha256hex(JSON.stringify(omitHash(records[i-1])) + '|' + fingerprint) 前 16 hex
//      （records[i].hashVersion === 2 带指纹；否则不带）
//   2) hmacSig = hmac_sha256_hex(key, stableStringify(omitSig(entry)) + '|' + fingerprint) 前 32 hex
//   3) omitHash(entry) = {...entry, prevHash: undefined, hashVersion: undefined}
//      （保留 hmacSig / hmacAlgo / envFingerprint）
//   4) omitSig(entry)  = 再排除 hmacSig / hmacAlgo（保留 envFingerprint）
//   5) 排除字段靠赋 undefined（不是 delete）——依赖 JSON.stringify 丢 undefined 键
//   6) stableStringify：数组递归 map；纯对象（constructor === Object）按 key
//      字典序递归后 JSON.stringify；其余原样。边界：只对纯对象排序。
//   7) fingerprint = sha256hex(hostname-user-gitDir-dataDir) 前 8 hex
//      （gitDir = git rev-parse --git-dir 输出 trim，失败为 unknown）
//
// 校验语义（四态 + 锚点态）：
//   ok            链完整且可复验（绿）
//   tampered      真篡改（红）——报出条目号 + 期望值 / 实际值
//   head-mismatch 链头锚点不符（红）——仅 history 有锚点文件可判；
//                 decision 侧引擎当前不维护锚点，如实降级为纯链校验（不假装有锚点）
//   unverifiable  不可复验（黄）——环境指纹漂移（密钥轮换 / hostname / git 路径变化）
//   insufficient  记录不足 2 条（灰）
//   absent        文件不存在（请求的链缺席）
//
// 用法见 tools/verify/README.md 或传 --help。
// 退出码：0 = 链完整 / 1 = 不可复验·不足·请求的文件缺席 / 2 = 检测到篡改或链头不符。
// ============================================================

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { hostname, userInfo, homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';

// ════════════════════════════════════════
// 状态常量
// ════════════════════════════════════════

const STATUS = {
  ok: 'ok',
  tampered: 'tampered',
  unverifiable: 'unverifiable',
  insufficient: 'insufficient',
  headMismatch: 'head-mismatch',
  absent: 'absent',
};

/** 严重度排序（ok < unverifiable/insufficient < tampered/head-mismatch）——双链取最严 */
const SEVERITY = {
  [STATUS.ok]: 0,
  [STATUS.unverifiable]: 1,
  [STATUS.insufficient]: 1,
  [STATUS.tampered]: 2,
  [STATUS.headMismatch]: 2,
  [STATUS.absent]: 0,
};

// ════════════════════════════════════════
// 链算法内核（与 chain-kernel.ts 逐字节对齐）
// ════════════════════════════════════════

/** 链字段——签名输入必须排除者（prevHash 链的输入只排除 prevHash / hashVersion） */
const SIG_EXCLUDED_FIELDS = ['prevHash', 'hashVersion', 'hmacSig', 'hmacAlgo'];

/** 纯对象判定（与 core stableStringify 的 constructor === Object 判据一致） */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && value.constructor === Object;
}

/** 递归按 key 字典序排序（只对纯对象排序；数组递归 map；其余原样） */
function sortKeys(input) {
  if (Array.isArray(input)) return input.map(sortKeys);
  if (isPlainObject(input)) {
    const sorted = {};
    for (const key of Object.keys(input).sort()) sorted[key] = sortKeys(input[key]);
    return sorted;
  }
  return input;
}

/** 稳定序列化——使 JSON.stringify 输出与对象 key 顺序无关（消除内存序 vs 文件序假阳性） */
function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

/** prevHash 输入——仅排除 prevHash / hashVersion（保留 hmacSig / hmacAlgo / envFingerprint） */
function omitHashFields(entry) {
  return { ...entry, prevHash: undefined, hashVersion: undefined };
}

/** 签名输入——排除全部链字段（prevHash / hashVersion / hmacSig / hmacAlgo） */
function omitSigFields(entry) {
  const out = { ...entry };
  for (const field of SIG_EXCLUDED_FIELDS) out[field] = undefined;
  return out;
}

/** sha256 hex 全量 */
function sha256hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** HMAC-SHA256 hex 全量 */
function hmacSha256hex(key, input) {
  return createHmac('sha256', key).update(input).digest('hex');
}

/** 计算某条目的 prevHash（读末行记录 → sha256(JSON.stringify(omitHash) + '|' + fingerprint).slice(0,16)） */
function computePrevHash(lastEntry, fingerprint) {
  return sha256hex(JSON.stringify(omitHashFields(lastEntry)) + '|' + fingerprint).slice(0, 16);
}

/** 计算 HMAC 签名（stableStringify(omitSig) + '|' + fingerprint，取前 32 hex） */
function computeHmacSig(entry, key, fingerprint) {
  return hmacSha256hex(key, stableStringify(omitSigFields(entry)) + '|' + fingerprint).slice(0, 32);
}

/**
 * 组装一条链式记录（与 chain-kernel.appendChained 装配顺序逐字对齐）。
 * 仅供 --selftest 合成夹具使用——验签器本体为只读，不写真实审计数据。
 */
function buildEntry(record, prevEntry, key, fingerprint) {
  const prevHash = prevEntry ? computePrevHash(prevEntry, fingerprint) : 'genesis';
  const base = {
    ...record,
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    hmacAlgo: key ? 'stable' : undefined,
  };
  const hmacSig = key ? computeHmacSig(base, key, fingerprint) : undefined;
  return { ...base, hmacSig };
}

// ════════════════════════════════════════
// 环境值解析（密钥 / 指纹）
// ════════════════════════════════════════

/**
 * 解析 HMAC 密钥。解析链：显式 --key > SOFAGENT_KEY_PATH > ~/.sofagent-key。
 * 文件不存在 → null（降级仅验 prevHash 链，与引擎同语义）。
 */
function resolveKey(keyPath) {
  const resolved = keyPath || process.env.SOFAGENT_KEY_PATH || join(homedir(), '.sofagent-key');
  try {
    if (!existsSync(resolved)) return { key: null, path: resolved, present: false };
    return { key: readFileSync(resolved, 'utf-8').trim(), path: resolved, present: true };
  } catch (err) {
    // 读取失败 → 降级为无密钥（仅验 prevHash 链），如实标注（为何可静默：降级不影响链算法，仅弱化强度）
    return { key: null, path: resolved, present: false, error: err.message };
  }
}

/**
 * 计算环境指纹。dataDir 缺省 ''——与引擎写侧 appendHistory 默认口径一致
 * （写侧默认 dataDir=undefined ⇒ 指纹 base 尾段为空）。第三方换机举证时应用 --fingerprint 显式给出。
 */
function computeFingerprint(dataDir) {
  let gitDir = 'unknown';
  try {
    gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    // git 不可用 / 非仓库 → unknown（与引擎 getEnvFingerprint 同语义；为何可静默：指纹降级不改变链算法）
    gitDir = 'unknown';
  }
  if (gitDir === '') gitDir = 'unknown';
  let username = '';
  try {
    username = userInfo().username;
  } catch (err) {
    // 用户名不可得 → 空串（与引擎容错等价；为何可静默：指纹退化不改变链算法）
    username = '';
  }
  const base = `${hostname()}-${username}-${gitDir}-${dataDir ?? ''}`;
  return sha256hex(base).slice(0, 8);
}

/** 默认数据根：SOFAGENT_DATA > SOFAGENT_HOME/data > ~/.sofagent/data */
function defaultDataDir() {
  if (process.env.SOFAGENT_DATA) return process.env.SOFAGENT_DATA;
  const home = process.env.SOFAGENT_HOME || join(homedir(), '.sofagent');
  return join(home, 'data');
}

// ════════════════════════════════════════
// 链校验（verifyChain 四态，含期望值）
// ════════════════════════════════════════

/**
 * 校验已解析记录数组的 HMAC 链完整性（四态判定，与 chain-kernel.verifyChain 同判据）。
 * 篡改早期返回时附带 expected / actual（条目号 + 期望值举证面）。
 */
function verifyChain(records, options) {
  const { key, fingerprint, subject = '链' } = options;

  if (records.length <= 1) {
    return { status: STATUS.insufficient, detail: `${subject}记录不足 2 条，无法构成可验证的防篡改链` };
  }

  const keyAvailable = key !== null;
  let foundUnverifiable = false;
  const unverifiableNotes = [];
  const noteUnverifiable = (index, reason) => {
    unverifiableNotes.push({ index, reason });
  };

  // ── 创世条目独立验签 ──
  const genesisEntry = records[0];
  if (
    genesisEntry &&
    typeof genesisEntry.hmacSig === 'string' &&
    genesisEntry.hmacSig &&
    keyAvailable &&
    key
  ) {
    const genesisUseFingerprint = genesisEntry.hashVersion === 2;
    const genesisHashInput = genesisUseFingerprint
      ? stableStringify(omitSigFields(genesisEntry)) + '|' + fingerprint
      : stableStringify(omitSigFields(genesisEntry));
    const genesisExpectedHmac = hmacSha256hex(key, genesisHashInput).slice(0, 32);
    if (genesisEntry.hmacSig !== genesisExpectedHmac) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        return {
          status: STATUS.tampered,
          index: 0,
          field: 'hmacSig',
          expected: genesisExpectedHmac,
          actual: genesisEntry.hmacSig,
          detail: `${subject}创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
        };
      }
      if (genesisEntry.hmacAlgo === 'stable' && genesisUseFingerprint) {
        const genesisRecordedFingerprint = genesisEntry.envFingerprint;
        if (
          typeof genesisRecordedFingerprint === 'string' &&
          genesisRecordedFingerprint.length > 0 &&
          genesisRecordedFingerprint === fingerprint
        ) {
          return {
            status: STATUS.tampered,
            index: 0,
            field: 'hmacSig',
            expected: genesisExpectedHmac,
            actual: genesisEntry.hmacSig,
            detail: `${subject}创世条目（索引 0）HMAC 签名不匹配（环境指纹一致，确为内容被篡改）`,
          };
        }
      }
      foundUnverifiable = true;
      noteUnverifiable(0, 'genesis-hmac-drift');
    }
  } else if (genesisEntry && keyAvailable && key) {
    // 密钥在场但创世条目无签名：签名被剥离 / legacy 未签名——无法证明完整性
    foundUnverifiable = true;
    noteUnverifiable(0, 'genesis-signature-stripped');
  }

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const curr = records[i];
    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验
    if (curr.prevHash == null || curr.prevHash === 'unknown') {
      if (!(keyAvailable && key)) continue;
      foundUnverifiable = true;
      noteUnverifiable(i, 'no-prevhash');
    } else {
      const recordForHash = omitHashFields(prev);
      const hashInput = currUseFingerprint
        ? JSON.stringify(recordForHash) + '|' + fingerprint
        : JSON.stringify(recordForHash);
      const expectedPrevHash = sha256hex(hashInput).slice(0, 16);
      if (curr.prevHash !== expectedPrevHash) {
        if (currUseFingerprint) {
          foundUnverifiable = true;
          noteUnverifiable(i, 'v2-prevhash-drift');
        } else {
          return {
            status: STATUS.tampered,
            index: i,
            field: 'prevHash',
            expected: expectedPrevHash,
            actual: curr.prevHash,
            detail: `${subject}条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改`,
          };
        }
        continue;
      }
    }

    // 2) HMAC 验签
    if (curr.hmacSig && keyAvailable && key) {
      const expectedHmac = computeHmacSig(curr, key, fingerprint);
      if (curr.hmacSig !== expectedHmac) {
        if (curr.hmacAlgo === 'stable') {
          if (currUseFingerprint) {
            const recordedFingerprint = curr.envFingerprint;
            if (typeof recordedFingerprint === 'string' && recordedFingerprint.length > 0) {
              if (recordedFingerprint === fingerprint) {
                return {
                  status: STATUS.tampered,
                  index: i,
                  field: 'hmacSig',
                  expected: expectedHmac,
                  actual: curr.hmacSig,
                  detail: `${subject}条目 ${i} HMAC 签名不匹配（环境指纹一致，确为内容被篡改）`,
                };
              }
              foundUnverifiable = true;
              noteUnverifiable(i, 'v2-hmac-fingerprint-drift');
            } else {
              foundUnverifiable = true;
              noteUnverifiable(i, 'v2-hmac-no-fingerprint');
            }
          } else {
            return {
              status: STATUS.tampered,
              index: i,
              field: 'hmacSig',
              expected: expectedHmac,
              actual: curr.hmacSig,
              detail: `${subject}条目 ${i} HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
            };
          }
        } else {
          foundUnverifiable = true;
          noteUnverifiable(i, 'legacy-hmac-unreproducible');
        }
      }
    } else if (keyAvailable && key && !curr.hmacSig) {
      foundUnverifiable = true;
      noteUnverifiable(i, 'signature-stripped');
    }
  }

  if (foundUnverifiable) {
    const located = unverifiableNotes
      .map((n) => `#${n.index}·${n.reason}`)
      .slice(0, 5)
      .join('；');
    const more = unverifiableNotes.length > 5 ? `；…另有 ${unverifiableNotes.length - 5} 条` : '';
    const reasons = [...new Set(unverifiableNotes.map((n) => n.reason))];
    return {
      status: STATUS.unverifiable,
      detail: `部分${subject}段无法复验（含无 prevHash 的 legacy 条目 / 密钥在场但条目无签名（疑似签名剥离）/ v2 含环境指纹条目因密钥或环境指纹漂移），属历史证据不可复验，非篡改；原因：${reasons.join(' / ')}；不可复验记录 ${unverifiableNotes.length} 条，定位：${located}${more}`,
    };
  }

  return { status: STATUS.ok };
}

// ════════════════════════════════════════
// 链头锚点校验（history 专有；decision 无锚点）
// ════════════════════════════════════════

/**
 * 校验 history 链头锚点（尾部截断 / 历史重写检测）。
 * 锚点文件不存在 → 'no-anchor'（如实降级，不假装有锚点）。
 * 锚点不可读 / 版本不识别 → unverifiable（fail-closed）。
 * 条数不足 / 锚位哈希不符 → head-mismatch（红）。
 */
function checkAnchor(records, anchorPath) {
  if (!anchorPath || !existsSync(anchorPath)) {
    return { status: 'no-anchor', detail: '链头锚点文件不存在——尾部截断检测不可用（降级为纯链校验）' };
  }
  let anchor = null;
  try {
    const parsed = JSON.parse(readFileSync(anchorPath, 'utf-8'));
    if (parsed && parsed.version === 1) anchor = parsed;
  } catch (err) {
    anchor = null;
  }
  if (anchor === null) {
    return { status: STATUS.unverifiable, detail: '链头锚点不可读，无法确认历史未被截断' };
  }
  if (typeof anchor.entryCount === 'number' && Number.isInteger(anchor.entryCount) && anchor.entryCount >= 1) {
    if (records.length < anchor.entryCount) {
      return {
        status: STATUS.headMismatch,
        index: records.length,
        expected: `entryCount=${anchor.entryCount}`,
        actual: `actual=${records.length}`,
        detail: `链头不匹配：锚点记录 ${anchor.entryCount} 条，实际 ${records.length} 条，疑似尾部删除`,
      };
    }
    const anchored = records[anchor.entryCount - 1];
    const anchorFingerprint = typeof anchor.envFingerprint === 'string' ? anchor.envFingerprint : '';
    const expectedHeadHash = sha256hex(
      JSON.stringify({ ...anchored, prevHash: undefined, hashVersion: undefined }) + '|' + anchorFingerprint,
    ).slice(0, 16);
    if (expectedHeadHash !== anchor.headHash) {
      return {
        status: STATUS.headMismatch,
        index: anchor.entryCount - 1,
        expected: anchor.headHash,
        actual: expectedHeadHash,
        detail: '链头不匹配：锚点位置条目与链头锚点不符，疑似历史重写',
      };
    }
    return { status: STATUS.ok };
  }
  return { status: STATUS.ok, detail: '锚点无有效 entryCount——跳过' };
}

// ════════════════════════════════════════
// 单文件校验（链 + 锚点）
// ════════════════════════════════════════

/**
 * 校验单个 JSONL 链文件。kind = 'history' | 'decision'。
 * 返回 { status, index?, field?, expected?, actual?, detail?, chain, anchor }。
 */
function verifyOneFile(filePath, kind, options) {
  const subject = kind === 'history' ? '历史' : '决策';

  if (!existsSync(filePath)) {
    return { kind, filePath, subject, status: STATUS.absent, detail: '文件不存在' };
  }

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { kind, filePath, subject, status: STATUS.tampered, detail: `读取失败：${err.message}` };
  }

  const records = [];
  let parseLineNo = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    parseLineNo++;
    try {
      records.push(JSON.parse(trimmed));
    } catch (err) {
      // 坏行（非法 JSON）= 结构异常，与 core checkHistoryChainDetailed 同判据 → 篡改（fail-closed）
      return {
        kind,
        filePath,
        subject,
        status: STATUS.tampered,
        index: records.length,
        detail: `第 ${parseLineNo} 行非法 JSON（截断展示）：${trimmed.slice(0, 60)}，疑似伪造/损坏`,
      };
    }
  }

  const chain = verifyChain(records, { key: options.key, fingerprint: options.fingerprint, subject });

  let anchor = null;
  if (kind === 'history' && options.anchorPath) {
    anchor = checkAnchor(records, options.anchorPath);
  }

  let status = chain.status;
  let detail = chain.detail;
  let expected = chain.expected;
  let actual = chain.actual;
  let index = chain.index;
  let field = chain.field;

  if (anchor) {
    if (anchor.status === STATUS.headMismatch) {
      status = STATUS.headMismatch;
      detail = anchor.detail;
      expected = anchor.expected;
      actual = anchor.actual;
      index = anchor.index != null ? anchor.index : index;
      field = 'headHash';
    } else if (anchor.status === STATUS.unverifiable && status === STATUS.ok) {
      status = STATUS.unverifiable;
      detail = anchor.detail;
    }
  }

  return { kind, filePath, subject, status, index, field, expected, actual, detail, chain, anchor };
}

// ════════════════════════════════════════
// CLI
// ════════════════════════════════════════

function parseArgs(argv) {
  const opts = {
    history: '',
    decision: '',
    dataDir: '',
    keyPath: '',
    fingerprint: '',
    json: false,
    help: false,
    selftest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--history' && argv[i + 1]) opts.history = argv[++i];
    else if (arg === '--decision' && argv[i + 1]) opts.decision = argv[++i];
    else if (arg === '--data-dir' && argv[i + 1]) opts.dataDir = argv[++i];
    else if (arg === '--key' && argv[i + 1]) opts.keyPath = argv[++i];
    else if (arg === '--fingerprint' && argv[i + 1]) opts.fingerprint = argv[++i];
    else if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else return { error: `未知参数：${arg}` };
  }
  return { opts };
}

function printHelp() {
  console.log('独立 HMAC 审计链验签器（单文件 · 零依赖）');
  console.log('');
  console.log('用法：');
  console.log('  node tools/verify/verify-chain.mjs [选项]');
  console.log('');
  console.log('选项：');
  console.log('  --data-dir <dir>     数据根目录（自动定位 <dir>/audit/history.jsonl 与 decision-log.jsonl）');
  console.log('  --history <file>     显式指定 history.jsonl 路径（覆盖自动定位）');
  console.log('  --decision <file>    显式指定 decision-log.jsonl 路径（覆盖自动定位）');
  console.log('  --key <file>         HMAC 密钥文件（缺省 SOFAGENT_KEY_PATH 或 ~/.sofagent-key；缺失则降级仅验 prevHash 链）');
  console.log('  --fingerprint <fp>   环境指纹（缺省按本机环境计算，dataDir 段为空——与引擎写侧默认一致）');
  console.log('  --json               以 JSON 输出（机器消费）');
  console.log('  --selftest           合成 golden vector 自检（零外部依赖，退出 0 = 通过）');
  console.log('  --help, -h           显示帮助');
  console.log('');
  console.log('退出码：0 = 链完整 / 1 = 不可复验·不足·请求的文件缺席 / 2 = 篡改或链头不符');
}

function severityOf(result, explicit) {
  if (result.status === STATUS.absent) return explicit ? 1 : 0;
  return SEVERITY[result.status] != null ? SEVERITY[result.status] : 1;
}

/** 单文件验签结论的情绪化渲染（人类可读） */
function renderResult(result, explicit) {
  const lines = [];
  lines.push(`  文件（${result.kind === 'history' ? '历史链' : '决策链'}）：${result.filePath}`);
  switch (result.status) {
    case STATUS.ok:
      lines.push('    状态：✅ 链完整——所有记录可验证');
      break;
    case STATUS.tampered:
      lines.push(`    状态：❌ 断链（检测到篡改）——条目号 #${result.index ?? '?'}`);
      if (result.expected != null) lines.push(`    期望值：${result.field ?? 'hash'} = ${result.expected}`);
      if (result.actual != null) lines.push(`    实际值：${result.field ?? 'hash'} = ${result.actual}`);
      if (result.detail) lines.push(`    说明：${result.detail}`);
      break;
    case STATUS.headMismatch:
      lines.push(`    状态：❌ 链头不匹配${result.index != null ? `（锚位条目 #${result.index}）` : ''}`);
      if (result.expected != null) lines.push(`    期望值：headHash = ${result.expected}`);
      if (result.actual != null) lines.push(`    实际值：headHash = ${result.actual}`);
      if (result.detail) lines.push(`    说明：${result.detail}`);
      break;
    case STATUS.unverifiable:
      lines.push('    状态：⚠️ 不可复验（密钥轮换或环境指纹漂移，非篡改）');
      if (result.detail) lines.push(`    说明：${result.detail}`);
      break;
    case STATUS.insufficient:
      lines.push('    状态：⚠️ 记录不足 2 条，无法构成可验证的防篡改链');
      if (result.detail) lines.push(`    说明：${result.detail}`);
      break;
    case STATUS.absent:
      lines.push(explicit ? '    状态：⚠️ 文件不存在——无法校验请求的链' : '    状态：ℹ️ 文件不存在——跳过（该链未启用属正常）');
      break;
    default:
      lines.push(`    状态：${result.status}`);
  }
  if (result.kind === 'history' && result.anchor) {
    if (result.anchor.status === 'no-anchor') lines.push('    锚点：无链头锚点文件——尾部截断检测不可用（如实降级）');
    else if (result.anchor.status === STATUS.ok) lines.push('    锚点：链头锚点一致');
  }
  if (result.kind === 'decision' && !result.anchor) {
    lines.push('    锚点：决策链无链头锚点（引擎当前不维护）——仅做链完整性校验，不做尾部截断检测');
  }
  return lines.join('\n');
}

function runCli(opts) {
  const keyInfo = resolveKey(opts.keyPath);
  const fingerprint = opts.fingerprint || computeFingerprint('');

  const targets = [];
  if (opts.history || opts.decision) {
    if (opts.history) targets.push({ kind: 'history', filePath: opts.history, explicit: true });
    if (opts.decision) targets.push({ kind: 'decision', filePath: opts.decision, explicit: true });
  } else {
    const baseDir = opts.dataDir || defaultDataDir();
    targets.push({ kind: 'history', filePath: join(baseDir, 'audit', 'history.jsonl'), explicit: false });
    targets.push({ kind: 'decision', filePath: join(baseDir, 'audit', 'decision-log.jsonl'), explicit: false });
  }

  const results = [];
  for (const t of targets) {
    const anchorPath = t.kind === 'history' ? join(dirname(t.filePath), 'history-chain-head') : '';
    const result = verifyOneFile(t.filePath, t.kind, {
      key: keyInfo.key,
      fingerprint,
      anchorPath,
    });
    result.explicit = t.explicit;
    results.push(result);
  }

  let exitCode = 0;
  for (const r of results) exitCode = Math.max(exitCode, severityOf(r, r.explicit));

  if (opts.json) {
    const payload = {
      key: { path: keyInfo.path, present: keyInfo.present },
      fingerprint,
      fingerprintSource: opts.fingerprint ? 'explicit' : 'computed',
      results: results.map((r) => ({
        kind: r.kind,
        file: r.filePath,
        status: r.status,
        index: r.index,
        field: r.field,
        expected: r.expected,
        actual: r.actual,
        detail: r.detail,
        anchorStatus: r.anchor ? r.anchor.status : null,
      })),
      exitCode,
    };
    console.log(JSON.stringify(payload, null, 2));
    return exitCode;
  }

  console.log('== 独立验签器 verify-chain ==');
  console.log(`密钥：${keyInfo.path}${keyInfo.present ? '（存在，HMAC 强校验）' : '（不存在，降级仅验 prevHash 链）'}`);
  console.log(`指纹：${fingerprint}（来源：${opts.fingerprint ? '显式' : '按本机环境计算'}）`);
  console.log('');
  for (const r of results) console.log(renderResult(r, r.explicit));

  console.log('');
  if (exitCode === 0) console.log('结论：✅ 链完整');
  else if (exitCode === 2) console.log('结论：❌ 检测到篡改或链头不符');
  else console.log('结论：⚠️ 链不可完全复验或记录不足');
  return exitCode;
}

// ════════════════════════════════════════
// --selftest（合成 golden vector 回归）
// ════════════════════════════════════════

function runSelftest() {
  const GOLDEN_KEY = 'golden-vector-key-0123456789abcdef';
  const GOLDEN_FP = 'goldenfp';

  let pass = 0;
  let fail = 0;
  const check = (name, cond, extra) => {
    if (cond) {
      pass++;
      console.log(`  ✅ ${name}`);
    } else {
      fail++;
      console.error(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
    }
  };

  const r1 = {
    ts: '2026-01-01T00:00:00.000Z',
    kind: 'TOOL_GATE',
    agentId: 'engineer',
    sessionId: 'sess-golden',
    moment: 'ACT',
    why: { text: 'golden' },
    engine: 'sofagent-audit',
  };
  const r2 = {
    ts: '2026-01-01T00:00:01.000Z',
    kind: 'TOOL_GATE',
    agentId: 'engineer',
    sessionId: 'sess-golden',
    moment: 'ACT',
    why: { text: 'golden-2' },
    engine: 'sofagent-audit',
  };
  const r3 = {
    ts: '2026-01-01T00:00:02.000Z',
    kind: 'TOOL_GATE',
    agentId: 'engineer',
    sessionId: 'sess-golden',
    moment: 'ACT',
    why: { text: 'golden-3' },
    engine: 'sofagent-audit',
  };

  // 1) golden vector 硬锚（纯计算，不依赖任何文件）
  const e1 = buildEntry(r1, null, GOLDEN_KEY, GOLDEN_FP);
  const p1 = JSON.parse(JSON.stringify(e1));
  const e2 = buildEntry(r2, p1, GOLDEN_KEY, GOLDEN_FP);
  const p2 = JSON.parse(JSON.stringify(e2));
  const e3 = buildEntry(r3, p2, GOLDEN_KEY, GOLDEN_FP);
  check('golden 记录1 hmacSig 常量', e1.hmacSig === '98456bc81aaa8d223784f572fbb0bfd7', e1.hmacSig);
  check('golden 记录2 prevHash 常量', e2.prevHash === '96e6224e71e48b90', e2.prevHash);
  check('golden 记录2 hmacSig 常量', e2.hmacSig === 'e3359bfe1a78c4721f635dfec9d9b177', e2.hmacSig);

  // golden 签名输入串逐字锚（防 stableStringify 排序语义漂移）
  const expectedSigInput =
    '{"agentId":"engineer","engine":"sofagent-audit","envFingerprint":"goldenfp","kind":"TOOL_GATE","moment":"ACT","sessionId":"sess-golden","ts":"2026-01-01T00:00:00.000Z","why":{"text":"golden"}}|goldenfp';
  check('golden 签名输入串逐字一致', stableStringify(omitSigFields(e1)) + '|' + GOLDEN_FP === expectedSigInput);

  // 2) 合成链 → ok
  const ok = verifyChain([e1, e2, e3], { key: GOLDEN_KEY, fingerprint: GOLDEN_FP, subject: '链' });
  check('合成三条链 → ok', ok.status === STATUS.ok, ok.status);

  // 3) 篡改注入（记录2，中间条目）→ 必须红（防「验签器恒真」假绿）
  const tamperedMid = JSON.parse(JSON.stringify(e2));
  tamperedMid.why = { text: '被篡改' };
  const rt = verifyChain([e1, tamperedMid, e3], { key: GOLDEN_KEY, fingerprint: GOLDEN_FP, subject: '链' });
  check('篡改中间记录 → tampered@1', rt.status === STATUS.tampered && rt.index === 1, `${rt.status}@${rt.index}`);
  check('篡改中间记录 → 给出期望值', typeof rt.expected === 'string' && rt.expected.length > 0, String(rt.expected));
  check('篡改中间记录 → 期望值 != 实际值', rt.expected !== rt.actual);

  // 4) 篡改创世条目 → 必须红
  const tamperedGenesis = JSON.parse(JSON.stringify(e1));
  tamperedGenesis.why = { text: '创世被篡改' };
  const rg = verifyChain([tamperedGenesis, e2, e3], { key: GOLDEN_KEY, fingerprint: GOLDEN_FP, subject: '链' });
  check('篡改创世条目 → tampered@0', rg.status === STATUS.tampered && rg.index === 0, `${rg.status}@${rg.index}`);

  // 5) 文件级端到端：写 JSONL → 验签 → 篡改 → 验签（含锚点链路）
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-verify-selftest-'));
  try {
    const filePath = join(dir, 'history.jsonl');
    const writeChain = (entries) => writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    writeChain([e1, e2, e3]);
    const okFile = verifyOneFile(filePath, 'history', {
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
      anchorPath: join(dir, 'absent-anchor'),
    });
    check('文件级合成链 → ok', okFile.status === STATUS.ok, okFile.status);

    // 篡改中间条目（第 2 行）后重写 → 报断链并定位条目号 #1
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const mid = JSON.parse(lines[1]);
    mid.why = { text: '被篡改' };
    lines[1] = JSON.stringify(mid);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    const badFile = verifyOneFile(filePath, 'history', {
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
      anchorPath: join(dir, 'absent-anchor'),
    });
    check('文件级篡改中间条目 → tampered@1', badFile.status === STATUS.tampered && badFile.index === 1, `${badFile.status}@${badFile.index}`);

    // 链头锚点不符 → head-mismatch（重建干净链 + 伪造锚点）
    writeChain([e1, e2, e3]);
    const anchorPath = join(dir, 'history-chain-head');
    writeFileSync(
      anchorPath,
      JSON.stringify({ version: 1, entryCount: 3, headHash: '0000000000000000', envFingerprint: GOLDEN_FP }) + '\n',
      'utf-8',
    );
    const headFile = verifyOneFile(filePath, 'history', {
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
      anchorPath,
    });
    check('伪造链头锚点 → head-mismatch', headFile.status === STATUS.headMismatch, headFile.status);

    // 尾部截断 → head-mismatch（锚点记 3 条、实际 2 条）
    writeChain([e1, e2]);
    const truncFile = verifyOneFile(filePath, 'history', {
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
      anchorPath,
    });
    check('尾部截断 → head-mismatch', truncFile.status === STATUS.headMismatch, truncFile.status);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('');
  console.log(`  --selftest：${pass} 通过 / ${fail} 失败`);
  return fail === 0 ? 0 : 1;
}

// ════════════════════════════════════════
// 入口
// ════════════════════════════════════════

function main(argv) {
  const { opts, error } = parseArgs(argv);
  if (error) {
    console.error(error);
    printHelp();
    return 2;
  }
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.selftest) {
    return runSelftest();
  }
  return runCli(opts);
}

process.exit(main(process.argv.slice(2)));
