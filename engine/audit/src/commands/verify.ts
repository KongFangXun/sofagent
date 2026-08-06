// ============================================================
// verify.ts · v1.2.8 新增：审计证据链验证命令
// --verify-chain: 校验 HMAC hash chain 完整性 + 报告断链位置
// --verify-commit <hash>: 检查某个 commit 是否有对应审计记录
// ============================================================

import { loadHistory, checkHistoryChainDetailed } from '../audit-history';
import { resolveAuditDir } from '@sofagent/core';

/**
 * --verify-chain：校验 HMAC hash chain 完整性
 */
export function runVerifyChain(): void {
  const history = loadHistory();

  if (history.length === 0) {
    console.log('无审计历史记录。');
    console.log('运行 sofagent-audit --diff <range> 后会自动记录审计历史。');
    process.exit(0);
  }

  console.log(`\n  审计历史共 ${history.length} 条记录\n`);

  try {
    const dataDir = resolveAuditDir();
    const result = checkHistoryChainDetailed(dataDir);

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
  } else {
    console.log(`  ❌ commit ${commitHash} 未找到审计记录`);
    console.log('\n  可能原因:');
    console.log('    1. 此 commit 使用了 --no-verify 绕过审计');
    console.log('    2. 此 commit 在审计安装之前产生');
    console.log('    3. commit-msg hook 被删除或失效');
    console.log('    4. commit hash 输入有误');
    process.exit(1);
  }
}
