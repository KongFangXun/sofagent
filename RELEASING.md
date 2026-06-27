# sofagent Release Process

> v0.93 · 2026-06-26。跑命令 → 对清单 → 打 tag。

---

## 怎么做

```
1. 构建自测   → rm -rf dist/ && npm run build && npm test（必须全绿。⚠️ tsc 有增量缓存，直接 npm run build 可能复用旧 .js——改 .ts 源码后必须先 rm -rf dist/ 再 build。v0.93 踩坑：源码有 --strict 但 dist 里 index.js 没有，因为 tsc 没重建）
2. 审核       → 独立审查逐项核对 changelog，FAIL 项修完二次复核
3. 版本号扫描 → 跑下面 3 条 grep，确保旧版本号零残留
4. 索引文档   → CHANGELOG 新增条目 + 版本说明；ROADMAP 三步更新
5. 内容新鲜度 → 核对 7 项（效果证据 / 局限标注 / FDE 完成度 / 依赖表 / 英文同步 / COMMUNITY）
6. 确认关口   → git diff --stat 展示全部改动，确认后开发日志打 [x]
7. 发布       → git tag → gh release → clawhub → skillhub → 验证
```

## 打勾清单

### 构建

- [x] `rm -rf dist/ && npm run build` exit 0
- [x] `npm test` 全部通过（100 tests）

### 版本号

- [x] 入口：`README.md` / `README.en.md`（badge + 文件头）
- [x] 核心：`HANDBOOK.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` / `LIMITATIONS.md` / `COMMUNITY.md`
- [x] 部署产物：`sofagent/SKILL.md` + `engine.md` + 4 闸门/闭环 MD
- [x] 工具：`sofagent-audit/README.md` + `src/**/*.ts`
- [x] 脚本：`sofagent/scripts/*.sh`（v0.93 未改脚本，VERSION= 保持 0.92 正确）
- [x] 证据：`docs/EVIDENCE.md` + `EVIDENCE.en.md`
- [x] 路线：`ROADMAP.md`

**按需**（改了内容才更新）：[x] `docs/audit-design.md` / [x] `docs/enterprise-deploy.md` / [x] `SECURITY.md` / [x] `CONTRIBUTING.md`

### 内容新鲜度

- [x] 效果证据表——已同步 v0.93 10 组实验数据
- [x] 局限标注——无过期标记
- [x] 事实断言——"0个≥1周样本"仍准确
- [x] FDE 完成度——3/5 层正确
- [x] 前置依赖表——已补 sofagent-audit
- [x] 英文版——READEME.en / EVIDENCE.en 已同步
- [x] COMMUNITY.md——实验状态已更新

### 索引文档

- [x] `CHANGELOG.md`：v0.93 条目 + 版本说明追加
- [x] `ROADMAP.md`：三步更新完成
- [x] `docs/changelog/v0.93.md`：19/19 [x]

### 确认关口

- [x] `git diff --stat` → 31 files, 89+/381-，作者已确认
- [x] 开发日志发布检查清单全部打 [x]

### 发布

- [ ] `git tag v0.94 && git push origin v0.94`
- [ ] `gh release create v0.94`
- [ ] `clawhub skill publish ./sofagent --slug sofagent --version 0.94.0`
- [ ] `clawhub skill publish ./sofagent-lite --slug sofagent-lite --version 0.1.0`
- [ ] `skillhub publish <temp-dir> --version 0.94.0`
- [ ] `skillhub publish <temp-lite-dir> --version 0.1.0`
- [ ] 安装副本同步：WorkBuddy ✅ / OpenClaw ✅
- [ ] 验证：tag ✅ / release ✅ / 安装副本版本号 ✅
- [ ] 后续版本同步：sofagent-lite SKILL.md 宪法内容 ≠ 独立 fork，是 sofagent/SKILL.md 宪法节的**自动化摘取**。v0.9x 期间人工同步，v1.0 起写脚本自动同步
