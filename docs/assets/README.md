# docs/assets/ — 静态资源目录

本目录存放 sofagent 项目文档与落地页所需的静态资源文件。

## 文件清单

| 文件 | 用途 | 谁消费 |
|------|------|--------|
| `sofagent.png` | 项目 Logo（200px），README.md 头部引用 | GitHub README、npm 包页面 |
| `favicon.png` | 网站图标 | HTML Dashboard（`<link rel="icon">`） |
| ~~`fde-training.html`~~ | FDE 训练材料页面（早期内部培训用，v1.3.2 已归档到 `docs/archive/fde-training-2026-07.html`） | 历史参考 |

## 与 dashboard.html 的关系

`dashboard.html`（位于**仓库根目录**，不在本目录）是 HTML Dashboard 主页面，
由 `tools/serve-dashboard.mjs` 直接从仓库根提供服务。

- `dashboard.html`（根目录）→ 开发者审计面板（localhost:3780）

## 维护说明

- 新增静态资源时在此表格中登记
- ~~`fde-training.html`~~ 已归档到 `docs/archive/fde-training-2026-07.html`（v1.3.2 完成）
