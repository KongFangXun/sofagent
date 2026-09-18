// ============================================================
// fde-deploy-companion.test.ts · v1.5.0 章五：fde_deploy 陪跑期登记衔接
// ============================================================
//
// 验收标准（devlog 章五）：fde_deploy 部署后陪跑期状态自动生效
// （无需手工配置）——部署成功 → {dataDir}/fde/companion.json 落
// deployedAt，companion.getCompanionState 读同源状态即 active。
//
// mock 策略：vi.mock('@sofagent/orchestrator')——deployWorkflow
// 返回固定产物（不依赖真实编排链路）。dataDir 经 SOFAGENT_HOME
// 环境变量注入（getDataDir 读取）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// mock orchestrator——deployWorkflow 返回最小成功产物
vi.mock('@sofagent/orchestrator', () => ({
  classifyAutomation: () => 'FULL_AUTO',
  deployWorkflow: () => ({
    nodeCount: 2,
    workflowPath: '/tmp/deployments/test-wf.yml',
    nextSteps: ['workflow_submit → activate_workflow'],
  }),
}));

import { fdeDeployTool } from '../tools/fde-deploy';

const VALID_NODES = [
  {
    node_id: 'n1',
    description: '节点一',
    elements: { input: 'i', output: 'o', owner: 'u', duration: '1h', bottleneck: 'b' },
    questions: { input_automatable: true, rules_codifiable: true, output_predictable: true },
  },
  {
    node_id: 'n2',
    description: '节点二',
    elements: { input: 'i', output: 'o', owner: 'u', duration: '1h', bottleneck: 'b' },
    questions: { input_automatable: false, rules_codifiable: true, output_predictable: false },
    depends_on: ['n1'],
  },
];

describe('fde_deploy 陪跑期登记（v1.5.0 章五）', () => {
  let tmpDir: string;
  let prevData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fde-deploy-'));
    prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = tmpDir;
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevData;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('test_fdeDeploy_部署成功_写companion登记_deployedAt生效', async () => {
    const result = await fdeDeployTool({
      enterprise_id: 'ent-1',
      workflow_name: 'test-wf',
      nodes: VALID_NODES,
    });

    expect(result.data.ok).toBe(true);
    expect(result.data.companionRegistered).toBe(true);
    // 登记落盘：fde/companion.json 含 deployedAt（ISO）
    const markerPath = path.join(tmpDir, 'fde', 'companion.json');
    expect(fs.existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    expect(typeof marker.deployedAt).toBe('string');
    expect(Number.isNaN(Date.parse(marker.deployedAt))).toBe(false);
    expect(marker.lastWorkflow).toBe('test-wf');
    // 返回文案含登记提示
    expect(result.text).toContain('陪跑期登记已写入');
  });

  it('test_fdeDeploy_重复部署_保留最早deployedAt_陪跑期不重置', async () => {
    const first = await fdeDeployTool({ enterprise_id: 'ent-1', workflow_name: 'wf-a', nodes: VALID_NODES });
    expect(first.data.ok).toBe(true);
    const markerPath = path.join(tmpDir, 'fde', 'companion.json');
    const firstMarker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));

    // 二次部署（不同 workflow）
    const second = await fdeDeployTool({ enterprise_id: 'ent-1', workflow_name: 'wf-b', nodes: VALID_NODES });
    expect(second.data.ok).toBe(true);
    const secondMarker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));

    // deployedAt 保留最早值（陪跑期从首次部署起算）
    expect(secondMarker.deployedAt).toBe(firstMarker.deployedAt);
    expect(secondMarker.lastWorkflow).toBe('wf-b');
    expect(typeof secondMarker.lastDeployedAt).toBe('string');
  });

  it('test_fdeDeploy_前次已期满出报告_新部署重置周期', async () => {
    // 预置已期满状态（reportGeneratedAt 已存在）
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    const oldDeployedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt: oldDeployedAt, reportGeneratedAt: new Date(Date.now() - 15 * 86_400_000).toISOString() }),
      'utf-8',
    );

    const result = await fdeDeployTool({ enterprise_id: 'ent-1', workflow_name: 'wf-c', nodes: VALID_NODES });
    expect(result.data.ok).toBe(true);

    const marker = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fde', 'companion.json'), 'utf-8'));
    // 新周期：reportGeneratedAt 清除，deployedAt 重写为新部署时刻
    expect(marker.reportGeneratedAt).toBeUndefined();
    expect(marker.deployedAt).not.toBe(oldDeployedAt);
  });

  it('test_fdeDeploy_参数校验失败_不写登记', async () => {
    const result = await fdeDeployTool({ enterprise_id: '', workflow_name: 'x', nodes: VALID_NODES });
    expect(result.data.isError).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'fde', 'companion.json'))).toBe(false);
  });
});
