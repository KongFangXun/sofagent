// ============================================================
// verify.ts · v1.3.7 新增：审计证据链验证命令
// --verify-chain: 校验 HMAC hash chain 完整性 + 报告断链位置
// --verify-commit <hash>: 检查某个 commit 是否有对应审计记录
//
// v1.5.2 章二扩展：--verify-chain 同批校验 decision 链（消费既有
// checkDecisionChainDetailed），消除「决策链 100% 带链字段写入但零消费校验」
// 的通道缺口；双链退出码取最严（ok→0 / tampered→2 / unverifiable|insufficient→1）。
// ============================================================

import { existsSync } from 'fs';
import { loadHistory, checkHistoryChainDetailed, getHistoryFilePath } from '../audit-history';
import { checkDecisionChainDetailed } from '../decision-chain';
import { resolveDataDir, getDecisionLogPath } from '@sofagent/core';

/** 链校验结果状态（与 core / chain-kernel 同构） */
type ChainStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

/** 退出码：ok→0 / tampered→2 / unverifiable|insufficient→1 */
type VerifyCode = 0 | 1 | 2;

/**
 * 渲染历史链结论并返回退出码（既有文案逐字保留——demo 幕⑤ 依赖
 * 'HMAC hash chain 完整' 子串）。
 */
function emitHistoryVerdict(
  result: { status: ChainStatus; detail?: string },
  history: ReturnType<typeof loadHistory>,
): VerifyCode {
  switch (result.status) {
    case 'ok':
      console.log('  ✅ HMAC hash chain 完整——所有记录可验证');
      // loadHistory 按时间倒序返回（最新在前；默认窗口最近 100 条）——标签须与排序一致：
      // history[0] = 最新记录；末元素 = 窗口内最早（若历史超 100 条，更早记录被窗口截断，不在此列）。
      console.log(`  最新记录: ${history[0]?.timestamp ?? 'N/A'}`);
      console.log(`  最早记录（最近 ${history.length} 条窗口内）: ${history[history.length - 1]?.timestamp ?? 'N/A'}`);
      return 0;
    case 'tampered':
      console.log('  ❌ HMAC hash chain 断裂——检测到篡改痕迹');
      console.log(`  详情: ${result.detail ?? '未知'}`);
      console.log('\n  可能原因:');
      console.log('    1. secret key 变更 → 预期断裂（见 default 分支「不可复验」说明）');
      console.log('    2. 文件损坏 → 检查 ~/.sofagent/data/audit/history.jsonl');
      console.log('    3. 日志被篡改 → 检查文件修改时间');
      return 2;
    case 'insufficient':
      console.log('  ⚠️ 审计历史不足 2 条，无法构成可验证的防篡改链');
      console.log(`  详情: ${result.detail ?? ''}`);
      return 1;
    default:
      // 'unverifiable' — key/环境漂移
      console.log('  ⚠️ hash chain 不可复验（密钥轮换或环境漂移，非篡改）');
      console.log(`  详情: ${result.detail ?? ''}`);
      console.log('\n  若近期确有密钥轮换记录，可忽略；否则请按疑似签名剥离攻击排查：核对该条目前后的提交者与时间是否异常。');
      console.log('  如非本人操作，请核查 ~/.sofagent-key');
      return 1;
  }
}

/**
 * 渲染决策链结论并返回退出码（与历史侧同口径的三态语义，不另立一套）。
 */
function emitDecisionVerdict(result: { status: ChainStatus; detail?: string }): VerifyCode {
  switch (result.status) {
    case 'ok':
      console.log('  ✅ 决策链 HMAC 完整——所有记录可验证');
      return 0;
    case 'tampered':
      console.log('  ❌ 决策链 HMAC 断裂——检测到篡改痕迹');
      console.log(`  详情: ${result.detail ?? '未知'}`);
      console.log('\n  可能原因:');
      console.log('    1. secret key 变更 → 预期断裂（见「不可复验」说明）');
      console.log('    2. 文件损坏 → 检查 data/audit/decision-log.jsonl');
      console.log('    3. 日志被篡改 → 检查文件修改时间');
      return 2;
    case 'insufficient':
      console.log('  ⚠️ 决策链记录不足 2 条，无法构成可验证的防篡改链');
      console.log(`  详情: ${result.detail ?? ''}`);
      return 1;
    default:
      // 'unverifiable' — key/环境漂移
      console.log('  ⚠️ 决策链 hash chain 不可复验（密钥轮换或环境漂移，非篡改）');
      console.log(`  详情: ${result.detail ?? ''}`);
      return 1;
  }
}

/**
 * --verify-chain：校验 HMAC hash chain 完整性（历史链 + 决策链，双链取最严退出码）。
 */
export function runVerifyChain(): void {
  const history = loadHistory();

  // ── 历史链 ──
  let historyCode: VerifyCode;
  if (history.length === 0) {
    // v1.3.5 #27: 空历史不再 exit 0——「校验通过」的语义陷阱：
    // 删光 history.jsonl 的攻击者跑校验会得到绿灯。对齐 runVerifyCommit 的 exit 1。
    // 两种空态（文件不存在 / 文件存在但 0 行）loadHistory 均返回 []，此处统一处理。
    console.log('  ⚠️ 审计历史为空——若你曾有审计记录，历史可能被清空，请核查。');
    console.log('  （全新安装且从未运行过审计时为正常状态）');
    console.log('  路径：' + getHistoryFilePath());
    historyCode = 1;
  } else {
    console.log(`\n  审计历史共 ${history.length} 条记录\n`);
    try {
      // v1.2.9 传 data 根目录（~/.sofagent/data），而非 audit 目录。
      // getHistoryFilePath 内部再拼 'audit/history.jsonl'。
      // 此前误传 resolveAuditDir()（已含 audit/），导致双重拼接成
      // data/audit/audit/history.jsonl（不存在），防篡改信任锚整体失效。
      // ⚠️ 必须与写侧 appendHistory 的指纹口径一致——appendHistory 默认 dataDir=undefined，
      //    故此处同样不传覆盖值（走 AUDIT_HISTORY 默认路径 + 空 dataDir 指纹），
      //    否则 getEnvFingerprint 会把路径差异算进 HMAC，干净链被误判 unverifiable。
      historyCode = emitHistoryVerdict(checkHistoryChainDetailed(), history);
    } catch (err) {
      console.error(`❌ 链验证异常: ${err instanceof Error ? err.message : String(err)}`);
      historyCode = 2;
    }
  }

  // ── 决策链（v1.5.2 章二扩展）──
  // 消费既有 checkDecisionChainDetailed（decision-chain.ts → chain-kernel.verifyChain），
  // 输出走与历史侧同口径的三态语义，退出码双链取最严。
  //
  // 决策链文件不存在 = 该链未启用（全新安装 / 从未触发 emitDecision 属正常）——
  // 如实说明且**不影响退出码**。与「历史链为空」刻意区分：history 被清空是可疑事件
  //（可能为抹除证据面），而 decision-log 从未写入不构成任何证据面，不应把正常态误报为异常。
  let decisionCode: VerifyCode;
  const decisionPath = getDecisionLogPath();
  if (!existsSync(decisionPath)) {
    console.log('\n  决策链：无决策日志——该链未启用，跳过决策链校验');
    console.log('  路径：' + decisionPath);
    decisionCode = 0;
  } else {
    console.log('\n  ── 决策链 ──\n');
    try {
      decisionCode = emitDecisionVerdict(checkDecisionChainDetailed());
    } catch (err) {
      console.error(`❌ 决策链验证异常: ${err instanceof Error ? err.message : String(err)}`);
      decisionCode = 2;
    }
  }

  // ── 双链取最严 ──
  const finalCode: VerifyCode = historyCode > decisionCode ? historyCode : decisionCode;
  if (finalCode === 0) {
    console.log('\n  结论：✅ 链完整');
  } else if (finalCode === 2) {
    console.log('\n  结论：❌ 检测到链异常（篡改或链头不符）');
  } else {
    console.log('\n  结论：⚠️ 链不可完全复验或记录不足');
  }
  process.exit(finalCode);
}

/**
 * --verify-commit <hash>：检查某个 commit 是否有对应审计记录
 */
export function runVerifyCommit(commitHash: string): void {
  const history = loadHistory();

  if (history.length === 0) {
    console.log('无审计历史记录。');
    process.exit(1);
  }

  // F-32：退出码按命中最严状态（判据照抄路径② F-15 先例，三路径统一）——
  // 含 FAIL(exit≥2) 记录 → exit 2；仅 WARN → exit 1；全 PASS → exit 0。
  // 此前路径 0/① 无条件 exit(0)：CI 写 `verify-commit <sha> && echo pass` 即把
  // 被拦密钥的提交洗白。
  const worstStatusOf = (entries: { exitCode?: number }[]): 0 | 1 | 2 => {
    let worst: 0 | 1 | 2 = 0;
    for (const e of entries) {
      const c = e.exitCode ?? 0;
      if (c >= 2) return 2;
      if (c === 1) worst = 1;
    }
    return worst;
  };

  // 搜索匹配的 commit hash（支持短 hash 前缀匹配）
  const normalizedHash = commitHash.toLowerCase();
  const matched = history.filter((entry) => {
    const entryCommit = (entry.commitSha || '').toLowerCase();
    return entryCommit === normalizedHash || entryCommit.startsWith(normalizedHash);
  });

  if (matched.length > 0) {
    console.log(`  ${worstStatusOf(matched) === 0 ? '✅' : worstStatusOf(matched) === 1 ? '⚠️' : '❌'} commit ${commitHash} 有 ${matched.length} 条审计记录:`);
    for (const entry of matched) {
      const status = entry.exitCode === 0 ? 'PASS' : entry.exitCode === 1 ? 'WARN' : 'FAIL';
      console.log(`    ${entry.timestamp} · ${status} · ${entry.ruleResults?.length ?? 0} 条规则检查`);
    }
    process.exit(worstStatusOf(matched));
  }

  // v1.2.9 parentSha fallback——commit-msg hook 在 commit 对象生成前运行，
  // 记录的 parentSha 是「审计时 HEAD」，即正在创建的 commit 的**父提交**。
  // 因此用户传入「某 commit 的 SHA X」时，对应的 pre-commit 审计记录
  // parentSha = parentOf(X)，而非 X 本身。精确 commitSha 未命中时：
  //   ① 解析 X 的父提交（git rev-parse X^），对 pre-commit 记录按 parentSha 匹配；
  //   ② 兼容直接传父提交 SHA 的场景——parentSha 也尝试与 X 本身比对。
  // 向后兼容：旧记录无 parentSha/commitPhase 字段时 fallback 不生效，行为不变。
  //
  // v1.3.7 F-15 收紧：路径②存在归因歧义——commit N 的 SHA 天然是 commit N+1
  // 审计记录的 parentSha，--no-verify 绕过提交 B 后紧跟的正常提交 C 会让
  // verify-commit B 命中 C 的审计记录（B 从未被审计却拿到绿灯，「洗白」）。
  // 路径②无法区分「用户传了父提交 SHA」与「用户传了绕过 commit 的 SHA」——
  // 两者都无正向证据证明 X 本身被审计过。故路径②命中时不再放绿灯：
  // 输出警示性中性结果 + EXIT=1，提示用精确 commitSha 或路径①口径确认。
  // 路径 0（commitSha 精确匹配）与路径①（parentSha === parentOf(X)）不受影响——
  // 它们分别有「记录 commitSha=X」与「C 的记录确实审计了 C 的内容」的正向证据。
  let queriedParentSha = '';
  try {
    const { execFileSync } = require('child_process');
    queriedParentSha = execFileSync('git', ['rev-parse', `${commitHash}^`], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().toLowerCase();
  } catch {
    // 非 git 仓库 / SHA 不存在 / 首次提交无父提交——fallback 仅用 X 本身比对
    queriedParentSha = '';
  }

  // 路径①：parentSha === parentOf(X)（commit-msg 场景的正常匹配路径——
  // 用户传 X，X 的父提交 SHA 与记录 parentSha 一致，该记录审计的正是 X 的内容）
  const parentMatched = history.filter((entry) => {
    if (entry.commitPhase !== 'pre-commit') return false;
    const entryParent = (entry.parentSha || '').toLowerCase();
    if (!entryParent) return false;
    return queriedParentSha && (entryParent === queriedParentSha || queriedParentSha.startsWith(entryParent) || entryParent.startsWith(queriedParentSha));
  });

  if (parentMatched.length > 0) {
    // F-32 归因精度：命中的是 parentOf(X)=记录 parentSha 的 pre-commit 审计——
    // 「X 本身的内容确实被审计过」的正向证据成立，但记录本身可能是「上一次被拦
    // 失败尝试」（exit≥2）。归因语句与退出码解耦：退出码按最严状态，措辞按
    // 最严状态提示「该 commit 的提交尝试曾 FAIL——若当前 HEAD 已含此 SHA，
    // 说明拦截后重试提交成功或曾绕过」。
    const worst = worstStatusOf(parentMatched);
    console.log(`  ${worst === 0 ? '✅' : worst === 1 ? '⚠️' : '❌'} commit ${commitHash} 有 ${parentMatched.length} 条审计记录（pre-commit 阶段记录，按父提交 SHA 匹配）:`);
    for (const entry of parentMatched) {
      const status = entry.exitCode === 0 ? 'PASS' : entry.exitCode === 1 ? 'WARN' : 'FAIL';
      console.log(`    ${entry.timestamp} · ${status} · ${entry.ruleResults?.length ?? 0} 条规则检查`);
    }
    console.log('  说明: 该记录由 commit-msg hook 在提交对象生成前写入，');
    console.log('        parentSha = 审计运行时的 HEAD（即本 commit 的父提交）。');
    if (worst >= 2) {
      console.log(`  ⚠️ 提交尝试的审计结论为 FAIL——若 ${commitHash} 已存在于当前分支，说明拦截后重试成功或曾以 --no-verify 绕过。`);
    }
    process.exit(worst);
  }

  // 路径②：parentSha === X（用户传的 SHA 恰好等于某记录的 parentSha）。
  // 无正向证据（既非 commitSha 精确匹配，也非 parentOf(X) 匹配）——
  // 可能是「X 的子提交的审计」，也可能是「绕过 X 后子提交的补录」，无法区分。
  const selfMatched = history.filter((entry) => {
    if (entry.commitPhase !== 'pre-commit') return false;
    const entryParent = (entry.parentSha || '').toLowerCase();
    if (!entryParent) return false;
    return entryParent === normalizedHash || entryParent.startsWith(normalizedHash);
  });

  if (selfMatched.length > 0) {
    console.log(`  ⚠️ 找到 ${selfMatched.length} 条 parentSha=${commitHash} 的审计记录（pre-commit 阶段）:`);
    for (const entry of selfMatched) {
      const status = entry.exitCode === 0 ? 'PASS' : entry.exitCode === 1 ? 'WARN' : 'FAIL';
      console.log(`    ${entry.timestamp} · ${status} · ${entry.ruleResults?.length ?? 0} 条规则检查`);
    }
    console.log('  说明: 这些记录审计的是 ' + commitHash + ' 的**子提交**内容（parentSha=审计时 HEAD=' + commitHash + '），');
    console.log('        并非 ' + commitHash + ' 本身。存在两种可能：');
    console.log('        a) 你传入的是某次审计时 HEAD 的 SHA（父提交口径）——审计针对其子提交；');
    console.log('        b) ' + commitHash + ' 曾用 --no-verify 绕过审计，之后子提交的审计记录撞上本 SHA。');
    console.log('        若需确认 ' + commitHash + ' 本身被审计，请核对精确 commitSha 匹配（路径 0）');
    console.log('        或按 parentOf(X) 口径（路径①）复核。');
    process.exit(1);
  }

  console.log(`  ❌ commit ${commitHash} 未找到审计记录`);
  console.log('\n  可能原因:');
  console.log('    1. 此 commit 使用了 --no-verify 绕过审计');
  console.log('    2. 此 commit 在审计安装之前产生');
  console.log('    3. commit-msg hook 被删除或失效');
  console.log('    4. commit hash 输入有误');
  process.exit(1);
}
