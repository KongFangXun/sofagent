# Devlog template
> **家族统一标准**：源在 `sofagent/standards/templates/devlog/_TEMPLATE.md`；本文件为渲染产物，请勿在本仓修改。

> **Path**: `devlog/v<X>/<X.Y.Z>.md` — keyed to the same version as the changelog. **Written first, drives implementation**; changelog is written after, for the outside. This file *is* the task brief: a start instruction only needs to point here.
>
> **Style**: exact paths for touched files (verify existence before writing); implementation steps executable, unambiguous, single-path (no option branches — branch decisions happen before this file is written); measure current state before citing it, never transcribe from memory; state the boundary ("what this does NOT do"); acceptance items mechanically verifiable.
> **Forbidden**: the same four bans as the changelog template.
> **Status flow**: planned → in-progress → closed. **Freeze**: after version close this file is frozen — corrections go to the next version.

---

# vX.Y.Z devlog — 〈theme〉

> Status: 〈planned / in-progress / closed〉

## Background & goal
〈What problem this version solves · what state it reaches — objective, two or three sentences〉

## Preconditions
- 〈existing versions / data / tooling this depends on — or "—" if none〉

## Delivery spec
| Component | Spec |
|---|---|
| 〈name〉 | 〈what it does · what the criteria are〉 |

## Files touched
| Path | Change | Note |
|---|---|---|
| 〈exact path〉 | new/modify | 〈one sentence〉 |

## Implementation steps
1. 〈an executable step, single path〉

## Boundary (what this does NOT do)
- 〈explicit exclusions〉

## Acceptance criteria
- [ ] 〈one mechanically verifiable item〉
- [ ] Family checks all green (main repo `tools/check/check-docs-all.sh --fast`, doc-surface suite)

## Impact on later versions
| Version | Impact |
|---|---|
| 〈vX.Y〉 | 〈one sentence〉 |
