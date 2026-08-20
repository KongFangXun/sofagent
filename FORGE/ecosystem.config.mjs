// ============================================================
// FORGE/ecosystem.config.mjs · PM2 进程守护配置
// v1.2.9 功能③：PM2 守护进程
//
// 管理 FORGE 的两个 driver：
//   - fresh-eyes：fresh-eyes-driver.mjs（A/B 双盲独立审查循环）
//   - release-gate：release-gate-driver.mjs（发版闸门验证循环）
//
// 用法（通过 tools/forge/forge-pm2-start.sh 调用）：
//   pm2 start FORGE/ecosystem.config.mjs --only fresh-eyes -- --target v1.2.9
//   pm2 start FORGE/ecosystem.config.mjs --only release-gate -- --target v1.2.9
//   pm2 stop fresh-eyes
//   pm2 logs fresh-eyes
//   pm2 status
//
// 守护参数说明：
//   - autorestart=true：进程退出后自动重启
//   - max_restarts=3：最多重启 3 次（超过后标记为 errored，不再重启）
//   - restart_delay=5000：重启间隔 5 秒（避免快速循环重启）
//   - min_uptime=10000：进程至少运行 10 秒才算"稳定"（短于 10s 退出视为异常崩溃）
//   - max_memory_restart=2G：内存超过 2G 自动重启（防止 OOM）
//   - kill_timeout=10000：SIGTERM 后等 10 秒再 SIGKILL（让 driver 优雅退出）
//
// 环境变量：
//   FORGE_TARGET：验证目标版本号（必填）
//   FORGE_MAX_ROUNDS：fresh-eyes 最大轮数（默认 10）
//   FORGE_SKIP_ACCEPTANCE：release-gate 是否跳过 acceptance 预跑（1/0）
//   FORGE_HOME：SOFAGENT_HOME 路径（默认 ~/.sofagent）
// ============================================================

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

// 公共守护参数——两个 driver 共享
const COMMON_CONFIG = {
  autorestart: true,
  max_restarts: 3,
  restart_delay: 5000,
  min_uptime: 10000,
  max_memory_restart: '2G',
  kill_timeout: 10000,
  // 环境变量继承 + 注入 FORGE 相关变量
  env: {
    NODE_ENV: 'production',
    // SOFAGENT_HOME 透传（PM2 子进程继承父进程环境，这里显式声明便于配置覆盖）
    SOFAGENT_HOME: process.env.SOFAGENT_HOME || join(process.env.HOME || '/tmp', '.sofagent'),
  },
  // 日志输出到 SOFAGENT_HOME/logs/pm2/
  out_file: join(process.env.SOFAGENT_HOME || join(process.env.HOME || '/tmp', '.sofagent'), 'logs', 'pm2', 'forge-out.log'),
  error_file: join(process.env.SOFAGENT_HOME || join(process.env.HOME || '/tmp', '.sofagent'), 'logs', 'pm2', 'forge-error.log'),
  merge_logs: true,
  time: true,
};

export default {
  apps: [
    {
      name: 'fresh-eyes',
      script: join(REPO_ROOT, 'FORGE/src/fresh-eyes-driver.mjs'),
      // 传给 driver 的参数通过 args 传递（PM2 的 -- 分隔符后内容）
      // 实际参数在启动时通过 -- --target vX.Y.Z 注入
      args: process.env.FORGE_TARGET ? `--target ${process.env.FORGE_TARGET} --max-rounds ${process.env.FORGE_MAX_ROUNDS || 10}` : '',
      cwd: REPO_ROOT,
      ...COMMON_CONFIG,
    },
    {
      name: 'release-gate',
      script: join(REPO_ROOT, 'FORGE/src/release-gate-driver.mjs'),
      args: process.env.FORGE_TARGET ? `--target ${process.env.FORGE_TARGET}${process.env.FORGE_SKIP_ACCEPTANCE === '1' ? ' --skip-acceptance' : ''}` : '',
      cwd: REPO_ROOT,
      ...COMMON_CONFIG,
    },
  ],
};
