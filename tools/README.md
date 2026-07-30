# tools/ — 用户可用的运维工具脚本

| 脚本 | 用途 | 何时使用 |
|------|------|---------|
| `check-version.sh` | 版本号一致性检查 | 发布前 |
| `pre-push-check.sh` | 推送前完整检查 | git push 前 |
| `sign-config.mjs` | 配置文件签名 | 安装后 |
| `sofagent-dashboard.sh` | 审计仪表盘 | 日常监控 |

其他运维脚本位于 `engine/scripts/`，仅供内部使用。
