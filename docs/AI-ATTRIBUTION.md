# 代码面归属约定（AI 参与度度量的判据前置）

> **裁定源**：`tasks/F6.md` §十二·四（S3 裁定 2026-11-04）· 判据原文要求「先登记裁定再接线」
> **本文件的作用**：给 `computeAiParticipation` 提供**可复算的归属口径**与**实测的域清单**。口径由裁定给死，本文件只登记真值，不改口径。

## 一、口径（照抄裁定，不得改写）

AI 参与度 = 「AI 参与产出的提交数 / 统计窗口内总提交数」。归属判定**双轨**：

| 轨 | 判据 | 说明 |
|---|---|---|
| ① 邮箱域 | `author` 或 `committer` 的邮箱域命中 **AI 账号域清单** | 域级匹配，不做人名匹配（人名会漂移） |
| ② 协作 trailer | commit message 带 `Co-authored-by:` / `Generated-by:` / `AI-Assisted:` 且值指向 **AI 账号域** | 未命中轨①时补充 |

**边界**：只用于度量报告，**不改 git 历史、不改账号体系**；命中即计，不区分贡献行数。

## 二、实测清单（本仓真值，`2026-11-04 @ factory 142b57b`）

### 2.1 作者/提交者邮箱域（`git log --format='%ae' | sort -u` 全量）

| 域 | 提交数 | 归属 |
|---|---|---|
| `users.noreply.github.com` | 3917 | 人（主账号 `kongfangxun@`） |
| `evfrey.com` | 1338 | 人（`kong.yao@`） |
| `outlook.com` | 85 | 人（`kongyao@` / `hypergroups89@`） |
| `test.com` | 11 | 测试夹具（`test@test.com`，非真实产出） |
| `qq.com` | 1 | 人（`1422600092@`） |

> **合计 5352**。复算：`git log --format='%ae' | sed 's/.*@//' | sort | uniq -c | sort -rn`

### 2.2 AI 账号域清单（**从 trailer 实测反推**，不是拍脑袋）

| 域 | 证据（trailer 原文） | 命中数 |
|---|---|---|
| `anthropic.com` | `Co-Authored-By: Claude <noreply@anthropic.com>` | 8 |
| `deepseek.com` | `Co-Authored-By: DeepSeek V4 Pro <noreply@deepseek.com>` | 1（另有 2 条只写 `Co-authored-by: DeepSeek` 无域，靠名称 token 命中轨②） |
| `cursor.com` | `Co-authored-by: Cursor <cursoragent@cursor.com>` | 4 |
| `tencent.com` | `Co-Authored-By: WorkBuddy <workbuddy@tencent.com>` | 1 |
| `sofagent.dev` | `Co-Authored-By: software-engineer <alex@sofagent.dev>` | 1 |

> 复算：`git log --format='%b' | grep -iE '^co-authored-by:|^generated-by:|^ai-assisted:' | sort | uniq -c`
> **注意**：轨①目前**零命中**（无提交用 AI 域作 author/committer）；AI 参与全部由轨② 计入。这不是缺陷，是当前实况。

## 三、当前读数（同批实测）

| 量 | 值 |
|---|---|
| 窗口内总提交 | 5352 |
| 轨②命中（有 AI trailer 的提交） | **18** |
| 轨①命中（AI 域作作者） | 0 |
| 比例 | **0.0034**（18 / 5352） |

> 比例是**下界**：没有 trailer 的 AI 协作不可见（局限注记①）。本读数不得对外作能力声明。

## 四、复算命令（逐条可机械核）

```bash
# 域清单
git log --format='%ae' | sed 's/.*@//' | sort | uniq -c | sort -rn
# trailer 命中清单
git log --format='%b' | grep -iE '^co-authored-by:|^generated-by:|^ai-assisted:' | sort | uniq -c
# 命中 trailer 的提交数（去重；与 CLI 输出同口径）
node engine/orchestrator/dist/cli.js judge-attribution --limit 0 | head -5
```

## 五、与实现的对应

`engine/orchestrator/src/router/judge-observability.ts`：

- `AI_ACCOUNT_DOMAINS` —— 本文件 §2.2 的域清单（代码内常量，改这里必须同批改本节）
- `CommitMeta.authorEmail` / `committerEmail` —— 轨①输入（可选，缺省即不判轨①）
- `AI_TRAILER_PATTERNS` —— 轨②输入（正则含域白名单，避免把任意 `Co-authored-by: 张三` 计入）

**改口径的路径**：只走 `tasks/F6.md` §十二·四 重裁 → 同批改本文件 §一 与代码常量。**不得单改一处**。
