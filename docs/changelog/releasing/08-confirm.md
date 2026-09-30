<!-- SOP-ANCHOR: S8 | file: 08-confirm.md | prev: S7 | next: S9 -->
<!-- 机器锚（模型检索用，人不影响阅读）：grep "SOP-ANCHOR:" 可一跳取全部阶段元信息；本阶段完成后 → S9 -->
# 阶段八：发布放行关口

> **定位**：阶段八不是「再做一轮检查」——检查在阶段一~七已全部完成且各有关口。阶段八是把前七阶段的验证**汇总成一份放行清单**，作者**一次性放行**（说「发布」即进入阶段九），唯一产出物是发布 prompt（交接给执行方）。不逐项让作者过目——内容重复且无决策意义，改为放行决策 + 就绪汇总。
>
> **放行原则**：作者一句话放行（「发布吧」「确认」）即可；发布就绪汇总只展示不逐项求确认。三拍板项（push 积压/npm 发布/Skill 分发）在放行时一次性确认。

---

## 步骤

| # | 完成 | 步骤 | 验证方式 |
|:--:|:--:|------|------|
| 一 | | **发布就绪汇总**：门禁基线表（各阶段实测值汇总——测试数/acceptance/check-version/CRS/CTH/anchors/release-gate/fresh-eyes/**仓外门面 check-storefront**）+ 改动清单一句话（commit 数/文件数/行数） | 汇总表展示 |
| 一b | | **收口硬判据** | 收口门禁 EXIT=0 + gh 三 workflow success |
| 二 | | **冻结窗口重验（门禁时点纪律）** | 三查通过 + 门禁 EXIT=0 |

#### 一b · 收口硬判据

推送收口 commit 后，`bash tools/check/check-release-closeout.sh` 必须 exit 0，且 main 最新提交的 `pr-check` / `verify` / `sofagent-audit` 三条 workflow 结论均为 success（pre-push 语境下 HEAD 未推送时该项为「可见降级跳过」，推送后必须补核）——**收口语义不放行即本关口不放行**。


