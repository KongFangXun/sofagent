// artifact-signing.test.ts · v1.4.1 块六 测试
//
// 验收标准逐条覆盖：
// - 签名生成：多文件 manifest 结构 + fingerprint 关联字段 + 0600 权限
// - 篡改检测：改产物一个字节 → verify 报 tampered；删文件 → 报 missing；加未登记文件 → 报 unregistered
// - manifest 本身篡改：改 manifest 内容 → manifestTampered 单独归类；环境指纹漂移 → unverifiable
// - 加载阻断语义：ok=false 时结构含明确拒绝原因（rejectionReason）+ artifact_tampered 审计事件已写入（读 audit.jsonl 断言）
// - 无指纹拒绝生成 manifest（宁缺毋滥——校验链 input→output 必须闭合）
// - 大文件流式：>2MB 文件签名正常（实现已确认为 createReadStream 1MB 分块流式——hashArtifactFile）
//
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key
// （对齐 train-audit.test / train-fingerprint.test 同款纪律）。
// A2 纪律：测试值全部中性占位（企业/任务/文件内容均为无语义占位串，无密钥字面量）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  signArtifacts,
  loadArtifactManifest,
  artifactManifestPath,
  hashArtifactFile,
  ArtifactSigningError,
  type ArtifactManifest,
} from '../train/artifact-signing';
import {
  verifyArtifacts,
  verifyManifestIntegrity,
  type ArtifactVerifyReport,
} from '../train/artifact-verify';
import {
  freezeTrainFingerprint,
  trainFingerprintPath,
  type EnvSnapshot,
  type TrainFingerprint,
} from '../train/train-fingerprint';
import { readTrainAudit, type TrainAuditEntry } from '../train/train-audit';
import { trainJobDir } from '../train/train-job';

// ── 测试基建 ──
const ENT = 'ent-alpha';

let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-artifact-'));
  // 临时 HMAC 密钥（隔离真实密钥——与兄弟测试同款纪律）
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-artifact-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 基线环境快照（块一 train-env 报告字段引用——冻结指纹的入参） */
function baseEnvSnapshot(): EnvSnapshot {
  return {
    branch: 'cuda-ready',
    gpuName: '占位GPU',
    frameworkName: 'verl',
    frameworkVersion: '0.4.1',
    checkedAt: '2026-08-15T10:00:00.000Z',
  };
}

/** 在 job 目录下铺产物文件（自动建 output/ checkpoints/ 父目录） */
function makeJobArtifacts(jobId: string, files: Record<string, string | Buffer>): string {
  const jobDir = trainJobDir(dataDir, ENT, jobId);
  mkdirSync(jobDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = join(jobDir, rel);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return jobDir;
}

/** 冻结训练指纹（signArtifacts 的前置条件——返回指纹供关联字段断言） */
function freezeFp(jobId: string): TrainFingerprint {
  const datasetDir = join(dataDir, 'dataset-v1');
  mkdirSync(datasetDir, { recursive: true });
  writeFileSync(join(datasetDir, 'part-1.jsonl'), '数据行A', 'utf-8');
  return freezeTrainFingerprint({
    dataDir,
    enterpriseId: ENT,
    trainJobId: jobId,
    datasetDir,
    envSnapshot: baseEnvSnapshot(),
    hyperparams: { lr: 0.0002, epochs: 3 },
    randomSeed: 42,
    timestamp: '2026-08-15T10:30:00.000Z',
  });
}

/** 签名快捷方式（注入固定 createdAt——断言确定性） */
function sign(jobId: string): Promise<ArtifactManifest> {
  return signArtifacts({
    dataDir,
    enterpriseId: ENT,
    trainJobId: jobId,
    createdAt: '2026-08-15T11:00:00.000Z',
  });
}

/** 校验快捷方式 */
function verify(jobId: string, dataSourceHash?: string): Promise<ArtifactVerifyReport> {
  return verifyArtifacts({ dataDir, enterpriseId: ENT, trainJobId: jobId, dataSourceHash });
}

/** 读 job 的 artifact_tampered 审计事件（audit.jsonl 落盘断言） */
function tamperAuditEvents(jobId: string): TrainAuditEntry[] {
  return readTrainAudit(dataDir, ENT, jobId).filter((e) => e.type === 'artifact_tampered');
}

/** 测试侧独立复算 sha256（与实现输出互证） */
function sha256Of(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** 铺一个「已签名」的最小现场（多数校验用例的公共前置） */
async function signedJob(
  jobId: string,
  files: Record<string, string> = { 'output/adapter.safetensors': 'AAAA', 'output/tokenizer.json': 'BBBB' },
): Promise<void> {
  makeJobArtifacts(jobId, files);
  freezeFp(jobId);
  await sign(jobId);
}

// ════════════════════════════════════════
// 一、签名生成（多文件结构 + 指纹关联 + 权限）
// ════════════════════════════════════════

describe('签名生成', () => {
  it('test_signArtifacts_多文件产物_逐文件签名落盘', async () => {
    const jobId = 'job-sign-001';
    makeJobArtifacts(jobId, {
      'output/tokenizer.json': '词表内容占位',
      'output/adapter.safetensors': '权重字节流占位',
      'checkpoints/step-100.bin': '存档字节流占位',
    });
    const fingerprint = freezeFp(jobId);
    const manifest = await sign(jobId);

    // 顶层结构逐字段
    expect(manifest.schemaVersion).toBe('v1');
    expect(manifest.trainJobId).toBe(jobId);
    expect(manifest.enterpriseId).toBe(ENT);
    expect(manifest.createdAt).toBe('2026-08-15T11:00:00.000Z'); // 注入值被采用
    expect(manifest.manifestHmac).toHaveLength(32); // HMAC slice(0,32)
    expect(manifest.hmacAlgo).toBe('stable');
    expect(typeof manifest.envFingerprint).toBe('string');
    expect(manifest.envFingerprint.length).toBeGreaterThan(0);

    // 指纹关联字段（input↔output 双向可溯的锚点）
    expect(manifest.fingerprintHmac).toBe(fingerprint.hmac);
    expect(manifest.fingerprintFile).toBe('train-fingerprint.json');

    // 逐文件签名（确定性顺序：output 先于 checkpoints，目录内按文件名排序）
    expect(manifest.files.map((f) => f.path)).toEqual([
      'output/adapter.safetensors',
      'output/tokenizer.json',
      'checkpoints/step-100.bin',
    ]);
    const entry = manifest.files[0]!;
    expect(entry.sizeBytes).toBe(Buffer.byteLength('权重字节流占位', 'utf-8'));
    expect(entry.sha256).toBe(sha256Of('权重字节流占位')); // 与测试侧独立复算互证

    // 落盘回读等价
    const persisted = loadArtifactManifest(dataDir, ENT, jobId);
    expect(persisted?.manifestHmac).toBe(manifest.manifestHmac);
    expect(persisted?.files).toEqual(manifest.files);

    // 扫描范围只含 output/ + checkpoints/（指纹文件本身不进清单）
    expect(
      manifest.files.every(
        (f) => f.path.startsWith('output/') || f.path.startsWith('checkpoints/'),
      ),
    ).toBe(true);
  });

  it('test_signArtifacts_manifest落盘_权限0600', async () => {
    await signedJob('job-perm-001', { 'output/adapter.safetensors': '权重占位' });
    const mode =
      statSync(artifactManifestPath(dataDir, ENT, 'job-perm-001')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('test_signArtifacts_无指纹_拒绝生成manifest', async () => {
    // 有产物但未冻结指纹——宁缺毋滥：无指纹的产物不做完整性背书
    makeJobArtifacts('job-nofp-001', { 'output/adapter.safetensors': '权重占位' });
    await expect(sign('job-nofp-001')).rejects.toThrow(ArtifactSigningError);
    await expect(sign('job-nofp-001')).rejects.toThrow(/指纹/);
    // 未落任何 manifest（不产生无背书清单）
    expect(existsSync(artifactManifestPath(dataDir, ENT, 'job-nofp-001'))).toBe(false);
  });

  it('test_signArtifacts_无产物文件_拒绝签名', async () => {
    makeJobArtifacts('job-empty-001', {}); // job 目录存在但无产物
    freezeFp('job-empty-001');
    await expect(sign('job-empty-001')).rejects.toThrow(/无产物/);
  });

  it('test_signArtifacts_manifest已存在_拒绝重签（签名冻结不可变）', async () => {
    await signedJob('job-resign-001', { 'output/adapter.safetensors': '权重占位' });
    // 第二次签名（即使产物未变）→ 拒绝：产物变动应由 verify 暴露而非重签覆盖
    await expect(sign('job-resign-001')).rejects.toThrow(/冻结/);
  });

  it('test_loadArtifactManifest_缺失或损坏_返回null', () => {
    // 不存在 → null
    expect(loadArtifactManifest(dataDir, ENT, 'job-load-001')).toBeNull();
    // 坏 JSON → null
    makeJobArtifacts('job-load-002', {});
    writeFileSync(artifactManifestPath(dataDir, ENT, 'job-load-002'), '{坏json', 'utf-8');
    expect(loadArtifactManifest(dataDir, ENT, 'job-load-002')).toBeNull();
    // schema 缺链字段（无 manifestHmac）→ null
    writeFileSync(
      artifactManifestPath(dataDir, ENT, 'job-load-002'),
      JSON.stringify({ schemaVersion: 'v1', trainJobId: 'job-load-002' }),
      'utf-8',
    );
    expect(loadArtifactManifest(dataDir, ENT, 'job-load-002')).toBeNull();
  });

  it('test_hashArtifactFile_文件不存在_unknown占位', async () => {
    const result = await hashArtifactFile(join(dataDir, 'no-such-file.bin'));
    expect(result.sha256).toBe('unknown');
    expect(result.sizeBytes).toBe(0);
  });

  it('test_signArtifacts_大于2MB文件_流式签名校验正常', async () => {
    // 3MB（> 2MB 阈值）——实现为 createReadStream 1MB 分块流式（内存安全），此处验证正确性
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    // 打散常数块（模拟真实权重非常数字节流）
    for (let i = 0; i < big.length; i += 4096) {
      big[i] = (i / 4096) % 251;
    }
    const jobId = 'job-large-001';
    makeJobArtifacts(jobId, { 'output/adapter-large.safetensors': big });
    freezeFp(jobId);
    const manifest = await sign(jobId);

    const entry = manifest.files.find((f) => f.path === 'output/adapter-large.safetensors')!;
    expect(entry.sizeBytes).toBe(3 * 1024 * 1024);
    expect(entry.sha256).toBe(createHash('sha256').update(big).digest('hex'));
    // 大文件校验同样通过
    const report = await verify(jobId);
    expect(report.ok).toBe(true);
  });
});

// ════════════════════════════════════════
// 二、篡改检测（改一字节 / 删文件 / 加未登记）
// ════════════════════════════════════════

describe('篡改检测', () => {
  it('test_verifyArtifacts_改产物一字节_报tampered并写审计', async () => {
    const jobId = 'job-tamper-001';
    await signedJob(jobId);
    // 篡改：同长度换内容（只动内容不动大小——sha256 必变，size 前置信号不触发）
    writeFileSync(
      join(trainJobDir(dataDir, ENT, jobId), 'output/adapter.safetensors'),
      'AAXA',
      'utf-8',
    );

    const dataSourceHash = 'c'.repeat(64);
    const report = await verify(jobId, dataSourceHash);
    expect(report.ok).toBe(false);
    expect(report.manifestIntegrity).toBe('valid');
    expect(report.tampered).toEqual(['output/adapter.safetensors']);
    expect(report.missing).toEqual([]);
    expect(report.unregistered).toEqual([]);

    // 逐文件明细：被改文件 tampered，其余 ok
    const statusByPath = new Map(report.files.map((f) => [f.path, f.status] as const));
    expect(statusByPath.get('output/adapter.safetensors')).toBe('tampered');
    expect(statusByPath.get('output/tokenizer.json')).toBe('ok');

    // 加载阻断语义：明确拒绝原因（调用方直接展示给人）
    expect(report.rejectionReason).toMatch(/拒绝挂载/);
    expect(report.rejectionReason).toMatch(/篡改/);

    // 审计：artifact_tampered 已写入 audit.jsonl
    const events = tamperAuditEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]!.enterpriseId).toBe(ENT); // 块四隔离：审计强制携带企业标识
    expect(events[0]!.dataSourceHash).toBe(dataSourceHash);
    expect(events[0]!.reason).toMatch(/篡改/);
    // 受影响文件清单复用 rollback.quarantined 承载
    expect(events[0]!.rollback?.quarantined).toContain('output/adapter.safetensors');
  });

  it('test_verifyArtifacts_删登记文件_报missing并拒绝挂载', async () => {
    const jobId = 'job-missing-001';
    await signedJob(jobId);
    rmSync(join(trainJobDir(dataDir, ENT, jobId), 'output/tokenizer.json'));

    const report = await verify(jobId);
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['output/tokenizer.json']);
    expect(report.tampered).toEqual([]);
    // missing 时实测值为 null（现场无文件）
    const missingCheck = report.files.find((f) => f.path === 'output/tokenizer.json')!;
    expect(missingCheck.status).toBe('missing');
    expect(missingCheck.actual).toBeNull();
    expect(report.rejectionReason).toMatch(/拒绝挂载/);
    expect(report.rejectionReason).toMatch(/缺失/);
    expect(tamperAuditEvents(jobId)).toHaveLength(1);
  });

  it('test_verifyArtifacts_塞未登记文件_报unregistered并拒绝挂载', async () => {
    const jobId = 'job-unreg-001';
    await signedJob(jobId);
    // 产物目录被塞东西——现场存在但 manifest 未登记
    writeFileSync(
      join(trainJobDir(dataDir, ENT, jobId), 'output/extra-injected.bin'),
      '注入内容占位',
      'utf-8',
    );

    const report = await verify(jobId);
    expect(report.ok).toBe(false);
    expect(report.unregistered).toEqual(['output/extra-injected.bin']);
    // 已登记文件本身全 ok（只多不少不误报篡改）
    expect(report.files.every((f) => f.status === 'ok')).toBe(true);
    expect(report.rejectionReason).toMatch(/未登记/);
    const events = tamperAuditEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]!.rollback?.quarantined).toContain('output/extra-injected.bin');
  });
});

// ════════════════════════════════════════
// 三、manifest 本身篡改（manifestTampered / unverifiable 单独归类）
// ════════════════════════════════════════

describe('manifest 本身篡改', () => {
  it('test_verifyArtifacts_改manifest登记内容_manifestTampered单独归类', async () => {
    const jobId = 'job-mtamper-001';
    await signedJob(jobId);

    // 攻击场景：改产物后同步改 manifest 登记的 sha256（企图让清单与现场一致）
    // —— 但无法伪造 HMAC → manifest 整体签名失配
    const manifestFile = artifactManifestPath(dataDir, ENT, jobId);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8')) as ArtifactManifest;
    const forged = manifest.files[0]!.sha256.startsWith('f')
      ? `0${manifest.files[0]!.sha256.slice(1)}`
      : `f${manifest.files[0]!.sha256.slice(1)}`;
    manifest.files[0]!.sha256 = forged;
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');

    const report = await verify(jobId);
    expect(report.ok).toBe(false);
    // 单独归类：攻击校验基准（manifest）≠ 攻击产物（files）
    expect(report.manifestIntegrity).toBe('manifestTampered');
    // 基准不可信时不做清单内比对（比对无意义）
    expect(report.files).toEqual([]);
    expect(report.tampered).toEqual([]);
    expect(report.rejectionReason).toMatch(/拒绝挂载/);
    // 审计留痕
    const events = tamperAuditEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toMatch(/manifest HMAC 失配/);
  });

  it('test_verifyManifestIntegrity_未篡改_valid', async () => {
    const jobId = 'job-integ-ok-001';
    await signedJob(jobId, { 'output/adapter.safetensors': '权重占位' });
    const manifest = loadArtifactManifest(dataDir, ENT, jobId);
    expect(manifest).not.toBeNull();
    const result = verifyManifestIntegrity(manifest!, dataDir);
    expect(result.integrity).toBe('valid');
  });

  it('test_verifyManifestIntegrity_环境指纹漂移_unverifiable', async () => {
    const jobId = 'job-integ-drift-001';
    await signedJob(jobId, { 'output/adapter.safetensors': '权重占位' });
    const manifest = loadArtifactManifest(dataDir, ENT, jobId);
    // 模拟换机器/密钥轮换后读到旧 manifest（envFingerprint 与当前环境不符）
    const drifted: ArtifactManifest = { ...manifest!, envFingerprint: 'drifted-env-fp' };
    const result = verifyManifestIntegrity(drifted, dataDir);
    expect(result.integrity).toBe('unverifiable');
    expect(result.detail).toMatch(/环境指纹漂移/);
  });

  it('test_verifyArtifacts_环境指纹漂移_保守拒绝挂载', async () => {
    const jobId = 'job-drift-001';
    await signedJob(jobId, { 'output/adapter.safetensors': '权重占位' });
    // 改 manifest 文件内 envFingerprint 字段（保持 schema 合法——漂移而非损坏）
    const manifestFile = artifactManifestPath(dataDir, ENT, jobId);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8')) as ArtifactManifest;
    manifest.envFingerprint = 'drifted-env-fp';
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');

    const report = await verify(jobId);
    expect(report.ok).toBe(false);
    expect(report.manifestIntegrity).toBe('unverifiable');
    // 保守拒绝语义：无法证明产物完整 → 同样不得挂载
    expect(report.rejectionReason).toMatch(/保守拒绝/);
    expect(tamperAuditEvents(jobId)).toHaveLength(1);
  });
});

// ════════════════════════════════════════
// 四、加载阻断语义（无清单 / 坏清单 / 全通过 / 指纹关联断裂）
// ════════════════════════════════════════

describe('加载阻断语义', () => {
  it('test_verifyArtifacts_无manifest_拒绝挂载并写审计', async () => {
    // 产物存在但从未签名（或签名后被删）
    makeJobArtifacts('job-nomani-001', { 'output/adapter.safetensors': '权重占位' });
    const report = await verify('job-nomani-001');
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toMatch(/拒绝挂载/);
    expect(report.rejectionReason).toMatch(/不存在/);
    expect(tamperAuditEvents('job-nomani-001')).toHaveLength(1);
  });

  it('test_verifyArtifacts_manifest解析失败_拒绝挂载并写审计', async () => {
    makeJobArtifacts('job-badmani-001', { 'output/adapter.safetensors': '权重占位' });
    writeFileSync(artifactManifestPath(dataDir, ENT, 'job-badmani-001'), 'not-json', 'utf-8');
    const report = await verify('job-badmani-001');
    expect(report.ok).toBe(false);
    expect(report.rejectionReason).toMatch(/解析失败/);
    expect(report.manifestIntegrity).toBe('manifestTampered');
    expect(tamperAuditEvents('job-badmani-001')).toHaveLength(1);
  });

  it('test_verifyArtifacts_全匹配指纹关联_ok通过且无审计', async () => {
    const jobId = 'job-ok-001';
    await signedJob(jobId);
    const report = await verify(jobId);
    expect(report.ok).toBe(true);
    expect(report.manifestIntegrity).toBe('valid');
    expect(report.fingerprintLinked).toBe(true);
    expect(report.files.every((f) => f.status === 'ok')).toBe(true);
    expect(report.tampered).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.unregistered).toEqual([]);
    // ok=true 无拒绝原因
    expect(report.rejectionReason).toBeNull();
    expect(report.detail).toMatch(/产物完整/);
    // 无异常不写审计（不产生噪音事件）
    expect(tamperAuditEvents(jobId)).toHaveLength(0);
  });

  it('test_verifyArtifacts_指纹关联断裂_okfalse并拒绝挂载', async () => {
    const jobId = 'job-fplink-001';
    await signedJob(jobId);
    // 删指纹文件 → manifest.fingerprintHmac 失去对端 → 校验链 input→output 断裂
    rmSync(trainFingerprintPath(dataDir, ENT, jobId));

    const report = await verify(jobId);
    expect(report.ok).toBe(false);
    expect(report.fingerprintLinked).toBe(false);
    // 产物文件本身全匹配（断裂只影响关联判定，不误报篡改）
    expect(report.files.every((f) => f.status === 'ok')).toBe(true);
    expect(report.rejectionReason).toMatch(/指纹关联断裂/);
    expect(tamperAuditEvents(jobId)).toHaveLength(1);
  });
});
