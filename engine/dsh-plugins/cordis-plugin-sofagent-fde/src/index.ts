// cordis-plugin-sofagent-fde · DSH 反向插件（v1.5.0 P2 合并批：并入 -ontology 与 -commons 面）
// seam 挂载：non-seam:tool-set    # 语义：非宿主事件接入（tool 集）——本体 / FDE / 公地三域工具按需调用
// 清单生成源 = engine/dsh-plugins/plugins.json（生成 package.json 的 description/sofagent/dsh 段与 cordis.patch.yml）；本文件的 seam 字面量由生成器 --check 与之对账。
//
// v1.5.0 P2 合并说明（F2）：
//   原三薄插件 -ontology（本体查询）/ -commons（能力公地）/ -fde（方法论六 tool）同为
//   non-seam:tool-set 形态、桥接同一 @sofagent 能力族，拆三包徒增清单与挂载成本。
//   本插件为合并后的**厚插件**：
//   · 桥接面（bridges 三包，F1② 多包形态——部分可用即部分成功）：
//       @sofagent/orchestrator publishCapability（能力公地五环——🔴 P2 修复：原 -commons
//       错桥 @sofagent/audit::loadConfig，公地真 API 在 orchestrator 公共导出面）
//       @sofagent/ontology generateOntologyView（本体数据视图——原 -ontology 桥接原样保留）
//       @sofagent/core restoreSnapshot（core 兜底——原 -rollback 同族桥，作厚插件的能力回溯面）
//   · 工具面（toolsRoles = ['fde','commons'] 并集 + featureGates 三档分域）：
//       ontology 档 = entity/concept/知识检索 12 工具；fde 档 = fde_* 七引擎；
//       commons 档 = commons_* 公地五环。三档默认全开，settings 关档即不注册该域工具。
//   · 未设档的 fde 角色工具（think/compose/workflow/agent 族——方法论支撑面）常开：
//       它们不属于「本体/FDE/公地」任一业务域，是三域共用的执行底座。

import { createSofagentPlugin } from '../../plugin-kit/dist/index.js';

/** 插件声明（本文件唯一手写处；适配层红线由 kit 承担：ctx 鸭子类型 + 宿主 API 缺席降级不抛） */
const kit = createSofagentPlugin(
  {
    id: 'cordis-plugin-sofagent-fde',
    seam: 'non-seam:tool-set',
    seamSemantics: '非宿主事件接入（tool 集）——本体 / FDE / 公地三域工具按需调用（v1.4.9 P2 合并原 -ontology 与 -commons 面）',
    capability: 'FDE 进场与能力流通（本体底座 + 方法论引擎 + 能力公地五环）',
    bridgePkg: '@sofagent/orchestrator',
    bridgeApi: 'publishCapability',
    bridges: [
      { pkg: '@sofagent/orchestrator', api: 'publishCapability' },
      { pkg: '@sofagent/ontology', api: 'generateOntologyView' },
      { pkg: '@sofagent/core', api: 'restoreSnapshot' },
    ],
    toolsRoles: ['fde', 'commons'],
    featureGates: {
      ontology: [
        'read_entity', 'read_concept', 'list_entities', 'list_concepts',
        'create_entity', 'create_concept', 'update_entity', 'delete_entity',
        'delete_concept', 'validate_ontology', 'ontology_import', 'search_knowledge',
      ],
      fde: [
        'fde_compose', 'fde_interview', 'fde_classify', 'fde_quantify',
        'fde_derive', 'fde_distill', 'fde_deploy',
      ],
      commons: [
        'commons_publish', 'commons_search', 'commons_invoke',
        'commons_rate', 'commons_retire', 'commons_harvest_rule',
      ],
    },
    description: 'FDE 进场与能力流通——把企业业务梳理成 AI 能力，并让这些能力在企业内被发布、发现、调用、评价、退役',
  },
  require('../package.json') as { version?: string },
);

export const pluginMeta = kit.pluginMeta; // 插件元数据（DSH profile/注册表消费）
export const capability = kit.capability; // 依赖的 sofagent 能力说明（DSH skill 引导链展示）
export const invoke = kit.invoke; // 桥接 @sofagent/* 公共 API（懒加载 + 多包部分可用 + 降级不抛）
export const resolveBridges = kit.resolveBridges; // 桥接解析报告（resolved/failed 双清单——降级可见的自省面）
export default kit.plugin; // DSH Cordis 插件契约（apply 三段式由 kit 提供）
