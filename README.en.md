# sofagent

[中文](./README.md) | English

> This is an abridged version. See [中文版](./README.md) for full documentation.

<p align="center">
  <img src="docs/assets/sofagent.png" alt="sofagent" width="160" />
</p>

<p align="center">
  <strong>sofa + agent = sofagent / 沙发特工</strong><br/>
  <em>It's not about connecting businesses to AI — it's about helping them use AI right.</em>
</p>

<p align="center" style="color:#64748B;font-size:14px;">
  Agent Harness Middleware + FDE Toolkit<br/>
  <strong>Giving everyone FDE capabilities</strong>
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.1.5-16B8F3" alt="Version" /></a>
</p>

---

> [!IMPORTANT]
> **Agents can work. Did they do it right? sofagent governs — 1 base + 4 engines, one system.**

🧭 Constraint Base · ⚙️ Orchestration · 🔍 Audit · 🔄 Restore · 🧬 Evolution (experimental)

---

## Contents

- [Why sofagent?](#why-sofagent)
- [Install](#install)
- [How FDE works](#how-fde-works)
- [vs. existing tools](#vs-existing-tools)
- [Does it work?](#does-it-work)
- [Built-in Agents](#built-in-agents)
- [Which do you need?](#which-do-you-need)
- [模板市场](#模板市场-the-reliable-foundation-for-enterprise-landing)
- [Further reading](#further-reading)

---

## Why sofagent?

Most SME AI projects collect dust within 6 months. It's not a tech problem — it's three patterns:

| Problem | What sofagent does |
|------|------|
| 🚫 Bought a pile of tools, don't know where to start | FDE onboards, maps workflows, identifies AI nodes, leaves |
| 🔧 Tech-led, business rules can't be written in code | fde.md uses business language ("don't touch customer data", "large transfers need approval") |
| 👻 Deploy and forget — things break unnoticed, stagnation, no accountability | Every change auto-audited + snapshotted + orchestrated + weekly inspection |

No consultants. No AI team. FDE onboards, deploys, leaves — the AI nodes keep running. Unlike AgentLoop (SaaS, runtime trajectory), sofagent audits **what changed** (file diff, local, MIT open source).

> [!IMPORTANT]
> 🔬 **Hugging Face benchmark**: same model, harness-only optimization — legal-agent score jumped from 3.5% to 80.1% (76-point gain, at ~1/7 the cost of Claude Sonnet). [Details](./docs/ARCHITECTURE.md)

---

## Install

```bash
npm install -g @sofagent/audit @sofagent/core && sofagent-audit --init
```

Three-step first experience:

```bash
# 1. See constraints — agents carry these rules
sofagent-audit --help | head -5

# 2. Run audit — --init installed a pre-commit hook, so every commit is scanned by A1
echo "API_KEY=sk-123456" > .env && git add -f .env && GIT_EDITOR=true git commit -m "test"
# → ⛔ A1 sensitive files: .env contains key pattern, commit blocked (never lands)

# 3. Check snapshots — auto-saved after every audit
sofagent-audit --timeline

# Cleanup after demo (A1 blocked the commit, no new commit): unstage and remove .env
git rm --cached -f .env 2>/dev/null; rm -f .env
```

> [!NOTE]
> Requires Node.js ≥ 18 + bash + git. Full macOS/Linux support, Windows experimental. [Full install guide](./docs/HANDBOOK.md)

### Uninstall

```bash
npm uninstall -g @sofagent/audit @sofagent/core @sofagent/orchestrator @sofagent/daemon @sofagent/mcp
# Remove the git hook installed by --init (in the current repo)
rm -f .git/hooks/commit-msg .git/hooks/post-commit
```

> [!NOTE]
> Packages are published to npm on each release. If `npm install -g` fails locally, use the in-repo script `sofagent/scripts/install.sh`.

---

## How FDE works

FDE does two things — map + identify, splits into two node types, then the base and four engines take over.

```mermaid
graph LR
    1["1️⃣ Map workflows"] --> 2["2️⃣ Identify AI nodes"]
    2 --> J["⚡ Augmented role<br/>AI assists, human decides"]
    2 --> K["🔄 Auto-execute<br/>AI runs, human audits"]
```

Step 2 is the key — not every step should be fully automated:

| Node type | How it runs | Human's role | sofagent's role |
|------|------|------|------|
| ⚡ **Augmented role** | AI navigates, suggests — rules describable | Decide, approve, sign off | Constraint keeps AI in bounds, audit logs every suggestion, restore enables rollback, evolution refines skills |
| 🔄 **Auto-execute** | AI runs end-to-end autonomously | Review audit reports, spot-check | All five components: constrain → orchestrate → audit → restore → evolve weekly |

No consultants. No AI team. FDE onboards, deploys, leaves — the AI nodes keep running.

> [!NOTE]
> 📖 Full FDE workflow: [FDE/FDE.md](./FDE/FDE.md)

### 1 base + 4 engines

> [!NOTE]
> 💡 **sofagent and Gateway**: Enterprise AI can't ship without a Gateway (unified entry/routing/orchestration/sessions).
> OpenClaw/DeepAgents IS your Gateway. sofagent doesn't replace it — it layers on top for governance.
> **The Gateway is the highway. sofagent is the traffic rules + speed cameras + driving coach.**

> [!NOTE]
> 💬 **sofagent has no UI. You talk to it, and it tells you where the result is.** Language is the interface. MCP is the entry point. See [Philosophy](./docs/PHILOSOPHY.md). Full MCP reference: [MCP Usage Guide](./docs/guides/mcp-usage.md).

> [!NOTE]
> 🔮 **v1.1.0 released**: Package purity refactor — audit just audits, 12 independent packages + lightweight multi-device. See [changelog](./docs/changelog/v1.1.0.md). 4 sync methods: [Multi-Device Sync Guide](./docs/guides/multi-device-sync.md).

#### 🧭 Constraint Base

Rules injected into agent context before work starts — so it knows the red lines.

```mermaid
graph LR
    A[Agent starts] --> B[SKILL.md<br/>Constitution · 4 rules + 7 principles]
    B --> C[fde.md<br/>Norms · enterprise rules]
    C --> D[think.md<br/>Reflection · past lessons]
    D --> E[knowledge/<br/>Knowledge base · auto-built]
```

Four-layer loading chain auto-injects on session start. Any platform — OpenClaw via Hook enforcement, other platforms via Agent Read. v1.0.7+ Sub Agents self-load constraints at startup (`buildConstrainedSystemPrompt`).

#### ⚙️ Orchestration engine

Decomposes large tasks, runs Sub Agents in parallel, compares A/B results for better approaches. FDE generates the workflow on onboarding; nodes run autonomously after that.

```mermaid
graph LR
    A[Task received] --> B[DeepAgents<br/>Decompose + match template]
    B --> C[Sub Agents<br/>parallel execution]
    C --> D[Multi-dimension eval]
    D --> E{A/B compare}
    E -->|New better| F[Auto-switch]
    E -->|Old better| G[Keep]
```

Powered by DeepAgents (v1.0.7, OpenClaw orchestration layer fully retired). `sofagent-orchestrator compose --task` CLI entry — **any Agent platform can use the orchestration engine**. See [ROADMAP](./ROADMAP.md).

> [!WARNING]
> Orchestration requires the separate `@sofagent/orchestrator` package (`npm install -g @sofagent/orchestrator`). The audit engine (`@sofagent/audit`) doesn't bind to OpenClaw and runs standalone; the orchestration engine needs the orchestrator package.

#### 🔍 Audit engine

Every git commit gets scanned — what the agent changed can't be denied.

```mermaid
graph LR
    A[AI Agent<br/>writes code] --> B[git commit]
    B --> C{sofagent<br/>audit engine}
    C -->|git diff scan| D[21 rule checks]
    D -->|violation| E[⛔ Block + log]
    D -->|clean| F[✅ Pass]
    E --> G[think.md<br/>auto-reflect]
    F --> H[Code in repo]
    G --> A
```

Doesn't trust the agent — trusts git diff hard evidence. **0 token cost — pure regex engine, no LLM calls.** Core rules inspect git diff only, no agent cooperation needed. v1.0.8+ adds filesystem audit via embedded isomorphic-git + daemon, covering non-developers too.

> [!NOTE]
> v1.1.0 splits audit into standalone `@sofagent/audit` package. v1.0.8+ embeds isomorphic-git + daemon file monitoring — no git commit needed for non-developers.

#### 🔄 Restore capability

Auto-snapshot after every audit — violations trigger notifications + rollback suggestions. When things go wrong, go back:

| Result | Auto action | What you see |
|------|---------|------------|
| ✅ PASS | Auto-snapshot saved | Silent |
| ⚠️ WARN | Saved + flagged | daemon-notice.md alert + optional Webhook |
| ❌ FAIL | Saved + rollback suggested | Webhook push + terminal red |

```bash
sofagent-audit --timeline          # Snapshot timeline
sofagent-audit --timeline --json   # JSON output
sofagent-audit --revert <SHA>      # Rollback to any snapshot
```

sofagent is a **dashcam**, not a security checkpoint — post-hoc audit + restore, platform-agnostic.

#### 🧬 Evolution engine (v1.0.8+ · experimental)

> [!WARNING]
> **Experimental feature**: A/B auto-promote is based on `consecutiveWins ≥ threshold` + `overallImprovement` guard; eval scoring relies on LLM self-grading (self-grading bias exists). Narrow eval sets may cause false promotions. For production, manually review promote decisions.

FDE Agent doesn't just deploy once — after deployment, it shifts into **continuous optimization**. Weekly automatic inspection of audit trends + reflections, catching degradation before it impacts production.

```mermaid
graph LR
    A[FDE Weekly Inspection] --> B[Read audit trends<br/>history.jsonl]
    B --> C[Analyze think.md<br/>recurring mistakes]
    C --> D[Check eval<br/>which node is degrading]
    D --> E{Issue found?}
    E -->|Yes| F[Generate optimization report<br/>Update rules / supplement knowledge]
    E -->|No| G[Mark "stable"]
    F --> A
```

| Mode | When | What |
|------|------|------|
| **deploy** | First install / major change | Map workflows → Identify AI nodes → Build knowledge base → Install toolkit |
| **sustain** | Weekly auto / manual trigger | Read audit trends → Analyze think.md → Generate optimization report → Update rules |

```bash
sofagent-orchestrator subagent run fde --mode sustain --task "Inspect all nodes"
```

The full loop: **Constrain → Orchestrate → Audit → Restore → Evolve**.

---

## vs. existing tools

| | sofagent | detect-secrets | pre-commit hooks |
|------|:--:|:--:|:--:|
| Secret detection | ✅ | ✅ | ❌ |
| Agent boundary violations | ✅ | ❌ | ❌ |
| Injection attack detection | ✅ | ❌ | ❌ |
| Process compliance | ✅ | ❌ | ❌ |
| Knowledge-base cross-domain | ✅ | ❌ | ❌ |
| Config deletion detection | ✅ | ❌ | ❌ |
| Setup | One command | One command | Manual rules |

---

## Does it work?

Install and run — no dependency on agent compliance:

| Dimension | Data | What it means |
|------|------|------|
| Audit stability | `npm test` all green — diff-parser / A1-A11, A14-A19, E1-E4 / reporter / init | Every code change is audit-checked, cannot be bypassed |
| Audit coverage | 21 rules (A1-A11, A14-A19 + E1-E4): secret leaks, boundary violations, injection, blind edits, knowledge-base access | Most common agent failure modes are caught |
| Platform coverage | git commit audit (developers) + daemon filesystem audit (non-developers) | Anyone's file changes get audited |
| License | MIT | Code, docs, templates — use freely |

---

## Built-in Agents (v1.0.7 introduced · infra Agent since v1.0.8)

| Agent | How to invoke | When it auto-triggers |
|------|------|------|
| **FDE Deployment Engineer** | `@sofagent-fde` | Suggests follow-up inspection after deployment |
| **Compliance Auditor** | `@sofagent-audit` | Every commit / FDE deployment / LOOP task completion |

> [!NOTE]
> `@sofagent-audit` is the `@sofagent/audit` npm package invoked as a Skill Agent; `@sofagent-fde` similarly comes from the FDE toolkit — same capability, available both as a CLI and as an Agent.

## Which do you need?

| Your scenario | Use |
|---------|------|
| Just block secret leaks | `npm install -g @sofagent/audit @sofagent/core` is enough |
| Full agent behavior management | Audit engine + harness base (sofagent/scripts/install.sh) |
| Automatic task orchestration | + orchestration engine (DeepAgents Sub Agent) |

> [!NOTE]
> ⚠️ **Current version (v1.1.5) coverage**: Developer roles (git commit audit) + non-developer roles (filesystem audit) — full coverage. Non-developer filesystem audit requires installing and running the `@sofagent/daemon` daemon.

### Dual-node deployment (v1.0.7+)

sofagent supports two node types — **Auto-running node** (OpenClaw full-stack) and **Personal enhancement node** (third-party Agent + sofagent, no OpenClaw needed). Full comparison table: [ARCHITECTURE — Dual-node architecture](./docs/ARCHITECTURE.md#双节点架构).

> [!NOTE]
> v1.0.7 Sub Agent constraint self-loading (`buildConstrainedSystemPrompt`) makes constraints platform-independent — Sub Agents read `.sofagent/` files at startup. Change your Agent platform, constraints stay.

---

## 模板市场: the reliable foundation for enterprise landing

Pure autonomous Agents are flexible but uncontrolled — random step-skipping, hallucination, and hard-to-trace end-to-end flows are fatal risks in low-tolerance business like credit-risk audit or accounts-payable approval. Yet **80% of enterprise landing scenarios are better served by Workflow** (predefined branches, tool-call order, DB/3rd-party calls): fixed execution trace, per-node monitoring, parallel speedup, near-zero hallucination.

sofagent's [模板市场](./模板市场/) uses a **hybrid architecture**: an outer Graph skeleton (`nextNodes` in `workflow.yml`) locks the end-to-end steps and keeps them traceable; inner nodes keep model autonomy (the node `prompt` is a ReAct Agent). You get Workflow's controllability plus local flexibility. Workflows mapped during FDE onboarding become reusable enterprise templates.

---

## Further reading

| You want | Read |
|---------|------|
| Install, use, FAQ | [HANDBOOK](./docs/HANDBOOK.md) |
| Design rationale | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| Security | [SECURITY](./SECURITY.md) |
| Known limitations | [LIMITATIONS](./LIMITATIONS.md) |
| Roadmap | [ROADMAP](./ROADMAP.md) |
| Contributing | [CONTRIBUTING](./CONTRIBUTING.md) |
| Enterprise deploy (FDE + Workflow) | [FDE/](./FDE/) \| [模板市场](./模板市场/) |

---

## Contributing

Issues and PRs welcome — especially the critical kind. [CONTRIBUTING.md](./CONTRIBUTING.md) · [Credits](./docs/THANKS.md)

> [!NOTE]
> sofagent is designed by KongFangXun. Code written by AI models, product decisions and final review by the author. Every release reviewed by an independent model.
