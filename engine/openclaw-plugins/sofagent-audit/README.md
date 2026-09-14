# sofagent-audit

> **本包是 OpenClaw 插件，不是 sofagent CLI。** sofagent CLI 的正式包名是 `@sofagent/audit`（带 scope），安装走 bootstrap.sh / install.sh——不要 `npm i sofagent-audit` 裸装本插件当 CLI 用。

**给 OpenClaw 加上审计** · sofagent 约束层五能力在 OpenClaw 生态的插件形态

24 规则 + git diff 硬证据 + 危险工具拦截（rm/git push 等黑名单），复用 @sofagent/audit.runRules。

## 能力

before_tool_call hook + sofagent_audit 工具

## 安装

```bash
# 从 ClawHub 安装（发布后）
openclaw plugins install sofagent-audit

# 或本地开发
openclaw plugins install -l ./engine/openclaw-plugins/sofagent-audit
```

## 配置（openclaw.json plugins.entries）

```json
{
  "plugins": {
    "allow": ["sofagent-audit"],
    "entries": {
      "sofagent-audit": {
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
clawhub package publish . --family code-plugin --name sofagent-audit --version 1.4.0
```

## 说明

与 DSH 插件 `cordis-plugin-sofagent-audit` 同引擎、不同宿主：DSH 侧挂 `tools/result` + `tools/pre-execute` + `fs/write-intent`（工具结果留证、执行前拦截、写入意图拦截），OpenClaw 侧挂 `before_tool_call`（调用前拦截，可拦停）。审计规则本身（git diff 24 规则）两侧共用同一引擎，口径一致。
