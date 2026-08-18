// ============================================================
// verify.ts · v1.3.6 新增：审计证据链验证命令
// --verify-chain: 校验 HMAC hash chain 完整性 + 报告断链位置
// --verify-commit <hash>: 检查某个 commit 是否有对应审计记录
// ============================================================

import { loadHistory, checkHistoryChainDetailed, getHistoryFilePath } from '../audit-history';
import { resolveDataDir } from '@sofagent/core';

/**
 * --verify-chain：校验 HMAC hash chain 完整性
 */
export function runVerifyChain(): void {
  const history = loadHistory();

  if (history.length === 0) {
    // v1.3.5 #27: 空历史不再 exit 0——「校验通过」的语义陷阱：
    // 删光 history.jsonl 的攻击者跑校验会得到绿灯。对齐 runVerifyCommit 的 exit 1。
    // 两种空态（文件不存在 / 文件存在但 0 行）loadHistory 均返回 []，此处统一处理。
    console.log('  ⚠️ 审计历史为空——若你曾有审计记录，历史可能被清空，请核查。');
    console.log('  （全新安装且从未运行过审计时为正常状态）');
    console.log('  路径：' + getHistoryFilePath());
    process.exit(1);
  }

  console.log(`\n  审计历史共 ${history.length} 条记录\n`);

  try {
    // v1.2.9 传 data 根目录（~/.sofagent/data），而非 audit 目录。
    // getHistoryFilePath 内部再拼 'audit/history.jsonl'。
    // 此前误传 resolveAuditDir()（已含 audit/），导致双重拼接成
    // data/audit/audit/history.jsonl（不存在），防篡改信任锚整体失效。
    // ⚠️ 必须与写侧 appendHistory 的指纹口径一致——appendHistory 默认 dataDir=undefined，
    //    故此处同样不传覆盖值（走 AUDIT_HISTORY 默认路径 + 空 dataDir 指纹），
    //    否则 getEnvFingerprint 会把路径差异算进 HMAC，干净链被误判 unverifiable。
    const result = checkHistoryChainDetailed();

    switch (result.status) {
      case 'ok':
        console.log('  ✅ HMAC hash chain 完整——所有记录可验证');
        console.log(`  首条记录: ${history[0]?.timestamp ?? 'N/A'}`);
        console.log(`  末条记录: ${history[history.length - 1]?.timestamp ?? 'N/A'}`);
        process.exit(0);
        break;
      case 'tampered':
        console.log('  ❌ HMAC hash chain 断裂——检测到篡改痕迹');
        console.log(`  详情: ${result.detail ?? '未知'}`);
        console.log('\n  可能原因:');
        console.log('    1. secret key 变更 → sofagent-audit --init --reset-chain');
        console.log('    2. 文件损坏 → 检查 ~/.sofagent/data/audit/history.jsonl');
        console.log('    3. 日志被篡改 → 检查文件修改时间');
        process.exit(2);
        break;
      case 'insufficient':
        console.log('  ⚠️ 审计历史不足 2 条，无法构成可验证的防篡改链');
        console.log(`  详情: ${result.detail ?? ''}`);
        process.exit(1);
        break;
      default:
        // 'unverifiable' — key/环境漂移
        console.log('  ⚠️ hash chain 不可复验（密钥轮换或环境漂移，非篡改）');
        console.log(`  详情: ${result.detail ?? ''}`);
        console.log('\n  如确为本人密钥变更，可忽略。');
        console.log('  如非本人操作，请核查 ~/.sofagent-key');
        console.log('  如需重置: sofagent-audit --init --reset-chain');
        process.exit(1);
        break;
    }
  } catch (err) {
    console.error(`❌ 链验证异常: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
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

  // 搜索匹配的 commit hash（支持短 hash 前缀匹配）
  const normalizedHash = commitHash.toLowerCase();
  const matched = history.filter((entry) => {
    const entryCommit = (entry.commitSha || '').toLowerCase();
    return entryCommit === normalizedHash || entryCommit.startsWith(normalizedHash);
  });

  if (matched.length > 0) {
    console.log(`  ✅ commit ${commitHash} 有 ${matched.length} 条审计记录:`);
    for (const entry of matched) {
      const status = entry.exitCode === 0 ? 'PASS' : entry.exitCode === 1 ? 'WARN' : 'FAIL';
      console.log(`    ${entry.timestamp} · ${status} · ${entry.ruleResults?.length ?? 0} 条规则检查`);
    }
    process.exit(0);
  }

  // v1.2.9 parentSha fallback——commit-msg hook 在 commit 对象生成前运行，
  // 记录的 parentSha 是「审计时 HEAD」，即正在创建的 commit 的**父提交**。
  // 因此用户传入「某 commit 的 SHA X」时，对应的 pre-commit 审计记录
  // parentSha = parentOf(X)，而非 X 本身。精确 commitSha 未命中时：
  //   ① 解析 X 的父提交（git rev-parse X^），对 pre-commit 记录按 parentSha 匹配；
  //   ② 兼容直接传父提交 SHA 的场景——parentSha 也尝试与 X 本身比对。
  // 向后兼容：旧记录无 parentSha/commitPhase 字段时 fallback 不生效，行为不变。
  //
  // parentSha 匹配后叠加 commit 主题消歧，防跨 commit 误认领：
  // commit N 的 SHA 天然是 commit N+1 审计记录的 parentSha——绕过提交 B
  // 之后紧跟的正常提交 C 会让 B 的 verify-commit 命中 C 的审计记录。
  // 消歧规则：记录的 task 字段（hook 写入时来自 commit message 主题行）须与
  // 被验证 commit 的 message 主题行一致才认领；不一致不认领（视为无直接记录）。
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

  // 被验证 commit 的 message 主题行（取不到时为空串，消歧退化为仅按 parentSha）
  let queriedSubject = '';
  try {
    const { execFileSync } = require('child_process');
    queriedSubject = execFileSync('git', ['log', '-1', '--pretty=%s', commitHash], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    queriedSubject = '';
  }

  const parentMatched = history.filter((entry) => {
    if (entry.commitPhase !== 'pre-commit') return false;
    const entryParent = (entry.parentSha || '').toLowerCase();
    if (!entryParent) return false;
    let shaMatch = false;
    // ① parentSha === parentOf(X)（commit-msg 场景的正常匹配路径）
    if (queriedParentSha && (entryParent === queriedParentSha || queriedParentSha.startsWith(entryParent) || entryParent.startsWith(queriedParentSha))) {
      shaMatch = true;
    }
    // ② parentSha === X（用户直接传父提交 SHA 的兼容路径）
    if (!shaMatch && (entryParent === normalizedHash || entryParent.startsWith(normalizedHash))) {
      shaMatch = true;
    }
    if (!shaMatch) return false;
    // SHA 命中后叠加主题行二次校验消歧（双方主题均可得时才强制；旧记录
    // 无 task/commitMsg 或 git 取不到 subject 时不因此拒绝，保持向后兼容）
    if (queriedSubject && queriedSubject !== '') {
      const recordSubject = recordSubjectOf(entry);
      if (recordSubject !== '') return recordSubject === queriedSubject;
    }
    return true;
  });

  if (parentMatched.length > 0) {
    console.log(`  ✅ commit ${commitHash} 有 ${parentMatched.length} 条审计记录（pre-commit 阶段记录，按父提交 SHA + 主题行匹配）:`);
    for (const entry of parentMatched) {
      const status = entry.exitCode === 0 ? 'PASS' : entry.exitCode === 1 ? 'WARN' : 'FAIL';
      console.log(`    ${entry.timestamp} · ${status} · ${entry.ruleResults?.length ?? 0} 条规则检查`);
    }
    console.log('  说明: 该记录由 commit-msg hook 在提交对象生成前写入，');
    console.log('        parentSha = 审计运行时的 HEAD（即本 commit 的父提交）。');
    process.exit(0);
  }

  // parentSha 有候选但主题行均不匹配 → 大概率是 --no-verify 绕过（相邻 commit
  // 的审计记录被 SHA 前缀撞上，但内容对不上），与非命中场景区分提示。
  console.log(`  ❌ commit ${commitHash} 未找到该 commit 的直接审计记录（可能 --no-verify 绕过）`);
  console.log('\n  可能原因:');
  console.log('    1. 此 commit 使用了 --no-verify 绕过审计');
  console.log('    2. 此 commit 在审计安装之前产生');
  console.log('    3. commit-msg hook 被删除或失效');
  console.log('    4. commit hash 输入有误');
  process.exit(1);
}
