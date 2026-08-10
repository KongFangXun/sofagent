#!/usr/bin/env node
// daemon CLI · v1.3.0
const args = process.argv.slice(2);
const subcommand = args[0];
const VERSION = '1.3.0';

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-daemon — 持续审计 / 文件监听 / 自动修复循环');
    console.log('Usage: sofagent-daemon <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  start                        启动守护进程（cron + 文件监听）');
    console.log('                                 [--usb-root <path>] 走 U 盘便携运行时');
    console.log('  create-usb-key               写入 U 盘完整运行时（v1.1.8 新增）');
    console.log('                                 --role <角色> --target <U盘路径> --platform <macos|linux|win>');
    console.log('                                 [--node-binary-path <path>]');
    console.log('  snapshot list                列出所有快照');
    console.log('  snapshot restore <sha>       恢复到指定快照');
    console.log('  knowledge status             聚合知识库状态（Dream Cycle / 健康 / sensitivity）');
    console.log('  scheduler <list|pause|resume|trigger|history|delete>  定时任务管理（v1.2.9）');
    console.log('  doctor                       检查 daemon 健康状态（v1.2.5 §8.4）');
    process.exit(0);
  }

  switch (subcommand) {
    case 'knowledge': {
      const action = args[1];
      const projectDir = process.cwd();
      switch (action) {
        case 'status': {
          // 延迟加载 commands/knowledge-status（避免拖累 CLI 启动）
          const { knowledgeStatus, formatKnowledgeStatus } = await import(
            './commands/knowledge-status'
          );
          const report = knowledgeStatus(projectDir);
          console.log(formatKnowledgeStatus(report));
          break;
        }
        default:
          console.error('❌ 未知 knowledge 子命令: ' + (action || ''));
          console.error('   用法: sofagent-daemon knowledge <status>');
          process.exit(1);
      }
      break;
    }
    case 'start': {
      const projectDir = process.cwd();

      // v1.1.8 新增：--usb-root <path> → U 盘便携运行时（验签 → 内存解密 → 便携化 env）
      const usbRootIdx = args.indexOf('--usb-root');
      if (usbRootIdx !== -1) {
        const usbRoot = args[usbRootIdx + 1];
        if (!usbRoot) {
          console.error('❌ --usb-root 需要 <path> 参数');
          process.exit(1);
        }
        const { startUsbRuntime } = await import('./usb-runtime');
        console.log(`sofagent-daemon v${VERSION} — U 盘便携运行时启动`);
        await startUsbRuntime(usbRoot, projectDir);
        break;
      }

      const { startCron } = await import('./cron');
      const { startWatching } = await import('./fs-watch');
      const { runFilesystemAudit } = await import('./run-fs-audit');

      console.log(`sofagent-daemon v${VERSION} — 启动守护进程`);
      console.log(`  监控目录: ${projectDir}`);
      console.log('');

      // v1.2.1 新增：生成健康报告（替代旧的 daemon-notice.md 非结构化输出）
      const { runHealthReport } = await import('./inspectors/health-reporter');
      const health = runHealthReport(projectDir);
      if (health) {
        console.log(`  💚 健康报告已生成: data/dashboard/daemon-health.json (status=${health.status})`);
      }

      // v1.3.1 交付 4 L1：启动时检查未完成 LOOP graph → 自动续跑（Durable Execution）
      // 容错铁律：续跑检查失败不影响 daemon 启动（观测失败仅告警）。
      try {
        const { resumePendingLoops } = await import('@sofagent/orchestrator');
        const summary = await resumePendingLoops({ silent: true });
        if (summary.resumed > 0) {
          console.log(`  ♻️ LOOP 续跑: 已恢复 ${summary.resumed} 个未完成任务（${summary.results.map((r) => `${r.checkpointId} → ${r.finalStatus}`).join('；')}）`);
        } else if (summary.pending.length > 0) {
          console.log(`  ⏸️ LOOP 续跑: ${summary.pending.length} 个未完成 checkpoint（本次未自动恢复）`);
        } else {
          console.log('  ✅ LOOP 续跑: 无未完成任务');
        }
        if (summary.cleaned > 0) {
          console.log(`  🧹 LOOP 续跑: 已清理 ${summary.cleaned} 个过期 checkpoint`);
        }
      } catch (err) {
        console.warn(`  ⚠️ LOOP 续跑检查失败（不影响 daemon 启动）: ${err instanceof Error ? err.message : String(err)}`);
      }

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
    case 'create-usb-key': {
      // v1.1.8 新增：写入 U 盘完整运行时（延迟加载 usb-key，避免拖累 CLI 启动）
      let role = '';
      let target = '';
      let platform = '';
      let nodeBinaryPath: string | undefined;
      for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
          case '--role': role = args[++i] ?? ''; break;
          case '--target': target = args[++i] ?? ''; break;
          case '--platform': platform = args[++i] ?? ''; break;
          case '--node-binary-path': nodeBinaryPath = args[++i]; break;
        }
      }
      if (!role || !target || !platform) {
        console.error('❌ create-usb-key 需要 --role / --target / --platform 三个参数');
        console.error('   用法: sofagent-daemon create-usb-key --role "财务审计节点" --target /Volumes/SOFAGENT --platform macos');
        process.exit(1);
      }
      if (platform !== 'macos' && platform !== 'linux' && platform !== 'win') {
        console.error(`❌ --platform 必须是 macos / linux / win，实际: ${platform}`);
        process.exit(1);
      }
      const { createUsbKey } = await import('./usb-key');
      console.log(`sofagent-daemon v${VERSION} — 写入 U 盘完整运行时`);
      console.log(`  角色: ${role} · 目标: ${target} · 平台: ${platform}`);
      const result = await createUsbKey({
        role,
        target,
        platform: platform as 'macos' | 'linux' | 'win',
        nodeBinaryPath,
      });
      for (const warning of result.warnings) {
        console.warn(`  ⚠️  ${warning}`);
      }
      console.log(`  ✅ U 盘写入完成：${result.filesWritten} 个文件`);
      console.log(`  ✅ 签名已生成：${result.signatureFile}`);
      console.log(`  ✅ knowledge/ 已 AES-256 加密落盘（明文只在内存）`);
      console.log('');
      console.log('  员工使用：插上 U 盘 → 双击 start（macOS 用 start.command）→ 联邦在线');
      break;
    }
    case 'doctor': {
      // v1.2.5 §8.4：健康自检——读 daemon-health.json 报告 daemon 状态
      const { checkDaemonHealth } = await import('./daemon-health');
      const result = checkDaemonHealth();
      if (result.healthy) {
        console.log(`💚 ${result.message}`);
        if (result.details) {
          console.log(`  PID: ${result.details.pid}`);
          console.log(`  启动时间: ${result.details.startTime}`);
          console.log(`  最后心跳: ${result.details.lastHeartbeat}`);
          console.log(`  最后推送: ${result.details.lastPush ?? '无'}`);
          if (result.details.lastError) {
            console.log(`  最近错误: ${result.details.lastError}`);
          }
        }
      } else {
        console.log(`⚠️ ${result.message}`);
        if (result.details) {
          console.log(`  PID: ${result.details.pid}`);
          console.log(`  最后心跳: ${result.details.lastHeartbeat}`);
          if (result.details.lastError) {
            console.log(`  最近错误: ${result.details.lastError}`);
          }
        }
        process.exit(1);
      }
      break;
    }
    case 'scheduler': {
      // v1.2.9 功能②：定时任务管理
      const action = args[1];
      const taskId = args[2];
      const { createScheduler } = await import('./scheduler');
      const sched = createScheduler();

      switch (action) {
        case 'list': {
          const tasks = sched.list();
          if (tasks.length === 0) {
            console.log('暂无定时任务。');
          } else {
            console.log(`定时任务 (${tasks.length}):`);
            for (const t of tasks) {
              const status = t.status === 'active' ? '✅' : '⏸️';
              const lastRun = t.lastRun ? new Date(t.lastRun).toLocaleString('zh-CN') : '—';
              const nextRun = t.nextRun ? new Date(t.nextRun).toLocaleString('zh-CN') : '—';
              console.log(`  ${status} ${t.id.slice(0, 8)}  ${t.name}  [${t.type}]  last=${lastRun}  next=${nextRun}`);
            }
          }
          break;
        }
        case 'pause': {
          if (!taskId) { console.error('❌ scheduler pause 需要 <task-id>'); process.exit(1); }
          const result = sched.pause(taskId);
          if (result) console.log(`⏸️  已暂停: ${result.name}`); else console.error('❌ 任务不存在');
          break;
        }
        case 'resume': {
          if (!taskId) { console.error('❌ scheduler resume 需要 <task-id>'); process.exit(1); }
          const result = sched.resume(taskId);
          if (result) console.log(`▶️  已恢复: ${result.name}`); else console.error('❌ 任务不存在');
          break;
        }
        case 'trigger': {
          if (!taskId) { console.error('❌ scheduler trigger 需要 <task-id>'); process.exit(1); }
          try {
            const run = sched.trigger(taskId, () => ({ exitCode: 0, output: '手动触发完成' }));
            console.log(`✅ 已触发 (${run.exitCode === 0 ? '成功' : '失败'}): ${run.output}`);
          } catch (err) {
            console.error(`❌ ${(err as Error).message}`);
            process.exit(1);
          }
          break;
        }
        case 'history': {
          if (!taskId) { console.error('❌ scheduler history 需要 <task-id>'); process.exit(1); }
          const runs = sched.history(taskId);
          if (runs.length === 0) {
            console.log('暂无运行历史。');
          } else {
            console.log(`运行历史 (${runs.length}):`);
            for (const r of runs.slice(0, 20)) {
              const time = new Date(r.startedAt).toLocaleString('zh-CN');
              const status = r.exitCode === 0 ? '✅' : '❌';
              console.log(`  ${status} ${time}  exit=${r.exitCode}  ${r.output.slice(0, 60)}`);
            }
          }
          break;
        }
        case 'delete': {
          if (!taskId) { console.error('❌ scheduler delete 需要 <task-id>'); process.exit(1); }
          if (sched.delete(taskId)) console.log('🗑️  已删除'); else console.error('❌ 任务不存在');
          break;
        }
        default:
          console.error('❌ 未知 scheduler 子命令: ' + (action || ''));
          console.error('   用法: sofagent-daemon scheduler <list|pause|resume|trigger|history|delete> [task-id]');
          process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-daemon <start|create-usb-key|snapshot|knowledge|scheduler|doctor> [options]');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
