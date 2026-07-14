# sofagent

[中文](./README.md) | English

> This is an abridged version. See [中文版](./README.md) for full documentation.

<p align="center">
  <img src="docs/assets/sofagent.png" alt="sofagent" width="160" />
</p>

<p align="center">
  <strong>sofa + agent = sofagent / 沙发特工</strong><br/>
  <em>We don't just "connect AI" — we help businesses "use AI right."</em>
</p>

<p align="center" style="color:#64748B;font-size:14px;">
  Agent Harness Middleware<br/>
  Constrain · Audit · Restore · Orchestrate · Evolve — full Agent lifecycle governance
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.0.9-16B8F3" alt="Version" /></a>
</p>

---

**The Gateway routes, sofagent governs — five engines, one system.**

🧭 Constraint Base · 🔍 Audit Engine · 🔄 Restore Engine · ⚙️ Orchestration · 🧬 Evolution

---

## Why sofagent?

Most SME AI projects collect dust within 6 months. It's not a tech problem — it's these three walls, each with a solution:

| Wall | The real fear | sofagent solution | Engine |
|:--|------|------|------|
| 🚫 **Expectations** | Bought a pile of tools, don't know where to start | FDE onboards, diagrams the business, identifies AI nodes, leaves | 🧭 Constraint + 🧬 Evolution |
| 🔧 **Tech-led** | Engineers can't see business nodes, constraints written in code | fde.md uses business language ("don't touch customer data", "large transfers need approval") | 🧭 Constraint |
| 👻 **Deploy & forget** | Broke things unnoticed, stagnant after 6 months, no one accountable | Every change auto-audited + snapshotted + rollback; orchestration decomposes and parallelizes; weekly inspection catches degradation | 🔍 Audit + 🔄 Restore + ⚙️ Orchestration + 🧬 Evolution |

No consultants. No AI team. FDE onboards, deploys, leaves — the AI nodes keep running. Unlike AgentLoop (SaaS, runtime trajectory), sofagent audits **what changed** (file diff, local, MIT open source).

---

## Install

```bash
npm install -g @sofagent/audit && sofagent-audit --init
```

Three-step first experience:

```bash
# 1. See constraints — agents carry these rules
sofagent-audit --help | head -5

# 2. Run audit — change a file and see
echo "API_KEY=sk-123456" > .env && git add .env && git commit -m "test"
# → ⛔ A1 sensitive files: .env contains key pattern, commit blocked

# 3. Check snapshots — auto-saved after every audit
sofagent-audit --timeline
```

> Requires Node.js ≥ 18 + bash + git. Full macOS/Linux support, Windows experimental. [Full install guide](./docs/HANDBOOK.md)

---

## How FDE works

FDE does two things — map + identify, then the engines take over.

```mermaid
graph LR
    1["1️⃣ Map workflows"] --> 2["2️⃣ Identify AI nodes"]

    2 --> E["🧭 Constraint Base"]
    E --> F["🔍 Audit Engine"] --> G["🔄 Restore Engine"] --> H["⚙️ Orchestration"] --> I["🧬 Evolution"]

    H --> J["⚡ Augmented role<br/>AI assists, human decides"]
    H --> K["🔄 Auto-execute<br/>AI runs, human audits"]
    G -.-> |rollback| E
```

Step 2 is the key — not every step should be fully automated:

| Node type | How it runs | Human's role | sofagent's role |
|------|------|------|------|
| ⚡ **Augmented role** | AI navigates, suggests — rules describable | Decide, approve, sign off | Harness keeps AI in bounds, audit logs every suggestion |
| 🔄 **Auto-execute** | AI runs end-to-end autonomously | Review audit reports, spot-check | All five engines: constrain → orchestrate → audit → restore → evolve |

No consultants. No AI team. FDE onboards, deploys, leaves — the AI nodes keep running.

### Five engines

> 💡 **sofagent and Gateway**: Enterprise AI can't ship without a Gateway (unified entry/routing/orchestration/sessions).
> OpenClaw/DeepAgents IS your Gateway. sofagent doesn't replace it — it layers on top for governance.
> **The Gateway is the highway. sofagent is the traffic rules + speed cameras + driving coach.**

> 🔮 **v1.1.0 preview**: Package purity refactor — audit just audits, 10 other packages go independent.

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

#### 🔍 Audit engine

Every git commit gets scanned — what the agent changed can't be denied.

```mermaid
graph LR
    A[AI Agent<br/>writes code] --> B[git commit]
    B --> C{sofagent<br/>audit engine}
    C -->|git diff scan| D[19 rule checks]
    D -->|violation| E[⛔ Block + log]
    D -->|clean| F[✅ Pass]
    E --> G[think.md<br/>auto-reflect]
    F --> H[Code in repo]
    G --> A
```

Doesn't trust the agent — trusts git diff hard evidence. Developers install a commit-msg hook for code audits. **v1.0.8+ adds filesystem audit** — embedded isomorphic-git + daemon file monitoring means non-developers get audited too.

> v1.1.0 splits audit into standalone `@sofagent/audit` package.

#### 🔄 Restore engine

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

#### ⚙️ Orchestration engine

Decomposes large tasks, runs Sub Agents in parallel, compares A/B results for better approaches. FDE generates the workflow on onboarding; nodes run autonomously after that.

```mermaid
graph LR
    A[Task received] --> B[DeepAgents<br/>Decompose + match template]
    B --> C[Sub Agents<br/>parallel execution]
    C --> D[Multi-dimension scoring]
    D --> E{A/B compare}
    E -->|New better| F[Auto-switch]
    E -->|Old better| G[Keep]
```

Powered by DeepAgents (v1.0.7, ao fully retired). `sofagent-audit compose --task` CLI entry — **any Agent platform can use the orchestration engine**. See [ROADMAP](./ROADMAP.md).

#### 🧬 Evolution engine (v1.0.8+)

FDE Agent doesn't just deploy once — after deployment, it shifts into **continuous optimization**. Weekly automatic inspection of audit trends + reflections, catching degradation before it impacts production.

```mermaid
graph LR
    A[FDE Weekly Inspection] --> B[Read audit trends<br/>history.jsonl]
    B --> C[Analyze think.md<br/>recurring mistakes]
    C --> D[Check scoring<br/>which node is degrading]
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
sofagent-audit subagent run fde --mode sustain --task "Inspect all nodes"
```

Five engines, one loop: **Constrain → Orchestrate → Audit → Restore → Evolve**.

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

> 🔬 Hugging Face legal-agent benchmark: same model, harness-only optimization — score jumped from 3.5% to 80.1% (76-point gain, matching Claude Sonnet at 1/7 the cost). [Details](./docs/ARCHITECTURE.md)

Install and run — no dependency on agent compliance:

| Dimension | Data | What it means |
|------|------|------|
| Audit stability | `npm test` all green — diff-parser / A1-A17 / reporter / init | Every code change is audit-checked, cannot be bypassed |
| Audit coverage | 19 rules: secret leaks, boundary violations, injection, blind edits, knowledge-base access | Most common agent failure modes are caught |
| Platform coverage | git commit audit (developers) + daemon filesystem audit (non-developers) | Anyone's file changes get audited |
| License | MIT | Code, docs, templates — use freely |

---

## Which do you need?

| Your scenario | Use |
|---------|------|
| Just block secret leaks | `npm install -g @sofagent/audit` is enough |
| Full agent behavior management | Audit engine + harness base (install.sh) |
| Automatic task orchestration | + orchestration engine (DeepAgents Sub Agent) |

### Dual-node deployment (v1.0.7+)

sofagent supports two node types:

| Node type | For whom | OpenClaw | Orchestration | Constraints |
|---------|--------|:--:|------|------|
| **Auto-running node** | Enterprise unattended devices | ✅ Required | OpenClaw API | Hook injection |
| **Personal enhancement node** | Individual developers (WorkBuddy/Codex/Claude Code) | ❌ Not needed | `sofagent-audit compose --task` CLI | Sub Agent self-load |

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
| Enterprise deploy (FDE + Workflow Hub) | [FDE/](./FDE/) \| [Workflow Hub](./workflow-hub/) |

---

## Contributing

Issues and PRs welcome — especially the critical kind. [CONTRIBUTING.md](./CONTRIBUTING.md) · [Credits](./docs/THANKS.md)

> sofagent is designed by KongFangXun. Code written by AI models, product decisions and final review by the author. Every release reviewed by an independent model.
