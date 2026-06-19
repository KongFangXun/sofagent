# Testing.md · sofagent 测试用例

> 用于验证 sofagent 是否在真实环境中生效。测试人员按用例逐项执行并截图。

---

## 测试环境要求

- 已安装 sofagent（`bash sofagent/scripts/install.sh --platform 你的平台`）
- 已运行 `verify.sh` 且全部通过
- Agent 客户端已重启（确保 Skill 重新加载）

---

## 用例 0：安装验证

**目的**：验证 install.sh + verify.sh 全链路通过（不需要 Agent 客户端）。

**步骤**：
1. `bash sofagent/scripts/install.sh --platform 你的平台`
2. `bash sofagent/scripts/verify.sh`
3. 确认 0 fail

**预期结果**：install 完成无报错，verify 全 pass / 0 fail。

**通过标准**：verify.sh exit 0，fail = 0。

**截图要求**：verify.sh 输出。

---

## 用例 1：地基加载验证

**目的**：确认三层加载链在 🟢 简单任务时也在上下文中。

**步骤**：
1. 打开 Agent，发一条简单消息：「你好，今天星期几？」
2. 观察 Agent 回复中是否有「4 底线 + 10 铁律」相关的行为表现（如拒绝后礼貌说明原因、没有假装自己是人类等）
3. 如果有 IDENTITY.md，检查 Agent 是否以该身份回复

**预期结果**：
- Agent 回答日期时不伪造身份
- 如果 rules.md 设了回复风格，Agent 遵守该风格

**通过标准**：Agent 行为符合底线 4（不冒充人类）和 rules.md 自定义规则。

**截图要求**：截 Agent 回复完整内容。

---

## 用例 2：Loop Agent checkpoint 触发

**目的**：验证任务编排引擎在复杂任务中正确触发检查点。

**步骤**：
1. 发一个需要多步操作的 🔴 复杂任务，例如：「帮我重构这个项目的文件结构，把 docs/ 拆成 handbook/ 和 design/，更新所有引用路径」
2. Agent 进入两轮澄清后确认执行
3. 观察 Agent 是否在子任务间或 60% 预算时暂停并输出检查结果

**预期结果**：
- 执行过程中出现 Loop checkpoint 标记（🟢/🟡/🔴）
- 如遇 🟡 调整，Agent 修改后续子任务
- 全程不输出内部评分/分析过程

**通过标准**：至少触发 1 次 checkpoint，且内部过程未泄露。

**截图要求**：截 checkpoint 触发瞬间的 agent 回复。

---

## 用例 3：任务闭环 + 反思沉淀

**目的**：验证闭环后数据是否正确写入。

**步骤**：
1. 完成用例 2 的任务
2. 任务闭环后检查数据文件：
   ```bash
   cat .sofagent/think.md          # 查看是否新增反思条目
   ls .sofagent/task/logs/         # 查看是否新增执行日志
   ```
3. 运行 `bash sofagent/scripts/verify.sh`，检查「闸门通过率」和「反思更新频率」

**预期结果**：
- think.md 有新的反思条目（带 `← task/logs/...` 来源标记）
- task/logs/ 有当天的新记录
- verify.sh 的约束验证全部通过

**通过标准**：think.md 最后修改日期在今天，task/logs 有新增记录。

**截图要求**：截 think.md 新增内容 + verify.sh 约束验证输出。

---

## 用例 4：治理层自我约束

**目的**：验证 sofagent 能否在自身项目中正确工作（"吃自己的狗粮"）。

**步骤**：
1. 修改 sofagent/ 下的一个 Skill 文件（如 engine.md），加一行注释
2. 检查 Agent 是否在闭环前提醒「engine.md 已修改但未同步到 installed 目录」
3. 或者：故意不更新 MEMORY.md，看 verify.sh 能否检测到

**预期结果**：Loop Agent 在 checkpoint 或 closure 阶段检测到未同步的修改。

**通过标准**：Agent 提示文件已修改但未同步，或 verify.sh 检测到异常。

**截图要求**：截 Agent 的提醒消息。

---

## 用例 5：跨任务反思生效

**目的**：验证 think.md 的反思在下一个任务中被用到。

**步骤**：
1. 先完成一个任务，故意让 Agent 犯一个可被反思捕获的错误（如用错文件路径）
2. 确认闭环后 think.md 有相关的反思条目
3. 再发一个类似任务
4. 观察 Agent 是否参考了上一条反思，避免了同样的错误

**预期结果**：第二个任务中，Agent 引用或避免了上一个任务的坑。

**通过标准**：Agent 在第二个任务中表现出「学到了」的行为。

**截图要求**：截两个任务的对比——think.md 的反思条目 + 第二次任务中的改进行为。

---

## 测试记录表

| 用例 | 测试人 | 日期 | 结果 | 截图 | 备注 |
|------|------|------|:--:|------|------|
| 0. 安装验证 | 郝交付 | 2026-06-18 | PASS | — | v0.55 install+verify 全链路通过，28 pass / 0 fail |
| 1. 地基加载 | — | — | SKIP | — | 需要运行中的 OpenClaw Agent 客户端 |
| 2. checkpoint | — | — | SKIP | — | 需要运行中的 OpenClaw Agent 客户端 + 复杂任务 |
| 3. 闭环反思 | KongFangXun | 2026-06-18 | PASS | — | WorkBuddy + DeepSeek V4 Pro 实测：task/logs + think.md 双写，闭环跑通。加载链第 1 层漏读已修（v0.56 P0-7）。详见 [Case 002](./docs/cases/workbuddy-self-test-2026-06-18/) |
| 4. 自我约束 | 郝交付 | 2026-06-17 | PASS | — | v0.50 修了 install.sh constitution 路径 + data/路径 + 乱码行 + uninstall 范围；install→verify→uninstall 全流程通过，不误删其他 skills |
| 5. 跨任务反思 | — | — | SKIP | — | 需要至少 2 次 Agent 任务运行 |

### 第三方测试（等你来填）

以下是给你的空白行。填完发回来就行——FAIL 比编造的 PASS 有价值 100 倍。

| 日期 | 测试人 | 平台 | 用例 | 结果 | 截图 | 备注 |
|------|------|------|------|:--:|------|------|
| 2026-06-18 | @cedric123123 | OpenClaw (kimi-k2.5) | 复杂旅行规划任务 | PASS | [loop-report-screenshot.png](./docs/cases/italy-travel-2026-06-18/loop-report-screenshot.png) | 全流程跑通，3检查点100%通过；效果指标为 Agent 自评未经人工核验 |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | 闭环反思 + 加载链 | PASS（闭环）/ FAIL（加载链第1层） | [Case 002](./docs/cases/workbuddy-self-test-2026-06-18/) | 闭环双写跑通；加载链第1层漏读已修（v0.56 P0-7） |
| — | — | — | — | — | — | 你的这行，模板：日期 / @你的名字 / 平台 / 用例 / 结果 / 截图 / 备注 |

| 用例 | 测试人 | 日期 | 结果 | 截图 | 备注 |
|------|------|------|:--:|------|------|
| 1. 地基加载 | _你的名字_ | _日期_ | _PASS / FAIL / SKIP_ | _截图路径_ | _一句话说明_ |
| 2. checkpoint | _你的名字_ | _日期_ | _PASS / FAIL / SKIP_ | _截图路径_ | _一句话说明_ |
| 3. 闭环反思 | _你的名字_ | _日期_ | _PASS / FAIL / SKIP_ | _截图路径_ | _一句话说明_ |
| 4. 自我约束 | _你的名字_ | _日期_ | _PASS / FAIL / SKIP_ | _截图路径_ | _一句话说明_ |
| 5. 跨任务反思 | _你的名字_ | _日期_ | _PASS / FAIL / SKIP_ | _截图路径_ | _一句话说明_ |

---

> 测试完成后，将最有代表性的截图和数据填入 README「实际效果」区块和 docs/EVIDENCE.md。
