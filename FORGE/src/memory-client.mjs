// ============================================================
// memory-client.mjs · TencentDB Memory API 轻量 HTTP 客户端（v1.3.0 交付 10 MA4）
//
// FORGE worker 经验共享飞轮：worker 启动时 memory_search 检索历史经验，
// 结束时 memory_write 写入本次发现。通过 FORGE_MEMORY_BACKEND 环境变量
// 控制（缺省 unset = 不启用，行为与 v1.2.9 完全一致）。
//
// ⚠️ 优雅降级铁律：endpoint 不可达 / 请求失败 → warn + 返回空结果，
// 绝不 crash、绝不阻断 worker 主流程。
// ============================================================

/**
 * 读取 FORGE_MEMORY_BACKEND（缺省 unset = 不启用）
 * @returns {string|null} backend endpoint 或 null
 */
export function getMemoryBackendEndpoint() {
  const v = process.env.FORGE_MEMORY_BACKEND;
  return v && v.trim() !== '' ? v.trim() : null;
}

/**
 * 调 TencentDB Memory API /v3/tools/call。
 *
 * @param {string} endpoint Memory 后端 URL（如 http://localhost:8125）
 * @param {string} toolName 工具名（memory_search / memory_write）
 * @param {object} args 工具参数
 * @param {number} [timeoutMs] 超时（默认 5000）
 * @returns {Promise<object>} 后端响应；失败返回 { ok:false, error }
 */
export async function callMemoryTool(endpoint, toolName, args, timeoutMs = 5000) {
  try {
    const resp = await fetch(`${endpoint}/v3/tools/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: toolName, arguments: args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      return { ok: false, error: `Memory API HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    return {
      ok: false,
      error: `Memory API 不可达（${err instanceof Error ? err.message : String(err)}）——已降级跳过`,
    };
  }
}

/**
 * worker 启动前检索历史经验（MA4）。
 * endpoint 不可达 → 返回空数组（不 crash）。
 *
 * @param {string} namespace 检索的命名空间（如 forge/fresh-eyes/<perspective>）
 * @param {string} [query] 检索关键词
 * @returns {Promise<Array<{content: string}>>} 历史经验条目
 */
export async function memorySearch(namespace, query = '') {
  const endpoint = getMemoryBackendEndpoint();
  if (!endpoint) return [];
  const r = await callMemoryTool(endpoint, 'memory_search', { namespace, query });
  if (!r.ok) {
    console.warn(`[memory-client] memory_search 失败（不影响主流程）: ${r.error ?? 'unknown'}`);
    return [];
  }
  const results = Array.isArray(r.results) ? r.results : (Array.isArray(r.data?.results) ? r.data.results : []);
  return results;
}

/**
 * worker 完成后写入本次发现（MA4）。
 * endpoint 不可达 → warn + 不阻断。
 *
 * @param {string} namespace 写入的命名空间
 * @param {string} content 本次发现内容
 * @param {object} [metadata] 元数据（perspective/round/step 等）
 * @returns {Promise<object>} 写入结果
 */
export async function memoryWrite(namespace, content, metadata = {}) {
  const endpoint = getMemoryBackendEndpoint();
  if (!endpoint) return { ok: false, error: 'FORGE_MEMORY_BACKEND 未设置' };
  const r = await callMemoryTool(endpoint, 'memory_write', {
    namespace,
    content,
    ...metadata,
  });
  if (!r.ok) {
    console.warn(`[memory-client] memory_write 失败（不影响主流程）: ${r.error ?? 'unknown'}`);
  }
  return r;
}
