# Case 024：v0.99.8 外部用户 macOS 全链路验证（xue52101-lzk）

> **定位**：v1.0 准入 #7 外部用户验证——真实外部用户在 macOS 上按测试计划走完 8/8 场景。

## 基本信息

| 项 | 值 |
|------|------|
| 测试人 | [xue52101-lzk](https://github.com/xue52101-lzk) |
| 平台 | macOS 23.5.0 (arm64) · Node.js v25.8.1 · OpenClaw |
| 版本 | sofagent v0.99.8 |
| 日期 | 2026-07-06 10:19–10:45 CST |

## 测试结果：8/8 场景全部通过

| # | 场景 | 状态 | 关键结果 |
|:-:|:----|:----:|:---------|
| ① | 首次安装体验 | ✅ | verify 31 pass / 10 warn / 0 fail |
| ② | Secret 泄露检测 | ✅ | OpenAI/AWS/GitHub 三违禁全检出，零误报 |
| ③ | daemon 自动监控 | ✅ | launchd 注册→启动→30s 循环→hash 变更日志完整 |
| ④ | FDE 工具包 | ✅ | 7 份核心文档完整，模拟部署 13 个 AI 节点方案 |
| ⑤ | ao 编排 | ✅ | ao demo 跑通 4 步/4 角色（27.3s / 4,469 tokens） |
| ⑥ | MCP Server | ✅ | initialize + tools/list(3) + tools/call 全链路 |
| ⑦ | Skill 加载 | ✅ | 三层加载链完整生效 |
| ⑧ | npm 升级 | ✅ | 0.99.7→0.99.8 配置不丢失 |

**综合评分**：8.5/10

## 关键亮点

### FDE 模拟企业部署
50 人电商公司（星火优选科技，跨境电商/DTC品牌零售），3 部门梳理出 14 个 AI 节点（8 🔄 + 5 ⚡ + 1 👤），年总节省 ≈ ¥700K+，3-6 个月回本。

### daemon 完整日志验证
think.md / fde.md hash 变更检测日志完整，daemon.json 状态正确，daemon-notice.md 通知机制生效。

### ao demo 4 角色协作
叙事学家→心理学家→叙事设计师→内容创作者，4/4 步全部完成，27.3s，4469 tokens。

## 测试计划符合性

| 要求 | 结果 |
|------|:----:|
| macOS 或 Linux 平台 | ✅ macOS 23.5 |
| 真实外部用户 | ✅ |
| 核心场景 1-3 全做 | ✅ |
| ≥5 场景 | ✅ 8/8 |
| 反馈数据 | ✅ |

---
*原始报告：`sofagent-v1.0-test-report.md`（Desktop 归档）*
