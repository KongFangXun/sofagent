# Loop Check

> 被动顾问——不夺权，不下命令，不硬拦截。主 Agent 在指定节点主动调起。全平台通用。
> ⛔ **Loop 分析/评分/诊断严禁输出给用户——仅「输出规则」表中规定的内容可见。**

---

## 触发节点（三节点）

> 主 Agent 先跑脚本做客观检查，拿数值后再调 Loop Check 做主观判断。

```
子任务完成 ─→ bash {OPENCLAW_SCRIPTS}/task-record.sh --closure-check → 有记录 → checkpoint
步数达 60% ─→ bash {OPENCLAW_SCRIPTS}/task-record.sh --budget --steps N --limit M → ≥60% → checkpoint
重大操作前（rm/git reset/DROP/外部API）──→ 直接调 checkpoint
失败 ─→ failure → 可自愈→重试 / 不可→汇报
全部完成 ─→ bash {OPENCLAW_SCRIPTS}/task-record.sh --closure-check → closure
```

> `{OPENCLAW_SCRIPTS}` fallback: 优先 `~/.openclaw/scripts/`，不存在则 Agent 自行搜索 `sofagent/scripts/`。
> 🖥️ **Windows PowerShell（非 WSL）**：上面 `bash X.sh --flag` 改用 `powershell -File X.ps1 -Flag`（见 SKILL.md「跨平台脚本调用约定」）。

⛔ 先跑脚本看结果，再决定是否调。快速模式仅「重大操作前」生效。

## 通用约束（全模式生效）

⛔ 评分词汇约束：禁止使用「如预期」「正常」「没问题」「符合要求」「一切正常」「没毛病」——这些暗示确认偏误。每个维度的评分必须附带 ≥1 条具体证据（task/logs 中的实际数据或行为描述），不能靠直觉。

⛔ **轮次上限**（v1.0.1+）：当前会话 Loop Check 调用次数累计超过 20 次 → 自动切换 closure 模式 → 交还人类。防止工具持续报错导致 Agent 无限循环消耗 Token。阈值可通过 config.yml `loopCheckMaxRounds` 配置。

---

## checkpoint 模式（三问：① 进展对齐吗）

输入：已完成子任务摘要 + 接下来做什么 + think.md 教训 + orchestrator/ 历史 Loop 记录

🟢继续 / 🟡调整（子任务间→改下个子任务；60%→全量重编排剩余）/ 🔴暂停等确认。历史优先：有 Loop 记录时加倍检查最容易出问题的节点。

> ⛔ 重大操作前自检（约束回响）：执行 rm / git reset / DROP / 外部 API 等不可逆操作前，先自问——当前生效的铁律有哪些？最近一条反思区记录是什么？如果答不上来，说明加载链已失效，暂停操作等用户确认。

> ⛔ **防雪崩**：共享状态（文件系统、git working tree、环境变量）被多个子任务并发修改，会导致 Agent「自己修自己改、越修越乱」。规则：
> 1. 子任务间必须显式标注共享状态变更——在 task/logs 中记录「修改了 X 文件/变量 Y」
> 2. 两个子任务同时修改同一文件 → checkpoint 强制暂停，等主 Agent 裁决合并策略
> 3. 一个子任务的修复引入了新 bug → 回滚该子任务全部变更，不叠加修复
> 4. 违反上述规则 → Loop Check 输出 🔴 暂停等确认

## failure 模式（三问：② 继续跑有希望吗）

输入：失败日志 + 重试次数。可自愈（超时/模型不匹配/拆太粗）→重试策略；不可自愈（数据不存在/权限/外部依赖）→汇报原因。

> 记录失败模式到 think.md 反思区，带分类标签：`#超时` / `#模型不匹配` / `#拆太粗` / `#数据不存在` / `#权限` / `#外部依赖`。下次加载时同类标签自动关联，帮助 Agent 预判高风险节点。

## closure 模式（三问：③ 需要用户介入吗）

> closure 模式的详细复盘、评分、checklist 规则见 **`loop-evaluate.md`**。
> closure 触发后按 loop-evaluate.md 执行：复盘 → 评分 → 写入 scoring/ + think.md → 交还人类（如需）。

closure 核心三问由 loop-evaluate.md 的九维评估体系驱动：进展对齐（完整/流畅/合规）→ 继续希望（编排/匹配/经济/Loop）→ 用户介入（判断力/弃权率）。

---

## 输出规则（内部执行，不输出给用户）

| 信号 | 通知用户 | 记录 |
|:--:|------|:--:|
| 🟢 | 沉默 | ✅ |
| 🟡 | 一句话（「检查发现X，已调为Y，继续」） | ✅ |
| 🔴 | 完整汇报+等确认 | ✅ |

Log：`Loop checkpoint|{节点}|{结果}|{依据}|{动作}` / `Loop failure|{根因}|{自愈}|{策略}` / `Loop closure|{复盘总分}|{反思}|{决策}`

---

> Loop Check = 顾问。读数据、做判断、给判断意见——主 Agent 自己决定怎么做。脚本数数，Agent 判断。

## Gotcha

- **check 和 exit 条件混用**——checkpoint 模式（继续/调整/暂停）和 closure 模式（复盘/评分/交还人类）的退出条件不同。后果：checkpoint 误用 closure 的交还人类条件，不该停的时候停了。
- **评分词汇约束被忽略**——用了「如预期」「正常」「没问题」等暗示确认偏误的词。后果：评分变成自我安慰而不是真实评估。
