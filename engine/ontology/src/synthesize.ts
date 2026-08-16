// ============================================================
// ontology/synthesize.ts · Dream Cycle synthesize_concepts 落点接口
// v1.3.6 新增
//
// 供 @sofagent/daemon Dream Cycle Stage 4 调用：把合成出的 Concept
// 登记到本体层。本版为轻量登记（内存态 + 可选 yml 追加），不建
// 集中式本体 OS——每个设备维护自己的 knowledge/，联邦查询按需获取。
// ============================================================

/** 可被本体层合成的最小概念形状（与 daemon 的 Concept 结构对齐） */
export interface SynthesizableConcept {
  /** slug（文件名去扩展名） */
  slug: string;
  /** 概念标题 */
  title: string;
  /** 概念正文（markdown） */
  body: string;
  /** 来源回指 */
  source: string;
  /** 敏感性分级 */
  sensitivity?: 'public' | 'internal' | 'restricted';
}

/** synthesize 返回的登记回执 */
export interface SynthesizeReceipt {
  /** 是否被本体层接受登记 */
  accepted: boolean;
  /** 登记的 slug */
  slug: string;
  /** 登记时间 ISO 字符串 */
  registeredAt: string;
}

/** 进程内已登记概念表（本版轻量态，不落盘本体 OS） */
const registered = new Map<string, SynthesizableConcept>();

/**
 * 把 Dream Cycle 合成的 Concept 登记到本体层。
 *
 * - 幂等：同 slug 重复登记直接覆盖（以最新为准）
 * - 返回登记回执，供调用方（Dream Cycle Stage 4）记录/断言
 */
export function synthesize(concept: SynthesizableConcept): SynthesizeReceipt {
  registered.set(concept.slug, concept);
  return {
    accepted: true,
    slug: concept.slug,
    registeredAt: new Date().toISOString(),
  };
}

/** 查询本体层已登记概念（供调试/测试断言） */
export function getRegistered(slug: string): SynthesizableConcept | undefined {
  return registered.get(slug);
}

/** 清空登记表（测试用） */
export function clearRegistered(): void {
  registered.clear();
}
