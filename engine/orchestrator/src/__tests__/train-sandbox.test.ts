// train-sandbox.test.ts · v1.4.3 第三章 测试
//
// 验收标准逐条覆盖：
// - 训练子进程沙箱隔离（无外网 / 只读数据源 / 只写产物目录）
// - 客户机房离线训练可用（spawn env 注入 + 白名单空全拦）
// - 打包脚本语法与产物结构（package-train-runtime.sh bash -n 冒烟）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  createTrainSandbox,
  createTrainPathGuard,
  trainSandboxOutputDir,
} from '../train/train-sandbox';

// ── 测试基建 ──
let dataDir: string;
let datasetDir: string;
let outputDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-sandbox-'));
  datasetDir = join(dataDir, 'datasets', 'inv-v1');
  outputDir = join(dataDir, 'train', 'ent-1', 'job-1', 'output');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ════════════════════════════════════════
// 一、路径守卫（只读数据源 / 只写产物目录）
// ════════════════════════════════════════

describe('createTrainPathGuard 三约束路径判定', () => {
  it('产物目录可写（唯一写白名单——checkpoint/日志落点）', () => {
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir });
    expect(guard.checkAccess(join(outputDir, 'ckpt-100'), 'write')).toBe('write');
    expect(guard.checkAccess(outputDir, 'write')).toBe('write'); // 目录自身
  });

  it('数据集挂载只读（write 拒绝——训练过程不污染源数据）', () => {
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir });
    expect(guard.checkAccess(join(datasetDir, 'train.jsonl'), 'read')).toBe('read');
    expect(guard.checkAccess(join(datasetDir, 'train.jsonl'), 'write')).toBe('deny');
    expect(guard.checkAccess(datasetDir, 'write')).toBe('deny');
  });

  it('模型缓存只读（离线训练的模型来源不可写）', () => {
    const modelCache = join(dataDir, 'models');
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir, modelCacheDir: modelCache });
    expect(guard.checkAccess(join(modelCache, 'Qwen3-8B', 'config.json'), 'read')).toBe('read');
    expect(guard.checkAccess(join(modelCache, 'Qwen3-8B', 'evil.bin'), 'write')).toBe('deny');
  });

  it('白名单外路径 write 拒绝（只写产物目录——工作区其他位置不落盘）', () => {
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir });
    expect(guard.checkAccess(join(dataDir, 'elsewhere.txt'), 'write')).toBe('deny');
    expect(guard.checkAccess('/tmp/escape.txt', 'write')).toBe('deny');
  });

  it('tempDir 显式配置后可写（训练框架 tmp 落点）', () => {
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir, tempDir: join(dataDir, 'tmp') });
    expect(guard.checkAccess(join(dataDir, 'tmp', 'frame-cache'), 'write')).toBe('write');
  });

  it('路径逃逸防御（../ 构造不越界——resolve 归一化）', () => {
    const guard = createTrainPathGuard({ dataMounts: [datasetDir], outputDir });
    expect(guard.checkAccess(join(outputDir, '..', '..', 'escape'), 'write')).toBe('deny');
  });
});

// ════════════════════════════════════════
// 二、网络隔离（无外网 + 白名单放行）
// ════════════════════════════════════════

describe('createTrainSandbox 训练沙箱会话', () => {
  it('无白名单时出网全拦（默认拦截——离线训练形态）', () => {
    const sandbox = createTrainSandbox({ dataMounts: [datasetDir], outputDir });
    expect(sandbox.checkNetworkEgress('github.com', 443)).toBe('deny');
    expect(sandbox.checkNetworkEgress('pypi.org', 443)).toBe('deny');
    expect(sandbox.checkNetworkEgress('example.com', 80)).toBe('deny');
  });

  it('白名单域名放行（模型下载镜像等——按需放行）', () => {
    const sandbox = createTrainSandbox({
      dataMounts: [datasetDir],
      outputDir,
      networkAllowlist: ['mirror.internal.example.com', '.hf-mirror.com'],
    });
    expect(sandbox.checkNetworkEgress('mirror.internal.example.com', 443)).toBe('allow');
    expect(sandbox.checkNetworkEgress('abc.hf-mirror.com', 443)).toBe('allow'); // 后缀通配
    expect(sandbox.checkNetworkEgress('github.com', 443)).toBe('deny'); // 白名单外仍拒
  });

  it('deny 事件可导出（审计出口——reward hacking 出网尝试留痕）', () => {
    const sandbox = createTrainSandbox({ dataMounts: [datasetDir], outputDir });
    sandbox.checkNetworkEgress('raw.githubusercontent.com', 443); // wget 抓参考实现
    sandbox.checkNetworkEgress('pypi.org', 443); // pip 拉含答案的包
    const events = sandbox.exportDenyEvents();
    expect(events.length).toBe(2);
    expect(events[0]!.reason).toContain('raw.githubusercontent.com');
  });

  it('buildSpawnEnv：代理黑洞注入 + 白名单 NO_PROXY + 沙箱标记', () => {
    const sandbox = createTrainSandbox({
      dataMounts: [datasetDir],
      outputDir,
      networkAllowlist: ['mirror.internal.example.com'],
    });
    const env = sandbox.buildSpawnEnv({ PATH: '/usr/bin' });
    // 代理黑洞（软拦截面——Python fetch 生态默认尊重）
    expect(env.HTTPS_PROXY).toBe('http://255.255.255.255:1');
    expect(env.https_proxy).toBe('http://255.255.255.255:1');
    expect(env.HTTP_PROXY).toBe('http://255.255.255.255:1');
    // 白名单走 NO_PROXY 直连
    expect(env.NO_PROXY).toBe('mirror.internal.example.com');
    // 沙箱标记（训练框架/审计可读）
    expect(env.SOFAGENT_TRAIN_SANDBOX).toBe('1');
    // 原 env 保留
    expect(env.PATH).toBe('/usr/bin');
  });

  it('profile 画像（审计摘要——三约束参数面可读）', () => {
    const sandbox = createTrainSandbox({
      dataMounts: [datasetDir],
      outputDir,
      modelCacheDir: join(dataDir, 'models'),
      networkAllowlist: ['a.example.com'],
    });
    expect(sandbox.profile.dataMounts).toEqual([datasetDir]);
    expect(sandbox.profile.outputDir).toBe(outputDir);
    expect(sandbox.profile.modelCacheDir).toBe(join(dataDir, 'models'));
    expect(sandbox.profile.networkAllowlist).toEqual(['a.example.com']);
  });

  it('trainSandboxOutputDir：job 目录下 output/（与 train-job 缺省对齐）', () => {
    expect(trainSandboxOutputDir('/data/train/ent-1/job-1')).toBe(
      join('/data/train/ent-1/job-1', 'output'),
    );
  });
});

// ════════════════════════════════════════
// 三、打包脚本冒烟（bash -n 语法 + 结构自检）
// ════════════════════════════════════════

describe('package-train-runtime.sh 打包脚本', () => {
  // __tests__ → src → orchestrator → engine → 仓库根
  const scriptPath = join(__dirname, '..', '..', '..', '..', 'tools', 'train', 'package-train-runtime.sh');

  it('bash -n 语法检查通过', () => {
    expect(() => execFileSync('bash', ['-n', scriptPath])).not.toThrow();
  });

  it('脚本含三段核心内容（setup 入口 / 离线说明 / 数据主权）', () => {
    const content = execFileSync('cat', [scriptPath], { encoding: 'utf-8' });
    expect(content).toContain('setup.sh');
    expect(content).toContain('train-env-init.sh');
    expect(content).toContain('post-training');
    expect(content).toContain('--with-models');
  });
});
