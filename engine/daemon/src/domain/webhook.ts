// ============================================================
// domain/webhook.ts · 推送域（企业平台 webhook / 审计事件流订阅桥 / 审计报告推送）——域级 barrel（v1.5.8 F32 同法定案）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/webhook），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/webhook"。
// ============================================================
/* @public */ export { pushAuditReport } from '../webhook/audit-report-push';
/* @public */ export { createWebhookPusher } from '../webhook/index';
/* @public */ export type {
  WebhookPlatform,
  AuditVerdict,
  WebhookPushResult,
  WebhookPusherOptions,
  WebhookPusher,
} from '../webhook/index';
/* @public */ export {
  attachAuditStreamToBus,
  mapEventToAuditPush,
  pushAuditStreamEvent,
  resolveAuditStreamPlatforms,
} from '../webhook/audit-stream-push';
/* @public */ export type { AuditStreamPusherOptions, AuditStreamBusPort } from '../webhook/audit-stream-push';
