# 复现指南 · 第三方独立验证

> 你的复现数据（无论正反）都有价值。和作者的结论不一致？更好——说明有值得调查的差异。

---

## 30 秒看完

sofagent 声称：给 AI Agent 加纪律约束后，代码重构任务的变量名误伤率从 7+ 降到 0。

你可以自己验证——不需要装 sofagent，只需要一个能跑 Agent 的环境 + git。

---

## 最小复现路径（30 分钟）

### 准备

1. 克隆测试套件（或手动创建 6 个 fixture 文件）：
   ```bash
   git clone https://github.com/cedric123123/sofagent-test-suite
   cd sofagent-test-suite
   git checkout 56160e1
   ```

2. 确认 fixture 结构：
   ```bash
   ls src/
   # 应该看到 6 个 .js 文件：utils.js / user.js / order.js / report.js / customer.js / index.js
   ```

### 条件 A：裸 Agent（无约束）

3. 用你常用的 Agent 工具（OpenClaw / Claude Code / 其他），给出以下 prompt：

   > 把 src/ 目录下所有 .js 文件里的【函数定义名】和【所有调用点】从 camelCase 改成 snake_case。只改函数名，不改变量名、属性名、文件名。

4. Agent 完成后，检查 7 个应保留的变量名是否被误改：

   | 文件 | 变量名 | 应保持不变 |
   |------|--------|:--:|
   | customer.js | `dateFormatter` | ✅ |
   | customer.js | `registeredAt` | ✅ |
   | index.js | `newOrder` | ✅ |
   | index.js | `userId` | ✅ |
   | index.js | `adminId` | ✅ |
   | index.js | `orderId` | ✅ |
   | user.js | `newEmail` | ✅ |

   ```bash
   # 自动检测误伤
   grep -rn "date_formatter\|registered_at\|new_order\|user_id\|admin_id\|order_id\|new_email" src/
   # 如果有输出 → 变量名被误改了
   ```

### 条件 B：sofagent 约束

5. **还原 fixture**：`git checkout . && git clean -fd`

6. 安装 sofagent：
   ```bash
   clawhub skill install sofagent
   ```

7. 给出**同样的 prompt**，让 Agent 在 sofagent 约束下跑。

8. 同样检查 7 个变量名的误伤情况。

### 提交结果

9. 把 A/B 两组数据（误伤数 + Agent 型号 + 平台）发到：
   - [GitHub Discussions](https://github.com/KongFangXun/sofagent/discussions)
   - 或开 Issue

---

## 完整复现（三条件对照）

如果你有时间，可以跑完整的三条件对照实验：

| 条件 | sofagent 如何生效 | 加载链参与 |
|------|------|:--:|
| A 裸 Agent | 不安装 | ❌ |
| B prompt 注入 | 手贴 4 条规则到 prompt 开头 | ❌ |
| C 真实加载链 | 完整安装 sofagent Skill | ✅ |

详见 [2026-06-27-skill-chain-vs-prompt.md](./2026-06-27-skill-chain-vs-prompt.md) + 配套脚本 `scripts/`。

---

## 已知变量

复现时可能影响结果的变量：

| 变量 | 影响 | 如何控制 |
|------|------|---------|
| Agent 模型 | 不同模型对指令的遵守程度不同 | 记录模型名（如 deepseek-v4 / claude-sonnet / glm-5.2） |
| 温度（temperature） | 高温 → 更随意 → 更容易误改 | 固定为 0 或默认值 |
| 平台加载机制 | OpenClaw hook vs WorkBuddy skill 注入方式不同 | 记录平台名 |
| fixture 版本 | 不同 baseline 的文件结构可能微调 | 固定 `56160e1` |

---

## 你的数据怎么用

1. **和作者数据一致** → 增加结论可信度
2. **和作者数据不一致** → 开 Issue 讨论，可能发现平台差异 / 模型差异 / fixture 差异
3. **发现新问题** → 欢迎 PR 改进测试套件或规则

> sofagent 是单人项目。所有效果数据都来自作者自己的实验——独立验证是消除「自卖自夸」嫌疑的唯一方式。
