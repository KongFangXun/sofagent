# sofagent v0.82 测试结果

测试时间：2026-06-22

## 测试对象

- 修正版文档包：`outputs/sofagent-v082-测试包-fixed.zip`
- 下载源码仓库：`https://github.com/KongFangXun/sofagent.git`
- 源码 commit：`1b3b9d8cfac23b5dcdb5f22fba2cf58ea296ffc8`

## 文档包测试

| 测试项 | 结果 | 说明 |
|------|:--:|------|
| ZIP 完整性校验 | 通过 | `unzip -t` 无压缩数据错误 |
| ZIP 文件清单 | 通过 | 包内包含 1 个目录和 4 个 Markdown 文件 |
| Markdown 编码 | 通过 | 4 个 `.md` 文件均为 UTF-8 文本 |
| 旧版本残留检查 | 通过 | 未发现 `v0.81`、`platform-v081`、`test-cases`、`docs/` 残留引用 |
| Markdown 表格列数检查 | 通过 | 未发现连续表格行列数不一致 |
| 相对链接检查 | 通过 | `platform-matrix.md` 仅引用包内存在的 `./platform-v082.md` |
| 文件名一致性检查 | 通过 | 测试用例文件已统一为 `platform-v082.md` |
| 测试维度完整性检查 | 通过 | 矩阵和报告模板均包含 8 个维度、5 个平台 |

## 源码安装/验证测试

| 测试项 | 结果 | 说明 |
|------|:--:|------|
| 源码下载 | 通过 | 成功 clone `KongFangXun/sofagent` |
| Shell 语法检查 | 通过 | `sofagent/scripts/*.sh` 全部通过 `bash -n` |
| OpenClaw 安装烟测 | 通过/有警告 | `install.sh --platform openclaw --no-ao --quick` exit 0 |
| WorkBuddy 安装烟测 | 通过 | `install.sh --platform workbuddy --quick` exit 0 |
| Claude 安装烟测 | 通过 | `install.sh --platform claude --quick` exit 0 |
| Codex 安装烟测 | 通过 | `install.sh --platform codex --quick` exit 0 |
| Hermes 安装烟测 | 通过 | `install.sh --platform hermes --quick` exit 0 |
| 快速验证 | 通过 | `verify.sh --quick`：4 通过 / 0 警告 / 0 失败 |
| 完整验证 | 通过/有警告 | `verify.sh --json`：37 通过 / 9 警告 / 0 失败，exit 0 |
| daemon 状态查询 | 通过/未运行 | `daemon-status.sh --json` 可执行，状态为 `stopped` |
| 证据验证 | 未通过 | `verify-evidence.sh` 返回失败：今日无 task/logs 记录 |

## Codex 专项实测

| 测试项 | 结果 | 说明 |
|------|:--:|------|
| Codex CLI 可用性 | 通过 | `codex --version` 返回 `codex-cli 0.140.0-alpha.19` |
| Codex doctor | 有环境问题 | 认证已配置，但 provider endpoint 不可达；默认沙箱下状态库写入受限 |
| Codex 安装分支 | 通过 | `install.sh --platform codex --quick` exit 0，部署到临时 `$HOME/.codex` |
| Codex 平台验证 | 通过/有警告 | `verify.sh --platform codex --json`：23 通过 / 11 警告 / 0 失败 |
| Codex quick 验证 | 通过/有警告 | `verify.sh --platform codex --quick`：3 通过 / 1 警告 / 0 失败；警告为项目 `.sofagent/` 尚未创建 |
| Codex 子会话加载测试 | 通过 | 真实运行 `codex exec`，按 `AGENTS.md` 读取 `rules.md` 和 `SKILL.md` 后正确回答 4 条底线 |

Codex 子会话输出已保存到：`outputs/codex-sofagent-smoke-output.txt`

子会话结论：

- `AGENTS.md` 种子指令能被 Codex 加载。
- Codex 先读取了 `rules.md`。
- 因 `rules.md` 未列出 4 条底线，Codex 继续定位并读取 `SKILL.md`。
- Codex 正确回答 4 条底线：
  1. 不泄露隐私
  2. 不执行危险操作
  3. 不生成违法内容
  4. 不冒充人类身份
- 只读沙箱下无法创建 `.sofagent/` 空模板，这符合当前测试沙箱限制。

## 发现的问题

1. OpenClaw Hook 自动注册失败。

复现方式：在全新临时 `OPENCLAW_STATE_DIR` 下运行：

```bash
bash sofagent/scripts/install.sh --platform openclaw --no-ao --quick --project-dir <tmp-project>
```

现象：

- Hook 文件部署成功：`hooks/sofagent-load-chain/HOOK.md` 和 `handler.ts` 存在
- `openclaw.json` 自动注册失败
- 生成了空的 `openclaw.json.tmp`
- 安装脚本提示需要手动添加：

```json
{"hooks":{"internal":{"enabled":true,"entries":{"sofagent-load-chain":{"enabled":true}}}}}
```

初步判断：`install.sh` 在 `jq` 可用且 `openclaw.json` 不存在时，直接用 `jq ... "$HOOK_CONFIG"` 读取不存在文件，导致注册失败；没有回退到 Node 分支创建新配置文件。

2. `verify-evidence.sh` 在无任务日志的新安装环境中失败。

这是数据缺失导致的预期失败，不代表安装失败。需要先执行任务并生成 `.sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md` 后再验证。

3. daemon 未安装/未运行。

本次使用 `--quick`，脚本按设计跳过 daemon 安装。`daemon-status.sh --json` 能正常执行，返回 `stopped`。

4. Codex 平台验证脚本有路径统计小瑕疵。

`verify.sh --platform codex --json` 在临时 `$HOME/.codex/skills/sofagent` 已部署 12 个文件的情况下，仍输出 `Skills 目录存在: 0 个 .md 文件`。原因是脚本统计的是 `$HOME/.codex/skills/*.md`，而实际文件在 `$HOME/.codex/skills/sofagent/*.md`。这不影响安装结果，但会让验证摘要误导。

## 结论

修正版文档包质量测试通过。下载源码后的安装烟测和官方验证脚本整体通过，Codex 实测通过：安装分支、平台验证和真实 `codex exec` 加载测试均可跑通。

需要反馈给维护者的主要问题是：OpenClaw 全新配置目录下 Hook 自动注册失败，可能导致约束层不会自动加载，需要手动修改 `openclaw.json` 或修复 `install.sh` 的配置创建逻辑。
