#!/usr/bin/env node
// ============================================================
// tools/gen-acceptance-shard-prompts.mjs
// v1.2.9 功能①：生成 12 个 acceptance shard prompt + 1 个 consolidate prompt
// ============================================================

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '..');

const PROMPTS_DIR = join(REPO_ROOT, 'FORGE/SKILL/release-gate-loop/prompts');

const TOTAL_SCENARIOS = 148;
const SHARD_COUNT = 12;
const PER_SHARD = Math.ceil(TOTAL_SCENARIOS / SHARD_COUNT);

function computeShards() {
  const shards = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const start = i * PER_SHARD + 1;
    const end = Math.min((i + 1) * PER_SHARD, TOTAL_SCENARIOS);
    if (start > TOTAL_SCENARIOS) break;
    shards.push({ id: i + 1, start, end });
  }
  return shards;
}

const SHARDS = computeShards();

// ─── 生成 shard prompt ───

for (const s of SHARDS) {
  const content = `# prompt · acceptance-shard-${s.id}（分片 ${s.id}/${SHARDS.length} · 场景 S${s.start}~S${s.end}）

> 你是 **V（验证者）**。这是 acceptance-test.sh 分析的**分片 ${s.id}**——你只负责分析场景编号 **S${s.start} 到 S${s.end}** 的测试结果。
>
> v1.2.9 功能①：短任务化——原 acceptance 步骤分析全部 148 个场景，现在拆为 ${SHARDS.length} 个分片，每片约 ${PER_SHARD} 个场景。

## 🔴 铁律：纯只读（release-gate-loop 核心约束）

你**不得创建或修改任何代码或文档文件**。你的任务是验证 + 生成报告，不是修复。

**禁止操作：**
- 禁止使用 write_file / edit_file 等写工具
- 禁止 git commit / git push
- 禁止 npm publish / npm install
- 禁止修改 acceptance-test.sh / 任何源码

**允许操作：**
- 读文件（read_file / grep）
- 写自己的产物文件（driver 从你的最终回复中提取）

## 你要做的事

### 第 1 步：读预跑日志

driver 已经跑完 acceptance-test.sh，完整输出在：
\`{runDir}/acceptance-raw.log\`

### 第 2 步：提取你负责的场景

从日志中提取场景编号 **S${s.start} 到 S${s.end}** 的测试结果。

日志中每个场景以 \`━━━ 场景 N: 标题 ━━━\` 格式标记。你只需要关注编号在 ${s.start}-${s.end} 范围内的场景。

对每个场景提取：
- **场景编号**（如 S0${s.start < 100 ? s.start : s.start}）
- **场景名称**
- **结果**（✅ PASS / ❌ FAIL）
- **失败原因**（如果 FAIL）

### 第 3 步：如果日志不存在或为空

如果 \`{runDir}/acceptance-raw.log\` 不存在或内容异常，标 **SKIP** 并注明原因。

## 🔴 铁律：完整报告必须进最终回复

driver 从你的**最终回复文本**中提取产物文件内容——你不在回复里写的内容，系统就永远丢失。

## 产物格式

\`\`\`markdown
# Acceptance Test 分片 ${s.id}/${SHARDS.length} 结果（S${s.start}~S${s.end}）

## 执行信息
- 分片范围：S${s.start} ~ S${s.end}（${s.end - s.start + 1} 个场景）
- 通过数：N
- 失败数：N
- SKIP 数：N

## 场景清单

| 场景编号 | 场景名称 | 结果 | 原因 |
|----------|---------|------|------|
| S0${s.start} | xxx | ✅ PASS | |

## 结论
PASS / FAIL / SKIP
\`\`\`
`;

  writeFileSync(join(PROMPTS_DIR, `acceptance-shard-${s.id}.md`), content, 'utf-8');
  console.log(`  ✓ acceptance-shard-${s.id}.md`);
}

// ─── 生成 consolidate prompt ───

const shardInputList = SHARDS.map(s => `acceptance-s${s.id}.md`).join(' / ');

const consolidateContent = `# prompt · acceptance-consolidate（合并 ${SHARDS.length} 份分片报告 → acceptance.md）

> 你是 **V（验证者）**。这是 acceptance 分析的**合并步骤**：合并 ${SHARDS.length} 份分片报告，产出单份 acceptance.md。
>
> v1.2.9 功能①：短任务化——原 acceptance 步骤分析全部 148 个场景，现在拆为 ${SHARDS.length} 个分片并行分析，此步骤负责合并。

## 输入（driver 已中转给你）

以下 ${SHARDS.length} 份分片报告：
- ${shardInputList}

## 🔴 铁律：纯只读 + 禁止探索项目源码

你的任务是**整合 ${SHARDS.length} 份分片报告**，不是重新分析日志。

1. **只读 acceptance-s*.md**（共 ${SHARDS.length} 份）——这是你唯一需要的输入。
2. **禁止探索项目源码**。
3. **禁止重新读 acceptance-raw.log**——分片已经分析过了，你只做整合。

## 你要做的事

1. 读 ${SHARDS.length} 份分片报告，提取各自的结论（PASS/FAIL）和数据（通过/失败/SKIP 数）。
2. 综合判定：
   - 全部分片 PASS → 综合 PASS
   - 任一分片 FAIL → 综合 FAIL
3. 汇总失败场景清单。

## 产物格式

\`\`\`markdown
# Acceptance Test 结果

## 执行信息
- 命令：\`bash FORGE/playbook/acceptance-test.sh\`（driver 预跑）
- 退出码：N
- 场景总数：${TOTAL_SCENARIOS}
- 通过数：N
- 失败数：N
- SKIP 数：N

## 分片汇总

| 分片 | 场景范围 | 通过 | 失败 | SKIP |
|------|---------|------|------|------|
| 1 | S1-S${SHARDS[0].end} | N | N | N |

## 失败场景清单（如有）

| 场景编号 | 场景名称 | 原因 |
|----------|---------|------|
| S045 | xxx | yyy |

## 结论
PASS / FAIL / SKIP
\`\`\`
`;

writeFileSync(join(PROMPTS_DIR, 'acceptance-consolidate.md'), consolidateContent, 'utf-8');
console.log(`  ✓ acceptance-consolidate.md`);

console.log(`\n生成完成：${SHARDS.length} 个 shard prompt + 1 个 consolidate prompt`);
