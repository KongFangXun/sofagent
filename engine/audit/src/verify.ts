#!/usr/bin/env node
// ============================================================
// sofagent-verify · 装后验证脚本（TypeScript 版）——入口文件
// v1.3.9 从 @sofagent/core re-export（消除跨包代码重复）
// ============================================================
// 验证 sofagent 安装完整性（9 个检查类别，~48 项动态）。
// 由 verify.sh (942 行 bash) + windows/verify.ps1 合并而来，
// 注册为 npm 包 bin。
//
// 用法：
//   sofagent-verify              彩色终端输出，显示所有检查项
//   sofagent-verify --json       JSON 机器可读输出（CI/CD 用）
//   sofagent-verify --quiet      只输出失败和警告，全通过时静默
//   sofagent-verify --quick      快速模式——仅 4 项核心检查
//   sofagent-verify --platform X 手动指定平台（openclaw/workbuddy/claude/codex/hermes）
//   sofagent-verify --help       显示此帮助
//
// 退出码：
//   0 = 全部通过
//   1 = 存在失败项
// ============================================================

// 全部从 @sofagent/core 透传，消除跨包代码重复
export { Verifier, HOME, resolveSofagentData, runQuickChecks, runWorkBuddyChecks, runAllChecks } from '@sofagent/core';
export type { Args, CheckStatus, CheckItem, VerifyResult } from '@sofagent/core';
