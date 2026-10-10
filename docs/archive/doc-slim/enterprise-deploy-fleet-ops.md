# enterprise-deploy 车队运维参考明细归档

> 内容原属 `docs/guides/enterprise-deploy.md` 的「批量部署」章若干子节，按「参考明细下沉归档」纪律迁出，**原文逐字保真**（仅重算链接相对深度）；原地留摘要 + 指针。搬出原因：E 运维指南层行数预算顶格（`tools/check/check-docs.sh` LIMIT_E 4000/4000，06 清单⑧「余量 <100 行须先列砍什么」）——本节属一次性车队运维参考（非日常高频阅读），下沉后释放 E 层行数。

## ④ 静态加密批量激活（20 台级无头部署）

静态加密（AES-256-GCM，密钥落 `~/.sofagent/keys/` 0600）默认交互确认——批量部署时逐台交互不可行，用 env 通道显式确认：

**第 1 步 · 生成一次密钥并分发**（密钥同源，跨机可恢复）：

```bash
# 管理机首次启动 daemon：交互引导生成密钥 + 指纹确认 + 备份确认（指纹打印在启动输出）
sofagent daemon start
# 无头批量部署跳过交互（非交互场景）：
#   SOFAGENT_CONFIRM_BACKUP=1 sofagent daemon start

# 预共享分发到 20 台目标机（scp + 0600 权限）
for host in $(cat hosts.txt); do
  ssh "$host" 'mkdir -p ~/.sofagent/keys && chmod 700 ~/.sofagent/keys'
  scp ~/.sofagent/keys/data.key "$host":~/.sofagent/keys/data.key
  ssh "$host" 'chmod 600 ~/.sofagent/keys/data.key'
done
```

**第 2 步 · 无头激活**（env 显式确认，替代交互 readline）：

```bash
# 前置 · 指纹备份（管理机侧，仅一次）：从第 1 步启动输出提取密钥指纹并归档
mkdir -p ~/sofagent-key-backup
printf '%s\n' "指纹（SHA-256 前 16 位）：<第 1 步启动输出中的指纹>" > ~/sofagent-key-backup/data.key.fingerprint.txt   # 归档物离线保管，勿与 data.key 同盘

# 每台目标机：env 通道确认备份后启动 daemon 即激活
SOFAGENT_CONFIRM_BACKUP=1 sofagent daemon start
# 验证：密文前缀在位即激活成功
tail -1 ~/.sofagent/data/audit/history.jsonl | grep -c "SOFAGENT-AGE-V1"   # 期望 1
```

**第 3 步 · 批量样例脚本**（三步合一）：

```bash
#!/usr/bin/env bash
# fleet-crypto-activate.sh · 20 台批量激活静态加密
set -euo pipefail
while IFS= read -r host; do
  ssh "$host" 'mkdir -p ~/.sofagent/keys && chmod 700 ~/.sofagent/keys'
  scp -q ~/.sofagent/keys/data.key "$host":~/.sofagent/keys/data.key
  ssh "$host" 'chmod 600 ~/.sofagent/keys/data.key && SOFAGENT_CONFIRM_BACKUP=1 sofagent daemon start' \
    && echo "✅ $host 激活" || echo "❌ $host 失败（查 daemon 日志）"
done < hosts.txt
```

> ⚠️ 安全边界：data.key 是全 fleet 同源密钥——单机失窃即全 fleet 密文暴露，强隔离场景应逐机生成（去掉分发步，每台各自 `sofagent daemon start` + 本机确认）；备份指纹记录务必离线保管，密钥丢失 = 加密数据永久不可读（见 [SECURITY](../../../SECURITY.md) 静态加密节）。
>
> ⚠️ **`SOFAGENT_CONFIRM_BACKUP=1` 是合规确认而非仪式**——未实际完成指纹备份即设置该 env，等于让审计记录系统性说谎：脚本与每台机器都宣称「已备份」，审计事件对账「是否备份」时全部显示已确认，而记录与事实不符。请在设置该 env 前，先完成上文的指纹备份步骤并确认归档物离线在位。

## 其他方案

- **Git submodule**：`git submodule add git@github.com:your-org/sofagent-shared-config.git ~/.sofagent/shared`
- **dotfiles**：将 `~/.sofagent/config.yml` 加入 stow/chezmoi，通过 symlink 统一管理

## 当前局限

- 没有 org-level 自动推送机制，每个 repo 需独立 `--init`。集中管控当前无排期；缓解：系统级 git hook 模板批量下发（见 enterprise-deploy.md「AD/LDAP 集成」节）

## 多机状态汇聚（v1.2.8）

企业多机部署后，集中收集各机器状态：

```bash
# 方案 A：定期 doctor --json 汇总到中心
# 每台机器的 crontab：
0 9 * * 1 SOFAGENT_HOME=/data/sofagent sofagent audit --doctor --json >> /shared/sofagent-reports/$(hostname)-$(date +%F).json

# 方案 B：dashboard 定期采集
# 将各机器的 ~/.sofagent/data/ 通过 NFS/共享存储挂载到 dashboard 所在机器
#
# ⚠️ 安全警告：NFS/共享存储挂载明文审计目录与"数据不出本机"的数据主权立场存在矛盾。
#    密钥就绪时 history.jsonl 为 SOFAGENT-AGE-V1 密文（daemon start 已接线引导），
#    但密钥未激活/非交互跳过时仍为明文 JSONL，且附链目录（task/logs/think.md 等）
#    恒为明文（见上方合规清单「数据加密」行）。明文态下 NFS 挂载使同 NFS 卷的其他
#    主机可能读取。如需此方案，务必：
#    ① NFS export 限制为 dashboard 机器 IP（ro 只读挂载）
#    ② NFS export 使用 sec=sys + root_squash，防止非授权 UID 读取
#    ③ 或将 data/ 放在加密卷（gpg / LUKS）上再挂载
#    ④ 更安全的替代方案：方案 A（doctor --json SSH 拉取），不暴露 NFS 挂载面
```

## 版本一致性校验（v1.2.8）

发版后校验所有机器的引擎版本一致：

```bash
# 各机器检查 ~/.sofagent/VERSION 与最新发布版本
LATEST=$(npm view @sofagent/audit version 2>/dev/null)
INSTALLED=$(cat ~/.sofagent/VERSION 2>/dev/null || echo 'unknown')
if [ "$LATEST" != "$INSTALLED" ]; then
  echo "⚠️ 版本不一致：已装 $INSTALLED，最新 $LATEST"
  # 触发升级
  bash install.sh --upgrade
fi
```

> `--doctor` 也会报告"运行引擎版本 vs 已发布版本"不一致。

## Windows 支持边界（v1.2.8）

sofagent 对 Windows 的支持是**实验性**的：

| 能力 | macOS/Linux | Windows |
|------|:-----------:|:-------:|
| git hook（commit-msg / post-commit） | ✅ 完全支持 | ⚠️ 需 Git Bash（原生 cmd.exe 不支持 bash hook 脚本） |
| 审计模块（sofagent audit） | ✅ 完全支持 | ✅ 支持（Node.js 跨平台） |
| MCP Server | ✅ | ✅ |
| daemon 常驻进程 | ✅ | ❌ 不支持（v1.2.9 PM2 守护面向 macOS/Linux，Windows 待排期） |
| orchestrator 编排 | ✅ | ⚠️ 部分功能依赖 Unix signal |
| install.sh 安装脚本 | ✅ | ❌ 需 WSL 或 Git Bash 运行 |
| `engine/scripts/windows/*.ps1` PowerShell 脚本 | N/A | ⚠️ 覆盖核心功能（v1.2.8 时点评估约 25%；现脚本 10+ 个，以目录实态为准），非完整替代 |

> Windows 用户建议使用 WSL2 或 Git Bash 环境。原生 PowerShell 支持待排期。
