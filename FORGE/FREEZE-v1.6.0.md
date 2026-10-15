# v1.6.0 发版窗口冻结声明

**窗口**：阶段六（文档定稿）起 至 阶段十一（发布后回写）收口。
**范围**：main 分支的项目文档与代码——`docs/`、`playbook/`、`engine/`、`SKILL/`、`FORGE/`（发版 session 例外）。

**约束**：非发版 session 不在 main 直接提交；需要工作请 `git worktree add` 独立树。
**理由**：发版链的 acceptance 凭据指纹取整棵内容树，窗口内任何外部提交都会令长跑凭据失效（实测：并发提交 5 次 ⇒ acceptance 白跑两轮）；bump/tag 亦要求基线稳定。

**例外**：发版 session 自身的阶段提交；紧急缺陷修复（须在 commit message 标注「破冻结」+ 理由）。

> 本文件随 v1.6.0 发版收口（阶段十一）删除。
