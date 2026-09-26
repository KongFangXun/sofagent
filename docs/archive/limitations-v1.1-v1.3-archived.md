# LIMITATIONS §九§十 · 已退役归档（2026-09-26）

> 来源：docs/LIMITATIONS.md §九「v1.1.7-v1.1.9 新功能局限」与 §十「FDE 交付物激活断裂带（v1.2.5-v1.3.0 已解决）」，退役裁定见当期文档退役检查（考古/已消解内容退出活文档）。FDE 激活链现役指南：[docs/guides/fde-activation-chain.md](../guides/fde-activation-chain.md)。

## 九、v1.1.7-v1.1.9 新功能局限

### Dream Cycle 知识质量依赖 LLM

**v1.4.5 真脑交付后更新**：Dream Cycle 6 阶段管道此前跑在 MockLLM 上（占位符文本——格式正确但内容为零），v1.4.5 起接入真 LLM Provider（`real-provider.ts`——模型注册表/环境变量解析 + callModelAPI 复用 + 显式降级语义）。质量防御已工程化：extract/synthesize 产出过「非占位符」三轴校验（长度/信息量溯源/与 MockLLM 输出差异度——`quality-gate.ts`），占位符级产出被拦截不进知识库；模型不可用时显式降级（status 标 `mock` 进周报与 evolution report），「占位符跑 7 天」永不默默发生。**残余局限**：知识质量的本质上限仍依赖模型能力——三轴门槛能拦「正确的废话」，不能保证产出有洞察的知识；冷启动阶段（task logs 不足）提炼出的概念仍可能高度重复或过于泛化；泛化复述的判定边界（硬信息标记 + 溯源）是启发式而非语义级，存在漏放与误拦两侧的误差面。

### sensitivity 标注质量

public / internal / restricted 三级安全分级缺省 internal。安全分级系统的致命弱点不在实现，在标注质量——开发者写 frontmatter 时不会逐条思考分级，99% 页面走缺省值。Dream Cycle 自动生成的 concept.md 如果缺省标 public，restricted 知识可能通过联邦查询泄露到不信任的 peer。联邦层有 peer 端 + 本地端二次校验，但二次校验依赖标签准确性——标签本身错了，校验也防不住。

### USB 完整运行时信任根

U 盘本身即信任根——`federation.json` 的 `key` 字段（AES-256 解密密钥）存在 U 盘上。拿到 U 盘 = 拿到 knowledge 解密能力。防的是「丢盘后被读」（加密 + HMAC 签名），不防「拿到盘的人」（拿到盘 = 合法用户）。HMAC key 如与 `federation.json` 同介质存储，可被伪造（SECURITY.md 已声明此限制）。

### knowledge-health 治理悖论

巡检器检测 5 类问题（矛盾 / 孤儿 / 死链 / 过期 / 重复）但只生成报告不自动修复。warning 级 = 「知道有问题但不紧急」，在 daemon 语境里意味着永远不会被修——除非人来看报告。只建议不修复的巡检器面临治理悖论：越用越觉得「知道有问题就够了」，但问题不会自己消失。

### A/B 自动调度 promote 风险

ab-scheduler 连续 2 轮更好即 promote。如果 eval 场景偏窄（只测了简单 case），promote 的版本在复杂场景下可能更差。已有 `overallImprovement > 0` 守卫，但窄 eval 集的局限性无法靠代码解决——需要人工定期审查 promote 历史，确认 eval 集是否覆盖了真实业务场景的复杂度。**v1.3.2 缓解**——企业专属 eval 套件（金融/制造/供应链行业模板）扩充 eval 覆盖面，窄 eval 风险降低。

---

## 十、FDE 交付物激活断裂带（v1.2.5-v1.3.0 已解决）

### 大断裂带

FDE 诊断完成后，交付了一堆**静态文件**（ontology 本体数据 + workflow.yml + skills/ + nodes/），但没人把它们「点燃」——企业 IT 拿到一堆 .md 和 .yml，不知道怎么跑起来。

这是 FDE 四阶段十二步流程中的**交付到运行之间的断裂带**：

```
FDE §7 交付（静态文件就绪）
  ↓
  🔴 大断裂带：交付物躺在磁盘上
  ↓
理想终态：企业工作流自动运行（v1.2.5+ 激活链解决）
```

### 现有零件

轨道铺好了（registry.ts 从 v1.0.8 起就支持从 `.sofagent/subagents/` 动态注册），但只有 4 节自有车厢，企业车厢造好了没挂上去——缺的是往 registry 里写企业 Agent 的自动化流程。

| 零件 | 已有能力 | 缺什么 | 解决版本 |
|------|---------|--------|---------|
| registry.ts | 动态注册 `.sofagent/subagents/*.yml` | 没人往里写企业 Agent | v1.2.5 activate.ts |
| workflow-parser.ts | YAML → SubAgent 映射 | 映射表写死 4 个内置 Agent | v1.2.6 扩展 enterprise 类型 |
| composer.ts | LangGraph createReactAgent 通用拆解 | 缺「读 FDE 交付物 → 企业专属编排」 | v1.2.7 composeEnterpriseWorkflow |
| dag-runner.ts | 按 DAG 依赖跑 SubAgent | 只跑内置 Agent，缺 HITL | v1.2.8-v1.2.9 企业 Agent + HITL |

### 解决方案：激活链四阶段

| Phase | 版本 | 核心交付 |
|-------|------|---------|
| ACTIVATE | v1.2.5 | activate.ts：读交付物 → 注册企业 SubAgent |
| ORCHESTRATE | v1.2.6-v1.2.7 | 映射表扩展 + composeEnterpriseWorkflow + StateGraph |
| EXECUTE | v1.2.8-v1.2.9 | dag-runner 企业 Agent + HITL + 审计集成 |
| SUSTAIN | v1.3.0 | 全闭环验证 + wrapToolCall 联动 |

> 详见 [激活链设计文档](../guides/fde-activation-chain.md)。

### 当前状态

- **v1.2.5 前**：大断裂带存在，FDE 交付物需人工解读
- **v1.2.5 后**：ACTIVATE 已交付，activate 命令可注册企业 Agent
- **v1.2.8 后**：ORCHESTRATE + EXECUTE 前半已交付，企业 Agent 可编排 + 运行 + 每步审计
- **v1.3.0（已交付）**：全链路打通（SUSTAIN），企业工作流自运转
