#!/usr/bin/env node
// evolve CLI · v1.5.6

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-evolve — Skill 质量分析 / 优化建议 / 自动重构');
    console.log('Usage: sofagent-evolve <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  run <path>     运行 Skill 优化（默认内置 native gate，零外部依赖）');
    console.log('  check <path>   扫描 Skill 文件安全性');
    console.log('  propose        生成 DSH 技能更新提案（F14 · v1.5.7——buildProposerPrompt 拼装 + 模型输出安全闸解析）');
    console.log('  skill-health   五维技能健康度（v1.5.7 章四——report 出报告与退役候选 / archive 归档 / restore 回滚）');
    process.exit(0);
  }

  switch (subcommand) {
    case 'propose': {
      // F14（v1.5.7）：proposer 链路接线——此前 buildProposerPrompt /
      // parseProposalWithSafety 只在 barrel 再导出零生产调用（「诞生即死」）。
      // 流程：三源输入 → buildProposerPrompt 拼装（纯函数，可回放）→ 调用方把
      // prompt 交给通用模型 → parseProposalWithSafety 解析输出（安全闸前置——
      // 危险 diff/空 solves/空 diff 一律 safe=false 拒绝，不进 gate 不进 SKILL/）。
      // CLI 形态：--wiki <file>（必填）--impact <file> --failure <file> --output <model-output-file>
      // 两种用法：仅 --wiki = 打印 prompt（交给模型）；带 --output = 解析模型产物出安全裁决。
      const { buildProposerPrompt, parseProposalWithSafety } = await import('./proposer');
      const flag = (name: string): string | undefined => {
        const i = args.indexOf(`--${name}`);
        return i !== -1 ? args[i + 1] : undefined;
      };
      const wikiPath = flag('wiki');
      const outputPath = flag('output');
      const workDir = flag('workdir') ?? process.cwd();

      if (!wikiPath) {
        console.error('❌ propose 需要 --wiki <wiki-index-file> 参数');
        console.error('   用法: sofagent-evolve propose --wiki <file> [--impact <file>] [--failure <file>] [--workdir <dir>]');
        console.error('         sofagent-evolve propose --wiki <file> --output <model-output-file>  # 解析模型产物并安全裁决');
        process.exit(1);
      }

      const { readFileSync } = await import('fs');
      let wikiIndex = '';
      try {
        wikiIndex = readFileSync(wikiPath, 'utf-8');
      } catch (err) {
        console.error(`❌ 无法读取 wiki 索引 ${wikiPath}: ${(err as Error).message}`);
        process.exit(1);
      }
      const impactPath = flag('impact');
      const failurePath = flag('failure');
      if (impactPath && !require('fs').existsSync(impactPath)) {
        console.error(`❌ 无法读取 skill-impact 台账 ${impactPath}`);
        process.exit(1);
      }
      if (failurePath && !require('fs').existsSync(failurePath)) {
        console.error(`❌ 无法读取 failure-ledger ${failurePath}`);
        process.exit(1);
      }

      console.log(`sofagent-evolve v${require('../package.json').version} — DSH 技能更新提案`);

      if (!outputPath) {
        // 用法一：拼装并打印 prompt（调用方交给通用模型执行）
        const prompt = buildProposerPrompt(
          { wikiIndex, skillImpactLedgerPath: impactPath, failureLedgerPath: failurePath },
          workDir,
        );
        console.log(prompt);
        console.error('\nℹ️ 将上方 prompt 交给通用模型，模型输出保存为文件后用 --output <file> 解析');
        break;
      }

      // 用法二：解析模型产物 → 安全闸裁决
      let modelOutput = '';
      try {
        modelOutput = readFileSync(outputPath, 'utf-8');
      } catch (err) {
        console.error(`❌ 无法读取模型产物 ${outputPath}: ${(err as Error).message}`);
        process.exit(1);
      }
      const result = parseProposalWithSafety(modelOutput);
      if (result.proposal === null || result.proposal === undefined) {
        // parse 层拒绝（无 JSON / 坏 JSON）——proposal 为 null，安全裁决即拒绝语义
        console.log(`  安全裁决: ❌ 拒绝进 gate——模型产物无可解析提案（verdict=${result.safety.verdict}）`);
        process.exit(1);
      }
      // 章四遥测闭环（v1.5.7）：提案解析成功即一次技能库使用——落 skill-usage.jsonl
      //   （写入面 recordSkillUsage，五维健康度的 usage/recency 维数据源）。失败不
      //   best-effort 吞错（try 包裹），记录失败不阻断提案链路。
      try {
        const { recordSkillUsage } = await import('./skill-health');
        recordSkillUsage(`propose:${result.proposal.targetSkillPath}`, 'evolve-cli-propose');
      } catch { /* 遥测失败不阻断提案链 */ }
      console.log(`  提案: ${result.proposal.title}`);
      console.log(`  目标: ${result.proposal.targetSkillPath}`);
      console.log(`  溯源: ${result.proposal.solves.length} 条`);
      const rejectReason = result.safe
        ? ''
        : `（拒绝进 gate——verdict=${result.safety.verdict}${result.proposal.solves.length === 0 ? ' · solves 为空' : ''}${result.proposal.diff.length === 0 ? ' · diff 为空' : ''}）`;
      console.log(`  安全裁决: ${result.safe ? '✅ SAFE（可进 gate）' : `❌ ${rejectReason}`}`);
      if (!result.safe) process.exit(1);
      break;
    }
    case 'run': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('❌ run 需要 <path> 参数');
        console.error('   用法: sofagent-evolve run <skill-file-path>');
        process.exit(1);
      }
      const { runEvolve, validateCandidate, isEvolveAvailable } = await import('./evolve-integration');

      if (!isEvolveAvailable()) {
        console.error('❌ 外部 gate CLI 兼容层不可用（SOFAGENT_EVOLVE_GATE=cli 回退路径）。默认使用内置 native gate，无需安装任何外部依赖；如需外部兼容层请参阅 docs/DEVELOPMENT.md。');
        process.exit(1);
      }

      console.log(`sofagent-evolve v${require('../package.json').version} — 运行 Skill 优化`);
      console.log(`  目标: ${targetPath}`);

      const result = runEvolve(targetPath);
      if (!result.success) {
        console.error(`❌ Evolve 运行失败: ${result.error}`);
        process.exit(1);
      }

      console.log(`✅ Evolve 完成`);
      if (result.candidatePath) {
        const validation = validateCandidate(result.candidatePath, targetPath);
        console.log(`  候选文件: ${result.candidatePath}`);
        console.log(`  可替换: ${validation.canReplace ? '✅ 是' : '❌ 否'}`);
        console.log(`  原因: ${validation.reason}`);
        if (validation.scoreDiff !== undefined) {
          console.log(`  分数差: ${validation.scoreDiff > 0 ? '+' : ''}${validation.scoreDiff}`);
        }
      }
      break;
    }
    case 'check': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('❌ check 需要 <path> 参数');
        console.error('   用法: sofagent-evolve check <skill-file-or-dir>');
        process.exit(1);
      }
      const { scanSkillSafety } = await import('./skill-safety-check');

      const mode = args.includes('--json') ? 'json' : args.includes('--quiet') ? 'quiet' : 'terminal';
      console.log(`sofagent-evolve v${require('../package.json').version} — Skill 安全扫描`);
      console.log(`  目标: ${targetPath}`);
      console.log('');

      const result = scanSkillSafety(targetPath, { mode });

      // 退出码：0=SAFE, 1=DANGEROUS, 2=SUSPICIOUS
      if (result.verdict === 'DANGEROUS') {
        process.exit(1);
      } else if (result.verdict === 'SUSPICIOUS') {
        process.exit(2);
      }
      break;
    }
    // v1.5.7 章四：五维技能健康度（SkillOps）——report 出报告 + 退役候选，
    // archive/restore 是退役动作（归档可回滚，人工确认制）
    case 'skill-health': {
      const action = args[1] ?? 'report';
      const skillHealth = await import('./skill-health');

      if (action === 'report') {
        const flag = (name: string): string | undefined => {
          const i = args.indexOf(`--${name}`);
          return i !== -1 ? args[i + 1] : undefined;
        };
        const skillRoot = flag('root');
        const report = skillHealth.generateHealthReport({ skillRoot });
        if (args.includes('--json')) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(skillHealth.renderHealthReport(report));
        }
        process.exit(0);
      }

      if (action === 'archive') {
        // 用法: skill-health archive <path> [--by <operator>] [--root <dir>]
        const targetPath = args[2];
        if (!targetPath) {
          console.error('❌ skill-health archive 需要 <skill-file-path> 参数');
          console.error('   用法: sofagent-evolve skill-health archive <path> [--by <operator>]（人工确认制——先看 report 再确认归档）');
          process.exit(1);
        }
        const byIdx = args.indexOf('--by');
        const confirmedBy = byIdx !== -1 ? (args[byIdx + 1] ?? 'manual') : 'manual';
        const rootIdx = args.indexOf('--root');
        const root = rootIdx !== -1 ? args[rootIdx + 1] : undefined;
        try {
          const entry = skillHealth.archiveSkillWithScore(targetPath, -1, confirmedBy, { skillRoot: root });
          console.log(`✅ 已归档: ${entry.originalPath} → ${entry.archivedAs}（台账 ${skillHealth.resolveArchiveLedgerPath()}，可 skill-health restore 回滚）`);
          process.exit(0);
        } catch (err) {
          console.error(`❌ 归档失败: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      if (action === 'restore') {
        // 用法: skill-health restore [path] [--root <dir>]
        const targetPath = args[2];
        const rootIdx = args.indexOf('--root');
        const root = rootIdx !== -1 ? args[rootIdx + 1] : undefined;
        try {
          const entry = skillHealth.restoreSkill(targetPath, { skillRoot: root });
          console.log(`✅ 已回滚: ${entry.archivedAs} → ${entry.originalPath}`);
          process.exit(0);
        } catch (err) {
          console.error(`❌ 回滚失败: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      console.error(`Unknown skill-health action: ${action}`);
      console.error('Usage: sofagent-evolve skill-health <report|archive|restore> [options]');
      process.exit(1);
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-evolve <run|check|propose|skill-health>');
      process.exit(1);
  }
}

// v1.5.6 章一 · 单入口收敛（兼容期 shim）：直接调用旧命令时提示新入口；
// 被 `sofagent <域>` 路由调用时静默（路由注入 SOFAGENT_SINGLE_ENTRY=1）。
if (process.env.SOFAGENT_SINGLE_ENTRY !== '1') {
  process.stderr.write('[sofagent] 旧命令 `sofagent-evolve` 已收敛到单入口 `sofagent evolve`——本命令进入兼容期（仍可用，下一 minor 版本移除）。\n');
}
main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
