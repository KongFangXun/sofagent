# sofagent-rollback

**出错逆序撤销** · sofagent 约束层五能力在 OpenClaw 生态的插件形态（品牌色 #16B8F3）

git snapshot 快照 + 逆序回滚（effect disposer 语义），复用 @sofagent/core。

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
clawhub package publish . --family code-plugin --name sofagent-rollback --version 1.4.0
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-rollback` 同引擎、不同宿主：DSH 挂 `tools/pre-execute` 等生命周期事件，OpenClaw 挂 `before_prompt_build` / `before_tool_execute` 等事件。审计引擎（git diff 24 规则）在所有形态一样硬。
