# 五~八、Stream 迁移 / Prompt 设计 / 工具开发 / 可观测性

> [← 返回索引](./index.md)

---

## 五、stream 迁移规范（P0 级铁律）

### API 返回格式差异

`invoke()` → `{ messages: [...] }`，`stream(streamMode:'updates')` → `{ [nodeName]: delta }`——外面包了一层节点名。不处理这个，上游打印正常，下游产物变 `[object Object]`。

```js
// 正确适配：累积 delta.messages 到扁平数组
const allMessages = [];
for await (const chunk of stream) {
  for (const [, delta] of Object.entries(chunk)) {
    const msgs = delta?.messages;
    if (!Array.isArray(msgs)) continue;
    for (const msg of msgs) {
      allMessages.push(msg);
      if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) { /* 工具计数 */ }
    }
  }
}
return { messages: allMessages };  // 兼容 invoke 格式
```

### stream 迁移检查清单

- [ ] **chunk 结构**：`{ [nodeName]: delta }` 不是 `{ messages: [] }`
- [ ] **下游消费函数**：extractAgentText / extractUsage 拿到的数据形状对吗？
- [ ] **格式适配层**：累积 delta.messages → `{ messages: allMessages }`
- [ ] **端到端验证**：检查产物文件 + usage.jsonl 有正常数据

> **核心反思**（commit da1039a → a0571a4）：只测了上游"工具调用能打印"，没测下游"结果能被正确消费"。**这个 bug 只有 agent 实际跑完一轮后才暴露。**

---

## 六、Prompt 设计规范

### macOS BSD 工具约束（必加）

LLM 训练数据以 Linux 为主，macOS 是 BSD，不约束就浪费步数重试错误命令（commit 3248395）。systemPrompt 末尾追加：

```js
const shellConstraints = `
## 🔴 铁律：macOS BSD 工具约束
- grep -P → grep -E | sed --version → 不存在，sed -i 必须带后缀 sed -i ""
- cat -A → cat -v | stat --format → stat -f | readlink -f → python3 realpath
- <(...) process substitution → 不支持
**铁律：命令报错时立即换方案，禁止用相同语法重试。**`;
```

### systemPrompt 注入方式

通过 `stateModifier` 注入（禁止用 `prompt` 参数——与 stateModifier 互斥）：

```js
function buildSystemPrompt(skillPath) {
  const raw = readFileSync(skillPath, 'utf-8');
  const body = raw.split('---').slice(2).join('---').trim();
  return `[Agent: ${name}]\n\n${body}${shellConstraints}`;
}
```

### 纯只读约束（release-gate 特有）

V 角色 systemPrompt 追加：禁止 write_file / edit_file / git commit / git push / npm publish。

---

## 七、工具开发规范

### 工具格式转换

dist/tools.js 是手写 `ExecutableTool` 格式，LangGraph ToolNode 需要 `tool()` 创建的 `DynamicStructuredTool`。loadTools() 加转换层：JSON Schema → zod 简化转换 + `tool()` 包装。

### 工具命名

加前缀 `sf_`（sf_read / sf_write），避免与 deepagents 保留名（ls / read_file）冲突。

### 工具输出截断埋点

工具 wrapper 内三件事：① 执行原始 func ② 截断输出（truncateToolOutput）③ 进度埋点（progressMw.wrapToolCall，失败不阻断）。

---

## 八、可观测性规范

### 两层可观测

| 层级 | 数据源 | 内容 |
|------|--------|------|
| L1 visibility | 循环级事件（RUN_START / ROUND_END / ERROR） | progress.jsonl + status.json |
| L2 progressMw | 工具调用级（start/end + duration）+ 推理心跳 | sub-progress-<role>.jsonl |

观测层创建/写入失败**绝不阻断主流程**。

### latest.json 指针

每轮结束 + 每 30s 刷新，Dashboard 据此实时展示。原子写入：先写 .tmp 再 rename。

### macOS 后台节流防护

darwin 平台 `caffeinate -dimsu -w <pid>` 绑定自身 pid，防 App Nap 冻结定时器。

> **坑源**（run-03）：macOS App Nap 挂起后台 node 进程，driver 零感知冻结 2h44m。
