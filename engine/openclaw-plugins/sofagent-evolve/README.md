# sofagent-evolve

**自迭代变强** · sofagent 约束层五能力在 OpenClaw 生态的插件形态

think.md 反思条目生成（口述沉淀，带写入回执）+ 反思区注入，复用 @sofagent/think.appendManualThinkEntry。

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
        "config": { "reflectHint": false }
      }
    }
  }
}
```

`reflectHint` 默认 `false`（每轮注入收尾提示属可选增强；inject 插件的 L2 层已注入 think.md，默认关避免重复噪声）。

本插件不声明 `projectRoot`：思考条目的落点由数据根决定（`dataDir`，见 @sofagent/think 的 SSOT：显式入参 > `SOFAGENT_DATA` > `SOFAGENT_HOME/data`），与宿主项目根无关——声明一个不影响行为的配置项只会误导部署方。

## 开发

```bash
npm run build   # tsc 构建到 dist/
npx vitest run  # 单元测试
clawhub package validate .  # Plugin Inspector 校验（0 breakage / 0 warning）
```

## 发布

```bash
clawhub package publish . --family code-plugin --name sofagent-evolve --version "$(node -p "require('./package.json').version")"
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-evolve` 同引擎、不同宿主：DSH 侧挂 `turn/end`（Turn 收尾时沉淀经验），OpenClaw 侧挂 `before_prompt_build`（会话起始处挂载反思区提示）。两侧共用同一份 think.md 反思存储：OpenClaw 侧的实际条目由 `sofagent_evolve` 工具写入，hook 只让模型知道反思区已挂载，不注入条目正文。
