// ============================================================
// weights-manifest.ts · 本地权重目录规范（企业专属模型部署）
// ============================================================
//
// 权重目录规范（训练产物 → 注册 → 加载 的物理载体）：
//
//   <weights_dir>/
//   ├── manifest.json          ← 版本清单（本模块读写）
//   ├── v1/
//   │   ├── adapter_model.safetensors   （LoRA adapter / 量化权重）
//   │   ├── adapter_config.json
//   │   └── training_meta.json           （train job 追溯：jobId/dataHash/基座）
//   ├── v2/ ...
//   └── current -> v2          ← 当前版本指针（目录软链或 manifest 字段）
//
// manifest.json 结构：
//   {
//     "schemaVersion": 1,
//     "model": "battery-lora-qwen3-8b",
//     "versions": [
//       { "id": "v1", "createdAt": "...", "sha256": "...", "sizeBytes": 123,
//         "meta": { "trainJobId": "...", "evalScore": 87.5 } },
//       ...
//     ],
//     "current": "v2"
//   }
//
// 完整性校验：注册时校验 manifest 在场 + 当前版本 sha256 与实际文件匹配
// （供应链完整性——复用 v1.4.1 artifact-signing 的哈希纪律，非签名链）。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

/** 版本清单 schema 版本 */
export const WEIGHTS_MANIFEST_SCHEMA_VERSION = 1;

/** 权重版本条目 */
/** 远端来源（F5.3：五环已建，唯一缺口＝从远端拉；本字段补这个缺口） */
export interface RemoteSource {
  /** 拉取地址（http(s):// 或 file://；不可是相对路径） */
  url: string;
  /** 期望 sha256（全值；与拉取内容逐字节比对，不符即拒绝启用） */
  sha256: string;
  /** 期望字节数（可选；给了就一并核对） */
  bytes?: number;
  /**
   * 制品代次号（v1.8.0 §五）：代次号字符串（"V2" / "V2.1" 式——非 semver、
   * 非仓版本号；标注权重制品的代系，回挂旧版代码时按代次判兼容）。
   * 写入时校验：/^^V\d+(\.\d+)?$/ 形态，semver（x.y.z 三段）即拒。
   */
  generation?: string;
  /**
   * 产出锚（v1.8.0 §五）：钉死到 git tag 或 commit hash——
   * 写入时校验："main" / "master" / 空串即拒（浮动分支不可复现）。
   */
  revision?: string;
}

export interface WeightsVersion {
  /** 版本 id（目录名，如 'v1'） */
  id: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 权重文件 sha256（完整性校验依据） */
  sha256: string;
  /** 权重目录总字节数 */
  sizeBytes: number;
  /** 追溯元信息（train job / eval 分数） */
  meta?: { trainJobId?: string; evalScore?: number; baseModel?: string; [k: string]: unknown };
  /** 远端来源（缺省 = 本地投放；有值 = 可从远端拉取并校验） */
  remote?: RemoteSource;
}

/** 版本清单（manifest.json） */
export interface WeightsManifest {
  schemaVersion: number;
  /** 模型名（与注册名对齐） */
  model: string;
  /** 全部版本（按创建时间序） */
  versions: WeightsVersion[];
  /** 当前版本 id */
  current: string;
}

/** 校验/读取结果 */
export interface ManifestCheck {
  ok: boolean;
  issues: string[];
  /** 解析出的清单（ok=true 时非空） */
  manifest?: WeightsManifest;
  /** 当前版本绝对路径（ok=true 时非空） */
  currentPath?: string;
}

/** manifest.json 文件名（权重目录内固定） */
export function manifestPath(weightsDir: string): string {
  return join(weightsDir, 'manifest.json');
}

/**
 * 校验权重目录规范——注册 local-path 模型前的强制检查。
 *
 * 检查项：
 *   一、manifest.json 在场且可解析（schemaVersion=1）
 *   二、versions 非空且 current 指向的版本在列表内
 *   三、当前版本目录在场
 *   四、（verifyHash=true 时）当前版本 sha256 与实际文件匹配
 */
export function checkWeightsDir(weightsDir: string, opts?: { verifyHash?: boolean }): ManifestCheck {
  const mf = manifestPath(weightsDir);
  if (!existsSync(mf)) {
    return { ok: false, issues: [`权重目录缺 manifest.json：${mf}——按目录规范生成版本清单后再注册`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mf, 'utf-8'));
  } catch (err) {
    return { ok: false, issues: [`manifest.json 解析失败：${err instanceof Error ? err.message : String(err)}`] };
  }
  const m = parsed as WeightsManifest;
  if (typeof m !== 'object' || m === null || m.schemaVersion !== WEIGHTS_MANIFEST_SCHEMA_VERSION) {
    return { ok: false, issues: [`manifest.json schemaVersion 非法（期望 ${WEIGHTS_MANIFEST_SCHEMA_VERSION}）`] };
  }
  const blocking: string[] = [];
  if (!Array.isArray(m.versions) || m.versions.length === 0) {
    blocking.push('manifest.versions 为空——至少一个版本才能注册');
  }
  if (typeof m.current !== 'string' || !m.versions.some((v) => v && v.id === m.current)) {
    blocking.push(`manifest.current「${String(m.current)}」不在 versions 列表内`);
  }
  if (blocking.length > 0) return { ok: false, issues: blocking };
  // model 字段可追溯性（非阻断告警——旧清单可能未写；新登记方 appendVersion 会补）
  const issues: string[] = (typeof m.model !== 'string' || m.model.trim() === '')
    ? ['manifest.model 为空（可追溯性弱化）——重新 appendVersion 传入注册名即补全']
    : [];

  const currentPath = join(weightsDir, m.current);
  if (!existsSync(currentPath)) {
    return { ok: false, issues: [`当前版本目录缺失：${currentPath}`] };
  }

  // v1.8.0 §五：remote.generation / revision 校验（纯增量——remote 在场才判）
  for (const v of m.versions) {
    const r = v.remote;
    if (!r) continue;
    if (r.generation !== undefined) {
      // 代次号：V2 / V2.1 式（非 semver、非仓版本号）——semver 三段即拒
      if (!/^V\d+(\.\d+)?$/.test(r.generation) || /^\d+\.\d+\.\d+$/.test(r.generation)) {
        issues.push(`版本 ${v.id} remote.generation「${r.generation}」非法——须为代次号（V2 / V2.1 式，非 semver）`);
      }
    }
    if (r.revision !== undefined) {
      // 产出锚：钉死 tag 或 commit——浮动分支（main/master）与空串即拒
      if (r.revision === '' || r.revision === 'main' || r.revision === 'master') {
        issues.push(`版本 ${v.id} remote.revision「${r.revision}」非法——须钉死 tag 或 commit（取 main 即判不过）`);
      }
    }
  }

  if (opts?.verifyHash) {
    const cur = m.versions.find((v) => v.id === m.current);
    if (cur) {
      const actual = hashDir(currentPath);
      if (actual !== cur.sha256) {
        return { ok: false, issues: [`版本 ${cur.id} 完整性校验失败：manifest sha256=${cur.sha256}，实际=${actual}——权重可能被篡改或损坏`] };
      }
    }
  }

  return { ok: true, issues, manifest: m, currentPath };
}

/** 目录级 sha256（按文件名排序逐文件哈希再汇总——确定性） */
export function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string, prefix: string): void => {
    const entries = readdirSync(d).sort();
    for (const name of entries) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, `${prefix}${name}/`);
      } else {
        h.update(`${prefix}${name}`);
        h.update(readFileSync(full));
      }
    }
  };
  walk(dir, '');
  return h.digest('hex');
}


/**
 * 登记新版本——训练产物落盘后调用（artifact-register 消费面）。
 * 现有 manifest 缺失时初始化（v1 起，model 取参数或空——调用方应传）；
 * 重复 id = 更新条目（幂等）。
 */
export function appendVersion(
  weightsDir: string,
  version: WeightsVersion,
  opts?: { setCurrent?: boolean; model?: string },
): WeightsManifest {
  const mf = manifestPath(weightsDir);
  let m: WeightsManifest;
  if (existsSync(mf)) {
    m = JSON.parse(readFileSync(mf, 'utf-8')) as WeightsManifest;
    const idx = m.versions.findIndex((v) => v.id === version.id);
    if (idx >= 0) m.versions[idx] = version;
    else m.versions.push(version);
    // 已有清单的空 model 可被补写（首个正式登记方传入注册名）
    if ((!m.model || m.model === '') && opts?.model) m.model = opts.model;
  } else {
    m = { schemaVersion: WEIGHTS_MANIFEST_SCHEMA_VERSION, model: opts?.model ?? '', versions: [version], current: version.id };
  }
  if (opts?.setCurrent !== false) m.current = version.id;
  // 延迟 require 防循环依赖（atomicWriteSync 来自 core，此处 fs 已直引）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { atomicWriteSync } = require('@sofagent/core') as { atomicWriteSync: (p: string, data: string) => void };
  atomicWriteSync(mf, JSON.stringify(m, null, 2));
  return m;
}

// v1.8.0 §五：fetchVersion 已迁入 ./weights/weights-fetch.ts（断点续传/重试/
// 进度/白名单在其上补齐）——此处 re-export 保持既有调用面不变（迁移纪律：
// 「移除 Y 先查落点」同规则，f5-weights-remote.test.ts 四条取证不迁不改）。
export { fetchVersion, type FetchResult } from './weights/weights-fetch';
