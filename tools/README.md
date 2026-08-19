# tools/ — 用户可用的运维工具脚本

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check-version.sh` | 版本号一致性检查 | 发布前 |
| `check-review-system.sh` | 审查体系一致性（维度数/警戒线/S 编号闭环对账） | 发版 SOP 阶段七 |
| `check-tool-health.sh` | 工具脚本健康（路径活性/孤儿配置/set -u 守卫） | 发版 SOP 阶段九 |
| `pre-push-check.sh` | 推送前完整检查 | git push 前 |
| `sign-config.mjs` | 配置文件签名 | 安装后 |
| `sofagent-dashboard.sh` | 审计仪表盘 | 日常监控 |

> **边界说明**：`engine/scripts/` 是 install.sh 组装调用的**用户安装链**（install / verify / daemon 等随安装流程到达用户）；`tools/` 面向维护者发版 SOP 与仓库健康检查，不随安装分发。
