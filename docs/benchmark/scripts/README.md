# 实验自动化脚本 · 使用说明

> 配套文档：[../2026-06-27-skill-chain-vs-prompt.md](../2026-06-27-skill-chain-vs-prompt.md)

## 脚本清单

| 脚本 | 作用 | 什么时候用 |
|------|------|------|
| `prepare-fixture.sh` | 克隆测试套件，checkout 到 baseline | 实验开始前，准备一次即可 |
| `run-trial.sh` | 收集单次实验的 diff + 误伤数 + 运行结果 | 每次 Agent 跑完后 |
| `aggregate.sh` | 汇总 9 组数据成 markdown 表格 | 全部跑完后 |

## ⚠️ 脚本不跑 Agent

这三个脚本**只自动化评分和数据收集**，不调度 Agent。原因：

- 条件 A（裸 Agent）和条件 B（prompt 注入）在 **OpenClaw --local** 中操作
- 条件 C（真实加载链）在 **WorkBuddy** 中操作
- 脚本无法跨这两个环境调度 Agent

Agent 操作必须由作者（孔老师）手动完成，脚本在 Agent 完成后介入。

## 完整流程

### 第 0 步：准备 fixture（一次性）

```bash
cd docs/benchmark/scripts
chmod +x *.sh
./prepare-fixture.sh
```

### 第 1 步：跑条件 A（裸 Agent）

```bash
# 1. 还原 fixture 到 baseline
cd fixture && git checkout . && git clean -fd && cd ..

# 2. 启动 OpenClaw --local
openclaw --agent main --local

# 3. 在 OpenClaw 中给出 Task 1 prompt（原始版，不注入规则）
#    "把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。只改函数名，不改变量名、属性名、文件名。"

# 4. Agent 完成后，退出 OpenClaw

# 5. 记录试次 A-1
./run-trial.sh --condition A --trial 1 --dir ./fixture

# 6. 重复 2 次（试次 A-2、A-3），每次都要还原 fixture + 新建 OpenClaw 会话
```

### 第 2 步：跑条件 B（prompt 注入）

```bash
# 同条件 A，但 prompt 开头加上 4 条规则（见文档 §4）
./run-trial.sh --condition B --trial 1 --dir ./fixture
```

### 第 3 步：跑条件 C（真实加载链）

```bash
# 1. 还原 fixture

# 2. 确认 WorkBuddy 中 sofagent Skill 已安装
sh ~/.workbuddy/skills/sofagent/scripts/verify.sh --quick

# 3. 打开新的 WorkBuddy 对话，把 fixture 工作区指过去

# 4. 给出 Task 1 prompt（原始版——规则由加载链注入，不在 prompt 里）

# 5. Agent 完成后，观察对话历史：
#    - Agent 是否 Read 了 .sofagent/think.md？→ L2 命中
#    - Agent 是否 Read 了 ~/.workbuddy/skills/sofagent/rules.md？→ L3 命中
#    - SKILL.md 自动加载视为 L1 命中

# 6. 记录试次（chain-hit 格式 "L1,L2,L3"，如 "1,1,0" 表示 think.md 读了 rules.md 没读）
./run-trial.sh --condition C --trial 1 --dir ./fixture --chain-hit "1,1,0"
```

### 第 4 步：汇总

```bash
./aggregate.sh > /tmp/result.md
cat /tmp/result.md
# 把输出粘贴到 docs/benchmark/2026-06-27-skill-chain-vs-prompt.md 的 §10
```

## 判定加载链命中的操作指南（条件 C）

WorkBuddy 对话中 Agent 是否读了 think.md / rules.md，有三种判定方式（按可靠性排序）：

| 方式 | 操作 | 可靠性 |
|------|------|:---:|
| **对话历史 grep** | 在 WorkBuddy 对话界面，Ctrl+F 搜 "think.md" / "rules.md"，看 Agent 是否有 Read 调用 | ⭐⭐⭐ |
| **任务日志** | 检查 `.sofagent/task/logs/` 下最新日志，grep "think.md" / "rules.md" | ⭐⭐ |
| **文件修改时间** | 检查 `.sofagent/think.md` 的 mtime 是否在实验期间更新（如果是 read-only 则不会更新） | ⭐ |

推荐用方式 1（对话历史 grep）——最直接。

## 常见问题

**Q: prepare-fixture.sh 克隆失败（github.com/cedric123123 仓库 404）？**

A: 测试套件源码由独立测试者维护，可能仓库地址有变。替代方案：手动创建 Task 1 的 6 个 fixture 文件（结构见 [../2026-06-23-sofagent-test-suite.md](../2026-06-23-sofagent-test-suite.md) Task 1 章节）。

**Q: run-trial.sh 报 "未找到 src/index.js"？**

A: fixture 目录结构可能不同。脚本会自动探测 `src/` 或 `task1-camel-to-snake/src/`，如果都不在，手动确认 fixture 布局后修改脚本的 `SRC_DIR` 探测逻辑。

**Q: 条件 C 的 Agent 没读 think.md，命中率只有 1/3，算实验失败吗？**

A: 不算失败——这正是实验要回答的问题。如果命中率 < 50%，按文档 §5 的决策表，结论是"加载链机制本身有问题"，这本身是有价值的发现。
