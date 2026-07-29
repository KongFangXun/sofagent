// ============================================================
// logger.ts · 结构化日志封装
// ============================================================
//
// 封装 console.* 为带级别的 log 函数，保留 ANSI 颜色和
// 品牌前缀 [sofagent]。
//
// 使用方式：
//   import { log } from '../logger';
//   log.info('审计通过');
//   log.warn('配置未设');
//   log.error('校验失败');
//
// v1.2.2 新增——替代裸 console.log 直出
// ============================================================

export const log = {
  info: (msg: string): void => console.log(msg),
  warn: (msg: string): void => console.warn(msg),
  error: (msg: string): void => console.error(msg),
};
