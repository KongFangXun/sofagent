// ============================================================
// daily-health.ts · F-47：每日健康巡检挂进 daemon 调度链（L1 @daily）
// ============================================================
// 背景：install.sh:761 与 daemon/templates.ts:29 双处承诺「客户部署第一天就
// 看到的每日产出」，但产物只由 OS cron（可选 flag --with-first-deploy-cron）
// 触发的 engine/scripts/daily-health.sh 生成——默认安装路径零产出。
// 本 inspector 复用同一脚本（execFileSync bash 拉起，产物路径/格式零分叉），
// daemon 在跑 = 产出在累积，不再依赖用户恰好在装时选了 cron flag。
//
// ⚠️ 同步阻塞权衡（显式登记）：execFileSync 会**阻塞** daemon 的巡检调度直到脚本完成
//   （实测空数据目录 1.6s；客户环境数据量大/磁盘慢时更长，上限 120s timeout）。
//   选择同步的理由：产物落盘完成后才返回 → inspector 结果反映真实产物（异步化后
//   只能报「已触发」，失去确定性）。日巡（@daily）不在热路径，故取此权衡；若日后
//   实测阻塞成为问题，改为 detached spawn + 下一轮巡检对账产物即可。
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import type { InspectorResult } from './types';

/**
 * 仓库根（v1.7.1 BUG-24 修复：dist 分支原上三级 = engine/，拼出不存在的
 * engine/engine/scripts/daily-health.sh，仓库态 dist 永远走 SOFAGENT_HOME 兜底）。
 * 实测推演（daemon tsconfig rootDir=./src / outDir=./dist）：tsc 会把 src/ 结构
 * **原样镜像**到 dist/（src/inspectors → dist/inspectors，层级不变），故 src 态与
 * dist 态的 __dirname 深度相同——统一上四级（inspectors → src|dist → daemon →
 * engine → 仓库根）。安装态（~/.sofagent/... 或 node_modules 内）上四级同样到不了
 * 仓库根，但 runDailyHealth 的 existsSync 门会自然落到 $SOFAGENT_HOME/scripts/
 * 兜底（安装态无 engine/scripts 是预期态，非错误）。
 * 导出供测试直测两种形态（BUG-24 验收：src/dist 双形态解析到同一仓库根）。
 */
export function repoRoot(from: string = __dirname): string {
  return join(from, '..', '..', '..', '..');
}

export function runDailyHealth(_dataDir?: string): InspectorResult {
  const script = join(repoRoot(), 'engine', 'scripts', 'daily-health.sh');
  // 解析留痕（BUG-24）：dist 形态曾静默走错兜底——resolved 路径进日志便于巡检对账
  // （日志形态对齐 inspectors 邻居先例：[evolve-trigger] / [health-reporter] 前缀）
  console.log(`[daily-health] 脚本解析：${script}`);
  if (!existsSync(script)) {
    // 安装态：脚本已由 deploy_scripts 拷贝到 ~/.sofagent/scripts/（F-44 同批接线）
    const installed = join(process.env.SOFAGENT_HOME ?? join(process.env.HOME ?? '', '.sofagent'), 'scripts', 'daily-health.sh');
    if (!existsSync(installed)) {
      return { name: 'daily-health', triggered: false, message: 'daily-health.sh 不在（仓库态与安装态均缺失），跳过', severity: 'info' };
    }
    return runScript(installed);
  }
  return runScript(script);
}

function runScript(script: string): InspectorResult {
  try {
    const out = execFileSync('bash', [script], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const produced = /daily-health-\d{4}-\d{2}-\d{2}\.md/.test(out ?? '');
    return {
      name: 'daily-health',
      triggered: true,
      message: produced ? '每日健康报告已产出（dashboard/daily-health-*.md）' : 'daily-health.sh 执行完成（产物见 dashboard 数据目录）',
      severity: 'info',
    };
  } catch (err) {
    return {
      name: 'daily-health',
      triggered: false,
      message: `daily-health 执行失败：${err instanceof Error ? err.message : String(err)}`,
      severity: 'warning',
    };
  }
}
