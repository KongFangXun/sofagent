<!-- gen-abc-draft 产物 · v1.9.0 · 2026-11-11T17:41:20.621Z
     模型：deepseek-flash（单次调用，无工具）
     来源：fresh-eyes 报告、新功能交付清单；跳过：BugFix 清单、复审报告
     ⚠️ 草稿须人工审核后分发——LLM 分类是草稿不是结论（阶段四纪律） -->

# A/B/C 三类清单草稿 v1.9.0

## A 类：新功能审查面

| # | 关键词 | 审查面一句话 | 建议落点 |
|---|--------|-------------|---------|
| 1 | `全候选项分布` / `可信区间` | 三原语（Choice 分布 / Score 可信区间 / Noul 并列概率）是否为纯增量：既有调用方零破坏、布尔执行语义零改动（来源：新功能交付清单 §一） | acceptance |
| 2 | `DecisionChannel` / `降级路径保留` | 三类判定统一路由到判定底座后，底座不可用时是否退回既有确定性实现且行为与今日一致（来源：新功能交付清单 §一） | checklist |
| 3 | `heuristic-weight` / `ordinal-level` | 全部置信度数值是否携带语义标记、标记缺失是否按不可信处理、有无把权重伪装成概率（来源：新功能交付清单 §二） | checklist |
| 4 | `fake-probability-census` | 假概率普查清单是否逐条落盘（位置/值/性质/处置）、数量如实不概括为「若干处」（来源：新功能交付清单 §二勾选依据） | check-version |
| 5 | `assertDomainCalibratedForDecision` / `UncalibratedDomainError` | interface-only 域进决策路径是否 fail-closed 抛错、门禁是否挂 check-calibration-claims（来源：新功能交付清单 §三验收） | check-version |
| 6 | `criteria-domains.test.ts` | 三类判据域（workflow/本体/路由）是否各有 ≥1 套判据集、加载校验与域边界声明在位（来源：新功能交付清单 §三） | acceptance |
| 7 | `evidenceReadiness` / `fde-criteria-wiring` | FDE 判据面 S1M 三类首落点是否建档、归属迁移是否过门且留痕（来源：新功能交付清单 §三验收） | checklist |
| 8 | `JUDGE_INAPPLICABLE_FACES` / `UNVERIFIED_DOMAINS` | 判定不适用面四类与未验证域三类是否各带 fallback/理由显式声明，不在无验证器域宣称能力（来源：新功能交付清单 §三验收） | checklist |
| 9 | `option-exclusivity` | 选项互斥性软项⑦是否实现且只提示不阻断（来源：新功能交付清单 §三开工盘查⑨） | checklist |
| 10 | `judge-observability` / `DigestJudgeProbes` | 判定观测探针 O1-O22 与周报接入是否在位，快照缺失是否不写该段并 notes 留痕（来源：新功能交付清单 §二第六章回勾） | acceptance |
| 11 | `FDE-Bench` / `0.4714` | 第四方对照 384 题读数与口径是否与归档一致、是否仅作自有判据集对照不用于通用榜单宣称（来源：新功能交付清单 §三、§五） | acceptance |
| 12 | `judge-replay` / `judge-local` / `judge-memcheck` | 新三命令的 fail-closed exit code 语义（1=参数态 / 2=fail-closed）、用法屏与外部文档入口（来源：fresh-eyes 6-1、15-1） | checklist |
| 13 | `currentTaskId` / `setDensityTaskId` | 密度埋点模块级单例在同进程多任务并发下的判定归属（来源：fresh-eyes 11-2，来源判记录不修） | checklist |
| 14 | `density-replay-run.mjs` | datasets 评测脚本是否确属仓内工具面、不进 npm 包 files 字段（来源：fresh-eyes 4-1） | acceptance |
| 15 | `tools/check/doc-ratchet.json` | doc-ratchet 双台账合单后是否逐键较严值对账零放松（来源：fresh-eyes 8-1） | check-version |

## B 类：Bug 防回归

| # | Bug 摘要 | 防复发检查 | 建议落点 |
|---|----------|-----------|---------|
| — | 来源未提供 BugFix 清单（系统标注跳过） | 不适用 | — |

> B 类为空：已加载来源中 fresh-eyes 分诊统计为 P0=0、P1=0、「无需修复批」（来源：fresh-eyes 报告分诊统计），新功能交付清单仅有基线预存 8 例失败登记（归 F7 收口批，非本版修复）（来源：新功能交付清单 §一）。无「本轮修过的 bug」可列，不臆造。

## C 类：fresh-eyes 校准

- **草稿线索≠事实：P1 初判须实跑复验后才能定性**——7-1/11-1 初判 P1 经实跑翻转 P2（判定器主路径 tampered 兜底在位，decision-chain.ts:54-64），未复核的线索不得进修复批（来源：fresh-eyes 7-1、分诊统计）
- **裸 catch 审查按「主路径是否兜底 + 影响面分层」判，不按 catch 数量计**——4 处裸 catch 中仅验证层影响显示数字，不能一刀切报缺陷（来源：fresh-eyes 7-1）
- **silent-catch 豁免口径：注释声明 best-effort 且无副作用才可豁免**——judge-runtime.ts:233-235 纯计数埋点纳入豁免，门禁 158/158 对账过（来源：fresh-eyes 7-2）
- **「可复算」话术须限定复算粒度**——3/3 结构可复算，rc 读数随 HEAD 漂移属预期，归档注记「当轮输出」需在对外话术中同步限定（来源：fresh-eyes 2-1）
- **错误信息审查先看 exit code 契约再看提示次序**——state 先于 weights 报错次序反直觉，但 1=参数态 / 2=fail-closed 语义清晰即非缺陷（来源：fresh-eyes 6-1）
- **发布物边界先核 npm files/包清单，再判「未发布/缺文档」**——datasets 四脚本不进包属仓内工具面定位（来源：fresh-eyes 4-1）
- **能力未宣称时无须要求入口文档**——三命令属判定底座施工面、能力宣称留 v2.0.0，当前缺专节不记为缺陷（来源：fresh-eyes 15-1）
- **多口径数字按已声明口径对账，不把设计态三口径报为不一致**——测试数 6917/7014/7148 并存已有二口径声明（来源：fresh-eyes 8-2）
- **台账合单须逐键较严值复算，不能只看总数或声明**——21 键→20 键、零放松 1 键收紧实测复算成立（来源：fresh-eyes 8-1）
- **密集文档判观察项前须核出处是否在位**——README 三条前提已附 SECURITY/判据原文，风险降级为观察（来源：fresh-eyes 1-1）
- **降级载体等价性须逐条实证**——API 无 key 转 session 直跑，每条发现附当轮命令与读数方可视为等价产物（来源：fresh-eyes 草稿层局限声明）
- **diff 计数须排除纯注释行，不能用 `--stat` 判逻辑改动**——rules 零改动以排除注释后的逻辑改动为 0 为准（来源：新功能交付清单 §一勾选依据）

## 无法归类（留给人工）

- **7-1 残余盲区：existsSync 对权限错返回 false → device/test 链走「空链」文案**——属同用户攻击面子集且 SECURITY.md:337 HMAC 威胁模型已披露；是维持「记录不修」还是转为一条审查面（权限锁链路径显式断言），来源未给结论，拿不准（来源：fresh-eyes 7-1）
- **分诊统计写「记录不修 8」但条目列表列了 10 条**（1-1、2-1、4-1、6-1、7-1、7-2、11-1、11-2、15-1、16-2；7-1/11-1 同根因合并则为 9 条）——数量与列表不一致，是否漏计/多计需人工核对（来源：fresh-eyes 分诊统计）
- **16-2 CLI exit code 聚合缺「report 顺序稳定性」断言**——来源判风险低不修（VERIFY_CHAIN_CLASSES const 顺序固定），当前无并发消费方；是作为 A 类检查项还是维持记录，拿不准（来源：fresh-eyes 16-2）
- **2-1 归档 rc 漂移是否应转为「归档一致性」检查项**——来源定性为「语义已声明，非缺陷」且只在话术层限定；归 C 类方法论还是 B 类防回归，拿不准（来源：fresh-eyes 2-1）
