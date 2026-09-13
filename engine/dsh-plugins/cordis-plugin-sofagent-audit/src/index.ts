// cordis-plugin-sofagent-audit · DSH 反向插件（v1.4.8：98 行样板收敛到 @sofagent/dsh-plugin-kit）
// seam 挂载：tools/result + tools/pre-execute + fs/write-intent    # 语义：工具结果留证 + 工具执行前拦截 + 文件写入意图拦截
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。

import { createSofagentPlugin } from '../../plugin-kit/dist/index.js';

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-audit',
    seam: 'tools/result + tools/pre-execute + fs/write-intent',
    seamSemantics: '工具结果留证 + 工具执行前拦截 + 文件写入意图拦截',
    capability: '审计模块（git diff 硬证据 + 24 规则）',
    bridgePkg: '@sofagent/audit',
    bridgeApi: 'runRules',
    description: '变更机器审阅——24 规则 + git diff 硬证据 + 节点级审计',
    // audit 专属 envelope（其余 8 个插件走 kit 默认值）
    purpose: 'sofagent 审计插件——24 规则 + git diff 硬证据',
    readyMessage: '审计服务就绪（24 规则）',
    settingsExtra: { rules: '24' },
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
