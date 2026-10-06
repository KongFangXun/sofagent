# UI 层审计可行性评估报告（v1.5.7 · 不实做 · 只评估）

> **定位**：[v1.5.7 第二章](../changelog/v1.5/v1.5.7.md)交付——UI 层审计前置评估。**结论两态预定**：本版不实做，只评估。实做窗口按版本边界纪律判定：多模态证据模型扩展的 `v2.x` 承接窗口已关闭（[v2.0.0 第七章](../changelog/v2.0/v2.0.0.md) §七 B 表），浏览器四件套随之退役删除（本报告落盘即触发底座处置）。
>
> **报告口径**：描述「现状」时区分两态——①**已退役的历史能力**（Agentic Browser，v1.5.7 退役，本报告按历史形态记述）；②**仍在役的现役能力**（dsh-vision 视觉降级三件，v1.5.7 章二迁出至 `engine/orchestrator/src/refine-agent/image-meta.ts` 保留）。

---

## 一、多模态链路现状

### 1.1 已退役：Agentic Browser（v1.3.9 引入 · v1.5.7 退役）

**历史形态**（v1.3.9 交付七——v1.4.0 交付十扩展为公共 API）：Refine Agent 跑质量规则集时，部分场景声明 `requires_browser` 即驱动浏览器验证 UI 行为，闭环覆盖到 UI 层。链路四段：

| 段 | 历史组件（已删除） | 说明 |
|---|---|---|
| 驱动注入 | `BrowserDriver` 接口（navigate/click/screenshot/assert 四操作） | 生产接 `@playwright/test` 的 page；测试/CI 用 headless stub（CI 约束：不下载浏览器二进制，pr-check 会超时） |
| 会话包裹 | `BrowserSession` 类 + 四个 `playwright_*` 包装（navigate/click/screenshot/assert） | 每次操作经 `BrowserAuditSink` 落运行时审计条目（tool/args/result/summary——与 wrapToolCall 统一通道语义），异常也落 error 不静默 |
| 规则触发 | `ruleSetRequiresBrowser` / `createBrowserSessionForRules` | 规则集任一规则声明 `requires_browser` 即启用会话 |
| 截图分析 | `analyzeScreenshot`（经可注入 `VisionFn` 图文混合输入） | visionFn 可用直读（multimodal 态）；不可用/失败走降级（degraded 态） |

**退役时间线**（两级退役）：

- **MCP 面**（2026-09-26，v1.5.3）：四件套 `playwright_navigate/click/screenshot/assert` 从 registry 注销（107→103）——[v2.0.0 §七 B 表](../changelog/v2.0/v2.0.0.md)裁定。
- **实现底座**（本版 v1.5.7 章二）：`browser-tools.ts`（260 行）+ 其单测（204 行）+ `index.ts`/`domain/fde.ts` 的 `@public` 导出删除，`BrowserSession`/`BrowserDriver`/`BrowserAuditSink`/`BrowserSessionFactory` 四符号从 `public-api-baseline` 吊销（breaking，CHANGELOG 已发公告）。`playwright` optionalDep 已于 MCP 面退役时清除。

**为什么退役**：UI 审计的实做窗口按版本边界纪律已关闭；「日后重开即复用」不构成保留理由（用户拍板「该删的就删掉」），历史版本可自取（v1.4.x tag）。维护成本（CI stub、审计 sink 对齐、公共 API 基线占位）持续发生而消费面为零。

### 1.2 现役：dsh-vision 视觉降级三件（v1.5.7 迁出保留）

属 v1.3.9 交付七的 **dsh-vision 视觉降级本体**、非四件套，v1.5.7 章二先行迁出至 `engine/orchestrator/src/refine-agent/image-meta.ts`，`@public` 导出与基线条目**保留不变**（改指新模块）：

| 能力 | 形态 | 现役语义 |
|---|---|---|
| `readImageMeta` | 零依赖 PNG IHDR / JPEG SOF0 手工头解析 | 宽/高/字节三值元信息，无第三方依赖 |
| `degradeImageToText` | 颜色直方图（字节级 16 桶采样）+ 亮暗占比 + OCR 注入位 | 视觉模型/网关不支持图片输入时的退化工具链——结构化文本交回文本模型推理；OCR 标注 `unavailable`（无内置 OCR 依赖，如实标注） |
| `analyzeScreenshot` | 截图 → 多模态分析（可注入 `VisionFn`） | visionFn 可用直读（mode=multimodal）；不可用/失败自动降级不抛（mode=degraded）——分析必须可用 |

**现状判断**：这三件是「图片 → 结构化文本」的单向降级链，**不是** UI 审计执行面——没有浏览器驱动、没有 UI 行为断言、没有取证编排。UI 层审计若实做，需重建执行面（退役的 Agentic Browser 历史形态可自 v1.4.x tag 取回作参考），现役三件仅承担其中「截图后分析」一段。

## 二、UI 证据入 history.jsonl 的 schema 扩展草案（设计 · 不实做）

现役 `AuditHistoryEntry`（`engine/audit/src/audit-history.ts`）以文本证据为核心：`ruleResults: RuleCheck[]` 承载逐规则判定，`diffRange`/`commitSha`/`treeSha` 锚定代码面，HMAC 链（`prevHash`/`hmacSig`/`envFingerprint`）保证防篡改。若未来引入 UI 证据，需扩展**证据类型标记**——草案如下（仅设计，本版不落任何代码）：

```ts
// 草案：AuditHistoryEntry 新增可选字段（向后兼容——旧记录无此字段语义不变，
// 与 agentId/actionGovernance 等既有可选扩展字段同模式）
interface AuditHistoryEntry {
  // ... 现役字段不动 ...
  /** UI 层证据组（可选——仅 UI 审计场景写入；HMAC 链校验只依赖链字段，
      新增业务字段天然兼容，先脱敏再签名语义不变） */
  uiEvidence?: UiEvidence[];
}

interface UiEvidence {
  /** 证据类型判别器：'screenshot'（截图）| 'dom-snapshot'（DOM 快照）| 'interaction-log'（操作序列回放） */
  evidenceType: 'screenshot' | 'dom-snapshot' | 'interaction-log';
  /** 证据落盘相对路径（图片/快照不内嵌 jsonl——审计主链保持文本行，二进制走旁路文件 + 此处引用 + 内容指纹） */
  artifactPath: string;
  /** 证据内容指纹（SHA-256）——旁路文件防篡改锚（主链 HMAC 不覆盖旁路文件，须自带指纹） */
  artifactHash: string;
  /** 采集时刻（ISO 8601）——与条目 timestamp 分离，一图一时刻 */
  capturedAt: string;
  /** 关联规则 id（对齐 ruleResults[].id——证据可回指判定） */
  ruleId?: string;
  /** 分析模式（复用现役 ScreenshotAnalysis 语义）：'multimodal'（视觉模型直读）| 'degraded'（工具层降级） */
  analysisMode?: 'multimodal' | 'degraded';
  /** 分析产出摘要（multimodal=模型描述；degraded=结构化文本）——全文走 artifact，此处只放结论性摘要 */
  analysisSummary?: string;
}
```

**设计要点**：

1. **二进制不进主链**——history.jsonl 是逐行 JSON 文本 + HMAC 挂链，截图内嵌会破坏行粒度与脱敏管线；走旁路文件 + `artifactHash` 指纹锚定。
2. **判别器先行**——`evidenceType` 字段是本草案的核心扩展位，先截图（`screenshot`）后可扩展 DOM 快照与操作回放，读侧按判别器分派。
3. **向后兼容三保险**——可选字段 + HMAC 链只依赖链字段 + 先脱敏再签名，与 `agentId`（v1.3.1）/`treeSha`（v1.4.8）等既有扩展同模式，旧记录零迁移。

## 三、截图审计 token 成本测算（量级估算）

**估算口径声明**：以下为经验值量级估算（非实测）——视觉 token 按主流多模态 API「图像按面积折算 token」的公开经验值（约每 512×512 切片 ≈ 数百 token 量级，不同厂商 85～170 token/切片不等）取中位；文本侧按本仓 audit 链路现行单条记录规模（数百 token/条）估算。**未跑任何真实计费 API**，数字用于量级判断而非预算承诺。

| 场景（单次审计会话） | 证据件数 | 视觉 token（multimodal 直读） | 文本 token（degraded 降级） | 量级判断 |
|---|---|---|---|---|
| 单规则单页截图 | 1 张 1080p | ≈ 1k～2k token/张（按切片折算） | ≈ 300 token（结构化文本） | 单次可忽略 |
| 全链路 UI 回归（10 页 × 3 状态） | 30 张 | ≈ 30k～60k token | ≈ 9k token（30 × 300） | 单次显著、高频累积可观 |
| 失败重试 + 历史对比（×2 冗余） | 60 张 | ≈ 60k～120k token | ≈ 18k token | 高频场景下成本与文本审计主链相当甚至反超 |

**成本结论**：multimodal 直读的成本是 degraded 降级的约 5～10 倍（1k+ vs 300 token/件）；高频 UI 回归若全量走 multimodal，视觉 token 开支将反超现有文本审计主链。若未来实做，成本面建议：默认走 degraded 降级（现役三件零 API 成本）、仅 FAIL 判定存疑时升级 multimodal 复核（分级证据策略）。

## 四、结论（两态）

| 项 | 结论 |
|---|---|
| **本版实做** | **否**——UI 层审计不在 v1.5.7 范围（第二章定位即「不实做 · 可行性报告」）；多模态证据模型扩展的 `v2.x` 承接窗口已关闭（[v2.0.0 §七](../changelog/v2.0/v2.0.0.md)） |
| **浏览器四件套** | **随本报告退役删除**（实现底座 + 公开面 4 符号吊销，breaking 已公告；MCP 面已于 2026-09-26 注销） |
| **dsh-vision 三件** | **保留**（迁 `image-meta.ts`，`@public` 与基线不变）——图片元信息/降级分析是通用能力，消费面不限于 UI 审计 |
| **schema 草案** | `evidenceType` 扩展字段草案落本报告（§二），**不落代码**——未来若重开，按草案向后兼容三保险落 `AuditHistoryEntry` |
| **成本面** | 降级优先、multimodal 分级复核（§三）——重开时的默认策略建议 |

---

*落盘：v1.5.7 章二施工批 · 相关：[v1.5.7 开发日志](../changelog/v1.5/v1.5.7.md)第二章 · [v2.0.0 §七 B 表](../changelog/v2.0/v2.0.0.md)（退役裁定）*
