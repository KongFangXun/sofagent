// cordis-plugin-sofagent-inject · DSH 反向插件（v1.4.9：98 行样板收敛到 @sofagent/dsh-plugin-kit）
// seam 挂载：agent/pre-step    # 语义：模型看到输入前注入四层加载链约束
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。

import { createSofagentPlugin } from '../../plugin-kit/dist/index.js';

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-inject',
    seam: 'agent/pre-step',
    seamSemantics: '模型看到输入前注入四层加载链约束',
    capability: '约束注入链（SKILL→fde→think→knowledge）',
    bridgePkg: '@sofagent/inject',
    bridgeApi: 'buildConstrainedSystemPrompt',
    description: '启动注入企业约束——四层加载链',
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 降级不抛）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
