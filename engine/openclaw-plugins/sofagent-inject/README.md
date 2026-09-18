# sofagent-inject

**给 OpenClaw 加上约束注入** · sofagent 约束层五能力在 OpenClaw 生态的插件形态

装上之后：模型每次构建提示词前，系统上下文先被追加四层加载链（core-rules.md / think.md / fde.md / knowledge/）——Agent 不必你每次交代背景；另有一个 `sofagent_inject` 工具可随时预览注入了什么。

> 机制：复用 `@sofagent/inject` 的 `buildConstrainedSystemPrompt()`——四层加载链与 DSH 侧同源。

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

与 DSH 插件 `cordis-plugin-sofagent-inject` 同引擎、不同宿主：DSH 侧挂 `agent/pre-step`，OpenClaw 侧挂 `before_prompt_build`——两侧都在模型读到本轮输入之前，把四层加载链（core-rules / think.md / fde.md / knowledge）拼成 `prependSystemContext` 注入，数据源取 `config.projectRoot`。
