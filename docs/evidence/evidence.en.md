# Evidence.md — Does sofagent actually work?

> ⚠️ **English version is an early snapshot (up to Case 005, June 20).**
> For the complete 15 cases (Case 001–015 up to July 1), see [中文版](./evidence.md).
> Full English parity is planned for v1.0.

> We don't answer for you. Below is what people who installed sofagent have reported.

> ⚠️ **Honest disclosure**: The data below includes the author's own testing. Reflection scores are LLM self-assessments (no engineering isolation on non-OpenClaw platforms). For enterprise evaluation, wait for v0.9 encryption + external evaluator. Current data is suitable for exploratory assessment only — not production decisions.

> ⚠️ **Since v0.99.2**: benchmark.sh has been removed. The data below is from v0.92-v0.93 historical experiments. For deployment validation, use `bash sofagent/scripts/verify.sh --quiet` (all checks green = pass). The benchmark system will be rebuilt in v1.x.
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

| Date | Tester | Platform | Duration | Tasks | Installed? | Any change? | Token usage | Issues | One-line conclusion |
|------|------|------|------|:--:|:--:|------|------|------|------|
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | One-off test | 1 | ✅ Yes | Mechanism verified (A0+orchestration+3 checkpoints+closure), actual effect TBD | ~27K/task | Missing markdown module→auto-install retry (+30s) | **First third-party full-flow test: 28min complex travel plan, 6 output files, Loop 3 checkpoints 100% pass (agent self-assessed, not human-verified). See [Case 001](./cases/italy-travel-2026-06-18/).** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | One-off test | 1 | ✅ Yes | Closure loop verified (task/logs+think.md), loading chain L1 missed | ~15K/task | constitution/ dual-file naming ambiguity→agent skipped constitution layer | **Author self-test: WorkBuddy closure mechanism works, but L1 loading chain missed (fixed in v0.56). See [Case 002](./cases/workbuddy-self-test-2026-06-18/).** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | One-off test | 8 | ✅ Yes | Full chain: 3-layer loading + ao compose sub-agents + loop-check closure + **cross-task reflection verified** (TC05 PASS) | ~26K/task | ① load-chain.sh incompatible with openclaw.json new architecture (P0 fixed) ② parallel report not saved ③ scoring not refreshed per task | **Case 003: v0.64 dev full-chain E2E + cross-task reflection verification. Task1 wrote reflection → Task2 new session explicitly referenced "think.md indicates path mismatch likely", proving reflection persisted across sessions. See [Case 003](./cases/openclaw-e2e-2026-06-19/) and [testing.md](../guides/testing.md) TC05.** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | One-off test | 10 | ✅ Yes (with script workarounds) | Notable improvement: first-attempt success rate 0%→100% (10/10) | Not collected | ① install.sh Codex branch SOFAGENT_DATA uninitialized (P0 fixed) ② verify.sh incorrectly checking OpenClaw hooks (P0 fixed) | **Case 004: First Codex platform third-party test. 1 fully auditable run + 9 user-confirmed equivalent samples, all 10 consecutive tasks passed first attempt. See [Case 004](./cases/codex-stability-2026-06-20/).** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | One-off test | 16 tests | ✅ Yes | **Full-stack verification**: constraint layer 5/5 + orchestration engine link functional + ao compose (API) working + template injection normal | ~49K/session | ao compose CLI provider failed across 3 models (YAML incompatibility); checkpoints rely on agent compliance | **Case 005: v0.71 full-stack verification passed. 2 improvement points identified: provider compatibility + checkpoint discipline. See [Case 005](./cases/workbuddy-constraint-ao-test-2026-06-20/).** |
| 2026-06-20 | KongFangXun | OpenClaw Desktop + CLI (DeepSeek) | One-off test | 6 constraints + 3 orchestration + ao compose | ✅ Yes | **Dual platform all-pass**: OpenClaw Desktop Hook loading chain 100% + WorkBuddy Agent self-loading chain 100%. v0.71 task access rejection first triggered | ~35K/session | Expired API key caused silent ao compose failure (key replaced); engine.md missing install hint | **v0.71 dual-platform runtime test all passed. Non-OpenClaw platform loading chain hit rate improved from historical 0-33% to current 100% (single sample). See [testing.md](../guides/testing.md) Cases 9-12.** |
| 2026-07-02 | FDE (Agent-assisted) | OpenClaw (macOS, v0.99.4) | FDE deployment | 71+ workflow nodes + 2 🔄 | ✅ Yes | Manufacturing 200+ employees, 7 departments, 4h to produce full deployment plan + workflow.yaml | — | Needs batch import; soft-skill node classification | **Case 016: Lithium battery manufacturer FDE deployment. See [Case 016](./cases/fde-forever-battery-2026-07-02/).** |
| 2026-07-02 | Cedric (Jinhui) | OpenClaw (Windows, v0.99.4) | FDE deployment | 5 roles 25 nodes + 1 🔄 live | ✅ Yes | 5-person team, 2h to complete ten steps, 1 🔄 node live on DingTalk push. First Windows external verification | — | PowerShell curl alias; UTF-8 encoding for DingTalk | **Case 017: Agritech micro-team FDE deployment — Windows full chain verified. See [Case 017](./cases/fde-jinhui-2026-07-02/).** |
| 2026-07-02 | Xiao Jia (Manjia) | OpenClaw (macOS, v0.99.4) | ~3 weeks (as of Jul 4) | 2 🔄 nodes running daily | ✅ Yes | E-commerce operations: 2 🔄 nodes live (weekly report + reconciliation), ~440-590h/year freed. Running ~3 weeks as of 2026-07-04 | — | Platform anti-crawl limits data access; needs offline install docs | **Case 018: E-commerce FDE deployment — first continuous-use external case. See [Case 018](./cases/fde-manjia-2026-07-02/).** |
| 2026-07-02 | Yao Xuchen (Shangshan) | OpenClaw (macOS, v0.99.4) | FDE deployment | 2 production agents + 1 KB agent planned | ✅ Yes | 2 production agents running for months, FDE deploys new Enterprise KB agent. 10+ docs + Phase 1 code delivered | — | Webhook bot one-way only | **Case 019: Energy tech FDE deployment — extending AI infra with new agent. See [Case 019](./cases/fde-shangshan-2026-07-02/).** |

> Duration categories: **One-off test** (installed, verified, stopped) / **Continuous use N days** (daily work use) / **Abandoned** (installed but stopped using — **please tell us why, this is the most valuable data**)

---

## Benchmark testing

> Reproducible A/B test results. Run `bash sofagent/scripts/verify.sh --quiet` (all checks green = ✓).

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

> 📌 Industry trend (Loop Engineering) — see [ARCHITECTURE.md](../../ARCHITECTURE.md): Ralph Loop is cited as a foundational precursor to Loop Engineering, confirming sofagent's design direction aligns with the emerging industry consensus.
