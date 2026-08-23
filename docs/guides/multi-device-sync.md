# 多设备同步指南 · Multi-Device Sync

> v1.1.x 轻量多设备——用云存储同步 knowledge/ + think.md，零代码改动，零新依赖。
>
> ⚠️ **数据主权取舍（先读）**：本指南的云盘方案（iCloud / NAS / Dropbox）会把 `knowledge/` 与 `think.md` 托管给云盘服务商——**即数据离开本机**，与 [SECURITY.md](../../SECURITY.md)「数据不出本机」的默认承诺互斥。这是用户自主配置的例外，不是默认行为；对数据主权有硬性要求的场景请勿启用（联邦查询是加密受控的替代路径，见 SECURITY §一传输安全）。

## 原理（30 秒版）

sofagent 不建传输层。它只读写本地文件。你把 sofagent 的知识目录放进云盘文件夹，操作系统负责同步到其他设备——sofagent 根本不知道自己在多设备上跑。

```
设备 A                        云盘（iCloud / NAS / Dropbox）           设备 B
  │                              │                               │
  ├─ 写 think.md ──────────────→ 同步 ──────────────────────────→ 读 think.md
  ├─ 写 knowledge/ ────────────→ 同步 ──────────────────────────→ 读 knowledge/
  │                              │                               │
  └─ sofagent 只管读写          └─ 操作系统/云盘客户端管传输       └─ sofagent 只管读写
```

sofagent 做的事情：
- **加载链**：shared knowledge 优先注入（设备 A 踩的坑，设备 B 先看到）
- **Ontology 合并**：entities 的 `relations` 字段自动合并关联网
- **lessons 追加**：按日期追加，不覆盖已有条目

## 方案一：iCloud Drive（macOS 最简单）

适合：全 Apple 生态、个人开发者。

### 步骤

1. 把 sofagent 知识目录挪到 iCloud Drive：
```bash
# 移动现有内容
mkdir -p ~/Library/Mobile\ Documents/com~apple~CloudDocs/sofagent
cp -r ~/.sofagent/knowledge ~/Library/Mobile\ Documents/com~apple~CloudDocs/sofagent/
cp ~/.sofagent/think.md ~/Library/Mobile\ Documents/com~apple~CloudDocs/sofagent/

# 替换为符号链接（sofagent 仍然读写原路径，实际落在 iCloud）
rm -rf ~/.sofagent/knowledge ~/.sofagent/think.md
ln -s ~/Library/Mobile\ Documents/com~apple~CloudDocs/sofagent/knowledge ~/.sofagent/knowledge
ln -s ~/Library/Mobile\ Documents/com~apple~CloudDocs/sofagent/think.md ~/.sofagent/think.md
```

2. 在另一台 Mac 上做同样的符号链接。

3. 确认 iCloud Drive 已开启、「桌面与文稿文件夹」不需要——只要 iCloud Drive 本身开着就行。

**⚠️ 冲突处理**：两台设备同时写 `think.md` → macOS 会生成 `think 2.md`。sofagent 的 daemon 不会自动合并同名冲突。建议各设备写 think.md 时附带不同的 task 名称（sofagent 已内建 task 名去重，正常情况下不会冲突）。

## 方案二：NAS / SMB 挂载（办公环境）

适合：企业内部、固定局域网、IT 配好了 NAS。

### 步骤

1. 在 NAS 上创建共享目录：
```bash
# NAS 上（示例）
mkdir -p /volume1/sofagent-team/knowledge
```

2. 每台设备挂载 NAS 并建立符号链接：
```bash
# macOS
mkdir -p /Volumes/sofagent-team
mount_smbfs //user@nas.local/sofagent-team /Volumes/sofagent-team
ln -s /Volumes/sofagent-team/knowledge ~/.sofagent/knowledge
ln -s /Volumes/sofagent-team/think.md ~/.sofagent/think.md

# Linux
mkdir -p /mnt/sofagent-team
mount -t cifs //nas.local/sofagent-team /mnt/sofagent-team -o username=user
ln -s /mnt/sofagent-team/knowledge ~/.sofagent/knowledge
```

3. 把挂载命令写入 `/etc/fstab`（Linux）或「登录项」（macOS 设置 → 通用 → 登录项），开机自动挂载。

**⚠️ 离线场景**：设备离开局域网后 `~/.sofagent/knowledge` 会变空（NAS 断连）。daemon 的 `weekly-report` / `lessons-extract` 会跳过（检测目录为空不运行），不会写脏数据。

## 方案三：Dropbox / Google Drive（跨平台）

适合：Windows + Mac 混用、非技术用户。

### 步骤

1. 在所有设备上安装同一个云盘客户端（Dropbox / Google Drive / OneDrive）。

2. 把 sofagent 知识目录放进云盘：
```bash
# Dropbox 示例
mkdir -p ~/Dropbox/sofagent
mv ~/.sofagent/knowledge ~/Dropbox/sofagent/
mv ~/.sofagent/think.md ~/Dropbox/sofagent/
ln -s ~/Dropbox/sofagent/knowledge ~/.sofagent/knowledge
ln -s ~/Dropbox/sofagent/think.md ~/.sofagent/think.md
```

3. 其他设备同样操作。云盘客户端自动同步。

**⚠️ 延迟**：云盘同步有几秒到几分钟延迟，不是实时的。如果设备 A 刚写完 think.md，设备 B 立刻跑 daemon——可能读到旧版本。这是轻量多设备的设计取舍，v1.2.x 再做实时同步。

## 方案四：git submodule（开发者）

适合：习惯用 git 的开发者、想保留版本历史的团队。

### 步骤

```bash
# 初始化 shared 仓库
mkdir ~/sofagent-shared && cd ~/sofagent-shared
git init
mkdir knowledge

# 作为 submodule 加入你的主项目
cd ~/my-project
git submodule add ~/sofagent-shared .sofagent/knowledge
```

设备 B clone 时加 `--recurse-submodules`。

**冲突处理**：`git merge`（人工 resolve）。`relations` 字段冲突由 ontology 合并引擎自动处理。

## 同步内容清单

| 同步什么 | 为什么 | 不同步什么 | 为什么不同步 |
|------|------|------|------|
| ✅ `knowledge/` | Agent 经验（entities/concepts/comparisons） | ❌ `task/`、`logs/` | 每个设备做的事不同，无需共享 |
| ✅ `think.md` | 踩坑反思 | ❌ `permission.local.json` | 每个项目的权限可能不同 |
| ❌ `fde.md` | 业务约束是项目级的，不同步可以不同 | | |

## 验证同步是否生效

1. 设备 A 上 Agent 完成一个任务，写了一条 think.md：
```bash
cat ~/.sofagent/think.md | tail -5
```

2. 设备 B 上等 30 秒（云盘同步延迟），检查：
```bash
cat ~/.sofagent/think.md | tail -5
# 应该能看到设备 A 刚写的那条

ls ~/.sofagent/knowledge/shared/ | head -20
# 应该能看到 lessons-missteps 周报等共享文件
```

3. 设备 B 跑一次 daemon 的 lessons-extract：
```bash
sofagent-daemon lessons-extract
# 输出的 lessons 应包含「设备 A 本周踩过的坑」
```

## 常见问题

**Q：两台设备同时写 think.md，谁赢？**
A：取决于云盘厂商的冲突策略。iCloud → 生成副本；Dropbox → 冲突副本；git → 需要手动 merge。sofagent 不会自动合并 think.md 同名文件，建议各设备 Agent 使用不同 task 名称（sofagent 已内建 task 级去重）。

**Q：离线时怎么办？**
A：离线时 sofagent 正常读写本地文件。重新联网后云盘会自动同步。NAS 方案离线时会断连（目录变空），daemon 检测到空目录自动跳过。

**Q：安全吗？**
A：取决于你选的云盘。企业环境推荐 NAS/SMB（数据不出局域网）。个人推荐 iCloud（端到端加密）。**不要把 knowledge/ 放到公开共享链接**——里面有你的业务知识和 Agent 行为记录。

**Q：这和 v1.3.x 的「完整多设备协同」有什么区别？**
A：v1.1.x 轻量版 = 文件级别的异步同步（你负责传输，sofagent 负责合并）。v1.3.x 完整版 = 内建传输 + Agent 独立身份码（v1.2.5 已交付轻量版 KYA）+ 跨设备审计聚合（v1.2.5 已交付轻量版）+ 实时同步 + 团队协作协议 + 能力市场。轻量版够用就别急着升，完整版解决了实时协作和身份互信的问题（L2 协作协议 v1.3.3、L3 能力市场 v1.3.4、权限体系 v1.3.7 + 网关 v1.3.8）。

---

> 📖 相关文档：[ROADMAP](../ROADMAP.md)（多设备完整协同拆分至 v1.3.1-v1.3.9）· [v1.1.0 开发日志](../changelog/v1.1/v1.1.0.md)

---

## 远程 API 通道（v1.4.0 排入 · C/S 控制面）

> **语义区分**：联邦查询 = 服务器间 P2P 查询（对等互查）；远程 API = **客户端 → 服务器控制面**（触发 workflow / 查询状态）。两者共享跨机器通信基础设施（TLS + 鉴权 + 帧协议），语义不同。

**解决的问题**：无头服务器 / 远程调用部署形态——企业把 sofagent 跑在无头服务器上，运维 / 上层系统需要远程触发 workflow 并查询执行状态，但没有交互终端。

**通道契约（v1.4.0 定义，实现随 daemon HTTP 面接入）**：

| 端点 | 语义 | 鉴权 |
|------|------|------|
| `POST /remote/workflow/trigger` | 触发一个 workflow（YAML 定义或 workflowId） | 共享 token（Bearer） |
| `GET /remote/workflow/{id}/status` | 查询 workflow 执行状态（running/done/failed/hitl-waiting） | 同上 |

**安全边界**：
- 只绑定本机/内网接口（默认 127.0.0.1，跨机需显式配置 + TLS）
- 共享 token 走带外交换（对齐联邦通道 federation.token 的语义，不落环境变量）
- 触发与查询全程进审计（decision-log 记 `kind=REMOTE_API` 决策留痕）
- 与联邦通道共用同一跨机器帧协议基座（IV‖tag‖ciphertext 密文帧）

**双设备联调记录（v1.4.0 验收）**：E2E 脚本已固化入仓（`FORGE/playbook/federation-e2e.mjs`，10 断言全 PASS）；远程 API 通道的跨机实测依赖真实双设备环境，单机环境标注「依赖真实双设备，单机跳过」（技术选型 OpenClaw / DSH 通道留白，不锁死）。
