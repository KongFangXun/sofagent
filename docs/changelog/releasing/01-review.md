# 阶段一：审查上版本

> **目的**：先把上版本的 bug 找齐修完，再开发本版本新功能。不带上版本的债往前走。
>
> ⚠️ **与阶段三的区分（先读，防混淆）**：阶段一和阶段三都用 fresh-eyes 审查，区别是**对象**——阶段一审**上版本**（发版收尾态的存量 bug），阶段三审**本版本**（新开发代码）。两阶段不可互相替代，也不可把阶段一的审查当成阶段三做过。

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 一 | **单次草稿优先**：`node tools/gen/gen-fresh-eyes-draft.mjs --diff <patch 文件> --changelog <changelog> --out ~/Desktop/fresh-eyes-draft-vX.Y.Z.md`——单次 LLM 调用生成 16 视角审查草稿（省 24 worker 探查循环） | 16 视角审查草稿 |
| 二 | **driver 兜底**：草稿中「待取证」项 / 高风险变更才启动 fresh-eyes-loop 全流程：`node FORGE/src/fresh-eyes-driver.mjs --target <上一版本号> --max-rounds 10`。按 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 监控协议轮询。loop 产出的 P0/P1/P2 修复即本版本 BugFix 批次主体；修复只 commit 不 push | 审查报告 + loop 修复 → BugFix 批次 |
| 三 | **对话式多轮审查**：主会话（或独立 session）按 `fresh-eyes-review.md` 16 视角人肉跑多轮——第一轮主会话单跑 → 第二轮并行子代理扩面 → 第三轮终审（并行+零信任复核）→ 第四轮对话式补充取证 → 第五轮对 prompt 自身零信任复核（逐项回仓库实跑，修正硬错误/过时状态）。产出桌面 `vX.Y.Z-bugfix-prompt.md`（问题总表+逐项修复方案+验证命令+执行纪律），修复批收编后进开发 | bugfix-prompt.md + 修复批收编 commit |
| 四 | （可选）人工补充：以 `fresh-eyes-review.md` 方法论人肉复核 loop 报告，直觉盲区发现并入清单 | 补充发现 |

---

## 审查分层（单次草稿优先、driver 兜底）

> **为什么分层**：fresh-eyes-loop 全流程 = 24 perspective worker × 多轮，单轮 6-10 万 token；
> 而大部分变更的审查价值集中在「理解 diff + 按视角找茬」——理解型任务单次 LLM 调用即可完成，
> 只有需要定点取证（跑命令 / 读全文件交叉验证）的项才需要 worker 的探查循环。

| 层 | 工具 | 成本 | 何时用 |
|----|------|------|--------|
| 第一层：单次草稿 | `tools/gen/gen-fresh-eyes-draft.mjs` | 单次调用，约 1-3 万 token | 默认起点——16 视角草稿一次成型，标注「待取证」项 |
| 第二层：driver 兜底 | `FORGE/src/fresh-eyes-driver.mjs` | 24 worker 多轮，单轮 6-10 万 token | 草稿「待取证」项多 / 大版本变更 / 草稿结论存疑时全量跑 |
| 第三层：对话式多轮 | 主会话按 `fresh-eyes-review.md` 16 视角人肉多轮（多轮扩面 + 并行子代理 + 零信任复核 + prompt 自审） | 人力 + 主会话 token | LLM 通道不稳 / 需要跨轮仲裁冲突项 / driver 结构性不收敛时——**与第一二层可互换，产出等价** |
| 第四层：人工直觉 | `FORGE/playbook/fresh-eyes-review.md` 方法论 | 人力 | 任意层后补充——直觉盲区是 LLM 覆盖不到的 |

降级路径：无 GLM_API_KEY / API 失败时草稿工具退出码 2 并把完整 prompt 落盘 `.prompt.md`——粘贴给任意 AI session 执行，SOP 不因断网卡死。

B 侧复核模式（v1.3.8 起 driver 内置）：全量跑 driver 时，B 侧 12 worker 不再全量重审，改为独立复核 A 的 P0/P1 发现（确认/推翻+依据，可补 A 漏报）——B 侧 token 约省一半，视角独立性保留（B 仍可推翻 A）。

---

## changelog 章节顺序铁律

> 合并版本（新功能 + BugFix 同版）的章节顺序规则见 [06-doc-finalize.md](./06-doc-finalize.md)——新功能在前、BugFix 在后。阶段二活文档随记时就开始遵守，定稿在阶段六。

---

## fresh-eyes-loop 新 session Prompt 模板

> 阶段一和阶段三都用 fresh-eyes 审查，区别是 target（阶段一审上版本，阶段三审本版本）。AI 输出 prompt 时必须把所有占位符替换为实际值（项目路径、版本号），不得残留花括号。**交付形式**：直接在对话中输出可复制的 prompt 文本块，禁止落盘成文件。

```
在 sofagent 项目（{项目实际路径}）中，执行 {实际版本号} 的 fresh-eyes-loop。

先读 `FORGE/SKILL/fresh-eyes-loop/SKILL.md` 拿到完整的「Session 监控协议」，然后按协议执行：

0. 独占窗口检查（三查）：① `git status --short | wc -l` 改动文件数（预期 0/个位数）② `find . -path ./node_modules -prune -o -mmin -5 -type f -print` 近 5 分钟活跃文件 ③ `tail .workbuddy/memory/$(date +%Y-%m-%d).md` 今日日志他人活跃记录——任一命中先停手问用户。
0b. **先查 driver 是否已在跑（主 session 可能已用 daemon 启动，新窗口只做监控）**：读 {runDir}/status.json（或 pgrep -f fresh-eyes-driver），若在跑 → 跳过步骤 1 直接进步骤 3 轮询；若已死/无产物 → 正常走步骤 1。
1. 启动 driver——**优先 daemon+watch 守护模式**（自动恢复，免疫会话回收，姿势同 03-quality-loop.md「driver 启动姿势 8 条」）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/fresh-eyes-driver.mjs --target {实际版本号} --max-rounds 10 --daemon --watch {runDir}
   ⚠️ 8GB 机器必须 FORGE_MAX_CONCURRENCY=1（并发 worker 各占 2GB heap，3+ 并发即 OOM）
   若为 resume 续跑（上次异常死亡）：命令加 --resume（保留已有产物，不重开）
   fallback（无 daemon 支持）：Bash 工具 run_in_background:true + dangerouslyDisableSandbox:true，
   输出重定向文件 > /tmp/fresh-eyes-<ver>-driver.log 2>&1（禁止管道），不传 timeout 参数
2. 记住 runDir（启动日志第一行打印的路径）
3. 在 session 内**前台**持续轮询——每 120 秒一个工作周期（run_in_background 只属于步骤 1 的 driver 启动命令，轮询循环严禁挂后台——挂后台 = session 空闲 = 界面无进展反馈）：
   ① 读 <runDir>/status.json 看 round 变化，变化时一句话汇报
   ② 读 heartbeat 字段时间戳——距今 > 90 秒则 pgrep 确认进程是否存活，无输出 = 已死，汇报并退出
   round 不变且 heartbeat 正常 → 继续轮询
4. round 变成 completed 或 error 时，读报告，用 3-5 行汇报

铁律：不干涉 driver、不改代码、不探索源码——只启动 + 持续轮询监控 + 最终汇报。
```
