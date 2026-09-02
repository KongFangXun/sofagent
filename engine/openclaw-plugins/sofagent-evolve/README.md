# sofagent-evolve

**自迭代变强** · sofagent 约束层五能力在 OpenClaw 生态的插件形态（品牌色 #16B8F3）

think.md 反思条目生成 + 反思区注入，复用 @sofagent/think.generateThinkEntry。

## 能力

before_prompt_build hook + sofagent_evolve 工具

## 安装

```bash
# 从 ClawHub 安装（发布后）
openclaw plugins install sofagent-evolve

# 或本地开发
openclaw plugins install -l ./engine/openclaw-plugins/sofagent-evolve
```

## 配置（openclaw.json plugins.entries）

```json
{
  "plugins": {
    "allow": ["sofagent-evolve"],
    "entries": {
      "sofagent-evolve": {
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
clawhub package publish . --family code-plugin --name sofagent-evolve --version 1.4.0
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-evolve` 同引擎、不同宿主：DSH 挂 `tools/pre-execute` 等生命周期事件，OpenClaw 挂 `before_prompt_build` / `before_tool_execute` 等事件。审计引擎（git diff 24 规则）在所有形态一样硬。
