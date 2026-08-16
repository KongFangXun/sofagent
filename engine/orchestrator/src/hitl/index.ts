// ============================================================
// hitl/index.ts · Storage-backed HITL barrel export
// v1.3.6 P3b 新增
// ============================================================

export {
  HITL_OPTIONS,
  pendingDir,
  resolvedDir,
  shouldUseAsyncHITL,
  writeHITLRequest,
  readHITLResponse,
  writeHITLResponse,
  type HITLDecision,
  type HITLRequest,
  type HITLResponse,
} from './hitl-channel';
