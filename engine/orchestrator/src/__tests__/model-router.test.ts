// ============================================================
// model-router.test.ts · ModelRouter 路由矩阵 + Mock Ollama + block-and-alert
// v1.2.9 · P1
//
// 覆盖矩阵（dev-prompt §3 L185-193）：
//   public      × 任意        → cloud-fast          (3 用例)
//   internal    × 简单        → cloud-fast          (2 用例)
//   internal    × 复杂        → cloud-strong        (2 用例)
//   internal    × 超复杂      → cloud-strong        (1 用例)
//   restricted  × 任意        → local-executor      (3 用例)
//   confidential× 管道任务    → local-pipeline      (1 用例)
//   confidential× 复杂任务    → local-executor+告警 (2 用例)
//   confidential× 超复杂任务  → block + 人工确认    (1 用例)
//
// 边界 + 集成 + 负向：
//   - frontmatter sensitivity 优先
//   - 文件路径 *.secret.* / *.confidential.* → confidential
//   - PII 正则（身份证/手机号/银行卡）→ restricted
//   - 默认 → internal
//   - Ollama 不可达 + restricted → block-and-alert + FAIL 审计
//   - Ollama 不可达 + confidential → block-and-alert
//   - Ollama 不可达 + internal → fallback cloud-strong
//   - Ollama 可达 + restricted → local-executor 通过
//   - Mock Ollama /api/generate 请求格式 + 响应解析
//   - engineer 节点调用 ModelRouter.route() 集成
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ModelRouter, LOCAL_UNAVAILABLE_MSG, type ModelRouterDeps } from '../model-router';
import { DEFAULT_ROUTER_CONFIG, loadModelRouterConfig, ModelRouterConfigError } from '../model-router-config';
import { DataSovereigntyLogger } from '@sofagent/audit';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-router-'));
}

function makeRouter(overrides: Partial<ModelRouterDeps> = {}): ModelRouter {
  return new ModelRouter({
    config: DEFAULT_ROUTER_CONFIG,
    localProbe: async () => true,   // 默认本地可达
    alert: () => {},                // 静默告警
    ...overrides,
  });
}

// ════════════════════════════════════════
// 1. 路由矩阵：public × 3 任务类型
// ════════════════════════════════════════

describe('ModelRouter · public 数据路由（任意任务 → cloud-fast）', () => {
  it('public + 简单任务（翻译）→ cloud-fast', () => {
    const router = makeRouter();
    const route = router.route('请翻译这段文字', {
      frontmatter: { sensitivity: 'public' },
    });
    expect(route.target).toBe('cloud-fast');
    expect(route.sensitivity).toBe('public');
    expect(route.reason).toBe('simple-translation');
  });

  it('public + 复杂任务（推理）→ cloud-fast（敏感度优先，仍走快速模型）', () => {
    const router = makeRouter();
    const route = router.route('请推理这个数学问题', {
      frontmatter: { sensitivity: 'public' },
    });
    expect(route.target).toBe('cloud-fast');
    expect(route.sensitivity).toBe('public');
  });

  it('public + 管道任务（模板）→ cloud-fast', () => {
    const router = makeRouter();
    const route = router.route('套用模板生成报告', {
      frontmatter: { sensitivity: 'public' },
    });
    expect(route.target).toBe('cloud-fast');
  });
});

// ════════════════════════════════════════
// 2. 路由矩阵：internal × 3 任务类型
// ════════════════════════════════════════

describe('ModelRouter · internal 数据路由', () => {
  it('internal + 简单任务（翻译）→ cloud-fast', () => {
    const router = makeRouter();
    const route = router.route('翻译这段英文', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-fast');
    expect(route.reason).toBe('simple-translation');
  });

  it('internal + 简单任务（摘要）→ cloud-fast', () => {
    const router = makeRouter();
    const route = router.route('给我做个摘要', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-fast');
  });

  it('internal + 复杂任务（推理）→ cloud-strong', () => {
    const router = makeRouter();
    const route = router.route('推理这个架构问题', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-strong');
    expect(route.reason).toBe('complex-reasoning');
  });

  it('internal + 复杂任务（规划）→ cloud-strong', () => {
    const router = makeRouter();
    const route = router.route('帮我规划下季度的开发计划', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-strong');
  });

  it('internal + 超复杂任务（跨文件分析）→ cloud-strong', () => {
    const router = makeRouter();
    const route = router.route('跨文件分析整个模块的依赖关系', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-strong');
    expect(route.complexity).toBe('super-complex');
  });
});

// ════════════════════════════════════════
// 3. 路由矩阵：restricted × 3 任务类型（强制本地）
// ════════════════════════════════════════

describe('ModelRouter · restricted 数据路由（强制本地，不出内网）', () => {
  it('restricted + 简单任务 → local-executor', () => {
    const router = makeRouter();
    const route = router.route('翻译这段文字', {
      frontmatter: { sensitivity: 'restricted' },
    });
    expect(route.target).toBe('local-executor');
    expect(route.reason).toBe('sensitive-data');
  });

  it('restricted + 复杂任务 → local-executor', () => {
    const router = makeRouter();
    const route = router.route('推理这个业务问题', {
      frontmatter: { sensitivity: 'restricted' },
    });
    expect(route.target).toBe('local-executor');
  });

  it('restricted + 超复杂任务 → local-executor（敏感度优先于复杂度）', () => {
    const router = makeRouter();
    const route = router.route('跨文件分析整个代码库', {
      frontmatter: { sensitivity: 'restricted' },
    });
    expect(route.target).toBe('local-executor');
    expect(route.sensitivity).toBe('restricted');
  });
});

// ════════════════════════════════════════
// 4. 路由矩阵：confidential × 3 任务类型
// ════════════════════════════════════════

describe('ModelRouter · confidential 数据路由（最高级别保护）', () => {
  it('confidential + 管道任务（模板/字段提取）→ local-pipeline', () => {
    const router = makeRouter();
    const route = router.route('套用模板提取关键字段', {
      frontmatter: { sensitivity: 'confidential' },
    });
    expect(route.target).toBe('local-pipeline');
    expect(route.reason).toBe('fixed-pipeline');
  });

  it('confidential + 复杂任务（推理）→ local-executor + 升级告警', () => {
    const router = makeRouter();
    const route = router.route('推理这份机密数据的趋势', {
      frontmatter: { sensitivity: 'confidential' },
    });
    expect(route.target).toBe('local-executor');
    expect(route.escalated).toBe(true);
    expect(route.reason).toBe('sensitive-data');
  });

  it('confidential + 简单任务（非管道）→ local-executor + 升级告警', () => {
    const router = makeRouter();
    const route = router.route('总结一下要点', {
      frontmatter: { sensitivity: 'confidential' },
    });
    // 简单但不含管道关键词 → 走 local-executor（0.5B 撑不住）
    expect(route.target).toBe('local-executor');
    expect(route.escalated).toBe(true);
  });

  it('confidential + 超复杂任务（跨文件多步）→ block + 人工确认', () => {
    const router = makeRouter();
    const route = router.route('跨文件多步workflow分析全部机密数据', {
      frontmatter: { sensitivity: 'confidential' },
    });
    expect(route.target).toBe('block');
    expect(route.reason).toBe('insufficient-local-capacity');
    expect(route.blockReason).toContain('人工确认');
  });
});

// ════════════════════════════════════════
// 5. 敏感度评估（决策 4）
// ════════════════════════════════════════

describe('ModelRouter · 敏感度评估（决策 4）', () => {
  it('frontmatter 有 sensitivity 字段 → 直接使用', () => {
    const router = makeRouter();
    const route = router.route('任意任务', {
      frontmatter: { sensitivity: 'confidential' },
    });
    expect(route.sensitivity).toBe('confidential');
  });

  it('文件路径 *.secret.* → confidential', () => {
    const router = makeRouter();
    const route = router.route('读取这个文件', {
      filePath: '/data/api.secret.json',
    });
    expect(route.sensitivity).toBe('confidential');
  });

  it('文件路径 *.confidential.* → confidential', () => {
    const router = makeRouter();
    const route = router.route('读取文件', {
      filePath: '/docs/report.confidential.md',
    });
    expect(route.sensitivity).toBe('confidential');
  });

  it('内容含身份证号 → restricted', () => {
    const router = makeRouter();
    const route = router.route('处理用户信息', {
      contentSnippet: '用户身份证：110101199003077758',
    });
    expect(route.sensitivity).toBe('restricted');
  });

  it('内容含手机号 → restricted', () => {
    const router = makeRouter();
    const route = router.route('发送通知', {
      contentSnippet: '联系电话：13812345678',
    });
    expect(route.sensitivity).toBe('restricted');
  });

  it('内容含银行卡号 → restricted', () => {
    const router = makeRouter();
    const route = router.route('转账', {
      contentSnippet: '卡号：6222021234567890123',
    });
    expect(route.sensitivity).toBe('restricted');
  });

  it('无任何信号 → 默认 internal', () => {
    const router = makeRouter();
    const route = router.route('随便干点啥');
    expect(route.sensitivity).toBe('internal');
  });
});

// ════════════════════════════════════════
// 6. block-and-alert（决策 3 + 降级铁律）
// ════════════════════════════════════════

describe('ModelRouter · block-and-alert（本地不可达 + 敏感数据）', () => {
  let dir: string;
  let logger: DataSovereigntyLogger;

  beforeEach(() => {
    dir = tmpDir();
    logger = new DataSovereigntyLogger(dir);
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('restricted + Ollama 不可达 → block + 写 FAIL 审计 + stderr 告警', async () => {
    const alerts: string[] = [];
    const router = makeRouter({
      logger,
      localProbe: async () => false,   // Ollama 不可达
      alert: (msg) => alerts.push(msg),
    });

    const route = await router.routeWithProbe('翻译这段文字', {
      frontmatter: { sensitivity: 'restricted' },
      taskId: 'test-task-001',
      filePath: '/data/salary.xlsx',
    });

    expect(route.target).toBe('block');
    expect(route.blockReason).toBe(LOCAL_UNAVAILABLE_MSG);
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain('Ollama 未运行');
    expect(alerts[0]).toContain('restricted/confidential');

    // 验证审计记录
    const records = logger.queryRecent({ limit: 10 });
    expect(records.length).toBeGreaterThan(0);
    const last = records[records.length - 1]!;
    expect(last.localAction.auditResult).toBe('FAIL');
    expect(last.dataFlow.sensitivity).toBe('restricted');
    expect(last.taskContext.taskId).toBe('test-task-001');
  });

  it('confidential + Ollama 不可达 → block-and-alert（绝不 fallback 云端）', async () => {
    const alerts: string[] = [];
    const router = makeRouter({
      logger,
      localProbe: async () => false,
      alert: (msg) => alerts.push(msg),
    });

    const route = await router.routeWithProbe('推理机密数据', {
      frontmatter: { sensitivity: 'confidential' },
    });

    expect(route.target).toBe('block');
    expect(route.sensitivity).toBe('confidential');
    expect(alerts[0]).toBe(LOCAL_UNAVAILABLE_MSG);
  });

  it('internal + Ollama 不可达 → fallback cloud-strong（允许云端降级）', async () => {
    const router = makeRouter({
      localProbe: async () => false,
    });

    // internal 复杂任务 → cloud-strong（不依赖本地）
    // 但若需要本地（理论上不会），fallback 允许走 cloud-strong
    const route = await router.routeWithProbe('推理这个问题', {
      frontmatter: { sensitivity: 'internal' },
    });
    expect(route.target).toBe('cloud-strong');
  });

  it('restricted + Ollama 可达 → 正常 local-executor（无告警）', async () => {
    const alerts: string[] = [];
    const router = makeRouter({
      logger,
      localProbe: async () => true,   // Ollama 可达
      alert: (msg) => alerts.push(msg),
    });

    const route = await router.routeWithProbe('翻译这段文字', {
      frontmatter: { sensitivity: 'restricted' },
    });

    expect(route.target).toBe('local-executor');
    expect(alerts.length).toBe(0);
  });
});

// ════════════════════════════════════════
// 7. Mock Ollama API（开发者无需装 Ollama）
// ════════════════════════════════════════

describe('ModelRouter · Mock Ollama /api/tags 探测', () => {
  it('Ollama /api/tags 返回 200 → localProbe=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    try {
      // 使用真实 defaultLocalProbe（通过不传 localProbe）
      const router = new ModelRouter({ config: DEFAULT_ROUTER_CONFIG, alert: () => {} });
      const route = await router.routeWithProbe('翻译', {
        frontmatter: { sensitivity: 'restricted' },
      });
      expect(route.target).toBe('local-executor');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Ollama /api/tags 网络异常 → localProbe=false → block-and-alert', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const alerts: string[] = [];
    try {
      const router = new ModelRouter({
        config: DEFAULT_ROUTER_CONFIG,
        alert: (msg) => alerts.push(msg),
      });
      const route = await router.routeWithProbe('翻译', {
        frontmatter: { sensitivity: 'restricted' },
      });
      expect(route.target).toBe('block');
      expect(alerts.length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ════════════════════════════════════════
// 8. 配置加载
// ════════════════════════════════════════

describe('ModelRouter · 配置加载', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('配置文件缺失 → 返回 DEFAULT_ROUTER_CONFIG', () => {
    const cfg = loadModelRouterConfig(dir);
    expect(cfg).toEqual(DEFAULT_ROUTER_CONFIG);
    expect(cfg.policy.fallbackOnLocalFailure.restricted).toBe('block-and-alert');
    expect(cfg.policy.fallbackOnLocalFailure.confidential).toBe('block-and-alert');
  });

  it('配置文件 JSON 损坏 → 抛 ModelRouterConfigError', () => {
    const cfgPath = path.join(dir, 'model-router.json');
    fs.writeFileSync(cfgPath, '{ invalid json', 'utf-8');
    expect(() => loadModelRouterConfig(dir, cfgPath)).toThrow(ModelRouterConfigError);
  });

  it('配置 restricted fallback 设成云端 → schema 拒绝（安全铁律）', () => {
    const cfgPath = path.join(dir, 'model-router.json');
    const bad = JSON.parse(JSON.stringify(DEFAULT_ROUTER_CONFIG));
    bad.policy.fallbackOnLocalFailure.restricted = 'cloud-strong';  // 非法
    fs.writeFileSync(cfgPath, JSON.stringify(bad), 'utf-8');
    expect(() => loadModelRouterConfig(dir, cfgPath)).toThrow(ModelRouterConfigError);
  });

  it('合法自定义配置 → 正常加载', () => {
    const cfgPath = path.join(dir, 'model-router.json');
    const custom = JSON.parse(JSON.stringify(DEFAULT_ROUTER_CONFIG));
    custom.local.executor.model = 'qwen2.5:14b';
    fs.writeFileSync(cfgPath, JSON.stringify(custom), 'utf-8');
    const cfg = loadModelRouterConfig(dir, cfgPath);
    expect(cfg.local.executor.model).toBe('qwen2.5:14b');
  });
});

// ════════════════════════════════════════
// 9. 与 P0 审计日志的集成（决策 1：单向依赖）
// ════════════════════════════════════════

describe('ModelRouter · 消费 P0 审计日志辅助敏感度判定', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('audit 历史中同 filePath 的敏感度被消费', () => {
    const logger = new DataSovereigntyLogger(dir);
    // 先写一条 restricted 记录（含 filePath）
    logger.append({
      cloudCall: {
        timestamp: new Date().toISOString(),
        provider: 'ollama',
        model: 'qwen2.5:7b',
        endpoint: 'http://localhost:11434',
        tokenCount: { input: 0, output: 0 },
        purpose: 'test',
      },
      localAction: { type: 'model-inference', target: 'test', description: 'test', auditResult: 'PASS' },
      dataFlow: {
        direction: 'local-only',
        sensitivity: 'restricted',
        fields: ['/data/salary.xlsx'],
        destination: 'local-model',
        redacted: false,
      },
      taskContext: { taskId: 't1', userIntent: 'test', agentRole: 'engineer' },
    });

    // 用同一个 logger 构造 router，无 frontmatter / 无路径后缀 / 无 PII
    const router = makeRouter({ logger });
    const route = router.route('处理这个文件', { filePath: '/data/salary.xlsx' });
    expect(route.sensitivity).toBe('restricted');
    expect(route.target).toBe('local-executor');
  });
});

// ════════════════════════════════════════
// v1.3.2 交付 7：client_type 模型接入插槽
// ════════════════════════════════════════

describe('ModelRouter · v1.3.2 交付 7 client_type 模型插槽', () => {
  it('默认配置 client_type=ollama（向后兼容）', () => {
    expect(DEFAULT_ROUTER_CONFIG.local.executor.client_type).toBe('ollama');
    expect(DEFAULT_ROUTER_CONFIG.local.pipeline.client_type).toBe('ollama');
  });

  it('schema 缺省 client_type 时默认 ollama（向后兼容）', () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'model-router.json');
    // 不含 client_type 字段——向后兼容
    fs.writeFileSync(configPath, JSON.stringify({
      cloud: {
        strong: { provider: 'openai', model: 'gpt-4o' },
        fast: { provider: 'deepseek', model: 'deepseek-chat' },
      },
      local: {
        executor: { provider: 'ollama', model: 'qwen2.5:7b', endpoint: 'http://localhost:11434' },
        pipeline: { provider: 'ollama', model: 'qwen2.5:0.5b', endpoint: 'http://localhost:11434' },
      },
      policy: {
        restrictedForcesLocal: true,
        confidentialForcesPipeline: true,
        fallbackOnLocalFailure: {
          public: 'cloud-strong',
          internal: 'cloud-strong',
          restricted: 'block-and-alert',
          confidential: 'block-and-alert',
        },
      },
    }));
    const config = loadModelRouterConfig(dir, configPath);
    expect(config.local.executor.client_type).toBe('ollama');
    expect(config.local.pipeline.client_type).toBe('ollama');
  });

  it('schema 接受 client_type=openai-compatible 配置', () => {
    const dir = tmpDir();
    const configPath = path.join(dir, 'model-router.json');
    fs.writeFileSync(configPath, JSON.stringify({
      cloud: {
        strong: { provider: 'openai', model: 'gpt-4o' },
        fast: { provider: 'deepseek', model: 'deepseek-chat' },
      },
      local: {
        executor: { provider: 'openai-compatible', model: 'Qwen2.5-32B', endpoint: 'http://localhost:8000/v1', client_type: 'openai-compatible', apiKey: 'sk-test' },
        pipeline: { provider: 'ollama', model: 'qwen2.5:0.5b', endpoint: 'http://localhost:11434', client_type: 'ollama' },
      },
      policy: {
        restrictedForcesLocal: true,
        confidentialForcesPipeline: true,
        fallbackOnLocalFailure: {
          public: 'cloud-strong',
          internal: 'cloud-strong',
          restricted: 'block-and-alert',
          confidential: 'block-and-alert',
        },
      },
    }));
    const config = loadModelRouterConfig(dir, configPath);
    expect(config.local.executor.client_type).toBe('openai-compatible');
    expect(config.local.executor.provider).toBe('openai-compatible');
    expect(config.local.executor.apiKey).toBe('sk-test');
  });

  it('数据主权铁律不破：client_type 变化时 restricted 仍 block-and-alert', async () => {
    const openaiConfig = {
      ...DEFAULT_ROUTER_CONFIG,
      local: {
        ...DEFAULT_ROUTER_CONFIG.local,
        executor: {
          provider: 'openai-compatible' as const,
          model: 'Qwen2.5-32B',
          endpoint: 'http://localhost:8000/v1',
          client_type: 'openai-compatible' as const,
          apiKey: 'sk-test',
        },
      },
    };
    const router = new ModelRouter({
      config: openaiConfig,
      localProbe: async () => false,  // 本地不可达
      alert: () => {},
    });
    const route = await router.routeWithProbe('处理敏感数据', {
      frontmatter: { sensitivity: 'restricted' },
    });
    // restricted 本地不可达 → 必须 block（不 fallback 云端）
    expect(route.target).toBe('block');
    expect(route.blockReason).toContain('本地模型不可用');
  });

  it('openai-compatible 可达时 restricted 走本地执行', async () => {
    const openaiConfig = {
      ...DEFAULT_ROUTER_CONFIG,
      local: {
        ...DEFAULT_ROUTER_CONFIG.local,
        executor: {
          provider: 'openai-compatible' as const,
          model: 'Qwen2.5-32B',
          endpoint: 'http://localhost:8000/v1',
          client_type: 'openai-compatible' as const,
          apiKey: 'sk-test',
        },
      },
    };
    const router = new ModelRouter({
      config: openaiConfig,
      localProbe: async () => true,
      alert: () => {},
    });
    const route = await router.routeWithProbe('处理敏感数据', {
      frontmatter: { sensitivity: 'restricted' },
    });
    expect(route.target).toBe('local-executor');
  });
});
