# sofagent

<p align="center">
  <img src="docs/assets/banner.png" alt="sofagent" width="100%" />
</p>

<!-- H1 & banner split: the H1 is the repo name and semantic anchor (search engines / no-image environments / screen readers); the banner carries the visuals -->

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <!-- ⚠️ bump version: manually sync this badge version (Version-vX.Y.Z) -->
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.5.6-16B8F3" alt="Version" /></a>
</p>

<p align="center"><sub><a href="./README.md">简体中文</a> | English</sub></p>


## Table of Contents

- [What is this](#what-is-this)
- [Should you install it?](#should-you-install-it)
- [Core Features](#core-features)
- [What is the FDE Harness](#what-is-the-fde-harness)
- [Multi-platform Mounting](#multi-platform-mounting)
- [v1.5.6 · Consolidation (One Entry Point + Data Surface)](#v156--consolidation-one-entry-point--data-surface)
- [The Two FDE Harness Phases](#the-two-fde-harness-phases)
- [Installation](#installation)
- [Usage](#usage)
- [FAQ](#faq)
- [Ecosystem & Docs Index](#ecosystem--docs-index)


## What is this

> 💬 **One-sentence version**: on entry, it maps your business and writes it down as files; after it leaves, every time your digital employee touches code or files, it passes a security check, leaves a record, and saves a snapshot — traceable and roll-backable when things go wrong. That is what
>sofagent does.

> 🏢 **The organizational lens**: the bottleneck of AI adoption has shifted from "is the model smart enough" to "can the organization dare to onboard it" — does it fit the org chart, does it get an account, how is performance measured, what happens when it errs. sofagent is the onboarding system for
>digital employees: on entry it writes the job description into files; after departure it runs performance reviews (evidence for every change), organizational memory (compounding know-how), and fault tolerance (every mistake reversible). Install sofagent before you give AI an employee ID.

> 🧩 **The three-factor framing**: sofagent is a S1M with a built-in Harness, delivered with the FDE playbook — FDEing is the engineering layer (turning FDE from human labor into a reusable capability), S1M is the judgment layer (System One Model, a decision model that separates judgment
>from generation; its foundation is under construction across v1.6.0–v1.9.0, with the declaration landing in v2.0.0), and **harness** is the governance layer (the five constraint-layer capabilities — today's main landing points). Each layer sits in its own place; see "Core Features".

**An open-source FDE Harness layer** (FDE = Forward Deployed Engineer, the engineer who embeds models into real enterprise
operations; a *harness* is the governance layer that keeps every Agent change audited and reversible — see the
"[What is the FDE Harness](#what-is-the-fde-harness)" section) — embedded between mature Agents (DSH / OpenClaw / WorkBuddy)
and the model layer (general LLMs + bespoke post-trained models) to govern both: on entry, it
writes the business judgment down as files (workflow, ontology data, AI-node deployment); after departure, it audits every change against those files.

Five Harness capabilities (inject · audit · rollback · distill · evolve), five distribution forms (FDE plugins / Skill / MCP / CLI / Dashboard).

sofagent does not build the Agent — it delivers the layer that keeps any Agent governed.

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent audit blocks a .env commit" width="860" /><br/>
  <sub>Zero-config audit in action: one command audits the latest commit; leaked secrets get blocked on the spot</sub>
</p>

<details>
<summary>🗺️ System architecture overview (FDE Harness five-module structure)</summary>

<p align="center">
  <img src="docs/assets/architecture-diagram.png" alt="sofagent architecture: host Agent enters the FDE Harness constraint layer via MCP Server; orchestration / audit / post-training /
governance / execution modules" width="860" /><br/>
  <sub>Constrain Agent behavior · Audit every change · Distill experience (five-module structure: governance module released in v1.5.0 · execution module released in v1.5.4/v1.5.5; full interactive
version in <a href="./docs/ARCHITECTURE.md">ARCHITECTURE</a>)</sub>
</p>

</details>

> **Version note**: v1.5.6 has been released (2026-10-04); the latest installable npm version is `@sofagent/audit@1.5.6`.

## Should you install it?

| If you are... | Recommendation |
|---|---|
| **Adding discipline to an existing Agent** — you already run DSH / OpenClaw / WorkBuddy and want your AI to behave, leave traces, and stay roll-backable when things go wrong | ✅ **Install now**. The core value is exactly the constraint layer (inject · audit · rollback · distill ·
evolve) — works right after installation |
| **A one-person company / SMB landing AI** — no dedicated engineer, you need a "never-quitting FDE" to map your workflow and deploy AI nodes | ✅ **Install now**. The FDE Harness layer is built for this — the full journey from mapping to deployment to post-departure audit |
| **Looking for a turnkey enterprise Agent platform** — you expect a complete commercial product (multi-tenancy, permission management, billing, SLA) | ⏸️ **Hold off**. sofagent is an FDE Harness layer, not a platform product
 — platform-grade capabilities are out of this open-source repository's scope. Teams with integration capacity can still embed the constraint layer into their own platform as its governance module; if you need pure turnkey, look at platform products elsewhere |
| **Researching / curious about constraint-layer design** — reading code, studying architecture, borrowing methodology | ✅ **Install now**. Full documentation ([HANDBOOK](./docs/HANDBOOK.md) / [ARCHITECTURE](./docs/ARCHITECTURE.md) / [PHILOSOPHY](./docs/PHILOSOPHY.md)), MIT licensed |

**How does it relate to gitleaks / pre-commit?** (complementary, not substitutes)

| | gitleaks-style scanners | pre-commit hooks | sofagent |
|---|---|---|---|
| Positioning | full-history secret scanning | generic commit-hook framework | Agent behavior audit harness |
| Evidence | repo text patterns | your own scripts | git-diff hard evidence + Agent logs + decision trail |
| Coverage | secret leaks | anything (DIY) | 25 rules: secrets / scope / injection / privilege / backdoors |
| Deployment cost | Low — standalone binary, zero deps | Low — one CLI from your language ecosystem | Medium — a one-time `install.sh` on the enterprise device (you can also try it zero-config via npx first) |
| Maintenance burden | Low — rules track upstream | Medium — custom scripts are yours to maintain | Medium — rules and hooks ship with this repo, but each version needs the hook reinstalled and config re-aligned |
| Advice | a must for strict secret compliance | keep if you have one | use alongside both — focused on Agent governance |

**30-second lightweight trial** (first run includes the npx package fetch, reruns finish in seconds; a single engine audit itself takes ~1.1 seconds — see the measured figures below): `npx -y -p sofagent sofagent audit` (any git repo; secret leaks blocked on the spot).

> 💡 For the trial, keep commit messages **at least 6 characters** (e.g. `initial audit test`) — A19 (rule numbers: see the [rule table](./docs/ARCHITECTURE.md)) flags ultra-short messages (`init`/`add`) by design (it guards against meaningless commit messages), not a malfunction.

**Five-minute theatrical demo** (shipped in v1.5.1; sandboxed, zero touch on real files): `npx -y -p sofagent sofagent audit demo` — one command runs the full five-act chain: sandbox
build → injection → deliberate violation → audit interception → snapshot rollback → HMAC evidence export
(`--speed fast` for a 60-second cut; artifacts land under `$SOFAGENT_DATA/demo` (default `~/.sofagent/data/demo`), touching neither the audited repository nor other directories).

## Core Features

> ### Everything can be FDEing (the idea)
>
> **From FDE to FDEing — everything can be FDEing**: turn Forward Deployed **Engineering** (a capability) out of Forward Deployed **Engineer** (a job title)
 — the job leaves with the person, the capability stays with the deliverables. **FDEing is the abbreviation of Forward Deployed Engineering** (read /ef-di-i-ing/, isomorphic with "engineering"): as a noun it names the capability; as a verb it means turning FDE from manual labor into that capability
— everything can be FDEing.
>
> - **FDE is the noun; FDEing is the verb** — turning FDE from manual work into an automatically executable capability (playbook × judgment × governance combined): less labor, more capability.
> - **Not limited to software** — any business object, process, or node can be FDE'ed through "map → judge → deliver → sustain"; hardware nodes and robot motions are workflows too — the difference lies in the executor, not the governance shape.
> - **It is also a way of thinking** — before doing anything, think of three things: ① how to structure its workflow; ② what its AI nodes are; ③ how AI can help you do it better (see [PHILOSOPHY](./docs/PHILOSOPHY.md)).

Three layers, each in its place: the **engineering layer (FDEing)** writes judgment down on entry, the **judgment layer (S1M)** governs how judgment forms, is traced, and is evidenced, and the
**governance layer (harness)** keeps judgment executing 24/7 after departure.

**Engineering layer · FDEing** (on entry · generate judgment, the FDE stage — deciding where AI belongs and what it's worth, frozen into deliverables):

- 🧭 **Map the workflow** — five-element deep-dive + three-question triage, capturing every role's process steps and pricing out what each AI node is worth
- 🤖 **Deploy AI nodes** — three-layer deliverables (documents + Skills + runtime), installed into your existing AI tools; from "you do the work" to "you delegate the work"
- 📦 **Judgment frozen into deliverables** — every node carries "what counts as done (merge_criteria) · who signs off (approver)", machine-checkable and shared across both stages

**Judgment layer · S1M** (System One Model — a decision model that separates judgment from generation; **its foundation is scheduled for construction across v1.6.0–v1.9.0, with the declaration
for v2.0.0 — not yet shipped**. This version states identity and roadmap only, no claim that judgment capabilities are
delivered yet; the narrative is anchored to [FDE/S1M-DECISION-POINTS.md](./FDE/S1M-DECISION-POINTS.md) and the [v2.0.0 §1](./docs/changelog/v2.0/v2.0.0.md) planning definition.
What ships today in this layer is the existing judgment-and-evidence surface):

- 🔎 **Judgment trail** — decision-log causal chains record every accountable decision (who signed off, on what basis, why), consumed by auto-PR explanation blocks and the daemon weekly digest
- 🔗 **Judgment made provable** — the audit history lands on an HMAC chain; `--verify-chain` recomputes chain integrity offline, so conclusions can be re-checked by a third party

**Governance layer · harness** (after departure · retain judgment, the Harness stage — executing against the deliverables 24/7, writing back as it evolves):

- 🏠 **Stay resident after departure** — the FDE capability remains for inspection, audit, and optimization, 7×24 online guardian (audit triggers on commit); the human leaves, governance doesn't
- 🔍 **Zero-setup audit** — `npx -y -p sofagent sofagent audit`, auditing the latest commit of any git repo in seconds (single-machine measured: quick ~1.1s, 50k-line diff ~6.1s; see [HANDBOOK](./docs/HANDBOOK.md))
- 🧱 **25 audit rules + 104 MCP tools** — secret leaks, out-of-scope edits, injection defense, privilege red lines; judged on two evidence tiers: 20 of the 25 rules run on git-diff hard evidence (effective locally), 4 hybrid (diff + Agent logs, active once an Agent is connected), 1 filesystem scan;
  log-based rules such as A7/A8 (rule numbers: see the [rule table](./docs/ARCHITECTURE.md)) are skipped when no Agent logs exist, violations blocked on the spot (once a critical-layer rule hits, remaining rules are skipped — fail-fast design);
evidence is based on local diffs; **not fail-closed by default** — the config can be tampered with and the hooks
  skipped via `--no-verify` (trust boundaries and known bypass surfaces in [LIMITATIONS §3](./docs/LIMITATIONS.md)) (quick runs 17 by default; full 25 = 17 default + 8 extensions)
- 🛡️ **Automatic snapshot rollback** — auto-archived after every audit, one-click restore to any snapshot when something breaks

## What is the FDE Harness

**FDE = Forward Deployed Engineer** — the person who embeds models into real enterprise operations. sofagent turns this role into an open-source FDE Harness layer, sitting between the Agents
you already have (DSH / OpenClaw / WorkBuddy) and the model layer. A full FDE workflow has two stages, **sewn
together by the deliverables handed over in between**:

- **On entry · generate judgment**: four steps — **map the workflow → build dual graphs → qualify AI nodes → deploy**. Dual graphs = business graph (system boundaries, data flows; read by humans) + ontology graph (shared semantic foundation; read by AI), turning the enterprise into a
  machine-readable structure; for every AI node, "what counts as done (merge_criteria) · who signs off (approver) · when it runs (trigger)" is judged here and frozen into the deliverables
(workflow.yml + ontology + skills).
- **After departure · retain judgment**: the FDE leaves, the judgment stays — audit triggers automatically on change events (commits) against the frozen criteria (evidence-tiered: 20 of the 25 rules run on git-diff hard evidence — see Core Features); daemon inspects 7×24, snapshots roll back,
  experience distills back. The human leaves, governance doesn't.

> 🔗 **Why they must be one thing**: the deliverables are a living state shared by both stages — written on entry, read during execution, written back during evolution (trial branches promoted to baseline, reflections distilled back). Without FDE, the constraint layer has no criteria to enforce;
>without the constraint layer, FDE judgment evaporates the moment the engineer leaves. That is where the name "FDE Harness" comes from — not a bundle of an FDE feature and a Harness feature, but two stages of one job.
>
> **From FDE to FDEing — everything can be FDEing**: the combined effect of the two stages is turning Forward Deployed **Engineer** (a job title) into Forward Deployed **Engineering** (a capability) — the person moves on, the capability stays with the deliverables. FDEing is short for Forward
>Deployed Engineering (pronounced /ef-di-i-ing/) — as a noun it names that capability, as a verb it means turning FDE labor into it.
>
> - **FDE is the noun; FDEing is the verb** — turning FDE from human labor into an auto-executable capability (playbook × judgment × governance): less human labor, more capability delivered.
> - **Not limited to software** — any business object, process, or node can be FDEing'd through "map → judge → deliver → sustain"; hardware nodes and robot motion are workflows too — the difference lies in the actuator, not the governance.
> - **It is also a mindset** — before doing anything, think: ① how to structure the workflow; ② which nodes are AI nodes; ③ how AI can best help you get it done (see [PHILOSOPHY](./docs/PHILOSOPHY.md)).

<p align="center"><img src="docs/assets/arch-layers-en.svg" alt="sofagent three-layer positioning: model layer → FDE Harness layer → Agent layer" width="85%" /></p>

**Why the FDE Harness**

- **The bottleneck for enterprise AI is deployment, not the model** — mapping workflows, drawing system boundaries, and setting data rules is precisely the FDE's job. MIT NANDA's *The GenAI Divide*: 95% of enterprise GenAI projects failed to produce value worth a financial statement, while FDE job
  postings surged 729% in a year (verification in [VALIDATION](./docs/VALIDATION.md))
- **Completeness comes from the union** — DSH solves "can work"; sofagent solves "keeps working"; only together do they make a complete FDE Harness (next chapter)
- **"Continuous optimization" only holds with a constraint layer** — backed by auditable, rollback-capable mechanisms, not promises in prompts. Independent external experiment (ARC-AGI-3, **capability-harness data** — it lifts task scores and token efficiency, a different dimension from the
  reliability gains of a governance constraint layer): optimizing only the outer Harness around the same model significantly lifts task completion. Verification in
[VALIDATION](./docs/VALIDATION.md) · [THANKS](./docs/THANKS.md) (write-surface audit coverage: the weight and skill surfaces have
  shipped; the prompt / memory surfaces are scheduled for v1.5.9)
- **Capabilities are portable, never dead-bound to a platform** — the constraint layer is platform-agnostic; the methodology follows the business, not the platform

> 🔄 **Self-bootstrapping**: sofagent's first FDE engagement is sofagent itself — the project is a complete FDE workflow (map → build → deploy → depart), and this open-source repository is that deliverable.

## Multi-platform Mounting

Sits between the Agents you already use and the model layer — it doesn't replace the model, only adds reliable execution. **The FDE Harness layer is platform-agnostic** (five forms — plugin
/ Skill / MCP / CLI / Dashboard — distributed by host capability); the methodology follows the business, not
the platform:

| Tier | Platform | Constraint injection | Mounting method |
|---|---|---|---|
| **Deep integration** | DeepSeek Harness | ✅ **Per-tool-call interception** | 6 atomic `cordis-plugin-sofagent-*` mounted into the runtime (1 optional aggregate plugin also available; see "Upstream & plugin entries" below) — 7 lifecycle events incl. `tools/pre-execute` (per the vocabulary table in `engine/dsh-plugins/SEAMS.md`) |
| **Full mounting** | OpenClaw | ✅ **Once per session** | Hook-injected four-layer constraints + circuit breaker + 4 OpenClaw plugins |
| **Standard mounting** | Claude Code / Cursor | ⚠️ Skill self-load | Skills-directory symlink + platform rule file + interception config (content = commit-level 25 rules, not call-level interception) |
| **Thin mounting** | WorkBuddy / Codex / Gemini CLI / Hermes | ⚠️ Skill self-load | Skills-directory symlink (Codex uses the `AGENTS.md` mount point) + git-hook audit |

- **Never assume capability parity — tiers differ in injection strength, not in "supported or not"** — DSH intercepts per tool call, OpenClaw injects once per session, and on every other host constraints ride along as Skill text the Agent reads on its own (advisory). "Supports platform X" means the
  constraint assets work there; it does **not** mean constraint strength matches other platforms. Before migrating hosts or writing integration docs, check which tier the target host falls
into — full matrix in the [load-chain HOOK](./engine/hooks/sofagent-load-chain/HOOK.md)
- **Audit fallback is platform-agnostic** — `sofagent audit --install-hook` runs as a git hook; at every tier, every commit is audited automatically (audits with the 17 default rules out of the box; the full 25 require enabling `extendedRulesEnabled: true` in `.sofagent/config.yml`), violations
  hard-blocked. Constraints are advisory; auditing is mandatory (boundaries of that mandate: **not fail-closed by default** — `--no-verify` skips the first two defense layers, and
post-commit only leaves a trace without blocking; bypassed commits do leave traces — see [LIMITATIONS
  §3](./docs/LIMITATIONS.md)).

One command selects your mounting tier: `bash install.sh --platform <platform-name>` (all platforms and differences in [HANDBOOK](./docs/HANDBOOK.md))

## v1.5.6 · Consolidation (One Entry Point + Data Surface)

🧭 **One entry point, one clean data surface** (✅ released · 2026-10-04) — thirteen commands collapse into one, and runtime data gains a lifecycle:

| Capability | One-liner |
|---|---|
| **Single-entry CLI** | 13 bins collapse into `sofagent <domain> <action>` (15 domains + reserved words); the 12 legacy commands become forwarding shims for one compatibility minor |
| **Data lifecycle governance** | Fact-memory sharding + hot/cold archiving; audit-chain history-segment archiving (archiving ≠ deletion); legacy-backup cleanup policy; doctor data-directory health section |
| **Project scope for distilled memory** | Distilled experience is pinned to the project (resolved by repo) — no silent cross-project or global sharing; reuse goes through explicit export/import with lineage and approval traces |
| **Ops & security doc injection (R6)** | Wording injected across HANDBOOK / LIMITATIONS / SECURITY / DEVELOPMENT; LIMITATIONS gains an "S1M verdict blind spots" entry |

> 📌 Full changes and acceptance evidence: [v1.5.6 devlog](./docs/changelog/v1.5/v1.5.6.md); older capability sections in [CHANGELOG](./CHANGELOG.md).

## The Two FDE Harness Phases

**How the two phases divide the work** is covered in [What is the FDE Harness](#what-is-the-fde-harness) above — what this section adds is the **organizational reading**: together they are onboarding a digital employee (the after-departure side runs daemon patrols 24/7, every commit triggers the 25 audit rules including **AgentShield static scanning across five config surfaces**, snapshots stay rollback-ready, and evolution writes promotion plus distilled reflection back into the deliverable).

| Organizational act | sofagent equivalent |
|---|---|
| Job description | Frozen deliverables from the entry phase (merge_criteria / approver / trigger) |
| Performance review | Audit evidence + governance KPI dashboard (v1.5.0) |
| Organizational memory | Knowledge distillation (think.md reflection + knowledge/) |
| Training pipeline | Experience → exam → promotion self-evolution chain (scheduled v1.5.8) |
| Fault tolerance | Snapshot rollback + capability baseline timeline (scheduled v1.5.9) |
| Employment contract boundary | Pluggable contracts & core capability registry (**not yet scheduled** — no matching version entry in the roadmap) |

| Go deeper | Where |
|---|---|
| Four-phase twelve-step methodology (half-day read) | [FDE/GUIDE.md](./FDE/GUIDE.md) |
| Constraint layer's five capabilities · module layout | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| Why they must be one · design no-go zones | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| Skill system & knowledge pipeline | [FDE/Skill system](./FDE/README.md) |

## Installation

**Release stage (read before installing)**: sofagent is in its **Alpha construction period** (v1.x) — the feature surface moves fast and **no interface stability is promised**; read the
[CHANGELOG](./CHANGELOG.md) before upgrading across versions. From **v2.0.0** on it enters the **Beta stage**.

The matching npm release-channel policy: **no dist-tag split — `latest` is the newest version** — `npx @sofagent/audit` pulls the current latest by default, no tag needed (version numbers
carry the stage semantics: v1.x alpha construction period / beta from v2.0.0).
The `alpha` tag remains as a historical release trace and is not maintained.

> ⚠️ **Enterprise users read first** [LIMITATIONS §3](./docs/LIMITATIONS.md) — `config.yml` is **non-fail-closed by default** (rules can be bypassed by Agent tampering), and **write-side** multi-tenant isolation is not yet landed (v0 delivered query-side isolation: orgId filtering + the
>data/<tenant>/ path foundation — see LIMITATIONS). For strict-compliance scenarios use CI fallback + file-permission lock (`chmod 400 .sofagent/config.yml` — an auxiliary layer, ineffective against same-user processes; see [LIMITATIONS §3](./docs/LIMITATIONS.md)); do not put the single-machine
>default config directly into production.
>
> 🔐 **Data sovereignty**: runtime data never leaves your machine (no network access except the npm package fetch at install time); the three opt-in exits (cloud sync / model inference endpoint / cloud VM execution surface) require your explicit configuration — see [SECURITY](./SECURITY.md).

**30 seconds, zero setup** (first run includes the npx package fetch, ~30 seconds; reruns finish in seconds — the engine itself takes ~1.1s, measured basis above) — run an audit in any git repo:

```bash
npx -y -p sofagent sofagent audit
```

> 💡 quick runs the **17 default rules** (A3 task-scope / A9 commit-msg injection detection active — quick mode auto-reads the latest commit message; when no message is available, A9 is handled by the engine as no-input and marked skipped). `--init` installs the hook (still the same 17 default
>rules); the full 25 additionally require `extendedRulesEnabled: true` in `.sofagent/config.yml` — see [LIMITATIONS §3](./docs/LIMITATIONS.md).

> ⚠️ This step is a **one-off audit** (inside a single process) — it does not install a git hook, so later commits will not be auto-blocked. For continuous protection run `sofagent audit --init` (see Full install below).

Here's what it looks like when a known-format secret leak is blocked (real output; A2 (rule numbers: see the [rule table](./docs/ARCHITECTURE.md)) detects AWS AKIA/Secret, OpenAI sk-*, GitHub ghp_, Google AIza, Slack xox*-, JWT, PEM private keys and
other known formats — generic secret shapes are intentionally out of scope, a conservative design against false

positives, see [LIMITATIONS §3 A2](./docs/LIMITATIONS.md#%E4%B8%89%E5%AE%89%E5%85%A8%E4%B8%8E%E4%BF%A1%E4%BB%BB%E6%A8%A1%E5%9E%8B%E5%B1%80%E9%99%90)). This is exactly the scenario shown in the screenshot above (first screen); not repeated here.

**Full install** (Node.js ≥ 18, download and review before running) — **installed on the enterprise devices running the AI nodes**:

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.5.6/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # review the script first, confirm it's safe
bash bootstrap.sh && rm bootstrap.sh
```

> 🔒 Supply-chain trust: tag pinning + sha256 verification + fail-closed + self-anchored hash re-verification (see [SECURITY.md](SECURITY.md), remote-install section); ⚠️ audit logs are plaintext on disk by default — enterprise deployments should enable encryption-at-rest.

```bash
sofagent audit --init      # install the git hook — every commit is audited from now on
sofagent audit --doctor    # verify the environment (optional)
```

> 🔧 **First `--doctor` on a fresh machine reports "no dist baseline"?** Run `sofagent audit --doctor --baseline` to establish it (the trust anchor = the moment you confirm the dist is trustworthy — never auto-recorded, to defend against shadow-auditor hijacking).


> 💡 The install scripts mainly write to `~/.sofagent/` (data directory) + `~/.local/bin` (CLI entry); **they write into a platform's integration directory only when `--platform <name>` is passed explicitly** (a default install probes no platform and modifies no platform config); if npm permissions
>are insufficient, the CLI entry falls back to `/usr/local/bin`. No other system files are touched. `--init` installs the three-layer git hook defense (pre-commit blocks `.sofagent/` from entering the repo + commit-msg rule audit + post-commit reconciliation). `--no-verify` can skip **both
>pre-commit and commit-msg** (the first two layers); **post-commit reconciliation is unaffected** (the git-native switch does not apply to post-commit) — it guards against honest Agents' carelessness, not malicious bypass; skipped commits are reconciled afterwards by the post-commit hook (flagged
>"suspected bypass") but not blocked. Personal fallbacks: CI-side `sofagent audit --diff`, periodic `--doctor`, and reviewing the audit records. See [LIMITATIONS](./docs/LIMITATIONS.md).
>
> 📌 **install.sh is the enterprise device installer** — install it on the enterprise devices running the AI nodes (constraint-layer engine + daemon inspection + single-machine dashboard); FDEs do not need to run it on their own machines — the FDE's tools are the [FDE
>Skill](https://clawhub.ai/kongfangxun/skills/sofagent) (methodology). See [deployment architecture](./docs/ARCHITECTURE.md#%E5%AE%89%E8%A3%85%E5%8C%85%E8%BE%B9%E7%95%8C%E4%B8%8E%E9%83%A8%E7%BD%B2%E6%9E%B6%E6%9E%84v132-%E5%AE%9A%E4%BD%8D%E6%A0%A1%E5%87%86).
>
> 📌 **How bootstrap.sh and install.sh relate**: bootstrap.sh is a one-line download wrapper around install.sh — `curl bootstrap.sh | bash` is equivalent to "download install.sh + run install.sh". Both scripts install exactly the same thing; bootstrap just saves you the manual clone/download step.

**To uninstall**: `bash ~/.sofagent/scripts/uninstall.sh` (installed layout) or `bash engine/scripts/uninstall.sh` (clone layout) — removes the Skill/constitution files, hook registrations
and the three git hooks (`pre-commit` / `commit-msg` / `post-commit`), while keeping your `~/.sofagent/` data.

Full install options (clone install / full npx install / minimal install / enterprise deployment), uninstall, and how to tell the single entry from the install-state layout apart (npm bare-name umbrella = sub-package forwarder, see the package-name warning in Usage; the install.sh state
exposes `status` / `web` / `dashboard`) → [HANDBOOK
· Installation](./docs/HANDBOOK.md).

Enterprise users who just want the FDE methodology for mapping business workflows, see [FDE/README.md](./FDE/README.md) (zero dependencies, no Node.js needed; for the 15-minute shortest path see its "15-minute shortest path" section).

## Usage

<p align="center"><img src="docs/assets/dashboard.png" alt="sofagent Dashboard cockpit" width="100%" /><br/><sub>Dashboard cockpit (single-file HTML · sample data): rule pass
rate, audit tasks, violation trends — see at a glance what the AI is doing.<br>(See CHANGELOG for UI evolution;
the installed UI is the source of truth.)</sub></p>

> 📊 **The Dashboard has three entries, each in its place**:
>
> | Entry | Command | Form | Who it's for |
> |---|---|---|---|
> | **Terminal** | `sofagent-dashboard --full` | Terminal ASCII three-pane (zero frontend dependencies) | Developers / FDE quick check |
> | **Web** | `sofagent web` (available in the install.sh-installed state) · repo-mode `node tools/dashboard/serve-dashboard.mjs` | Browser visualization (localhost:3780) | Boss / IT visual review |
> | **macOS double-click** | Double-click `start-dashboard.command` | macOS shortcut to the Web version (macOS double-click entry only) | macOS users |
>
> ⚠️ **Dashboard availability boundary**: all three entries ship with the **`install.sh`-installed state**; a package installed directly via `npm i @sofagent/audit` does **not** contain the dashboard static assets (`tools/dashboard/` is not distributed — the root `files` list keeps only root-level
>essentials). npm-only installs get the CLI + MCP surface; **for the Dashboard use the full install** (bootstrap.sh / install.sh).

> 👁️ **Agent's view**: with hooks installed, every commit triggers an audit — PASS prints a short echo then passes (auto-snapshot), violations are printed directly into the terminal output and pushed via Webhook / IM per config; there is no separate GUI on the Agent side (see [PHILOSOPHY
>§2](./docs/PHILOSOPHY.md#%E7%B3%BB%E7%BB%9F%E6%9A%B4%E9%9C%B2%E7%9A%84%E8%83%BD%E5%8A%9Bagent-%E8%A7%86%E8%A7%92)).

<p align="center"><img src="docs/assets/usage-path-en.svg" alt="Usage path: trial → team → enterprise → self-running" width="85%" /></p>

| Entry | What it does | Where installed | Time needed |
|---|---|---|---|
| **`npx -y -p sofagent sofagent audit`** | Zero-setup audit of the last commit, results in seconds (first npx ~30s) | Any git repo (temporary) | 30 sec |
| **`--ruleset` rule marketplace** | Load rulesets like security, or custom JSON rules | Same as above | 1 min |
| **GitHub Action** | Auto-audit every PR, violations annotated on the diff lines | CI/CD | Set up once |
| **install.sh full suite** | inject · audit · rollback · distill · evolve + daemon inspection + dashboard — the Agent's complete constraint layer | **Enterprise device** (server/computer running the AI nodes) | FDE residency |

> 📌 **Single-entry CLI (since v1.5.6)** — the CLI converges on **`sofagent <domain> <action>`**: `sofagent audit` (audit) · `sofagent train doctor` (training) · `sofagent team formation` (formations) · `sofagent daemon` (daemon) … run `sofagent help` for all domains.
>
> | Usage | Command |
> |---|---|
> | Zero-install trial | `npx -y -p sofagent sofagent audit` |
> | Global install | `npm i -g sofagent` → `sofagent audit` |
> | Full install (daemon / dashboard) | `bootstrap.sh` / `install.sh` (above) |
>
> - **Compatibility window**: the old commands (`sofagent-audit` / `sofagent-daemon` / `sofagent-orchestrator` …) **still work** and print a pointer to the new entry — **removed one minor version later**. The 13 former bins are now carried by the single entry.
> - ⚠️ **`npm i -g sofagent` pulls the full dependency tree** (orchestrator / mcp / train capability packages; 771 transitive deps measured, 5 of which carry native modules and install scripts — new npm versions do not run unreviewed install scripts, so those native builds are **silently skipped**).
>**For the audit CLI only**, use `npx -y -p sofagent sofagent audit` or the scoped package `npm i -g @sofagent/audit`.
> - **Retired legacy proxy package**: the bare-name `sofagent-audit` (no scope) on npm is the old proxy package — **unpublished on 2026-09-26**; do not install it.

**Rule marketplace** — community rulesets are published as `sofagent-ruleset-*` npm packages and loaded manually via `--ruleset-path` (which also accepts your own JSON rules):

```bash
npx -y -p sofagent sofagent audit --list-rulesets      # see available rulesets
npx -y -p sofagent sofagent audit --ruleset security   # load the security ruleset
```

**FDE on-site deployment** — pick either of two paths:

- **Methodology path** (zero dependencies): read [FDE/GUIDE.md](./FDE/GUIDE.md) and map business workflows manually following the handbook — Excel + your own brain is enough
- **Tooling path** (Node.js ≥ 18): after the FDE installs the constraint layer on the enterprise device via install.sh, tell your own AI tool "run an FDE diagnosis for me" — the Agent guides you from entry onward

## FAQ

- **Is it production-ready?** Currently single-machine, single-user (tenancy on the [ROADMAP](./docs/ROADMAP.md); encryption-at-rest and boundaries in [LIMITATIONS](./docs/LIMITATIONS.md) — read [SECURITY](./SECURITY.md) before enterprise deployment).
- **Does it collect my data?** Fully local by default. Optional federation queries leave your machine only when you configure them yourself (see SECURITY).

## Ecosystem & Docs Index

> 🌏 Note: the linked docs (LIMITATIONS / ARCHITECTURE / PHILOSOPHY / WIKI / SECURITY …) are Chinese-first — English readers can rely on this README plus the EN summary at the top of [WIKI](./docs/WIKI.md); full doc translation is tracked in issue #8.

**Featured in** (community listings, incl. pending PRs):

[![Glama](https://img.shields.io/badge/Glama-indexed-4A90D9)](https://glama.ai/mcp/servers/KongFangXun/sofagent)
[![awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-listed-brightgreen)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![awesome-ai-agents (Jenqyang)](https://img.shields.io/badge/awesome--ai--agents-listed-brightgreen)](https://github.com/Jenqyang/Awesome-AI-Agents)
[![dsh-plugin-radar](https://img.shields.io/badge/dsh--plugin--radar-listed-brightgreen)](https://github.com/AdamPlatin123/dsh-plugin-radar/blob/main/PLUGINS.md)
[![awesome-deepseek-harness (0xsline)](https://img.shields.io/badge/awesome--deepseek--harness%20%280xsline%29-listed-brightgreen)](https://github.com/0xsline/awesome-deepseek-harness)
[![awesome-mcp-servers](https://img.shields.io/badge/awesome--mcp--servers-listed-brightgreen)](https://github.com/punkpeye/awesome-mcp-servers)
[![awesome-harness-engineering](https://img.shields.io/badge/awesome--harness--engineering-PR%20open-orange)](https://github.com/ai-boost/awesome-harness-engineering/pull/227)
[![awesome-ai-agents (e2b)](https://img.shields.io/badge/awesome--ai--agents%20%28e2b%29-PR%20open-orange)](https://github.com/e2b-dev/awesome-ai-agents/pull/1471)

**Upstream & plugin entries**:

- DeepSeek Harness (upstream repository): <https://github.com/deepseek-ai/deepseek-harness>
- Cordis runtime: <https://github.com/cordiverse/cordis>
- 7 `cordis-plugin-sofagent*` plugin sources (6 atomic + 1 aggregate): [`engine/dsh-plugins/`](./engine/dsh-plugins/)

| What you want to know | Where |
|---|---|
| **Full doc index** (by intent) | [WIKI](./docs/WIKI.md) |
| Install, use, troubleshoot | [HANDBOOK](./docs/HANDBOOK.md) |
| Architecture & the 25 rules | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| What each release did | [CHANGELOG](./CHANGELOG.md) |
| Security statement · known limits | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |

> 🧪 **Engineering credibility** (current): 5752 tests / 13 module packages + 11 plugins (7 DSH + 4 OpenClaw) · 25 audit rules · fresh-eyes independent review continuously running.
> **Package-count standard** (disambiguation): workspace 27 = 13 module packages + load-chain + dsh-plugin-kit + umbrella + 7 DSH plugins + 4 OpenClaw plugins (see [WIKI §6](./docs/WIKI.md#六当前状态)); the **test-count standard** = 13 module packages (25 workspaces bear a test script; plugin packages,
>the load-chain utility package and dsh-plugin-kit are outside this counting standard) — they are not the same set.
> There are two test-count figures: the **release-time value** (the `4805 → 4903` delta account — see each version's section) and the **current measured value** (the value in the engineering-credibility line above, rolling forward with fix batches); the current authoritative value is whatever
>`tools/check/check-test-count.sh` reports (`test-count.sh` produces the SSOT count, `check-test-count.sh` verifies doc-claimed figures for consistency) — counting standard in [WIKI package-count definition](./docs/WIKI.md#六当前状态). Review-environment notes in
>[docs/guides/review-system.md](./docs/guides/review-system.md); performance figures are single-machine reference values.

---

<p align="center">
  Issues and PRs welcome, especially the nitpicky kind · <a href="./CONTRIBUTING.md">Contributing</a> · <a href="./docs/THANKS.md">Thanks</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">Kong Fangxun</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ If sofagent helps you, star it and help more
people find it</a></sub>
</p>
