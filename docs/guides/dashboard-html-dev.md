# 🖥️ HTML Dashboard 开发指南（dashboard-html-dev）

> 单文件零依赖 SPA 的设计原则、数据链路、视觉规范与踩坑记录。
> **版本：V1.1（2026-08-03）** —— 覆盖 V4 → V10 全部迭代经验（V10 = 驾驶舱统计口径统一）
> 维护者：孔放勋

---

## 〇、版本与演进史（为什么是现在这样）

> 读这段可以理解"为什么页面是 6 个、为什么 FORGE 在工具箱、为什么数据要过服务器"。

| 版本 | 关键变化 | 教训 |
|------|---------|------|
| V4 | 页面 7→9 页（FORGE 独立页 + 本体页新增） | 页面多不一定好 |
| **V5** | **9→7 页**：架构+审计合并"引擎"页；FORGE 移入"工具箱"页 | 导航精简：内容按"性质"归组（参考/资源类进工具箱） |
| **V6** | 静态假数据 → **真实数据驱动**（graph-state / index.md / forge latest.json） | 用户明确反感"死的介绍页" |
| V6.1 | `/api/summary` **复用 bash dashboard 同口径 jq 聚合** | HTML 与终端必须看到同一份数据 |
| V6.2 | FORGE 补全 release-gate-loop；AI 节点真实数据 | 工具链完整展示 |
| V6.5 | **dashboard.html 移到仓库根目录**（不在 docs/） | 放 docs/ 里"藏身"，用户找不到 |
| V7.6 | **引擎页并入工具箱**，导航 7→6 | 引擎内容是参考/资源，与 FORGE 同理 |
| V8.4 | sustain 周报真实落地（gen-weekly-report.mjs） | 诚实呈现 + 手动触发补数据 |
| V9.x | 颜色体系统一（agent 色板 / 统计卡规则 / 实体绿） | 颜色必须写进规则，勿拍脑袋 |
| **V10** | **驾驶舱统计口径统一**：测试记录过滤 + 全部统一到「规则检查级」（蓝柱审计次数 + 黄柱问题次数 + 绿线通过率），四指标卡改「今日值 + 总量」，新增 `/api/export-history` 全量导出 | 同名指标不同口径 = 用户眼中的 bug；图内每个数字必须可自验算 |

**当前稳定形态（V1.1 快照）**：6 页导航 · 单文件零依赖 · 5 API（含导出）· 全站统一色板 · 驾驶舱规则检查口径 · 移动端适配。

---

## 一、定位与架构

### 1.1 文件位置

| 文件 | 职责 |
|------|------|
| `tools/dashboard/dashboard.html` | 单文件零依赖 SPA，6 页导航：驾驶舱 / FDE引导 / AI节点 / 本体结构 / 知识库 / 工具箱 |
| `start-dashboard.command`（仓库根目录） | macOS 一键启动快捷指令（双击即开，关窗口即停；本质是 `node tools/dashboard/serve-dashboard.mjs` 包装；仅 macOS 双击入口） |
| `tools/dashboard/serve-dashboard.mjs` | 本地 HTTP 服务器：页面 + `/data/*` 原始数据 + 4 个聚合 API |
| `tools/gen/gen-weekly-report.mjs` | 手动生成持续优化周报（daily + weekly） |
| `docs/assets/` | logo/favicon 等静态资源（dashboard 用 `docs/assets/` 相对路径引用，不建软链） |

> ⚠️ **dashboard.html 位于 `tools/`**——Web Dashboard（与服务器 serve-dashboard.mjs 同目录），双形态之一（终端形态为 sofagent-dashboard.sh）。历史迁移：最初放 docs/ 根「藏身」用户找不到 → V6.5 移到仓库根 → v1.3.3 移到 docs/demo/（当时误定位为「开发预览版」）→ **v1.3.5 归位 tools/**（demo 名不副实——README 三入口表早已将 Web 版列为产品入口，与服务器同目录才是它的家）。

### 1.2 数据链路（关键设计）

```
浏览器 → /api/summary         ← 复用 bash dashboard 同口径 jq 聚合（PASS/WARN/FAIL + TOP3 + 数据主权）
                                 + 测试记录过滤 + 规则级 daily 统计（rulePass/ruleAll/ruleRate）
      → /api/export-history   ← 原始全量 history.jsonl attachment 下载（含测试记录，不截断）
      → /api/release-gate     ← forge-runs/release-gate-loop/{日期}/{run}/status.json + progress.jsonl
      → /api/ai-nodes         ← fde/workflow/*.yaml（模板）+ subagents/*.yml（已部署）+ sustain 状态
      → /api/ontology         ← knowledge/{entities,concepts,relations}/ 目录扫描
      → /data/*               ← 映射 ~/.sofagent/data/*（history.jsonl 截断最近 500 条防卡死）
```

- **/api/summary 复用 bash 口径**（V6.1 核心设计）：执行与 `tools/dashboard/sofagent-dashboard.sh` 完全相同的 jq 聚合（`dataFlow.destination=="cloud-api"` / `direction=="outbound"` 判定）——HTML 与终端看到的是同一份数据
- **测试记录过滤**（V10）：fixture 泛化任务名（"add code" 重复 476 次等）会被统计成几百条"违规"污染趋势。服务器用 `TEST_TASK_RE` 正则过滤后聚合，`/api/summary` 返回 `totalRecords/filteredTestRecords/auditTotal` 三个计数保持透明。⚠️ **只用任务名过滤，不用 `envFingerprint` 字段**——那是审计引擎给所有记录（含真实记录）打的常规字段，不是测试标记（详见 §4.12）
- **/api/export-history**（V10）：审计记录卡右上角「全量历史」按钮直接下载原始全量（5000+ 行不截断）。决策：原始数据本就在 `~/.sofagent/data/audit/history.jsonl`，**不在 data/ 目录重复存一份**，下载原始全量最诚实
- **File System Access API**：Chrome/Edge 用户可直接点「连接数据目录」选 `~/.sofagent/data` 免服务器（Safari 不支持，按钮自动隐藏）
- **双数据通道**：服务器模式（全浏览器）+ FS Access（Chrome/Edge）——双击打开 HTML 只显示示例数据 + 提示
- **诚实呈现原则**：数据源没数据就显示"未建立/待生成"引导，绝不假装有数据（见 §四·sustain 案例）

### 1.3 服务器实现细节（serve-dashboard.mjs）

- **ESM 纯 import**（不能 require）
- 端口自动检测（占用 +1）
- 自动打开浏览器（open / cmd start / xdg-open）
- no-cache 头（Cache-Control no-store）
- 路径穿越防护（/data/* 不越界到 ~/.sofagent 之外）

---

## 二、设计系统（统一规范）

### 2.1 Agent 类型色板（全站一致，7 色不重复）

| 类型 | 颜色 | 卡片底/边框 | 用途 |
|------|:--:|------|------|
| analyst 分析师 | 🔵 蓝 `#16B8F3` | `#E6F1FB`/蓝 | FDE 步骤 1-4 |
| audit 审计 | 🔴 红 `#E24B4A` | `#FCEBEB`/红 | 编排流水线节点 |
| planner 规划师 | 🟢 绿 `#1D9E75` | `#E1F5EE`/绿 | FDE 步骤 5/6/8 |
| deployer 部署专家 | 🟠 橙 `#EF9F27` | `#FAEEDA`/橙 | FDE 步骤 7/9/10 |
| engineer 工程师 | 🟡 黄 `#E0A800` | `#FFF8E1`/黄 | 编排流水线节点（工程师黄帽梗） |
| reviewer 审查 | 🟣 紫 `#7F77DD` | `#F3E8FF`/紫 | 编排流水线节点 |
| human 人工 | ⚪ 灰 `#8B949E` | `#F1F3F4`/灰 | 人工确认 |

> `.agent-dot.{type}`：10px 闪烁圆点（`pulse 2s` 动画），FDE 卡片 + AI 节点卡片 + SVG 编排控制图三处共用。

### 2.2 统计卡颜色规则（按数据性质，不按页面）

| 语义 | 颜色 | 用在哪 |
|------|:--:|------|
| 知识内容/资产 | 🟣 紫 | 知识页面、概念 |
| 业务视角/分类 | 🔵 蓝 | 业务领域、关系 |
| 动态/记录 | 🟡 琥珀 | 更新日志、经验教训 |
| 具体业务对象 | 🟢 绿 | **实体**（从紫拆出，用户指定归类） |

> 驾驶舱四指标卡（V10 定稿）：**绿=规则通过率 / 紫=审计任务（今日+总）/ 蓝=审计次数（今日+总）/ 琥珀=问题次数（今日+总）**，是**状态语义**，另一套规则，勿混。四卡均为「今日值大字 + 总量小字」双数结构。

### 2.3 间距规范（两级）

| 层级 | 值 | 覆盖 |
|------|:--:|------|
| 网格卡片（横向=纵向） | **16px** | metrics / grid-2 / grid-3 / section 之间 |
| section 内部小卡片 | **8px** | rule-grid / doc-list / mcp / npm / step-card / fde-stage |

> ⚠️ **grid 内 section 必须 `margin-bottom:0`**：`.grid-2 > .section, .grid-3 > .section { margin-bottom:0 }`——否则 item 的 16px margin 会向外溢出与容器叠加成 32px（横向只有 16px，视觉歪）。

### 2.4 header 结构（三段对齐）

- PC：`grid-template-columns:1fr auto 1fr` 三段（logo | nav | GitHub），nav 居中
- **对齐技巧**（V7.9）：header 保持全宽背景，内部 `.header-inner{max-width:1200px;margin:0 auto}` 与内容卡片对齐——**别给 header 本身加 max-width**（背景会变窄）
- 移动端：改两行（第一行 logo+star，第二行 nav 横滚）

### 2.5 交互细节规范

- 刷新间隔：**分段按钮组**（关/5s/10s/30s → 后改为 手动刷新按钮 + 5s/10s/30s 胶囊），不用原生 select（视觉简陋 + iOS 缩放问题）
- 右上角时间戳：统一 `fmtUpdatedAt()` 公共函数（"更新于 HH:MM:SS"），禁止各处写不同文案
- 审计记录 rule 列：FAIL/WARN 显示规则码（红/橙），PASS 显示 ✓（绿）——**不用占位符 '-'**
- 审计记录卡右上角：「全量历史」下载按钮（`/api/export-history`）+ 标题旁记录计数
- 趋势图柱顶标数值，**折线点不标数字**（会与柱子重叠，视觉差）；右轴百分比刻度用灰色弱化

### 2.6 驾驶舱统计口径（V10 定稿，核心规范）

**一句话**：驾驶舱所有数字统一到**规则检查级**（24 条规则逐条检查的统计），不算任务级通过率。

**两种口径的区别**（曾经同页并存被用户当 bug，教训见 §4.13）：

| 口径 | 算法 | 天然量级 | 用不用 |
|------|------|:--:|:--:|
| 规则级 | 每条规则每次运行算一次检查，PASS 占比 | 90%+（每任务仅少数规则违规） | ✅ 全站唯一口径 |
| 任务级 | 任一规则 FAIL/WARN 即任务失败 | 40% 左右 | ❌ 只摆任务数，不算通过率 |

**趋势图（双量纲双轴）**：蓝柱 `#16B8F3`=审计次数（ruleAll）+ 黄柱 `#EF9F27`=问题次数（ruleAll−rulePass）走左轴；绿线 `#1D9E75`=通过率走右轴（0-100% 灰色刻度）。

**图内自洽公式**（用户可自验算，这是铁要求）：
```
绿线通过率 = 1 − 黄柱问题次数 ÷ 蓝柱审计次数
审计次数   = 任务数 × 每任务规则数（约 24）
例：今日蓝柱 560、黄柱 20 → 绿线 (560−20)/560 = 96% ✓
验算锚点：39473 次检查 ≈ 3164 任务 × ~24 规则
```

**口径说明**：图表下方一行公式（`fillCaliberNote`）：「审计次数＝任务数×每任务规则数；问题次数＝其中 WARN/FAIL 的检查；通过率＝1−问题次数÷审计次数」。**不写长段解释**——用户明确反馈冗长说明影响视觉体验。

**数据字段语义**（改驾驶舱前必读）：
- 任务级：`exitCode` 0=PASS / 1=WARN / >1=FAIL
- 规则级：`ruleResults[].status` PASS/WARN/FAIL/SKIPPED（SKIPPED 不计入分母）
- daily 聚合字段：`rulePass`（PASS 的检查数）/ `ruleAll`（非 SKIPPED 的检查数）/ `ruleRate`（百分比）

---

## 三、移动端适配要点

| 问题 | 解法 |
|------|------|
| header 三栏挤爆 | 手机改两行：第一行 logo+star，第二行 nav 横向滚动（`-webkit-overflow-scrolling:touch`） |
| iPhone 底部被 home 条挡 | container/footer 加 `env(safe-area-inset-bottom)` |
| 宽 SVG 缩放后文字看不清 | 编排控制图加 `graph-wide` class，手机 `min-width:520px` + 容器横滑（不缩放） |
| iOS 点 select 自动放大 | 字号 ≥16px（或改用分段按钮，无此问题） |
| 触控区 <44px | copy-btn `min-height:44px`（Apple HIG） |
| 审计记录行挤爆 | flex-wrap + 任务文本占整行（order:3） |

---

## 四、踩坑记录（血的教训）

### 4.1 JS 字符串转义吞反斜杠（V6.1）
jq 程序 `"\(.x)"` 里的 `\(` 在 JS 普通字符串中丢反斜杠（未知转义被吞）→ 必须写 `\\\(`。涉及 pass/fail、top3、recent、sovereignty 4 处。

### 4.2 grid 内 section margin 叠加（V7.7）
`.section` 全局 `margin-bottom:16px`，在 grid 容器内会向外溢出 → 第一行 grid 行高被撑 16 + 容器 margin 16 = **32px**，横向 gap 只有 16px。修复：grid 直接子元素 section margin 清零。

### 4.3 sustain "持续优化"诚实呈现（V8.3-V8.4）
第 10 步"持续优化"最初只是模板展示，无真实数据。查证：`trend-aggregator.ts` / `daily-snapshot.ts` 两个生成器 v1.2.5 已写好且注册，**只是从未被触发**（daemon 没跑）。方案：
1. 先诚实显示"🟡 能力就绪"（不假装有数据）
2. 写 `tools/gen/gen-weekly-report.mjs` 手动触发：从 `audit/history.jsonl`（5186 条真实记录）回填 daily + 生成 weekly 周报
3. `/api/ai-nodes` 的 sustain 字段读 weekly-*.json，有数据自动 `active:true`

> **原则**：页面显示"待巡检/未建立"不是失败，是诚实。用户会质疑"是不是吹牛"，数据驱动胜过话术。

### 4.4 编排流水线 vs 业务节点混淆（V8.9）
用户问"节点详情为什么没有 deployer"。查证：graph-state 的 5 节点（planner/engineer/audit/reviewer/human）是 **orchestrator LOOP 流水线固定类型**（`plan-node.ts:66` 联合类型），deployer 是 **FDE 业务层角色**——不同抽象层。修复：标题"节点详情"→"编排流水线节点" + 说明引导。

### 4.5 emoji 编码与正则（V7.2 等）
- 用 Node 脚本批量替换 emoji 时，`String.fromCodePoint(0x1F535)` 在 grep 里匹配不到（代理对）——直接文本验证
- HTML 里 `onclick="goPage('fde')"` 单引号在 JS 字符串拼接时要小心转义层级

### 4.6 header 对齐别给 header 本身加 max-width（V7.9）
给 `.header` 加 `max-width` 会让背景色变窄，左右露出 body 背景。正确：header 保持全宽背景，**内部包 `.header-inner{max-width:1200px;margin:0 auto}`**。

### 4.7 颜色"拍脑袋"教训（V9.4-V9.7）
统计卡/介绍卡/分组标题三处颜色各自定义 → 概念绿、实体紫混乱。教训：**任何颜色必须写进统一规则**（§二），改动前全局 grep 该元素所有出现位置，一次性同步。

### 4.8 thinkList 从未填充的隐藏 bug（V9.2）
"最近经验教训"block 只有 HTML 容器没有 JS 渲染，一直"加载中..."。教训：**每个 id 容器必须确认有对应渲染函数**，加新 UI 块时检查。

### 4.9 star-btn 边框缺失（V6）
hover 时按钮边框底部缺一截——V5 为去"黑线"误加 `border-bottom:none`，把圆形按钮底部边框砍了；实际"黑线"是 `a:hover{text-decoration:underline}` 的下划线。修复：删 `border-bottom:none` + `.star-btn:hover{text-decoration:none}`（类选择器优先级高于元素选择器）。

### 4.10 规模化预留（V6.4）
AI 节点未来可能几百个，渲染不能卡。方案：**服务器端截断 + 报总数**——`/api/ai-nodes` 只返回最多 12 个 + `deployedTotal` 总数；前端同样最多渲染 12 个 + "共 N 个，完整列表见 ~/.sofagent/subagents/" 提示。列表型数据源都要考虑这个。

### 4.11 内置模板与用户数据分离（V6.4）
AI 节点页不能塞 FDE workflow 模板（那是项目内置方法论），否则用户数据一多就混乱。原则：**AI 节点页 = 用户业务节点（部署态）；FDE 引导页 = 项目内置模板（方法论）**——模板与用户数据分开展示。

### 4.12 envFingerprint 不是测试标记——过滤字段想当然的代价（V10）
测试记录过滤最初用「`envFingerprint !== undefined`」当判据，结果 **08-02 之后所有真实记录被误杀**——该字段是审计引擎升级后给所有记录（含真实审计）加的常规字段，根本不是测试标记。修复：只保留泛化任务名正则（`TEST_TASK_RE`）。**教训：过滤条件必须用真实记录实证过（抽几条近期真实记录验证字段分布），不能凭字段名猜语义。**

### 4.13 同名指标两套口径 = 用户眼中的 bug（V10，四轮迭代）
驾驶舱通过率被用户连续质疑四轮：① 左上角 92% vs 趋势图 30% 矛盾（规则级 vs 任务级同名混淆）② 绿线 94% 与紫黄柱图内算不平 ③ 双口径标注仍被指"40% 太低、两套数字不该硬凑" ④ 最终决策已定：全部统一规则检查级。**教训**：
- 一个页面里**同名指标只能有一套口径**，不同集合（规则集 vs 任务集）要么分开展示、要么只摆数量不算比率
- **图内每个数字必须可自验算**（柱÷柱=线），用户会拿真实数据手算挑战你
- 比率口径的选择听用户的：规则级数字"好看"（90%+），任务级太低（40%）会让用户怀疑系统有问题
- 视觉优先：折线点不加数字（与柱重叠）、口径说明一行公式不写长文

---

## 五、开发业务流

```bash
# 启动
./start-dashboard.command             # macOS 一键启动（根目录，双击即开；关窗口即停）
node tools/dashboard/serve-dashboard.mjs        # 命令行启动 → http://localhost:3780（自动开浏览器）

# 生成持续优化周报（手动触发）
node tools/gen/gen-weekly-report.mjs      # 从 audit/history.jsonl 生成 daily + weekly

# 手机预览
# 手机浏览器开 http://<局域网IP>:3780，或本地 localhost 后 DevTools 模拟

# 验证（改完必跑）
# 1. div 配平：opens===closes
# 2. 新增 id 有渲染函数（防 thinkList 式隐藏 bug）
# 3. /api/* 五个端点 curl 通（summary/export-history/release-gate/ai-nodes/ontology）
# 4. 颜色/间距符合 §二规范（全局 grep 该元素所有出现位置）
# 5. 中文字符无 U+FFFD 乱码
# 6. 驾驶舱数字可自验算：绿线 = 1 − 黄柱 ÷ 蓝柱（拿 /api/summary 的 rulePass/ruleAll 手算一遍）
```

---

## 六、导航页职责（6 页）

| 页面 | 数据源 | 职责 |
|------|--------|------|
| 驾驶舱 | /api/summary + daemon-health | 四指标卡（今日+总量）+ 审计趋势（规则检查口径）+ 全量导出 + 数据主权 |
| FDE 引导 | workflow 模板（10 步）+ 五阶段 Prompt | 方法论 + 部署入口 |
| AI 节点 | /api/ai-nodes + graph-state | 业务节点 + 编排流水线 |
| 本体结构 | /api/ontology | 实体/概念/关系三要素 |
| 知识库 | index.md + log.md + think.md | 知识页面 + 业务领域 + 经验教训 |
| 工具箱 | 安装 + 架构 + 规则 + MCP + npm + 文档 + FORGE | 资源/参考（引擎已并入，勿拆回） |

> 引擎页 V7.6 已并入工具箱（导航 7→6）——引擎内容本质是"参考/资源"，与 FORGE 同理。**页面归组原则：数据/状态类进独立页，参考/资源类进工具箱。**

---

## 附：关键架构决策速查

| 决策 | 为什么 |
|------|--------|
| 单文件零依赖 | 用户只保存 HTML 也能用；外部 CDN 会 404 废掉功能 |
| 图标用 emoji/SVG 不用图片 | 零依赖 + 轻量 |
| /api/summary 复用 bash jq | HTML 与终端同一份数据，口径不漂移 |
| dashboard.html 在 tools/（v1.3.5 归位，与服务器同目录） | 服务端与页面配对；serve-dashboard.mjs 自动路由 |
| 内置模板与用户数据分离 | AI 节点页=用户业务节点；FDE 引导页=方法论模板，避免"死的介绍页"混淆 |
| 数据源没数据→诚实显示"待生成" | 不吹牛；数据驱动胜过话术 |
| 驾驶舱统一规则检查口径（V10） | 任务级 40% 太低会被疑系统有问题；规则级 90%+ 且图内可自验算；同名指标禁双口径 |
| 测试过滤只认任务名正则 | envFingerprint 是常规字段不是测试标记（误杀真实数据教训，§4.12） |
| 全量数据下载而非复制到 data/ | 原始数据已在 ~/.sofagent/data/audit/history.jsonl，不重复存储，下载最诚实 |
