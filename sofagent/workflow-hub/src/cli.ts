#!/usr/bin/env node
// work模板市场 CLI · v1.1.4

import { listTemplates } from './hub-list';
import { deployTemplate } from './hub-deploy';

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-work模板市场 — 工作流注册 / 模板管理 / 执行历史');
    console.log('Usage: sofagent-work模板市场 <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  list                  列出可用的工作流模板');
    console.log('  deploy <name> [dir]   部署工作流模板到指定目录');
    process.exit(0);
  }

  switch (subcommand) {
    case 'list': {
      const templates = listTemplates();
      console.log('sofagent-work模板市场 v1.1.0');
      console.log('');
      if (templates.length === 0) {
        console.log('暂无可用工作流模板。');
        console.log('');
        console.log('请参考 CATALOG.md 了解可用工作流模板。');
      } else {
        console.log('可用工作流模板:');
        console.log('');
        for (const tpl of templates) {
          console.log(`  ${tpl.name}`);
          console.log(`    ${tpl.description}`);
          console.log(`    ${tpl.path}`);
          console.log('');
        }
      }
      break;
    }
    case 'deploy': {
      const templateName = args[1];
      const projectDir = args[2] || process.cwd();

      if (!templateName) {
        console.error('Error: 请指定要部署的模板名称。');
        console.error('Usage: sofagent-work模板市场 deploy <name> [dir]');
        process.exit(1);
      }

      const result = deployTemplate(templateName, projectDir);
      if (result.success) {
        console.log(result.output);
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-work模板市场 <list|deploy>');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
