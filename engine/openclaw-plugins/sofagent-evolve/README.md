# sofagent-evolve

**自迭代变强** · sofagent 约束层五能力在 OpenClaw 生态的插件形态

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

与 DSH 插件 `cordis-plugin-sofagent-evolve` 同引擎、不同宿主：DSH 侧挂 `turn/end`（Turn 收尾时沉淀经验），OpenClaw 侧挂 `before_prompt_build`（会话起始处挂载反思区提示）。两侧共用同一份 think.md 反思存储：OpenClaw 侧的实际条目由 `sofagent_evolve` 工具写入，hook 只让模型知道反思区已挂载，不注入条目正文。
