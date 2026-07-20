#!/usr/bin/env node
// ab-test CLI · v1.1.7

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-ab-test — A/B 测试框架 / 对比实验 / 指标显著性 / 实验报告');
    console.log('Usage: sofagent-ab-test <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  run      运行 A/B 对比测试');
    console.log('  promote  晋升候选方案为当前方案');
    console.log('');
    console.log('Options:');
    console.log('  --current <path>    当前版本 Agent 定义路径');
    console.log('  --candidate <path>  候选版本 Agent 定义路径');
    console.log('  --eval-set <path>   评估集路径');
    console.log('  --threshold <n>     晋升阈值（默认 2）');
    process.exit(0);
  }

  // 加载类型
  const { existsSync, readdirSync, readFileSync } = await import('fs');
  const { join } = await import('path');
  const { DEFAULT_SCORE_WEIGHTS } = await import('./types');

  switch (subcommand) {
    case 'run': {
      const { runABTest } = await import('./ab-runner');

      const currentIdx = args.indexOf('--current');
      const candidateIdx = args.indexOf('--candidate');
      const evalSetIdx = args.indexOf('--eval-set');
      const thresholdIdx = args.indexOf('--threshold');

      const currentPath = currentIdx !== -1 ? args[currentIdx + 1] : undefined;
      const candidatePath = candidateIdx !== -1 ? args[candidateIdx + 1] : undefined;
      const evalSetPath: string = (evalSetIdx !== -1 && args[evalSetIdx + 1])
        ? args[evalSetIdx + 1] as string
        : './eval-set';
      const promoteThreshold = thresholdIdx !== -1
        ? parseInt(args[thresholdIdx + 1] || '2', 10)
        : 2;

      if (!currentPath || !candidatePath) {
        console.error('❌ run 需要 --current <path> 和 --candidate <path>');
        console.error('   可选: --eval-set <path>  --threshold <n>');
        process.exit(1);
      }

      const config = {
        current: currentPath,
        candidate: candidatePath,
        evalSet: evalSetPath,
        promoteThreshold,
        minSampleSize: 3,
        scoreWeights: DEFAULT_SCORE_WEIGHTS,
      };

      console.log(`sofagent-ab-test v1.1.0 — 运行 A/B 测试`);
      console.log(`  Current:   ${config.current}`);
      console.log(`  Candidate: ${config.candidate}`);
      console.log(`  EvalSet:   ${config.evalSet}`);
      console.log('');

      // 从 eval-set 目录加载测试用例，或使用默认用例
      type EvalTestCase = { id: string; description: string; input: Record<string, unknown>; expected: Record<string, unknown> };
      const testCases: EvalTestCase[] = [];

      if (existsSync(config.evalSet)) {
        try {
          const files = readdirSync(config.evalSet).filter((f) => f.endsWith('.json'));
          for (const file of files) {
            try {
              const content = readFileSync(join(config.evalSet, file), 'utf-8');
              const tc = JSON.parse(content) as EvalTestCase;
              if (tc.id && tc.input) {
                testCases.push(tc);
              }
            } catch {
              // 跳过解析失败的文件
            }
          }
        } catch {
          // 目录不可读
        }
      }

      if (testCases.length < config.minSampleSize) {
        console.log(`⚠️  测试用例不足（${testCases.length}/${config.minSampleSize}），使用默认用例。`);
        testCases.push(
          { id: 'default-1', description: '代码质量分析', input: { task: '分析当前项目的代码质量并给出改进建议' }, expected: {} },
          { id: 'default-2', description: '安全检查', input: { task: '检查项目是否符合安全最佳实践' }, expected: {} },
          { id: 'default-3', description: '文档生成', input: { task: '生成项目结构和依赖关系文档' }, expected: {} },
        );
      }

      try {
        const result = await runABTest(config, testCases);
        console.log(`  胜出: ${result.winner}`);
        console.log(`  Current 得分:  ${result.currentScore.overall.toFixed(2)}`);
        console.log(`  Candidate 得分: ${result.candidateScore.overall.toFixed(2)}`);
        console.log(`  分差: ${result.margin.toFixed(4)}`);
        console.log(`  连续胜出次数: ${result.consecutiveWins}`);

        if (result.winner === 'candidate' && result.consecutiveWins >= config.promoteThreshold) {
          console.log('  ✅ candidate 已达晋升阈值，可执行 promote');
        }
      } catch (err) {
        console.error(`❌ A/B 测试失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    case 'promote': {
      const { runABTest } = await import('./ab-runner');
      const { decidePromotion } = await import('./ab-promoter');

      const currentIdx = args.indexOf('--current');
      const candidateIdx = args.indexOf('--candidate');

      const currentPath = currentIdx !== -1 ? args[currentIdx + 1] : undefined;
      const candidatePath = candidateIdx !== -1 ? args[candidateIdx + 1] : undefined;

      if (!currentPath || !candidatePath) {
        console.error('❌ promote 需要 --current <path> 和 --candidate <path>');
        process.exit(1);
      }

      const config = {
        current: currentPath,
        candidate: candidatePath,
        evalSet: './eval-set',
        promoteThreshold: 2,
        minSampleSize: 3,
        scoreWeights: DEFAULT_SCORE_WEIGHTS,
      };

      console.log(`sofagent-ab-test v1.1.0 — 晋升决策`);
      try {
        const result = await runABTest(config, [
          { id: 'auto-1', description: '代码质量分析', input: { task: '分析当前项目的代码质量并给出改进建议' }, expected: {} },
          { id: 'auto-2', description: '安全检查', input: { task: '检查项目是否符合安全最佳实践' }, expected: {} },
          { id: 'auto-3', description: '文档生成', input: { task: '生成项目结构和依赖关系文档' }, expected: {} },
        ]);
        const decision = decidePromotion(result, [], config);
        if (decision.shouldPromote) {
          console.log(`✅ 晋升决策: 通过 — ${decision.reason}`);
        } else {
          console.log(`❌ 晋升决策: 不通过 — ${decision.reason}`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`❌ 晋升决策失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-ab-test <run|promote>');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
