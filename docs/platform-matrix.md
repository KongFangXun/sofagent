# sofagent 五平台能力矩阵

> v0.82 五平台实测（2026-06-22）。OpenClaw / WorkBuddy / Codex / Hermes Agent 已实测，Claude Code 待测。
>
> 详见测试用例：[docs/test-cases/platform-v081.md](./test-cases/platform-v081.md)

---

## 8 维度 × 5 平台（实测结果）

| 维度 | OpenClaw | WorkBuddy | Claude Code | Codex | Hermes Agent |
|------|:---:|:---:|:---:|:---:|:---:|
| **daemon 进程检测** | ✅ | ❌ | ❓ | ✅ 可执行/未运行 | ❌ 脚本未部署 |
| **步数闸生效** | ✅ Hook 强制 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **熔断闸生效** | ✅ 系统级 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **幂等检查生效** | ✅ Hook+脚本 | ⚠️ 靠自觉 | ❓ | ⚠️ 靠自觉 | ❌ 不生效 |
| **评判器隔离** | ✅ session.spawn | ❌ 自评 | ❓ | ❓ | ❌ 自评 |
| **加载链 L1（SKILL.md）** | ✅ 100% | ⚠️ 需主动触发 | ❓ | ✅ AGENTS.md 加载 | ✅ 主动搜索加载 |
| **加载链 L2（think.md）** | ✅ 100% | ⚠️ 首次空白 | ❓ | ❓ | ❌ 文件不存在 |
| **加载链 L3（rules.md）** | ✅ 100% | ⚠️ 未配置跳过 | ❓ | ❓ | ✅ 正确读取 |

---

## 预期 vs 实测对比

| 维度 | OpenClaw | WorkBuddy | Codex | Hermes Agent |
|------|:---:|:---:|:---:|:---:|
| **daemon 检测** | ✅ 预期命中 → ✅ 实测命中 | ✅ 预期命中 → ❌ 脚本不存在 | ❓ 需实测 → ✅ 可执行 | ❓ 需实测 → ❌ 脚本缺失 |
| **步数闸** | ✅ Hook 强制 → ✅ 实测生效 | ⚠️ 靠自觉 → ⚠️ 靠自觉（未触发） | ⚠️ 靠自觉 → ⚠️ 靠自觉 | ⚠️ 靠自觉 → ❌ 不生效 |
| **熔断闸** | ✅ Hook 强制 → ✅ 系统级 | ⚠️ 靠自觉 → ⚠️ 1 次即停 | ⚠️ 靠自觉 → ⚠️ 靠自觉 | ⚠️ 靠自觉 → ❌ 5 次未熔断 |
| **幂等检查** | ✅ Hook 强制 → ✅ 实测通过 | ⚠️ 靠自觉 → ⚠️ task/logs 为空 | ⚠️ 靠自觉 → ⚠️ 靠自觉 | ⚠️ 靠自觉 → ❌ 不生效 |
| **评判器隔离** | ✅ session.spawn → ✅ 最优 | ⚠️ 靠自觉 → ❌ 自己评自己 | ⚠️ 靠自觉 → ❓ | ⚠️ 靠自觉 → ❌ 自己评自己 |
| **加载链 L1** | ✅ 已验证 → ✅ 100% | ✅ 已验证 → ⚠️ 需主动触发 | ⚠️ ~50% → ✅ 超预期 | ⚠️ ~40% → ✅ 超预期 |
| **加载链 L2** | ✅ 已验证 → ✅ 100% | ⚠️ ~70% → ⚠️ 首次空白 | ⚠️ ~30% → ❓ | ⚠️ ~20% → ❌ 文件不存在 |
| **加载链 L3** | ✅ 已验证 → ✅ 100% | ⚠️ ~60% → ⚠️ 未配置 | ⚠️ ~20% → ❓ | ❌ ~10% → ✅ 超预期 |

> ✅ = 已验证生效 / ⚠️ = 靠 Agent 自觉 / ❌ = 已知不生效 / ❓ = 待实测

---

## 关键发现

### OpenClaw（8/8 通过）

唯一全维度通过的平台。Hook 系统 + systemd 级断路器 + session.spawn 评判器隔离构成完整纪律闭环。

- verify.sh 41 通过 0 失败
- 加载链 L1-L3 通过 Hook 自动注入，命中率 100%
- 熔断闸为系统级（loopDetection），30 步全局熔断

### WorkBuddy（0/8 硬约束生效）

**核心问题**：已安装 skill 为 v0.52，不含 `scripts/` 目录，daemon/install/task-record 脚本均不存在。治理加固全部降级为 prompt 自觉。

- 加载链 L1 在主动触发时命中，但无 Hook 自动注入
- 评判器隔离 ❌——单模型限制，自己评自己
- 建议：scripts/ 打包进 skill 或提供纯 LLM 实现路径

### Codex（安装通过，治理靠自觉）

安装烟测 + 平台验证均通过。`codex exec` 真实加载测试通过——AGENTS.md 种子指令 → rules.md → SKILL.md 加载链跑通，正确回答 4 条底线。

- verify.sh --platform codex：23 通过 / 11 警告 / 0 失败
- daemon-status.sh 可执行，状态 stopped（--quick 模式未装 daemon）
- 治理加固为 prompt 级，靠 Agent 自觉

### Hermes Agent（2/8 生效）

最诚实的测试。4 项治理加固全部不生效，熔断闸实测连续 5 次调用不存在 API 未熔断。

- L1 加载链 ✅——Agent 主动搜索找到 SKILL.md（非自动注入）
- L3 加载链 ✅——rules.md 正确读取
- L2 加载链 ❌——think.md 文件不存在
- **根因确认**：prompt 级约束在 Hermes Agent 上完全不生效，Agent 不会主动加载 engine.md 执行步数闸/熔断闸

---

## 发现的问题

| # | 问题 | 严重度 | 平台 | 说明 |
|:-:|------|:------:|:---:|------|
| 1 | OpenClaw Hook 自动注册失败 | 🔴 高 | OpenClaw | 全新配置目录下 `openclaw.json` 注册失败，生成空 `.tmp` 文件。需手动添加或修复 install.sh |
| 2 | WorkBuddy skill 不含 scripts/ | 🔴 高 | WorkBuddy | v0.52 skill 包未含 daemon/install 等脚本，治理加固无法运作 |
| 3 | verify.sh Skills 路径统计瑕疵 | 🟡 中 | Codex | 统计 `skills/*.md` 而非 `skills/sofagent/*.md`，输出误导 |
| 4 | daemon-status.sh 状态不稳定 | 🟡 中 | OpenClaw | 进程在运行（PID 可查），但 status 显示 stopped |
| 5 | verify-evidence.sh 无日志失败 | ℹ️ 低 | 全平台 | 新装环境无 task/logs 记录，属预期失败 |
| 6 | daemon 未运行 | ℹ️ 低 | 全平台 | --quick 模式跳过 daemon 安装，符合设计 |

---

## 图例

| 标记 | 含义 |
|:--:|------|
| ✅ | 已验证生效 |
| ❓ | 待实测（Claude Code 全部待测） |
| ❌ | 已知不生效 |
| ⚠️ | 靠 Agent 自觉，命中率不定 |

---

## 测试来源

| 平台 | 测试人 | 日期 | 版本 |
|------|--------|------|------|
| OpenClaw | 小嘉 | 2026-06-21 | v0.82 |
| WorkBuddy | WorkBuddy AI 代测 | 2026-06-22 | v0.52（已装）/ v0.82（测试包） |
| Codex | Codex CLI 0.140.0 | 2026-06-22 | v0.82（commit 1b3b9d8） |
| Hermes Agent | 姚旭琛 | 2026-06-22 | v0.82 |
| Claude Code | — | — | 待测 |

> ⚠️ **诚实声明**：Claude Code 待测。WorkBuddy 实装版本为 v0.52（非 v0.82），数据反映旧版 skill 表现。
