<p align="center">
  <img src="docs/assets/banner.png" alt="sofagent" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <!-- ⚠️ bump version: manually sync this badge version (Version-vX.Y.Z) -->
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.4.2-16B8F3" alt="Version" /></a>
</p>

<p align="center"><sub>[简体中文](./README.md) | [English](./README.en.md)</sub></p>

> 🚀 **v1.4.2** — Training engine: data & evaluation (pipeline / versioning / eval loop / environment / dry-run / report) + FDE six engines + IM bridge + FORGE data-flow foundation. See [CHANGELOG](./CHANGELOG.md).

---

## What is this

**An open-source FDE Harness layer.** The AI-deployment engineer for one-person companies and SMBs — never sleeps, never leaves, and carries its own auditor. It sits **between mature Agents (executors: DSH / OpenClaw / WorkBuddy) and the model layer (intelligence sources: general LLMs + bespoke/small post-trained models)**, governing both sides. Shipped as **FDE plugins + Skill + MCP + CLI + Dashboard**: on entry, map the business flow clearly, build the ontology graph, deploy the AI nodes in place; on departure, audit every change and keep optimizing.

sofagent does not build its own Agent — execution is delegated to mature hosts (model + tools + sessions). What it delivers is the **FDE Harness layer**. **FDE Harness = FDE methodology × Harness engineering** — the forward-deployed engineer's playbook (map on entry → deploy → depart) baked into a Harness constraint layer (inject · audit · rollback · evolve) that slots into any existing Agent; and it keeps every model (general or bespoke) under control (register / rollout / train / deploy fully audited).

> 🏞️ Big tech hands you "water" (foundation models) and "riverbeds" (Agent platforms) — but the water is raw, and you don't dare drink it straight. sofagent is the engineering that makes the river usable for a whole city: dams keep the water from flooding, treatment plants turn raw water into drinking water, and pipe networks deliver it to every faucet. Models supply 90% of the intelligence; sofagent supplies the 10% of reliable execution.

### Should you install it?

| If you are... | Recommendation |
|---------------|----------------|
| **Adding discipline to an existing Agent** — you already run DSH / OpenClaw / WorkBuddy and want your AI to behave, leave traces, and stay roll-backable when things go wrong | ✅ **Install now**. The core value is exactly the constraint layer (inject · audit · rollback · evolve) — works right after installation |
| **A one-person company / SMB landing AI** — no dedicated engineer, you need a "never-quitting FDE" to map your business flow and deploy AI nodes | ✅ **Install now**. The FDE Harness layer is built for this — the full journey from mapping to deployment to post-departure audit |
| **Looking for a turnkey enterprise Agent platform** — you expect a complete commercial product (multi-tenancy, permission management, billing, SLA) | ⏸️ **Hold off**. sofagent is a governance layer, not a platform product — platform-grade capabilities are out of this open-source repository's scope. Teams with integration capacity can still embed the constraint layer into their own platform as its governance module; if you need pure turnkey, look at platform products elsewhere |
| **Researching / curious about constraint-layer design** — reading code, studying architecture, borrowing methodology | ✅ **Install now**. Full documentation ([HANDBOOK](./docs/HANDBOOK.md) / [ARCHITECTURE](./docs/ARCHITECTURE.md) / [PHILOSOPHY](./docs/PHILOSOPHY.md)), MIT licensed |

## Core Features

- 🧭 **Map the business flow on entry** — five-element deep-dive + three-question triage, capturing every role's process steps and pricing out what each AI node is worth
- 🤖 **Deploy AI nodes** — three-layer deliverables (documents + Skills + runtime), installed into your existing AI tools; from "you do the work" to "you delegate the work"
- 🏠 **Stay resident after departure** — the FDE capability remains for inspection, audit, and optimization, 7×24 online guardian (audit triggers on commit); the human leaves, governance doesn't
- 🔍 **Zero-setup audit** — `npx -y -p @sofagent/audit sofagent-audit`, auditing the latest commit of any git repo in seconds (single-machine measured: quick ~1.1s, 50k-line diff ~6.1s; see [HANDBOOK](./docs/HANDBOOK.md))
- 🧱 **24 audit rules + 79 MCP tools** — secret leaks, out-of-scope edits, injection defense, privilege red lines; judged on git diff hard evidence, violations blocked on the spot (once a critical-layer rule hits, remaining rules are skipped — fail-fast design); evidence is based on local diffs — trust boundaries and known bypass surfaces in [LIMITATIONS §3](./docs/LIMITATIONS.md) (quick runs 17 by default; full 24 = 17 default + 7 extensions)
- 🛡️ **Automatic snapshot rollback** — auto-archived after every audit, one-click restore to any snapshot when something breaks

## What is the FDE Harness

**FDE = Forward Deployed Engineer** — the person who embeds models into real enterprise operations. sofagent turns this role into an open-source FDE Harness layer, sitting between the Agents you already have (DSH / OpenClaw / WorkBuddy) and the model layer, walking a full FDE business flow through four phases: **map the business flow → build dual graphs → deploy AI nodes → continuous optimization after departure**. Dual graphs = business graph (system boundaries, data flows) + ontology graph (shared semantic foundation), turning the enterprise into a machine-readable structure; after the FDE leaves, 7×24 inspection, audit, and optimization continue (audit triggers on change events such as commits) — the human leaves, governance doesn't.

<p align="center"><img src="docs/assets/arch-layers-en.svg" alt="sofagent three-layer positioning: model layer → FDE Harness layer → Agent layer" width="85%" /></p>

**Why the FDE Harness**

- **The bottleneck for enterprise AI is deployment, not the model** — mapping workflows, drawing system boundaries, and setting data rules is precisely the FDE's job. MIT NANDA's *The GenAI Divide*: 95% of enterprise GenAI projects failed to produce value worth a financial statement, while FDE job postings surged 729% in a year (verification in [VALIDATION](./docs/VALIDATION.md))
- **Completeness comes from the union** — DSH solves "can work"; sofagent solves "keeps working"; only together do they make a complete FDE Harness (next chapter)
- **"Continuous optimization" only holds with a constraint layer** — backed by auditable, rollback-capable mechanisms, not promises in prompts. Independent external experiment (ARC-AGI-3): optimizing only the outer Harness around the same model significantly lifts task completion. Verification in [VALIDATION](./docs/VALIDATION.md) · [THANKS](./docs/THANKS.md)
- **Capabilities are portable, never dead-bound to a platform** — the constraint layer is platform-agnostic; the methodology follows the business, not the platform

> 🔄 **Self-bootstrapping**: sofagent's first FDE engagement is sofagent itself — the project is a complete FDE business flow (map → build → deploy → depart), and this open-source repository is that deliverable.

## v1.4.2: Training Data & Evaluation + Six FDE Engines

🚀 Make training **eat real data and prove its worth** — enterprise heterogeneous data (CSV/Excel/DB/API) flows through an ingestion pipeline into training sets (quality gates + redaction) · dataset_version ledger (frozen fingerprint + resume version lock) · in-training eval loop (externalized thresholds) · train env/doctor health checks · dry-run VRAM estimation + ScaleRL compute extrapolation · training reports (customer-readable + quantified ROI); the FDE methodology becomes executable engines: fde_interview/classify/quantify/derive/distill/deploy as six MCP tools + IM-bridge remote command. MCP 67→**76** tools, tests 3202→**3349** (workspace 12-package scope). Full details in the [devlog](./docs/changelog/v1.4/v1.4.2.md) · earlier versions in [CHANGELOG](./CHANGELOG.md).

## Multi-platform Mounting

Sits between the Agents you already use and the model layer — it doesn't replace the model, only adds reliable execution. **The FDE Harness layer is platform-agnostic** (five forms — plugin / Skill / MCP / CLI / Dashboard — distributed by host capability); the methodology follows the business, not the platform:

| Tier | Platform | Constraint injection | Mounting method |
|------|----------|---------------------|-----------------|
| **Deep integration** | DeepSeek Harness | ✅ Plugin-level | 9 `cordis-plugin-sofagent-*` mounted into the runtime (previous chapter) |
| **Full mounting** | OpenClaw / WorkBuddy | ✅ Automatic | Hook-injected four-layer constraints + circuit breaker |
| **Thin mounting** | Claude Code / Codex / Cursor / Gemini CLI | ⚠️ Semi-auto | Skills-directory symlink / AGENTS.md seed directives + git-hook audit |

- **The difference is the current depth of adaptation, not skills** — Claude Code and Cursor also have skills directories (installed Skills load just the same); what differs is which hosts sofagent has deeply adapted so far: OpenClaw / WorkBuddy have completed Hook-channel integration (four constraint layers auto-inject at startup + circuit-breaker real-time blocking); Claude Code supports event-level hooks like PreToolUse, Cursor/Gemini CLI load via the Skills directory — on hosts without deep adaptation, constraints ride along as Skill text (advisory) and hard blocking falls uniformly to the git hook (mandatory)
- **Audit fallback is platform-agnostic** — `sofagent-audit --install-hook` runs as a git hook; at every tier, every commit passes through all 24 audit rules, violations hard-blocked. Constraints are advisory; auditing is mandatory

One command selects your mounting tier: `bash install.sh --platform <platform-name>` (all platforms and differences in [HANDBOOK](./docs/HANDBOOK.md))

## FDE Methodology

Many companies adopt AI the wrong way around — they pick models, build platforms, and buy Agents first, only to find nobody uses them. The problem isn't the technology; it's that **they haven't figured out their own business processes before handing them to AI**.

Most tools teach you how to build Agents; sofagent first answers **where AI should go** — turning that judgment from guesswork into a repeatable methodology:

| Phase | Input | What happens | Deliverable |
|-------|-------|--------------|-------------|
| 1 · Map | Role roster · existing systems | **Five-element deep-dive** — capture each step's input / output / owner / time cost / pain points | Enterprise profile |
| 2 · Triage | Enterprise profile | **Three-question triage** — which steps fit AI: 🔄 automate · ⚡ augment · 👤 leave alone, prioritized by ROI | Node plan + annual savings |
| 3 · Deliver | Node plan | **Three-layer deliverables** — documents + Skills + runtime, so AI nodes actually run | Ontology + workflow.yml + skills/ |

Full methodology (four phases, twelve steps) in [FDE/GUIDE.md](./FDE/GUIDE.md) — a half-day read, enough to run FDE independently afterwards.

> 💾 **Don't rush off after deployment**: each node's workflow is "burned" onto a USB drive through the DeepSeek Harness execution backend — the drive becomes one node, one key: plug it into any machine and it runs there (unplug, zero residue). The 9 open-source plugins are already mounted into DSH — burn and go.

## FDE Skill System

Deploying an AI node is only the first step — the chapters above cover how to map the flow and where to put it; this one covers how to keep it behaving every single time. The FDE Skill System, loaded together with the node, answers that:

- 📜 **SKILL.md** — the single main entry, loaded by your AI tool: routes to the corresponding sub-Skill by phase, with role norms auto-injected by task type (mapping / audit / orchestration)
- 🧩 **Phase sub-Skills** — a five-step closed loop of entry → deep-dive → quantify → deliver → depart (01-entry → 05-exit); what to do and what to deliver at each step is defined up front
- 🔒 **Harness constraint skeleton** — entry-gate / fde-template / engage / loop-check / task-closure… every step from entry to departure has its matching constraint template
- 🧬 **Experience capture mechanism** — the structured pipeline of think.md reflection + knowledge maintenance is in place; measured data on capture effectiveness under sustained use is still accumulating (see [LIMITATIONS § core-effect measurements](./docs/LIMITATIONS.md#核心效果实测情况))

> What gets deployed is not a bare Agent, but an **Agent with a constraint skeleton** — constraints are advisory, auditing is mandatory: the Agent may ignore the constraints, but every change gets audited without exception.

## Constraint Layer (Harness)

The constraint layer is sofagent's behavioral foundation, with four capabilities:

- **Injection** — inject enterprise constraints at Agent startup through the four-layer loading chain; constraints are advisory
- **Audit** — 24 git-diff hard-evidence rules (quick runs 17 by default, 7 extensions enabled via config) + AgentShield five-face static config scanning; auditing is mandatory — every change gets audited, violations blocked on the spot
- **Rollback** — auto-archived snapshot after every audit, one-click restore to any snapshot
- **Evolution** — think.md reflection + Dream Cycle + skillopt, experience auto-captured into the knowledge base (knowledge capture is currently a format-only pipeline; content filling advances as models get wired in — see [LIMITATIONS](./docs/LIMITATIONS.md))

## Installation

> ⚠️ **Enterprise users read first** [LIMITATIONS §3](./docs/LIMITATIONS.md) — `config.yml` is **non-fail-closed by default** (rules can be bypassed by Agent tampering), and multi-tenant isolation is not yet landed. For strict-compliance scenarios use CI fallback + file-permission lock (`chmod 444 .sofagent/config.yml`); do not put the single-machine default config directly into production.

**30 seconds, zero setup** — run an audit in any git repo:

```bash
npx -y -p @sofagent/audit sofagent-audit
```

> 💡 quick runs the **17 default rules** (A3 task-scope / A9 commit-msg injection detection active — quick mode auto-reads the latest commit message; when no message is available, A9 is handled by the engine as no-input and marked skipped). The full 24 rules + hook auto-audit require `--init` — see [LIMITATIONS §3](./docs/LIMITATIONS.md).

Here's what it looks like when a known-format secret leak is blocked (real output; A2 detects AWS AKIA/Secret, OpenAI sk-*, GitHub ghp_, Google AIza, Slack xox*-, JWT, PEM private keys and other known formats — generic secret shapes are intentionally out of scope, a conservative design against false positives, see [LIMITATIONS §3 A2](./docs/LIMITATIONS.md#三安全与信任模型局限)):

<p align="center"><img src="docs/assets/audit-terminal.png" alt="sofagent-audit blocks a .env commit" width="860" /></p>

**Full install** (Node.js ≥ 18, download and review before running) — **installed on the enterprise devices running the AI nodes**:

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.4.2/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # review the script first, confirm it's safe
bash bootstrap.sh && rm bootstrap.sh
sofagent-audit --init      # install the git hook — every commit is audited from now on
sofagent-audit --doctor    # verify the environment (optional)
```

> 💡 The install scripts mainly write to `~/.sofagent/` (data directory) + `~/.local/bin` (CLI entry); when OpenClaw is detected they additionally write into its integration directory; if npm permissions are insufficient, the CLI entry falls back to `/usr/local/bin`. No other system files are touched. `--init` installs the three-layer git hook defense (pre-commit blocks `.sofagent/` from entering the repo + commit-msg rule audit + post-commit reconciliation). `--no-verify` can skip the commit-msg audit — it guards against honest Agents' carelessness, not malicious bypass; skipped commits are reconciled afterwards by the post-commit hook (flagged "suspected bypass") but not blocked. Personal fallbacks: CI-side `sofagent-audit --diff`, periodic `--doctor`, and reviewing the audit records. See [LIMITATIONS](./docs/LIMITATIONS.md).
>
> 📌 **install.sh is the enterprise device installer** — install it on the enterprise devices running the AI nodes (constraint-layer engine + daemon inspection + single-machine dashboard); FDEs do not need to run it on their own machines — the FDE's tools are the [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent) (methodology). See [deployment architecture](./docs/ARCHITECTURE.md#安装包边界与部署架构v132-定位校准).
>
> 📌 **How bootstrap.sh and install.sh relate**: bootstrap.sh is a one-line download wrapper around install.sh — `curl bootstrap.sh | bash` is equivalent to "download install.sh + run install.sh". Both scripts install exactly the same thing; bootstrap just saves you the manual clone/download step.

More install options (clone install / full npx install / minimal install / enterprise deployment) in [HANDBOOK](./docs/HANDBOOK.md). Enterprise users who just want the FDE methodology for mapping business workflows, see [FDE/README.md](./FDE/README.md) (zero dependencies, no Node.js needed; for the 15-minute shortest path see its "15-minute shortest path" section).

## Usage

<p align="center"><img src="docs/assets/dashboard.png" alt="sofagent Dashboard cockpit" width="100%" /><br/><sub>Dashboard cockpit (single-file HTML · screenshot shows v1.4.0): rule pass rate, audit tasks, violation trends — see at a glance what the AI is doing.<br>(The installed UI is the source of truth.)</sub></p>

> 📊 **The Dashboard has three entries, each in its place**:
>
> | Entry | Command | Form | Who it's for |
> |------|------|------|--------|
> | **Terminal** | `sofagent-dashboard --full` | Terminal ASCII three-pane (zero frontend dependencies) | Developers / FDE quick check |
> | **Web** | `sofagent web` (works right after install) · repo-mode `node tools/dashboard/serve-dashboard.mjs` | Browser visualization (localhost:3780) | Boss / IT visual review |
> | **macOS double-click** | Double-click `start-dashboard.command` | macOS shortcut to the Web version (macOS double-click entry only) | macOS users |

> 👁️ **Agent's view**: with hooks installed, every commit triggers an audit — PASS prints a short echo then passes (auto-snapshot), violations are printed directly into the terminal output and pushed via Webhook / IM per config; there is no separate GUI on the Agent side (see [PHILOSOPHY §2](./docs/PHILOSOPHY.md#系统暴露的能力agent-视角)).

<p align="center"><img src="docs/assets/usage-path-en.svg" alt="Usage path: trial → team → enterprise → self-running" width="85%" /></p>

| Entry | What it does | Where installed | Time needed |
|------|--------|--------|:----:|
| **`npx -y -p @sofagent/audit sofagent-audit`** | Zero-setup audit of the last commit, results in seconds (first npx ~30s) | Any git repo (temporary) | 30 sec |
| **`--ruleset` rule marketplace** | Load rulesets like security, or custom JSON rules | Same as above | 1 min |
| **GitHub Action** | Auto-audit every PR, violations annotated on the diff lines | CI/CD | Set up once |
| **install.sh full suite** | inject · audit · rollback · evolve + daemon inspection + dashboard — the Agent's complete constraint layer | **Enterprise device** (server/computer running the AI nodes) | FDE residency |

**Install-granularity comparison** (same engine, three install styles — pick by scenario):

| Style | Command | Lifecycle | Best for |
|--------------|---------|-----------|----------|
| npx temporary | `npx -y -p @sofagent/audit sofagent-audit` | use-and-go, downloaded each time | quick audit of any repo, one-off checks outside CI |
| npm in-project | `npm install @sofagent/audit` (project devDependency) | installed with project, version locked in package-lock | team projects with fixed deps, reproducible audits |
| npm global | `npm install -g @sofagent/audit` | install once, use everywhere | daily audit across repos, daemon residency |

**Rule marketplace** — community rulesets are published as `sofagent-ruleset-*` npm packages and loaded manually via `--ruleset-path` (which also accepts your own JSON rules):

```bash
npx -y -p @sofagent/audit sofagent-audit --list-rulesets      # see available rulesets
npx -y -p @sofagent/audit sofagent-audit --ruleset security   # load the security ruleset
```

**FDE on-site deployment** — pick either of two paths:

- **Methodology path** (zero dependencies): read [FDE/GUIDE.md](./FDE/GUIDE.md) and map business workflows manually following the handbook — Excel + your own brain is enough
- **Tooling path** (Node.js ≥ 18): after the FDE installs the constraint layer on the enterprise device via install.sh, tell your own AI tool "run an FDE diagnosis for me" — the Agent guides you from entry onward
## FAQ

- **Is it production-ready?** Currently a single-machine, single-user design — multiple Agents share one knowledge base / audit history (tenant isolation is on the [ROADMAP](./docs/ROADMAP.md)); task logs (task/logs) are written in plaintext — static-encryption capability is implemented but not yet wired in (scheduled on the [ROADMAP](./docs/ROADMAP.md)), task/logs not covered yet. Read [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) before enterprise deployment. `config.yml` is non-fail-closed by default; for strict-compliance scenarios use CI fallback + file-permission lock.
- **Does it collect my data?** Fully local by default. Optional federation queries leave your machine only when you configure them yourself (see SECURITY).
- **How does it relate to scanners like gitleaks?** Complementary, not substitutes — scanners do full-history scans with broader pattern libraries; sofagent focuses on hard evidence from the current diff + Agent behavior auditing (out-of-scope / injection / privilege dimensions). For strict secret compliance, use both together.

## Ecosystem & Docs Index

**Upstream & plugin entries**:

- DeepSeek Harness (upstream repository): <https://github.com/deepseek-ai/deepseek-harness>
- Cordis runtime: <https://github.com/cordiverse/cordis>
- 9 `cordis-plugin-sofagent-*` plugin sources: [`engine/dsh-plugins/`](./engine/dsh-plugins/)

| You want to know | Where |
|:---------|:--------|
| **Global index** (one entry to all docs, in Chinese) | [WIKI](./docs/WIKI.md) |
| How to install, use, FAQ | [HANDBOOK](./docs/HANDBOOK.md) |
| Architecture (constraint layer · injection chain · evolution · 24 rules) | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| Design philosophy | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| Industry validation & ecosystem positioning (differences from existing tools) | [VALIDATION](./docs/VALIDATION.md) |
| Version roadmap | [ROADMAP](./docs/ROADMAP.md) |
| What each version delivered | [CHANGELOG](./CHANGELOG.md) |
| FDE diagnostic methodology (four phases, twelve steps) | [FDE/GUIDE.md](./FDE/GUIDE.md) |
| Security statement · known limitations | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
| Contribution guide | [CONTRIBUTING](./CONTRIBUTING.md) |

> 🧪 **Engineering credibility**: 3541 tests / 13 engine packages + 13 plugins (9 DSH + 4 OpenClaw) · 24 audit rules · fresh-eyes independent review continuously running (test counts are determined by `tools/check/test-count.sh`; environmental notes are documented in [docs/guides/review-system.md](./docs/guides/review-system.md). Performance figures are single-machine reference values; cross-tool benchmarking is scheduled for v1.4.x together with Benchmark integration).

---

<p align="center">
  Issues and PRs welcome, especially the nitpicky kind · <a href="./CONTRIBUTING.md">Contributing</a> · <a href="./docs/THANKS.md">Thanks</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">Kong Fangxun</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ If sofagent helps you, star it and help more people find it</a></sub>
</p>
