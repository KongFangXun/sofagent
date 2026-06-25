# sofagent Release Process

> v0.92 · 2026-06-25。跑命令 → 对清单 → 打 tag。

---

## 怎么做

```
1. 构建自测   → npm run build && npm test（必须全绿）
2. 审核       → 独立审查逐项核对 changelog，FAIL 项修完二次复核
3. 版本号扫描 → 跑下面 3 条 grep，确保旧版本号零残留
4. 索引文档   → CHANGELOG 新增条目 + 版本说明；ROADMAP 三步更新
5. 内容新鲜度 → 核对 7 项（效果证据 / 局限标注 / FDE 完成度 / 依赖表 / 英文同步 / COMMUNITY）
6. 确认关口   → git diff --stat 展示全部改动，确认后开发日志打 [x]
7. 发布       → git tag → gh release → clawhub → skillhub → 验证
```

## 打勾清单

### 构建

- [ ] `npm run build` exit 0
- [ ] `npm test` 全部通过

### 版本号

```bash
grep -rn "旧版本号" --include="*.md" . | grep -v "docs/changelog/" | grep -v "node_modules"
grep -rn 'VERSION="旧版本号"' sofagent/scripts/ --include="*.sh"; grep -rn "v旧版本号" sofagent/scripts/ --include="*.sh" | grep -v VERSION=
grep -rn "旧版本号\|v0\.[0-9][0-9]" sofagent-audit/src/ --include="*.ts" --include="*.js" | grep -v test
```

- [ ] 入口：`README.md` / `README.en.md`（badge + 文件头）
- [ ] 核心：`HANDBOOK.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` / `LIMITATIONS.md` / `COMMUNITY.md`
- [ ] 部署产物：`sofagent/SKILL.md` + `engine.md` + 4 闸门/闭环 MD
- [ ] 工具：`sofagent-audit/README.md` + `src/**/*.ts`
- [ ] 脚本：`sofagent/scripts/*.sh`（VERSION= + 注释头）
- [ ] 证据：`docs/EVIDENCE.md` + `EVIDENCE.en.md`
- [ ] 路线：`ROADMAP.md`

**按需**（改了内容才更新）：`docs/audit-design.md` / `docs/enterprise-deploy.md` / `SECURITY.md` / `CONTRIBUTING.md`

### 内容新鲜度

- [ ] 效果证据表——数据是否包含最新版本？
- [ ] 「vX.Y 不修 / 待修」局限标注——是否已经修了但标注没动？
- [ ] 「尚无第三方数据」「尚无 ≥1 周样本」等事实断言——是否已经变了？
- [ ] README FDE 完成度（2/5 → 3/5）——是否与交付层数匹配？
- [ ] 前置依赖表——新增工具是否需要新依赖？
- [ ] 英文版（README.en / EVIDENCE.en）——内容是否与中文版同步？
- [ ] COMMUNITY.md——实验状态、contributor 数是否为当前实际？

### 索引文档

- [ ] `CHANGELOG.md`：新增版本条目 + 顶部版本说明追加
- [ ] `ROADMAP.md`：文件头版号 →「现在在哪」替换 →「未来去哪」删已完成 → TOC 同步
- [ ] `docs/changelog/vX.Y.md`：发布检查清单打 [x] + 执行记录补文档收尾操作

### 确认 + 发布

- [ ] `git diff --stat` 展示全部改动，维护者逐项确认
- [ ] 确认通过后，开发日志打 [x]
- [ ] `git tag v0.XX && git push origin v0.XX`
- [ ] `gh release create v0.XX`
- [ ] `clawhub skill publish ./sofagent --slug sofagent --version 0.XX.0`
- [ ] `skillhub publish <temp-dir-without-images> --version 0.XX.0`
- [ ] 验证：`git tag -l` / `gh release view` / 安装副本版本号
