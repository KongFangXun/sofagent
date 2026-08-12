# 阶段十二：发布后

---

## 步骤

| # | 步骤 | 产物 |
|:--:|------|------|
| 1 | **发布后验证**（见下方脚本） | 全绿 |
| 2 | CI 全绿检查 | CI 全绿 |
| 3 | **审查三文档回写**：发版过程（阶段六~十一）暴露的新问题回写到 regression-checklist（新维度）/ fresh-eyes-review（新教训）/ acceptance-test（新场景）。与阶段五分工：阶段五管代码质量（发版前可见），本步骤管发版流程（发版中才暴露——如 CI 失败模式、publish 限制、日期硬编码等） | 三文档更新 |
| 4 | SOP 漏洞吸收：本次迭代暴露的 releasing.md 流程问题直接吸收进对应阶段 | SOP 更新 |
| 5 | SOP 数字核对：维度数、检查项数等是否过期 | 数字一致 |
| 6 | 生成「下一版本开发 Prompt」到桌面：综合 ROADMAP + CHANGELOG + 下一版本 changelog | `~/Desktop/vX.Y-dev-prompt.md` |
| 7 | **开发 Prompt 校验循环**（详见下方） | prompt 定稿 |
| 8 | **下版本内容对话讲解**（详见下方） | 项目负责人理解下版本方向 |
| 9 | **进度追踪清零**：把 `releasing.md` 进度追踪的 12 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备 | 进度追踪重置 |
| 10 | **releasing 自迭代**（sop 审查自己）：对照本次发版的实际执行体验，检查 12 个阶段文件是否有过时/缺漏/顺序不合理的地方，直接修正。这是 releasing.md 的「Dream Cycle」——每次发版后用它自己的经验喂养它自己 | releasing.md 更新 |

---

## 发布后验证脚本（步骤 1）

```bash
# Git tag + release 验证
git tag -l | grep vX.Y.Z
gh release view vX.Y.Z
# Release Notes 完整性：body 非空 + 含 changelog markdown 链接 + 非 Draft
gh release view vX.Y.Z --json isDraft,body -q '.body | length'  # 期望 > 100
gh release view vX.Y.Z --json body -q '.body | contains("](./docs/changelog/")'  # 期望 true

# npm 版本验证
npm view @sofagent/audit version   # 期望 vX.Y.Z
npm view @sofagent/mcp version     # 期望 vX.Y.Z
npm view @sofagent/audit readme    # 期望有内容（非空）

# 全局安装更新（registry 已更新，本地仍是旧版本）
npm install -g @sofagent/audit@latest @sofagent/core@latest
sofagent-audit --version           # 期望 vX.Y.Z
sofagent-audit --doctor            # 期望与当前版本 doctor 项数一致
sofagent-core --doctor             # 期望全部通过

# 最终版本号一致性验证
bash tools/check-version.sh        # 期望全绿
```

---

## 开发 Prompt 校验循环（步骤 7）

```
① 跑 ./tools/check-dev-prompt.sh ~/Desktop/vX.Y-dev-prompt.md（查"引用的东西存不存在"）
② 脚本输出零 ❌ 后，再过一遍 FORGE/playbook/dev-prompt-checklist.md 的 5 条自查
   （查"写法对不对/全不全/新不新"——函数签名准确性、注册点/数组归属、改造代码保留声明、已完成区剥离、强动词名副其实）
③ 两项都过 → prompt 定稿
④ 任一项发现问题 → 逐条修正 prompt（只改 prompt 文件、不改代码库）→ 回到 ① 重跑
⑤ 最多 5 轮（5 轮仍不过说明开发日志本身有结构性问题，需人工介入）

脚本输出含义：
  ❌ 错误 = 引用了不存在的已有文件/函数（必须修）
  📋 待新建 = prompt 描述的新文件（正常，不算错误）
  🔄 运行时 = ~/.sofagent/ 等运行时目录（跳过）
```

> check-dev-prompt.sh 只查「存在性」，checklist 补「准确性」——两者互补，缺一不可。

---

## 下一版本开发 Prompt 生成说明（步骤 6）

> 来源：下一版本的「开发日志」——在 `docs/changelog/` 中查找（若不存在则先按下方流程补建）。辅助输入：`ROADMAP.md`（未来去哪 / 规划）+ `CHANGELOG.md`（版本索引）。

**生成流程**：
1. 读 `ROADMAP.md` 的「未来去哪」节，提取下一版本规划方向
2. 读 `CHANGELOG.md` 确认下一版本号与索引条目
3. 读 `docs/changelog/v<major>.<minor>/vX.Y.md`（下一版本开发日志，若存在）—— 这是开发 prompt 的主体来源
4. 综合上述，生成开发 prompt 落盘 `~/Desktop/vX.Y-dev-prompt.md`（结构：问题描述 → 修复方案 → 验证方式 → 发布检查清单）
5. 跑步骤 7 校验循环

**若下一版本 changelog 尚未创建**：
1. 先写新版本需求，产出 `docs/changelog/v<major>.<minor>/vX.Y.md`
2. 再执行上方「生成流程」生成桌面开发 prompt

---

## 下版本内容对话讲解（步骤 8）

> prompt 文件是给 AI 执行用的（精确的技术指令），但项目负责人（人）需要的是**用"人话"理解下版本要干什么**。步骤 8 在 prompt 定稿后，用对话形式向项目负责人讲解三个问题，帮助其理解方向、做出决策。

**讲解三个问题**（用大白话，不堆术语）：

1. **下个版本需要开发的内容**——一句话总结这版要干的核心的事，然后用"从 X 到 Y"的进化框架说清楚和上版本的区别（上版本做到了什么、留下了什么缺口、这版补什么）
2. **增加了什么新东西**——逐项列出新能力，每项用"人话"说明它解决什么问题（不是技术名词堆砌，是"企业客户为什么需要它"）
3. **能让产品未来怎么样**——这版做完后，产品的能力边界扩展到了哪里；和竞品/行业趋势的关系；为后续版本铺的什么路

**讲解原则**：
- 先给"一句话总结"，再展开细节
- 用具体场景举例（如"客服退货节点"而非抽象的"语义判定"）
- 对比"现在（上版本）" vs "做完后（这版）"的差异
- 说明每项能力的"对企业客户的意义"，不只讲技术实现

**互动方式**：讲解后询问项目负责人——是否需要调整开发优先级？是否有新的需求要加入？确认后 prompt 才算真正定稿。

---

## 进度追踪清零（步骤 9）

> 本版本发版流程全部完成后，最后一步——把 `releasing.md` 进度追踪的 12 个 `[x]` 全部改回 `[ ]`，为下一版本新周期做准备。

**为什么要清零**：进度追踪是"当前版本走到哪了"的实时状态。如果不清零，下版本新 session 打开 releasing.md 会看到 12 个全 [x]，误以为"已完成"而不知道该从哪开始。清零后第一个 `[ ]`（阶段一）就是下版本的起点。

**操作**：
```bash
# 把 releasing.md 进度追踪的 [x] 全部改回 [ ]
sed -i '' 's/- \[x\]/- [ ]/g' docs/changelog/releasing.md
```

**清零后确认**：进度追踪 12 行全部 `[ ]`，下一版本从阶段一重新开始。

---

## releasing 自迭代（步骤 10）

> releasing.md 是活文档——每次发版的实际执行体验是最值钱的反馈。步骤 10 是 releasing.md 的「Dream Cycle」：用它自己的经验喂养它自己，持续修正过时/缺漏/顺序不合理的地方。

**检查维度**（每次发版后逐一过）：

| # | 检查项 | 怎么查 | 修法 |
|:--:|--------|--------|------|
| 1 | **阶段顺序与实际流程一致** | 对比本次实际执行的步骤顺序 vs 阶段文件写的顺序 | 不一致 → 更新阶段文件（以实际为准） |
| 2 | **阶段间引用无断裂** | grep "阶段 X" 确认引用的阶段号/文件名都存在 | 断裂 → 修正引用 |
| 3 | **配套文档链接有效** | releasing.md 底部 3 个配套文档链接可访问 | 失效 → 更新路径 |
| 4 | **本次发版暴露的 SOP 缺口** | 回顾发版过程中「SOP 没写但我踩了坑」的环节 | 缺口 → 吸收进对应阶段 |
| 5 | **冗余/过时步骤** | 有没有阶段写了但实际从不执行（或已被工具覆盖）的步骤 | 删除或标注「工具已覆盖」 |

**v1.3.2 发版后的自迭代记录**（示例，每次发版后追加一条）：

- **步骤 3 新增**（审查三文档回写）：阶段五管代码质量，本步骤管发版流程——v1.3.2 阶段十一~十二暴露的 3 个问题（日期硬编码/警戒线多处同步/npm workspace 限制）进了 regression-checklist 95-97
- **阶段十一待拍板**：npm 先行策略（SOP 写的）vs tag 先行策略（v1.3.2 实际走的）——两种都合法，需项目负责人确认用哪种后统一 SOP
