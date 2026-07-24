# Evidence.md — Does sofagent actually work?

> ⚠️ `ao compose` was a pre-v1.0.7 command and is now retired. Use `sofagent-orchestrator compose` for orchestration.

> ⚠️ **English version is a full snapshot (up to Case 025, July 6).**
> For the latest cases, see [中文版](./evidence.md).

> We don't answer for you. Below is what people who installed sofagent have reported.

> ⚠️ **Honest disclosure**: The data below includes the author's own testing. Reflection scores are LLM self-assessments (no engineering isolation on non-OpenClaw platforms). For enterprise evaluation, wait for v0.9 encryption + external evaluator. Current data is suitable for exploratory assessment only — not production decisions.

> ⚠️ **Since v0.99.2**: benchmark.sh has been removed. The data below is from v0.92-v0.93 historical experiments. For deployment validation, use `bash engine/scripts/verify.sh --quiet` (all checks green = pass). The benchmark system will be rebuilt in v1.x.
>
> 📊 **A/B benchmark data**:
>
> **v0.93 OpenClaw 10-Group Control Experiments**: 4 tasks × 2 conditions (with/without sofagent) × independent sessions. **Key finding: harness layer increment = f(trap difficulty)**. On the high-difficulty "same-name semantic confusion" scenario (Task 1 camelCase→snake_case), sofagent group had 0% false modification rate (0/7) vs bare agent 100% (7/7). On precise-instruction scenarios (Task 3/4), no significant difference. Task 2 (code analysis) sof-1 anomaly (1/4 bugs found) needs larger sample confirmation. ⚠️ Methodology note: sofagent condition used prompt-prefix injection of 4 core rules (not real Skill loading chain), which may underestimate actual effects. See [Task 2-4 Experiment Summary](./benchmark/2026-06-26-openclaw-task2-4-summary.md).
>
> **v0.92 OpenClaw Control Experiment**: Same model, independent sessions, Task 1 (camelCase → snake_case). Sofagent group: 0% variable over-modification (0/7). Bare agent group: 100% over-modification (7/7). Discipline +2, first-pass rate unchanged. See [OpenClaw Task 1 Control](./benchmark/2026-06-25-openclaw-task1-control.md).
>
> **v0.81-v0.83 Historical Data**: Five A/B datasets. Constraint layer: WorkBuddy dialog mode showed only 1/10 clear increment, CLI one-shot 0/16 complete failure (see [Anti-case 002](./anti-cases/002-cli-one-shot-ineffective.md)). Independent tester's code refactor A/B measured harness layer increment: discipline 8→10 (+2), first-pass rate 60%→100% (+40%), but knowledge transfer effect was not excluded (see [Anti-case 001](./anti-cases/001-benchmark-self-test-circularity.md) and [WorkBuddy A/B warning](./benchmark/2026-06-23-workbuddy-ab.md)).

---

## Minimal evidence template

> First time? Just fill in 3 numbers and 1 sentence. Takes less than a minute.

| Metric | Your answer |
|------|------|
| Days used | __ days |
| Times the agent went off-rails | __ times |
| How many were caught by sofagent | __ times |

**One-sentence takeaway**: ___

> Even a single data point matters — this is how sofagent moves from "proof of concept" to "actually useful."

---

## Evidence dashboard

> Users with >1 week of continuous use: pending count. If you're using sofagent daily — not just testing — tell us how long.
>
> (Note: Case 016-019 original deployment reports/workflow.yaml are on enterprise intranets. Contact the maintainer to obtain.)

| Date | Tester | Platform | Duration | Tasks | Installed? | Any change? | Token usage | Issues | One-line conclusion |
|------|------|------|------|:--:|:--:|------|------|------|------|
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | One-off test | 1 | ✅ Yes | Mechanism verified (A0+orchestration+3 checkpoints+closure), actual effect TBD | ~27K/task | Missing markdown module→auto-install retry (+30s) | **First third-party full-flow test: 28min complex travel plan, 6 output files, Loop 3 checkpoints 100% pass (agent self-assessed, not human-verified). See [Case 001](./cases/italy-travel-2026-06-18/).** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | One-off test | 1 | ✅ Yes | Closure loop verified (task/logs+think.md), loading chain L1 missed | ~15K/task | constitution/ dual-file naming ambiguity→agent skipped constitution layer | **Author self-test: WorkBuddy closure mechanism works, but L1 loading chain missed (fixed in v0.56). See [Case 002](./cases/workbuddy-self-test-2026-06-18/).** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | One-off test | 8 | ✅ Yes | Full chain: 3-layer loading + ao compose sub-agents + loop-check closure + **cross-task reflection verified** (TC05 PASS) | ~26K/task | ① load-chain.sh incompatible with openclaw.json new architecture (P0 fixed) ② parallel report not saved ③ scoring not refreshed per task | **Case 003: v0.64 dev full-chain E2E + cross-task reflection verification. Task1 wrote reflection → Task2 new session explicitly referenced "think.md indicates path mismatch likely", proving reflection persisted across sessions. See [Case 003](./cases/openclaw-e2e-2026-06-19/) and [testing.md](../guides/testing.md) TC05.** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | One-off test | 10 | ✅ Yes (with script workarounds) | Notable improvement: first-attempt success rate 0%→100% (10/10) | Not collected | ① install.sh Codex branch SOFAGENT_DATA uninitialized (P0 fixed) ② verify.sh incorrectly checking OpenClaw hooks (P0 fixed) | **Case 004: First Codex platform third-party test. 1 fully auditable run + 9 user-confirmed equivalent samples, all 10 consecutive tasks passed first attempt. See [Case 004](./cases/codex-stability-2026-06-20/).** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | One-off test | 16 tests | ✅ Yes | **Full-stack verification**: constraint layer 5/5 + orchestration engine link functional + ao compose (API) working + template injection normal | ~49K/session | ao compose CLI provider failed across 3 models (YAML incompatibility); checkpoints rely on agent compliance | **Case 005: v0.71 full-stack verification passed. 2 improvement points identified: provider compatibility + checkpoint discipline. See [Case 005](./cases/workbuddy-constraint-ao-test-2026-06-20/).** |
| 2026-06-20 | KongFangXun | OpenClaw Desktop + CLI (DeepSeek) | One-off test | 6 constraints + 3 orchestration + ao compose | ✅ Yes | **Dual platform all-pass**: OpenClaw Desktop Hook loading chain 100% + WorkBuddy Agent self-loading chain 100%. v0.71 task access rejection first triggered | ~35K/session | Expired API key caused silent ao compose failure (key replaced); engine.md missing install hint | **v0.71 dual-platform runtime test all passed. Non-OpenClaw platform loading chain hit rate improved from historical 0-33% to current 100% (single sample). See [testing.md](../guides/testing.md) Cases 9-12.** |
| 2026-06-22 | @liudi8785-cell | OpenClaw (v0.82) | One-off test | 8 dimensions | ✅ Yes | **8/8 all passed**: Hook loading chain 100% + system-level circuit breaker + session.spawn evaluator isolation | — | daemon-status.sh showed stopped (process actually running); old hook residue | **OpenClaw is the only platform passing all dimensions. verify.sh 41 pass 0 fail. See [Case 007](./cases/openclaw-v082-2026-06-21/).** |
| 2026-06-22 | @yeqingan | WorkBuddy (v0.82) | One-off test | 8 dimensions | ❌ No | **Governance hardening all failed**: scripts/ missing, step gate/circuit breaker/idempotency check all degraded to prompt-level self-discipline | — | v0.52 skill excludes scripts/ directory (🔴 P0); evaluator isolation ❌ self-assessed | **WorkBuddy is a "well-behaved prompt framework" — can load SKILL.md but script-level governance unavailable. See [Case 008](./cases/workbuddy-v082-2026-06-22/).** |
| 2026-06-22 | @kangjianrong | Codex (v0.82) | One-off test | 8 dimensions | ✅ Yes (installed) | Installed + loaded, governance via self-discipline | — | verify.sh Skills path stat minor (🟡 medium) | **Codex install smoke test + platform verification passed. codex exec real load test: AGENTS.md → fde.md → SKILL.md loaded, correctly answered 4 bottom-line rules. See [Case 009](./cases/codex-v082-2026-06-22/).** |
| 2026-06-22 | @cedric123123 | Hermes Agent (v0.82, deepseek-v4-pro) | One-off test | 8 dimensions | ❌ No | **4 governance checks all failed**: circuit breaker tested 5 consecutive calls to non-existent API without tripping | — | daemon script missing; engine.md not auto-loaded; think.md not found | **Most honest test. Prompt-level constraints don't work on Hermes Agent. L1+L3 loading exceeded expectations (Agent searched proactively). See [Case 010](./cases/hermes-v082-2026-06-22/).** |
| 2026-06-22 | KongFangXun | Claude Code (v0.82) | One-off test | 8 dimensions | ❌ No | **0/8 hard constraints effective**: scripts/ not deployed, orchestration engine completely failed | — | scripts/ not deployed (🔴); CLAUDE.md seed instructions not written (🟡); daemon doesn't detect claude (🟡) | **Claude Code and Hermes Agent are both "manual platforms". Three breakpoints caused effect = 0. See [Case 011](./cases/claude-v082-2026-06-22/).** |
| 2026-06-24 | @jm4170134-droid (Xiao Jia) | Mac mini (DeepSeek Reasoner, v0.86 tag) | One-off test | 5 tasks A/B | ✅ Yes | **5 dimensions all positive**: trap comments all preserved vs partially removed, exports complete vs missing, first-pass no-bug 5/5 vs 4/5, type strict vs `any` bypass | — | N=1 single run (variance unknown); counterbalanced order (B first A second); non-blind evaluation | **Community third-party A/B: 5 code refactor tasks, sofagent group consistently outperformed bare agent. Same model (DeepSeek Reasoner), only variable is sofagent presence. See [Case 012](./cases/community-ab-test-2026-06-24/).** |
| 2026-06-24 | @cedric123123 | OpenClaw main session (Opus 4.7) | One-off test | task6 + task7 | ✅ Yes | **16/16 perfect score, but data unreliable**: 6 methodology flaws prevent attribution | task6: ~150K / task7: ~226K | 🔴 Actually loaded v0.81-0.85 not v0.86 / 🔴 No control group / 🔴 Model uncontrolled (Opus vs deepseek) / 🟡 N=2 / 🟡 task7 too conspicuous / 🟡 MEMORY.md contamination | **Perfect report ≠ reliable report. task6 type-split 8/8 + task7 Loop exit 8/8, but version mismatch + no control + model confound. Methodology lessons in [Anti-case 003](./anti-cases/003-test-methodology-pitfalls.md).** |
| 2026-07-01 | KongFangXun | WorkBuddy + OpenClaw (deepseek-chat, v0.99) | One-off test | 49 cases + ao compose | ✅ Yes | **Deterministic tests 42/49 passed, 2 P0s (npm pack bundling source + bin no exec permission) fixed on the spot**; ao compose 4-parallel multi-agent review orchestration successful (76s / 57K token), but Agent couldn't auto-read project files, review was simulated | ~58K/session | ao compose Agent lacks file injection (P1); audit-history path mismatch (P2 fixed); MCP duplicate response when uninitialized (P2 fixed); non-git repo no friendly prompt (P2 fixed) | **Case 013: v0.99 pre-release triple-track testing (deterministic + DeepSeek code review + ao multi-agent). Core code all green: 398 tests + tsc zero errors + version 34-consistent + zero-dependency claims accurate + command injection protection. 3 P0 + 10 P1 + 3 P2 all fixed on the spot.** |
| 2026-07-01 | AI Agent (WorkBuddy + OpenClaw auto-executed) | WorkBuddy + OpenClaw 2026.6.8 (deepseek-chat, v0.99.2) | One-off test | 6 TC automated test suite | ✅ Yes | **6/6 all green**: daemon core + verify.sh 50 items + MCP 4 tools + audit 6-step closure + ao 0.7.5 + macOS all green. v1.0 gate 3 conditions ⏳→✅ | ~15K/session | TC-1 daemon needed retry (macOS no timeout command → background process+sleep); install.sh has darwin platform branch gap | **Case 014: v0.99.2 review-driven quality fix + local verification. 18 issues fixed (3 P0 + 9 P1 + 6 P2), 406 tests all green (test count at v0.99.2; current version has grown to 408), version 33-consistent. Tests auto-executed by Agent, zero human intervention. See [Case 014](./cases/v0992-release-test-2026-07-01/).** |
| 2026-07-01 | Enterprise colleague | WorkBuddy (deepseek-chat, v0.99.2) | One-off test | 5 TC targeted violation construction | ✅ Yes | **5/5 100% detection**: A2 secret/A3 out-of-scope/A4 delete-config/A5 commit/E1 missing-test. A3 gatekeeper effect confirmed. Extended rule framework working. | ~3K/session | Targeted construction ≠ real scenario; false positive rate untested; secret regex requires 48 chars | **Case 015: Audit engine detection rate first external test. Enterprise colleague constructed known violations in independent repo, all detected. See [Case 015](./cases/v0992-audit-detection-2026-07-01/).** |
| 2026-07-02 | FDE (Agent-assisted) | OpenClaw (macOS, v0.99.4) | FDE deployment | 71+ workflow nodes + 2 🔄 | ✅ Yes | Manufacturing 200+ employees, 7 departments, 4h to produce full deployment plan + workflow.yaml | — | Needs batch import; soft-skill node classification | **Case 016: Lithium battery manufacturer FDE deployment. See [Case 016](./cases/fde-forever-battery-2026-07-02/).** |
| 2026-07-02 | Cedric (Jinhui) | OpenClaw (Windows, v0.99.4) | FDE deployment | 5 roles 25 nodes + 1 🔄 live | ✅ Yes | 5-person team, 2h to complete ten steps, 1 🔄 node live on DingTalk push. First Windows external verification | — | PowerShell curl alias; UTF-8 encoding for DingTalk | **Case 017: Agritech micro-team FDE deployment — Windows full chain verified. See [Case 017](./cases/fde-jinhui-2026-07-02/).** |
| 2026-07-02 | Xiao Jia (Manjia) | OpenClaw (macOS, v0.99.4) | ~3 weeks (as of Jul 4) | 2 🔄 nodes running daily | ✅ Yes | E-commerce operations: 2 🔄 nodes live (weekly report + reconciliation), ~440-590h/year freed. Running ~3 weeks as of 2026-07-04 | — | Platform anti-crawl limits data access; needs offline install docs | **Case 018: E-commerce FDE deployment — first continuous-use external case. See [Case 018](./cases/fde-manjia-2026-07-02/).** |
| 2026-07-02 | Yao Xuchen (Shangshan) | OpenClaw (macOS, v0.99.4) | FDE deployment | 2 production agents + 1 KB agent planned | ✅ Yes | 2 production agents running for months, FDE deploys new Enterprise KB agent. 10+ docs + Phase 1 code delivered | — | Webhook bot one-way only | **Case 019: Energy tech FDE deployment — extending AI infra with new agent. See [Case 019](./cases/fde-shangshan-2026-07-02/).** |
| 2026-07-05 | KongFangXun | OpenClaw 0.7.5 + WorkBuddy (v0.99.7) | One-off test | 8 scenarios full chain | ✅ Yes | **5/7 core ✅ + 2/7 env-limited**: install 0.39s 48 checks / audit A1+A2 dual detection / loading chain 3 layers / orchestration 74.8s 5 steps / MCP 3 tools+3 resources | — | daemon sandbox blocks pid write; webhook needs real URL; A2 misses sk-proj- new format | **Case 020: v0.99.7 full-chain test — 5 core capabilities (install/audit/loading/orchestration/MCP) all passed. verify.sh expanded to 48 checks. See [Case 020](./cases/v0997-fullchain-test-2026-07-05/).** |
| 2026-07-05 | OpenClaw (for Cedric) | Windows 10 (v0.99.8) | One-off test | 5 extreme scenarios | ✅ Yes | **Audit engine extreme capability verification**: 100 files 8.76s zero false positives / 200KB single-line detection / 4 secret types all caught / 5 modes all passed | — | pre-commit hook hardcoded local path (P1); JSON PowerShell encoding (P2); base64 secret undetected (P3) | **Case 021: Audit engine technical capability verification (Windows extreme test). Not a Gate #7 deliverable — platform/tester/scenario mismatch with external user validation plan. High value as audit detection precision evidence. See [Case 021](./cases/v0998-extreme-audit-test-2026-07-05/).** |
| 2026-07-05 | OpenClaw (for Cedric) | Windows 10 (v0.99.8) | One-off test | 7 comparison groups | ✅ Yes | **With vs without sofagent**: no audit = 5 secrets all committed to git history; with audit = 5/5 all blocked. 100 files 8.76s precise location | — | — | **Case 022: Audit engine value comparison — "without sofagent, secret leakage is not a matter of if, but when it gets discovered". See [Case 022](./cases/v0998-audit-comparison-2026-07-05/).** |
| 2026-07-06 | @cedric123123 | macOS 15.x · Node 24 (v0.99.8) | One-off test | 8 scenarios + 8 extreme | ✅ Yes | **8/8 passed, 8.5/10**: ao compose→run full chain / MCP 9 JSON-RPC / 10K lines 99ms / real enterprise case (Shangshan 11 deliverables) | — | sk-proj- missed (P0 fixed); hook path hardcoded (P0 fixed) | **Case 023: Gate #7 external user validation #1 — full chain + extreme tests + real FDE case. See [Case 023](./cases/v0998-external-cedric-2026-07-06/).** |
| 2026-07-06 | @xue52101-lzk | macOS 23.5 · Node 25 (v0.99.8) | One-off test | 8 scenarios | ✅ Yes | **8/8 passed, 8.5/10**: FDE simulated deployment 14 AI nodes (3 depts ¥700K+/yr) / daemon full logs / ao demo 4 roles | — | — | **Case 024: Gate #7 external user validation #2 — FDE enterprise deployment simulation + daemon full chain. See [Case 024](./cases/v0998-external-lzk-2026-07-06/).** |
| 2026-07-06 | @Atreides-coder (Xiao Jia) | macOS 15.6 · Node 24 (v0.99.8) | One-off test | 8 scenarios + feedback form | ✅ Yes | **8/8 passed, 8.0/10**: Most detailed feedback / found daemon behavior mismatch with docs / install 15s smooth / audit 0 false positives | — | daemon behavior mismatch (P1 docs); hook path hardcoded (P0 fixed) | **Case 025: Gate #7 external user validation #3 — most detailed feedback, found daemon doc mismatch + hook path issue. See [Case 025](./cases/v0998-external-xiaojia-2026-07-06/).** |

> Duration categories: **One-off test** (installed, verified, stopped) / **Continuous use N days** (daily work use) / **Abandoned** (installed but stopped using — **please tell us why, this is the most valuable data**)

---

## Benchmark testing

> Reproducible A/B test results. Run `bash engine/scripts/verify.sh --quiet` (all checks green = ✓).

Historical benchmark records: [benchmark/](./benchmark/) — archived, no longer auto-updated.

---

## Community contributions

Your data. Any format, just be real.

---

## Quantification anchors (v0.95 design anchors — data collection starts v1.0)

> Benchmarking against Andrej Karpathy's "LLM raw coding error rate 41% → 11% after human review" — sofagent's goal is to approach human-review-level quality using harness layer + audit layer without human reviewers.

| Metric | Definition | Baseline (bare Agent) | v0.95 target | Measurement |
|------|------|:--:|:--:|------|
| Agent violation rate | % of tasks triggering ironclad/audit rules | TBD (v1.0 start) | < 11% | A/B control, sofagent vs bare |
| Audit detection rate | % of known issues caught by git-diff rules | 0% (no audit) | > 80% | Manually label violations → run audit → recall |
| False positive red line | Audit reports FAIL but no real issue | — | < 5% | Manual review of each FAIL batch |
| First-pass rate | % of tasks delivered without rework | TBD (v1.0 start) | > 85% | A/B control count |

> ⚠️ The above targets are v0.95 design anchors, not verified data. Metrics marked "TBD" for baseline require independent third-party runs — author self-tests don't count. Data collection starts v1.0.

> 💡 Why 11%? Karpathy's figure is the floor after human review. sofagent's proposition: **can machine auditing replace human review and approach the same floor?** Whether it can is a question for v1.0 to answer — v0.95 just sets up the measurement framework.

> 📌 Industry trend (Loop Engineering) — see [ARCHITECTURE.md](../ARCHITECTURE.md): Ralph Loop is cited as a foundational precursor to Loop Engineering, confirming sofagent's design direction aligns with the emerging industry consensus.
