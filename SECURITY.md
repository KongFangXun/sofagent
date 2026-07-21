# 安全策略

> v1.1.7 · 2026-07-21（UTC）· 孔放勋

## 已知风险

sofagent 是纯本地 Harness 中间件，**数据不出本机**——但以下数据以**明文 Markdown** 存储，请评估风险：

| 文件 | 位置 | 可能含 |
|------|------|------|
| `task/logs/` | `.sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md` | 任务摘要、代码片段、API 响应摘要、对话摘要 |
| `think.md` | `.sofagent/think.md` | 反思记录，可能含踩坑细节、失败模式、决策推理 |
| `knowledge/` | `.sofagent/knowledge/` | 知识库 / 评估反馈（eval 体系；旧 `scoring/` 已废弃） |
| `orchestrator/` | `.sofagent/orchestrator/` | 编排决策历史 |

**当前状态（v1.1.7）**：
- ✅ 脱敏：sanitize() 管道扫描 API Key / 密码 / 手机号，写入前自动打码
- ✅ 数据保留：cleanup.sh 支持 --purge --before 定时清理 + tar.gz 归档
- ✅ 审计日志：task-record.sh 独立审计日志 + task/logs 追溯双通道
- ⚠️ 明文存储：`.sofagent/` 下文件仍为 Markdown 明文，未做加密
- ⚠️ **当前限制**：数据明文存储 + LLM 自评无外部基准。GDPR / 等保 / SOC2 场景需额外加密措施。age 加密**预计 v1.2.x 落地**（与 LIMITATIONS「v1.2.x 评估解耦」口径一致；v0.85 砍削决策：先验证核心价值再谈企业级）。合规审查员请注意：v1.1.x 版本不适合直接用于强合规场景，需配合外部加密卷（gpg / disk encryption）。
- `.sofagent/` 目录权限为 700（仅当前用户可访问），但同一服务器其他用户若有 root 权限可读

**企业环境建议**：
- 对 `.sofagent/` 目录做 gpg 加密或放在加密卷上
- 脱敏/保留/审计能力已在 v0.71 落地，详见 [企业部署指南](./docs/guides/enterprise-deploy.md)

### v1.1.7 新增能力的安全边界

v1.1.7 引入了三项新能力，其安全语义与边界如下：

| 能力 | 安全边界 / 语义 |
|------|------|
| **Dream Cycle（LLM 知识沉淀）** | 6 阶段流水线经 `LLMProvider` 接口抽象；v1.1.7 默认使用 MockLLM（确定性、无外部调用），RealLLM 在 v1.1.8 才接入。LLM 仅读取 `think.md`/知识库内容并产出结构化事实/概念，**不回写代码、不执行命令、不访问网络**。注入隔离见 `daemon/src/dream-cycle/` 的 system-role 声明与返回 schema 校验（P2-5）。 |
| **sensitivity 敏感度分级** | `core/memory-contract.ts` 定义 `Sensitivity`（public/internal/restricted），`DEFAULT_SENSITIVITY='internal'` 为 safe-by-default，restricted 绝不默认。语义是**可见性分级**而非加密——restricted 内容在 `knowledge status` 聚合时只计数不返回内容，但明文存储不变。 |
| **ActionGovernance 审计溯源** | 审计记录升级为可问责的动作凭证：`ActionGovernance`（actor/timestamp/targetEntity/context）+ `DecisionProvenance` 决策溯源组，写入 `history.jsonl`。提供**事后可追溯性**，但不在运行时阻断——Agent 仍可伪造 actor 字段（信任模型同 §审计工具信任模型）。防篡改 HMAC 签名规划在 v1.2.x（见 P2-6）。 |

### v1.1.8 新增能力的安全边界（开发期）

v1.1.8 引入了联邦传输与 Prompt 注入防护，其安全语义与边界如下：

#### 联邦查询四层防线攻防表

| 层 | 做什么 | 谁负责 | 被攻破的后果 | 攻击者需要 |
|:--:|------|:--:|------|------|
| 1 | MCP server 只绑 localhost | sofagent | 无法从网络直接访问 MCP | 先攻破本机 |
| 2 | OpenClaw channel 路由 | OpenClaw | 无法接入联邦 channel | OpenClaw device token |
| 3 | AES-256-GCM 加密 payload（`core/src/crypto/aes-gcm.ts`） | sofagent | channel 被窃听但内容不可读 | 256-bit 密钥（2^256 暴力不可行） |
| 4 | sensitivity frontmatter 过滤（peer 端 + 本地端双重校验） | sofagent | `restricted` entity 不可读 | 伪造设备 identity + 突破加密 |

> 🔴 **OpenClaw channel 审计结论（v1.1.8 开发前置核实）**：OpenClaw 本地回环 ws:// 明文传输、无 TLS——**第 3 层 sofagent 应用加密是唯一保密防线**。因此 federation channel 只搬运密文帧（iv‖tag‖ciphertext），绝不触碰明文 payload；即使 channel 被中间人劫持，内容仍不可读（纵深防御原则，不依赖 channel 自身安全性）。

#### 配对与密钥管理

| 项 | 语义 |
|------|------|
| **三条配对路径** | A：6 位码 + 公钥指纹 y/N 人工确认（防中间人）· B：`SOFAGENT_FEDERATION_TOKEN` 环境变量带外交换 + token-HMAC 公钥认证（CI/无人值守）· C：复用 v1.1.5 federation.json + HMAC `.sig` sidecar 验签（timingSafeEqual 恒定时间比较，缺失/篡改拒绝） |
| **key 存储** | ECDH(prime256v1) + HKDF-SHA256 派生的 32 字节 AES key **只存内存**，不落盘明文；持久化（OS keychain / age）留 v1.1.9 |
| **IV/nonce 管理** | 每条消息随机 12 字节 IV，绝不复用；GCM 16 字节认证标签校验失败即拒绝 |
| **密钥轮换** | 24h 过渡窗口内旧 key 只解不加，过窗口销毁强制重新协商 |

#### Prompt 注入 8 层防护映射表

| 层 | 防护内容 | sofagent 落点 | 状态 |
|:--:|------|------|:---:|
| 1 | 指令分层隔离——外部内容 `<untrusted>` 标签包裹 | `core/src/security/prompt-sanitizer.ts` `wrapUntrusted()`（闭合标签转义防逃逸；harness 加载链联邦知识强制包裹） | ✅ v1.1.8 补齐 |
| 2 | 工具动态最小权限 | Sub Agent 工具集零重叠设计（v1.1.0） | ✅ 已有 |
| 3 | 工具参数后端强制校验 | 审计引擎 git diff 硬证据 | ✅ 已有 |
| 4 | 敏感数据不进 prompt——脱敏 | `prompt-sanitizer.ts` `redactForPrompt()`（sk-\*\*\*/AKIA\*\*\*/手机号/邮箱；restricted 占位兜底，与 v1.1.6 `isSensitivityVisible` 过滤双保险） | ✅ v1.1.8 补齐 |
| 5 | RAG 召回可信分级 | `core/src/security/trust-grading.ts`（`resolveTrust` 缺省 internal；official>internal>user>web；web+restricted 丢弃；sortByTrust） | ✅ v1.1.8 补齐 |
| 6 | 输出结构化 + 执行前审核 | entry-gate 风险分级 + HITL | ✅ 已有 |
| 7 | 高危动作强制人工确认 | entry-gate 🔴 高风险审批 | ✅ 已有 |
| 8 | 全链路日志 + 红队测试 | 审计 history.jsonl + daemon WARN 累积（v1.1.4）；联邦查询 `federation_query` 审计条目 | ✅ 已有 |

| 其他能力 | 安全边界 / 语义 |
|------|------|
| **联邦查询离线降级** | 单 peer 5s 超时按离线跳过不阻塞；全部 peer 离线 / federation 整块失败 → 退化纯本地查，不影响 MCP server 运行（best-effort）。 |
| **知识摘要主动通知** | 素材仅 `log.md` + `health-report.md`（restricted 在生产侧已被 sensitivity 过滤，不进通知）；通道复用 push-target（daemon:notice + openclaw:im outbox）；失败静默不阻塞 dream-cycle / health 主流程。 |
| **编排引擎 Sub Agent 委派** | 每个 Sub Agent 的 systemPrompt 前置四层约束加载链（SKILL.md 宪法层不可被 workflow YAML 覆盖）；同文件冲突检测 WARN（filesValue 文件级 LWW 合并的提醒，不阻塞）；dag-runner 不引入新工具面（`tools: []`）。 |

### Daemon 监控边界

sofagent daemon 是本地文件系统监控守护进程，其行为边界如下：

| 维度 | 说明 |
|------|------|
| **监控范围** | 仅 `.sofagent/` 工作目录 + 用户显式配置的路径（`config.yml` 中的 `daemon.watchPaths`）。不扫描用户其他文件。 |
| **数据去向** | 所有数据本地存储（`.sofagent/` 目录下），不上传云端，不向外发送网络请求——除非用户显式配置 TencentDB Memory 集成（`install.sh --with-memory`，opt-in）。 |
| **权限** | 只读监听文件事件（hash 变化检测 + cron 定时巡检）。**不修改用户文件、不删除文件、不外传数据**。审计发现写入 `daemon-notice.md` 和 `history.jsonl`。 |
| **审计结果推送** | v1.2.x 前 daemon 审计结果**仅本地存储**（`daemon-notice.md` + 终端 stdout），**不推送 Webhook/企业协同平台**。企业 IT 如需集中收集审计日志，当前版本需自行定时轮询 `.sofagent/audit/history.jsonl`。Webhook 推送能力规划在 v1.2.x。 |

> 💡 **企业集中收集 workaround（v1.1.6）**：Webhook 推送在 v1.2.x 才就绪，企业 IT 如需在 v1.1.x 集中收集审计日志，可用 filebeat / logstash 等采集 agent **定时轮询 `.sofagent/audit/history.jsonl`**（append-only、JSONL 明文），转发至 SIEM / 企业日志平台。注意 history.jsonl 为明文存储，转发前建议配合外部加密卷或 age 加密，避免敏感 diff 摘要外泄。
| **history.jsonl 存储** | 审计拦截记录以 JSONL 明文存储在 `.sofagent/audit/history.jsonl`，目录权限 0o700、文件权限 0o600（v1.1.3 起收紧）。仅追加写入（`appendFileSync`），不覆盖、不删除。历史记录供编排引擎和进化引擎本地读取。 |

> daemon 源码见 `sofagent/daemon/src/`：`fs-watch.ts`（文件监听）、`cron.ts`（定时巡检）、`snapshot.ts`（快照）、`weekly-report.ts`（周报生成）、`lessons-extract.ts`（经验提取）、`usb-detect.ts`（USB federation 检测，v1.1.4+）。

### USB federation 安全模型（v1.1.4+）

> ⚠️ **企业环境警告**：v1.1.4 的 USB federation 曾是**基础检测模式**、**无签名校验**；**自 v1.1.5 起已加入 HMAC 签名校验**，v1.1.6 当前状态已具备签名保护（详见下方对比表）。

| 维度 | v1.1.6（当前） | v1.1.7+（计划） |
|------|:--|:--|
| 检测条件 | USB 卷标 = `SOFAGENT` + 存在 `federation.json` | 同左 + HMAC 签名校验（`.sig` sidecar） |
| 配置应用 | 写入 `~/.sofagent/federation.json`，**不自动分发到各目录**（applyFederation 未实现） | 自动 nodes → orchestrator/nodes/、policies → audit/policies/ |
| 注入风险 | 🔴 **任何人制作的 SOFAGENT 卷标 U 盘可注入任意 federation 配置** | ✅ 签名不匹配则拒绝导入 |
| Schema 校验 | ❌ JSON.parse 后直接序列化写入，不校验字段 | ✅ 按 FederationConfig schema 校验 |

**企业部署建议（v1.1.6）**：
- 不要在共享/公共设备上启用 USB federation 自动检测
- 如需使用，插入 U 盘前先在隔离设备上检查 `federation.json` 内容
- 生产环境等 v1.1.5 的签名校验上线后再启用

`detectSofagentUsb()` 源码见 `sofagent/daemon/src/usb-detect.ts`，错误处理完善（设备不存在/文件不存在/JSON 解析失败都 try-catch 返回明确错误），但**不做内容安全校验**——这是 PRD Q4 的明确决策（v1.1.4 先做基础检测，签名校验留后续）。

## install.sh 行为说明

install.sh 是 sofagent 的一键安装脚本。以下是其完整行为清单，供安全审查：

### 脚本会做的事

| 操作 | 路径 | 说明 |
|------|------|------|
| 创建目录 | `~/.openclaw/skills/sofagent/` 或 `~/.workbuddy/skills/sofagent/` | 按平台部署 Skill 文件 |
| 创建目录 | `${项目目录}/.sofagent/task/logs/` | 数据目录，权限 700 |
| 复制文件 | 宪法(fde.md) + 6 核心 Skill + 数据模板 + 配套脚本 | 从仓库 `sofagent/skill/` 和 `sofagent/scripts/` 复制到目标目录 |
| 写入配置 | `~/.openclaw/openclaw.json`（仅 OpenClaw） | 注册加载链 Hook |
| 写入配置 | `~/.openclaw/config.json`（仅 OpenClaw） | 注入 loopDetection 断路器 |
| npm install | `deepagents`（编排引擎依赖） | Sub Agent 编排引擎 |
| 安装服务 | launchd(macOS) / systemd(Linux) | daemon 后台进程（交互确认后。daemon 当前为 bash 实现，正常运行中） |

### 脚本不会做的事

- ❌ 不会 `sudo`——所有操作在用户权限范围内
- ❌ 不会改系统文件——不碰 `/etc`、`/usr`、`/System`
- ❌ 不会联网下载额外内容
- ❌ 不会执行远程脚本（`--remote` 模式只做 git clone 官方仓库）
- ❌ 不会收集或上传任何用户数据

### 源码审查

install.sh 拆分为以下模块，便于逐模块审查：

| 模块 | 行数 | 职责 |
|------|------|------|
| `install.sh` | 160 | 主入口（组装 + 参数解析） |
| `lib/config.sh` | 143 | 配置加载 + 常量定义 |
| `lib/daemon-lib.sh` | 142 | daemon 公共函数库 |
| `lib/daemon-register.sh` | 115 | Hook + daemon 注册 |
| `lib/file-deploy.sh` | 109 | 文件部署 |
| `lib/platform-detect.sh` | 102 | 平台探测 + 参数解析 |
| `lib/post-install.sh` | 97 | 安装后检查 + 输出 |

## 报告漏洞

如果你发现安全问题（不是普通 Bug），请通过以下方式私密报告：

- **GitHub Security Advisory**：[私密报告漏洞](https://github.com/KongFangXun/sofagent/security/advisories/new)（推荐）
- **邮件**：kong.yao@evfrey.com

**请不要在公开 Issue 中披露安全漏洞细节。**

## 响应承诺

- **确认**：7 天内确认收到报告
- **初步评估**：30 天内给出初步评估和影响范围
- **修复**：根据严重程度排期——高危（数据泄露/权限提升）优先修复并发布补丁版本

## 适用范围

本安全策略适用于 sofagent 项目仓库内的所有文件。第三方依赖（如 deepagents、OpenClaw）的安全问题请向对应项目报告。

## 免责声明

sofagent 基于 MIT 许可证发布，按「现状」（AS IS）提供，不附带任何明示或暗示的担保。作者不对因使用本软件而产生的任何直接、间接、附带或后果性损害承担责任。sofagent 是审计工具而非安全防线——它能检测常见的 Agent 违规模式，但不能保证拦截所有攻击向量。

---

## 审计工具安全性（sofagent-audit）

sofagent-audit（v0.92+）是 TypeScript CLI，执行 `execFileSync('git', ...)` 读取 git diff 和文件系统。不使用 eval、不 spawn shell、不执行外部脚本。命令参数使用数组传入（`['diff', '--unified=3', range]`），range 参数经过正则校验 `[a-zA-Z0-9~^.\-]`，无命令注入风险。

**数据访问**：审计工具只读取 git diff 输出和 `.sofagent/task/logs/` 目录下的 Markdown 文件，不发起网络请求，不写入任何文件。

**信任边界**：审计工具本身是确定性的——给定相同的 git diff 和日志，输出相同。但审计 A7/A8 的结果依赖 Agent 日志的真实性（Agent 可以伪造日志）。这不是审计工具的安全漏洞，是架构级别的信任模型选择。详见 [LIMITATIONS.md](./LIMITATIONS.md)（「审计工具信任模型：Agent 自我报告」节）。

> ⚠️ **A14/A15 是 commit 时审计，不是运行时阻断。** Agent 在 commit 前仍可能访问受限数据——审计只能事后发现。这不是运行时沙箱。

### history.jsonl 访问控制

history.jsonl 存储审计拦截记录（含被拦截的 diff 摘要）。以下为当前访问模型：

| 操作 | Agent 能否？ | 说明 |
|------|:--:|------|
| 读取 | ✅ 能（以当前用户身份） | Agent 和审计工具共享同一文件系统权限 |
| 写入 | ✅ 能 | Agent 可以追加/删除/篡改 history.jsonl |
| 检测篡改 | ⚠️ --doctor 第 8 项检查 | 通过 hash chain 验证——但 Agent 可以在篡改后重新计算整条链 |

**缓解**：sanitize() 管道在写入前对密钥/密码/手机号打码。但这不是加密——Agent 可以从原始 git diff 中直接读到敏感内容。根治方案（age 加密 + 独立审计存储）推到 v2.x。

#### 审计日志脱敏与访问控制

sanitize() 管道在写入 history.jsonl、think.md、task/logs 等文件前自动执行：

- **密钥打码**：匹配 `sk-`/`Bearer`/`api_key`/`password=` 等模式 → 替换为 `***REDACTED***`
- **手机号打码**：匹配 11 位手机号格式 → `138****1234`
- **密码字段打码**：匹配 `password[:=]\s*\S+` → `password=***`

> 以上为**掩码（masking）非加密**——原始数据仍在 git diff 中可读。sanitize() 只保护写入 `.sofagent/` 的副本，不保护源头。

**文件权限**：`.sofagent/` 目录权限为 700（仅当前用户可读写），`install.sh` 和 `--init` 自动设置。同一服务器其他非 root 用户无法读取。root 用户可读——如需防 root，建议将 `.sofagent/` 放在加密卷上。

### 已知绕过路径

| 绕过方式 | 检测手段 | 缓解 |
|----------|---------|------|
| `git commit --no-verify` | ❌ 无自动检测 | 定期 `--doctor` 检查未审计的 commit（`git log --grep` 匹配审计签名） |
| 删除 commit-msg hook 文件 | ⚠️ `--doctor` 可检测 | daemon 监控 .git/hooks/ 目录变化（v1.x 计划） |
| 伪造 Agent 日志（task/logs） | ❌ 无自动检测 | 人工抽查 + 交叉验证 git log 时间戳 |
| 绕过 --init 直接手动修改 config.yml | ❌ 无自动检测 | config hash 校验（见 fail-closed 改进） |

> ⚠️ 以上绕过路径均依赖 Agent 的"自觉"——这是 sofagent 架构级别的信任模型选择：审计工具是**协助**人类监督，不是**替代**人类监督。已知绕过路径详见 LIMITATIONS 已有信任模型描述。

---

## 第三方依赖供应链

**deepagents** 是 sofagent 编排引擎的正式依赖（`deepagents@^1.10.7`，npm 包）。v1.0.7 起从 optionalDependency 提升为正式依赖。

> 🔴 **Breaking Change（v1.0.7）**：ao（agency-orchestrator）已完全退役。v1.0.6 用户升级到 v1.0.7 后需手动卸载：`npm uninstall -g agency-orchestrator`。编排引擎已全面迁移到 DeepAgents，ao 代码路径全部移除。

**供应链安全建议**：
- 每次 `npm install` 后运行 `npm audit`
- 内网环境建议预装 deepagents 并验证安装通过后再部署

## 知识库与工具网关的安全边界（2026-07 研报印证）

2026-07 行业研报对「知识库作为 Agent 可信调用载体」提出的 4 道关卡，与 sofagent 安全模型同构：

- **权限实时回连核验**：研报强调数据入口权限必须**实时回连**核验、不静态拷贝。对应 sofagent 审计 A14（知识库越权：事后审计而非运行时阻断，见 LIMITATIONS §五）——当前为事后发现，运行时阻断是 v2.x 方向。
- **受控 Action + 全链路审计**：研报的 Action（前置·权限·幂等·副作用·审计）与 sofagent「模型提建议、审计引擎控执行」同一原则（见 DEVELOPMENT §八 财务报销沙盒）。
- **权限隔离（Entity Resolution）**：多源知识需先解析实体归属再授权，避免越权拼接——对应 knowledge/ 的实体归属与 A15 约束验证。

> 📖 来源：温故知新 2026-07-21（行业研报《企业知识库进阶》《Ontology Runtime 企业级架构落地》）
