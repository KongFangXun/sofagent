# sofagent Handbook

![sofagent](./sofagent.png)
                                                                                  

> **sofagent is a set of FDE capabilities that you install into your Agent (DSH / OpenClaw / WorkBuddy / Codex / Claude Code). While on-site, it turns business judgment into files; after leaving, it executes them for you: mapping workflows, deploying AI nodes, and auditing every change 24×7.** Once installed, simply tell your Agent what you want in one sentence and it will do the work for you—auditing every change, accumulating every lesson learned, and continuously improving its knowledge and processes through use. This handbook walks through the complete process, from installation and usage to troubleshooting.
> v1.5.0 · 2026-09-19 (UTC) · ✅ Released · Kong Fangxun

---

## Table of Contents

* [Reading Guide](#reading-guide)
* [5-Minute Overview](#5-minute-overview)
* [What Can the FDE Harness Do for You](#what-can-the-fde-harness-do-for-you)
* [Mental Model: Constraint Layer and Lifecycle](#mental-model-constraint-layer-and-lifecycle)
* [Deployment: Install It and Start Assigning Work](#deployment-install-it-and-start-assigning-work)
* [Runtime: Every Change Is Governed](#runtime-every-change-is-governed)
* [Evolution: Knowledge Accumulates Automatically](#evolution-knowledge-accumulates-automatically)
* [Always-On: Long-Term Autonomous Operation and Continuous Optimization](#always-on-long-term-autonomous-operation-and-continuous-optimization)
* [Troubleshooting and Customization](#troubleshooting-and-customization)
* [Related Technology Stack](#related-technology-stack)
* [Acknowledgements](#acknowledgements)
* [Easter Egg](#easter-egg)
* [Phased Rollout (L1→L2→L3)](#phased-rollout-l1l2l3)
* [FDE Deployment Anti-Patterns](#fde-deployment-anti-patterns)

---

## Reading Guide

| Who you are                              | Read first                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Just installed it                        | Deployment → Runtime                                                                                                     |
| Doing day-to-day work                    | Runtime → Troubleshooting and Customization                                                                              |
| Want to change the rules                 | Troubleshooting and Customization · “Rewrite fde.md” section (template: `SKILL/harness/fde-template.md`, approx. 2.6 KB) |
| FDE deployment / continuous optimization | Deployment → Always-On (complete methodology in [FDE/GUIDE.md](../FDE/GUIDE.md))                                         |
| Want to understand the internals         | [Development Documentation](./DEVELOPMENT.md)                                                                            |
| Want to understand the architecture      | [Architecture Documentation](./ARCHITECTURE.md)                                                                          |
| Want to understand why it works this way | [Design Philosophy](./PHILOSOPHY.md) (**strongly recommended, 5-minute read**)                                           |

> 📁 **Project File Navigation**: The 8 `.md` files in the root directory each serve a specific purpose—[README.md](../README.md) (project overview), [README.en.md](../README.en.md) (English overview), [CHANGELOG.md](../CHANGELOG.md) (version index), [SECURITY.md](../SECURITY.md) (security policy), [CONTRIBUTING.md](../CONTRIBUTING.md) (contribution guide), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (code of conduct), [AGENTS.md](../AGENTS.md) (thin Codex adaptation mount, entry point for the four-layer loading chain), and [GEMINI.md](../GEMINI.md) (thin Gemini CLI adaptation mount). [ROADMAP.md](./ROADMAP.md) (roadmap) and [LIMITATIONS.md](./LIMITATIONS.md) (known limitations) are located under `docs/`.

---

## 5-Minute Overview

| What you want to know                         | In one sentence                                                                                                                                                                                                                        | See                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| What is it?                                   | sofagent—a set of FDE capabilities installed into your Agent: on-site, it turns business judgment into files (mapping workflows, building ontology graphs, deploying AI nodes); after leaving, it executes and audits those files 24×7 | [What Can the FDE Harness Do for You](#what-can-the-fde-harness-do-for-you)                                                                    |
| How do I install it?                          | `bash install.sh` (enterprise device installer, installs the foundation + Agent Skill) · `bash install.sh --base-only` (foundation only)                                                                                               | [Deployment: Install It and Start Assigning Work](#deployment-install-it-and-start-assigning-work)                                             |
| How do I use it?                              | Assign tasks immediately after installation; complex tasks are automatically decomposed                                                                                                                                                | [Runtime: Every Change Is Governed](#runtime-every-change-is-governed)                                                                         |
| How do AI nodes run?                          | Developers: `git commit` triggers automatic auditing. Non-developers: v1.0.8+ daemon monitors file changes and audits automatically                                                                                                    | [Deployment: Install It and Start Assigning Work](#deployment-install-it-and-start-assigning-work)                                             |
| AI knowledge base                             | `data/knowledge/` directory, accumulating best practices across tasks; the loading chain injects them passively                                                                                                                        | [Evolution: Knowledge Accumulates Automatically](#evolution-knowledge-accumulates-automatically)                                               |
| How does it run automatically after delivery? | 🔗 Activation Chain (v1.2.5+): read deliverables → register SubAgents → orchestrate → run automatically with approval and auditing                                                                                                     | [Always-On: Long-Term Autonomous Operation and Continuous Optimization](#always-on-long-term-autonomous-operation-and-continuous-optimization) |
| AI maturity                                   | Three levels (Replace → Enhance → Restructure). FDE helps enterprises move from Level 2 to Level 3—not just installing AI, but installing accountability mechanisms as well                                                            | [FDE/GUIDE.md](../FDE/GUIDE.md#19-企业-ai-成熟度三级台阶)                                                                                               |
| Known limitations                             | Core results are documented in [evidence.md](./evidence/evidence.md); retrospective LLM self-evaluation; plaintext storage                                                                                                             | [LIMITATIONS.md](./LIMITATIONS.md)                                                                                                             |

---

## What Can the FDE Harness Do for You

> This section starts with **value**, then explains **how to use it**. sofagent is not a toolkit; it is an **FDE Harness layer**—embedded between mature Agents (DSH / OpenClaw / WorkBuddy / Codex / Claude Code) and the model layer. It constrains execution, governs the source of intelligence, and turns large language models into AI nodes that can execute work 24×7 for enterprises (product form = FDE Harness layer; see [WIKI Product Narrative](./WIKI.md#二产品叙事sofagent-是-fde-harness-层不造-agent嵌在-agent-与模型之间做治理)). See [ARCHITECTURE · Capability and State Overview](./ARCHITECTURE.md#能力与状态总览) for the complete capability matrix.

**What it can already do for you** (grouped into two phases—generating judgment on-site / retaining and executing judgment after departure):

**On-site — turn judgment into files:**

* **Map workflows and quantify value**: Deep-dive into the five FDE elements + the Three Questions assessment to understand every step of a role, identify automatable processes, and calculate the value of each AI node.
* **🧩 FDE Six-Engine Workbench** (v1.4.2): `fde_interview` (structured interviews) / `fde_classify` (Three Questions assessment) / `fde_quantify` (quantification + ROI) / `fde_derive` (ontology derivation) / `fde_distill` (three-layer distillation) / `fde_deploy` (assembly and deployment)—turning the FDE methodology from documentation into executable modules (MCP tools), with artifacts written to `data/fde/` and independently audited; the IM bridge for remote control (`dsh-im`) lets FDE work on headless devices as well.
* **Deploy AI nodes and freeze judgment**: Three-layer deliverables (documentation layer + Skill layer + runtime layer), with every node carrying a “definition of done (`merge_criteria`) · who makes the decision (`approver`)”. Install them into your existing AI tools and go from “you do the work” to “you assign the work”.

**After departure — execute and audit based on files:**

* **Every change is governed**: 24 hard-evidence audit rules inspect every change; secret leakage / out-of-bounds editing / injection attacks / blind modifications are blocked immediately. One-click rollback to any safe state is available when something goes wrong.
* **🔗 Activation Chain**: After FDE diagnosis and delivery, `ontology + workflow.yml + skills/` are no longer a collection of static files sitting on disk—the Activation Chain automatically reads the deliverables → registers enterprise SubAgents → orchestrates them into a LangGraph workflow → runs automatically with human approval (HITL) and auditing. It transforms “handing an enterprise a pile of documents” into “handing an enterprise a system that can run itself” (ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN, the complete four-stage delivery). See the [Activation Chain Design Document](./guides/fde-activation-chain.md) for details.
* **Knowledge grows automatically**: Dream Cycle turns every task into enterprise knowledge-base entries + Ontology data. The more you use it, the better it understands your business.
* **🎓 Training data and evaluation** (v1.4.2): Enterprise heterogeneous data (CSV/Excel/DB/API) enters the training set through a pipeline (quality gate + de-identification at the training entry); `dataset_version` provides version tracking (fingerprint freeze + version locking for resumed runs); in-training eval closes the loop (externally configured continue/stop thresholds); train env/doctor performs environment checks; dry-run estimates VRAM usage + ScaleRL extrapolates compute requirements; training reports (customer-readable Markdown + four quantified ROI fields). See the [v1.4.2 Development Log](./changelog/v1.4/v1.4.2.md).
* **📡 Training signals and deployment loop** (v1.4.4): `corpus_export` provides a three-part corpus export suite (rules / FDE methodology / labeled samples, 27 numbered slots + reward skeleton + de-identified aggregation); enterprise-specific models can be deployed from local weights (`model_register source: 'local-path'` + SHA-256 tamper rejection + `rollback-weights` version rollback); training artifacts automatically connect to registration (train done + eval pass → `model_register`); `train compare` ranks ROI across multiple base models; decision causal chains and precedent retrieval (`causedBy` causal edges); CI supply chain fully SHA-pinned + dashboard completely offline. See the [v1.4.4 Development Log](./changelog/v1.4/v1.4.4.md) for details.
* **🔍 Deep engine capabilities**: Official AST rules engine (`sofagent-ruleset-ast`, ASI01 goal hijacking + ASI04 supply-chain SBOM semantic detection); meta-harness for unified multi-harness orchestration (policy enforcement pushed down to the infrastructure layer, cross-session collaboration); AI work-detail data layer (`worklog` by Agent/Workflow/week + human intervention, `worklog_query` MCP); API-level governance (`@public`/`@internal`, 1439 symbols + CI gates); MLflow agent evaluation (13 metrics + LLM-as-Judge); Agentic Browser (4 tools + visual fallback); cross-platform adapters (Cursor/Codex/Gemini CLI); ATTRIBUTION attribution + Dream Sandbox sandbox auditing (mandatory human review before merge + path-traversal sanitization); >5MB diff gap fixes. See the [Development Log](./changelog/v1.3/v1.3.9.md) for details.

**Throughout — foundation capabilities independent of phase:**

* **Platform-independent, plug-and-play**: Embedded between your chosen major-agent platform (Claude Code / Codex / WorkBuddy / 扣子 / OpenClaw) and the model layer. It does not replace the model; it only adds “reliable execution”—constraining the Agent and governing the model. (Cursor community validation is ongoing; for the complete host-tier matrix, see [README · Multi-Platform Mounting](../README.md))
* **Portable and collaborative**: One-click USB provisioning (plug in and use, zero residue when removed); encrypted federated cross-device inspection; built-in `@sofagent-fde` + `@sofagent-audit` dual Agents.
* **📚 Five-capability narrative finalized** (v1.4.4): Injection · Audit · Rollback · Distill · Evolve—the five terms are standardized across the site (the fifth capability is “Distill” in English), and “本体结构” is consistently referred to as “Ontology data”.

> 📌 For detailed version evolution, see [CHANGELOG](../CHANGELOG.md). Capabilities have already been integrated into the current version and are not listed version by version here.

**What it still cannot do (planned, no code yet)**: Local inference with small models (offline USB node integration, v2.0.0); multi-tenancy v0 has already delivered data-path and identity-ownership isolation (`data/<tenant>/` + orgId, v1.4.7), while tenant-level authentication/quotas/cross-tenant policies/write-side isolation remain planned for v1.5.x/v2.x—see [ROADMAP](./ROADMAP.md).

---

## Mental Model: Constraint Layer and Lifecycle

Think of sofagent as a **Harness layer embedded between the Agent you choose and the model**—it does not build its own Agent or model; it simply makes every execution reliable and auditable, while governing each model (registration / canary rollout / training / deployment traceability).

Use a river analogy to remember it:

* **Major-provider LLMs = raw water**: 90% of the intelligence comes from them; sofagent does not make its own water.
* **Major-provider Agent platforms = riverbed**: unified entry points (Claude Code / Codex / WorkBuddy / OpenClaw); sofagent does not build the riverbed.
* **sofagent Constraint Layer = dam + water treatment plant + pipeline + faucet (5 core capabilities implemented) + water meter (auditing implemented, terminal Dashboard v1.2.3 delivered)**:

  * 🧱 **Dam (Constraint Layer)** — the four-layer loading chain locks behavioral boundaries into every conversation
  * 🏭 **Water Treatment Plant (Sandbox Security)** — turns raw water into “drinking water” by isolating dangerous operations in a sandbox
  * 🔧 **Pipeline (Audit Module)** — every change goes through 24 rules of review
  * 🚰 **Faucet (Business SubAgent)** — the node that actually performs business work; different “faucets” can be connected for different business needs
  * 📊 **Water Meter (Audit)** — every change is visible and can be rolled back (terminal Dashboard v1.2.3 delivered)

At the code level, this becomes a **two-layer architecture: Constraint Layer × Lifecycle**:

|                 Layer                 | What it is                                                                                                                                                                                                                                                                                                                                                           | In one sentence                                          |          Status         |
| :-----------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | :---------------------: |
|     **Layer 1 · Constraint Layer**    | Five Constraint Layer capabilities (Injection · Audit · Rollback · Distill · Evolve)                                                                                                                                                                                                                                                                                 | How to ensure every execution is done correctly          |       ✅ Delivered       |
| **Layer 2 · Lifecycle (five stages)** | Diagnose → Activate → Orchestrate → Execute → Evolve (the four Activation Chain stages = Activate→Orchestrate→Execute→Evolve ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN, the latter four loops of the five-stage lifecycle; the fifth-stage name shares the same “Evolution” concept as the fifth Constraint Layer capability, while SUSTAIN remains unchanged in English) | How enterprise AI moves from diagnosis to self-operation | 🔗 Phases 1-4 delivered |

**Layer 1 · Constraint Layer (five capabilities):**

| Role             | Module                                                                                                                                                                            | What it governs                                                                                          | Trigger                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 🧱 Foundation    | **Constraint Layer** (`harness`)                                                                                                                                                  | Injects rules through the four-layer loading chain; takes effect as soon as the Agent starts             | Platform Hook (OpenClaw) / DSH plugin / SubAgent self-loading |
| 🔍 Module ①      | **Audit Module** (`audit`)                                                                                                                                                        | Hard-scans `git diff` against 24 rules and blocks violations immediately                                 | `git commit` / daemon file changes                            |
| 🔄 Module ②      | **Rollback Module** (`core`)                                                                                                                                                      | Automatically snapshots after auditing; one-click rollback if something goes wrong                       | Automatically after audit                                     |
| ⚙️ Internal Tool | **FORGE Toolchain** (`orchestrator`)                                                                                                                                              | LOOP pipeline (used for project self-iteration, not an external module)                                  | CLI compose tool                                              |
| 🧬 Module ③      | **Evolution Module** (`think.md` reflection + Dream Cycle knowledge feedback + evolve Skill optimization; eval/ab-test provide evaluation support; driven periodically by daemon) | Knowledge accumulation + reflection + self-optimization; the accumulation mechanism iterates through use | daemon cron / manual trigger                                  |

**Layer 2 · Lifecycle (Activation Chain, v1.2.5+ Phases 1-4 delivered):**

| Loop | Stage                                    | What it does                                                                                                                       |
| :--: | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
|   ①  | **Diagnosis** (FDE four stages)          | Generate judgment on-site: map workflows, build ontology graphs, identify AI nodes, and deliver three-layer entities (✅ delivered) |
|   ②  | **Activation** ACTIVATE (v1.2.5)         | Read deliverables → register enterprise SubAgent                                                                                   |
|   ③  | **Orchestration** ORCHESTRATE (v1.2.6-7) | Multiple Agents → StateGraph workflow                                                                                              |
|   ④  | **Execution** EXECUTE (v1.2.8-9)         | DAG execution + human approval (HITL) + audit integration                                                                          |
|   ⑤  | **Evolution** SUSTAIN (v1.3.0)           | Reflection + feedback, feeding the next round of diagnosis                                                                         |

> Constraint Layer (Injection) + Audit / Rollback / Distill / Evolve = a full lifecycle that is **auditable, rollbackable, accumulative, and evolvable**. The Activation Chain builds on this foundation to move enterprise AI from “a pile of documents delivered after diagnosis” toward “self-operating”. FORGE is an internal project development toolchain for self-iteration. See [ARCHITECTURE · Two-Layer Architecture](./ARCHITECTURE.md#双层架构约束层与生命周期主框架) and the [Activation Chain Design Document](./guides/fde-activation-chain.md) for the complete design.
