# daemon MVP · 架构设计

> sofagent v0.8 核心工程。
> sofagent 的第一个 session 外触发器——让治理从「Agent 自觉」升级为「外部进程强制」。
> 循环工程 = 触发器 + 文件结构 + 工具 + 代码库治理。sofagent 只有后三样的雏形，
> 触发器完全空白。daemon 填这个坑。
>
> v0.8-draft · 更新于 2026-06-20

---

## 〇、daemon 定位升级

> 从「加载链补丁」到「session 外触发器」。

### 旧定位

加载链补丁：监控 think.md 和 rules.md 变更 → Agent 启动时生成提醒文件 → Agent 看到提醒后自觉 Read。

本质是「多贴一张便签」——Agent 不读提醒和不读 think.md 是同一种行为。

### 新定位

session 外触发器：循环工程师笔记指出循环工程的核心公式是 **循环 = 触发器 + 文件结构 + 工具 + 代码库治理**。sofagent 有文件结构（加载链）、有工具（编排脚本）、有代码库治理（think.md + scoring），但**触发器层是空白的**。

daemon 填的就是触发器这个坑，提供三层触发能力：

| 触发类型 | 实现 | 用途 |
|------|------|------|
| **定时触发** | macOS launchd / Linux systemd 注册 | 定时健康检查、定期压缩记忆、定期清理过期数据 |
| **事件触发** | 文件监控（think.md / rules.md 变更）| 跨 session 经验不丢失——Agent 启动前 daemon 已经把最新的教训准备好 |
| **状态触发** | Agent 进程检测（pgrep）| Agent 启动 → 注入循环契约摘要；Agent 关闭 → 记录使用时长 |

### 为什么升级

引用 [ARCHITECTURE.md §五](../ARCHITECTURE.md)——循环工程的核心公式里，触发器负责「启动循环、注入契约、环境准备」三件事。旧定位的 daemon 只做了最弱的一件（注入提醒），另外两件完全空白。

升级后的 daemon 不只是「提醒 Agent 读文件」，而是让 sofagent **第一次有了 session 外的自主触发能力**。这是在 v0.8 把加载链薄弱性从架构债变为已解决的前提。

> daemon 不是又一个约束——它是让已有约束跨 session 生效的执行器。
> 循环工程的核心公式里，daemon = 触发器。

---

## 一、设计目标

### 要解决的问题

softagent 的最大瓶颈：**加载链靠 Agent 自觉。** 跨 session 的经验（think.md）和规则（rules.md）能不能被读到，完全看 Agent 在下一个 session 是否愿意读。v0.61 验证失败已经证实：「文字写"必读"」挡不住 Agent 跳步。

### 解决思路

引入一个轻量级本地后台进程（daemon）——不做 Agent 该做的事，只在 Agent 启动时确保它看到该看的东西。

### 范围边界（MVP）

| 做 | 不做 |
|---|------|
| 文件监控：watch think.md + rules.md 变更 | daemon 不参与 Agent 对话 |
| Agent 启动检测：感知平台进程启动 | daemon 不替 Agent 做决策 |
| 循环契约注入：新 session 启动前注入循环契约摘要（替代简单的 reminder.md）| daemon 不修改 Agent 配置 |
| 状态持久化：daemon.json 记录监控状态 | daemon 不引入数据库 |
| 定时触发能力（基础）：launchd/systemd 注册（v0.1 只注册不触发任务）| 本版本不做定时任务调度（v0.2） |
| 与 install.sh / verify.sh / uninstall.sh 集成 | 本版本不做复盘提醒、健康检查、自动清理接管 |
| macOS launchd + Linux systemd 注册 | 本版本不做 Windows 支持 |

---

## 二、目录结构与文件清单

```
sofagent/
└── scripts/
    ├── daemon.sh              ← 主 daemon 进程（bash，核心逻辑）
    ├── daemon-install.sh      ← 安装：部署文件 + 注册 launchd/systemd
    ├── daemon-uninstall.sh    ← 卸载：移除注册 + 清理文件
    ├── daemon-status.sh       ← 状态查询：daemon.sh --status 的独立入口
    └── lib/
        ├── config.sh          ← 已有，新增 daemon 配置项解析
        └── daemon-lib.sh      ← 新增，daemon 共享函数库（监控/检测/注入）

~/.sofagent/                   ← 用户数据目录（运行时）
└── daemon/
    ├── daemon.json            ← daemon 状态持久化（JSON）
    ├── reminder.md            ← Agent 启动提醒文件（动态生成）
    ├── last-check.md          ← 上次健康检查记录
    └── pid                    ← daemon PID 文件（防止多实例）
```

---

## 三、核心函数设计（伪代码）

> 以下用 bash 风格的伪代码描述核心逻辑。定型后可直接展开为正式脚本。

### 3.1 主入口：daemon.sh

```
# ── 命令行接口 ──
#   daemon.sh start      启动 daemon（后台）
#   daemon.sh stop       停止 daemon
#   daemon.sh restart    重启 daemon
#   daemon.sh status     显示状态（封装 daemon-status.sh）
#   daemon.sh --version  版本号
#   daemon.sh install    注册系统服务（封装 daemon-install.sh）
#   daemon.sh --help     帮助

# ── 主流程 ──
main() {
    case $1 in
        start)   daemon_start ;;
        stop)    daemon_stop ;;
        restart) daemon_stop; daemon_start ;;
        status)  daemon_status ;;
        install) daemon_install ;;    # 委派给 daemon-install.sh
        uninstall) daemon_uninstall ;; # 委派给 daemon-uninstall.sh
        --version) echo "sofagent-daemon v0.8" ;;
        *) daemon_usage ;;
    esac
}

# ── 启动 daemon ──
daemon_start() {
    # 1. 检查是否已经在运行（PID 文件）
    # 2. 检查 .sofagent/ 目录状态
    # 3. 初始化 daemon.json（如不存在）
    # 4. 写入 PID 文件
    # 5. 进入主循环 → daemon_loop
    # 6. 清理退出
}

# ── 停止 daemon ──
daemon_stop() {
    # 1. 读取 PID 文件
    # 2. kill 进程
    # 3. 清理 PID 文件
    # 4. 状态标记为 stopped
}

# ── 显示状态 ──
daemon_status() {
    # 输出：
    #   - 运行状态（running / stopped）
    #   - PID / 运行时长
    #   - 监控路径
    #   - 最近提醒时间
    #   - 最近检测到的 Agent 平台
    #   - daemon.json 配置摘要
}
```

### 3.2 主循环：daemon_loop

```
# ── 核心循环 ──
daemon_loop() {
    # 配置
    POLL_INTERVAL=5          # 文件监控轮询间隔（秒）
    AGENT_CHECK_INTERVAL=30  # Agent 进程检查间隔（秒）
    HEARTBEAT_FILE="${SOFAGENT_DATA}/daemon/daemon.json"
    REMINDER_FILE="${SOFAGENT_DATA}/daemon/reminder.md"

    # 初始化状态
    local agent_was_alive=false  # 上次 Agent 是否在运行
    local last_think_hash=""     # 上次 think.md 的 shasum
    local last_rules_hash=""     # 上次 rules.md 的 shasum
    local loop_count=0

    while true; do
        ((loop_count++))

        # ── 文件监控（每 POLL_INTERVAL 秒）──
        if (( loop_count % (AGENT_CHECK_INTERVAL / POLL_INTERVAL) == 0 )); then
            check_think_md "think.md"
            check_think_md "rules.md"
        fi

        # ── Agent 进程检测（每 AGENT_CHECK_INTERVAL 秒）──
        local agent_alive=false
        agent_alive=$(detect_agent_process)

        if [ "$agent_alive" = true ] && [ "$agent_was_alive" = false ]; then
            # Agent 刚启动 → 注入提醒
            inject_reminder "Agent 刚刚启动"
            agent_was_alive=true
        elif [ "$agent_alive" = false ] && [ "$agent_was_alive" = true ]; then
            # Agent 刚关闭
            agent_was_alive=false
            on_agent_stop
        fi

        # ── 更新 heartbeat（每轮）──
        update_heartbeat

        sleep $POLL_INTERVAL
    done
}
```

### 3.3 文件监控：check_think_md

```
# ── 检查单个文件变更 → 更新 remind 标记 ──
# 参数: filename（think.md / rules.md）
# 效果: 检测到变更 → 在 daemon.json 标记 has_new_reflection=true
check_think_md() {
    local filename="$1"
    local filepath="${SOFAGENT_DATA}/${filename}"
    local state_key="last_${filename%.md}_hash"
    local sig_key="${filename%.md}_signature"

    # 文件不存在 → 跳过
    [ ! -f "$filepath" ] && return

    # 计算当前 signature（mtime + 前 80 字节）
    local current_sig
    current_sig=$(stat -f "%m" "$filepath" 2>/dev/null)$(head -c 80 "$filepath" | shasum -a 256 2>/dev/null | cut -c1-16)

    # 从 daemon.json 读取上次 signature
    local last_sig
    last_sig=$(jq -r ".${sig_key} // \"\"" "${DAEMON_JSON}" 2>/dev/null)

    if [ "$current_sig" != "$last_sig" ] && [ -n "$last_sig" ]; then
        # 文件有变化 → 标记新提醒可用
        # think.md 变更 → has_new_reflection=true
        # rules.md 变更 → rules_updated=true
        json_update ".${sig_key}" "\"$current_sig\""
        json_update ".has_new_reflection" true
        json_update ".last_${filename%.md}_change" "\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\""
    elif [ -z "$last_sig" ]; then
        # 首次检测 → 记录 signature，不触发提醒（避免首次安装就弹提示）
        json_update ".${sig_key}" "\"$current_sig\""
    fi
}
```

### 3.4 Agent 进程检测：detect_agent_process

```
# ── 检测本地是否有 Agent 平台在运行 ──
# 返回值: true / false
# 检测逻辑：
#   1. 按平台优先级搜索进程列表
#   2. 首次检测到某平台 → 记录到 daemon.json
detect_agent_process() {
    local found=false
    local platform=""

    # OpenClaw — 主进程
    if pgrep -q "openclaw" 2>/dev/null; then
        platform="openclaw"; found=true
    # WorkBuddy（进程名可能为 WorkBuddy 或 workbuddy）
    elif pgrep -q -i "workbuddy" 2>/dev/null; then
        platform="workbuddy"; found=true
    # Claude Code（进程名 claude 或 claude-code）
    elif pgrep -q "claude-code\|claude" 2>/dev/null; then
        platform="claude"; found=true
    # Codex
    elif pgrep -q "codex" 2>/dev/null; then
        platform="codex"; found=true
    # Hermes
    elif pgrep -q "hermes" 2>/dev/null; then
        platform="hermes"; found=true
    fi

    if [ "$found" = true ]; then
        # 记录最近检测到的平台（优化：同一平台不重复写磁盘）
        local last_platform
        last_platform=$(jq -r ".last_platform // \"\"" "${DAEMON_JSON}" 2>/dev/null)
        if [ "$platform" != "$last_platform" ]; then
            json_update ".last_platform" "\"$platform\""
            json_update ".last_agent_start" "\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\""
        fi
    fi

    echo "$found"
}
```

### 3.5 提醒注入：inject_reminder

```
# ── 向 Agent 注入启动提醒 ──
# 效果: 生成 reminder.md，下次 Agent 加载 sofagent 时自然读到
# 不修改 Agent 配置，不插入对话上下文——只在文件系统留一份"便签"
inject_reminder() {
    local trigger="$1"

    # 读取状态
    local has_new_reflection
    has_new_reflection=$(jq -r ".has_new_reflection // false" "${DAEMON_JSON}" 2>/dev/null)
    local last_think_change
    last_think_change=$(jq -r ".last_think_change // \"未知\"" "${DAEMON_JSON}" 2>/dev/null)
    local last_platform
    last_platform=$(jq -r ".last_platform // \"未知\"" "${DAEMON_JSON}" 2>/dev/null)
    local rules_updated
    rules_updated=$(jq -r ".rules_updated // false" "${DAEMON_JSON}" 2>/dev/null)

    # ── 构建循环契约摘要 ──
    local contract="# sofagent 循环契约 · 本次 session 上下文

## 目标（你是谁、在干什么）
[来自 SKILL.md 摘要]

## 上次进度（循环时间线）
[来自 task/logs 最近 N 条]

## 待办教训（需要避开的坑）
[来自 think.md 高置信度条目]

## 规则更新（本次需注意的约束变化）
[来自 rules.md 最近变更]
"

    if [ "$has_new_reflection" = "true" ]; then
        contract+="📝 **think.md 有新的反思**（上次变更: ${last_think_change}）\n\n"
    fi

    if [ "$rules_updated" = "true" ]; then
        contract+="⚙️ **rules.md 已更新**\n\n"
    fi

    contract+="📊 **跨 session 统计**\n"
    contract+="- 上次使用平台: ${last_platform}\n"
    contract+="- 上次有任务记录: $(jq -r '.last_task_date // "无"' \"${DAEMON_JSON}\" 2>/dev/null)\n"
    contract+="- daemon 运行时长: $(get_uptime)\n"

    # ── 写入循环契约文件 ──
    echo -e "$contract" > "${SOFAGENT_DATA}/daemon/reminder.md"

    # ── 在 SKILL.md 加载链中联动 ──
    # 约定：reminder.md 放入加载链第 2.5 层，在 think.md 之后、rules.md 之前
    # 由 Agent 在入口流程中 Read（sofagent SKILL.md 的 A0 阶段）
    # 此文件每次 Agent 启动由 daemon 重新生成，Agent 读完即弃

    # ── 重置新提醒标记 ──
    if [ "$has_new_reflection" = "true" ]; then
        json_update ".has_new_reflection" false
        json_update ".last_reminder_injected" "\"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\""
    fi
}
```

### 3.6 状态持久化：json_update / read_json

```
# ── 更新 daemon.json 指定字段 ──
# 参数: key path (如 ".last_platform"), value (JSON 编码值)
# 使用 jq（优先）或 sed（降级）
json_update() {
    local key="$1" value="$2"
    local tmpfile="${DAEMON_JSON}.tmp"

    if command -v jq &>/dev/null; then
        jq "${key} = ${value}" "$DAEMON_JSON" > "$tmpfile" 2>/dev/null && \
            mv "$tmpfile" "$DAEMON_JSON" && return
    fi

    # 降级: sed 替换（仅适用于简单扁平字段）
    local escaped_key="${key#.}"
    if grep -q "\"${escaped_key}\":" "$DAEMON_JSON" 2>/dev/null; then
        sed -i '' "s/\"${escaped_key}\": [^,]*/\"${escaped_key}\": ${value}/" "$DAEMON_JSON" 2>/dev/null
    else
        # 尾部追加
        sed -i '' "s/}$/, \"${escaped_key}\": ${value}}/" "$DAEMON_JSON" 2>/dev/null
    fi
}

# ── 初始化 daemon.json（默认配置）──
init_daemon_json() {
    if [ ! -f "$DAEMON_JSON" ]; then
        cat > "$DAEMON_JSON" << JSONEOF
{
  "version": "0.8",
  "status": "initialized",
  "pid": null,
  "started_at": null,
  "last_platform": null,
  "last_agent_start": null,
  "last_agent_stop": null,
  "last_reminder_injected": null,
  "has_new_reflection": false,
  "rules_updated": false,
  "think_signature": "",
  "rules_signature": "",
  "last_think_change": null,
  "last_rules_change": null,
  "last_task_date": null,
  "total_agent_starts": 0,
  "total_reminders": 0,
  "uptime_seconds": 0
}
JSONEOF
    fi
}
```

### 3.7 共享函数：daemon-lib.sh

```
# ============================================================
# sofagent daemon-lib.sh · 共享函数库
# ============================================================
# 被 daemon.sh / daemon-install.sh / daemon-uninstall.sh 共享
# ============================================================

# ── 路径 ──
SOFAGENT_DATA="${PWD}/.sofagent"
DAEMON_DIR="${SOFAGENT_DATA}/daemon"
DAEMON_JSON="${DAEMON_DIR}/daemon.json"
PID_FILE="${DAEMON_DIR}/pid"
REMINDER_FILE="${DAEMON_DIR}/reminder.md"
LOCK_FILE="${DAEMON_DIR}/.lock"

# ── 系统服务路径 ──
# macOS: ~/Library/LaunchAgents/com.sofagent.daemon.plist
# Linux: ~/.config/systemd/user/sofagent-daemon.service
detect_platform() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux)  echo "linux" ;;
        *)      echo "unknown" ;;
    esac
}

# ── 获取系统服务路径 ──
get_service_plist_path() {
    echo "${HOME}/Library/LaunchAgents/com.sofagent.daemon.plist"
}
get_service_unit_path() {
    echo "${HOME}/.config/systemd/user/sofagent-daemon.service"
}

# ── 获取 uptime ──
get_daemon_uptime() {
    local start_time
    start_time=$(jq -r '.started_at // ""' "$DAEMON_JSON" 2>/dev/null)
    [ -z "$start_time" ] && { echo "0s"; return; }
    local now_epoch
    local start_epoch
    now_epoch=$(date +%s)
    start_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$start_time" +%s 2>/dev/null || \
                  date -d "$start_time" +%s 2>/dev/null || echo "$now_epoch")
    local elapsed=$((now_epoch - start_epoch))
    echo "${elapsed}s"
}
```

---

## 四、launchd / systemd 配置

### 4.1 macOS — launchd（com.sofagent.daemon.plist）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sofagent.daemon</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/USERNAME/.sofagent/daemon/daemon.sh</string>
        <string>start</string>
    </array>

    <key>RunAtLoad</key>
    <true/>                          <!-- 用户登录时自动启动 -->

    <key>KeepAlive</key>
    <true/>                          <!-- crash 后自动重启 -->

    <key>ThrottleInterval</key>
    <integer>5</integer>             <!-- crash 后至少等 5 秒再重启 -->

    <key>StandardOutPath</key>
    <string>/tmp/sofagent-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/sofagent-daemon.err</string>

    <key>WorkingDirectory</key>
    <string>/Users/USERNAME</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:...AGENT_PATH...</string>
    </dict>
</dict>
</plist>
```

> 安装时替换 `USERNAME` 和 `PATH`。

### 4.2 Linux — systemd user service

```ini
[Unit]
Description=sofagent daemon — cross-session governance memory
Documentation=https://github.com/KongFangXun/sofagent
After=network.target

[Service]
Type=simple
ExecStart=/bin/bash /home/USERNAME/.sofagent/daemon/daemon.sh start
ExecStop=/bin/bash /home/USERNAME/.sofagent/daemon/daemon.sh stop
Restart=on-failure
RestartSec=5
# 用户级 service，非 root

[Install]
WantedBy=default.target
```

> 部署命令：
> ```bash
> mkdir -p ~/.config/systemd/user/
> sed "s/USERNAME/$(whoami)/g" sofagent-daemon.service > ~/.config/systemd/user/sofagent-daemon.service
> systemctl --user daemon-reload
> systemctl --user enable --now sofagent-daemon.service
> ```

---

## 五、与现有脚本的集成方案

### 5.1 install.sh 变更

在 Step 6（"部署加载链 Hook"）之后新增 Step 6b：

```
# Step 6b: 可选安装 daemon
info "Step 6b/7 · 安装 daemon（可选）..."
if [ "${INSTALL_DAEMON:-}" = "true" ] || [ "$PLATFORM" = "openclaw" ]; then
    bash "${SCRIPT_DIR}/daemon-install.sh" --platform "$PLATFORM"
fi
```

> 新增参数 `--with-daemon` 显式触发。OpenClaw 默认安装（daemon 是加载锁链的补完）。

**install.sh 参数新增：**

| 参数 | 说明 |
|------|------|
| `--with-daemon` | 同时安装 daemon（OpenClaw 默认开启） |
| `--no-daemon` | 跳过 daemon 安装 |

### 5.2 verify.sh 变更

在现有检查项中新增 "daemon 检查" Section（位置：紧接"断路器配置"之后，改编号为 10，原 10→11）：

```
# ── daemon 状态检查（v0.8）──
_hr
_section "daemon 状态"

# 1. daemon.json 存在性
if [ -f "${PWD}/.sofagent/daemon/daemon.json" ]; then
    check_pass "daemon.json 存在"
    # 检查必要字段
    for field in version status last_platform; do
        jq -e ".${field}" "$DAEMON_JSON" >/dev/null 2>&1 && \
            check_pass "  daemon.json.${field}: $(jq -r ".${field}" "$DAEMON_JSON")"
    done
else
    check_warn "daemon.json 不存在（daemon 未安装）"
fi

# 2. 系统服务注册
case "$(uname -s)" in
    Darwin)
        if launchctl list | grep -q "com.sofagent.daemon"; then
            check_pass "launchd 服务已注册"
        else
            check_warn "launchd 未注册"
        fi
        ;;
    Linux)
        if systemctl --user status sofagent-daemon.service &>/dev/null; then
            check_pass "systemd 服务已注册并运行"
        else
            check_warn "systemd 未注册"
        fi
        ;;
esac

# 3. reminder.md 存在性
if [ -f "${PWD}/.sofagent/daemon/reminder.md" ]; then
    check_pass "reminder.md 存在（上次 Agent 启动提醒）"
else
    check_warn "reminder.md 不存在（尚未触发过提醒）"
fi
```

### 5.3 uninstall.sh 变更

在现有清理步骤中新增 daemon 清理：

```
# ── 清理 daemon（v0.8）──
if [ -d "${SOFAGENT_DATA}/daemon" ]; then
    # 先停止 daemon
    if [ -f "${SOFAGENT_DATA}/daemon/pid" ]; then
        kill "$(cat "${SOFAGENT_DATA}/daemon/pid")" 2>/dev/null || true
    fi
    # 移除系统服务注册
    case "$(uname -s)" in
        Darwin)
            launchctl unload ~/Library/LaunchAgents/com.sofagent.daemon.plist 2>/dev/null || true
            rm -f ~/Library/LaunchAgents/com.sofagent.daemon.plist
            ;;
        Linux)
            systemctl --user stop sofagent-daemon.service 2>/dev/null || true
            systemctl --user disable sofagent-daemon.service 2>/dev/null || true
            rm -f ~/.config/systemd/user/sofagent-daemon.service
            ;;
    esac
    # 保留 daemon/ 目录（含 daemon.json 状态），不删除
    # 用户数据保留策略同 .sofagent/ 整体策略
    info "daemon 数据保留在: ${SOFAGENT_DATA}/daemon/"
fi
```

> **注意**：uninstall.sh 不删除 `.sofagent/daemon/` 目录和 daemon.json，遵循项目"卸载保留用户数据"的设计原则。

### 5.4 加载链集成：SKILL.md 中新增 reminder.md 为第 2.5 层

在现有三层加载链的"第 2 层"和"第 3 层"之间插入：

```
| 2.5 | **reminder.md**（daemon 生成） | Agent 主动 Read | 跨 session 记忆提醒（最新教训摘要） | 非必读（提醒不是约束） |
```

> 这一层是**软提醒不是硬约束**——daemon 已经尽到了"让 Agent 知道该看什么"的责任，Agent 是否执行是 Agent 的选择。
>
> daemon 的哲学：**我们只管把书放在桌上，不负责翻到哪一页。**

---

## 六、进程生命周期图

```
┌──────────────────────────────────────────────────────┐
│                    用户登录 / 系统启动                  │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│            launchd / systemd 拉起 daemon               │
│              RunAtLoad / WantedBy=default.target       │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│              daemon 初始化                            │
│  1. 检查 .sofagent/daemon/ 目录                       │
│  2. 初始化/读取 daemon.json                          │
│  3. 写入 PID 文件                                     │
│  4. 写入 LOCK 文件（防多实例）                        │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│              主循环（每 5 秒轮询）                      │
│                                                       │
│  ┌─────────────┐    ┌─────────────┐                  │
│  │ 每轮：文件   │    │ 每30秒：    │                  │
│  │ think.md/   │◄───┤ Agent 进程  │                  │
│  │ rules.md    │    │ 检测        │                  │
│  │ hash 比对   │    │             │                  │
│  └──────┬──────┘    └──────┬──────┘                  │
│         │                  │                          │
│  变更检测到           Agent 刚启动                     │
│  → 标记 new             → 注入 reminder               │
│     reflection          → 标记 last_agent_start       │
│         │                  │                          │
│         └──────────────────┘                          │
│                        │                              │
│                   daemon.json                         │
│                   更新状态                             │
└────────────────────┬─────────────────────────────────┘
                     │
             launchd/systemd
           KeepAlive / Restart=on-failure
             自动重启（5s 延迟）                           │
```

---

## 七、降级路径与故障模型

| 场景 | 行为 | 影响 |
|------|------|------|
| jq 不可用 | 降级用 sed 写 daemon.json | 复杂 JSON 操作不可用，基础字段更新正常 |
| launchd 不可用 | daemon 后台进程模式（nohup + &）| 系统重启后不自动拉起，需手动重启 |
| .sofagent/ 不存在 | daemon 不报错退出，静默等待 | 安装未完成，等待 install.sh 完成 |
| 权限不足 | 跳过 PID 文件和 LOCK 文件写入 | 多实例防护不可用 |
| daemon 崩溃 | launchd KeepAlive / systemd Restart=on-failure | 5 秒后自动拉起，最多丢 1 个轮询周期 |
| 没有 launchd/systemd | daemon --unsupervised 模式（后台 &）| 部署文档中标注"非受管模式" |
| Agent 进程名变更 | 未识别的进程名 → 无法检测启动 | 用户可配置 AGENT_PROCESS_NAMES 环境变量 |

---

## 八、版本与兼容性

| daemon 版本 | sofagent 版本 | 说明 |
|:----------:|:-------------:|------|
| v0.8.0     | v0.80+        | MVP：文件监控 + Agent 启动提醒 + 清理接管 |
| v0.8.1     | v0.82+        | 复盘提醒 + 健康检查 |
| v0.8.2     | v0.82+        | 全平台 + 状态面板 |

---

## 九、与 v0.72 / v0.73 的关系

daemon v0.8 不是独立版本——它是 v0.72 和 v0.73 改动的自然延续。它们之间的关系：

| v0.72 改动 | 对 daemon 的影响 | 说明 |
|------|------|------|
| handler.ts 回归验证 | daemon MVP 前置条件 | hook 确实修对了才谈 daemon——如果第 3 层加载链还是 silently 失效，daemon 提醒也没用 |
| benchmark.sh | daemon 上线后可对比 | 有 daemon vs 无 daemon 的加载链命中率 A/B 对比——这对所有「Agent 自觉 vs 外力强制」的争论是最好的实验数据 |

| v0.73 改动 | 对 daemon 的影响 | 说明 |
|------|------|------|
| 记忆三规则（写入/更新/遗忘）| daemon 监控的 think.md 质量更高 | 该记的记、该忘的忘——daemon 注入的循环契约摘要来自经过规则过滤的 think.md，噪音大幅降低 |
| 任务闸执行层 | daemon 的文件监控有了明确触发目标 | task-aware 准入检查 PASS/REJECT → daemon 可记录「上次任务是否通过了准入检查」，作为 session 启动时的上下文 |
| compress-memory.sh | daemon 可定时触发压缩 | 当前 compress-memory.sh 需要 Agent 自觉执行或手动触发——daemon 通过 launchd/systemd 定时触发，让记忆压缩自动化 |

> 简单说：v0.72 确保 daemon 的「地基」是实的（hook 真的修好了），v0.73 让 daemon 监控的「数据」是净的（记忆有规则了）。v0.8 daemon 站在它们的肩膀上做触发器层。

---

## 十、待决策事项

| 决策 | 选项 | 建议 |
|------|------|------|
| **轮询 vs inotify/kqueue** | ① bash 轮询（跨平台，简单，低效）② fswatch（macOS 高效，但多一个二进制依赖）| **MVP 用轮询**（5s 间隔对 bash 友好），性能问题出现时加 fswatch 后端 |
| **提醒格式** | ① reminder.md 固定格式 ② reminder.md 带 YAML front-matter 供后续版本扩展 | ② **YAML front-matter**（版本号、生成时间、过期时间，machine readable）|
| **daemon 写入位置** | ① `~/.sofagent/daemon/` ② `~/.config/sofagent/` | **①** 保持与 .sofagent/ 一致，单目录管理 |
| **daemon 日志** | ① `/tmp/sofagent-daemon.log` ② `~/.sofagent/daemon/daemon.log` | **②** 集中到 .sofagent/ 目录下，便于用户查看和 cleanup.sh 统一清理 |
| **多用户隔离** | ① 每个用户独立 daemon ② 单系统级 daemon | **①** 用户级服务（launchd user agent / systemd user service），天然隔离 |
| **Agent 进程检测精度** | ① pgrep + 进程名白名单 ② 仅检测是否有 sofagent skill 加载中的 session | **① MVP**（简单可用），② 留 v0.9 |

---

> daemon 不是又一个约束——它是让已有约束跨 session 生效的执行器。
> 循环工程的核心公式里，daemon = 触发器。
