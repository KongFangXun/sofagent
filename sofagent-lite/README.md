# sofagent-lite

> sofagent 轻量版——只有宪法（4 底线 + 6 则铁律），30 秒装好，不装 daemon、编排、审计。
>
> v0.95 · 孔放勋

**不想装一整套引擎和审计工具，只想给 Agent 挂个纪律底线？** 这就是你要的。

lite 只做一件事：把 4 底线 + 6 则铁律塞进 Agent 上下文，让它干活先看上下文、做完验证、改完说结果——不需要你盯着。**就这 4+6 条，所有平台都生效。**

> 完整版还多三层：反思区（踩坑自动记）、编排引擎（复杂任务拆解）、提交时审计（git diff 兜底）。如果你需要这些，去装 [完整版](../README.md)。如果你只想先挂个底线，lite 足够。

---

## 30 秒装好

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent/sofagent-lite && sh install.sh
```

`install.sh` 自动探测你的平台：
- **OpenClaw** → 装到 `~/.openclaw/skills/sofagent-lite/`
- **WorkBuddy** → 装到 `~/.workbuddy/skills/sofagent-lite/`
- **没检测到**（Claude Code / Codex / Hermes 等）→ 直接把 10 条规则打印到终端，你复制粘贴到 Agent 配置顶部即可

手动指定平台：`sh install.sh openclaw` 或 `sh install.sh workbuddy`

### 装完验证

打开你的 Agent 客户端，随便问个任务。如果 Agent 开始「不确定就问」「错误显性化」——说明宪法层已生效。不需要额外操作。

---

## 装了什么

**一个文件：`SKILL.md`。** 40 行，没有任何脚本、没有依赖、没有后台进程。

10 条规则分两层：

| 层 | 条数 | 管什么 |
|:--:|:--:|------|
| **4 底线** | 4 条 | 红线——不泄露隐私、不执行危险操作、不生成有害内容、不冒充人类 |
| **6 则铁律** | 6 条 | 工作习惯——对用户有回应、全局视角、不确定就问、错误显性化、目标驱动、成本意识 |

> 这 10 条和完整版宪法层**完全一致**——同一个 SKILL.md，同样的内容。区别是 lite 只装这一层，完整版在上面还叠了反思、编排、审计。

---

## 什么时候选 lite

| 你的情况 | 为什么 lite 够用 |
|------|------|
| **非 OpenClaw 平台** | 完整版的编排引擎、Hook、断路器只在 OpenClaw 上生效——其他平台装完整版也只能用宪法层，不如直接装 lite，省事 |
| **个人开发者只想挂底线** | 你不需要任务拆解、提交审计、多 Agent 协作——你只想让 Agent 别乱来 |
| **FDE 驻场快速部署的第一步** | 客户现场 30 秒挂上底线，先让 Agent 守规矩。后续要加编排引擎和审计，再装完整版——同一个仓库，直接升级 |

> **和 FDE 的关系**：sofagent-fde（十步企业部署流程）的第一步就是给 Agent 挂底线。lite 是这个第一步的执行工具。FDE 驻场时先装 lite，再按 fde 流程逐步加编排引擎和审计。

---

## 什么时候不该选 lite

如果你需要以下任何一个，去装 [完整版](../README.md)：

- **反思记忆**——踩过的坑自动记到 think.md，下次避开
- **任务编排**——复杂任务自动拆解成子任务、分配角色、闭环验收
- **提交时审计**——git diff 扫 Agent 改了什么、有没有越界
- **多 Agent 协作**——主理人调度多个角色成员一起干

---

## 和完整版的区别

一句话：**lite = 完整版的第一层（宪法层），不多不少。**

| 能力 | sofagent-lite | sofagent 完整版 |
|------|:---:|:---:|
| 4 底线 + 6 则铁律 | ✅ | ✅ |
| 安装文件数 | 1 个（SKILL.md） | 15+ 个 |
| 安装时间 | ~30 秒 | ~2 分钟 |
| 外部依赖 | 无 | node ≥18（审计）/ npm（编排） |
| 平台 | 任何平台 | OpenClaw 全功能；其他平台降级 |

---

**了解更多**：[完整版仓库](../README.md) · [Handbook（设计哲学）](../HANDBOOK.md) · [ClawHub](https://clawhub.ai/KongFangXun/sofagent) · [SkillHub](https://skillhub.cn/skills/sofagent)
