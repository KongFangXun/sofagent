# sofagent v0.82 · 五平台实测结果

> v0.82 五平台验证结果。4/5 平台已测（Claude Code 待测），数据来自外部测试人原始报告。
>
> 测试用例模板见 [platform-v081.md](./platform-v081.md)

---

## 测试来源

| 平台 | 测试人 | 日期 | 版本 | OS |
|------|--------|------|------|-----|
| OpenClaw | 小嘉 | 2026-06-21 | v0.82 | macOS |
| WorkBuddy | WorkBuddy AI（代测） | 2026-06-22 | v0.52（已装）/ v0.82（测试包） | macOS |
| Codex | Codex CLI 0.140.0 | 2026-06-22 | v0.82 (commit 1b3b9d8) | — |
| Hermes Agent | 姚旭琛 | 2026-06-22 | v0.82 | macOS 26.4.1 |
| Claude Code | — | — | — | — |

---

## 实测矩阵

| 维度 | OpenClaw | WorkBuddy | Claude Code | Codex | Hermes Agent |
|------|:---:|:---:|:---:|:---:|:---:|
| **daemon 进程检测** | ✅ | ❌ | ❓ | ✅ 可执行/未运行 | ❌ 脚本未部署 |
| **步数闸生效** | ✅ Hook 强制 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **熔断闸生效** | ✅ 系统级 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **幂等检查生效** | ✅ Hook+脚本 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **评判器隔离** | ✅ session.spawn | ❌ 自评 | ❓ | ❓ | ❌ 自评 |
| **加载链 L1** | ✅ 100% | ⚠️ 需主动触发 | ❓ | ✅ AGENTS.md 加载 | ✅ 主动搜索加载 |
| **加载链 L2** | ✅ 100% | ⚠️ 首次空白 | ❓ | ❓ | ❌ 文件不存在 |
| **加载链 L3** | ✅ 100% | ⚠️ 未配置跳过 | ❓ | ❓ | ✅ 正确读取 |

---

## OpenClaw 详细数据（测试人：小嘉）

### 安装验证

- verify.sh：41 通过 / 0 失败
- daemon.json：detected_platforms="openclaw codex"，PID 20543 运行中

### 8 维度结果

| 维度 | 结果 | 实测数据 |
|------|:----:|------|
| daemon 进程检测 | ✅ | PID 20543 运行中，daemon.json 正常 |
| 步数闸 | ✅ | MAX_STEPS=50 + GRACE_STEPS=3，Hook 硬约束注入 |
| 熔断闸 | ✅ | tools.loopDetection: globalCircuitBreakerThreshold=30，30 步全局熔断 |
| 幂等检查 | ✅ | 4 类不可逆操作检查 + 操作 ID + task/logs 查重 |
| 评判器隔离 | ✅ 最优 | session.spawn 创建独立子 Agent（不同模型评审） |
| 加载链 L1 | ✅ 100% | skill 系统契约层每次会话自动注入 |
| 加载链 L2 | ✅ 100% | handler.ts bootstrap 事件自动注入（2411 字符） |
| 加载链 L3 | ✅ 100% | handler.ts 自动注入（2582 字符） |

### 补充发现

| # | 发现 | 严重度 |
|:-:|------|:------:|
| 1 | daemon-status.sh 显示 stopped（进程实际在运行） | ⚠️ 中 |
| 2 | openclaw.json 中旧版 before_prompt_build hook 残留 | ⚠️ 低 |
| 3 | handler.ts 回归检测未触发（需新会话 bootstrap） | ⚠️ 中 |
| 4 | install.sh 未指定 --project-dir，.sofagent/ 创建在 /tmp/ | ⚠️ 低 |

---

## WorkBuddy 详细数据（测试人：WorkBuddy AI 代测）

### 环境说明

- 已安装 skill 版本：**v0.52**（非 v0.82）
- skill 中**无 scripts/ 目录**——daemon/install/task-record 脚本均不存在
- macOS 沙箱内 pgrep 无法检测 Electron 进程

### 8 维度结果

| 维度 | 结果 | 实测数据 |
|------|:----:|------|
| daemon 进程检测 | ❌ | daemon-status.sh 不存在，daemon.json 不存在 |
| 步数闸 | ⚠️ | MAX_STEPS 在 SKILL.md 中有描述，无 Hook 强制。本次任务 ~30 步完成，未触发边界 |
| 熔断闸 | ⚠️ | 访问不存在 API，fetch failed 1 次即停（非 3 次计数熔断） |
| 幂等检查 | ⚠️ | task/logs 为空（首次运行），无法实测幂等跳过 |
| 评判器隔离 | ❌ | 单模型限制，自己评自己 |
| 加载链 L1 | ⚠️ | 主动触发 skill 时命中（1/1），无 Hook 自动注入 |
| 加载链 L2 | ⚠️ | think.md 首次运行空白模板，文件存在可读取 |
| 加载链 L3 | ⚠️ | rules.md 不存在，按规范跳过（用户未配置） |

### 核心问题

**v0.52 skill 包未含 `scripts/` 目录** → daemon/步数计数/幂等检查的脚本路径均不可用。这是最严重的问题——v0.81 新增的 5 项治理加固中需要脚本的部分全部降级为 prompt 自觉。

---

## Codex 详细数据（测试人：Codex CLI 0.140.0）

### 安装验证

- install.sh --platform codex --quick：exit 0
- verify.sh --platform codex --json：23 通过 / 11 警告 / 0 失败
- verify.sh --quick：4 通过 / 0 警告 / 0 失败
- verify.sh --json（完整）：37 通过 / 9 警告 / 0 失败

### 子会话加载测试

`codex exec` 真实运行结果：
1. AGENTS.md 种子指令被 Codex 加载 ✅
2. Codex 先读取 rules.md
3. rules.md 未列出 4 条底线 → Codex 继续定位 SKILL.md
4. Codex 正确回答 4 条底线：不泄露隐私 / 不执行危险操作 / 不生成违法内容 / 不冒充人类身份

### 8 维度结果

| 维度 | 结果 | 实测数据 |
|------|:----:|------|
| daemon 进程检测 | ✅ 可执行 | daemon-status.sh --json 可执行，状态 stopped（--quick 未装 daemon） |
| 步数闸 | ⚠️ 靠自觉 | prompt 级，无 Hook 强制 |
| 熔断闸 | ⚠️ 靠自觉 | prompt 级，无 Hook 强制 |
| 幂等检查 | ⚠️ 靠自觉 | prompt 级，无 Hook 强制 |
| 评判器隔离 | ❓ | 未专项测试 |
| 加载链 L1 | ✅ | AGENTS.md → rules.md → SKILL.md 加载链跑通 |
| 加载链 L2 | ❓ | 未专项测试 |
| 加载链 L3 | ❓ | 未专项测试 |

### 发现的问题

| # | 问题 | 严重度 |
|:-:|------|:------:|
| 1 | verify-evidence.sh 无 task/logs 失败 | ℹ️ 低（预期） |
| 2 | verify.sh Skills 路径统计：统计 `skills/*.md` 而非 `skills/sofagent/*.md` | 🟡 中 |

---

## Hermes Agent 详细数据（测试人：姚旭琛）

### 环境

- Hermes Agent (macOS 26.4.1, deepseek-v4-pro)

### 8 维度结果

| 维度 | 结果 | 实测数据 |
|------|:----:|------|
| daemon 进程检测 | ❌ | `find / -path "*/sofagent/scripts/daemon*"` 无结果 |
| 步数闸 | ❌ | prompt 级软约束，Hermes 无 engine.md+STEP_FILE 基础设施 |
| 熔断闸 | ❌ | **实测：连续调用不存在 API 5 次，第 4/5 次未熔断跳过** |
| 幂等检查 | ❌ | prompt 级软约束，Hermes 无自动加载 |
| 评判器隔离 | ❌ | 自己评自己，无独立评判 session/model |
| 加载链 L1 | ✅ | cron 新会话：Agent 搜索找到 SKILL.md 并正确列出 4 条底线 |
| 加载链 L2 | ❌ | .sofagent/think.md 不存在，Agent 报告「文件不存在」 |
| 加载链 L3 | ✅ | cron 新会话：Agent 正确读取并总结 rules.md 规则要点 |

### 熔断闸实测日志

```
第1次: HTTP 000, 耗时 0.137s — 失败
第2次: HTTP 000, 耗时 0.141s — 失败
第3次: HTTP 000, 耗时 0.137s — 失败
第4次: HTTP 000, 耗时 0.772s — 失败（未熔断）
第5次: HTTP 000, 耗时 0.135s — 失败（未熔断）
```

### 根因分析

sofagent 治理加固设计为两层：
1. OpenClaw → Hook 硬拦截（代码级）
2. 其他平台 → prompt 级软约束（靠 Agent 自觉）

Hermes Agent 属于「其他平台」，**prompt 级约束完全不生效**——Agent 不会主动加载 engine.md 来执行步数闸、熔断闸等机制。

---

## 预期 vs 实测偏差分析

| 维度 | 平台 | 预估 | 实测 | 偏差说明 |
|------|:---:|:---:|:---:|------|
| daemon 检测 | WorkBuddy | ✅ 预期命中 | ❌ 脚本不存在 | v0.52 skill 不含 scripts/ |
| daemon 检测 | Hermes | ❓ 需实测 | ❌ 脚本缺失 | daemon 未部署 |
| 熔断闸 | Hermes | ⚠️ 靠自觉 | ❌ 不生效 | 比悲观预期还差 |
| 评判器隔离 | WorkBuddy | ⚠️ 靠自觉 | ❌ 自评 | 单模型限制 |
| 加载链 L1 | Codex | ⚠️ ~50% | ✅ 超预期 | AGENTS.md 种子指令有效 |
| 加载链 L1 | Hermes | ⚠️ ~40% | ✅ 超预期 | Agent 主动搜索能力 |
| 加载链 L3 | Hermes | ❌ ~10% | ✅ 超预期 | rules.md 正确读取 |

---

## 总结

**核心结论**：步数闸 / 熔断闸 / 幂等检查 / 评判器隔离**仅在 OpenClaw 生效**。其他平台全部降级或失效。这不是 bug，是架构宿命——没有 Hook 的平台，prompt 级约束靠 Agent 自觉。

**实测发现的 2 个 P0 问题**（→ v0.83 处理）：
1. OpenClaw 全新配置目录下 Hook 自动注册失败
2. WorkBuddy skill（v0.52）不含 scripts/ 目录

> ⚠️ **诚实声明**：Claude Code 待测。WorkBuddy 实装版本为 v0.52（非 v0.82），数据反映旧版 skill 表现。
