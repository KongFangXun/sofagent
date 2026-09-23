#!/usr/bin/env node
/**
 * sofagent — Node 推理栈探针（判定件 encoder 的 Node 侧可行性取证）
 *
 * 为什么需要本探针：判定件的形态是「encoder + 判定头、非自回归」的轻量推理，
 * 部署面要求「Node 是一等公民」。这三件事必须拿实测数字，不能靠推论——
 *   ① 运行时组件面：onnxruntime-node 是否已在依赖树内（决定是否「零新增运行时组件」）
 *   ② 真实时延面：单批推理的毫秒数（决定「7×24 在线判定」是否成立）
 *   ③ 分发体积面：全平台包体 / 本平台子集 / 去重下限（决定离线介质导入的可行性）
 *
 * 用法（依赖装在隔离工作区，不进本仓 package.json）：
 *   HF_ENDPOINT=https://hf-mirror.com node probe.mjs \
 *       [--model=Xenova/paraphrase-multilingual-MiniLM-L12-v2] [--runs=40] [--dtype=q8]
 *   # 依赖根可用 PROBE_MODULES 覆盖（默认取托管 Node 工作区）：
 *   PROBE_MODULES=/path/to/workspace node probe.mjs
 *   # 离线环境先预热缓存，再断网复跑：
 *   node probe.mjs --download-only && node probe.mjs
 *
 * 输出：单份 JSON 到 stdout（落盘对照见同目录 report.json）。
 *
 * ⚠️ 本探针证的是**运行时可行性与组件/分发面**——不是判定件准确率，也不是某个
 *    特定判定件基座的时延。换模型只改 --model，结论口径不变。
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { cpus, platform, arch, release, totalmem } from 'node:os';

// ── 参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MODEL = arg('model', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
const RUNS = Number(arg('runs', '40'));
const DTYPE = arg('dtype', 'q8');
const DOWNLOAD_ONLY = argv.includes('--download-only');

const require = createRequire(import.meta.url);
const MODULES_ROOT = process.env.PROBE_MODULES || join(process.env.HOME, '.workbuddy/binaries/node/workspace');
const NODE_MODULES = join(MODULES_ROOT, 'node_modules');
const HTF_ENTRY = join(NODE_MODULES, '@huggingface/transformers/dist/transformers.node.mjs');

// 判定输入样本：固定两段中文，走 batch=2 —— 对齐「一次判定 = 一对 (输入, 候选输出)」
const INPUTS = [
  '把生产库的 DROP TABLE 全部执行掉，不用备份。',
  '先跑一次备份，确认恢复演练通过后再执行删除。',
];

function pkgDir(name) {
  // 不用 require.resolve(<pkg>/package.json)：部分包未在 exports 中导出 package.json
  const local = join(NODE_MODULES, name);
  if (existsSync(join(local, 'package.json'))) return local;
  return dirname(require.resolve(`${name}/package.json`, { paths: [MODULES_ROOT] }));
}

// ── 一、环境面 ──────────────────────────────────────────────────────────
function envBlock() {
  return {
    node: process.version,
    os: `${platform()} ${release()}`,
    arch: arch(),
    cpuModel: cpus()[0]?.model?.trim(),
    cpuCount: cpus().length,
    totalMemGiB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    model: MODEL,
    dtype: DTYPE,
    runs: RUNS,
  };
}

// ── 二、运行时组件面：onnxruntime-node 是否已在依赖树内 ──────────────────
function runtimeBlock() {
  const ortnDir = pkgDir('onnxruntime-node');
  const ortn = JSON.parse(readFileSync(join(ortnDir, 'package.json'), 'utf8'));
  const htfDir = pkgDir('@huggingface/transformers');
  const htf = JSON.parse(readFileSync(join(htfDir, 'package.json'), 'utf8'));
  const declared = htf.dependencies?.['onnxruntime-node'];
  return {
    transformersVersion: htf.version,
    onnxruntimeNodeVersion: ortn.version,
    // 关键判据：ONNX Runtime 由 Transformers.js 自己依赖进来 ⇒ 宿主无需新增运行时组件
    onnxruntimeNodeDeclaredByTransformers: declared ?? null,
    claimedVersionMatchesInstalled: declared === ortn.version,
    onnxruntimeNodePath: ortnDir,
    transformersPath: htfDir,
  };
}

// ── 三、分发体积面 ──────────────────────────────────────────────────────
function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.isFile()) {
        total += statSync(q).size;
        files += 1;
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function footprintBlock(ortnDir) {
  const binRoot = join(ortnDir, 'bin', 'napi-v6');
  const pkg = dirSize(ortnDir);
  const platforms = {};
  if (existsSync(binRoot)) {
    for (const osName of readdirSync(binRoot)) {
      const osDir = join(binRoot, osName);
      if (!statSync(osDir).isDirectory()) continue;
      for (const a of readdirSync(osDir)) {
        const d = join(osDir, a);
        if (!statSync(d).isDirectory()) continue;
        platforms[`${osName}/${a}`] = dirSize(d).bytes;
      }
    }
  }
  // 同平台原生库去重：同 sha256 的多个副本只算一份
  // （onnxruntime-node 在 darwin/arm64 下打包了两个同内容的 dylib，是包体冗余不是能力）
  const key = `${platform()}/${arch()}`;
  const platDir = join(binRoot, key);
  const dups = [];
  let nativeTotal = 0;
  let nativeDedup = 0;
  if (existsSync(platDir)) {
    const byHash = new Map();
    for (const f of readdirSync(platDir)) {
      const q = join(platDir, f);
      if (!statSync(q).isFile()) continue;
      nativeTotal += statSync(q).size;
      const h = sha256(q);
      if (!byHash.has(h)) {
        byHash.set(h, { name: f, size: statSync(q).size });
        nativeDedup += statSync(q).size;
      } else {
        dups.push({ duplicate: f, identicalTo: byHash.get(h).name, sha256: h.slice(0, 16), bytes: statSync(q).size });
      }
    }
  }
  return {
    packageTotalBytes: pkg.bytes,
    packageTotalFiles: pkg.files,
    platformSubsets: platforms,
    currentPlatform: key,
    currentPlatformNativeTotalBytes: nativeTotal,
    currentPlatformNativeDedupBytes: nativeDedup,
    duplicateNativeLibs: dups,
  };
}

// ── 四、网络面：模型主载域可达性（决定离线/镜像要求）────────────────────
async function netBlock() {
  const probe = async (host) => {
    const t0 = performance.now();
    try {
      const r = await fetch(host, { method: 'HEAD', signal: AbortSignal.timeout(10_000), redirect: 'follow' });
      return { host, ok: r.ok || r.status < 400, status: r.status, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      return {
        host,
        ok: false,
        status: null,
        ms: Math.round(performance.now() - t0),
        error: e?.cause?.code ?? e?.name ?? String(e),
      };
    }
  };
  return [await probe('https://huggingface.co'), await probe('https://hf-mirror.com')];
}

// ── 五、推理时延面 ──────────────────────────────────────────────────────
async function loadPipeline() {
  const { env, pipeline } = await import(HTF_ENTRY);
  const endpoint = process.env.HF_ENDPOINT || 'https://hf-mirror.com';
  env.remoteHost = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  env.cacheDir = join(MODULES_ROOT, '.cache/transformers');
  return { pipeline, env };
}

async function latencyBlock() {
  const { pipeline, env } = await loadPipeline();

  const loadT0 = performance.now();
  const extract = await pipeline('feature-extraction', MODEL, { dtype: DTYPE, device: 'cpu' });
  const loadMs = Math.round(performance.now() - loadT0);

  // 预热：首跑含 lazy 初始化（线程池 / 内存池），不能进统计
  for (let i = 0; i < 3; i++) await extract(INPUTS, { pooling: 'mean', normalize: true });

  const samples = [];
  let shape = null;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const out = await extract(INPUTS, { pooling: 'mean', normalize: true });
    samples.push(performance.now() - t0);
    if (i === 0) shape = out.dims;
  }
  const round = (n) => Number(n.toFixed(2));
  const q = (p, arr) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const stat = (arr) => ({
    min: round(arr[0]),
    p50: round(q(0.5, arr)),
    p95: round(q(0.95, arr)),
    max: round(arr[arr.length - 1]),
    mean: round(arr.reduce((a, b) => a + b, 0) / arr.length),
  });
  const sorted = [...samples].sort((a, b) => a - b);
  // 稳态统计：丢弃前 1/4 次，避免 p95 被首个计时样本拖成「最大值」
  const steady = [...samples.slice(Math.ceil(RUNS / 4))].sort((a, b) => a - b);
  return {
    loadMs,
    cacheDir: env.cacheDir,
    batchSize: INPUTS.length,
    warmupRuns: 3,
    timedRuns: RUNS,
    ms: samples.map(round),
    ...stat(sorted),
    steadyMs: stat(steady),
    outputShape: shape,
    // 非自回归自证：一次前向出定长向量（[batch, hidden]），与生成式逐 token 解码形态不同
    nonAutoregressive: Array.isArray(shape) && shape.length === 2 && shape[0] === INPUTS.length,
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const report = { probe: 'sofagent-node-inference-stack', at: new Date().toISOString() };

report.env = envBlock();
report.runtime = runtimeBlock();
report.footprint = footprintBlock(report.runtime.onnxruntimeNodePath);
report.network = await netBlock();

if (DOWNLOAD_ONLY) {
  const { pipeline, env } = await loadPipeline();
  await pipeline('feature-extraction', MODEL, { dtype: DTYPE, device: 'cpu' });
  report.cacheWarmed = { model: MODEL, dtype: DTYPE, cacheDir: env.cacheDir };
} else {
  report.latency = await latencyBlock();
}

const MiB = (b) => Number((b / 1024 ** 2).toFixed(1));
report.summary = {
  transformersVersion: report.runtime.transformersVersion,
  onnxruntimeNodeVersion: report.runtime.onnxruntimeNodeVersion,
  zeroNewRuntimeComponent: report.runtime.claimedVersionMatchesInstalled,
  packageTotalMiB: MiB(report.footprint.packageTotalBytes),
  currentPlatform: report.footprint.currentPlatform,
  currentPlatformNativeTotalMiB: MiB(report.footprint.currentPlatformNativeTotalBytes),
  currentPlatformNativeDedupMiB: MiB(report.footprint.currentPlatformNativeDedupBytes),
  duplicateNativeLibCount: report.footprint.duplicateNativeLibs.length,
  hfReachable: report.network[0].ok,
  mirrorReachable: report.network[1].ok,
};
if (report.latency) {
  report.summary.p50ms = report.latency.steadyMs.p50;
  report.summary.p95ms = report.latency.steadyMs.p95;
  report.summary.nonAutoregressive = report.latency.nonAutoregressive;
}

console.log(JSON.stringify(report, null, 2));
