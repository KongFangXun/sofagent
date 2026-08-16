#!/usr/bin/env node
// ============================================================
// client-audit.mjs · FDE 进场审计问卷脚本（v1.3.5 交付 5 #5）
// ============================================================
//
// 用法：
//   node tools/client-audit.mjs --industry <行业>          输出该行业问卷（Markdown）
//   node tools/client-audit.mjs --list                     列出支持的行业
//
// 行业模板：tools/audit-questionnaires/<industry>.json
//   每行业 15-20 题，三段式：审计现状 / 痛点定位 / 合规要求
//
// 零依赖（纯 node）——读模板拼装输出，FDE 进场第一步替代纯人脑访谈。
// 内容来源：v1.3.2 企业 eval 三行业（金融/制造/供应链）扩展 +
//   FDE/GUIDE.md 诊断维度映射（五要素 / 业务四问 / 成熟度三级）。
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, 'audit-questionnaires');

// ── 参数解析 ──

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--industry' && argv[i + 1]) {
      i++;
      args.industry = argv[i];
    } else if (a === '--list') {
      args.list = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.log(`sofagent client-audit · FDE 进场审计问卷生成器

用法:
  node tools/client-audit.mjs --industry <行业>   输出该行业问卷（Markdown）
  node tools/client-audit.mjs --list             列出支持的行业
  node tools/client-audit.mjs --help             本帮助

行业别名: finance=金融, manufacturing=制造, supplychain=供应链,
          healthcare=医疗, government=政务, retail=零售, generic=通用
中文名与英文名均可（--industry 金融 等价 --industry finance）`);
}

// 中文名 ↔ 英文标准名映射
const INDUSTRY_ALIASES = {
  finance: 'finance', 金融: 'finance',
  manufacturing: 'manufacturing', 制造: 'manufacturing',
  supplychain: 'supplychain', 供应链: 'supplychain',
  healthcare: 'healthcare', 医疗: 'healthcare',
  government: 'government', 政务: 'government',
  retail: 'retail', 零售: 'retail',
  generic: 'generic', 通用: 'generic',
};

function listIndustries() {
  const canonical = [
    ['finance', '金融'],
    ['manufacturing', '制造'],
    ['supplychain', '供应链'],
    ['healthcare', '医疗'],
    ['government', '政务'],
    ['retail', '零售'],
    ['generic', '通用'],
  ];
  console.log('支持的行业（--industry <英文|中文>）:');
  for (const [en, zh] of canonical) {
    const templatePath = join(TEMPLATE_DIR, `${en}.json`);
    const exists = existsSync(templatePath);
    let count = '';
    if (exists) {
      try {
        const tpl = JSON.parse(readFileSync(templatePath, 'utf-8'));
        const total = tpl.sections.reduce((sum, s) => sum + s.questions.length, 0);
        count = ` · ${total} 题`;
      } catch {
        count = ' · (模板解析失败)';
      }
    } else {
      count = ' · (模板缺失)';
    }
    console.log(`  ${en.padEnd(16)} ${zh}${count}`);
  }
}

// ── 问卷渲染 ──

function renderQuestionnaire(tpl) {
  const lines = [];
  lines.push(`# ${tpl.industryLabel}企业 AI 进场审计问卷`);
  lines.push('');
  lines.push(`> sofagent client-audit v1.3.5 · 自动生成 · ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`> FDE 进场第一步——替代纯人脑访谈，产出直接映射五要素/业务四问诊断维度`);
  lines.push('');
  lines.push(`**受访对象建议**: ${tpl.interviewee}`);
  lines.push(`**预计时长**: ${tpl.duration}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  let qNum = 0;
  for (const section of tpl.sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    if (section.intro) {
      lines.push(`_${section.intro}_`);
      lines.push('');
    }
    for (const q of section.questions) {
      qNum += 1;
      lines.push(`**Q${qNum}. ${q.q}**`);
      if (q.hint) lines.push(`   > 追问提示: ${q.hint}`);
      lines.push('   答: ________________________________________________');
      lines.push('');
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## FDE 填写区（访谈后回填）');
  lines.push('');
  lines.push('| 诊断维度 | 结论 |');
  lines.push('|----------|------|');
  lines.push('| 主战场（哪个部门先上） | |');
  lines.push('| 五要素-任务描述 | |');
  lines.push('| 五要素-执行角色 | |');
  lines.push('| 五要素-数据边界 | |');
  lines.push('| 五要素-质量判据 | |');
  lines.push('| 五要素-人审点 | |');
  lines.push('| 成熟度台阶（1 数据 / 2 流程 / 3 判断） | |');
  lines.push('| 合规红线（从第三段答案提炼） | |');
  lines.push('');
  return lines.join('\n');
}

// ── 主流程 ──

function main() {
  const args = parseArgs(process.argv);

  if (args.help || Object.keys(args).length === 1) {
    usage();
    process.exit(0);
  }

  if (args.list) {
    listIndustries();
    process.exit(0);
  }

  if (!args.industry) {
    console.error('❌ 缺少 --industry 参数（--list 查看支持的行业）');
    usage();
    process.exit(1);
  }

  const canonical = INDUSTRY_ALIASES[args.industry] ?? INDUSTRY_ALIASES[args.industry.toLowerCase()];
  if (!canonical) {
    console.error(`❌ 不支持的行业: ${args.industry}`);
    console.error('   运行 --list 查看支持的行业列表');
    process.exit(1);
  }

  const templatePath = join(TEMPLATE_DIR, `${canonical}.json`);
  if (!existsSync(templatePath)) {
    console.error(`❌ 问卷模板缺失: ${templatePath}`);
    process.exit(1);
  }

  let tpl;
  try {
    tpl = JSON.parse(readFileSync(templatePath, 'utf-8'));
  } catch (err) {
    console.error(`❌ 模板解析失败: ${err.message}`);
    process.exit(1);
  }

  // 结构校验（sections[].questions[].q 最小完备）
  if (!Array.isArray(tpl.sections) || tpl.sections.length === 0) {
    console.error('❌ 模板结构非法（sections 为空）');
    process.exit(1);
  }
  for (const s of tpl.sections) {
    if (!Array.isArray(s.questions) || s.questions.length === 0) {
      console.error(`❌ 模板结构非法（段落 "${s.title}" 无题目）`);
      process.exit(1);
    }
  }

  const total = tpl.sections.reduce((sum, s) => sum + s.questions.length, 0);
  process.stderr.write(`[client-audit] 行业=${canonical} · ${tpl.sections.length} 段 · ${total} 题\n`);
  console.log(renderQuestionnaire(tpl));
}

main();
