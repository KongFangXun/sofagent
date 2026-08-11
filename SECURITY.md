# 安全策略

> v1.3.2 · 2026-08-09（UTC）· 孔放勋
>
> 按安全主题组织，版本号作为括号注释。企业 IT 可按主题快速定位。

## 目录

- [已知风险（明文存储）](#已知风险明文存储)
- [一、传输安全](#一传输安全)
- [二、知识安全](#二知识安全)
- [三、编排安全](#三编排安全)
- [四、审计与存储安全](#四审计与存储安全)
- [五、工程安全](#五工程安全)
- [六、LLM API Key 透明度](#六llm-api-key-透明度v120)
- [报告漏洞](#报告漏洞)

---

## 已知风险（明文存储）

sofagent 是一个 FDE Agent——底层引擎是纯本地 Harness 中间件（约束中间层），**数据不出本机**——但以下数据以**明文 Markdown** 存储，请评估风险：

**安装后数据目录结构**（`~/.sofagent/`）：
```
~/.sofagent/
├── data/          ← 用户可见运行时数据（审计/知识库/反思/任务日志）
├── internal/      ← 引擎内部状态（checkpoint / .git-shadow / watch.yml）
├── bin/           ← CLI 入口
└── skill/         ← Skill 文件
```


| 文件 | 位置 | 可能含 |
|------|------|------|
| `task/logs/` | `data/task/logs/YYYY-MM/YYYY-MM-DD.md` | 任务摘要、代码片段、API 响应摘要、对话摘要 |
| `think.md` | `data/think.md` | 反思记录，可能含踩坑细节、失败模式、决策推理 |
| `knowledge/` | `data/knowledge/` | 知识库 / 评估反馈（eval 体系；旧 `scoring/` 已废弃） |
| `orchestrator/` | `data/orchestrator/` | 编排决策历史 |

**当前状态（v1.3.1）**：
- ✅ 脱敏：sanitize() 管道扫描 API Key / 密码 / 手机号，写入前自动打码
- ✅ 数据保留：cleanup.sh 支持 --purge --before 定时清理 + tar.gz 归档
- ✅ 审计日志：task-record.sh 独立审计日志 + task/logs 追溯双通道
- ⚠️ 明文存储：`data/` 下文件仍为 Markdown 明文，未做加密
- ⚠️ **当前限制**：数据明文存储 + LLM 自评无外部基准。GDPR / 等保 / SOC2 场景需额外加密措施。age 加密**已排 v1.3.8（与沙箱/权限/网关同批安全加固）落地**。合规审查员请注意：**当前版本（v1.3.x）仍不适合直接用于强合规场景**，需配合外部加密卷（gpg / disk encryption）。

### 当前版本（v1.3.1）临时缓解措施

在 age 加密（目标 v1.3.8）交付之前，建议：
1. **设置 `~/.sofagent/data/` 目录权限为 700**：`chmod 700 ~/.sofagent/data/`（用户可见运行时数据；`~/.sofagent/internal/` 引擎内部状态同样 700）
2. **将 `~/.sofagent/` 父目录放在加密文件系统上**（如 macOS APFS 加密卷）
3. **定期轮换 `~/.sofagent/data/` 中的历史审计数据**

> 📌 config.yml 的权限加固（chmod 400）见 [LIMITATIONS.md](./docs/LIMITATIONS.md) "config.yml 可被篡改"段。

**企业环境建议**：
- 对 `data/` 目录做 gpg 加密或放在加密卷上
- 脱敏/保留/审计能力已在 v0.71 落地，详见 [企业部署指南](./docs/guides/enterprise-deploy.md)

---

## 一、传输安全

### 联邦查询四层防线（v1.1.8）

| 层 | 做什么 | 谁负责 | 被攻破的后果 | 攻击者需要 |
|:--:|------|:--:|------|------|
| 1 | MCP server 只绑 localhost | sofagent | 无法从网络直接访问 MCP | 先攻破本机 |
| 2 | OpenClaw channel 路由 | OpenClaw | 无法接入联邦 channel | OpenClaw device token |
| 3 | AES-256-GCM 加密 payload（`core/src/crypto/aes-gcm.ts`） | sofagent | channel 被窃听但内容不可读 | 256-bit 密钥（2^256 暴力不可行） |
| 4 | sensitivity frontmatter 过滤（peer 端 + 本地端双重校验） | sofagent | `restricted` entity 不可读 | 伪造设备 identity + 突破加密 |

> 🔴 **OpenClaw channel 审计结论（v1.1.8 开发前置核实）**：OpenClaw 本地回环 ws:// 明文传输、无 TLS——**第 3 层 sofagent 应用加密是唯一保密防线**。因此 federation channel 只搬运密文帧（iv‖tag‖ciphertext），绝不触碰明文 payload；即使 channel 被中间人劫持，内容仍不可读（纵深防御原则，不依赖 channel 自身安全性）。

### 配对与密钥管理（v1.1.8）

| 项 | 语义 |
|------|------|
| **三条配对路径** | A：6 位码 + 公钥指纹 y/N 人工确认（防中间人）· B：`~/.sofagent/federation.token` 文件带外交换（权限 600，v1.2.3 起，原环境变量方式已废弃）+ token-HMAC 公钥认证（CI/无人值守）· C：复用 v1.1.5 federation.json + HMAC `.sig` sidecar 验签（timingSafeEqual 恒定时间比较，缺失/篡改拒绝） |
| **key 存储** | ECDH(prime256v1) + HKDF-SHA256 派生的 32 字节 AES key **只存内存**，不落盘明文；持久化（OS keychain / age）留 v1.1.9 |
| **IV/nonce 管理** | 每条消息随机 12 字节 IV，绝不复用；GCM 16 字节认证标签校验失败即拒绝 |
| **密钥轮换** | 24h 过渡窗口内旧 key 只解不加，过窗口销毁强制重新协商 |

### 🔴 SOFAGENT_FEDERATION_TOKEN 进程可见（高危）— ✅ 已修复 v1.2.3

**风险（已修复）**：联邦配对使用的 `SOFAGENT_FEDERATION_TOKEN` 曾通过环境变量传递，
在进程列表（`ps e`、`/proc/*/environ`）中明文可见。

**修复**：v1.2.3 已将 token 从环境变量迁移至 `~/.sofagent/federation.token` 文件读取（权限 600），

> **v1.2.8 轮换提醒**：联邦 token 建议 90 天轮换一次。`--doctor` 不自动检查 token 年龄。手动检查：
> ```bash
> # 查看 token 文件创建/修改时间
> stat -f '%Sm' ~/.sofagent/federation.token 2>/dev/null || stat -c '%y' ~/.sofagent/federation.token 2>/dev/null
> # 如超过 90 天，重新执行联邦配对流程生成新 token
> ```
不再在进程列表中暴露。详见 `engine/core/src/crypto/pairing.ts` 的 `readTokenFromFile()`。

**影响范围**：v1.1.0 - v1.2.2（已修复于 v1.2.3）

> ⚠️ **HMAC key 分发安全**（v1.1.8）：路径 C 的 HMAC 签名密钥如与 federation.json 同放在 USB 等可移动介质上，攻击者获取介质即可伪造 `.sig` 文件。建议 HMAC key 通过独立渠道（如密码管理器 / 加密邮件）分发，不与 federation.json 同介质存储。

### USB federation 安全模型（v1.1.4+）

> ⚠️ **企业环境警告**：v1.1.4 的 USB federation 曾是**基础检测模式**、**无签名校验**；**自 v1.1.5 起已加入 HMAC 签名校验**。

| 维度 | v1.1.4（基础检测，无签名） | v1.1.5+（HMAC 签名，当前） |
|------|:--|:--|
| 检测条件 | USB 卷标 = `SOFAGENT` + 存在 `federation.json` | 同左 + HMAC 签名校验（`.sig` sidecar） |
| 配置应用 | 写入 `~/.sofagent/federation.json`，**不自动分发到各目录**（applyFederation 未实现） | 自动 nodes → orchestrator/nodes/、policies → audit/policies/（✅ v1.1.5 已落地，`applyFederation()`） |
| 注入风险 | 🔴 **任何人制作的 SOFAGENT 卷标 U 盘可注入任意 federation 配置** | ✅ 签名不匹配则拒绝导入 |
| Schema 校验 | ❌ JSON.parse 后直接序列化写入，不校验字段 | ✅ 按 FederationConfig schema 校验（✅ v1.1.5 已落地，`validateFederationSchema()`） |

**企业部署建议（v1.1.6）**：
- 不要在共享/公共设备上启用 USB federation 自动检测
- 如需使用，插入 U 盘前先在隔离设备上检查 `federation.json` 内容
- 生产环境等 v1.1.5 的签名校验上线后再启用

`detectSofagentUsb()` 源码见 `engine/daemon/src/usb-detect.ts`，错误处理完善（设备不存在/文件不存在/JSON 解析失败都 try-catch 返回明确错误）。内容安全校验自 v1.1.5 起由 HMAC 签名校验覆盖（`.sig` sidecar + `timingSafeEqual`），v1.1.9 升级为全量签名（`usb-signature.ts`：HMAC-SHA256 路径 POSIX 归一化 + 字典序 + SHA-256 内容哈希串联，详见上方「USB 完整运行时攻防表」）。

### 摘要推送安全（v1.1.8）

> 通过 `openclaw:im` 推送的知识摘要不含 restricted 内容（sensitivity 双重过滤），但 internal 内容可能含项目内部信息。`openclaw:im` 通道的安全性由 OpenClaw 保证（本地回环 ws://，摘要内容不含结构化密钥格式，redactForPrompt 管道同样适用于通知内容）。

### USB 完整运行时攻防表（v1.1.9）

> 「Node 便携版 + 启动脚本」方案——IT 用 `sofagent-daemon create-usb-key` 写入 U 盘（Node 便携版 + sofagent dist + 三平台启动脚本 + federation.json + 空 knowledge/），员工双击 `start` 3 秒联邦在线，拔盘零残留。两道防线：**HMAC-SHA256 全量签名防篡改**（`daemon/src/usb-signature.ts`，路径 POSIX 归一化 + 字典序 + 内容哈希串联，不含 mtime，确定性可复算）+ **knowledge/ AES-256-GCM 磁盘加密防失窃**（复用 v1.1.8 `core/crypto/aes-gcm.ts`，密钥 32 字节存 U 盘 `federation.json` 的 `key` 字段——U 盘本身即信任根，防的是「丢盘后 knowledge/ 被读」）。

| 攻击场景 | 防线 | 结果 |
|------|------|------|
| 偷 U 盘插自己电脑看文件 | knowledge/ 全盘 AES-256-GCM 密文（`knowledge/*.enc`，iv‖tag‖ciphertext 帧）；明文只在 daemon 内存 `Map<string, Buffer>`，退出 `Buffer.fill(0)` 清零 | 无密钥不可读；文件系统上永远只有密文 |
| 删掉 federation.json 试图重置身份 | HMAC 全量签名：federation.json 在受保护文件清单内，删除即签名不匹配 | daemon 验签失败 → 写 `security-events.jsonl` → `process.exit(1)`（fail-closed 拒绝启动） |
| 往 U 盘拖入恶意文件 | `verifyUsbSignature()` 双向校验：签名内文件被改/被删 → mismatch；签名外新增文件 → `file-added` | 验签失败拒绝启动并记录安全事件 |
| 整盘格式化重写 | `.sofagent-signature` 签名文件随盘消失 → `signature-missing` | daemon 检测不到签名 → fail-closed 拒绝启动 |

> ⚠️ **密钥模型边界**（U2 决策）：AES key 明文存 U 盘 `federation.json`——拿到 U 盘的人可读出 key 再解密 knowledge/。「拿到盘也解不开」需 PBKDF2/Argon2 密码派生（启动时输入密码），与「双击 start 3 秒联邦在线」体验冲突，v1.1.9 保持简单模型，v1.2.x 再评估密码保护。
>
> ⚠️ **签名排除项**：`runtime/`（Node 便携版二进制，各平台不同）不纳入 HMAC 签名——被替换的 runtime 二进制在签名保护之外，企业 IT 应通过官方渠道制作 U 盘并核对 Node 版本。`.sofagent-signature` 自身亦排除。
>
> ⚠️ **HMAC 密钥双轨制**（U3 决策）：本机场景复用 `~/.sofagent/usb-secret.key`；U 盘运行时从 U 盘 `federation.json` 的 `hmacKey` 字段读取（便携化要求）。两个密钥源按 `startUsbRuntime` vs 本机 daemon 场景切换，v1.2.x 再评估统一。

---

## 二、知识安全

### sensitivity 敏感度分级（v1.1.7）

`core/memory-contract.ts` 定义 `Sensitivity`（public/internal/restricted），`DEFAULT_SENSITIVITY='internal'` 为 safe-by-default，restricted 绝不默认。语义是**可见性分级**而非加密——restricted 内容在 `knowledge status` 聚合时只计数不返回内容，但明文存储不变。

### trust 可信分级（v1.1.8）

`core/src/security/trust-grading.ts` 的 `resolveTrust` 缺省 internal；`TRUST_ORDER` official>internal>user>web；web+restricted 组合直接丢弃；RAG 召回 sortByTrust。

### Dream Cycle LLM 安全边界（v1.1.7）

6 阶段流水线经 `LLMProvider` 接口抽象；v1.1.7 默认使用 MockLLM（确定性、无外部调用），RealLLM 在 v1.1.8 才接入。LLM 仅读取 `think.md`/知识库内容并产出结构化事实/概念，**不回写代码、不执行命令、不访问网络**。注入隔离见 `daemon/src/dream-cycle/` 的 system-role 声明与返回 schema 校验。

### 知识摘要主动通知（v1.1.8）

素材仅 `log.md` + `health-report.md`（restricted 在生产侧已被 sensitivity 过滤，不进通知）；通道复用 push-target（daemon:notice + openclaw:im outbox），仅本机/联邦内通知，非 v1.2.1 规划的对外 Webhook/飞书推送；失败静默不阻塞 dream-cycle / health 主流程。

### 知识库与工具网关安全边界

知识库作为 Agent 可信调用载体，sofagent 的对应机制：

- **权限核验**：审计 A14 检测知识库越权访问——当前为**事后审计**而非运行时阻断（见 LIMITATIONS §五）；运行时阻断列入 v2.x（ROADMAP.md）。
- **受控 Action + 全链路审计**：「模型提建议、审计引擎控执行」——Action 经权限·副作用·审计后才落地（见 DEVELOPMENT §八）。
- **权限隔离（Entity Resolution）**：多源知识先解析实体归属再授权，避免越权拼接——对应 knowledge/ 实体归属与 A15 约束验证。

---

## 三、编排安全

### Prompt 注入 8 层防护映射表（v1.1.8 补齐层 1/4/5）

| 层 | 防护内容 | sofagent 落点 | 状态 |
|:--:|------|------|:---:|
| 1 | 指令分层隔离——外部内容 `<untrusted>` 标签包裹 | `core/src/security/prompt-sanitizer.ts` `wrapUntrusted()`（闭合标签转义防逃逸；harness 加载链联邦知识强制包裹） | ✅ v1.1.8 补齐 |
| 2 | 工具动态最小权限 | Sub Agent 工具集零重叠设计（v1.1.0） | ✅ 已有 |
| 3 | 工具参数后端强制校验 | 审计引擎 git diff 硬证据 | ✅ 已有 |
| 4 | 敏感数据不进 prompt——脱敏 | `prompt-sanitizer.ts` `redactForPrompt()`（sk-\*\*\*/AKIA\*\*\*/手机号/邮箱/GitHub token/PEM 私钥；restricted 占位兜底，与 v1.1.6 `isSensitivityVisible` 过滤双保险） | ✅ v1.1.8 补齐 |
| 5 | RAG 召回可信分级 | `core/src/security/trust-grading.ts`（`resolveTrust` 缺省 internal；official>internal>user>web；web+restricted 丢弃；sortByTrust） | ✅ v1.1.8 补齐 |
| 6 | 输出结构化 + 执行前审核 | entry-gate 风险分级 + HITL | ✅ 已有 |
| 7 | 高危动作强制人工确认 | entry-gate 🔴 高风险审批 | ✅ 已有 |
| 8 | 全链路日志 + 红队测试 | 审计 history.jsonl + daemon WARN 累积（v1.1.4）；联邦查询 `federation_query` 审计条目 | ✅ 已有 |

> ⚠️ **A9 注入检测局限——编码绕过**：A9 正则检测覆盖常见中文"忽略类"指令、英文"ignore 类"指令，以及 leet speak 变体（`1gn0r3` → `ignore`，通过 normalizeLine() 反转 + ×0.8 降权匹配）。但不覆盖：① Unicode 同形字替换（西里尔字母 `а` 替换拉丁 `a`）；② Base64/hex 编码后的注入 payload。这些绕过手法依赖语义分析（非纯正则可覆盖），规划在 v1.3.x 评估 LLM 辅助检测。**在 v1.3.x LLM 辅助检测落地前，建议对外部输入做归一化（Unicode NFC + 解码后再送检）。**

### Sub Agent 工具集零重叠（v1.1.0）

每个 Sub Agent 的工具集按职责域划分，无重叠。详见各 Sub Agent 配置。

### 编排引擎 Sub Agent 委派（v1.1.8）

每个 Sub Agent 的 systemPrompt 前置四层约束加载链（SKILL.md 宪法层不可被 workflow YAML 覆盖）；同文件冲突检测 WARN（filesValue 文件级 LWW 合并的提醒，不阻塞）；SubAgent 继承 LangGraph createReactAgent 默认工具集（read_file/write_file/edit_file/glob/grep/execute），主 Agent 仅保留 task 委派工具（`tools: []`）。

### 联邦查询离线降级（v1.1.8）

单 peer 5s 超时按离线跳过不阻塞；全部 peer 离线 / federation 整块失败 → 退化纯本地查，不影响 MCP server 运行（best-effort）。

---

## 四、审计与存储安全

> 🔒 **运行时审计日志按 git 仓库隔离（v1.3.0 已交付）**：运行时审计日志（`runtime-audit.jsonl`）按 git 仓库隔离存储于 `data/audit/runtime/<repo-hash>/`（`git rev-parse --show-toplevel` hash；非 git 回退 `nogit-<cwd-hash>`）。注意：commit 级审计历史 `history.jsonl` 仍为全局存储，多项目场景下记录混合。

```
~/.sofagent/
├── data/          ← 用户可见运行时数据（审计/知识库/反思/任务日志）
├── internal/      ← 引擎内部状态（checkpoint / .git-shadow / watch.yml）
├── bin/           ← CLI 入口
└── skill/         ← Skill 文件
```

### ActionGovernance 审计溯源（v1.1.7）

审计记录升级为可问责的动作凭证：`ActionGovernance`（actor/timestamp/targetEntity/context）+ `DecisionProvenance` 决策溯源组，写入 `history.jsonl`。提供**事后可追溯性**，但不在运行时阻断——Agent 仍可伪造 actor 字段（信任模型同 §审计引擎信任模型）。防篡改 HMAC 签名详见下方「HMAC 签名（v1.1.8+ 已落地）」。

### HMAC 签名（v1.1.8+ 已落地）

`history.jsonl` 自 v1.1.8 起支持 HMAC-SHA256 签名（密钥来自 `~/.sofagent-key`）。有密钥时每条记录签名，Agent 无法在无密钥情况下伪造签名；无密钥时降级为 SHA-256 hash chain（Agent 可重算整链，仅事后可追溯非强防篡改）。`--doctor`（v1.2.0 起）会实际调用 `checkHistoryChainIntegrity()` 校验链完整性。建议高安全场景配置 `~/.sofagent-key` 启用强校验。

### 审计引擎安全性（sofagent-audit）

sofagent-audit（v0.92+）是 TypeScript CLI，执行 `execFileSync('git', ...)` 读取 git diff 和文件系统。不使用 eval、不 spawn shell、不执行外部脚本。命令参数使用数组传入（`['diff', '--unified=3', range]`），range 参数经过正则校验 `[a-zA-Z0-9~^.\-]`，无命令注入风险。

**数据访问**：审计引擎核心不发起网络请求（webhook 为可选功能，需显式配置 URL 后才启用）；写入仅限 `~/.sofagent/data/` 目录（审计历史、session 报告、快照等）。

**信任边界**：审计引擎本身是确定性的——给定相同的 git diff 和日志，输出相同。但审计 A7/A8 的结果依赖 Agent 日志的真实性（Agent 可以伪造日志）。这不是审计引擎的安全漏洞，是架构级别的信任模型选择。详见 [LIMITATIONS.md](./docs/LIMITATIONS.md)（「审计引擎信任模型：Agent 自我报告」节）。

> ⚠️ **A14/A15 是 commit 时审计，不是运行时阻断。** Agent 在 commit 前仍可能访问受限数据——审计只能事后发现。这不是运行时沙箱。

### history.jsonl 访问控制（v1.1.3+）

history.jsonl 存储审计拦截记录（含被拦截的 diff 摘要）。以下为当前访问模型：

| 操作 | Agent 能否？ | 说明 |
|------|:--:|------|
| 读取 | ✅ 能（以当前用户身份） | Agent 和审计引擎共享同一文件系统权限 |
| 写入 | ✅ 能 | Agent 可以追加/删除/篡改 history.jsonl |
| 检测篡改 | ⚠️ --doctor 第 8 项检查 | 通过 hash chain 验证——但 Agent 可以在篡改后重新计算整条链 |

**缓解**：sanitize() 管道在写入前对密钥/密码/手机号打码。但这不是加密——Agent 可以从原始 git diff 中直接读到敏感内容。根治方案：age 加密（v1.3.8 落地，参见 ROADMAP.md）+ 独立审计存储（更后期规划）。

#### 审计日志脱敏与访问控制

sanitize() 管道在写入 history.jsonl、think.md、task/logs 等文件前自动执行：

- **密钥打码**：匹配 `sk-`/`Bearer`/`api_key`/`password=` 等模式 → 替换为 `***REDACTED***`
- **手机号打码**：匹配 11 位手机号格式 → `138****1234`
- **密码字段打码**：匹配 `password[:=]\s*\S+` → `password=***`
- **v1.2.8 自定义业务机密脱敏**：config.yml 配置 `sanitizePatterns` 字段可添加企业业务机密正则（如合同名称/客户名单/工资表），审计记录和 webhook 推送前均过自定义脱敏管道。示例：
  ```yaml
  sanitizePatterns:
    - pattern: "合同编号[:：]\\s*\\d{6,}"
      replacement: "[合同编号:REDACTED]"
    - pattern: "[\\u4e00-\\u9fa5]{2,4}的工资单"
      replacement: "[工资单:REDACTED]"
  ```

> 以上为**掩码（masking）非加密**——原始数据仍在 git diff 中可读。sanitize() 只保护写入 `data/` 的副本，不保护源头。

**文件权限**：`data/` 目录权限建议 700（用户可见运行时数据）；`~/.sofagent/internal/` 目录权限 700（引擎内部状态）。`install.sh` 和 `--init` 自动设置。同一服务器其他非 root 用户无法读取。root 用户可读——如需防 root，建议将 `data/` 放在加密卷上。

#### history.jsonl 存储（v1.1.3+）

审计拦截记录以 JSONL 明文存储在 `data/audit/history.jsonl`，目录权限 0o700、文件权限 0o600（v1.1.3 起收紧）。仅追加写入（`appendFileSync`），不覆盖、不删除。历史记录供编排引擎和进化引擎本地读取。

**HMAC 密钥轮换**（v1.2.8）：HMAC 签名密钥存储在 `~/.sofagent-key`（权限 0600）。如需轮换（如安全审计要求或疑似泄露）：

```bash
# 1. 备份旧密钥（旧 hash chain 仍需此密钥验证）
cp ~/.sofagent-key ~/.sofagent-key.old.$(date +%Y%m%d)

# 2. 生成新密钥（openssl 32 字节随机）
openssl rand -base64 32 > ~/.sofagent-key
chmod 600 ~/.sofagent-key

# 3. 注意：轮换后旧 history.jsonl 的 HMAC 签名将无法用新密钥验证
#    --verify-chain 会报告旧条目签名不匹配（这是预期行为）
#    新条目将使用新密钥建立新的 hash chain
```

**审计备份说明**：sofagent 审计引擎**当前不自动生成** `history.jsonl.bak-*` 备份文件（SECURITY.md 早期版本描述的"达到大小阈值时生成备份"机制在代码中不存在）。`history.jsonl` 为 append-only 单文件，不覆盖、不轮换。如需备份，建议用外部 cron + `cp` 定期归档：

```bash
# 手动备份（建议加入 crontab）
cp ~/.sofagent/data/audit/history.jsonl ~/.sofagent/data/audit/history.jsonl.bak-$(date +%Y%m%d)
chmod 600 ~/.sofagent/data/audit/history.jsonl.bak-*
```

### 威胁模型：`SOFAGENT_DATA` 环境变量的信任边界（本版声明为已知风险）

`getHistoryFilePath()`（`engine/core/src/audit-history.ts`）解析审计历史路径时优先级为：**显式 dataDir 参数 > `SOFAGENT_DATA` 环境变量 > 默认 `data/audit/history.jsonl`**。写入侧（`appendHistory`）与校验侧（`checkHistoryChainDetailed`）均走此函数。

**设计初衷**：`SOFAGENT_DATA` 用于测试隔离（如 `loader.test.ts` 用 `vi.stubEnv('SOFAGENT_DATA', '')` 切换数据目录），属合理需求。

**信任边界与风险分级**：能设置目标进程环境变量的攻击者，可将审计历史重定向到任意路径——「写到别处 + 校验读别处」使篡改表面看起来正常。该风险**完全取决于部署场景**：

| 部署场景 | 风险等级 | 说明 |
|---------|:--:|------|
| 本地开发机 | 🟢 低 | 攻击者已能在本机设置环境变量 = 已拥有本机用户权限，游戏结束，审计重定向不构成额外提权 |
| CI / 共享服务器 | 🟡 中 | 同机其他用户/作业可能注入环境变量，审计历史可被悄悄重定向 |

**本版决策（方案 C · 声明而非改码）**：本版**不修改** `audit-history.ts` 的路径解析逻辑，仅在此明确声明信任边界。理由：① 本地低风险场景下白名单/固定路径会损害测试隔离与多实例部署的灵活性；② 共享服务器场景的正确防线是**环境隔离**（每用户独立 `~/.sofagent/`、CI 作业独立容器/沙箱、`env -i` 清洗环境），而非在审计引擎内做路径白名单（白名单本身也可被同权限攻击者绕过）。

**共享服务器缓解建议**：① CI 作业运行在独立容器/沙箱，环境变量不可跨作业注入；② 启动入口用 `env -i` 或显式白名单透传环境变量；③ 对 `history.jsonl` 所在卷做完整性监控（文件路径 + mtime 基线告警）。路径白名单校验（方案 A）与审计路径固定（方案 B）作为可选加固，列入 ROADMAP 评估。

### 已知绕过路径

| 绕过方式 | 检测手段 | 缓解 |
|----------|---------|------|
| `git commit --no-verify` | ❌ 无自动检测 | 定期 `--doctor` 检查未审计的 commit（`git log --grep` 匹配审计签名） |
| 删除 commit-msg hook 文件 | ⚠️ `--doctor` 可检测 | daemon 监控 .git/hooks/ 目录变化（v1.x 计划） |
| 伪造 Agent 日志（task/logs） | ❌ 无自动检测 | 人工抽查 + 交叉验证 git log 时间戳 |
| 绕过 --init 直接手动修改 config.yml | ❌ 无自动检测 | config hash 校验（见 fail-closed 改进） |
| `SOFAGENT_CONFIG` 环境变量指向恶意 config（v1.2.9 起最高优先级配置入口） | ⚠️ `--doctor` 可检测环境变量 | 启动入口用 `env -i` 或显式白名单透传环境变量（见共享服务器缓解建议）；CI 侧用受控 config |

> ⚠️ 以上绕过路径均依赖 Agent 的"自觉"——这是 sofagent 架构级别的信任模型选择：审计引擎是**协助**人类监督，不是**替代**人类监督。已知绕过路径详见 LIMITATIONS 已有信任模型描述。

> ⚠️ **企业高安全场景**：`config.yml` 篡改可绕过审计规则（如关闭规则、放宽阈值）。建议：① CI 侧独立校验 config 完整性（`sofagent-audit --diff` 兜底，hook 可绕 CI 不可绕）；② 文件权限锁（`chmod 600 .sofagent/config.yml`，仅受信用户可写）。与已有 `--no-verify` CI 兜底建议呼应。
>
> ⚠️ **企业高安全默认（v1.3.2 补充）**：基线规则（A1/A2/A9/A10/A11/A20-A23）有强制保护不可禁用，但**非基线规则（A3-A8、A14-A19）可经 `rules:{x:false}` 关闭**。高安全场景建议显式锁定所有规则：`extendedRulesEnabled: true` + 在 config 中对全部非基线规则显式 `rules:{a3:true, a4:true, ...}`（禁止依赖默认值），并配合 `chmod 444 .sofagent/config.yml` 只读锁定。
>
> 💡 **`hardenedMode` 配置项尚未实现**（代码中不存在此字段）——一键全规则基线化的便捷配置排入 ROADMAP 评估，当前需手动按上述方式逐条锁定。

> ⚠️ **影子审计器劫持（v1.2.7 已知风险）**：本地安装的 `engine/audit/dist/index.js` 无完整性校验（dist 目录不随 git 版本控制），恶意 Agent 可替换 dist 绕过所有审计规则——比 `--no-verify` 更隐蔽（hook 仍在运行，看不出绕过）。`--doctor` 已增加 dist 哈希校验（SHA-256 比对 `~/.sofagent/internal/audit-hash.txt`），但根治需 v1.3.x 代码签名 + 运行时验证。**CI 侧 `sofagent-audit --diff` 使用独立安装可缓解**（CI 环境的 dist 不可被开发机 Agent 篡改）。

### 详细缓解步骤

1. **CI 侧兜底（推荐）**：在 CI/CD pipeline 中独立运行 `sofagent-audit --diff HEAD~1..HEAD`（审最近一次 commit；审整个分支区间用 `--diff main..HEAD`），
   使用 CI 环境内受保护的 config.yml 副本，不依赖开发机上的配置文件。
2. **文件权限加固**：`chmod 444 .sofagent/config.yml` 将配置设为只读。
   注意：此方法不能防止 Agent 以 root/同用户身份强制写入，
   但能防止意外修改。
3. **完整性校验**：使用 `tools/sign-config.mjs` 对 config.yml 签名，
   定期运行 `sofagent-audit --doctor` 检查配置完整性。

> 💡 更多本地开发缓解措施详见 [LIMITATIONS.md → 本地开发紧急缓解措施](./docs/LIMITATIONS.md#本地开发紧急缓解措施)（chmod 400、git hooksPath、定期 doctor）。

**受影响场景**：
- 不上 CI 的小团队或个人项目（风险最高）
- Agent 具有文件系统写入权限的任何场景
- `sofagent-audit --init` 后未额外加固配置权限的场景

### Daemon 监控边界

sofagent daemon 是本地文件系统监控守护进程，其行为边界如下：

| 维度 | 说明 |
|------|------|
| **监控范围** | 仅 `data/` 工作目录 + 用户显式配置的路径（`config.yml` 中的 `daemon.watchPaths`）。不扫描用户其他文件。 |
| **数据去向** | 所有数据本地存储（`data/` 目录下），不上传云端，不向外发送网络请求——除非用户显式配置 TencentDB Memory 集成（`install.sh --with-memory`，opt-in）。 |
| **权限** | 只读监听文件事件（hash 变化检测 + cron 定时巡检）。**不修改用户文件、不删除文件、不外传数据**。审计发现写入 `daemon-health.json` 和 `history.jsonl`。 |
| **审计结果推送** | **v1.2.1 已支持 Webhook 推送**（飞书/钉钉/企微，`engine/audit/src/webhook.ts` + `engine/daemon/src/notify.ts` + `push-target.ts`）。企业 IT 可配置 `webhook` 字段实现实时告警推送。 |

> 💡 **企业集中收集（v1.2.1）**：v1.2.1 已支持 Webhook 推送（飞书/钉钉/企微），企业 IT 可配置 `webhook` 字段实现实时告警推送。如仍需集中收集审计日志（如用 Filebeat / Logstash / Fluentd 采集），可定时轮询 `data/audit/history.jsonl`（append-only、JSONL 明文），转发至 SIEM / 企业日志平台。注意 history.jsonl 为明文存储，转发前建议配合外部加密卷或 age 加密，避免敏感 diff 摘要外泄。

> daemon 源码见 `engine/daemon/src/`：`fs-watch.ts`（文件监听）、`cron.ts`（定时巡检）、`snapshot.ts`（快照）、`usb-detect.ts`（USB federation 检测，v1.1.4+）、`dream-cycle/`（Dream Cycle 6 阶段管道，v1.1.7+）、`inspectors/knowledge-health.ts`（知识健康巡检，v1.1.7+）、`commands/knowledge-status.ts`（知识状态聚合命令，v1.1.7+）、`federation/`（联邦查询，v1.1.8+）、`usb-signature.ts`（USB HMAC 签名，v1.1.9+）、`usb-key.ts`（USB key 创建，v1.1.9+）、`usb-runtime.ts`（USB 运行时启动，v1.1.9+）、`notify.ts`（统一通知接口，v1.1.3+）。

---

## 五、工程安全

### install.sh 行为说明

install.sh 是 sofagent 的一键安装脚本。以下是其完整行为清单，供安全审查：

#### 脚本会做的事

| 操作 | 路径 | 说明 |
|------|------|------|
| 创建目录 | `~/.openclaw/skills/sofagent/` 或 `~/.workbuddy/skills/sofagent/` | 按平台部署 Skill 文件 |
| 创建目录 | `${项目目录}/data/task/logs/` | 数据目录，权限 700 |
| 复制文件 | 宪法(fde.md) + 6 核心 Skill + 数据模板 + 配套脚本 | 从仓库 `SKILL/harness/` 和 `engine/scripts/` 复制到目标目录 |
| 写入配置 | `~/.openclaw/openclaw.json`（仅 OpenClaw） | 注册加载链 Hook |
| 写入配置 | `~/.openclaw/config.json`（仅 OpenClaw） | 注入 loopDetection 断路器 |
| npm install | `@langchain/langgraph`（编排引擎依赖） | Sub Agent 编排引擎 |
| 安装服务 | launchd(macOS) / systemd(Linux) | daemon 后台进程（交互确认后。daemon 当前为 bash 实现，正常运行中） |

#### 脚本不会做的事

- ❌ 不会 `sudo`——所有操作在用户权限范围内
- ❌ 不会改系统文件——不碰 `/etc`、`/usr`、`/System`
- ❌ 不会联网下载额外内容
- ❌ 不会执行远程脚本（`--remote` 模式只做 git clone 官方仓库）
- ❌ 不会收集或上传任何用户数据

#### 源码审查

install.sh 拆分为以下模块，便于逐模块审查：

| 模块 | 职责 |
|------|------|
| `install.sh` | 主入口（组装 + 参数解析） |
| `lib/config.sh` | 配置加载 + 常量定义 |
| `lib/daemon-lib.sh` | daemon 公共函数库 |
| `lib/daemon-register.sh` | Hook + daemon 注册 |
| `lib/file-deploy.sh` | 文件部署 |
| `lib/platform-detect.sh` | 平台探测 + 参数解析 |
| `lib/post-install.sh` | 安装后检查 + 输出 |

### 第三方依赖供应链

**@langchain/langgraph** 是 sofagent 编排引擎的正式依赖（提供 `createReactAgent`）。v1.2.0 起从 DeepAgents 迁移为正式依赖。

> 🔴 **Breaking Change（v1.0.7）**：ao（agency-orchestrator）已完全退役。v1.0.6 用户升级到 v1.0.7 后需手动卸载：`npm uninstall -g agency-orchestrator`。编排引擎已全面迁移到 LangGraph createReactAgent，ao 代码路径全部移除。

**供应链安全建议**：
- 每次 `npm install` 后运行 `npm audit`
- 内网环境建议预装 @langchain/langgraph 并验证安装通过后再部署

**automerge@1.0.1-preview.7 风险声明（v1.1.9）**：

`automerge@1.0.1-preview.7` 为 preview 版（非稳定版），API 可能在后续版本变更。截至 v1.2.7 复核，npm 仍无 stable（latest=2.0.0-alpha.3），uuid 弃用警告为已知观感问题；federation 功能不使用时该依赖路径不触达。daemon 精确锁定版本号（`"automerge": "1.0.1-preview.7"`，非 `^` 前缀）避免意外升级。如 automerge 发布 stable 版本或 breaking change，`engine/core/src/federation.ts` 的 `Automerge.change/clone/merge` 调用需重新验证。

**uuid@3.4.0 漏洞可利用性评估（GHSA-w5hq-g745-h8pq · v1.3.7 F13）**：

automerge preview 版传递依赖 `uuid@3.4.0`（2018 弃用），存在 `uuid()` 默认 RNG 可预测漏洞。评估结论：uuid v3 的漏洞面在 `uuid()` 默认 RNG 可预测——automerge 用它生成文档 ID，非安全凭据，实际可利用性极低。v1.3.x 将重新评估 automerge stable 升级路径或 federation 换用其他 CRDT（如 yjs）。

---

## 六、LLM API Key 透明度（v1.2.0）

FORGE fresh-eyes-loop 的 A/B sub-agent 需要 LLM API key。
本节说明 key 的存储、使用、边界。

### Key 存储位置

仅本地环境变量（用户自行配置）：

| 位置 | 适用场景 |
|------|------|
| `~/.zshrc` | macOS / Linux 默认 shell |
| `~/.bashrc` | Linux 备选 shell |
| 系统环境变量面板 | Windows |
| CI/CD secret injection | 自动化场景（推荐用 secret 管理服务，不走 `.env` 文件） |

代码库中**零硬编码 key**——`.env` 文件被 `.gitignore` 排除。

### Key 加载优先级（三级回退）

```
SOFAGENT_LLM_{ROLE}_API_KEY  >  SOFAGENT_LLM_API_KEY  >  OPENAI_API_KEY
   角色专用 key（A/B 分账）     通用 key（共用一把）     OpenAI 兼容默认
```

- `SOFAGENT_LLM_A_API_KEY`：A 角色（审查模型，用户自行配置）专用 key
- `SOFAGENT_LLM_B_API_KEY`：B 角色（工程模型，用户自行配置）专用 key
- `SOFAGENT_LLM_API_KEY`：A/B 共用一把 key（两个 provider 都是 OpenAI 兼容格式时可用）
- `OPENAI_API_KEY`：兜底默认（OpenAI SDK 标准环境变量）

### Key 使用边界

key 仅用于：

| 用途 | 说明 |
|------|------|
| 调用用户配置的 LLM API | GLM（`open.bigmodel.cn`）/ DeepSeek（`api.deepseek.com`）/ OpenAI 兼容 endpoint |
| 请求头鉴权 | `Authorization: Bearer <key>`，标准 HTTPS 请求 |

### Key 不做什么（四条红线）

- ❌ **不上传**到任何第三方服务（sofagent 无后端服务器，key 不离开本机）
- ❌ **不写入**任何日志文件（`usage.jsonl` 只记 token 数，不记 key）
- ❌ **不写入** git 历史（`.gitignore` 排除 `.env`）
- ❌ **不转发**给除目标 LLM 厂商以外的任何端点

### 验证方式

用户可自行扫描代码确认无硬编码 key：

```bash
# 扫描代码中的 key 硬编码（不应有结果）
grep -rnE "sk-[a-zA-Z0-9]{20,}" FORGE/src/ engine/
```

```bash
# 确认 .env 在 .gitignore 中
grep -n "\.env" .gitignore
```

```bash
# 确认 usage.jsonl 不含 key（只有 token 计数）
grep -i "api_key\|apikey\|sk-" runs/*/usage.jsonl   # 应无结果
```

---

## 报告漏洞

如发现安全漏洞，请通过以下方式**私下**报告（不要在公开 Issue 中披露）：

1. **GitHub Security Advisory**（推荐主通道）：[提交私有报告](https://github.com/KongFangXun/sofagent/security/advisories/new)
2. **邮箱**（备选）：kongfangxun@users.noreply.github.com
3. **响应时间**：我们承诺在 72 小时内确认收到报告，7 天内提供初步评估。

## 响应承诺

- **确认**：72 小时内确认收到报告
- **初步评估**：7 天内给出初步评估和影响范围
- **修复**：根据严重程度排期——高危（数据泄露/权限提升）优先修复并发布补丁版本

## 适用范围

本安全策略适用于 sofagent 项目仓库内的所有文件。第三方依赖（如 @langchain/langgraph、OpenClaw）的安全问题请向对应项目报告。

## 免责声明

sofagent 基于 MIT 许可证发布，按「现状」（AS IS）提供，不附带任何明示或暗示的担保。作者不对因使用本软件而产生的任何直接、间接、附带或后果性损害承担责任。sofagent 是审计引擎而非安全防线——它能检测常见的 Agent 违规模式，但不能保证拦截所有攻击向量。
