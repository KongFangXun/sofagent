#!/usr/bin/env node
// ab-test CLI · v1.3.4

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

      // 从 golden-set YAML 加载测试用例
      type EvalTestCase = { id: string; description: string; input: Record<string, unknown>; expected: Record<string, unknown>; tags?: string[] };
      const testCases: EvalTestCase[] = [];

      // 优先读 golden-set YAML（@sofagent/eval 的 golden set）
      const { load: yamlLoad } = await import('js-yaml');
      const { existsSync: exists, readFileSync: read } = await import('fs');
      const { join: joinPath } = await import('path');

      // golden-set 路径解析：--eval-set 参数优先（兼容旧用法），否则默认 eval 包的 golden-set.yaml
      let goldenSetPath: string;
      if (exists(config.evalSet) && !config.evalSet.endsWith('.json')) {
        goldenSetPath = config.evalSet;
      } else {
        // 默认路径：尝试从 @sofagent/eval 包目录下找 golden-set.yaml
        goldenSetPath = joinPath(__dirname, '..', '..', 'eval', 'data', 'golden-set.yaml');
        if (!exists(goldenSetPath)) {
          // fallback：尝试 node_modules 中的路径
          goldenSetPath = joinPath(__dirname, '..', '..', '..', 'engine', 'eval', 'data', 'golden-set.yaml');
        }
      }

      if (exists(goldenSetPath)) {
        try {
          const yamlContent = read(goldenSetPath, 'utf-8');
          const parsed = yamlLoad(yamlContent) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const tc = item as Record<string, unknown>;
              if (tc && tc['id'] && tc['input'] && tc['expected']) {
                testCases.push({
                  id: String(tc['id']),
                  description: String(tc['description'] ?? ''),
                  input: tc['input'] as Record<string, unknown>,
                  expected: tc['expected'] as Record<string, unknown>,
                  tags: Array.isArray(tc['tags']) ? tc['tags'] as string[] : undefined,
                });
              }
            }
          }
        } catch {
          console.error(`⚠️  golden-set YAML 解析失败: ${goldenSetPath}`);
        }
      }

      // 测试用例不足时报错退出（不再 fallback 硬编码默认用例）
      if (testCases.length < config.minSampleSize) {
        console.error(`❌ 测试用例不足（${testCases.length}/${config.minSampleSize}），请提供有效的 golden-set。`);
        console.error(`   golden-set 路径: ${goldenSetPath}`);
        process.exit(1);
      }

      try {
        const result = await runABTest(config, testCases);
        console.log(`  胜出: ${result.winner}`);
        console.log(`  Current 得分:  ${result.currentScore.overall.toFixed(2)}`);
        console.log(`  Candidate 得分: ${result.candidateScore.overall.toFixed(2)}`);
        console.log(`  分差: ${result.margin.toFixed(4)}`);
        console.log(`  连续胜出次数: ${result.consecutiveWins}`);

        // 持久化结果
        const { persistABTestResult } = await import('./persistence');
        persistABTestResult(result);
        console.log(`  结果已保存到 latest.json`);

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
        // 从 golden-set YAML 加载测试用例（与 run 子命令一致）
        type PEvalTestCase = { id: string; description: string; input: Record<string, unknown>; expected: Record<string, unknown>; tags?: string[] };
        const pTestCases: PEvalTestCase[] = [];
        const { load: pyamlLoad } = await import('js-yaml');
        const { existsSync: pexists, readFileSync: pread } = await import('fs');
        const { join: pjoin } = await import('path');
        let pgoldenSetPath = pjoin(__dirname, '..', '..', 'eval', 'data', 'golden-set.yaml');
        if (!pexists(pgoldenSetPath)) {
          pgoldenSetPath = pjoin(__dirname, '..', '..', '..', 'engine', 'eval', 'data', 'golden-set.yaml');
        }
        if (pexists(pgoldenSetPath)) {
          try {
            const parsed = pyamlLoad(pread(pgoldenSetPath, 'utf-8')) as unknown;
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const tc = item as Record<string, unknown>;
                if (tc && tc['id'] && tc['input'] && tc['expected']) {
                  pTestCases.push({
                    id: String(tc['id']),
                    description: String(tc['description'] ?? ''),
                    input: tc['input'] as Record<string, unknown>,
                    expected: tc['expected'] as Record<string, unknown>,
                  });
                }
              }
            }
          } catch {
            console.error(`⚠️  golden-set YAML 解析失败: ${pgoldenSetPath}`);
          }
        }
        if (pTestCases.length < config.minSampleSize) {
          console.error(`❌ 测试用例不足（${pTestCases.length}/${config.minSampleSize}），请提供有效的 golden-set。`);
          process.exit(1);
        }
        const result = await runABTest(config, pTestCases);
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
