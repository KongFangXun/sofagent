#!/usr/bin/env node
// daemon CLI · v1.4.4
const args = process.argv.slice(2);
const subcommand = args[0];
const VERSION = '1.4.4';

/**
 * v1.4.0 交付四②：进程自身硬化（process-hardening 启发 · Linux/macOS 先行）
 * - 清 LD_PRELOAD / DYLD_* 环境变量：防 preload 劫持加载恶意 .so/.dylib（代码级有效）
 * - 禁 core dump：进程崩溃不落盘内存镜像（防密钥/敏感数据泄漏）——Node 无原生 setrlimit，
 *   尽力尝试（部分运行时暴露）；生产部署建议 ulimit -c 0 兜底
 * - 禁 ptrace attach：防调试器注入/读取进程内存——Yama 需 root 改系统设置，此处记录边界，
 *   部署侧建议 sysctl kernel.yama.ptrace_scope=1
 */
function preMainHardening(): void {
  // ① 清 preload 注入环境变量（立即生效，防后续 spawn 的子进程继承恶意 preload）
  const preloadKeys = ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH'];
  for (const k of preloadKeys) delete process.env[k];
  // ② 禁 core dump（尽力而为——Node 无标准 setrlimit，运行时暴露则生效）
  try {
    (process as unknown as { setrlimit?: (res: string, lim: { soft: number; hard: number }) => void })
      .setrlimit?.('core', { soft: 0, hard: 0 });
  } catch { /* 权限不足/不支持时忽略，部署侧 ulimit -c 0 兜底 */ }
}

async function main() {
  preMainHardening();
  if (subcommand === '--version') {
    console.log(VERSION);
    process.exit(0);
  }
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
    case 'worklog': {
      // v1.4.0 交付七：TUI 工作明细视图（worklog.json ASCII 渲染）
      const { renderWorklogView } = await import('./dashboard/worklog-view');
      const dataDir = process.env.SOFAGENT_DATA || (process.env.SOFAGENT_HOME || require('os').homedir()) + '/.sofagent/data';
      console.log(renderWorklogView(dataDir + '/dashboard/worklog.json'));
      break;
    }
    case 'decision-tree': {
      // v1.4.0 交付七：对话分支回溯（decisions.jsonl 分支树）
      const { renderDecisionTree } = await import('./dashboard/decision-tree');
      const dataDir = process.env.SOFAGENT_DATA || (process.env.SOFAGENT_HOME || require('os').homedir()) + '/.sofagent/data';
      console.log(renderDecisionTree(dataDir + '/audit/decision-log.jsonl'));
      break;
    }
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
      // --help/-h 在子命令后也打印帮助退出，不误触发真启动（2026-08-18 修复：
      // `start --help` 原先被当未知 flag 忽略直接拉起守护进程）
      if (args.includes('--help') || args.includes('-h')) {
        console.log('sofagent-daemon start — 启动守护进程（cron + 文件监听）');
        console.log('Usage: sofagent-daemon start [--usb-root <path>]');
        process.exit(0);
      }
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

      const { ensureDefaultInspectorsConfig } = await import('./cron');
      const { startWatching } = await import('./fs-watch');
      const { runFilesystemAudit } = await import('./run-fs-audit');

      console.log(`sofagent-daemon v${VERSION} — 启动守护进程`);
      console.log(`  监控目录: ${projectDir}`);
      console.log('');

      // v1.4.5 T1（P0）：首启缺省巡检配置注入——watch.yml 不存在时写入
      // 含 inspectors: / dream-cycle: 缺省段的模板（已有配置不动）。
      if (ensureDefaultInspectorsConfig(projectDir)) {
        console.log('  ✅ 首启已生成 .sofagent/watch.yml 缺省配置（inspectors + dream-cycle）');
      }

      // v1.4.5 T3：注册内置 slash 命令到全局注册表（/compact /goal——
      // core 包 registerBuiltinSlashCommands 此前零生产调用）。经 dist 产物
      // 文件路径动态引入（core barrel 未导出该函数，包 exports 只开放 "."）。
      try {
        const { registerBuiltinSlashCommandsFromCore } = await import('./slash-commands-wiring');
        const registered = await registerBuiltinSlashCommandsFromCore();
        console.log(`  ✅ slash 命令已注册: ${registered.map((c: string) => `/${c}`).join(' ')}`);
      } catch (err) {
        console.warn(`  ⚠️ slash 命令注册失败（不影响 daemon 启动）: ${err instanceof Error ? err.message : String(err)}`);
      }

      // v1.4.4 #32+47：启动即写健康文件（writeHealthFile 此前「诞生即死」——
      // 函数存在但 daemon 主路径零调用，exit 78 死亡无人记录）。心跳每 5min 更新。
      const { writeHealthFile, recordDaemonExit } = await import('./daemon-health');
      writeHealthFile('start');
      const heartbeatTimer = setInterval(() => {
        writeHealthFile('heartbeat');
      }, 5 * 60 * 1000);
      heartbeatTimer.unref?.(); // 计时器不阻止进程退出（退出钩子负责收尾落盘）
      console.log('  ✅ 健康自检已启动（心跳 5min，~/.sofagent/data/daemon-health.json）');

      // v1.4.4 #32+47：退出收尾——任何退出路径都落盘退出码，doctor 才能感知守护死亡
      const exitWith = (code: number, reason: 'sigint' | 'sigterm' | 'uncaught-exception' | 'startup-failure' | 'unknown', detail?: string) => {
        clearInterval(heartbeatTimer);
        try { recordDaemonExit(code, reason, detail); } catch { /* 落盘失败不阻断退出 */ }
        process.exit(code);
      };

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

      // v1.4.5 T4：启动 cron 定时任务——返回实际调度数（0 = 无任何任务被调度，
      // 不再无条件打 ✅ 假绿）。inspectors/dream-cycle 缺省启用故通常 ≥ 2。
      const { startCron, loadInspectorsConfig, loadDreamCycleConfig, loadCronConfig } = await import('./cron');
      const scheduledCount = startCron(projectDir);
      if (scheduledCount > 0) {
        console.log(`  ✅ cron 定时任务已启动（${scheduledCount} 项）`);
      } else {
        const insp = loadInspectorsConfig(projectDir);
        const dream = loadDreamCycleConfig(projectDir);
        const cronJobs = loadCronConfig(projectDir).length;
        // 全部被显式禁用（inspectors.enabled=false + dream-cycle.enabled=false + cron 空）
        console.log(`  ℹ️ cron 无任务可调度（inspectors=${insp.enabled ? 'on' : 'off'} · dream-cycle=${dream.enabled ? 'on' : 'off'} · cron 条目=${cronJobs}）`);
      }

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

      // 优雅退出（v1.4.4 #32+47：落盘退出码 0——正常停止）
      process.on('SIGINT', () => {
        console.log('\n  正在停止守护进程...');
        watcher.stop();
        console.log('  ✅ 已停止');
        exitWith(0, 'sigint');
      });
      process.on('SIGTERM', () => {
        watcher.stop();
        exitWith(0, 'sigterm');
      });
      // v1.4.4 #32+47：未捕获异常 = 守护级致命错误，退出码 78（EX_CONFIG 约定）
      process.on('uncaughtException', (err) => {
        console.error(`  💥 daemon 未捕获异常，退出（exit 78）: ${err.message}`);
        try { watcher.stop(); } catch { /* */ }
        exitWith(78, 'uncaught-exception', err.message);
      });

      // 保持进程运行（心跳定时器已 unref——此空定时器维持事件循环）
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
      // v1.4.4 #32+47：新增 dead 态（exit 78 守护死亡可感知）
      // v1.4.5 T1：新增巡检调度状态（inspectors 三层 + lastSuccessAt）
      // v1.4.5 T9：新增 webhook 告警通道健康 + daemon dist 版本戳校验
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
      } else if (result.status === 'dead') {
        // 守护死亡（exit 78 等）——最高告警级，附退出码与修复指引
        console.log(`💀 ${result.message}`);
        if (result.details) {
          console.log(`  最近错误: ${result.details.lastError ?? '无'}`);
        }
        console.log('  修复: sofagent-daemon start（重启守护进程）');
        process.exit(1);
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

      // ── v1.4.5 T1：巡检调度状态 ──
      console.log('\n── 巡检调度状态 ──');
      const { buildInspectorScheduleReport } = await import('./cron');
      const scheduleReport = buildInspectorScheduleReport(process.cwd());
      if (!scheduleReport.enabled) {
        console.log('  ⏸️  分层巡检已禁用（watch.yml inspectors.enabled=false）');
      } else {
        for (const layer of scheduleReport.layers) {
          const lastRun = layer.lastSuccessAt
            ? new Date(layer.lastSuccessAt).toLocaleString('zh-CN')
            : '从未执行';
          const stale = layer.lastSuccessAt === null
            || (Date.now() - new Date(layer.lastSuccessAt).getTime()) > 2 * 86400_000;
          const icon = layer.lastSuccessAt === null ? '⚠️' : stale ? '⚠️' : '✅';
          console.log(`  ${icon} ${layer.layer}: ${layer.schedule}（最后成功: ${lastRun}${layer.lastSuccessAt === null ? '——巡检从未被调度过' : ''}）`);
        }
      }

      // ── v1.4.5 T9：webhook 告警通道健康 ──
      console.log('\n── Webhook 告警通道健康 ──');
      const { readWebhookChannelHealth } = await import('./webhook/index');
      const webhookHealth = readWebhookChannelHealth();
      if (!webhookHealth) {
        console.log('  ⚠️ 无通道健康记录（daemon 启动后尚无推送，或 daemon 未运行）');
      } else {
        const lastOk = webhookHealth.lastSuccessAt
          ? new Date(webhookHealth.lastSuccessAt).toLocaleString('zh-CN')
          : '从未成功';
        console.log(`  ${webhookHealth.lastError ? '⚠️' : '✅'} 最后成功推送: ${lastOk}`);
        if (webhookHealth.lastError) {
          console.log(`     最近失败: ${webhookHealth.lastError}`);
          console.log('     （失败详情见 data/webhook-fallback.log）');
        }
      }

      // ── v1.4.5 T9：daemon dist 版本戳校验 ──
      console.log('\n── daemon 版本戳校验 ──');
      const { resolveDaemonVersion } = await import('./daemon-health');
      const runtimeVersion = resolveDaemonVersion();
      if (runtimeVersion === 'unknown') {
        console.log('  ⚠️ daemon dist 无法定位 package.json——版本未知（打包异常或文件被裁剪）');
      } else if (runtimeVersion !== VERSION) {
        console.log(`  ⚠️ 版本戳漂移：CLI 入口=${VERSION} / dist 运行时=${runtimeVersion}——dist 与入口不同版本，建议 rebuild（npm run build）`);
      } else {
        console.log(`  ✅ dist 版本戳一致（${runtimeVersion}）`);
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
            // v1.4.5 T4：真实执行——此前硬编码 `() => ({exitCode:0, output:'手动触发完成'})`
            // 假绿（任务从未运行却报成功）。改为把任务 prompt 经 orchestrator loop
            // 真跑一次（spawnSync sub-process，与 cron.ts 既有范式一致），exitCode/
            // output 取真实值。scheduler.trigger 的 runner 是同步签名——先 await
            // 真实执行完成，再把结果作为同步快照传入（历史记录语义不变）。
            const task = sched.get(taskId);
            if (!task) throw new Error(`任务不存在: ${taskId}`);

            console.log(`▶️  执行任务「${task.name}」...`);
            const { execFileSync } = await import('child_process');
            const { createRequire } = await import('module');
            const { join, dirname } = await import('path');
            const nodeRequire = createRequire(__filename);
            let exitCode = 0;
            let output = '';
            try {
              // orchestrator CLI 真身在 dist/cli.js（cron.ts 同款解析范式）
              const orchCli = join(
                dirname(nodeRequire.resolve('@sofagent/orchestrator/package.json')),
                'dist', 'cli.js',
              );
              output = execFileSync(process.execPath, [
                orchCli, 'loop', '--legacy', '--task', task.prompt,
              ], {
                encoding: 'utf-8',
                cwd: process.cwd(),
                timeout: 600000, // 10 分钟超时（手动触发允许长任务）
              });
            } catch (err) {
              // execFileSync 非零退出时 err 含 stdout/stderr
              const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
              exitCode = typeof e.status === 'number' ? e.status : 1;
              output = `${e.stdout ?? ''}${e.stderr ?? e.message}`;
            }
            const run = sched.trigger(taskId, () => ({ exitCode, output: output.trim() || '（无输出）' }));
            console.log(`✅ 已触发 (${run.exitCode === 0 ? '成功' : '失败 exit=' + run.exitCode}): ${run.output.slice(0, 120)}`);
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
  // v1.4.4 #32+47：start 路径启动失败 = 守护级致命错误，落盘 exit 78 后退出。
  // 其他子命令（doctor/snapshot 等）的一次性失败与守护生死无关，不写健康文件。
  if (subcommand === 'start') {
    import('./daemon-health').then(({ recordDaemonExit }) => {
      recordDaemonExit(78, 'startup-failure', err.message);
      process.exit(78);
    }).catch(() => process.exit(78));
  } else {
    process.exit(1);
  }
});
