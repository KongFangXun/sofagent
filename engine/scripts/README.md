# engine/scripts/ — 安装链脚本（随 install.sh 到达用户）

> **边界说明（v1.4.5 修正）**：本目录脚本**是用户安装链的一部分**，不是 engine 内部专用——install.sh（经 `lib/file-deploy.sh` 的 `deploy_scripts()`）将 `task-record.sh` / `cleanup.sh` / `audit.sh` / `lib/config.sh` 部署到用户目标目录的 `scripts/` 下，随安装流程到达用户机器并长期驻留。**修改本目录脚本 = 修改用户可见行为**，需按用户面变更对待（过审计 + 发版说明），不按内部实现对待。
>
> 维护者侧的发版 SOP 与仓库健康检查脚本在 [`tools/`](../../tools/README.md)，**不随安装分发**——两个目录的分工：`engine/scripts/` 给用户装、`tools/` 给维护者用。
