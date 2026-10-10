⚡ **给进化装上两道门**——AI 自我改进最大的风险不是「改不动」，是**越改越失控**。本版给进化链加上准入（验证比生成便宜的域才准自动进化）与晋级（注入租用 / skill 半持久 / 微调摊销三态 + 四道证据门槛）两道门，并把「经验池 → 数据集 → 训练通道」的数据面打通，让沉淀下来的经验真能回流训练。

**TL;DR (EN):** Two gates on evolution — admission (only domains where verification is cheaper than generation may self-evolve; three-tier domain-verifier routing with fail-closed on unregistered domains) and promotion (inject-lease / skill-semi-persistent / fine-tune-amortized, gated by four evidence bars: holdout-first, strictly-beats-best, single-variable-attributable, calibration-non-degrading). The data plane from experience pool to training pipeline lands too: instinct records export under four gates, then a train-side adapter normalizes and merges them with external sources into one dataset. Rule count **25 → 28** fully reconciled across docs, comments, npm facade and dashboard. MCP tools **104** (unchanged) · **5946** tests · MIT.

## ⚡ Install / Upgrade

```bash
# 新装（五形态任选：FDE 插件 / Skill / MCP / CLI / GitHub Action）
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.5.8/install.sh | bash

# 已装用户升级到本版
npx @sofagent/audit@v1.5.8 --doctor

# GitHub Action（PR 自动审计）
uses: KongFangXun/sofagent@v1.5.8
```

## 🔨 核心变更

### 🚪 进化准入判据（验证比生成便宜才准自进化）

- 域验证器三档分流：`deterministic`（自动）/ `model-judge`（采样人审）/ `human-only`（零自动晋升）；**未登记域 fail-closed 按最高档处理**
- 门强度单调：自改进只能加门、不能撤门（削弱准入门的提案一律不准入）
- 登记表落 `{SOFAGENT_DATA}/protected/`（只读位 + sha256 钉哈希，篡改即拒载）——判定者位于可写面之外
- 收益停滞检测：连续 N 轮低于阈值转人审（只提示不自动改方向）；进化用评测集钉哈希登记谱系

### 🪜 三层晋级判据（注入租用 / skill 半持久 / 微调摊销）

- 频次 × 存续 × 验证三维纯函数 → 三态判定 + 回退对偶（复用既有 snapshot/restore，零新建）
- 四道证据门槛：留出集优先 · 严格优于历史最佳 · 单变量可归因 · 校准不退化（ε 阈值显式化）
- 成本 quota 前置门接入进化循环（纳入既有 v1.4.8 预算机制，不做第二套）

### 🔄 经验池接训练管道（打通 Data-RSI 断链）

- instinct 池持久化（4 血缘字段：来源 / 追踪 / 租户 / 谱系锚点）+ 导出四道门（置信 / 考核 / 真实性 / 租户）
- train 侧旁挂适配器归一为 `IngestRecord`，与 CSV/Excel 等外部源**混合进同一个 `buildDataset`**（builder 零改动）
- 来源真实性标记 `verified-trace` + 血缘锚点随数据集交付，回流通道唯一

### 🎓 出题考核器（双成功才入池）

- 从 instinct 反向生成验证题（阈值与打分器同源）；**答对 + 复现双成功**才标记 `verified` 入池
- 评分器独立性硬门（judge ≠ examinee 的 modelId 断言）；沉淀三态 SAVE / FOLD_INTO / NOTHING_TO_SAVE
- 不捕获清单四类（防把噪声/环境问题学成经验）+ 佐证门；考核态置信度加权（verified ×1.25 / failed ×0.5）

### 🧭 RL 训练治理（训练期策略违规惩罚）

- opt-in 策略集（默认空，不启用即零行为变更）+ 命中判定
- 惩罚权重经既有 `@sofagent/audit` `severityWeightOf` **单源折算**（不做第三套映射）；两门互补（combineGates）

### 🧹 规则数 25 → 28 全线清偿 + 门禁补强

- 文档 / 代码注释 / npm 门面 / dashboard 四面同步；证据分档统一四档式（22 git-diff + 4 hybrid + 1 filesystem + 1 logs = 28）
- `CURRENT_RULE_KEYS` 落 core 作配置面 SSOT，registry ↔ 清单互锁测试（不一致即红）
- 五道门禁补强：规则数双变体断言 / SOP 断言互校 A0 / 英文压缩残形 lint / 场景守卫接默认主路径 / release 收尾终态断言

### 🔒 BugFix（上版遗留）

- 测试数口径全域对齐；`check-docs` 规则数断言去 `head -1` 改全量比对（此前只查首处，漂移可全绿通过）
- acceptance S165 扫描面 3 → 8 文件、正则放宽；`glama.json` 与 npm 面 MCP 目录收录补齐

## ✅ 质量验证

| 检查项             |                      结果                     |
| --------------- | :-----------------------------------------: |
| npm test        |  5946 tests 全绿（workspace 口径 / 13 包）✅（@发版时点） |
| acceptance-test | 483/483 passed · SKIP: 0 · EXIT: 0 ✅（@发版时点） |
| shellcheck      |                  零 error ✅                  |
| check-version   |             143/143 全绿 ✅（@发版时点）             |
| 回归检查            |                85 维度 ✅（@发版时点）               |
| release-gate    |       手工裁决 PASS（driver 3 轮 + 零信任复验改判）✅      |
| fresh-eyes      |         16 视角审查 + P0×1/P1×5 修复批闭环 ✅         |

## ⚠️ 破坏性变更

> **升级必读**——三条，其中第一条带迁移动作。

- **`@sofagent/orchestrator` 新增 `./instinct` 子路径导出**，`@sofagent/train` 根 barrel 新增 instinct 源符号（4 值 + 3 类型，并同步分拣入 `domain/data` 域 barrel）——迁移：按包名引用（`@sofagent/orchestrator/instinct`）替代任何相对深引
- **`@sofagent/audit` public-api 新增 re-export**：`severityWeightOf`（跨包消费面，最小收口）
- **审计规则数 25 → 28**（`17 默认 + 11 扩展`，扩展层 opt-in 不默认生效）；决策类型 17 → 18 值（`DATA_PRODUCT`）——schema 消费方按新枚举对齐
- MCP 工具数 **104 → 104**（无新增；本版新增件为内部训练管道，不进 MCP 面）

## 🔗 深入了解

| 想看什么      | 链接                                                                             |
| --------- | ------------------------------------------------------------------------------ |
| 全部变更明细    | [CHANGELOG](https://github.com/KongFangXun/sofagent/blob/main/CHANGELOG.md)    |
| 审计规则与安全模型 | [SECURITY](https://github.com/KongFangXun/sofagent/blob/main/SECURITY.md)      |
| 上手指南      | [HANDBOOK](https://github.com/KongFangXun/sofagent/blob/main/docs/HANDBOOK.md) |
| 有问题 / 晒场景 | [Discussions](https://github.com/KongFangXun/sofagent/discussions)             |

📖 [详细开发日志](https://github.com/KongFangXun/sofagent/blob/main/docs/changelog/v1.5/v1.5.8.md)
