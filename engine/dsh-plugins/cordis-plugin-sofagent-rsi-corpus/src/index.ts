// cordis-plugin-sofagent-rsi-corpus · DSH 反向插件（B2 · v0.1.0）
// seam 挂载：non-seam:tool-set    # 语义：非宿主事件接入（tool 集）——语料管道按需调用
// 行为等价基准 = factory 仓 rsi/corpus/pipeline.mjs v0.1.0（golden 见 GOLDEN.json）
// 清单生成源 = engine/dsh-plugins/plugins.json；seam 字面量由生成器 --check 对账。

import { createSofagentPlugin } from '@sofagent/dsh-plugin-kit';

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-rsi-corpus',
    seam: 'non-seam:tool-set',
    seamSemantics: '非宿主事件接入（tool 集）——语料管道（脱敏 L0/L1 → 三分拣 SENSITIVE/JUDGEMENT/ABSTAIN）按需调用',
    capability: '语料管道（脱敏 + 三分拣；行为等价基准 = rsi/corpus/pipeline.mjs）',
    bridgePkg: '@sofagent/rsi-corpus',
    bridgeApi: 'runPipeline',
    description: '语料管道 tool 集——脱敏 L0/L1 + 三分拣（sensitive/judgement/abstain），行为与 rsi/corpus/pipeline.mjs 逐字节等价',
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta;
export const capability = kit.capability;
export const invoke = kit.invoke;
export default kit.plugin;
