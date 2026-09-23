// ============================================================
// connector-workflow-tools.test.ts · T4/T5 MCP tools 集成测试
// v1.4.9 G5b（连接器注册/发现）+ G1（workflow 导出/导入/血缘）
// ============================================================
//
// 覆盖面（MCP 面的验收透传 + 铁律）：
//   1. 三 tool 的 text 首行 [sofagent] 前缀（三层签名铁律）
//   2. connector_register：白名单内注册成功 / 白名单外拒绝（验收 ①②）
//   3. connector_list：过滤 + 租户隔离 + 与 TOOLS 分列（验收 ③④）
//   4. workflow_export：五件套完整 + 血缘元数据（T5 验收 ①）
//   5. workflow_export：跨租户剥离 private / result-only（T5 验收 ④）
//   6. workflow_import：schema 校验门拒绝非法模板（T5 验收 ②）
//   7. workflow_import：血缘回溯到源企业/源版本（T5 验收 ③）
//   8. workflow_import：完整性核对（篡改检测）+ 私域节点整包拒绝
//   9. export→import 全链往返（fork 谱系跨企业闭环）
//  10. registry 注册面：TOOLS 数组含三 tool（铁律 9 接线存在性）
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { connectorRegister, connectorList } from '../tools/connector-list';
import { workflowExport } from '../tools/workflow-export';
import { workflowImport } from '../tools/workflow-import';
import { TOOLS } from '../tool-registry';
import { workflowCreate } from '@sofagent/orchestrator/workflow';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-t4t5-tools-'));
  tmpDirs.push(dir);
  return dir;
}

/** 白名单策略（写 policy.yml——registerConnector 缺省读标准落点） */
const WHITELIST_POLICY = `plugin_sources:
  allowlist:
    - { kind: 'host', pattern: 'clawhub.ai' }
    - { kind: 'git-url', pattern: 'https://github.com/our-org/*' }
    - { kind: 'local-path', pattern: '/opt/connectors/*' }
`;

function writePolicy(dataDir: string): void {
  fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config', 'policy.yml'), WHITELIST_POLICY, 'utf-8');
}

const BASE_DOC = {
  name: 'partner-flow',
  description: '跨企业模板测试流',
  nodes: [
    { id: 'collect', agent: 'fde', task: '采集需求' },
    { id: 'build', agent: 'engineer', task: '实现', depends_on: ['collect'] },
  ],
};

describe('T4 · connector_register / connector_list（G5b）', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkDataDir();
    writePolicy(dir);
  });

  it('text 首行 [sofagent] 前缀（成功与拒绝两态）', async () => {
    const ok = await connectorRegister({ name: 'crm', kind: 'saas', source: 'clawhub.ai', data_dir: dir });
    expect(ok.text.startsWith('[sofagent]')).toBe(true);
    const bad = await connectorRegister({ name: 'evil', kind: 'rest', source: 'https://evil.example.com/x', data_dir: dir });
    expect(bad.text.startsWith('[sofagent]')).toBe(true);
  });

  it('白名单内注册成功（验收 ①）+ 无策略目录全拒（fail-closed）', async () => {
    const ok = await connectorRegister({ name: 'crm2', kind: 'saas', source: 'clawhub.ai', data_dir: dir });
    expect(ok.data.isError).toBe(false);
    // 无 policy.yml 的目录 → 拒绝（与 device 白名单同源语义）
    const bare = mkDataDir();
    const rejected = await connectorRegister({ name: 'x', kind: 'db', source: 'github.com', data_dir: bare });
    expect(rejected.data.isError).toBe(true);
    if (rejected.data.isError === true) expect(rejected.data.reason).toBe('source-not-allowed');
  });

  it('白名单外来源拒绝（验收 ②）+ 审计留痕仍尝试', async () => {
    const r = await connectorRegister({ name: 'evil', kind: 'rest', source: 'https://evil.example.com/x', data_dir: dir });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.reason).toBe('source-not-allowed');
    expect(r.data.auditLogged).toBe(true); // 拒绝事件也进 decision-log
  });

  it('connector_list 过滤 + 租户隔离 + 分列口径（验收 ③④）', async () => {
    await connectorRegister({ name: 'db-1', kind: 'db', source: 'clawhub.ai', capabilities: ['postgres'], data_dir: dir });
    await connectorRegister({ name: 'crm-acme', kind: 'saas', source: 'clawhub.ai', tenant: 'acme', data_dir: dir });
    const def = await connectorList({ data_dir: dir });
    expect(def.data.total).toBeGreaterThanOrEqual(2);
    expect(def.data.scope).toBe('connectors-only');
    expect(def.data.connectors.every((c) => c.tenant === 'default')).toBe(true);
    const onlyDb = await connectorList({ kind: 'db', data_dir: dir });
    expect(onlyDb.data.connectors.every((c) => c.kind === 'db')).toBe(true);
    const acme = await connectorList({ tenant: 'acme', data_dir: dir });
    expect(acme.data.connectors.every((c) => c.tenant === 'acme')).toBe(true);
    expect(acme.data.connectors.some((c) => c.name === 'crm-acme')).toBe(true);
    // 分列：连接器名不出现在 TOOLS
    const toolNames = TOOLS.map((t) => t.name);
    for (const c of def.data.connectors) {
      expect(toolNames).not.toContain(c.name);
    }
  });
});

describe('T5 · workflow_export / workflow_import（G1）', () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkDataDir();
    // 建源 workflow（G14 CRUD——导出读取面）
    const created = await workflowCreate({ workflow: BASE_DOC, owner: 'owner-a' }, dir);
    expect(created.data.isError).toBe(false);
  });

  it('text 首行 [sofagent] 前缀', async () => {
    const r = await workflowExport({ workflow_id: 'partner-flow', data_dir: dir });
    expect(r.text.startsWith('[sofagent]')).toBe(true);
  });

  it('导出五件套完整 + 血缘元数据（验收 ①）', async () => {
    const r = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    expect(r.data.isError).toBe(false);
    const files = r.data.bundleFiles!;
    // 五件套：workflow.yml + 本体 + manifest 必在；MD 家族按实收录
    expect(files).toContain('manifest');
    expect(files).toContain('workflow.yml');
    expect(files).toContain('ontology-entities.json');
    expect(files.length).toBeGreaterThanOrEqual(3);
    // 血缘元数据
    expect(r.data.lineage!.sourceEnterprise).toBe('ent-a');
    expect(r.data.lineage!.sourceVersion).toBe(1);
    expect(r.data.lineage!.forkDepth).toBe(0);
    // manifest 含 sha256 完整性锚
    const manifest = (r.data.bundle!['manifest'] as { files: Record<string, string> });
    expect(Object.keys(manifest.files).length).toBeGreaterThanOrEqual(2);
    expect(manifest.files['workflow.yml']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('跨租户剥离 private / result-only 节点（验收 ④——G6 联动，独立 id 验证见下一用例）', async () => {
    // partner-flow 在 beforeAll 已创建（2 节点公开版）——同名 create 拒绝
    // （G14 重复创建语义），此处验证的是 export 面对既有公开流的缺省行为
    const dup = await workflowCreate({
      workflow: { ...BASE_DOC, nodes: [{ id: 'x', agent: 'a', task: 't', visibility: 'private' as const }] },
      owner: 'owner-a',
    }, dir);
    expect(dup.data.isError).toBe(true); // 重复创建拒绝——剥离语义在下一用例独立验证
    const r = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    expect(r.data.isError).toBe(false);
    expect(r.data.strippedPrivate).toBe(0); // 公开流无剥离
  });

  it('剥离语义独立验证（含私域节点的独立 workflow）', async () => {
    const docWithPrivate = {
      name: 'mixed-flow',
      nodes: [
        { id: 'open-node', agent: 'fde', task: '公开步骤' },
        { id: 'secret-node', agent: 'fde', task: '私域步骤', visibility: 'private' as const },
        { id: 'result-node', agent: 'fde', task: '结果可见步骤', visibility: 'result-only' as const },
      ],
    };
    const c = await workflowCreate({ workflow: docWithPrivate, owner: 'owner-a' }, dir);
    expect(c.data.isError).toBe(false);
    // 跨租户（缺省）→ 剥离
    const cross = await workflowExport({ workflow_id: 'mixed-flow', enterprise: 'ent-a', data_dir: dir });
    expect(cross.data.isError).toBe(false);
    expect(cross.data.strippedPrivate).toBe(1);
    expect(cross.data.strippedResultOnly).toBe(1);
    const yml = cross.data.bundle!['workflow.yml'] as string;
    expect(yml).toContain('open-node');
    expect(yml).not.toContain('secret-node');
    expect(yml).not.toContain('result-node');
    // 同租户 → 全量保留
    const same = await workflowExport({ workflow_id: 'mixed-flow', enterprise: 'ent-a', cross_tenant: false, data_dir: dir });
    expect(same.data.isError).toBe(false);
    expect(same.data.strippedPrivate).toBe(0);
    const ymlSame = same.data.bundle!['workflow.yml'] as string;
    expect(ymlSame).toContain('secret-node');
  });

  it('全私域 workflow 跨租户导出 → empty-after-strip 拒绝', async () => {
    const allPrivate = {
      name: 'all-private-flow',
      nodes: [{ id: 'only', agent: 'fde', task: '唯一节点', visibility: 'private' as const }],
    };
    await workflowCreate({ workflow: allPrivate, owner: 'owner-a' }, dir);
    const r = await workflowExport({ workflow_id: 'all-private-flow', enterprise: 'ent-a', data_dir: dir });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.code).toBe('empty-after-strip');
  });

  it('export→import 全链：导入成功 + 血缘回溯源企业/源版本（验收 ②③）', async () => {
    const exp = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    expect(exp.data.isError).toBe(false);
    // 跨企业导入（另一个 dataDir = 另一家企业）
    const targetDir = mkDataDir();
    const imp = await workflowImport({ bundle: exp.data.bundle!, owner: 'partner-user', actor: 'partner-user', data_dir: targetDir });
    expect(imp.data.isError).toBe(false);
    expect(imp.data.importedAs).toBe('partner-flow-imported');
    expect(imp.data.version).toBe(1);
    // 血缘回溯（验收 ③）：源企业 ent-a / 源版本 1 在谱系里
    const trace = imp.data.lineageTrace!;
    expect(trace.length).toBeGreaterThanOrEqual(1);
    expect(trace.some((a) => a.enterprise === 'ent-a' && a.version === 1)).toBe(true);
    // 落地可读（trunk 存在）
    expect(fs.existsSync(path.join(targetDir, 'workflow-store', 'partner-flow-imported.json'))).toBe(true);
  });

  it('导入 schema 校验门：非法模板拒绝（fail-closed，验收 ②）', async () => {
    const exp = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    const bundle = { ...exp.data.bundle! };
    // 篡改 workflow.yml 为非法文档（nodes 空数组）+ 同步 manifest 摘要（过完整性闸后卡 schema 闸）
    const badYml = 'name: bad\nnodes: []\n';
    const badBundle = { ...bundle, 'workflow.yml': badYml } as Record<string, unknown>;
    const manifest = { ...(badBundle['manifest'] as Record<string, unknown>) };
    const files = { ...(manifest['files'] as Record<string, string>) };
    const crypto = await import('crypto');
    files['workflow.yml'] = crypto.createHash('sha256').update(badYml, 'utf-8').digest('hex');
    manifest['files'] = files;
    badBundle['manifest'] = manifest;
    const r = await workflowImport({ bundle: badBundle, data_dir: mkDataDir() });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.code).toBe('schema-gate');
  });

  it('导入完整性核对：manifest 摘要与内容不符 → 拒绝（篡改检测）', async () => {
    const exp = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    const tampered = { ...exp.data.bundle!, 'workflow.yml': 'name: tampered\nnodes:\n  - id: x\n    agent: y\n    task: z\n' } as Record<string, unknown>;
    const r = await workflowImport({ bundle: tampered, data_dir: mkDataDir() });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.code).toBe('integrity-mismatch');
  });

  it('导入私域泄漏加固：包内 private / result-only 节点 → 整包拒绝（验收 ④ 双保险）', async () => {
    // 手工构造「绕过 export 剥离」的包（模拟恶意构造）
    const crypto = await import('crypto');
    const yaml = await import('js-yaml');
    const doc = {
      name: 'leak-attempt',
      nodes: [
        { id: 'n1', agent: 'a', task: 't' },
        { id: 'n2', agent: 'a', task: 't', visibility: 'private' as const },
      ],
    };
    const yml = yaml.dump(doc);
    const manifest = {
      kind: 'sofagent-workflow-template',
      version: 1,
      exportedAt: new Date().toISOString(),
      files: { 'workflow.yml': crypto.createHash('sha256').update(yml, 'utf-8').digest('hex') },
      crossTenant: false,
      lineage: { sourceEnterprise: 'evil-co', sourceWorkflowId: 'leak-attempt', sourceVersion: 1, forkDepth: 0, ancestors: [] },
    };
    const r = await workflowImport({ bundle: { manifest, 'workflow.yml': yml }, data_dir: mkDataDir() });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.code).toBe('private-leak');
  });

  it('导入冲突拒绝：imported_as 与本地已有 trunk 同名', async () => {
    const exp = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: dir });
    const targetDir = mkDataDir();
    await workflowCreate({ workflow: BASE_DOC, owner: 'local-owner' }, targetDir);
    const r = await workflowImport({ bundle: exp.data.bundle!, imported_as: 'partner-flow', data_dir: targetDir });
    expect(r.data.isError).toBe(true);
    if (r.data.isError === true) expect(r.data.code).toBe('duplicate-id');
  });

  it('本体合并：bundle 实体新增 / 本地同名保留（本地优先策略）', async () => {
    // 源侧建一个 entity 并让 workflow 引用它
    const srcDir = mkDataDir();
    fs.mkdirSync(path.join(srcDir, 'ontology', 'entities'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'ontology', 'entities', 'customer.yml'), 'name: customer\ntype: customer\ndescription: 客户实体\n', 'utf-8');
    const doc = { ...BASE_DOC, nodes: [{ id: 'serve', agent: 'customer-agent', task: '服务 customer' }] };
    await workflowCreate({ workflow: doc, owner: 'owner-a' }, srcDir);
    // 本地已有同名 entity（内容不同——导入不得覆盖）
    const targetDir = mkDataDir();
    fs.mkdirSync(path.join(targetDir, 'ontology', 'entities'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'ontology', 'entities', 'customer.yml'), 'name: customer\ntype: local-customer\n', 'utf-8');
    const exp = await workflowExport({ workflow_id: 'partner-flow', enterprise: 'ent-a', data_dir: srcDir });
    const imp = await workflowImport({ bundle: exp.data.bundle!, data_dir: targetDir });
    expect(imp.data.isError).toBe(false);
    expect(imp.data.entitiesMerged!.keptLocal).toBe(1);
    expect(imp.data.entitiesMerged!.added).toBe(0);
    const local = fs.readFileSync(path.join(targetDir, 'ontology', 'entities', 'customer.yml'), 'utf-8');
    expect(local).toContain('local-customer'); // 本地优先——未覆盖
  });
});

describe('registry 接线（铁律 9）', () => {
  it('TOOLS 数组含 connector_register / connector_list / workflow_export / workflow_import', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('connector_register');
    expect(names).toContain('connector_list');
    expect(names).toContain('workflow_export');
    expect(names).toContain('workflow_import');
    expect(TOOLS.length).toBe(107);
  });
});

afterAll(() => {
  for (const d of tmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
