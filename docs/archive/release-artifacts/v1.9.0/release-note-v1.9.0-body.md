# v1.9.0 · 判定底座 · 阶段四（消费与收口）

🧩 **判定件从「工程可接」到「收口可证」**——判定底座四阶段收官版：判据面从审计规则扩到三域、判定头本地推理接线闭环（fail-closed 不回落 LLM）、四层性能与对照读数全部落数。**四阶段形态闭环**（V2.0 宣告的数据面就绪）· FDE-Bench v4 卷随版入库（人审双签进行中，发布线另议）。

**TL;DR (EN):** The judge goes from engineering-integrable to closeout-provable — the final stage of the four-stage decision foundation: criteria domains expand beyond audit rules (three domains, interface-only honesty, fail-closed on uncalibrated entry), the local judge head lands with five-ring fail-closed weights verification that never falls back to LLM, and performance/comparison readings (call density, dual-channel format-failure, FDE-Bench v4 384 items) all land as reproducible archives. **Stage-four form closed.**

## ⚡ Install / Upgrade

```bash
# 新装（五形态任选：FDE 插件 / Skill / MCP / CLI / GitHub Action）
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.9.0/install.sh | bash

# 已装用户升级到本版
npx @sofagent/audit@v1.9.0 --doctor

# GitHub Action（PR 自动审计）
uses: KongFangXun/sofagent@v1.9.0
```

## 🔨 核心变更

### 🧩 判据面扩展与 FDE 接线

- 三域判据集（workflow / 本体 / 路由）各 ≥1 套，同 schema 加载校验；校准态 `interface-only` 如实声明，未校准域进决策路径即抛（fail-closed）
- FDE 判据面接线：S1M 决策点三首落点建档（三问判定 / 离场就绪度 / 健康分合成），归属迁移过 `evidenceReadiness` 门且留痕
- 出卷纪律 lint 软⑧⑨：弱预言信号提示（存在性 / 进程成功类单独不构成行为正确性证据）+ 覆盖显式批级提示（「没查什么」须登记）

### ⚙️ 判定头本地推理与重放

- `judge-local` 五环 fail-closed：权重缺失 / sha 不符拒绝判定**不回落 LLM**；回执四件（判据版本 / 权重 sha16 / 读数 / 时间）
- `judge-replay` 可复现重放：三件套指纹核对 + state 快照 → 离线重放同一概率分布
- 判定调用密度落数：打包 74 请求 vs 串行 370 调分列（混报会把打包成效记成假象）

### 📊 对照读数与 FDE-Bench

- 格式破坏率双通道：类型化接口 0% vs 文本通道 14.86%（55/370）——对照通道偏置的量化读数（格式失败 ≠ 能力差距）
- FDE-Bench v4 卷 384 题：`state+question` 去重零重复、全 `public-case-adapted`、30/30 决策点覆盖（signoff 人审双签进行中——发布宣称待签后解锁）
- 断网可用演练脚本化：`offline-drill.sh` 三件可复跑留档（零网络断言 / 隔离 HOME 审计 / verify-chain HMAC）

### 🛠 工具链与闸门加固

- 可演示证据包索引（evidence-index 8 条三类：A 仓内 sha16 实算 / B 命令 / C 仓外路径）
- skill-safety `rm -rf` 豁免精确形态收紧（13 探针回归锁）· 链接门禁行级豁免粒度 · 出卷纪律 lint 双软项
- 域外只出 observe / ask 硬结论入 LIMITATIONS（发布档位写死）

## ✅ 质量验证

| 检查项 | 结果 |
|---|---|
| npm test | **7014** tests 全绿（workspace 口径 / 14 包）✅ |
| acceptance-test | **510**/510 断言通过（427 场景）· SKIP: 0 · EXIT: 0 ✅ |
| shellcheck | 零 error（主力脚本实测 + CI workflow 常驻）✅ |
| check-version | **149**/149 全绿 ✅ |
| 回归检查 | **85 维** ✅ |
| release-gate | **PASS（条件放行 · 5 轮收敛 · P0=0）**；tag 前条件款随发布批闭环 ✅ |
| fresh-eyes | 16 视角三定性 P0/P1 **双零**（1 初判 P1 实跑推翻 · 8 P2 记录不修）✅ |

## ⚠️ 破坏性变更

- 无公开 API 退役（本版为收口版）；MCP tool 数量不变（104，registry 实数核过）
- FDE-Bench 题库不入 npm 包（独立数据面，`label.source=public-case-adapted` 唯源——企业样本零混入有断言）

## 🔗 深入了解

| 深入了解 | 链接 |
|---|---|
| CHANGELOG | https://github.com/KongFangXun/sofagent/blob/main/CHANGELOG.md |
| SECURITY | https://github.com/KongFangXun/sofagent/blob/main/SECURITY.md |
| HANDBOOK | https://github.com/KongFangXun/sofagent/blob/main/docs/HANDBOOK.md |
| Discussions | https://github.com/KongFangXun/sofagent/discussions |

📖 [详细开发日志](https://github.com/KongFangXun/sofagent/blob/main/docs/changelog/v1.9/v1.9.0.md)
