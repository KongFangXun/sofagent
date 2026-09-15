// cordis-plugin-sofagent-audit · DSH 反向插件（v1.4.9 P2 合并批：吸收原 -gate 验收门禁面）
// seam 挂载：tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping
// # 语义：工具结果留证 + 工具执行前拦截 + 文件写入意图拦截 + Turn 停止验收判定（判定源 = define_acceptance/check_acceptance）
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。
//
// v1.4.9 P2 吸收说明（F3）：原 -gate 独立承载 agent/turn-stopping 验收门禁，但其
// 判定源（define_acceptance / check_acceptance 两 MCP tool）与 -audit 同族（机器可判定
// 审计），拆两包造成「审计归 audit、验收归 gate」的人为割裂。本插件把验收 seam 并入
// 四值声明，settings 补 acceptanceGate 独立开关（默认开；关档即不参与 Turn 停止判定——
// 与 F2 分档同语义：档位是 settings 字段，不另造判定源）。

import { createSofagentPlugin } from '../../plugin-kit/dist/index.js';

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-audit',
    seam: 'tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping',
    seamSemantics: '工具结果留证 + 工具执行前拦截 + 文件写入意图拦截 + Turn 停止验收判定（v1.4.9 P2 吸收原 -gate 验收门禁；判定源 = define_acceptance/check_acceptance，不另造）',
    capability: '审计与验收（git diff 硬证据 + 24 规则 + 机器可判定验收）',
    bridgePkg: '@sofagent/audit',
    bridgeApi: 'runRules',
    description: '变更机器审阅 + 验收硬门禁——24 规则 + git diff 硬证据 + Turn 停止验收判定（验收不过不放行，开关独立可关）',
    // audit 专属 envelope（其余插件走 kit 默认值）
    purpose: 'sofagent 审计插件——24 规则 + git diff 硬证据 + 验收门禁',
    readyMessage: '审计与验收服务就绪（24 规则 + Turn 停止验收）',
    // v1.4.9 P2（F3）：rules 为既有字段；acceptanceGate = 验收门禁独立开关（默认 'true' 开）——
    // 关档即本插件的 agent/turn-stopping 面不参与 Turn 停止判定（审计三 seam 不受影响）
    settingsExtra: { rules: '24', acceptanceGate: 'true' },
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
