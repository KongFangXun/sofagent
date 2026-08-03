# 🖥️ HTML Dashboard 开发指南（dashboard-dev）

> 单文件零依赖 SPA 的设计原则、数据链路、视觉规范与踩坑记录。
> 维护者：孔放勋 · 2026-08-03（V6.2 → V9.7 迭代沉淀）

---

## 一、定位与架构

### 1.1 文件位置

| 文件 | 职责 |
|------|------|
| `dashboard.html`（仓库根目录） | 单文件零依赖 SPA，6 页导航：驾驶舱 / FDE引导 / AI节点 / 本体结构 / 知识库 / 工具箱 |
| `tools/serve-dashboard.mjs` | 本地 HTTP 服务器：页面 + `/data/*` 原始数据 + 4 个聚合 API |
| `tools/gen-weekly-report.mjs` | 手动生成持续优化周报（daily + weekly） |
| `assets` | 软链 → `docs/assets/`（logo） |

> ⚠️ **dashboard.html 必须在仓库根目录**（不在 docs/）——用户 clone 后一眼可见。历史教训：放 docs/ 里"藏身"了，用户找不到。

### 1.2 数据链路（关键设计）

```
浏览器 → /api/summary     ← 复用 bash dashboard 同口径 jq 聚合（PASS/WARN/FAIL + TOP3 + 数据主权）
      → /api/release-gate ← forge-runs/release-gate-loop/{日期}/{run}/status.json + progress.jsonl
      → /api/ai-nodes     ← fde/workflow/*.yaml（模板）+ subagents/*.yml（已部署）+ sustain 状态
      → /api/ontology     ← knowledge/{entities,concepts,relations}/ 目录扫描
      → /data/*           ← 映射 ~/.sofagent/data/*（history.jsonl 截断最近 500 条防卡死）
```

- **File System Access API**：Chrome/Edge 用户可直接点「连接数据目录」选 `~/.sofagent/data` 免服务器（Safari 不支持，按钮自动隐藏）
- **静态打开降级**：无服务器时自动切示例数据 + 提示
- **诚实呈现原则**：数据源没数据就显示"未建立/待生成"引导，绝不假装有数据（见 §四·sustain 案例）

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

> 驾驶舱指标卡（绿=通过率/蓝=记录/琥珀=违规/紫=本地化）是**状态语义**，另一套规则，勿混。

### 2.3 间距规范（两级）

| 层级 | 值 | 覆盖 |
|------|:--:|------|
| 网格卡片（横向=纵向） | **16px** | metrics / grid-2 / grid-3 / section 之间 |
| section 内部小卡片 | **8px** | rule-grid / doc-list / mcp / npm / step-card / fde-stage |

> ⚠️ **grid 内 section 必须 `margin-bottom:0`**：`.grid-2 > .section, .grid-3 > .section { margin-bottom:0 }`——否则 item 的 16px margin 会向外溢出与容器叠加成 32px（横向只有 16px，视觉歪）。

---

## 三、移动端适配要点

| 问题 | 解法 |
|------|------|
| header 三栏挤爆 | 手机改两行：第一行 logo+star，第二行 nav 横向滚动（`-webkit-overflow-scrolling:touch`） |
| iPhone 底部被 home 条挡 | container/footer 加 `env(safe-area-inset-bottom)` |
| 宽 SVG 缩放后文字看不清 | 编排控制图加 `graph-wide` class，手机 `min-width:520px` + 容器横滑（不缩放） |
| iOS 点 select 自动放大 | 字号 ≥16px |
| 触控区 <44px | copy-btn `min-height:44px`（Apple HIG） |
| 审计记录行挤爆 | flex-wrap + 任务文本占整行（order:3） |

---

## 四、踩坑记录（血的教训）

### 4.1 grid 内 section margin 叠加（V7.7）
`.section` 全局 `margin-bottom:16px`，在 grid 容器内会向外溢出 → 第一行 grid 行高被撑 16 + 容器 margin 16 = **32px**，横向 gap 只有 16px。修复：grid 直接子元素 section margin 清零。

### 4.2 sustain "持续优化"诚实呈现（V8.3-V8.4）
第 10 步"持续优化"最初只是模板展示，无真实数据。查证：`trend-aggregator.ts` / `daily-snapshot.ts` 两个生成器 v1.2.5 已写好且注册，**只是从未被触发**（daemon 没跑）。方案：
1. 先诚实显示"🟡 能力就绪"（不假装有数据）
2. 写 `tools/gen-weekly-report.mjs` 手动触发：从 `audit/history.jsonl`（5186 条真实记录）回填 daily + 生成 weekly 周报
3. `/api/ai-nodes` 的 sustain 字段读 weekly-*.json，有数据自动 `active:true`

> **原则**：页面显示"待巡检/未建立"不是失败，是诚实。用户会质疑"是不是吹牛"，数据驱动胜过话术。

### 4.3 编排流水线 vs 业务节点混淆（V8.9）
用户问"节点详情为什么没有 deployer"。查证：graph-state 的 5 节点（planner/engineer/audit/reviewer/human）是 **orchestrator LOOP 流水线固定类型**（`plan-node.ts:66` 联合类型），deployer 是 **FDE 业务层角色**——不同抽象层。修复：标题"节点详情"→"编排流水线节点" + 说明引导。

### 4.4 emoji 编码与正则（V7.2 等）
- 用 Node 脚本批量替换 emoji 时，`String.fromCodePoint(0x1F535)` 在 grep 里匹配不到（代理对）——直接文本验证
- HTML 里 `onclick="goPage('fde')"` 单引号在 JS 字符串拼接时要小心转义层级

### 4.5 header 对齐别给 header 本身加 max-width（V7.9）
给 `.header` 加 `max-width` 会让背景色变窄，左右露出 body 背景。正确：header 保持全宽背景，**内部包 `.header-inner{max-width:1200px;margin:0 auto}`**。

### 4.6 颜色"拍脑袋"教训（V9.4-V9.7）
统计卡/介绍卡/分组标题三处颜色各自定义 → 概念绿、实体紫混乱。教训：**任何颜色必须写进统一规则**（§二），改动前全局 grep 该元素所有出现位置，一次性同步。

### 4.7 thinkList 从未填充的隐藏 bug（V9.2）
"最近经验教训"block 只有 HTML 容器没有 JS 渲染，一直"加载中..."。教训：**每个 id 容器必须确认有对应渲染函数**，加新 UI 块时检查。

---

## 五、开发工作流

```bash
# 启动
node tools/serve-dashboard.mjs        # → http://localhost:3780（自动开浏览器）

# 生成持续优化周报（手动触发）
node tools/gen-weekly-report.mjs      # 从 audit/history.jsonl 生成 daily + weekly

# 手机预览
# 手机浏览器开 http://<局域网IP>:3780，或本地 localhost 后 DevTools 模拟

# 验证（改完必跑）
# 1. div 配平：opens===closes
# 2. 新增 id 有渲染函数
# 3. /api/* 四个端点 curl 通
# 4. 颜色/间距符合 §二规范
```

---

## 六、导航页职责（6 页）

| 页面 | 数据源 | 职责 |
|------|--------|------|
| 驾驶舱 | /api/summary + daemon-health | 实时指标 + 审计趋势 + 数据主权 |
| FDE 引导 | workflow 模板（10 步）+ 五阶段 Prompt | 方法论 + 部署入口 |
| AI 节点 | /api/ai-nodes + graph-state | 业务节点 + 编排流水线 |
| 本体结构 | /api/ontology | 实体/概念/关系三要素 |
| 知识库 | index.md + log.md + think.md | 知识页面 + 业务领域 + 经验教训 |
| 工具箱 | 安装 + 架构 + 规则 + MCP + npm + 文档 + FORGE | 资源/参考（引擎已并入，勿拆回） |

> 引擎页 V7.6 已并入工具箱（导航 7→6）——引擎内容本质是"参考/资源"，与 FORGE 同理。
