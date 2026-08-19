<p align="center">
  <img src="docs/assets/banner.png" alt="sofagent" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.3.7-16B8F3" alt="Version" /></a>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="#what-is-this">What is this</a> · <a href="#fde-methodology">FDE Methodology</a> · <a href="#quick-start">Quick Start</a> · <a href="#three-entries-from-30-seconds-to-full-deployment">Three Entries</a> · <a href="#why-sofagent">Why</a> · <a href="#docs">Docs</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ Star</a>
</p>

---

## What is this

**sofagent is an open-source FDE Agent** (Forward Deployed Engineer Agent) — it comes in and maps your business workflows, turning the automatable steps into AI nodes. Once delivery is complete, the FDE departs while the AI nodes keep running 7×24 on their own — every action is audited, out-of-bounds moves are blocked, and anything that breaks can be rolled back. It ships on [ClawHub](https://clawhub.ai/kongfangxun/skills/sofagent) as an **FDE Skill** (a methodology skill that helps FDEs do FDE work), and once installed on enterprise devices it runs long-term as a **constraint-layer engine** (auditing + rollback + injection + daemon monitoring).

> 📊 **Why now**: MIT NANDA Lab's *The GenAI Divide* report shows that over the past three years, global enterprises burned $30–40 billion on generative AI, yet **95% of projects failed to produce value worth putting on a financial statement**. Meanwhile, job postings for a role called "Forward Deployed Engineer" (FDE) surged **729%** year-over-year (Indeed 2025 data). Models are no longer scarce — the scarce thing is people who can embed models into real customer operations. sofagent is the open-source substrate that engineers this. (Data verification and cross-agency calibration: see [VALIDATION §1 · Cost of governance gaps](./docs/VALIDATION.md#治理缺口的代价三项联网核验证据); FDE economics: see [VALIDATION §4](./docs/VALIDATION.md#四市场印证行业判断被市场买单).)

```mermaid
graph LR
    A["① Map workflows<br/>Guided conversation maps the workflow<br/>what to automate · what stays human · what to leave alone"] --> B["② Deploy AI nodes<br/>Turn automatable steps into SubAgents<br/>runs inside your existing AI tools, no new UI"]
    B --> C["③ Self-running after departure<br/>The FDE leaves, sofagent stays 7×24<br/>every action checked · violations blocked · rollback anytime"]
    C -.->|experience captured · keeps improving| C
```

> 🏞️ Big vendors hand you "water" (the LLM) and a "riverbed" (the Agent platform), but the water is raw — you wouldn't dare drink it straight. sofagent is the engineering that makes the river water usable across a whole city: the dam stops floods, the treatment plant turns raw water into drinking water, and the pipe network delivers it to every faucet. The model provides 90% of the intelligence; sofagent adds the 10% of reliable execution.

### How is this different from a bare Agent

| Dimension | Bare Agent (ChatGPT / Copilot) | sofagent |
|:-----|:------|:------|
| Change auditing | None (roll your own pre-commit + gitleaks) | 24 rules on git diff, hard-evidence verdicts |
| Out-of-bounds blocking | Assemble the hooks yourself | Violations blocked on the spot + audit trail |
| Rollback after breakage | Manually dig through commits | One-click snapshot restore to any point |
| Experience accumulation | Starts from zero every time | Auto-captured into knowledge base, evolution capabilities under continuous iteration |

## Key Features

**FDE Agent delivery**

- 🧭 **Map workflows on-site** — five-element deep-dive + three-question triage, mapping out every process step and calculating what each AI node is worth
- 🤖 **Deploy AI nodes** — three-layer deliverables (documents + Skills + runtime), running inside your existing AI tools; from "you do the work" to "you delegate the work"
- 🏠 **Stays resident after departure** — the FDE Agent stays for inspection, audit, and optimization, 7×24 online; the human leaves, governance doesn't

**Governance guarantees**

- 🔍 **Zero-setup audit** — `npx -y -p @sofagent/audit sofagent-audit`, audits your last commit in any git repo in seconds (measured: ~1.1s per quick run, ~6.1s for a 50k-line diff on Apple Silicon; first npx download takes ~30s)
- 🧱 **24 audit rules** (17 enabled by default + 7 optional extensions) — secret leaks, out-of-scope edits, injection defense, privilege red lines — judged on hard git diff evidence, violations blocked on the spot
- 🛡️ **Automatic snapshot & rollback** — auto-archived after every audit, one-click restore to any snapshot

## Quick Start

**30 seconds, zero setup** — run an audit in any git repo:

```bash
npx -y -p @sofagent/audit sofagent-audit
```

> 💡 `sofagent-audit` is the quick read-only audit (audits the last commit, safe and side-effect-free by default); `sofagent-audit-full` is the full audit and requires an explicit operation (e.g. `--diff <range>` / `--init`).
>
> ⚠️ **Scope of quick mode**: quick is a zero-setup fast audit running the **17 default rules** (A3 task-scope / A9 commit-msg injection have no input and are skipped; rules needing logs fall back to degraded verdicts; **the 7 extension rules are not loaded by default** — the full 24 = 17 default + 7 extension). For full protection (commit-msg injection blocking + scope checks + hook auto-audit) run `--init` to install the git hooks and enter the full engine. See [LIMITATIONS](./docs/LIMITATIONS.md).

Here's what it looks like when a known-format secret leak is blocked (real output):

> ℹ️ Rule A2 detects known formats: AWS AKIA, OpenAI sk-*, GitHub ghp_, PEM private keys, etc.; generic secret shapes (bare `password=`, `secret` values) are intentionally out of scope — conservative design to avoid false positives. See [LIMITATIONS A2](./docs/LIMITATIONS.md#a2-密钥检测局限编码与格式绕过v125-披露).

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent-audit blocks a .env commit" width="860" />
</p>

**Full install** (Node.js ≥ 18, download and review before running):

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.3.7/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # review the script first, confirm it's safe
bash bootstrap.sh && rm bootstrap.sh
sofagent-audit --init      # install the git hook — every commit is audited from now on
sofagent-audit --doctor    # verify the environment (optional)
```

> 💡 All install scripts only write to `~/.sofagent/` and never touch system files. `--no-verify` can bypass the local hook — sofagent guards against honest Agents' carelessness, not deliberate bypass; for high-security scenarios add `sofagent-audit --diff` on the CI side as a backstop. See [LIMITATIONS](./docs/LIMITATIONS.md).
>
> 📌 **install.sh is the enterprise device installer** — install it on the server/computer running the AI nodes, where it acts as the Agent's monitoring constraint layer (audit + rollback + injection + daemon inspection + single-machine dashboard). FDEs do not need to run install.sh on their own machines — the FDE's tools are [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent) (the methodology). See [deployment architecture](./docs/ARCHITECTURE.md#安装包边界与部署架构v132-定位校准).
>
> 📌 **How bootstrap.sh and install.sh relate**: bootstrap.sh is a one-line download wrapper around install.sh — `curl bootstrap.sh | bash` is equivalent to "download install.sh + run install.sh". Both scripts install exactly the same thing; bootstrap just saves you the manual clone/download step.

More install options (clone install / full npx install / minimal install / enterprise deployment) in [HANDBOOK](./docs/HANDBOOK.md). Enterprise users who just want the FDE methodology for mapping workflows, see [FDE/README.md](./FDE/README.md) (zero dependencies, no Node.js needed).

## FDE Methodology

Many companies adopt AI the wrong way around — they pick models, build platforms, and buy Agents first, only to find nobody uses them. The problem isn't the technology; it's that **they haven't figured out their own business processes before handing them to AI**.

Most tools teach you how to build Agents; sofagent first answers **where AI should go** — turning the five-element deep-dive and three-question triage from guesswork into a repeatable methodology:

| Phase | What happens | Deliverable |
|------|--------|------|
| ① Map | **Five-element deep-dive** — for each process step, capture input / output / owner / time cost / pain points | Enterprise profile |
| ② Triage | **Three-question triage** — which steps fit AI: 🔄 automate · ⚡ augment · 👤 leave alone, prioritized by ROI | Node plan + annual savings |
| ③ Deliver | **Three-layer deliverables** — documents + Skills + runtime, so AI nodes actually run | Ontology + workflow.yml + skills/ |

Full methodology (four phases, twelve steps) in [FDE/GUIDE.md](./FDE/GUIDE.md) — a half-day read, enough to run FDE independently afterwards.

## FDE Skill System

Deploying AI nodes is only step one — above we covered **how to map and where to place them**; next is **how to keep them on track every time**. The FDE Skill system loaded with each node solves this:

- 📜 **SKILL.md** — the single entry point, loaded by your AI tool: routes to the matching stage sub-Skill, and auto-injects job specs by task type (mapping / audit / orchestration)
- 🧩 **Stage sub-Skills** — a five-step closed loop: entry → discovery → quantify → deliver → exit (`01-entry` → `05-exit`), with every step's tasks and deliverables defined upfront
- 🔒 **Harness constraint skeleton** — entry-gate / fde-template / engage / loop-check / task-closure…, a constraint template for every step from entry to departure
- 🧬 **Automatic experience capture** — think.md reflection + knowledge maintenance; lessons from every task flow into the knowledge base automatically, with evolution capabilities under continuous iteration

> What gets deployed is not a bare Agent, but an **Agent with a constraint skeleton** — constraints are advisory, audits are mandatory: the Agent may ignore the constraints, but every change gets audited without exception.

## Product Preview

<p align="center">
  <img src="docs/assets/dashboard.png" alt="sofagent Dashboard cockpit" width="100%" />
</p>

<p align="center"><sub>Dashboard cockpit: rule pass rate, audit tasks, violation trends — see at a glance what the AI is doing.</sub></p>

> 📊 **The Dashboard has three entries, each in its place**:
>
> | Entry | Command | Form | Who it's for |
> |------|------|------|--------|
> | **Terminal** | `sofagent-dashboard --full` | Terminal ASCII three-pane (zero frontend dependencies) | Developers / FDE quick check |
> | **Web** | `node tools/serve-dashboard.mjs` | Browser visualization (localhost:3780) | Boss / IT visual review |
> | **macOS double-click** | Double-click `start-dashboard.command` | macOS shortcut to the Web version (macOS double-click entry only) | macOS users |
>
> ⚠️ **The Dashboard is an ops panel for existing users, not a first-time experience entry.** Its data source is the audit records under `~/.sofagent/data/` — without having run `sofagent-audit` there is no data (the Web version falls back to sample data). First time here? Run `npx -y -p @sofagent/audit sofagent-audit` in your project first — the Dashboard only shows real data after that.

## Three Entries, from 30 Seconds to Full Deployment

No need to commit to the full package up front — start with a 30-second trial, then go deeper if it's useful:

```mermaid
graph LR
    A["Individual<br/>npx -y -p @sofagent/audit sofagent-audit<br/>30-second zero-setup audit"] --> B["Team<br/>Rule marketplace + GitHub Action<br/>PR auto-audit"]
    B --> C["Enterprise<br/>FDE Agent<br/>full deployment · 7×24 self-running"]
```

| Entry | What it does | Time needed |
|------|--------|:----:|
| **`npx -y -p @sofagent/audit sofagent-audit`** | Zero-setup audit of the last commit, results in seconds (first npx ~30s) | 30 sec |
| **`--ruleset` rule marketplace** | Load rulesets like security, or use custom JSON rules | 1 min |
| **GitHub Action** | Auto-audit every PR, violations annotated on the diff lines | Set up once |
| **FDE Agent** | Map workflows on-site → deploy AI nodes → 7×24 self-running | FDE residency |

**Rule marketplace**:

```bash
npx -y -p @sofagent/audit sofagent-audit --list-rulesets      # see available rulesets
npx -y -p @sofagent/audit sofagent-audit --ruleset security   # load the security ruleset
```

Community rulesets are published as `sofagent-ruleset-*` npm packages and auto-discovered once installed; `--ruleset-path` can also point to your own JSON rules.

**FDE Agent** — on-site mapping + deployment + residency, pick either of two paths:

- **Methodology path** (zero dependencies): read [FDE/GUIDE.md](./FDE/GUIDE.md) and map workflows manually following the handbook — Excel + your own brain is enough
- **Tooling path** (Node.js ≥ 18): after installing, tell your AI tool "run an FDE diagnosis for me" and the Agent guides you from the entry phase

## New in v1.3.7

> 🏰 **v1.3.7 new capabilities** (SubAgent full sandbox + scenario-driven permissions + AgentShield + industry overlays + circuit breaker + ontology lifecycle):
> - **SubAgent full sandbox**: 🏰 virtual filesystem (writes land in a virtual layer first, atomically merged after approval + HMAC-chained evidence stream) / network egress whitelist (DNS tunneling + raw sockets all intercepted; domain-suffix + CIDR) / tool-call mediation (Symbol unique-ID verdicts, unregistered = fail-closed) / virtual keys (vk- prefix + scope data-flow contract + token-bucket rate limit + log masking) / AsyncSubAgent standalone process (stdout JSON lines + SIGINT graceful shutdown) / true real-time A/B dual-run (parallel in isolation + line-level diff) — the full prerequisite for v1.3.8 `sandbox:true`
> - **Scenario-driven permissions**: 🔐 identity → scenario match → risk level → allow/deny/human approval, every step logged to decision-log; three DSH hard constraints (fail-closed / guard before event dispatch / least privilege); sensitive domains auto-escalate (audit-data writes/deletes always critical)
> - **AgentShield five scans**: 🛡️ MCP config risk profiling / hook injection analysis / agent config review (negative-lookahead assertions exclude "do-not-ignore" phrasing) / enhanced secret detection / **Shadow AI discovery** (scans processes/configs/repos for unregistered "shadow agents") — static & deterministic, zero LLM self-assessment
> - **Four industry overlays**: 🏥 fintech (AML trails) / medical (PHI protection) / government (grade-keeping) / ai (model registration) — auto-loaded from context.md `industry:`; conservative default when untagged
> - **Circuit breaker + behavior monitoring**: ⚡ consecutive-failure tripping with cooldown half-open probing (ASI08) / three-metric sliding window isolating runaway agents back to human control (ASI10, sandbox-linked: isolated agents take no new tasks)
> - **Ontology lifecycle**: 🌳 branch/trunk lifecycle + review gate `migrateToTrunk` (approver required) + OKF trio (mandatory type / stale_after trust freshness / verified human>process tiering)
> - **Adaptive review-loop concurrency**: ⚙️ concurrency from a physical-memory budget table (8GB→1 … ≥48GB→6) + OOM tripping degradation; all LLM calls timeout+retry protected
> - **26 independent-review bugfixes**: 🛡️ all four 16-perspective review rounds fixed (verify-commit whitewash chain / installer-chain broken links / gate three-state — 4 P0s rooted out + four red-team defense upgrades)
>
> See [v1.3.7 devlog](./docs/changelog/v1.3/v1.3.7.md). Earlier versions in [CHANGELOG](./CHANGELOG.md).

## Why sofagent

| Dimension | Generic Agent frameworks | sofagent |
|------|----------------|----------|
| Core question | How to build an Agent | **Where AI should go** (map first, then deploy) |
| Safety guarantee | Relies on prompt constraints | git diff hard-evidence audit + runtime interception + one-click rollback |
| Review model | Manual human review (bottleneck) | **Machine review** — 24 rules auto-audit + git diff hard evidence; even fully autonomous AI nodes get reviewed |
| Knowledge accumulation | Starts from zero | Experience auto-captured into knowledge base, continuously optimized |
| Data sovereignty | Cloud-hosted | Local by default, optional federated queries |
| Deployment | Learn a new platform | Runs inside your existing AI tools (Claude Code / Cursor / WorkBuddy…) |

## Evidence & Credibility

> 🔬 **Independent external evidence** (not an official self-test): Joel Niklaus' harness-optimization research ([research code repository](https://github.com/JoelNiklaus/harness-optimization), data in the repo experiments) shows that with the same model and unchanged weights, optimizing only the outer harness lifted a legal-Agent benchmark from **63.4% → 80.1% (+16.7pp)**. See [THANKS.md](./docs/THANKS.md).

> 🧪 **Engineering credibility**: 2655 tests / 13 packages (12 with tests) (verified via `tools/test-count.sh`; built-in flaky retry, script verdict is authoritative) · 24 audit rules · fresh-eyes independent review continuously running (see [docs/guides/review-system.md](./docs/guides/review-system.md) for how the review system works).

## Docs

| You want to know | Where |
|:---------|:--------|
| How to install, use, FAQ | [HANDBOOK](./docs/HANDBOOK.md) |
| Architecture (constraint layer · injection chain · evolution · 24 rules) | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| Design philosophy | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| Industry validation & ecosystem positioning (differences from existing tools) | [VALIDATION](./docs/VALIDATION.md) |
| Version roadmap | [ROADMAP](./docs/ROADMAP.md) |
| What each version delivered | [CHANGELOG](./CHANGELOG.md) |
| FDE diagnostic methodology (four phases, twelve steps) | [FDE/GUIDE.md](./FDE/GUIDE.md) |
| Security statement · known limitations | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
| Contribution guide | [CONTRIBUTING](./CONTRIBUTING.md) |

---

<p align="center">
  Issues and PRs welcome, especially the nitpicky kind · <a href="./CONTRIBUTING.md">Contributing</a> · <a href="./docs/THANKS.md">Thanks</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">Kong Fangxun</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ If sofagent helps you, star it and help more people find it</a></sub>
</p>
