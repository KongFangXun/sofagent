// ============================================================
// FORGE/src/reporters/codebuddy-reporter.mjs · CodeBuddy CLI 适配器
//
// 功能：将 driver 进度事件推送到当前 CodeBuddy / WorkBuddy session。
// 推送粒度：轮次级（仅 run-start / round-end / loop-end）
//
// 检测条件：
//   1. codebuddy 命令存在（which codebuddy）
//   2. 能取到当前 session ID（环境变量 WORKBUDDY_SESSION_ID 或 codebuddy ps）
//
// 使用：
//   const reporter = await createCodebuddyReporter();
//   if (reporter) reporters.push(reporter);
// ============================================================

import { execSync } from 'child_process';

/**
 * 尝试创建 CodeBuddy 适配器。
 * 如果环境不满足（命令不存在 / 无 session），返回 null。
 *
 * @returns {Promise<{name:string, emit:Function}|null>}
 */
export async function createCodebuddyReporter() {
  // 1. 检测 codebuddy 命令是否存在
  if (!commandExists('codebuddy')) {
    return null;
  }

  // 2. 获取当前 session ID
  const sessionId = getSessionId();
  if (!sessionId) {
    return null;
  }

  return {
    name: 'codebuddy',

    /**
     * 接收事件，按轮次级粒度推送到 session。
     * 只推 run-start / round-end / loop-end，避免刷屏。
     */
    emit(event, detail, timestamp) {
      let message = null;

      if (event === 'run-start') {
        message = `🔄 FORGE fresh-eyes-loop 启动\n` +
          `   目标: ${detail.target}\n` +
          `   最大轮数: ${detail.maxRounds}\n` +
          `   目录: ${detail.runDir}`;
      } else if (event === 'round-end') {
        const cleanTag = detail.isClean ? '✅ CLEAN' : '❌ NOT-CLEAN';
        message = `📊 Round ${detail.round} 完成 — ${cleanTag}\n` +
          `   P0=${detail.counts?.p0 ?? '?'} P1=${detail.counts?.p1 ?? '?'} P2=${detail.counts?.p2 ?? '?'}\n` +
          `   ${detail.isClean ? '连续干净轮' : '有问题，进入下一轮'}`;
      } else if (event === 'loop-end') {
        const c = detail.counts || {};
        message = `🏁 FORGE 循环结束\n` +
          `   实际轮数: ${detail.actualRounds}\n` +
          `   停止原因: ${detail.stopReason}\n` +
          `   最终: P0=${c.p0 ?? 0} P1=${c.p1 ?? 0} P2=${c.p2 ?? 0}`;
      }

      if (message) {
        pushToSession(sessionId, message);
      }
    },
  };
}

/**
 * 检测命令是否存在（同步）。
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前 session ID。
 * 优先级：环境变量 > codebuddy ps 解析。
 */
function getSessionId() {
  // 1. 环境变量（最可靠）
  if (process.env.WORKBUDDY_SESSION_ID) {
    return process.env.WORKBUDDY_SESSION_ID;
  }

  // 2. 从 codebuddy ps 解析（取最近活跃的 session）
  try {
    const output = execSync('codebuddy ps --json 2>/dev/null', {
      stdio: 'pipe',
      timeout: 3000,
    }).toString().trim();

    if (!output) return null;

    const sessions = JSON.parse(output);
    if (Array.isArray(sessions) && sessions.length > 0) {
      // 取第一个（最近活跃）
      return sessions[0].id || sessions[0].sessionId || null;
    }
  } catch {
    // codebuddy ps 不可用或解析失败
  }

  return null;
}

/**
 * 推送消息到 CodeBuddy session。
 * 使用 codebuddy -r <sessionId> -p "<message>"
 */
function pushToSession(sessionId, message) {
  try {
    // -r: resume 到指定 session；-p: 发送消息后不等待
    execSync(`codebuddy -r ${sessionId} -p "${message.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      timeout: 10000,
    });
  } catch (err) {
    // 推送失败不中断 driver 主流程
    console.error(`[codebuddy-reporter] 推送失败: ${err.message}`);
  }
}
