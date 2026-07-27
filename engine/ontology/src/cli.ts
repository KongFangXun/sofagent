#!/usr/bin/env node
// ontology CLI · v1.2.1

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-ontology — 领域本体定义 / 场景类型 / 约束类型 / 审计规则注册表');
    console.log('Usage: sofagent-ontology <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  view          生成人类可读的本体视图（Markdown）');
    console.log('  merge         合并 ontology 数据源（entities + workflows + constraints）');
    console.log('  status        检查 ontology 目录状态');
    process.exit(0);
  }

  const projectDir = process.cwd();

  switch (subcommand) {
    case 'view': {
      const { generateOntologyView } = await import('./ontology-view');
      try {
        const output = generateOntologyView(projectDir);
        process.stdout.write(output);
        process.stdout.write('\n');
      } catch (err) {
        console.error(`❌ ontology view 失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    case 'merge': {
      const { mergeOntology } = await import('./merge-engine');
      const sofagentDir = process.env.SOFAGENT_DATA_DIR || '.sofagent';
      try {
        const result = mergeOntology(sofagentDir);
        console.log(`✅ ontology 合并完成`);
        console.log(`   实体: ${result.objects.length}`);
        console.log(`   动作: ${result.actions.length}`);
        console.log(`   约束: ${result.constraints.length}`);
      } catch (err) {
        console.error(`❌ ontology merge 失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    case 'status': {
      const { checkOntologyStatus } = await import('./merge-engine');
      const sofagentDir = process.env.SOFAGENT_DATA_DIR || '.sofagent';
      try {
        const status = checkOntologyStatus(sofagentDir);
        console.log('ontology 目录状态:');
        console.log(`  存在: ${status.exists ? '✅ 是' : '❌ 否'}`);
        console.log(`  新鲜: ${status.fresh ? '✅ 是' : '⚠️  可能需要重新合并'}`);
        console.log(`  实体数: ${status.objectCount}`);
        console.log(`  动作数: ${status.actionCount}`);
        console.log(`  约束数: ${status.constraintCount}`);
      } catch (err) {
        console.error(`❌ ontology status 失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-ontology <view|merge|status>');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
