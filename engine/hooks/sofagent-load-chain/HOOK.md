---
name: sofagent-load-chain
description: "sofagent 四层加载链——agent:bootstrap 时注入 fde.md (用户规则) + think.md (反思区) + knowledge/ (知识库)，第 1 层宪法由 skill 系统注入"
metadata:
  openclaw:
    emoji: "⛓️"
    events: ["agent:bootstrap"]
    requires:
      env: []
      bins: []
---

# sofagent 加载链

在每次 Agent bootstrap 时，将 fde.md（第 2 层用户规则）、think.md（第 3 层反思区）注入 bootstrap 文件列表；第 4 层 knowledge/ 由 Harness 运行时加载。

第 1 层（4 底线 + 7 则铁律）由 skill 系统通过 SKILL.md 自动注入，本 hook 不重复注入。

详见 sofagent 项目：https://github.com/KongFangXun/sofagent
