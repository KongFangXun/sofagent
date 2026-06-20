# Evidence.md — sofagent 真的有用吗？

> 我们不替你回答。以下是装了 sofagent 的人自己记录的。
> 格式：复制下面的模板，填你的数据，提 PR。

---

## 如何贡献

跑满一周 sofagent 后：
1. 在下方「社区案例」区块复制一份空白模板
2. 填入你的数据（从 `.sofagent/task/logs/` 和 `think.md` 取）
3. 提 PR 到这里

不需要论文级别的数据——一条真实的 task/log、一个「Agent 这次没重复上一次的错」都值得记。

---

## 社区案例

> 以下空位等你来填。复制空白模板，写你的使用记录，提 PR。
> 填写后我们会整理归档到 `docs/cases/` 文件夹——像 Case 001 一样永久保留。

### 空白模板（复制此段开始填写）

```
### @你的GitHub用户名 · 平台名 · YYYY-MM-DD
- 任务：（一句话描述）
- 使用时长：约 X 天 / X 次任务
- Loop 触发次数：checkpoint _次 / failure _次 / closure _次
- 反思写入条数：_条
- 最有价值的发现：（Agent 有什么你没想到的表现？）
- 任务完成率变化：用前 _% → 用后 _% （可选，尽量填）
```

---

## 第三方测试

> 以下表格留给你填。不需要论文级别的数据——一条真实记录就够。
> FAIL 比编造的 PASS 有价值 100 倍。装不上就说装不上，没觉得变就说没变。

| 日期 | 测试人 | 平台 | 使用天数 | 任务数 | 装上了吗 | 有变化吗 | token 消耗 | 踩坑记录 | 一句话结论 |
|------|------|------|:--:|:--:|:--:|------|------|------|------|
| 2026-06-18 | [@cedric123123](https://github.com/cedric123123) | OpenClaw (kimi-k2.5) | 1 天 | 1 次 | ✅ 能 | 机制跑通（A0+编排+3检查点+闭环），效果待核验 | ~27K/任务 | markdown模块缺失→自动安装重试（+30s） | **sofagent 全流程首次在第三方环境跑通：28分钟完成复杂旅行规划，输出6文件，Loop 3检查点100%通过（Agent 自评，未经人工核验）。详见 [Case 001](./docs/cases/italy-travel-2026-06-18/)。** |
| 2026-06-18 | KongFangXun | WorkBuddy (DeepSeek V4 Pro) | 1 天 | 1 次 | ✅ 能 | 闭环跑通（task/logs+think.md），加载链第1层漏读 | ~15K/任务 | constitution/双文件命名歧义→Agent跳过宪法层 | **作者自测：WorkBuddy 闭环机制跑通，但发现加载链第1层漏读（v0.56已修）。详见 [Case 002](./docs/cases/workbuddy-self-test-2026-06-18/)。** |
| 2026-06-19 | KongFangXun | OpenClaw 2026.6.8 (DeepSeek V4 Flash) | 1 天 | 8 次 | ✅ 能 | 全链路跑通：三层加载链 + ao compose 子 Agent + loop-check 闭环 + **跨任务反思「越用越聪明」验证通过**（TC05 PASS） | ~26K/任务 | ① load-chain.sh 在 openclaw.json 新架构不兼容（P0 已修）② 并行报告未落盘 ③ scoring 未逐任务刷新 | **Case 003：v0.64 开发者全链路 E2E + 跨任务反思验证。Task1 写入反思 → Task2 新会话显式引用「think.md 指出路径可能不匹配」，证明反思跨会话生效。详见 [Case 003](./docs/cases/openclaw-e2e-2026-06-19/) 和 [TESTING.md](./TESTING.md) TC05。** |
| 2026-06-20 | qinanxie199229@gmail.com | Codex | 10 次连续 | 10 次 | ✅ 能（需规避脚本问题） | 明显改善：首次交付无需纠错率 0%→100%（10/10） | 未采集 | ① install.sh Codex 分支 SOFAGENT_DATA 未初始化（P0 已修）② verify.sh 误查 OpenClaw Hook（P0 已修） | **Case 004：首个 Codex 平台第三方测试。1 次完整可审计 + 9 次用户确认等效样本，10 次连续任务全部首次交付成功。详见 [Case 004](./docs/cases/codex-stability-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | WorkBuddy (DeepSeek V4 Pro + ao compose via DeepSeek API) | 1 次会话 | 16 项测试（5 约束 + 4 拆解 + 3 ao compose + 2 ao run + 1 模板注入 + 1 ao demo） | ✅ 能 | **全栈验证通过**：约束层 5/5 + 编排引擎链路通 + ao compose（API）跑通 + 模板注入正常 | ~49K/会话 | ao compose CLI provider 跨 3 模型失败（YAML 不兼容）；checkpoint 靠 Agent 自觉 | **Case 005：v0.71 全栈验证通过，发现 provider 兼容性 + checkpoint 纪律 2 项改进点。详见 [Case 005](./docs/cases/workbuddy-constraint-ao-test-2026-06-20/)。** |
| 2026-06-20 | KongFangXun | OpenClaw 桌面 + CLI (DeepSeek) | 1 天 | 6 项约束 + 3 项编排 + ao compose | ✅ 能 | **双平台全通**：OpenClaw 桌面端 Hook 加载链 100% + WorkBuddy Agent 自觉加载链 100%。v0.71 新增任务准入拒绝首次生效 | ~35K/会话 | API Key 过期导致 ao compose 静默失败（已换 Key 修复）；engine.md 缺安装提示 | **v0.71 双平台运行时测试全部通过。加载链在非 OpenClaw 平台命中率从历史 0-33% 提升到本次 100%（单次样本）。详见 [TESTING.md](./TESTING.md) 用例 9-12。** |
| _日期_ | _名字_ | _OpenClaw / WorkBuddy / ..._ | _X 天_ | _X 次_ | _能 / 不能_ | _变了 / 没变 / 说不清_ | _约 X token/任务_ | _如实写_ | _你的一句话判断_ |
