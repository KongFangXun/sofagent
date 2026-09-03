# sofagent-inject

**约束注入** · sofagent 约束层五能力在 OpenClaw 生态的插件形态（品牌色 #16B8F3）

before_prompt_build 注入四层加载链（core-rules/think.md/fde.md/knowledge），复用 @sofagent/harness.buildConstrainedSystemPrompt。

## 能力

before_prompt_build hook + sofagent_inject 工具

## 安装

```bash
# 从 ClawHub 安装（发布后）
openclaw plugins install sofagent-inject

# 或本地开发
openclaw plugins install -l ./engine/openclaw-plugins/sofagent-inject
```

## 配置（openclaw.json plugins.entries）

```json
{
  "plugins": {
    "allow": ["sofagent-inject"],
    "entries": {
      "sofagent-inject": {
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
clawhub package publish . --family code-plugin --name sofagent-inject --version 1.4.0
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-inject` 同引擎、不同宿主：DSH 挂 `tools/pre-execute` 等生命周期事件，OpenClaw 挂 `before_prompt_build` / `before_tool_execute` 等事件。审计模块（git diff 24 规则）在所有形态一样硬。
