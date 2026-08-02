# MCP 使用指南 · MCP Usage Guide

> **本文档是 sofagent 的 MCP 能力全目录。** 告诉你：Agent 能调什么、能生成什么、结果推到哪、什么时候推。
>
> v1.2.4 · 2026-08-02（UTC）· 孔放勋

<img src="../docs/assets/sofagent.png" alt="sofagent" width="160" />

- [一、Agent 怎么发现能力](#一agent-怎么发现能力)
- [二、所有 MCP resource（完整列表）](#二所有-mcp-resource完整列表)
- [三、所有 MCP 输出（完整目录）](#三所有-mcp-输出完整目录)
- [四、怎么配置 push target](#四怎么配置-push-target)
- [五、什么时候推到哪](#五什么时候推到哪)

---

## 一、Agent 怎么发现能力

Agent 连上 sofagent MCP server 后，第一件事就是 `list_capabilities`。不需要人去教它——它自己知道能调什么。

返回的能力清单会随 sofagent 版本自动扩展。v1.1.0 起包含：
- 🤖 FORGE 自迭代——自动写代码、自动审、自动发版
- 📚 知识联邦——跨设备查询 knowledge/ 
- 💿 USB 配置——说一句，写好 U 盘
- 🔐 安全加密——配对、加密、联邦密钥管理
- 📋 发版 SOP——从审查到 tag 全自动

---

## 二、所有 MCP resource（完整列表）

### FORGE 自迭代（v1.1.3-v1.1.5）

| resource | 用法 | 返回 |
|------|------|------|
| `loop_start(task)` | 启动自迭代任务 | 任务 ID + 预计阶段数 |
| `loop_status(id)` | 查询任务进度 | 当前阶段 / 已完成 / 下一步 |
| `loop_result(id)` | 取最终结果 | 审查报告 + 审计结果 + think.md 摘要 |
| `loop_cancel(id)` | 取消任务 | 已取消，已做变更已 commit |

### 知识库（v1.1.4-v1.1.6）

| resource | 用法 | 返回 |
|------|------|------|
| `search_knowledge(q, limit)` | 搜索 knowledge/ | 匹配的 entity/concept/comparison 摘要列表 |
| `read_entity(id)` | 读 entity | 完整 entity 页面（Markdown） |
| `read_concept(id)` | 读 concept | 完整 concept 页面（Markdown） |
| `read_comparison(id)` | 读 comparison | 完整对比页面（Markdown） |
| `list_entities(domain?)` | 列 entity | entity ID + 标题 + sensitivity + 更新时间 |
| `list_concepts(domain?)` | 列 concept | concept ID + 标题 + 更新时间 |
| `read_lessons(since?)` | 读踩坑经验 | lessons-missteps 增量列表 |
| `read_think_md(days?)` | 读 think.md | 最近 N 天反思条目 |
| `knowledge_stats()` | 知识库统计 | entity 数 / concept 数 / 最近更新时间 / 总 Token 数 |
| `conflict_check()` | 知识库健康检查 | 矛盾条目 / 孤儿页面 / 死链清单 |
| `dream_cycle_status()` | Dream Cycle 管道状态 | 6 阶段各自最后运行时间 / 产出量 |

### 联邦查询（v1.1.7）

| resource | 用法 | 返回 |
|------|------|------|
| `federation_peers()` | 联邦设备列表 | 在线设备名 + 最后心跳 + 设备类型 |
| `federation_search(q, limit)` | 跨设备搜索知识 | 所有 peer 的匹配结果（标注来源设备） |
| `federation_knowledge_diff(peer)` | 与指定 peer 的知识差异 | 新增 / 更新 / 仅本机独有的 entity 清单 |

### USB Key（v1.1.3 + v1.1.8）

| resource | 用法 | 返回 |
|------|------|------|
| `usb_create(role, label)` | 创建 USB key | 写入进度 + 完成确认 |
| `usb_verify()` | 验证 USB 完整性 | HMAC 验签结果 + knowledge/ 加密状态 |
| `usb_status()` | USB key 当前状态 | 是否在线 / 是否验签通过 / knowledge 规模 |

### 安全（v1.1.7）

| resource | 用法 | 返回 |
|------|------|------|
| `federation_pair_start()` | 开始配对 | 6 位配对码 |
| `federation_pair_confirm(code)` | 确认配对 | 配对成功 / 失败 + ECDH 密钥交换完成 |
| `federation_token(duration?)` | 生成加入 token | 一次性 token（默认 10 分钟有效） |
| `federation_key_rotate()` | 轮换联邦密钥 | 新 key 生成确认 + 旧 key 过期时间 |
| `federation_audit_log()` | 安全审计日志 | 配对接入 / 密钥轮换 / 设备加入/离开记录 |

### 发版 SOP（v1.1.4）

| resource | 用法 | 返回 |
|------|------|------|
| `release_start(version)` | 启动发版 SOP | 任务 ID + 阶段预览 |
| `release_status(id)` | 查看发版进度 | 当前阶段: 审查/开发/自测/审阅/发版 |
| `release_result(id)` | 取发版结果 | 版本号 + git tag + release URL + release notes |
| `fresh_eyes_review()` | 跑发布后审查 | P0/P1/P2 问题清单 |

### 能力感知 + 健康（跨版本）

| resource | 用法 | 返回 |
|------|------|------|
| `list_capabilities()` | 首次连接自动调用 | 所有可用 capability 及对应 resource 清单 |
| `health_check()` | 健康检查 | daemon 运行状态 / 审计引擎版本 / 知识库健康度摘要 |

---

## 三、所有 MCP 输出（完整目录）

### 审查类输出

| 输出内容 | 触发者 | 格式 | 示例 |
|------|------|------|------|
| 代码审查报告 | `loop_result(id)` | Markdown | 🔴阻断×2 / 🟡建议×3 / 💭小改进×5 |
| 发布后审查 | `fresh_eyes_review()` | Markdown 清单 | P0 安全硬伤×1 / P1 工程欠债×4 / P2 改进×8 |
| 审计结果 | `loop_status(id)` 阶段 2 | JSON + Markdown | PASS: 0 violations / WARN: A2 low-coverage / FAIL: A1 secret-leak |
| 知识库健康报告 | `conflict_check()` | Markdown 表格 | 矛盾 3 处 / 孤儿 5 个 / 死链 2 个 |

### 知识类输出

| 输出内容 | 触发者 | 格式 | 示例 |
|------|------|------|------|
| Entity 详情 | `read_entity(id)` | Markdown | 完整 entity 页面，含 relations / sensitivity / 更新时间 |
| 搜索结果 | `search_knowledge(q,limit)` | JSON 列表 | [{id, title, summary, relevance_score, source_device}] |
| 联邦搜索结果 | `federation_search(q,limit)` | JSON 列表 | 同上 + 每个结果标注来源设备 |
| 踩坑经验 | `read_lessons(since?)` | Markdown 条目列表 | 本周 5 条：A2 low-coverage ×3 / 任务超时 ×2 |
| 反思摘要 | `read_think_md(days=7)` | Markdown | 最近 7 天 think.md 摘要，每条 ≤200 字 |
| Dream Cycle 摘要 | `dream_cycle_status()` | JSON | fact 产出 47 条 / atom 产出 12 条 / concept 产出 3 条 |

### 行动类输出

| 输出内容 | 触发者 | 格式 | 示例 |
|------|------|------|------|
| USB 创建确认 | `usb_create(role,label)` | Plain text | "✅ U 盘已写好：标签 sofagent-财务审计-001，联邦密钥已注入，HMAC 签名已验证" |
| 配对码 | `federation_pair_start()` | Plain text | "配对码: 482917（在另一台设备上输入此码完成配对）" |
| 加入 Token | `federation_token(600)` | Plain text | "sf_7a3f8b2c（10 分钟有效）" |
| 发版结果 | `release_result(id)` | Markdown | "✅ v1.1.5 已发布\n- git tag: v1.1.5\n- release: https://github.com/.../v1.1.5\n- npm: @sofagent/audit@1.1.5" |
| HITL 确认 | `loop_status(id)` 阶段 4 | 交互 | "审查报告已出。确认通过？[y/N]" |

### 状态类输出

| 输出内容 | 触发者 | 格式 | 示例 |
|------|------|------|------|
| 联邦设备列表 | `federation_peers()` | JSON | [{name: "MacBook-Pro", online: true, heartbeat: "2s ago"}] |
| 任务进度 | `loop_status(id)` | JSON | {stage: 3/5, current: "自测", next: "审阅"} |
| 发版进度 | `release_status(id)` | JSON | {stage: "审阅", checklist: [✓审查, ✓开发, ✓自测, ⏳审阅]} |
| 知识库统计 | `knowledge_stats()` | JSON | {entities: 247, concepts: 83, last_updated: "2026-07-15"} |
| 安全审计日志 | `federation_audit_log()` | JSON | [{event: "device_join", device: "server-01", time: "..."}] |

---

## 四、怎么配置 push target

### 三种 push 通道

| 通道 | 用途 | 配置值 |
|------|------|------|
| Webhook | 推到 IM（飞书/钉钉/企微） | `webhook://feishu/xxx` / `webhook://dingtalk/xxx` / `webhook://wecom/xxx` |
| OpenClaw IM channel | 推到 Agent 对话 | `openclaw://channel/sofagent` |
| daemon 通知 | 本地通知 + lessons-missteps | `daemon://notify` |
| 联邦 knowledge/ | 写入联邦知识库 | `federation://knowledge` |

### 在 workflow 节点中配置

```yaml
# .sofagent/workflow/customer-audit.yml
nodes:
  - id: "review-report"
    type: "auto"
    output:
      target: "webhook://feishu/bc04..."
      format: "markdown"
      trigger: "on_complete"
  - id: "error-notify"
    type: "auto"
    output:
      target: "daemon://notify"
      format: "plain"
      trigger: "on_error"
```

---

## 五、什么时候推到哪

| 触发条件 | 推什么 | 推到哪 | 方式 |
|------|------|------|------|
| FORGE 审查完成 | 审查报告（🔴/🟡/💭） | IM Webhook | MCP push |
| 发版完成 | 版本号 + tag URL + release notes | IM Webhook | MCP push |
| USB 创建完成 | 写入确认 + HMAC 验证结果 | Agent 对话 | MCP response |
| 配对完成 | 联邦密钥确认 | daemon 通知 | MCP push |
| daemon 定时巡检 | 知识库健康报告 | daemon → lessons-missteps | daemon cron |
| Agent 首次连接 | `list_capabilities` 能力清单 | Agent 对话 | MCP response（自动） |
| 联邦 peer 加入/离开 | 设备变更通知 | daemon 通知 | MCP push |
| 密钥轮换 | 新 key 生成 + 旧 key 过期 | daemon 通知 + 联邦 peers | MCP broadcast |
| HITL 确认节点 | 确认提示 | Agent 对话（等待输入） | MCP response |
| 任务失败（3 轮 FAIL） | blocked 通知 + 失败原因 | IM Webhook + daemon | MCP push |
| Dream Cycle 管道完成 | 知识产出统计 | daemon → knowledge/stats | daemon cron |
| **每周审计守护** | **拦截统计 + 审计引擎健康度** | **IM Webhook** | **daemon cron @weekly** |
| **每月知识增长** | **knowledge/ 增长数据 + AI 掌握实体数** | **IM Webhook** | **daemon cron @monthly** |
| **每季度对照** | **裸模型 vs sofagent 回答对比** | **IM Webhook** | **进化引擎** |
| **扩容预警** | **节点数/知识量接近上限** | **IM Webhook** | **daemon 条件触发** |

### 感知报告推送模板（v1.1.3+）

持续感知层的所有推送遵循统一格式——以 FDE 签名为开头，确保客户每次看到结果都知道来源：

```text
✅ [sofagent] 本周审计守护报告
部署团队：FDE [名字] · 部署日期：[日期]
本周扫描 N 次变更 · 拦截 M 次越界 · 累计拦截 Y 次
━━━━━━━━━━━━━━━━━━
部署后累计运行 X 天 · 审计引擎 24 条规则全部在线
```

配置方式见 [FDE/GUIDE.md §5.9 离场](../../FDE/GUIDE.md#59-离场五大能力)。

> 📖 更多见 [PHILOSOPHY §二 交互范式](../PHILOSOPHY.md#二怎么用交互范式) · [FDE/GUIDE.md](../../FDE/GUIDE.md)
