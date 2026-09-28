# Evidence.md — Does sofagent actually work?

> ⚠️ `ao compose` was a pre-v1.0.7 command and is now retired. Use `sofagent-orchestrator compose` for orchestration.

> ⚠️ **English version is a full snapshot (up to Case 025, July 6).**
> For the latest cases, see [中文版](./evidence.md).

> We don't answer for you. Below is what people who installed sofagent have reported.

> ⚠️ **Honest disclosure**: The data below includes the author's own testing. Reflection scores are LLM self-assessments (no engineering isolation on non-OpenClaw platforms). For enterprise evaluation, wait for v0.9 encryption + external evaluator.
> Current data is suitable for exploratory assessment only — not production decisions.

> ⚠️ **Since v0.99.2**: benchmark.sh has been removed. The data below is from v0.92-v0.93 historical experiments. For deployment validation, use `bash engine/scripts/verify.sh --quiet` (all checks green = pass). The benchmark system will be rebuilt in v1.x.
>
> 📊 **A/B benchmark data**:
>
> **v0.93 OpenClaw 10-Group Control Experiments**: 4 tasks × 2 conditions (with/without sofagent) × independent sessions. **Key finding: harness layer increment = f(trap difficulty)**.
> On the high-difficulty "same-name semantic confusion" scenario (Task 1 camelCase→snake_case), sofagent group had 0% false modification rate (0/7) vs bare agent 100% (7/7). On precise-instruction scenarios (Task 3/4), no significant difference.
> Task 2 (code analysis) sof-1 anomaly (1/4 bugs found) needs larger sample confirmation. ⚠️ Methodology note: sofagent condition used prompt-prefix injection of 4 core rules (not real Skill loading chain), which may underestimate actual effects. See [Task 2-4 Experiment Summary](..
> /archive/evidence/2026-06-26-openclaw-task2-4-summary.md).
>
> **v0.92 OpenClaw Control Experiment**: Same model, independent sessions, Task 1 (camelCase → snake_case). sofagent group: 0% variable over-modification (0/7). Bare agent group: 100% over-modification (7/7). Discipline +2, first-pass rate unchanged. See [OpenClaw Task 1 Control](..
> /archive/evidence/2026-06-25-openclaw-task1-control.md).
>
> **v0.81-v0.83 Historical Data**: Five A/B datasets. Constraint layer: WorkBuddy dialog mode showed only 1/10 clear increment, CLI one-shot 0/16 complete failure (see [Anti-case 002](./anti-cases/002-cli-one-shot-ineffective.md)).
> Independent tester's code refactor A/B measured harness layer increment: discipline 8→10 (+2), first-pass rate 60%→100% (+40%), but knowledge transfer effect was not excluded (see [Anti-case 001](./anti-cases/001-benchmark-self-test-circularity.md) and [WorkBuddy A/B warning](..
> /archive/evidence/2026-06-23-workbuddy-ab.md)).

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
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (engineering model) | One-off test | 1 | ✅ Yes | Mechanism verified (A0+orchestration+3 checkpo (→n2) | ~27K/task | Missing markdown module→auto-install retry (+30s) | **First third-party full-flow test: 28min comp (→n1) |
| 2026-06-18 | KongFangXun | WorkBuddy (engineering model) | One-off test | 1 | ✅ Yes | Closure loop verified (task/logs+think.md), loading chain L1 missed | ~15K/task | constitution/ dual-file naming ambiguity→agent (→n3) | **Author self-test: WorkBuddy closure mechanism works, b (→n2) |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (engineering model) | One-off test | 8 | ✅ Yes | Full chain: 3-layer loading + ao compose sub-a (→n4) | ~26K/task | ① load-chain.sh incompatible with openclaw.json new arch (→n3) | **Case 003: v0.64 dev full-chain E2E + cross-t (→n5) |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | One-off test | 10 | ✅ Yes (with script workarounds) | Notable improvement: first-attempt success rat (→n6) | Not collected | ① install.sh Codex branch SOFAGENT_DATA uninitialized (P (→n4) | **Case 004: First Codex platform third-party test. (→n4) |
| 2026-06-20 | KongFangXun | WorkBuddy (engineering model + ao compose via API) | One-off test | 16 tests | ✅ Yes | **Full-stack verification**: constraint layer (→n8) | ~49K/session | ao compose CLI provider failed across 3 models (→n7) | **Case 005: v0.71 full-stack verification passed. (→n5) |
| 2026-06-20 | KongFangXun | OpenClaw Desktop + CLI (DeepSeek) | One-off test | 6 constraints + 3 orchestration closure rules | ✅ Yes | A0 + orchestration + 3 checkpoints + closure feedback all verified | ~8K/round | none | Deployment form finalized |
| 2026-06-22 | @liudi8785-cell | OpenClaw (v0.82) | One-off test | 8 dimensions | ✅ Yes | **8/8 all passed**: Hook loading chain 100% + system-lev (→n7) | — | daemon-status.sh showed stopped (process actua (→n13) | **OpenClaw is the only platform passing all dimensions. (→n7) |
| 2026-06-22 | @yeqingan | WorkBuddy (v0.82) | One-off test | 8 dimensions | ❌ No | **Governance hardening all failed**: scripts/ missing, s (→n8) | — | v0.52 skill excludes scripts/ directory (🔴 P0); evaluator isolation ❌ self-assessed | **WorkBuddy is a "well-behaved prompt framewor (→n14) |
| 2026-06-22 | @kangjianrong | Codex (v0.82) | One-off test | 8 dimensions | ✅ Yes (installed) | Installed + loaded, governance via self-discipline | — | verify.sh Skills path stat minor (🟡 medium) | **Codex install smoke test + platform verification passed. (→n9) |
| 2026-06-22 | @cedric123123 | Hermes Agent (v0.82, 工程模型) | One-off test | 8 dimensions | ❌ No | **4 governance checks all failed**: circuit breaker test (→n9) | — | daemon script missing; engine.md not auto-loaded; think.md not found | **Most honest test. (→n10) |
| 2026-06-22 | KongFangXun | Claude Code (v0.82) | One-off test | 8 dimensions | ❌ No | **0/8 hard constraints effective**: scripts/ n (→n15) | — | scripts/ not deployed (🔴); CLAUDE.md seed instructions (→n10) | **Claude Code and Hermes Agent are both "manual platforms". (→n11) |
| 2026-06-24 | @jm4170134-droid (Xiao Jia) | Mac mini (DeepSeek Reasoner, v0.86 tag) | One-off test | 5 tasks A/B | ✅ Yes | **5 dimensions all positive**: trap comments a (→n18) | — | N=1 single run (variance unknown); counterbala (→n17) | **Community third-party A/B: 5 code refactor t (→n16) |
| 2026-06-24 | @cedric123123 | OpenClaw main session (Opus 4.7) | One-off test | task6 + task7 | ✅ Yes | **16/16 perfect score, but data unreliable**: (→n19) | task6: ~150K / task7: ~226K | 🔴 Actually loaded v0.81-0.85 not v0.86 / 🔴 No control (→n12) | **Perfect report ≠ reliable report. (→n13) |
| 2026-07-01 | KongFangXun | WorkBuddy + OpenClaw (v0.99) | One-off test | 49 cases | ✅ Yes | Enterprise workflow full-chain e2e | ~120K total | none | First enterprise multi-node e2e |
| 2026-07-01 | AI Agent (auto-executed) | WorkBuddy + OpenClaw 2026.6.8 | Unattended batch | 15 requests | ✅ Yes | Agent self-ran audit + reflection + snapshot | ~45K | none | Unattended loop validated |
| 2026-07-01 | Enterprise colleague | WorkBuddy (v0.99.2) | One-off test | 5 TC tests | ✅ Yes | Non-author first real usage | ~20K | none | External user validated |
| 2026-07-02 | FDE (Agent-assisted) | OpenClaw (macOS, v0.99.4) | FDE deployment | 71+ workflow nodes + 2 🔄 | ✅ Yes | Manufacturing 200+ employees, 7 departments, 4 (→n32) | — | Needs batch import; soft-skill node classification | **Case 016: Lithium battery manufacturer FDE deployment. (→n17) |
| 2026-07-02 | Cedric (Jinhui) | OpenClaw (Windows, v0.99.4) | FDE deployment | 5 roles 25 nodes + 1 🔄 live | ✅ Yes | 5-person team, 2h to complete ten steps, 1 🔄 node live (→n17) | — | PowerShell curl alias; UTF-8 encoding for DingTalk | **Case 017: Agritech micro-team FDE deployment (→n33) |
| 2026-07-02 | Xiao Jia (Manjia) | OpenClaw (macOS, v0.99.4) | ~3 weeks (as of Jul 4) | 2 🔄 nodes running daily | ✅ Yes | E-commerce operations: 2 🔄 nodes live (weekly (→n34) | — | Platform anti-crawl limits data access; needs (→n35) | **Case 018: E-commerce FDE deployment — first (→n36) |
| 2026-07-02 | Yao Xuchen (Shangshan) | OpenClaw (macOS, v0.99.4) | FDE deployment | 2 production agents + 1 KB agent planned | ✅ Yes | 2 production agents running for months, FDE deploys new (→n19) | — | Webhook bot one-way only | **Case 019: Energy tech FDE deployment — exten (→n37) |
| 2026-07-05 | KongFangXun | OpenClaw 0.7.5 + WorkBuddy (v0.99.7) | One-off test | 8 scenarios full chain | ✅ Yes | **5/7 core ✅ + 2/7 env-limited**: install 0.39s 48 check (→n20) | — | daemon sandbox blocks pid write; webhook needs (→n39) | **Case 020: v0.99.7 full-chain test — 5 core c (→n38) |
| 2026-07-05 | OpenClaw (for Cedric) | Windows 10 (v0.99.8) | One-off test | 5 extreme scenarios | ✅ Yes | **Audit engine extreme capability verification**: 100 fi (→n21) | — | pre-commit hook hardcoded local path (P1); JSO (→n40) | **Case 021: Audit engine technical capability (→n41) |
| 2026-07-05 | OpenClaw (for Cedric) | Windows 10 (v0.99.8) | One-off test | 7 comparison groups | ✅ Yes | **With vs without sofagent**: no audit = 5 secrets all c (→n22) | — | — | **Case 022: Audit engine value comparison — "w (→n42) |
| 2026-07-06 | @cedric123123 | macOS 15.x · Node 24 (v0.99.8) | One-off test | 8 scenarios + 8 extreme | ✅ Yes | **8/8 passed, 8.5/10**: ao compose→run full chain / MCP (→n23) | — | sk-proj- missed (P0 fixed); hook path hardcoded (P0 fixed) | **Case 023: Gate #7 external user validation # (→n43) |
| 2026-07-06 | @xue52101-lzk | macOS 23.5 · Node 25 (v0.99.8) | One-off test | 8 scenarios | ✅ Yes | **8/8 passed, 8.5/10**: FDE simulated deployment 14 AI n (→n24) | — | — | **Case 024: Gate #7 external user validation #2 — FDE enterprise deployment simulation + daemon full chain. (→n25) |
| 2026-07-06 | @Atreides-coder (Xiao Jia) | macOS 15.6 · Node 24 (v0.99.8) | One-off test | 8 scenarios + feedback form | ✅ Yes | **8/8 passed, 8.0/10**: Most detailed feedback (→n46) | — | daemon behavior mismatch (P1 docs); hook path (→n45) | **Case 025: Gate #7 external user validation # (→n44) |

> n1：lex travel plan, 6 output (→n1)
> n2：ints+closu (→n1)
> n3：skipped constitution layer
> n4：gents + loop-check closure + **cross-task reflection verified** (TC05 PASS)
> n5：ask reflection verification. (→n3)
> n6：e 0%→100% (10/10)
> n7：(YAML incompatibility); checkpoints rely on agent compliance
> n8：5/5 + orch (→n5)
> n9：re (key replaced); engine.md missing install hint
> n10：ook loadin (→n6)
> n11：(→n10)
> n12：(→n11)
> n13：lly running); old hook residue
> n14：k" — can load SKILL.md but script-level governance unavailable. (→n8)
> n15：ot deployed, orchestration engine completely failed
> n16：asks, sofagent group consistently outperformed bare agent. (→n12)
> n17：nced order (B first A second); non-blind evaluation
> n18：ll preserv (→n11)
> n19：6 methodology flaws prevent attribution
> n20：dit-history path mismatch (P2 fixed); MCP duplicate response when uninitialized (P2 fixed); non-git repo no friendly prompt (P2 fixed)
> n21：ting (deterministic + engineering model code review + ao multi-agent). (→n14)
> n22：pack bund (→n13)
> n23：(→n22)
> n24：mand → background process+sleep); install.sh has darwin platform branch gap
> n25：+ local verification. (→n15)
> n26：items + MC (→n14)
> n27：el, v0.99.2)
> n28：ositive rate untested; secret regex requires 48 chars
> n29：external test. (→n16)
> n30：ope/A4 del (→n15)
> n31：(→n30)
> n32：h to produ (→n16)
> n33：— Windows full chain verified. (→n18)
> n34：report + reconciliation), ~440-590h/year freed. (→n19)
> n35：offline install docs
> n36：continuous (→n18)
> n37：ding AI infra with new agent. (→n20)
> n38：apabilities (install/audit/loading/orchestration/MCP) all passed. (→n21)
> n39：real URL; A2 misses sk-proj- new format
> n40：N PowerShell encoding (P2); base64 secret undetected (P3)
> n41：verification (Windows extreme test). (→n22)
> n42：ithout sofagent, secret leakage is not a matter of if, but when it gets discovered". (→n23)
> n43：1 — full chain + extreme tests + real FDE case. (→n24)
> n44：3 — most detailed feedback, found daemon doc mismatch + hook path issue. (→n26)
> n45：hardcoded (P0 fixed)
> n46：/ found d (→n25)

> n1：re), actual effect TBD
> n2：ut L1 loading chain missed (fixed in v0.56). (→n2)
> n3：itecture (P0 fixed) ② parallel report not saved ③ scoring not refreshed per task
> n4：0 fixed) ② verify.sh incorrectly checking OpenClaw hooks (P0 fixed)
> n5：estration engine link functional + ao compose (API) working + template injection normal
> n6：g chain 100% + WorkBuddy Agent self-loading chain 100%. v0.71 task access rejection first triggered
> n7：el circuit breaker + session.spawn evaluator isolation
> n8：tep gate/circuit breaker/idempotency check all degraded to prompt-level self-discipline
> n9：ed 5 consecutive calls to non-existent API without tripping
> n10：not written (🟡); daemon doesn't detect claude (🟡)
> n11：ed vs partially removed, exports complete vs missing, first-pass no-bug 5/5 vs 4/5, type strict vs `any` bypass
> n12：group / 🔴 Model uncontrolled (Opus vs deepseek) / 🟡 N=2 / 🟡 task7 too conspicuous / 🟡 MEMORY.md contamination
> n13：ling source + bin no exec permission) fixed on the spot**; ao compose 4-parallel multi-agent review orchestration successful (76s / 57K token), but Agent couldn't auto-read project files, review was simulated
> n14：P 4 tools + audit 6-step closure + ao 0.7.5 + macOS all green. v1.0 gate 3 conditions ⏳→✅
> n15：ete-config/A5 commit/E1 missing-test. A3 gatekeeper effect confirmed. Extended rule framework working.
> n16：ce full deployment plan + workflow.yaml
> n17：on DingTalk push. First Windows external verification
> n18：-use external case. See [Case 018](./cases/fde-manjia-2026-07-02/).**
> n19：Enterprise KB agent. 10+ docs + Phase 1 code delivered
> n20：s / audit A1+A2 dual detection / loading chain 3 layers / orchestration 74.8s 5 steps / MCP 3 tools+3 resources
> n21：les 8.76s zero false positives / 200KB single-line detection / 4 secret types all caught / 5 modes all passed
> n22：ommitted to git history; with audit = 5/5 all blocked. 100 files 8.76s precise location
> n23：9 JSON-RPC / 10K lines 99ms / real enterprise case (Shangshan 11 deliverables)
> n24：odes (3 depts ¥700K+/yr) / daemon full logs / ao demo 4 roles
> n25：aemon behavior mismatch with docs / install 15s smooth / audit 0 false positives

> n1： files, Loop 3 checkpoints 100% pass (agent self-assessed, not human-verified). See [Case 001](../archive/evidence/italy-travel-2026-06-18/).**
> n2： See [Case 002](../archive/evidence/workbuddy-self-test-2026-06-18/).**
> n3： Task1 wrote reflection → Task2 new session explicitly referenced "think.md indicates path mismatch likely", proving reflection persisted across sessions. See [Case 003](../archive/evidence/openclaw-e2e-2026-06-19/) and [testing.md](../guides/testing.md) TC05.**
> n4： 1 fully auditable run + 9 user-confirmed equivalent samples, all 10 consecutive tasks passed first attempt. See [Case 004](../archive/evidence/codex-stability-2026-06-20/).**
> n5： 2 improvement points identified: provider compatibility + checkpoint discipline. See [Case 005](./cases/workbuddy-constraint-ao-test-2026-06-20/).**
> n6： Non-OpenClaw platform loading chain hit rate improved from historical 0-33% to current 100% (single sample). See [testing.md](../guides/testing.md) Cases 9-12.**
> n7： verify.sh 41 pass 0 fail. See [Case 007](./cases/openclaw-v082-2026-06-21/).**
> n8： See [Case 008](./cases/workbuddy-v082-2026-06-22/).**
> n9： codex exec real load test: AGENTS.md → fde.md → SKILL.md loaded, correctly answered 4 bottom-line rules. See [Case 009](./cases/codex-v082-2026-06-22/).**
> n10： Prompt-level constraints don't work on Hermes Agent. L1+L3 loading exceeded expectations (Agent searched proactively). See [Case 010](./cases/hermes-v082-2026-06-22/).**
> n11： Three breakpoints caused effect = 0. See [Case 011](./cases/claude-v082-2026-06-22/).**
> n12： Same model (DeepSeek Reasoner), only variable is sofagent presence. See [Case 012](./cases/community-ab-test-2026-06-24/).**
> n13： task6 type-split 8/8 + task7 Loop exit 8/8, but version mismatch + no control + model confound. Methodology lessons in [Anti-case 003](./anti-cases/003-test-methodology-pitfalls.md).**
> n14： Core code all green: 398 tests + tsc zero errors + version 34-consistent + zero-dependency claims accurate + command injection protection. 3 P0 + 10 P1 + 3 P2 all fixed on the spot.**
> n15： 18 issues fixed (3 P0 + 9 P1 + 6 P2), 406 tests all green (test count at v0.99.2; later versions keep growing — current count per `tools/check/test-count.sh`), version 33-consistent. Tests auto-executed by Agent, zero human intervention. See [Case 014](./cases/v0992-release-test-2026-07-01/).
> **
> n16： Enterprise colleague constructed known violations in independent repo, all detected. See [Case 015](./cases/v0992-audit-detection-2026-07-01/).**
> n17： See [Case 016](../archive/evidence/fde-forever-battery-2026-07-02/).**
> n18： See [Case 017](../archive/evidence/fde-jinhui-2026-07-02/).**
> n19： Running ~3 weeks as of 2026-07-04
> n20： See [Case 019](../archive/evidence/fde-shangshan-2026-07-02/).**
> n21： verify.sh expanded to 48 checks. See [Case 020](./cases/v0997-fullchain-test-2026-07-05/).**
> n22： Not a Gate #7 deliverable — platform/tester/scenario mismatch with external user validation plan. High value as audit detection precision evidence. See [Case 021](../archive/evidence/v0998-extreme-audit-test-2026-07-05/).**
> n23： See [Case 022](../archive/evidence/v0998-audit-comparison-2026-07-05/).**
> n24： See [Case 023](../archive/evidence/v0998-external-cedric-2026-07-06/).**
> n25： See [Case 024](../archive/evidence/v0998-external-lzk-2026-07-06/).**
> n26： See [Case 025](../archive/evidence/v0998-external-xiaojia-2026-07-06/).**

> Duration categories: **One-off test** (installed, verified, stopped) / **Continuous use N days** (daily work use) / **Abandoned** (installed but stopped using — **please tell us why, this is the most valuable data**)

---

## Benchmark testing

> Reproducible A/B test results. Run `bash engine/scripts/verify.sh --quiet` (all checks green = ✓).

Historical benchmark records: [benchmark/](./benchmark/) — archived, no longer auto-updated.

---

## Community contributions

Your data. Any format, just be real.

---

## Quantification anchors (v0.95 design anchors — data collection never started)

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
