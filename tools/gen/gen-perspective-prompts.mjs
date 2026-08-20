#!/usr/bin/env node
// ============================================================
// tools/gen-perspective-prompts.mjs
// v1.2.9 功能①：生成 24 个 perspective prompt 文件
//
// 读取 FORGE/playbook/fresh-eyes-review.md 的 12 个视角定义，
// 为每个视角生成 A 版和 B 版两个 prompt 文件（a-check-perspective-N.md / b-check-perspective-N.md）。
//
// A/B 双盲保证：A 和 B 的 prompt 在以下维度有差异：
//   - 身份措辞不同（A="审查者/QA"，B="工程师/独立审查者"）
//   - 工具使用策略引导不同（A 侧重批量读取，B 侧重交叉验证）
//   - 输出格式微调（A 用列表式，B 用表格式）
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '../..');

const PROMPTS_DIR = join(REPO_ROOT, 'FORGE/SKILL/fresh-eyes-loop/prompts');
const PLAYBOOK_PATH = join(REPO_ROOT, 'FORGE/playbook/fresh-eyes-review.md');

const PERSPECTIVES = [
  { id: 1,  name: 'stranger',        label: '陌生人',           emoji: '🧑‍💻' },
  { id: 2,  name: 'enterprise-it',   label: '企业 IT',          emoji: '👔' },
  { id: 3,  name: 'competitor',      label: '竞品',             emoji: '🏗️' },
  { id: 4,  name: 'npm-user',        label: 'npm 用户',         emoji: '📦' },
  { id: 5,  name: 'reviewer',        label: '开源审查员',       emoji: '🔍' },
  { id: 6,  name: 'journey',         label: '用户旅程',         emoji: '🛤️' },
  { id: 7,  name: 'red-team',        label: '红队',             emoji: '🐛' },
  { id: 8,  name: 'detective',       label: '数字侦探',         emoji: '🤖' },
  { id: 9,  name: 'perception',      label: '感知层',           emoji: '👁️' },
  { id: 10, name: 'doc-consistency', label: '文档一致性',       emoji: '📉' },
  { id: 11, name: 'code-reader',     label: '代码审读者',       emoji: '🔬' },
  { id: 12, name: 'file-stranger',   label: '文件结构陌生人',   emoji: '🏗️' },
];

// ─── 从 playbook 提取每个视角的正文 ───

function extractPerspectiveContent(playbookText, perspectiveId) {
  const perspective = PERSPECTIVES.find(p => p.id === perspectiveId);
  if (!perspective) return '';

  // 匹配视角章节：### 🧑‍💻 视角一：陌生人 或 ### 视角一：陌生人
  // 按 --- 分隔符切分
  const perspectiveNames = [
    '视角一', '视角二', '视角三', '视角四', '视角五', '视角六',
    '视角七', '视角八', '视角九', '视角十', '视角十一', '视角十二',
  ];
  const name = perspectiveNames[perspectiveId - 1];

  // 找到该视角的章节起点（### ... 视角N：...）
  const headerRe = new RegExp(`^###\\s+[^\\n]*${name}[：:]`, 'm');
  const match = playbookText.match(headerRe);
  if (!match) return '';

  const startPos = match.index;
  // 从 startPos 开始找到下一个 --- 分隔符或下一个 ### 视角
  const rest = playbookText.slice(startPos);
  // 找到下一个 ### 视角 或 --- 分隔
  const nextSectionRe = /\n---\n|\n###\s+[^\n]*视角/;
  const nextMatch = rest.slice(1).match(nextSectionRe);
  let endPos;
  if (nextMatch) {
    endPos = nextMatch.index + 1;
  } else {
    endPos = rest.length;
  }

  return rest.slice(0, endPos).trim();
}

// ─── 生成单个视角的 prompt 文件 ───

function generatePrompt(role, perspective) {
  const isA = role === 'A';
  const roleLabel = isA ? '审查者 / QA' : '工程师 / 独立审查者';
  const rolePronoun = isA ? '你（A）' : '你（B）';
  const fileName = `${role.toLowerCase()}-check-perspective-${perspective.id}.md`;
  const outputFile = `check-${role.toLowerCase()}-p${perspective.id}.md`;

  // A/B 差异化策略
  const toolStrategy = isA
    ? [
        '**批量读取优先**：一次 `read` 把整个文件读进来，不要分多次读同一个文件的不同部分。',
        '**先看再查**：先 `read` 一个文件确认问题，再 `grep` 验证——不要先全仓 grep 再逐个 read。',
        '**最多 3 次工具调用**：1 次读相关文件 + 1 次验证 + 1 次补充。够用就停。',
      ]
    : [
        '**交叉验证优先**：先 `grep` 定位关键词，再 `read` 上下文确认——先广搜再精读。',
        '**多文件对比**：如果涉及多个文件的对比，逐个 read 后在脑中交叉验证。',
        '**最多 3 次工具调用**：1 次搜索定位 + 1 次读取确认 + 1 次补充验证。够用就停。',
      ];

  const outputFormat = isA
    ? '每条发现一行（列表式）：\n```\n[视角] 文件路径 · 具体描述 · 优先级(P0|P1|P2)\n```'
    : '用表格输出发现（表格式）：\n```\n| 视角 | 文件路径 | 具体描述 | 优先级 |\n|------|---------|---------|--------|\n| XXX  | 路径    | 描述    | P0/P1/P2 |\n```';

  const content = `# prompt · ${role}-check-perspective-${perspective.id}（${roleLabel} · ${perspective.emoji} ${perspective.label}）

> ${rolePronoun}是**${roleLabel}**。这是 fresh-eyes-loop 短任务化审查中的一个**独立视角 worker**。
>
> 你只负责 **${perspective.label}** 这一个视角的审查。不要去看其他视角——你有自己的独立 worker。
> 你与另一位审查者（${isA ? 'B' : 'A'}）是**双盲**——互相不知道对方看到什么。

## 你的身份与心态

${perspective.emoji} **视角${perspective.id}：${perspective.label}**

## 审查纪律（来自 FORGE/playbook/fresh-eyes-review.md）

1. **零上下文**：忘掉"上一个版本修过 X"。你只看当前交付物本身。
2. **相信直觉**：第一反应"不对劲"就是信号——先记下来，后面再验证。
3. **实际动手**：想到就去跑、去读、去试。别停在"我觉得可能有问题"。
4. **不修改代码**：你只报告，不修复。修复是 B（工程师）在 b-fix 阶段的活。
5. **单一视角**：你只审"${perspective.label}"这一个视角。不要越界看其他视角的事。

## 🔴 工具预算（铁律——违反将导致审查成果全部丢失）

你有**最多 12 次工具调用**（软上限），**15 次硬上限**（物理中断）。
这是**短任务**——你只看一个视角，不需要跑遍全仓库。

**工具使用策略：**
${toolStrategy.map(s => `- ${s}`).join('\n')}

- **到第 10 次工具调用时**：立即停止探索，转入写报告。
- **报告优先**：宁可证据不充分（标注 P2"待证实"），也不要因为继续探索导致报告丢失。

## 你要做的事

1. 以 **${perspective.label}** 的身份和心态，审查 sofagent 项目当前交付物。
2. 从这个视角出发，去看你能看到的东西——文件、文档、代码、命令输出。
3. 记录你的发现：每个发现带文件路径、具体描述、优先级。

**${perspective.label}视角的审查方向**（来自 playbook，举例不是清单——你的直觉比清单值钱）：

请参考 \`FORGE/playbook/fresh-eyes-review.md\` 中"视角${perspective.id}：${perspective.label}"章节的具体指引。

## 🔴 铁律：完整报告必须进最终回复（否则发现永久丢失）

你**没有任何写文件工具**。\`${outputFile}\` 是 driver 自动从你的最终回复文本生成的——你不在回复里写的内容，系统就永远丢失。

**因此：**

1. 你的最终回复必须是**完整的${perspective.label}视角审查报告**。
2. **禁止只输出总结段**（如"发现 3 条 P1"）。每条发现都要有明细。
3. 如果这个视角没发现问题，也要写一句整体印象。

## 产物

把报告写到 driver 指定的路径。

${outputFormat}

结尾附一句总评：从${perspective.label}视角看，这个项目给你什么印象？
`;

  return { fileName, content };
}

// ─── 主逻辑 ───

mkdirSync(PROMPTS_DIR, { recursive: true });

const playbookText = readFileSync(PLAYBOOK_PATH, 'utf-8');

let generated = 0;
for (const p of PERSPECTIVES) {
  for (const role of ['A', 'B']) {
    const { fileName, content } = generatePrompt(role, p);
    const filePath = join(PROMPTS_DIR, fileName);
    writeFileSync(filePath, content, 'utf-8');
    generated++;
    console.log(`  ✓ ${fileName}`);
  }
}

console.log(`\n生成完成：${generated} 个 perspective prompt 文件`);
console.log(`输出目录：${PROMPTS_DIR}`);
