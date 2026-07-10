# sofagent 发版流程

> 每个版本发布前，按顺序跑完以下步骤。少一步不叫发版。

---

## 步骤

```
0. 推前预检     ./tools/pre-push-check.sh（全绿才继续）
1. 构建自测     npm test && bash tools/check-docs.sh && bash tools/check-version.sh
2. 审核         独立审查逐项核对 changelog，FAIL 项修完二次复核
3. CLI 验收     bash tools/acceptance-test.sh（9 场景全绿）
4. 版本号       ./tools/bump-version.sh <旧> <新> && ./tools/check-version.sh（33/33）
5. 文档索引     CHANGELOG 新增条目 + ROADMAP 三步更新（文件头 / 现在在哪 / 未来去哪）
6. npm 验证     npm pack --dry-run（双包 .js.map=0）
7. 确认关口     git diff --stat 展示全部改动，确认后开发日志打 [x]
8. 安装副本     cp -r skill/ ~/.workbuddy/skills/sofagent/ && cp -r skill/ ~/.openclaw/skills/sofagent/
9. 发布         git tag → gh release → npm 双包发布 → clawhub skill publish
10. 验证        npm view @sofagent/audit version && npm view @sofagent/mcp version（必须都是新版本号）
```

## 发布渠道

```bash
# GitHub Release
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file docs/changelog/vX.Y.Z.md

# npm（自动触发，等待 CI 完成）
npm view @sofagent/audit@X.Y.Z version
npm view @sofagent/mcp@X.Y.Z version

# ClawHub / SkillHub
openclaw skills publish ./skill
```

## v1.0 起新增

| 版本 | 新增步骤 |
|------|---------|
| v1.0 | 步骤 3 CLI 验收（acceptance-test.sh 9 场景）、OpenClaw Agent 验收（维护者手动，5 场景端到端） |
| v0.90 | 步骤 10 验证（不信任自动化，亲自确认 npm 版本号） |

## 历史教训

- **v0.90**：checklist 不打勾不准打 tag。14 个 unchecked 项发版 = checklist 信誉归零
- **v0.90**：CHANGELOG 两层都要写——`CHANGELOG.md`（索引）+ `docs/changelog/vX.Y.md`（完整日志）
- **v0.99.6**：OIDC 文档与实际 CI 配置严重矛盾——任何声称"自动化"的流程必须有实际运行验证
- **v0.99.7**：发版后 npm 版本号未验证——"自动化发布"不等于"发布成功"
- **v1.0**：bump-version.sh 只改版本号不改正文叙事——ROADMAP 的版本叙事、CHANGELOG 的索引条目需手动更新
