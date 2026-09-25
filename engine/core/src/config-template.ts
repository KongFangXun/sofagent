// ============================================================
// config-template.ts · .sofagent/config.yml 配置模板
// v1.3 新增：--init 命令使用此模板生成项目级配置文件
// ============================================================
// 带注释的 YAML 模板，用户跑 --init 后可直接编辑
// ============================================================

import { VERSION } from './shared/constants';

export const CONFIG_TEMPLATE = `# sofagent 审计配置
# 文档: https://github.com/KongFangXun/sofagent#配置
# 生成方式: sofagent-audit --init
#
# sofagent 审计只检查进入 staging 的文件。
# .gitignore 排除的文件不会被审计——这是 git 设计，不是审计缺陷。
# 如果 Agent 用 git add -f 强制添加被忽略的文件，审计仍然会检测到。
#
# ⚠️ quick 模式（npx sofagent-audit，无参数）不读取本配置文件——
# 它只做只读快速审计（最近一次 commit），不加载 config.yml、不应用
# lowRiskPatterns / rules / extendedRulesEnabled 等配置项。
# 本配置仅在完整模式（sofagent-audit-full / git hook / --init 生成的项目级配置）下生效。

audit:
  # 低风险文件模式（不计入 A3「不改越界」检查）
  lowRiskPatterns:
    - package-lock.json
    - yarn.lock
    - "*.log"
    - docs/**

  # 测试/构建命令模式（A8「不逃验证」规则匹配）
  testPatterns:
    - npm test
    - npm run test
    - pytest
    - go test

  # A3「不改越界」阈值——不相关文件占比超过此值时 WARN
  carefulModifyThreshold: 0.2

  # 扩展规则（E1-E4 + A14），默认关闭，按需启用
  extendedRulesEnabled: false

  # loop-check 绝对轮次上限——超过自动 closure 交还人类（默认 20）
  # loopCheckMaxRounds: 20

  # 按规则名禁用——取消注释即可关闭指定规则
  # 可用 key（24 条现行规则）: a1-a11, a14-a23, e1-e2, e4
  # （a12/a13 已并入 a11、e3 已并入 a11——填退役编号会触发「未知规则名」告警并忽略）
  # 显式 false 禁用，未列或 true 表示启用
  # rules:
  #   a3: false  # 禁用「不改越界」检查
  #   e1: true   # 显式启用 E1（需同时设 extendedRulesEnabled: true）

# v1.0.9: A16 非授权文件变更
A16:
  enabled: true
  protected_dirs:
    - "config/"
    - ".env"
    - "secrets/"
    - ".sofagent/config.yml"
  sensitive_types:
    - ".xlsx"
    - ".docx"
    - ".pdf"
    - ".db"
    - ".sqlite"
    - ".pem"
    - ".key"

# v1.0.9: A17 异常批量变更
A17:
  enabled: true
  bulk_threshold: 50
  bulk_window_ms: 300000

# v1.1.6: 感知层配置已移除（v1.3.1 #42）——perception.enabled 为死配置（全代码库零读取点）。
# 如需 webhook 推送，使用 audit.webhook 配置项（见下方）。

# ── 配置防篡改签名（可选）──
# 如需防止 Agent 篡改本配置文件，可对 config.yml 签名：
#   1. 创建密钥（仅一次）：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key
#   2. 颁发签名：node tools/release/sign-config.mjs .sofagent/config.yml
# 签名后 config.yml 顶层会多出 signature: <hex> 字段。
# 加载时若签名不匹配会拒绝启动（fail-closed）——修改配置后需重新签名：
#   sofagent-audit --sign-config
# 注意：strict/CI 模式下，「配置含规则内容但无签名」同样会拒绝启动。
`;

/**
 * commit-msg hook 模板内容
 * 与 hooks/commit-msg 保持一致（含 v1.0 无声失败保护）
 */
