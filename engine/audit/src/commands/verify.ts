// ============================================================
// verify.ts · v1.3.7 新增：审计证据链验证命令
// --verify-chain: 校验 HMAC hash chain 完整性 + 报告断链位置
// --verify-commit <hash>: 检查某个 commit 是否有对应审计记录
//
// v1.8.0 章二扩展：--verify-chain 同批校验 decision 链（消费既有
// checkDecisionChainDetailed），消除「决策链 100% 带链字段写入但零消费校验」
// 的通道缺口；双链退出码取最严（ok→0 / tampered→2 / unverifiable|insufficient→1）。
//
// 2026-11 扩展（写入面分段配套）：--verify-chain 增加 `--chain <host|device|test|all>`。
// 背景：单条 decision-log 混着宿主 / 设备 / 测试三种写入面（不同 key 结构性不同），
// 之前只能整链一把验 ⇒ 结论必然是「部分不可复验」，且分不清是哪一面。
// 现在按链分别验、分别报条数与状态——**禁止把三类合并成一个计数**（合并会重造
// 「混合链」假象，那正是要修的缺陷形态）。缺省 `host` 且输出文案与退出码与加本参前
// **逐字一致**（demo 幕⑤ 依赖 'HMAC hash chain 完整' 子串）。
// ============================================================
import { existsSync, readFileSync } from 'fs';
import { loadHistory, checkHistoryChainDetailed, getHistoryFilePath } from '../audit-history';
import { checkDecisionChainDetailed } from '../decision-chain';
import { resolveDataDir, getDecisionLogPath } from '@sofagent/core';

/** 链校验结果状态（与 core / chain-kernel 同构） */
type ChainStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

/** 退出码：ok→0 / tampered→2 / unverifiable|insufficient→1 */
type VerifyCode = 0 | 1 | 2;

/**
 * 可分链校验的三类写入面（顺序固定，报告与计数一律按本顺序逐链输出）。
 * 与 core `AuditChainClass` / audit `DecisionChainClass` 同值域。
 */
const VERIFY_CHAIN_CLASSES = ['host', 'device', 'test'] as const;

/** 单链分类 */
type WriteChainClass = (typeof VERIFY_CHAIN_CLASSES)[number];

/** `--chain` 的合法取值（三链 + all） */
const VALID_CHAIN_SELECTORS: readonly string[] = [...VERIFY_CHAIN_CLASSES, 'all'];

/** 链的人类可读名（报告用） */
const CHAIN_DISPLAY_NAME: Record<WriteChainClass, string> = {
  host: '宿主链 host',
  device: '设备链 device',
  test: '测试链 test',
};

/**
 * 单链校验报告（**分链独立**——条数与状态都是该链自己的读数，绝不跨链相加）。
 * `status: 'empty'` = 该链尚无任何写入（目录或文件不存在，属设备/测试面的常态）。
 */
export interface DecisionChainReport {
  /** 本条报告对应的链 */
  chain: WriteChainClass;
  /** 该链落盘文件绝对路径 */
  filePath: string;
  /** 该链条目数（该文件自身的非空行数；不跨链合并） */
  entries: number;
  /** 该链校验状态；'empty' = 尚无写入 */
  status: ChainStatus | 'empty';
  /** 人类可读说明（'empty' 时为固定文案） */
  detail?: string;
  /** 该链自己的退出码贡献（ok→0 / tampered→2 / 其余→1；'empty'→1） */
  code: VerifyCode;
}

/** 空链固定文案（`--chain device|test` 与 `--chain all` 共用，措辞一致） */
const EMPTY_CHAIN_NOTE = '该链尚无写入（空链）——设备/测试写入面此前可能从未使用，属常态，非异常';

/**
 * 读某链的条目数（非空行数）。
 *
 * 只用于**报告**：判定仍由 checkDecisionChainDetailed 给出（本函数不参与任何结论）。
 * 读不到（文件不存在 / 权限 / IO）一律返回 0——该链随后由调用方按「空链」处理，
 * 与「文件不存在」同一分支，不新增误判可能。
 * @param filePath 该链落盘文件路径
 */
function countChainEntries(filePath: string): number {
  try {
    return readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim() !== '').length;
  } catch {
    // 为何可静默：本条只服务报告读数——读不到即按 0 条处理，该链会走「空链」分支，
    // 结论不由此处决定（判定在 checkDecisionChainDetailed），不隐藏任何异常态。
    return 0;
  }
}

/**
 * 逐链校验并产出**互不合并**的报告（纯函数——不打印、不 exit，便于单测直接断言）。
 *
 * 空链语义按链分工（不得混用同一句话）：
 *   · **host**：文件不存在走判定器既有口径（`insufficient`——「宿主链被清空」是可疑事件，
 *     不能与「设备面从未使用」同话说）；
 *   · **device / test**：文件不存在 = 该写入面尚无写入（`empty`，属常态，非异常）。
 *
 * @param chains 要校验的链（顺序即报告顺序）
 * @param dataDir 可选数据目录覆盖（测试隔离用；缺省走 core 的默认解析链）
 * @returns reports 逐链报告 + code 整体退出码（取最严）
 */
export function collectDecisionChainReports(
  chains: readonly WriteChainClass[],
  dataDir?: string,
): { reports: DecisionChainReport[]; code: VerifyCode } {
  const reports: DecisionChainReport[] = [];
  let code: VerifyCode = 0;
  for (const chain of chains) {
    const filePath = getDecisionLogPath(dataDir, chain);
    if (chain !== 'host' && !existsSync(filePath)) {
      // 分段链空态：设备/测试写入面此前可能从未使用——常态，不是故障
      reports.push({ chain, filePath, entries: 0, status: 'empty', detail: EMPTY_CHAIN_NOTE, code: 1 });
      // 整体退出码**取最严**（不得被空链覆盖成 1——宿主链 tampered=2 时，
      // 后面遇到的空链不得把 2 降级；空链本身只贡献 1）。
      if (code === 0) code = 1 as VerifyCode;
      continue;
    }
    const result = checkDecisionChainDetailed(dataDir, chain);
    const chainCode: VerifyCode = result.status === 'ok' ? 0 : result.status === 'tampered' ? 2 : 1;
    reports.push({
      chain,
      filePath,
      entries: countChainEntries(filePath),
      status: result.status,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      code: chainCode,
    });
    if (chainCode > code) code = chainCode;
  }
  return { reports, code };
}

/** 打印 `--chain` 用法（非法取值时用；与 --help 的输出保持同一措辞） */
function printChainUsage(): void {
  console.error('❌ sofagent 提示：--chain 的取值非法');
  console.error('   用法: sofagent audit --verify-chain [--chain <host|device|test|all>]');
  console.error('     host    只校验宿主链（缺省；含 history.jsonl 与 decision-log.jsonl）');
  console.error('     device  只校验设备写入面 chains/device/decision-log.jsonl');
  console.error('     test    只校验测试写入面 chains/test/decision-log.jsonl');
  console.error('     all     三类链逐链校验并分别报告（条数与状态**不合并**）');
}

/** 状态 → 图标 */
function statusBadge(status: ChainStatus | 'empty'): string {
  if (status === 'ok') return '✅';
  if (status === 'tampered') return '❌';
  if (status === 'empty') return '⚪';
  return '⚠️';
}

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
      // v1.8.0 fresh-eyes F1：ok + 非标准写入行 = 黄绿混合态——链连续性通过，但
      // 存在链字段齐全、缺 exitCode 的旁路写入行；黄级提示、不阻断（exit 0 语义不变）。
      const ns = (result as { nonstandardCount?: number }).nonstandardCount;
      if (typeof ns === 'number' && ns > 0) {
        console.log(`  ⚠️ ${result.detail ?? ''}`);
      }
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
 * --verify-chain：校验 HMAC hash chain 完整性。
 *
 * @param chainArg `--chain` 的取值（host / device / test / all；缺省 host）。
 *   缺省 `host` 时输出文案与退出码与「增加 --chain 之前」**逐字一致**
 *   （历史链 + 决策链双链取最严）；`all` 时三类链逐链独立报告，**计数不合并**。
 *   非法取值 ⇒ 打用法并退出码 1（fail-loud，不静默降级为 host）。
 */
export function runVerifyChain(chainArg?: string): void {
  const selector = chainArg ?? 'host';
  if (!VALID_CHAIN_SELECTORS.includes(selector)) {
    printChainUsage();
    process.exit(1);
  }
  if (selector === 'host') {
    runVerifyChainHost();
    return;
  }
  if (selector === 'all') {
    runVerifyChainAll();
    return;
  }
  runVerifySingleChain(selector as WriteChainClass);
}

/**
 * 缺省（host）路径：历史链 + 决策链双链校验，退出码取最严。
 *
 * ⚠️ 本函数是「加 --chain 之前」的 runVerifyChain 函数体，**逐字保留**——
 * demo 幕⑤ 断言输出含 'HMAC hash chain 完整' 子串，且既有用户/CI 依赖其退出码语义。
 */
function runVerifyChainHost(): void {
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

/** 单链分报告的渲染（all / device / test 三种模式共用同一措辞） */
function emitOneChainReport(report: DecisionChainReport): void {
  console.log(`\n  ── ${CHAIN_DISPLAY_NAME[report.chain]} ──\n`);
  console.log(`  ${statusBadge(report.status)} 状态：${report.status} · 条目：${report.entries} 条`);
  console.log(`  路径：${report.filePath}`);
  if (report.detail !== undefined && report.detail !== '') {
    console.log(`  详情：${report.detail}`);
  }
}

/** 整体结论行（与 host 分支同一措辞族，便于人读对比） */
function emitFinalConclusion(code: VerifyCode): void {
  if (code === 0) {
    console.log('\n  结论：✅ 链完整');
  } else if (code === 2) {
    console.log('\n  结论：❌ 检测到链异常（篡改或链头不符）');
  } else {
    console.log('\n  结论：⚠️ 链不可完全复验或记录不足');
  }
}

/**
 * `--chain all`：三类链**逐链**校验，分链报告条数 / 状态，**不合并计数**。
 *
 * 合并计数是被修的缺陷形态本身：三类链 key 结构性不同，把条数加起来只会得到
 * 一个「看起来很大、实际来源混杂」的数字，读者无法判断哪一面出了问题。
 * 退出码取三链最严（ok→0 / tampered→2 / unverifiable|insufficient|空链→1）。
 */
function runVerifyChainAll(): void {
  console.log('\n  写入面分链校验（--chain all）——三类链逐链报告，条数与状态不合并\n');
  const { reports, code } = collectDecisionChainReports(VERIFY_CHAIN_CLASSES);
  for (const report of reports) emitOneChainReport(report);
  // 只列各链**自身**条数，不给「三链共 N 条」这类合并总数——合并数正是被修的
  // 缺陷形态（三类链 key 结构性不同，加起来只会得到一个来源混杂的数字）。
  console.log(
    `\n  各链条数（仅参考，不作判定）：` +
      reports.map((r) => `${r.chain}=${r.entries}`).join(' / ') +
      '（判定按各链自身状态，见上）',
  );
  emitFinalConclusion(code);
  process.exit(code);
}

/**
 * `--chain device|test`：只校验该链。
 * 链目录 / 文件不存在 ⇒ 明示「该链尚无写入（空链）」并 exit 1，**不报 error**
 * （该写入面从未使用属常态，不是故障）。
 */
function runVerifySingleChain(chain: WriteChainClass): void {
  const { reports, code } = collectDecisionChainReports([chain]);
  const report = reports[0]!;
  if (report.status === 'empty') {
    console.log(`\n  ⚪ ${CHAIN_DISPLAY_NAME[chain]}：${EMPTY_CHAIN_NOTE}`);
    console.log(`  路径：${report.filePath}`);
    console.log('\n  结论：⚠️ 该链无记录可校验（空链）');
    process.exit(1);
  }
  emitOneChainReport(report);
  emitFinalConclusion(code);
  process.exit(code);
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
