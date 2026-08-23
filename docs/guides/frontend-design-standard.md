# sofagent 前端设计标准（Frontend Design Standard）

> 适用范围：sofagent 全部前端——dashboard 控制台、未来 Web 前端、插件 UI。
> 设计取向：**扁平化 + 强调线条**（参考 GitHub / HuggingFace 控制台），克制、留白、单主色。
> 本文档 = 设计标准 + 开发指南（架构/数据链路/口径/踩坑），改前端前必读，改动后同步更新。

---

## 一、设计原则

1. **扁平化**：不堆阴影、不堆渐变、不堆圆角胶囊。卡片用 1px 细边框区分，层次靠间距和背景色，不靠投影。
2. **强调线条**：交互状态（active / hover / 当前页）用**线条**表达——导航 active 用底部 2px 品牌色线条，按钮 hover 用边框加深，不用背景色块。
3. **单主色**：全站只有一个主色（品牌蓝 `--brand`）。其余颜色只有灰阶和两个语义色（红/黄）。
4. **颜色是稀缺资源**：红、黄只在"错误 / 报警"场景出现，出现即意味着要处理。正常状态一律蓝或灰。
5. **图标与文字一体**：图标是工具属性，默认继承文字灰；只有交互态（hover/active）才用品牌蓝。
6. **优先用类，少用内联**：样式一律通过 CSS 类（token）实现，尽量不写 `style="..."` 内联——保证全站统一、可单点维护。

---

## 二、颜色标准

### 2.1 色板（token，定义在 `:root`）

| Token | 值 | 用途 |
|-------|-----|------|
| `--brand` | `#16B8F3` | 品牌主色：active、链接、运行/激活、主数据 |
| `--brand-d` | `#0C447C` | 品牌深色：hover 主按钮等强调 |
| `--brand-l` | `#E6F1FB` | 品牌浅底：PASS 徽章、激活态填充 |
| `--text` | `#3F3F46` | 标题/强调文字（**带灰度，不纯黑**） |
| `--text-s` | `#5D6570` | 正文/次要文字 |
| `--text-t` | `#8B949E` | 标签/说明/占位文字 |
| `--bg` | `#F6F8FA` | 页面背景 |
| `--bg-s` | `#FAFBFC` | 卡片/区块内嵌浅底 |
| `--card` | `#fff` | 卡片背景 |
| `--border` | `#E1E4E8` | 边框/分割线 |
| `--red` | `#E24B4A` | **只用于错误**（FAIL、失败节点） |
| `--amber` | `#F5A623` | **只用于报警**（WARN、问题、人工介入） |

### 2.2 颜色使用规则

| 场景 | 颜色 | 说明 |
|------|------|------|
| 数字（指标卡/统计） | `--brand` | 大数字读"系统主色" |
| 文字 | `--text` / `--text-s` / `--text-t` | 三级灰阶，**禁止纯黑** `#000` / `#24292E` |
| 正常/激活/运行 | `--brand` | 导航 active、运行节点、呼吸点、PASS、实时连接 |
| 完成/中性 | 灰阶 | 完成节点、已完成状态 |
| 错误 | `--red` | FAIL 徽章、失败节点、宕机 |
| 报警 | `--amber` | WARN 徽章、问题、降级、人工介入 |
| 图形（图表） | `--brand`/`--brand-l` + 灰 | 主数据品牌蓝（或淡蓝柱）、报警数据灰、核心指标品牌蓝线 |
| 状态点（呼吸灯） | `--brand` | **所有呼吸/脉冲点统一品牌蓝**；语义点（错误红/报警黄）仅静态状态点 |

**规则**：能用品牌蓝的地方用品牌蓝，能用灰的地方用灰；红黄只留给"要不要处理"的信号。

---

## 三、按钮标准

1. **形态**：直角 `border-radius:6px`，高度 `28px`，字号 `12px`，内联图标 `13px`。**禁止跑道形（胶囊形）按钮**。
2. **变体**（`.btn` 基础 + 变体类）：

| 变体 | 样式 | 用途 |
|------|------|------|
| `btn-outline` | 白底 + 1px 灰边 + 灰字 | **默认/次要操作**（复制、下载、导出、刷新） |
| `btn-primary` | 白底 + 1px 灰边 + 深灰字 | 主操作（空态 CTA）——同为白系，靠字重区分 |
| `btn-ghost` | 透明 + 灰字 | 最轻操作（行内按钮） |

3. **全站按钮统一白系**：不出现品牌蓝实心按钮（除非未来有明确主操作层级，用 `--brand` 底白字）。
4. **hover 全站统一中性**：任何可交互元素（按钮/卡片/列表行/链接块）hover 只保留「边框加深 `--text-t` + 文字变深 `--text`」——**无背景变化、无下划线、无品牌蓝**。品牌蓝只留给 active/运行/选中态。
5. **复制类代码块**：自然语言 Prompt 用浅色块（`--bg-s` + 边框 + 灰字）；bash 命令用深色块（`#0D1117`，唯一允许的深色块）。
6. 刷新控件：固定 5s 自动刷新 + 一个刷新按钮（圆角方形 6px），**不提供间隔选择、不显示更新时间戳**。

---

## 四、卡片标准

1. **形态**：白底 + `1px solid var(--border)` 边框 + `border-radius:12px`，**无阴影**（扁平）。
2. 卡片内嵌浅底区域用 `--bg-s`（如图表容器 chart-box），不再加边框。
3. `section-header`：图标（14px）+ 标题 + 右侧操作位，`border-bottom:1px solid var(--border)` 与内容分隔。
4. 标题图标用 **Bootstrap Icons**（`<i class="bi bi-xxx">`），14px，继承文字色。

### 4.1 小卡片统一规范（fde-step / node-card / sc-item / rule-item / mcp-item / npm-item / doc-item）

所有**网格内小卡片**同一套规格（v1.4.0 起执行，曾因不统一导致"点位置不对"假象）：

| 项 | 标准 | 说明 |
|----|------|------|
| 背景 | `var(--bg-s)` | 浅底内嵌卡统一 |
| 边框 | `1px solid var(--border)` | 无阴影 |
| 圆角 | `var(--radius-s)`（8px） | **禁硬编码 6px**（mcp-item 曾违规） |
| 内边距 | `10px 12px` | 统一，无紧凑/标准两档 |
| 标题行 | **12px / 600** | 含点的首行字号全站统一 12px——**标题字号不随卡片变** |
| 描述行 | 11px / `--text-s` | 辅助说明 |
| 状态/类型点 | **8px** 圆点 | agent-dot / sc-dot / st-dot 统一 8px |
| 运行脉冲 | `animation:pulse 2s infinite` | 加载链 sc-dot、图脉冲点同款 |

> **教训**：小卡片"点位置不对"大多是**标题字号不统一**（10px/13px/12px 混用）导致的视觉错位——先统一文字等级，再微调点坐标。

---

## 五、图标标准

1. **统一 Bootstrap Icons**（CDN `bootstrap-icons@1.11.3`），禁止 emoji 作为 UI 图标。
2. **颜色**：默认继承文字灰（黑灰）；hover/active 用品牌蓝。**禁止全站图标蓝色**（会淹没品牌强调）。
3. 尺寸：section 标题 14px、按钮内 13px、正文内 12px、空态 26px。

---

## 六、导航 / Tab 标准

1. **顶部导航**：扁平**纯文字**导航——无背景容器、无胶囊。active 项：品牌蓝文字 + 底部 2px 品牌色线条；hover：文字变深灰。
2. **页内 Tab**（工作记录、帮助面板）：active 品牌蓝文字加粗，**无下划线**（与顶部导航区分，用 `.tab-inline` 类）。
3. 徽章/状态条（badge）：允许胶囊形 `border-radius:20px`——徽章与按钮形态区分。
4. header 结构：PC 三段对齐（logo | 导航 | 按钮），`.header-inner{max-width:1200px;margin:0 auto}` 与内容对齐；**别给 header 本身加 max-width**（背景会变窄）。
5. **导航顺序**（v1.4.0）：驾驶舱 → 业务流 → 本体图谱 → **知识库 → FDE 引导** → 工具箱——知识库在 FDE 引导前（业务流/本体/知识库空态都引导去 FDE，链路更顺）。
6. **页内 Tab 显式初始化**：默认 tab（如工作记录"概况"）必须在 Init 里显式调用 `wlTab('overview')`——不依赖 HTML 静态 `active` class（刷新后 active 可能丢失，显式初始化最稳）。

---

## 七、状态徽章与状态点

1. **徽章**（badge）：浅底 + 深字，胶囊形，字号 11px。语义：PASS=品牌蓝底、WARN=黄底、FAIL=红底。
2. **状态点**：
   - 呼吸/脉冲点（agent-dot、sc-dot、sov-dot、pulse-svg）：**一律品牌蓝**，尺寸 **8px**（小卡片内）或图内 SVG `r=3`。
   - 静态语义点：active=蓝、failed=红、hitl=黄、done/unknown=灰。
3. 守护进程类徽章统一「**点=状态色 + 字=灰**」结构。
4. **数据状态条**（实时/示例）：扁平「点 + 文字」，无胶囊背景（点蓝/点灰 + 灰字）。
5. **点与文字对齐（像素级方法）**：inline-block 圆点默认基线对齐会视觉偏上——用 `vertical-align:middle` + `position:relative;top` 微调；SVG 图内脉冲点圆心 `cy` = 文字基线 − 字号×0.25（9px 字 → 基线 −2.25px）。**先统一相邻字号再调坐标**（见 4.1 教训）。

---

## 八、间距与排版

1. **间距两级**：
   - 网格卡片（横向=纵向）**16px**：metrics / grid-2 / grid-3 / section 之间
   - section 内部小卡片 **8px**：rule-grid / doc-list / mcp / npm / step-card
2. ⚠️ **grid 内 section 必须 `margin-bottom:0`**（`.grid-2 > .section` 等）——否则 16px margin 溢出与容器叠加成 32px。
3. **字号三级**：标题 13-15px / 正文 12-13px / 标签说明 11px（小卡片标题固定 12px，见 4.1）。
4. **数字等宽**：`font-variant-numeric:tabular-nums`（指标/表格数字不跳动）。
5. **成本统一人民币**：引擎按美元计费（`costUsd` 字段），前端展示一律 `¥` + `×7.2` 估算汇率换算（如 `¥3.02`），不出现 `$`。示例数据、空态、提示文案同口径。
6. 文字**不纯黑**：标题 `--text`（#3F3F46），正文 `--text-s`，说明 `--text-t`。
7. **footer 间距**：`container` 底部 padding 归零（`padding:20px 20px 0`），footer 自身上下 16px——**与上卡片间距 = 与页面底间距**；每页最后一个 section/info-note 用 `.page .section:last-child{margin-bottom:0}` 归零（防普通 section 的 16px margin 叠加成 32px）。

---

## 九、动效

1. 呼吸点：`pulse` 2s 无限（opacity 1→0.4）。
2. 数字滚动：指标卡数值更新用 easeOutCubic 480ms（**数字不变不重播**，防 5s 刷新闪烁）。
3. 图表渐入：fadeIn 0.35s。
4. hover 过渡：0.15s。**不做**弹跳/旋转等花哨动效。
5. **加载骨架**：数据区加载态用 `.skeleton`（shimmer 灰块，`linear-gradient` + 位移动画），替代「加载中...」文字；更新时间小字/图内文字保留原位。

---

## 十、空态

统一 `emptyState(icon, title, desc, ctaText, ctaFn)`：图标（Bootstrap Icons 26px）+ 标题 + 一句说明 + 主操作按钮（btn-primary 白系）。文案统一「还没有 xxx + 去 XX 引导」模式。
- **按钮统一**：「去 FDE 引导」（业务流/本体图谱/知识库空态一律此文案，不写"去 FDE 引导部署/构建"）。
- **引导条**：数据源为空的页面（如工作记录概况）空态上方加主动引导条（说明数据来源 + 一键跳转按钮）。

---

## 十一、驾驶舱统计口径（核心规范，勿改）

**一句话**：驾驶舱所有数字统一到**规则检查级**（每条规则每次运行算一次检查的统计），不算任务级通过率。

| 口径 | 算法 | 用不用 |
|------|------|:--:|
| 规则级 | 每条规则每次运行算一次检查，PASS 占比（90%+） | ✅ 全站唯一口径 |
| 任务级 | 任一规则 FAIL/WARN 即任务失败（40% 左右） | ❌ 只摆任务数，不算比率 |

**趋势图**：淡蓝柱=审计次数（ruleAll）、灰柱=问题次数（ruleAll−rulePass）、品牌蓝线=通过率（右轴 80-100% 起，波动可见）。
- **y 轴顶数量级取整**：`step = max≥5000?1000 : max≥500?100 : max≥50?10 : 1`，`轴顶 = ceil(max×1.1 / step) × step`——刻度整齐（1 万→11000），最高柱不贴顶（占比 83-91%）。
- 指标卡 **5 张**（v1.4.0）：活跃 Agent / 总成本 / 今日任务 / 审计次数（今日）/ 问题次数（今日）——**不设"规则通过率"卡**（趋势图绿线已含，避免重复）。

**图内自洽公式**（用户会手算验证，铁要求）：
```
通过率 = 1 − 问题次数 ÷ 审计次数
审计次数 = 任务数 × 每任务规则数（约 24）
```

**数据字段语义**：任务级 `exitCode` 0=PASS/1=WARN/>1=FAIL；规则级 `ruleResults[].status` PASS/WARN/FAIL/SKIPPED（SKIPPED 不计分母）；daily 聚合 `rulePass`/`ruleAll`/`ruleRate`。

---

## 十二、数据链路与 API

```
浏览器 → /api/summary         ← 复用 bash dashboard 同口径 jq 聚合（HTML 与终端同一份数据）
      → /api/export-history   ← 原始全量 history.jsonl attachment（不截断）＝审计「下载审计记录」
      → /api/export-worklog   ← worklog.json attachment（概况/任务/介入/周报数据源）＝工作记录「下载工作记录」
      → /api/audit-recent     ← 审计记录分页（过滤测试、timestamp 倒序，与 summary recent 同口径）
      → /api/release-gate     ← forge-runs 门禁状态
      → /api/ai-nodes         ← fde/workflow/*.yaml + subagents/*.yml + sustain
      → /api/ontology         ← knowledge/{entities,concepts,relations}/
      → /data/*               ← 映射 ~/.sofagent/data/*（history.jsonl 截断最近 500 条防卡死）
```

- 双数据通道：服务器模式（全浏览器）+ File System Access API（Chrome/Edge 直连 `~/.sofagent/data`，Safari 自动隐藏按钮）
- 诚实呈现：数据源没数据就显示"未建立/待生成"引导，绝不假装有数据
- **下载体系**（v1.4.0）：列表保持精简（审计 10 条），全量走下载按钮——「下载工作记录」（worklog.json）+「下载审计记录」（audit-history.jsonl），命名统一「下载+内容」；**不做列表无限加载**（越加越长）；示例数据不显示下载按钮
- 测试记录过滤：只用泛化任务名正则（`TEST_TASK_RE`）；⚠️ **不用 `envFingerprint` 字段**（那是审计引擎给所有记录的常规字段，不是测试标记）
- 规模化预留：列表型数据源服务器端截断 + 报总数（如 ai-nodes 最多 12 + deployedTotal）

---

## 十三、移动端适配

| 问题 | 解法 |
|------|------|
| header 三栏挤爆 | 手机改两行：第一行 logo+按钮，第二行 nav 横向滚动 |
| iPhone 底部被 home 条挡 | container/footer 加 `env(safe-area-inset-bottom)` |
| 宽 SVG 缩放后文字看不清 | 编排控制图 `graph-wide` class，手机 `min-width:520px` + 容器横滑 |
| iOS 点 select 自动放大 | 字号 ≥16px（或不用原生 select） |
| 触控区 <44px | 按钮 `min-height:44px`（Apple HIG） |
| 横向 4/5 卡网格 | 窄屏回单列：`.arch-grid` / `.skill-chain` / `.node-grid` 加 `grid-template-columns:1fr` |
| 平板（769-1024） | FDE 步骤 5 列→3 列：`@media(min-width:769px) and (max-width:1024px){.fde-step{flex:0 0 calc(33.33% - 7px)}}` |
| 指标卡奇数张孤卡 | 2 列布局最后一张占满：`.metrics .metric-card:last-child:nth-child(odd){grid-column:1/-1}` |

---

## 十四、开发与验证流程

```bash
./start-dashboard.command                  # macOS 一键启动（根目录）
node tools/dashboard/serve-dashboard.mjs  # 命令行启动 → http://localhost:3780
node tools/gen/gen-weekly-report.mjs       # 手动生成持续优化周报
```

改完必跑验证：
1. div 配平（`<div>` 开闭数相等）
2. 新增 id 有对应渲染函数（防"只有容器没有 JS"的隐藏 bug）
3. `/api/*` 端点 curl 通
4. 颜色/间距符合本文档标准（全局 grep 该元素所有出现位置，一次性同步）
5. 中文字符无 U+FFFD 乱码
6. 驾驶舱数字可自验算（拿 rulePass/ruleAll 手算一遍）

---

## 十五、踩坑记录（血的教训）

1. **grid 内 section margin 叠加**：`.section` 全局 `margin-bottom:16px` 在 grid 容器内会向外溢出 → 横向 16px 纵向 32px。修复：grid 直接子元素 margin 清零。
2. **header 对齐**：别给 `.header` 加 max-width（背景变窄露出 body），内部包 `.header-inner` 限宽。
3. **颜色"拍脑袋"**：任何颜色必须写进统一规则，改动前全局 grep 该元素所有出现位置一次性同步。
4. **同名指标两套口径 = bug**：一个页面同名指标只能一套口径；图内每个数字必须可自验算；比率口径选择听用户的（规则级 90%+ 好看，任务级 40% 会被怀疑系统有问题）。
5. **过滤字段不能凭字段名猜语义**：`envFingerprint` 是常规字段不是测试标记（曾误杀真实记录）——过滤条件必须用真实记录实证。
6. **emoji 正则代理对**：Node 脚本批量替换 emoji 时 `String.fromCodePoint` 在 grep 匹配不到——直接文本验证。
7. **star-btn 边框缺失**：hover 时按钮边框缺一截——是 `a:hover` 下划线被误删成 `border-bottom:none` 所致；正确是类选择器 `text-decoration:none`。
8. **内置模板与用户数据分离**：AI 节点页=用户业务节点（部署态）；FDE 引导页=项目内置模板（方法论），勿混。
9. **单文件零依赖原则**：dashboard 保持单 HTML + 服务器同目录；外部依赖（除 Bootstrap Icons CDN）谨慎引入。
10. **搬 DOM 必须搬触发逻辑**（v1.4.0）：节点移到其他页面后，goPage 事件绑定必须同步（引擎流水线移到工具箱页后曾因没触发加载而空白）。
11. **脚本移动 DOM 后查闭合配平**（v1.4.0）：移动 section 不能只看 div 总数平衡——要逐个 section 验证自包含闭合（header+body 配平），否则后续 section 嵌套进前一个。
12. **点位置不对先查字号统一**（v1.4.0）：小卡片"点偏了"大多是标题字号不统一（10/13/12px 混用）——先统一文字等级（12px），再微调坐标（见 4.1）。
13. **重复信息不加**（v1.4.0）：图下方已有文字介绍时，上方不加图例（状态点图例曾画蛇添足被撤）；工具区说明教"怎么用"而非"在哪管"。

---

## 十六、导航页职责（6 页）

| 页面 | 数据源 | 职责 |
|------|--------|------|
| 驾驶舱 | /api/summary + daemon-health | 5 指标卡 → 工作记录（概况/任务/审计/介入/周报）→ 审计分析+数据主权（一行） |
| 业务流 | /api/ai-nodes + graph-state | 业务节点 + 编排控制图（+状态点图例） |
| 本体图谱 | /api/ontology | 本体数据（实体/概念/关系）+ 图谱视图 |
| FDE 引导 | workflow 模板 + 五阶段 Prompt | 方法论 + 部署入口（FDE Agent 模板 + FDE workflow 自举图） |
| 知识库 | index.md + log.md + think.md | 知识页面 + 业务领域 + 经验教训 |
| 工具箱 | 安装 + 约束层(4 卡横排) + skill 加载链(4 卡横排) + 文档直达 + 审计规则(8 列) + MCP(6 列) + npm + FORGE(含引擎流水线 5 卡一行) | 资源/参考 |

> 页面归组原则：**数据/状态类进独立页，参考/资源类进工具箱**。

---

## 十七、检查清单（上线前自检）

- [ ] 无 `#000` / `#24292E` 纯黑文字
- [ ] 无跑道形按钮（除 badge）
- [ ] 无 emoji 图标（UI 位置）
- [ ] 红/黄只出现在错误/报警场景
- [ ] 呼吸点统一品牌蓝
- [ ] hover 全站中性（无品牌蓝 hover、无背景变化、无下划线）
- [ ] 状态条为「点 + 文字」扁平（无胶囊背景）
- [ ] 卡片无阴影（1px 边框）
- [ ] 导航为文字式 + active 强调线条
- [ ] 图标黑灰默认、hover 蓝
- [ ] 数字 tabular-nums
- [ ] 间距符合 16px/8px 两级系统
- [ ] 优先用 CSS 类、少内联样式
- [ ] 驾驶舱数字可自验算（规则检查口径）
- [ ] 小卡片规格统一（背景 bg-s / 圆角 radius-s / 内边距 10 12 / 标题 12px / 点 8px，见 4.1）
- [ ] 列表全量走「下载」按钮，不做无限加载
- [ ] div 配平 + section 自包含闭合（脚本移动 DOM 后必查）

---

*本标准随 dashboard 设计实践沉淀，改动需同步更新本文档。*
