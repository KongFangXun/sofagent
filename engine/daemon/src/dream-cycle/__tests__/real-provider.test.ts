// ============================================================
// dream-cycle/__tests__/real-provider.test.ts · 真脑 + 质量门槛测试
// v1.4.5 第七章五新增（四角色循环场景）
//
// 覆盖用例（共 9 case）：
//   一、createDefaultProvider：注册表活动模型 → status='real' + 端点描述
//   二、createDefaultProvider：注册表空 + 无环境变量 → 显式降级 status='mock'
//   三、质量门槛：占位符级产出（过短）被拦
//   四、质量门槛：泛化复述（无硬信息标记）被拦
//   五、质量门槛：与 MockLLM 输出雷同（无认知增量）被拦
//   六、质量门槛：真实形态产出（含具体命令/数字、与 mock 有差异）放行
//   七、四角色循环场景：注入假真脑（模拟真实响应形态）→ 六阶段全链
//       跑通 + entities/ 内容含真实知识 + 周报带「真 LLM」标注
//   八、Mock 退化语义：注入 MockLLM + status='mock' → 周报带降级标注
//   九、RealLLM.extract 质量门槛接线：假真脑输出占位符 → stage 失败
//       落 failed 游标（不静默放行进知识库）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runDreamCycle } from '../state-machine';
import { MockLLM } from '../llm-mock';
import { RealLLM, createDefaultProvider } from '../real-provider';
import type { CallModelFn } from '../real-provider';
import { validateKnowledgeQuality, mockExtractForDiff } from '../quality-gate';
import type { Ledger } from '../types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-real-provider-'));
}

/**
 * 假真脑调用层——模拟真 LLM 的响应形态（JSON 数组提取 / 语义标签聚类 /
 * 概念合成），经 RealLLM.callImpl 注入（质量门槛/injection-guard 全链在测）。
 * 输出刻意带具体命令与数字（过硬信息轴）且与 MockLLM 按行切分输出有
 * 差异（过差异度轴）。degradeToPlaceholder 打开后返回占位符级输出。
 */
function makeFakeRealCall(degradeToPlaceholder = false): CallModelFn {
  return async (messages) => {
    const userContent = messages.find((m) => m.role === 'user')?.content ?? '';
    if (degradeToPlaceholder) {
      return '["知识点"]';
    }
    if (userContent.includes('提取独立、原子化的知识点')) {
      // extract：把输入行重写为带具体上下文的陈述句（真实响应形态）
      const body = userContent.split('文本：\n')[1] ?? userContent;
      const facts = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => `实测教训：${line.replace(/^#+\s*/, '')}（触发条件：CI 阈值 80%，命令 \`npm test -w @sofagent/daemon\` 验证）`);
      return JSON.stringify(facts);
    }
    if (userContent.includes('按语义相近程度分组')) {
      // cluster：语义标签（非 hash 桶）
      const listMatch = userContent.match(/输入列表：\n(\[[\s\S]*\])$/);
      const inputs: string[] = listMatch ? (JSON.parse(listMatch[1]) as string[]) : [];
      return JSON.stringify(
        inputs.map((text) => (text.includes('审计') ? '审计纪律' : '工程习惯')),
      );
    }
    if (userContent.includes('合成为一个概念')) {
      // synthesize：概念标题 + 融合正文（追加的共性行用输入必含的「实测」
      // 字样回查——atom 全部以「实测教训：」开头，回查输入必有源）
      const listMatch = userContent.match(/知识点列表：\n(\[[\s\S]*\])$/);
      const inputs: string[] = listMatch ? (JSON.parse(listMatch[1]) as string[]) : [];
      return JSON.stringify({
        title: `部署纪律：${inputs.length} 条实测教训的共性`,
        body: inputs.map((t, i) => `${i + 1}. ${t}`).join('\n') + '\n\n共性：以上各条均来自「实测教训」记录，阈值 80%。',
      });
    }
    return '["未匹配任务类型的兜底输出"]';
  };
}

describe('createDefaultProvider（真脑解析 + 显式降级）', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    process.env.SOFAGENT_HOME = dir;
    delete process.env.SOFAGENT_MODEL_API_KEY;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_HOME;
    delete process.env.SOFAGENT_MODEL_API_KEY;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例一：注册表活动模型 → real
  it('注册表 pipeline 档活动模型 → status=real + endpointDesc 带注册名', () => {
    const dataDir = path.join(dir, 'data');
    fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'config', 'model-registry.json'),
      JSON.stringify({
        version: 1,
        models: {
          'maintainer-llm': {
            name: 'maintainer-llm',
            endpoint: 'http://localhost:8000/v1',
            clientType: 'openai-compatible',
            model: 'qwen3-32b',
            source: 'endpoint',
            status: 'active',
            registeredAt: '2026-09-05T00:00:00.000Z',
          },
        },
        active: { pipeline: 'maintainer-llm' },
        events: [],
      }),
      'utf-8',
    );
    const resolution = createDefaultProvider(dataDir);
    expect(resolution.status).toBe('real');
    expect(resolution.provider).toBeInstanceOf(RealLLM);
    expect(resolution.endpointDesc).toContain('model-registry:maintainer-llm');
    expect(resolution.endpointDesc).toContain('qwen3-32b');
  });

  // 用例二：注册表空 + 无环境变量 → 显式降级 mock
  it('注册表空 + SOFAGENT_MODEL_API_KEY 未设置 → 显式降级 status=mock（带原因）', () => {
    const dataDir = path.join(dir, 'data');
    const resolution = createDefaultProvider(dataDir);
    expect(resolution.status).toBe('mock');
    expect(resolution.provider).toBeInstanceOf(MockLLM);
    expect(resolution.degradedReason).toContain('显式降级');
  });
});

describe('validateKnowledgeQuality（非占位符三轴校验）', () => {
  // 用例三：长度轴
  it('过短产出（占位符级）被长度轴拦截', () => {
    const gate = validateKnowledgeQuality('知识点', '原始输入很长'.repeat(10), mockExtractForDiff('原始输入很长'.repeat(10)));
    expect(gate.ok).toBe(false);
    expect(gate.reasons.some((r) => r.includes('长度轴'))).toBe(true);
  });

  // 用例四：信息量轴
  it('泛化复述（无硬信息标记）被信息量轴拦截', () => {
    const output = '这个教训很重要，大家要注意养成良好的工程习惯，避免犯错。';
    const gate = validateKnowledgeQuality(output, '输入：跑 npm test 前先 npm install', mockExtractForDiff('跑 npm test 前先 npm install'));
    expect(gate.ok).toBe(false);
    expect(gate.reasons.some((r) => r.includes('信息量轴'))).toBe(true);
  });

  // 用例五：差异度轴（与 mock 完全一致）
  it('与 MockLLM 按行切分输出完全一致被差异度轴拦截（无认知增量）', () => {
    const input = '教训一 提交前跑测试 3 次';
    const mockOut = mockExtractForDiff(input);
    // 直接把 mock 输出当真脑产出——规范化后完全一致
    const gate = validateKnowledgeQuality(mockOut, input, mockOut);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.some((r) => r.includes('差异度轴'))).toBe(true);
  });

  // 用例六：真实形态产出放行
  it('真实形态产出（含命令/数字、与 mock 有差异、信息可溯源）放行', () => {
    const input = '教训：hook 部署后要跑 bash tools/check/check-version.sh 自查，阈值 80%';
    const output = 'hook 部署后必须跑 bash tools/check/check-version.sh，覆盖 9 处 SSOT，CI 阈值 80% 不达标即红。';
    const gate = validateKnowledgeQuality(output, input, mockExtractForDiff(input));
    expect(gate.ok).toBe(true);
    expect(gate.reasons).toHaveLength(0);
  });
});

describe('四角色循环场景（runDreamCycle × 真脑注入）', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    process.env.SOFAGENT_HOME = dir;
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  });

  afterEach(() => {
    delete process.env.SOFAGENT_HOME;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例七：假真脑全链——六阶段跑通 + 知识含真实形态内容 + 周报真 LLM 标注
  it('注入假真脑 → 六阶段全链跑通，entities/ 含具体命令与数字，周报标注「真 LLM」', async () => {
    const thinkContent =
      '## 教训：hook 部署后必须自查\n跑 bash tools/check/check-version.sh，9 处 SSOT 对齐\n## 教训：审计纪律\n提交前 24 条规则全绿才收编\n';
    fs.writeFileSync(path.join(dir, 'data', 'think.md'), thinkContent, 'utf-8');

    const fakeReal = new RealLLM(null, makeFakeRealCall(false));
    const result = await runDreamCycle(dir, { llm: fakeReal, providerStatus: 'real' });
    expect(result.cycleComplete).toBe(true);
    expect(result.providerStatus).toBe('real');
    expect(result.counts.concepts).toBeGreaterThanOrEqual(1);

    // entities/ 内容级断言：真脑输出形态（具体命令/数字）必须进入 concept 正文
    const entitiesDir = path.join(dir, 'data', 'knowledge', 'entities');
    const files = fs.readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const allContent = files.map((f) => fs.readFileSync(path.join(entitiesDir, f), 'utf-8')).join('\n');
    expect(allContent).toContain('check-version.sh');
    expect(allContent).toContain('80%');

    // 周报降级标注：真脑不带 mock 标注
    const log = fs.readFileSync(path.join(dir, 'data', 'knowledge', 'log.md'), 'utf-8');
    expect(log).toContain('真 LLM');
    expect(log).not.toContain('status=mock');
  });

  // 用例八：Mock 退化语义——周报带降级标注
  it('注入 MockLLM + status=mock → 周报带显式降级标注（永不默默占位）', async () => {
    const ledger: Ledger = {
      thinkContent: '## 教训：跑测试\nnpm test 全绿才提交\n',
      auditEntries: [],
    };
    const result = await runDreamCycle(dir, {
      ledger,
      llm: new MockLLM(),
      providerStatus: 'mock',
      degradedReason: '测试场景：模型不可用模拟',
    });
    expect(result.cycleComplete).toBe(true);
    expect(result.providerStatus).toBe('mock');

    const log = fs.readFileSync(path.join(dir, 'data', 'knowledge', 'log.md'), 'utf-8');
    expect(log).toContain('status=mock');
    expect(log).toContain('测试场景：模型不可用模拟');
  });

  // 用例九：真脑产出占位符 → 质量门槛抛错 → failed 游标落盘（不静默进知识库）
  it('真脑退化输出占位符 → 质量门槛拦截，failed:extract_facts 游标落盘', async () => {
    const degraded = new RealLLM(null, makeFakeRealCall(true));
    const ledger: Ledger = {
      thinkContent: '## 教训：跑测试\nnpm test 全绿才提交\n',
      auditEntries: [],
    };
    const result = await runDreamCycle(dir, { ledger, llm: degraded, providerStatus: 'real' });
    expect(result.cycleComplete).toBe(false);
    expect(result.failedAt).toBe('extract_facts');
    expect(result.error).toContain('质量门槛');

    // 知识库不得有本轮产物（entities/ 不存在——synthesize 未执行）
    expect(fs.existsSync(path.join(dir, 'data', 'knowledge', 'entities'))).toBe(false);
  });
});
