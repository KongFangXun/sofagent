# 团队落地 Checklist

> 给技术负责人的 3 页指南。436 行 Handbook 不用全读——照着这个装就行。

## 第 1 天：装上

- [ ] 选一个平台（OpenClaw 推荐，WorkBuddy/Claude Code 也行）
- [ ] `bash sofagent/scripts/install.sh --platform 你的平台`
- [ ] `bash sofagent/scripts/verify.sh` 确认 0 fail
- [ ] 跑一个简单任务（「帮我查一下今天的日程」），确认 Agent 正常回复
- [ ] 企业内网：加 `--no-ao --no-config-inject`，编辑 rules.md 取消 `offline: true` 注释

## 第 1 周：试用

- [ ] 每天派 2-3 个真实任务给 Agent
- [ ] 第 3 天翻一次 `.sofagent/think.md`——看 Agent 写了什么反思
- [ ] 第 5 天翻一次 `.sofagent/task/logs/`——看执行记录
- [ ] 如果 Agent 行为异常，第一步查 think.md 删可疑条目
- [ ] 周末填一次 docs/EVIDENCE.md（哪怕写「没觉得有变化」）

## 第 1 月：回顾

- [ ] 翻 task/logs 统计：用了几次？复杂任务几次？
- [ ] 翻 think.md：反思条目有没有帮助？有没有错误经验？
- [ ] 翻 orchestrator/：有没有沉淀模板？（≥3 次同类任务才会沉淀）
- [ ] 把你的数据填进 docs/EVIDENCE.md 和 docs/TESTING.md
- [ ] 决定：继续用 / 调整 rules.md / 卸载

## 多用户注意

sofagent 是单用户设计。如果团队多人用：
- 每人独立工作目录（独立 .sofagent/）
- 不要共享 think.md——一个人的错误经验会污染所有人
- rules.md 可以共享（团队偏好），think.md 不能共享（个人经验）

## 什么时候不该用

- 你的任务都是单步指令（sofagent 帮不上忙）
- 你的平台不支持 bash（脚本降级为 Read/Edit，体验差）
- 你需要多 Agent 协作共享状态（sofagent 不是分布式系统）

详见 Handbook 和 [企业部署指南](./enterprise-deploy.md)。

---

## Migration Checklist（从现有 Agent prompt → 加 sofagent 约束层）

如果你的团队已经在用 Agent（裸 OpenClaw / WorkBuddy / Claude Code），以下是接入 sofagent 的步骤清单：

1. [ ] **安装 sofagent**：`bash sofagent/scripts/install.sh --platform 你的平台`
2. [ ] **跑 verify.sh**：`bash sofagent/scripts/verify.sh --quick` 确认 4/4 通过
3. [ ] **先跑一个简单任务**：不做大改动，用现有 prompt 跑一次，观察 Agent 回复是否正常
4. [ ] **跑 benchmark.sh 基线**：10 个标准化任务，记录「接入前」数据
5. [ ] **安装 sofagent 后跑 benchmark.sh**：同样的 10 个任务，记录「接入后」数据
6. [ ] **翻 think.md**：接入后第 3 天翻一次反思，看 Agent 记了什么
7. [ ] **决定是否继续**：如果有改善 → 继续用；如果没感觉 → 卸载，记得告诉我们为什么

> ⚠️ **实际集成周期**：企业场景下从安装到团队稳定使用，实际周期 2-4 周（含 CI/CD 接入、团队培训、流程磨合、冲突排查）。「10 分钟安装」是真的——但「会用」「用对」需要时间。

---

## CI/CD 集成（GitHub Actions 示例）

将 sofagent verify.sh 接入 CI，确保 PR 不会破坏安装校验：

```yaml
# .github/workflows/sofagent-verify.yml
name: sofagent verify
on:
  pull_request:
    paths:
      - 'sofagent/**'
      - 'docs/**'
      - '*.md'
  push:
    branches: [main]
    paths:
      - 'sofagent/**'

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify sofagent installation
        run: bash sofagent/scripts/verify.sh --json --platform openclaw
```

> 非 OpenClaw 平台去掉 `--platform` 参数，verify.sh 会自动探测。`--json` 输出机器可读格式，方便接入 CI 结果解析。
