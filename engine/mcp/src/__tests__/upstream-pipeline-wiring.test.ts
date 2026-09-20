// ============================================================
// upstream-pipeline-wiring.test.ts · v1.5.1 第六章 T8/T9 生产管线接线回归
// ============================================================
//
// 任务书第六章验收逐条对应（4 用例 + fail-closed 与灰度回退的证据面）：
//   ① L0 命中——device_data_push 过三层检测：L0 正则命中项经既有脱敏管线
//      后入队（原始敏感值不入盘，断言）+ 判定入审计链（decision-log）
//   ② L1 命中——router_session_push 过同一插槽管线：L1 词典命中项脱敏后
//      落盘（企业专名不出盘）+ routeReason 入链前已止损（防标签二次泄漏）
//   ③ L2 外挂 mock——命中（mock NER span 逐层降漏）+ 不可用 fail-closed
//      （降级 L1 并留痕，不静默放行）
//   ④ 灰度分流——canary hash 稳定（同键多次上行同侧）+ 劣化触发回退可用
//      （回退执行 + HMAC 留痕入审计链）
//
// 隔离纪律：SOFAGENT_DATA / SOFAGENT_KEY_PATH 全量走 tmp（真实 ~/.sofagent
// 零接触）；A2 自指规避——密钥 fixture 运行时拼接。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateAgentIdentity,
  saveDeviceUploadPolicy,
  loadRedactRules,
  getDataDir,
  type AgentIdentity,
} from '@sofagent/core';
import type { ArmMetrics } from '@sofagent/train';
import {
  deviceDataPush,
  runUpstreamSensitivityPipeline,
  resolveUpstreamCanaryRoute,
} from '../tools/device-data-push';
import { routerSessionPush } from '../tools/router-session-push';

const tmpDirs: string[] = [];

function mkTmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// 企业专名（redact-rules.json entities——L1 词典来源）与 L2 mock 识别人名（均虚构）
const ENTITY = '星海智造集团';
const PERSON = '陆知远';
// L0 可检出但格式类不预设（格式类仅覆盖密钥族）——手机号走 L0 正则 → PII 档
const PHONE = '138' + '0013' + '8000';

let dataDir: string;
let legal: AgentIdentity;

/** 读 router-session 审计事件末行（分流决策入链面） */
function lastRouterAuditEvent(): Record<string, unknown> {
  const p = path.join(dataDir, 'audit', 'router-session-events.jsonl');
  const line = fs.readFileSync(p, 'utf-8').trim().split('\n').pop()!;
  return JSON.parse(line) as Record<string, unknown>;
}

/** 读 decision-log 末行（三层检测判定入链面） */
function lastDecisionEntry(): { evidence?: string[]; why?: { text?: string } } {
  const p = path.join(dataDir, 'audit', 'decision-log.jsonl');
  const line = fs.readFileSync(p, 'utf-8').trim().split('\n').pop()!;
  return JSON.parse(line) as { evidence?: string[]; why?: { text?: string } };
}

function mkRaw(sessionId: string, userContent: string): Record<string, unknown> {
  return {
    sessionId,
    enterpriseId: 'ent-t8t9',
    source: 'router-unit',
    messages: [
      { role: 'system', content: '你是企业助手' },
      { role: 'user', content: userContent },
      { role: 'assistant', content: '收到。' },
    ],
    usage: { inputTokens: 300, outputTokens: 100, model: 'qwen2.5-7b', pricePerKUsd: 0.002 },
    route: { targetModel: 'qwen2.5-7b', reason: '本地优先' },
    apiKeyId: 'key-t8t9',
  };
}

function mkArm(requests: number, correct: number, refusals: number, costUsd: number): ArmMetrics {
  return { requests, correct, refusals, costUsd };
}

describe('v1.5.1 第六章 · T8/T9 上行管线接线（三层检测 + 灰度分流）', () => {
  beforeAll(() => {
    dataDir = mkTmpDir('sofagent-t8t9-');
    process.env.SOFAGENT_DATA = dataDir;
    const keyDir = mkTmpDir('sofagent-t8t9-key-');
    fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');

    legal = generateAgentIdentity('t8t9-legal', { principal: 'enterprise-t8t9' });

    // 设备注册 + 采集声明（与生产链路一致：daemon registerDevice + 声明配置）
    const daemon = require('@sofagent/daemon') as {
      registerDevice: (i: AgentIdentity, o: Record<string, unknown>, d?: string) => { ok: boolean };
    };
    expect(daemon.registerDevice(legal, { kind: 'pc', capabilities: ['data-source'], tenant: 'default' }, dataDir).ok).toBe(true);
    saveDeviceUploadPolicy(
      { version: 1, deviceId: legal.agentId, declarations: [{ category: 'metrics', destination: 'platform-ingest' }] },
      dataDir,
    );

    // L1 词典来源 = 既有脱敏配置 redact-rules.json 的 entities（既有配置项，零新增）
    fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'config', 'redact-rules.json'),
      JSON.stringify({ entities: [{ pattern: ENTITY, placeholder: '{CUSTOMER_NAME}' }] }),
      'utf-8',
    );
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    delete process.env.SOFAGENT_L2_NER_ENDPOINT;
    for (const d of tmpDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort：tmp 清理失败不影响断言结论 */
      }
    }
  });

  // ══════════════════════════════════════════════════════════
  // ① L0 命中
  // ══════════════════════════════════════════════════════════
  it('① L0 命中：device_data_push 过三层检测（L0 识别 PII）→ 脱敏后入队 + 判定入审计链', async () => {
    const payload = `产线节拍 12s，联系人电话 ${PHONE}`;

    // 插槽管线本体：L0 正则检出 → 既有脱敏管线替换（原始值不出）
    const wiring = await runUpstreamSensitivityPipeline({
      text: payload,
      rules: loadRedactRules(getDataDir(undefined)),
      dataDir,
    });
    expect(wiring.detectors.map((d) => d.name)).toContain('l0-regex');
    expect(wiring.text).not.toContain(PHONE);
    expect(wiring.text).toContain('{PII:PHONE_NUMBER:');
    expect(wiring.decision.level).toBe('sensitive');

    // 上行链路：原始敏感值不入盘（WAL 只存密文）
    const r = await deviceDataPush({ identity: legal as unknown as Record<string, unknown>, category: 'metrics', payload });
    expect(r.data.ok).toBe(true);
    const wal = fs.readFileSync(path.join(dataDir, 'upload-wal.jsonl'), 'utf-8');
    expect(wal).not.toContain(PHONE);
    expect(wal).not.toContain('产线节拍');

    // 判定入审计链：L0 检测器 + 档位 + routeReason（labels 里可见 L0 命中标签）
    const entry = lastDecisionEntry();
    const evidence = entry.evidence ?? [];
    expect(evidence.some((l) => l.includes('l0-regex:L0'))).toBe(true);
    expect(evidence).toContain('sensitivityLevel=sensitive');
    expect(evidence.some((l) => l.startsWith('sensitivityRouteReason=') && l.includes('phone'))).toBe(true);
  });

  // ══════════════════════════════════════════════════════════
  // ② L1 命中
  // ══════════════════════════════════════════════════════════
  it('② L1 命中：router_session_push 同管线——L1 词典命中项脱敏后落盘（原始专名不入盘）', async () => {
    const r = await routerSessionPush({ raw: mkRaw('sess-l1-hit', `${ENTITY}的机床产能多少？`) });
    expect(r.data.ok).toBe(true);

    const content = fs.readFileSync(r.data.sessionFile!, 'utf-8');
    expect(content).not.toContain(ENTITY); // 原始企业专名不出盘
    expect(content).toContain('{GLOSSARY:'); // 命中项走既有脱敏管线占位符

    const evt = lastRouterAuditEvent();
    const wiringEvidence = evt.wiringEvidence as string[];
    expect(wiringEvidence.some((l) => l.includes('l1-glossary:L1'))).toBe(true);
    expect(evt.sensitivityLevel).toBe('sensitive');
    // routeReason 入链前经 L0+L1 止损：链上不留企业专名原文（防标签二次泄漏）
    expect(JSON.stringify(evt)).not.toContain(ENTITY);
  });

  // ══════════════════════════════════════════════════════════
  // ③ L2 外挂 NER（mock）
  // ══════════════════════════════════════════════════════════
  it('③ L2 外挂 mock 命中：mock NER span 经插槽逐层降漏后落盘脱敏', async () => {
    const savedFetch = globalThis.fetch;
    process.env.SOFAGENT_L2_NER_ENDPOINT = 'http://127.0.0.1:9/api/ner';
    // 故障注入面：mock 端点返回人名 span（偏移按收到的文本现算——与预取语义一致）
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { text: string };
      const start = body.text.indexOf(PERSON);
      const spans = start >= 0 ? [{ entity_type: 'person', start, end: start + PERSON.length, score: 0.88 }] : [];
      return { ok: true, status: 200, json: async () => spans };
    }) as unknown as typeof fetch;

    try {
      const r = await routerSessionPush({ raw: mkRaw('sess-l2-hit', `请找${PERSON}对接产能数据`) });
      expect(r.data.ok).toBe(true);

      const content = fs.readFileSync(r.data.sessionFile!, 'utf-8');
      expect(content).not.toContain(PERSON);
      expect(content).toContain('{GLOSSARY:');

      const wiringEvidence = lastRouterAuditEvent().wiringEvidence as string[];
      expect(wiringEvidence.some((l) => l.includes('l2-remote-ner:L2'))).toBe(true);
      expect(wiringEvidence.some((l) => l === 'l2Degraded=none')).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      delete process.env.SOFAGENT_L2_NER_ENDPOINT;
    }
  });

  it('③-b L2 外挂不可用：fail-closed 降级 L1 并留痕（不静默放行）', async () => {
    const savedFetch = globalThis.fetch;
    process.env.SOFAGENT_L2_NER_ENDPOINT = 'http://127.0.0.1:9/api/ner';
    // 不可达故障注入（fail-closed 三形态之一）
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED（测试故障注入）');
    }) as unknown as typeof fetch;

    try {
      const r = await routerSessionPush({ raw: mkRaw('sess-l2-down', `${ENTITY}的产线数据汇总`) });
      // 降级不阻断（语义沿用 v1.4.9：降级 L0+L1 继续检测，而非拒绝服务）
      expect(r.data.ok).toBe(true);

      // 降级后 L1 仍兜底——企业专名照样不出盘（不静默放行）
      const content = fs.readFileSync(r.data.sessionFile!, 'utf-8');
      expect(content).not.toContain(ENTITY);
      expect(content).toContain('{GLOSSARY:');

      // 降级事实留痕（审计链可查——不静默）
      const wiringEvidence = lastRouterAuditEvent().wiringEvidence as string[];
      expect(wiringEvidence.some((l) => l.startsWith('l2Degraded=l2-remote-ner'))).toBe(true);
      // 真实故障因随链落盘（不只「异步面不兼容」的固定文案——可还原降级原因）
      expect(wiringEvidence.some((l) => l.startsWith('l2DegradedReason=') && l.includes('ECONNREFUSED'))).toBe(true);
    } finally {
      globalThis.fetch = savedFetch;
      delete process.env.SOFAGENT_L2_NER_ENDPOINT;
    }
  });

  // ══════════════════════════════════════════════════════════
  // ④ 灰度分流（hash 稳定性 + 劣化回退）
  // ══════════════════════════════════════════════════════════
  it('④ 灰度分流：canary hash 稳定（同键多次上行同侧）+ 劣化触发回退可用', async () => {
    const canaryPath = path.join(dataDir, 'config', 'weight-canary.json');
    fs.writeFileSync(
      canaryPath,
      JSON.stringify({ modelName: 'qwen2.5-7b', oldAdapter: 'lora-old', newAdapter: 'lora-new', newWeightPercent: 30 }),
      'utf-8',
    );
    try {
      // (a) hash 稳定性：同一分流键多次判定恒定同臂（不抖动）
      const key = 'sess-canary-stable';
      const arms = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const verdict = await resolveUpstreamCanaryRoute({ routeKey: key, dataDir });
        expect(verdict.canary).toBeDefined();
        arms.add(verdict.canary!.adapter);
      }
      expect(arms.size).toBe(1);

      // (b) 同键多次上行同侧：设备上行（分流键 = 设备标识）逐次落审计链，臂恒定
      const devKeyArms = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const r = await deviceDataPush({
          identity: legal as unknown as Record<string, unknown>,
          category: 'metrics',
          payload: `灰度采样样本 ${i}`,
        });
        expect(r.data.ok).toBe(true);
        const evidence = lastDecisionEntry().evidence ?? [];
        const line = evidence.find((l) => l.startsWith('canaryAdapter='));
        expect(line).toBeDefined();
        devKeyArms.add(line!.split('=')[1]!);
        expect(evidence.some((l) => l.startsWith('canaryRouteReason=canary hash 稳定分流'))).toBe(true);
      }
      expect(devKeyArms.size).toBe(1);

      // (c) 劣化触发回退可用：注入劣化两臂指标 + 回退执行面（复用 rollback-weights 语义）
      const rollbackCalls: string[] = [];
      const r = await deviceDataPush({
        identity: legal as unknown as Record<string, unknown>,
        category: 'metrics',
        payload: '灰度健康巡检',
        wiring: {
          metrics: {
            old: mkArm(50, 45, 2, 1.0),
            new: mkArm(50, 30, 20, 1.0), // 正确率 −30%、拒绝率大增 → 劣化
          },
          rollbackWeights: async (modelName: string) => {
            rollbackCalls.push(modelName);
            return { ok: true, message: '已回退全量旧权重' };
          },
          hmacKey: 'test-canary-hmac-key-0123456789',
        },
      });
      expect(r.data.ok).toBe(true);
      expect(rollbackCalls).toEqual(['qwen2.5-7b']); // 回退执行面被真实调用

      const evidence = lastDecisionEntry().evidence ?? [];
      expect(evidence.some((l) => l.includes('canaryRollback=rolledBack:true;rollbackOk:true'))).toBe(true);
      expect(evidence.some((l) => l.startsWith('canaryRollbackSig='))).toBe(true); // HMAC 留痕
    } finally {
      fs.rmSync(canaryPath, { force: true });
    }
  });

  // ══════════════════════════════════════════════════════════
  // ⑤ L1 词典窄化可见化（不改脱敏能力，只让「口径比配置窄」可被看见）
  // ══════════════════════════════════════════════════════════
  it('⑤ 窄化可见化：单字词条被拒收 + ASCII 子串整词边界 → 证据显式登记（不默默通过）', async () => {
    const NARROW_SHORT = '张'; // 单字词条——buildGlossaryFromEntityNames 拒收
    const NARROW_ASCII = 'STARLINE'; // 纯 ASCII 词条——termToRegex 加整词边界
    const asciiText = `${NARROW_ASCII}WORKS-01`; // 以子串形态出现（整词边界下不命中）
    const narrowRules = {
      entities: [
        { pattern: NARROW_SHORT, placeholder: '{SHORT}' },
        { pattern: NARROW_ASCII, placeholder: '{ASCII}' },
      ],
    };

    // (a) 管线级（inline rules）：窄化统计 + 缺口实检
    const wiring = await runUpstreamSensitivityPipeline({
      text: `${NARROW_SHORT}工确认，代号 ${asciiText} 已归档`,
      rules: narrowRules,
      dataDir,
    });
    expect(wiring.glossaryNarrowed.droppedShort).toBe(1);
    expect(wiring.glossaryNarrowed.asciiWordBoundary).toBe(1);
    expect(wiring.glossaryNarrowed.missed.map((m) => m.category).sort()).toEqual(['asciiWordBoundary', 'droppedShort']);
    // 缺口是真实的（v1.4.9 插槽件当前语义）：两类词条都未被脱敏。
    // ⚠️ 本条锁「已知缺口的当前行为」——后续版本若在 core 侧补兜底通道/放宽词典构造，
    //    本断言须同步更新（它是窄化真实存在的证据，不是期望行为）。
    expect(wiring.text).toContain(NARROW_SHORT);
    expect(wiring.text).toContain(asciiText);
    // 链上不留词条原文（以 sha256 前 8 位指代）
    expect(JSON.stringify(wiring.glossaryNarrowed)).not.toContain(NARROW_ASCII);
    expect(wiring.evidence).toContain('glossaryNarrowed=droppedShort:1;asciiWordBoundary:1');
    expect(
      wiring.evidence.some(
        (l) => l.startsWith('glossaryNarrowedMiss=') && l.includes('droppedShort@') && l.includes('asciiWordBoundary@'),
      ),
    ).toBe(true);

    // (b) 工具级（走磁盘配置 = 生产路径）：窄化登记随审计事件入链
    const cfgPath = path.join(dataDir, 'config', 'redact-rules.json');
    const original = fs.readFileSync(cfgPath, 'utf-8');
    fs.writeFileSync(cfgPath, JSON.stringify(narrowRules), 'utf-8');
    try {
      const r = await routerSessionPush({ raw: mkRaw('sess-narrowed', `请${NARROW_SHORT}工核对 ${asciiText}`) });
      expect(r.data.ok).toBe(true);
      const evt = lastRouterAuditEvent();
      const wiringEvidence = evt.wiringEvidence as string[];
      expect(wiringEvidence).toContain('glossaryNarrowed=droppedShort:1;asciiWordBoundary:1');
      expect(wiringEvidence.some((l) => l.startsWith('glossaryNarrowedMiss=') && l !== 'glossaryNarrowedMiss=none')).toBe(true);
      expect(JSON.stringify(evt)).not.toContain(NARROW_ASCII); // 链上不留词条原文
    } finally {
      fs.writeFileSync(cfgPath, original, 'utf-8');
    }
  });
});
