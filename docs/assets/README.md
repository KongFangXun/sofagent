# docs/assets/ — 静态资源目录

本目录存放 sofagent 项目文档与落地页所需的静态资源文件。

## 文件清单

| 文件 | 用途 | 谁消费 |
|------|------|--------|
| `sofagent.png` | 项目 Logo（200px），README 头部引用 | GitHub README、npm 包页面、tools/dashboard/dashboard.html |
| `banner.png` | README 头部横幅 | README 中英版头部 |
| `arch-layers.svg` | 三层定位图（模型层 → FDE Harness 层 → Agent 层），矢量、全内联样式 | README 中文版「什么是 FDE Agent」段 |
| `usage-path.svg` | 使用路径图（试用 → 团队 → 企业 → 自运转），矢量、全内联样式 | README 中文版「产品一瞥」段 |
| `arch-layers-en.svg` / `usage-path-en.svg` | 上两图的英文版 | README 英文版对应段 |
| `dashboard.png` | Dashboard 驾驶舱截图 | README 中英版「产品一瞥」段 |
| `audit-terminal.png` | sofagent-audit 拦截 .env commit 的终端演示图 | README 中英版「快速开始」段 |
| ~~`favicon.png`~~ | ~~网站图标~~ | ~~HTML Dashboard（`<link rel="icon">`）~~ **已删除（2026-08-16）：声称被 dashboard `<link rel="icon">` 消费，实测 dashboard.html 无此标签，零真实引用** |
| ~~`fde-training.html`~~ | FDE 训练材料页面（早期内部培训用，v1.3.2 已归档到 `docs/archive/fde-training-2026-07.html`） | 历史参考 |

## 与 dashboard.html 的关系

`dashboard.html`（位于 `tools/`，不在本目录）是 HTML Dashboard 主页面，
由 `tools/dashboard/serve-dashboard.mjs` 提供服务。

- `tools/dashboard/dashboard.html` → 开发者审计面板（localhost:3780）

## 维护说明

- 新增静态资源时在此表格中登记
- ~~`fde-training.html`~~ 已归档到 `docs/archive/fde-training-2026-07.html`（v1.3.2 完成）
- ~~`arch-layers*.png` / `usage-path*.png`~~ **已删除（2026-08-27）：mermaid 静态化第一版，PIL 位图在 Retina 缩放下粗糙；改用同名 SVG（GitHub 原生矢量渲染，样式全内联——GitHub sanitize 会剥离 `<style>` 块与 class 属性）**
