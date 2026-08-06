# docs/assets/ — 静态资源目录

本目录存放 sofagent 项目文档与落地页所需的静态资源文件。

## 文件清单

| 文件 | 用途 | 谁消费 |
|------|------|--------|
| `sofagent.png` | 项目 Logo（200px），README.md 头部引用 | GitHub README、npm 包页面 |
| `favicon.png` | 网站图标 | HTML Dashboard（`<link rel="icon">`） |
| `index.html` | 项目落地页（sofagent.ai 首页），介绍产品定位与核心功能 | 访问 sofagent.ai 时展示 |
| `fde-training.html` | FDE 训练材料页面（早期内部培训用，当前为遗留文件） | 内部培训参考；后续版本考虑归档或合并到 docs/guides/ |

## 与 dashboard.html 的关系

`dashboard.html`（位于**仓库根目录**，不在本目录）是 HTML Dashboard 主页面，
由 `tools/serve-dashboard.mjs` 直接从仓库根提供服务。本目录的 `index.html` 是
面向公众的产品落地页，两者职责不同：

- `docs/assets/index.html` → 公众落地页（sofagent.ai）
- `dashboard.html`（根目录）→ 开发者审计面板（localhost:3780）

## 维护说明

- 新增静态资源时在此表格中登记
- `fde-training.html` 如不再使用，建议在 v1.3.x 清理周期中归档到 `docs/archive/`
