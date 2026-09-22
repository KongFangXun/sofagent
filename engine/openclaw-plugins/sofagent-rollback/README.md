# sofagent-rollback

**给 OpenClaw 加上快照回溯** · sofagent 约束层五能力在 OpenClaw 生态的插件形态

装上之后：Agent 出错时按 git 快照逆序回滚本次改动（effect disposer 语义），不用人工逐个文件还原。

> 机制：复用 `@sofagent/core`——git 快照读写与 DSH 侧同源（效果等价 effect disposer 语义）。

## 能力

sofagent_rollback 工具 + sofagent-rollback CLI

## 安装

```bash
# 从 ClawHub 安装（发布后）
openclaw plugins install sofagent-rollback

# 或本地开发
openclaw plugins install -l ./engine/openclaw-plugins/sofagent-rollback
```

## 配置（openclaw.json plugins.entries）

```json
{
  "plugins": {
    "allow": ["sofagent-rollback"],
    "entries": {
      "sofagent-rollback": {
        "enabled": true,
        "config": { "projectRoot": "/path/to/project" }
      }
    }
  }
}
```

## 开发

```bash
npm run build   # tsc 构建到 dist/
npx vitest run  # 单元测试
clawhub package validate .  # Plugin Inspector 校验（0 breakage / 0 warning）
```

## 发布

```bash
clawhub package publish . --family code-plugin --name sofagent-rollback --version "$(node -p "require('./package.json').version")"
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-rollback` 同引擎、不同宿主：DSH 侧挂 `agent/error`（Agent 出错时自动逆序撤销），OpenClaw 侧不挂宿主事件（`seam: non-seam:tool-set`）——只注册 `sofagent_rollback` 工具（snapshot / rollback / list）与 `sofagent-rollback` CLI，快照与回滚由调用方显式触发。
