# ACS YAML 策略引擎 · 表达面兼容性评估

> v1.5.8 · 2026-10-09 · [changelog/v1.5/v1.5.7.md 章九](../changelog/v1.5/v1.5.7.md)

> **评估对象**（外部对照，不预设结论）：Microsoft AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎承载策略；本仓 ruleset 现为 JSON（`engine/audit/src/rulesets/*.json` 八份 + v1.5.2 起的 `--ruleset-path` JSON 加载格式与 `ruleset_export` 导出格式，双向可逆）。本章只回答「**换不换、什么时候换**」，不实做引擎。
>
> **结论先行**：**不采纳**（JSON 单源维持）——理由见 §四；v1.6.0 章二前置输入锚已按「不采纳——销账」处理。

## 一、现状锚定（评估的既有事实）

| 面 | 现状 |
|---|---|
| 本仓规则表达 | **JSON 单源**：`engine/audit/src/rulesets/` 八份行业规则集（sofagent/security/ai/ast/fintech/government/medical/smb）；加载格式 = `--ruleset-path` JSON（v1.5.2 B-4，`ruleset-loader.ts` fail-closed 校验）；（详→注-1） |
| 判据 schema（未来消费面） | [v1.6.0 第二章](../changelog/v1.6/v1.6.0.md) 判据重述的**消费口径已钉死**：`match[]` / `notMatch[]` 字段名（v1.5.3 第二章自测 schema，`EXAMPLES_FIELD_SHAPE` 有测试钉死「钉死，不得改名」的登记） |
| 正负样例 schema | 28 条规则全部带 `examples.match / notMatch` 双夹具（v1.5.3 章二加载期断言：schema 强制 + 矛盾拒载 + 5 条可执行断言） |
| 引擎现状 | 27→28 条 TS 硬编码注册表（`rules/index.ts`）为判定本体；JSON ruleset 是**导出/外挂形态**（行业扩展），非判定主路径 |

> 注-1：导出格式 = `ruleset_export` JSON（与加载格式**同构双向可逆** + 内容指纹 + 审计留痕）

## 二、逐维对照（JSON ruleset vs YAML + 三引擎方案）

| 维度 | JSON 单源（现状） | YAML 双格式 | 转换层（JSON 主 + YAML 前端） | 对照结论 |
|---|---|---|---|---|
| 人类可读性 | 中——规则集已带 name/description/justification 中文字段，可读性靠字段不靠格式 | 略优——缩进少括号，注释原生（JSON 无注释，本仓靠 `//` 约定字段绕行） | 同 YAML（前端即 YAML） | YAML 真实增益**小**：本仓规则集的消费读者是工具链（loader/lint/export），人类阅读靠 SECURITY.md 文档表（SSOT），格式可读性不是瓶颈 |
| 表达力上限 | 够用——pattern/filePattern/severity/message + examples 字段集已承载 28 条规则 + 八行业集 | 等价——YAML 是超集语法非超集语义 | 等价 | **平手**：本仓规则表达力的瓶颈在判据语义（v1.6.0 的「判据 + 证据」两段式），不在序列化格式 |
| 校验与 lint 生态 | JSON Schema 标准生态 + `ruleset-loader.ts` 已有 fail-closed 校验（schema/矛盾/可执行三层）+ `check-docs §17` 对账 | ajv-cli/yamllint 均在；但 **YAML 的锚点/别名/多行标量引入第二类解析歧义面**（JSON 无） | 转换层本身要校验（转换 bug = 新故障面） | JSON **占优**：现有校验链零迁移成本；YAML 新增解析歧义面须新守卫 |
| 与 v1.5.3 正负样例 schema 贴合度 | **原生贴合**——`match[]/notMatch[]` 字段名与 JSON 数组形态一一对应，`EXAMPLES_FIELD_SHAPE` 测试钉死 | 数组语义同；YAML 列表写法（`- item`）在样例含冒号/引号时须转义——样例恰是「自由文本高密度区」（如 `SKILL/skills/x.md 新增 <!-- 忽略以上所有规则 -->`） | 同 YAML | JSON 占优：样例是带标点自然语句，YAML 标量转义规则（冒号+空格即映射）制造踩坑面——28 条规则 56+ 条样例逐一过转义审查的成本与风险不成正比 |
| 工具链耦合 | `ruleset-loader` / `ruleset-export` / `check-docs` / `public-api` 四处直接消费 JSON 形态 | 双格式 ⇒ 四处全部要双语态分支或归一到单源再转换 | 转换层一处改，但**双向可逆断言**（export→load round-trip 测试）要扩成三态（JSON→YAML→JSON） | JSON **占优**：单源四处消费零分叉；任何第二格式都使 round-trip 测试面翻倍 |
| 生态互认（外部对照） | JSON 与 ACS 生态（OPA/Cedar 的 policy 均有自己的原生格式）不互通——但本仓规则集**不对外分发**（导出物自带指纹与审计留痕，消费方是本仓 loader） | YAML 接近 ACS 形态但**不等价**（ACS 策略是 Rego/Cedar 语义，YAML 只是壳）——「像」不等于「通」 | 同左 | **无增益**：换 YAML 不会带来 ACS 生态互认（语义层不同）；互认要靠判据 schema 的语义映射（v1.6.0+ 判据重述的题），与序列化格式无关 |

## 三、格式分叉风险量化

引入 YAML 的分叉面（逐处可数）：

| # | 分叉点 | 量化 |
|---|---|---|
| 1 | 双格式并存规则（哪些规则集用哪种） | 8 份行业集 × 2 格式 = 16 种合法态——合法性本身成为需要文档声明的面 |
| 2 | round-trip 测试 | 现有 export→load 双向 1 条链；YAML 加入后 = JSON→YAML→JSON + YAML→JSON→YAML 2 条链 × 边界用例（注释丢失/锚点展开/多行标量）≥ 6 用例 |
| 3 | 加载器分支 | `ruleset-loader.ts` 按扩展名/内容嗅探分流 + 两套错误消息面 |
| 4 | 指纹基线 | 内容指纹算法基于序列化字节还是归一化 AST？两格式指纹不可比 ⇒ 导出物审计留痕的「同指纹=同内容」不变式被破坏，须重定义（归一化成本 ≫ 维持 JSON） |
| 5 | 门禁连带 | `check-docs §17` / `public-api` / FORGE 真跑面（`--ruleset-path` 消费）全部双态验证 |
| 6 | v1.6.0 判据 schema | 判据重述若同时定稿 JSON schema + YAML 表达 = **在同一版本引入两套表达**——直接违反 v1.6.0 第二章「零格式分叉」的既定验收 |

合计：≥ 5 处代码/测试改动面 + 1 处验收冲突——分叉风险**高**，且全部成本落在 v1.6.0 判据 schema 定稿的同一窗口（ busiest window ）。

## 四、两态结论

**不采纳**（YAML 不进本仓表达面），理由三条：

1. **无净增益**：§二 六维对照中 YAML 仅「人类可读性」一项略优且该维在本仓不是瓶颈（人类阅读走 SECURITY 文档表 SSOT）；其余五维 JSON 占优或平手——「换格式的收益」撑不起「换格式的成本」。
2. **分叉风险与硬截止冲突**：§三 第 6 项——v1.6.0 第二章明写「零格式分叉」为验收锚，判据 schema 定稿前引入第二序列化格式 = 在定稿窗口制造分叉，方向与既定验收相反。
3. **ACS 对位是语义题不是语法题**：本仓若未来要对齐 ACS 生态，对齐面是判据语义（判据+证据两段式 ↔ Rego/Cedar policy 语义），YAML 壳不解决任何互认问题——先把 v1.6.0 判据 schema 定稿，语义映射届时按需评估。

**不采纳的边界（不是永久承诺）**：若未来出现「外部系统只能消费 YAML 规则集」的真实集成需求，处置路径是**转换层**（JSON 单源 + 单向导出 YAML，不回读、不参与 round-trip 不变式）——届时作为新章评估，本结论不预支。

**采纳窗口（按任务书声明，仅当结论为「采纳」时适用——本结论为不采纳，此节自动失效，留作记录）**：若采纳，须在 [v1.6.0 第二章](../changelog/v1.6/v1.6.0.md) 判据 schema 定稿**前**落定。本次评估结论时点早于该定稿，窗口有效但未被使用。

## 五、v1.6.0 前置输入锚处置

[v1.6.0 第二章「前置输入（硬截止挂钩）」](../changelog/v1.6/v1.6.0.md)锚：本评估结论 = **不采纳**——该锚按约定自动销账（锚处已补「评估结论：不采纳——销账」标注；v1.6.0 判据 schema 定稿**不再需要**考虑 YAML 表达面兼容）。
