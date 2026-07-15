#!/usr/bin/env node
// daemon CLI · v1.1.1
const args = process.argv.slice(2);
const subcommand = args[0];
const VERSION = '1.1.1';

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-daemon — 持续审计 / 文件监听 / 自动修复循环');
    console.log('Usage: sofagent-daemon <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  start                        启动守护进程（cron + 文件监听）');
    console.log('  snapshot list                列出所有快照');
    console.log('  snapshot restore <sha>       恢复到指定快照');
    process.exit(0);
  }

  switch (subcommand) {
    case 'start': {
      const projectDir = process.cwd();
      const { startCron } = await import('./cron');
      const { startWatching } = await import('./fs-watch');
      const { runFilesystemAudit } = await import('./run-fs-audit');

      console.log(`sofagent-daemon v${VERSION} — 启动守护进程`);
      console.log(`  监控目录: ${projectDir}`);
      console.log('');

      // 启动 cron 定时任务
      startCron(projectDir);
      console.log('  ✅ cron 定时任务已启动');

      // 启动文件监听（变更后触发审计）
      const watcher = startWatching(projectDir, (changedFiles) => {
        console.log(`  📁 检测到 ${changedFiles.length} 个文件变更`);
        const result = runFilesystemAudit(changedFiles, projectDir);
        if (result.exitCode > 0) {
          console.warn(`  ⚠️  审计发现问题: ${result.rules.filter((r) => r.status !== 'PASS').length} 项`);
          for (const rule of result.rules.filter((r) => r.status !== 'PASS')) {
            console.warn(`     ${rule.status === 'FAIL' ? '❌' : '⚠️'} ${rule.name}`);
          }
        } else {
          console.log('  ✅ 审计通过');
        }
      });
      console.log('  ✅ 文件监听已启动');
      console.log('');
      console.log('  守护进程运行中... (Ctrl+C 停止)');

      // 优雅退出
      process.on('SIGINT', () => {
        console.log('\n  正在停止守护进程...');
        watcher.stop();
        console.log('  ✅ 已停止');
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        watcher.stop();
        process.exit(0);
      });

      // 保持进程运行
      setInterval(() => {}, 60000);
      break;
    }
    case 'snapshot': {
      const action = args[1];
      const projectDir = process.cwd();

      switch (action) {
        case 'list': {
          const { listAllSnapshots } = await import('./snapshot');
          const snapshots = listAllSnapshots(projectDir);
          if (snapshots.length === 0) {
            console.log('暂无快照。运行审计后会自动创建快照。');
          } else {
            for (const snap of snapshots) {
              const time = new Date(snap.timestamp).toLocaleString('zh-CN');
              console.log(`${time}  ${snap.shortSha}  ${snap.fileCount} 文件`);
            }
            console.log(`\n  共 ${snapshots.length} 条快照`);
          }
          break;
        }
        case 'restore': {
          const sha = args[2];
          if (!sha) {
            console.error('❌ snapshot restore 需要 <sha> 参数');
            process.exit(1);
          }
          if (!process.stdin.isTTY) {
            console.warn('⚠️  非 TTY 环境，自动确认恢复操作');
          }
          const { restoreSnapshot } = await import('./snapshot');
          const restored = restoreSnapshot(projectDir, sha);
          console.log(`✅ 已恢复 ${restored.length} 个文件:`);
          for (const f of restored) {
            console.log(`  → ${f}`);
          }
          break;
        }
        default:
          console.error('❌ 未知 snapshot 子命令: ' + (action || ''));
          console.error('   用法: sofagent-daemon snapshot <list|restore>');
          process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-daemon <start|snapshot> [options]');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
