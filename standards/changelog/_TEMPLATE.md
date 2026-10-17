# Changelog template
> **家族统一标准**：源在 `sofagent/standards/templates/changelog/_TEMPLATE.md`；本文件为渲染产物，请勿在本仓修改。

> **Path**: `changelog/v<X>/<X.Y.Z>.md` (grouped by major line: v0/ build era, v1/ post-stabilization).
> **Version-level rules** (criterion = external contract surface):
> - **X**: breaks an external contract (API / CLI / file-format incompatibility); or era switch (0→1 = contract-freeze declaration); or repo-role redefinition
> - **Y**: adds a capability surface (new package / tool / command / criteria domain) without breaking existing consumers
> - **Z**: fixes and internal improvements — no contract change, no new capability surface
> - **R**: retires a surface (capability / document / artifact / commitment). Retirements are recorded under their own
>   section, never folded into X/Y/Z — a retirement that additionally breaks a contract is **X and R**
> - One version, one theme: every version needs a one-sentence statement; pre-plan Y only, never Z; X is decided at decision time
> - **Retirement floor**: every version disposes of **at least 3** items — retire an existing one, or give a newly
>   added deliverable its retirement condition. "None" is allowed only with a reason per item
> - **Ratchet**: the three family counters (document volume / external commitments / shipped artifacts) may not rise
>   across versions without a stated reason in the record
>
> **Style**: write only "what this version is / contains / how it's accepted"; mark un-implemented sections "— (none in this version)"; acceptance items must be mechanically verifiable.
> **Forbidden**: archaeology tags (batch names / date logs / "previously, formerly" phrasing) · process snapshots (development process belongs in devlog/, family affairs in the main-repo navigator) · dangling references (verify targets exist before writing) · hardcoded counts (measure at release time).
> **Release**: tag the full git tag (vX.Y.Z); released records are frozen — corrections go to the next version.

---

# vX.Y.Z — 〈one-sentence theme〉

> Status: 〈planned / in-progress / released〉｜Level: 〈X/Y/Z + one-sentence leveling rationale〉

## Overview
〈What problem this version solves · why it's needed — two or three sentences, objective〉

## Deliverables
| Component | Capability |
|---|---|
| 〈name〉 | 〈what it does · what the criteria are〉 |

## Acceptance criteria
- [ ] 〈one mechanically verifiable item〉
- [ ] Family checks all green (main repo `tools/check/check-docs-all.sh --fast`, doc-surface suite)

## Retirement
| Item | Surface | Disposition | Cost borne by | Replacement |
|---|---|---|---|---|
| 〈name〉 | 〈contract / doc / artifact〉 | 〈retired / downgraded / scheduled〉 | 〈who loses what〉 | 〈path, or "—" + reason〉 |

At least 3 rows. Every deliverable added above either states its retirement condition here, or is registered
as a future retirement candidate under “Impact on later versions”.

## Impact on later versions
| Version | Impact |
|---|---|
| 〈vX.Y〉 | 〈one sentence〉 |
