# Evidence.md — Does sofagent actually work?

> We don't answer for you. Below is what people who installed sofagent have reported.

> ⚠️ **Honest disclosure**: The data below includes the author's own testing. Reflection scores are LLM self-assessments (no engineering isolation on non-OpenClaw platforms). For enterprise evaluation, wait for v0.9 encryption + external evaluator. Current data is suitable for exploratory assessment only — not production decisions.

> 📊 **A/B benchmark data**: v0.75 first benchmark run — 4/10 constraint tasks PASS (tasks 1/3/4/10), 6/10 orchestration tasks 🔲 pending independent session verification. "Without sofagent" comparison side marked "untestable" due to single-session self-test limitation. See [docs/benchmark/2026-06-21.md](./benchmark/2026-06-21.md) | Methodology note: [Anti-case 001](./anti-cases/001-benchmark-self-test-circularity.md)

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
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | One-off test | 1 | ✅ Yes | Mechanism verified (A0+orchestration+3 checkpoints+closure), actual effect TBD | ~27K/task | Missing markdown module→auto-install retry (+30s) | **First third-party full-flow test: 28min complex travel plan, 6 output files, Loop 3 checkpoints 100% pass (agent self-assessed, not human-verified). See [Case 001](./docs/cases/italy-travel-2026-06-18/).** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | One-off test | 1 | ✅ Yes | Closure loop verified (task/logs+think.md), loading chain L1 missed | ~15K/task | constitution/ dual-file naming ambiguity→agent skipped constitution layer | **Author self-test: WorkBuddy closure mechanism works, but L1 loading chain missed (fixed in v0.56). See [Case 002](./docs/cases/workbuddy-self-test-2026-06-18/).** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | One-off test | 8 | ✅ Yes | Full chain: 3-layer loading + ao compose sub-agents + loop-check closure + **cross-task reflection verified** (TC05 PASS) | ~26K/task | ① load-chain.sh incompatible with openclaw.json new architecture (P0 fixed) ② parallel report not saved ③ scoring not refreshed per task | **Case 003: v0.64 dev full-chain E2E + cross-task reflection verification. Task1 wrote reflection → Task2 new session explicitly referenced "think.md indicates path mismatch likely", proving reflection persisted across sessions. See [Case 003](./docs/cases/openclaw-e2e-2026-06-19/) and [TESTING.md](./docs/TESTING.md) TC05.** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | One-off test | 10 | ✅ Yes (with script workarounds) | Notable improvement: first-attempt success rate 0%→100% (10/10) | Not collected | ① install.sh Codex branch SOFAGENT_DATA uninitialized (P0 fixed) ② verify.sh incorrectly checking OpenClaw hooks (P0 fixed) | **Case 004: First Codex platform third-party test. 1 fully auditable run + 9 user-confirmed equivalent samples, all 10 consecutive tasks passed first attempt. See [Case 004](./docs/cases/codex-stability-2026-06-20/).** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | One-off test | 16 tests | ✅ Yes | **Full-stack verification**: constraint layer 5/5 + orchestration engine link functional + ao compose (API) working + template injection normal | ~49K/session | ao compose CLI provider failed across 3 models (YAML incompatibility); checkpoints rely on agent compliance | **Case 005: v0.71 full-stack verification passed. 2 improvement points identified: provider compatibility + checkpoint discipline. See [Case 005](./docs/cases/workbuddy-constraint-ao-test-2026-06-20/).** |
| 2026-06-20 | KongFangXun | OpenClaw Desktop + CLI (DeepSeek) | One-off test | 6 constraints + 3 orchestration + ao compose | ✅ Yes | **Dual platform all-pass**: OpenClaw Desktop Hook loading chain 100% + WorkBuddy Agent self-loading chain 100%. v0.71 task access rejection first triggered | ~35K/session | Expired API key caused silent ao compose failure (key replaced); engine.md missing install hint | **v0.71 dual-platform runtime test all passed. Non-OpenClaw platform loading chain hit rate improved from historical 0-33% to current 100% (single sample). See [TESTING.md](./docs/TESTING.md) Cases 9-12.** |

> Duration categories: **One-off test** (installed, verified, stopped) / **Continuous use N days** (daily work use) / **Abandoned** (installed but stopped using — **please tell us why, this is the most valuable data**)

---

## Benchmark testing

> Reproducible A/B test results. Run `bash sofagent/scripts/benchmark.sh --platform your-platform` to generate.

See [docs/benchmark/](./docs/benchmark/) — auto-updated with each run.
