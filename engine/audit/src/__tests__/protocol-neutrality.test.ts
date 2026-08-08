// ============================================================
// protocol-neutrality.test.ts · 协议中立审计测试（v1.2.8 §3.3）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  assertProtocolNeutrality,
  verifyProtocolNeutrality,
} from '../protocol-neutrality';

describe('§3.3 协议中立审计', () => {
  describe('assertProtocolNeutrality', () => {
    it('无平台绑定的 diff → neutral=true', () => {
      const diffs = [
        '+const x = 1;',
        '+import { readFileSync } from "fs";',
        '+const result = audit(change);',
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('钉钉 SDK 导入 → 违规', () => {
      const diffs = [
        "+import DingTalk from 'dingtalk-jsapi';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('钉钉');
    });

    it('飞书 SDK 导入 → 违规', () => {
      const diffs = [
        "+import { feishu } from '@larksuite/sdk';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.some((v) => v.includes('飞书'))).toBe(true);
    });

    it('企业微信 SDK 导入 → 违规', () => {
      const diffs = [
        "+const wecom = require('wecom');",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.some((v) => v.includes('企业微信'))).toBe(true);
    });

    it('Slack SDK 导入 → 违规', () => {
      const diffs = [
        "+import { WebClient } from '@slack/web-api';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.some((v) => v.includes('Slack'))).toBe(true);
    });

    it('硬编码钉钉 webhook URL → 违规', () => {
      const diffs = [
        "+const url = 'https://oapi.dingtalk.com/robot/send?access_token=xxx';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.some((v) => v.includes('钉钉'))).toBe(true);
    });

    it('硬编码飞书 webhook URL → 违规', () => {
      const diffs = [
        "+const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(false);
      expect(result.violations.some((v) => v.includes('飞书'))).toBe(true);
    });

    it('删除行不检测（- 开头）', () => {
      const diffs = [
        "-import DingTalk from 'dingtalk-jsapi';",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(true);
    });

    it('正常的 MCP/HTTP 通信不违规', () => {
      const diffs = [
        "+const res = await fetch('http://localhost:3000/api');",
        "+const mcp = createMcpServer();",
      ];
      const result = assertProtocolNeutrality(diffs);
      expect(result.neutral).toBe(true);
    });
  });

  describe('verifyProtocolNeutrality', () => {
    it('目录不存在 → neutral=false', () => {
      const result = verifyProtocolNeutrality('/nonexistent/path');
      expect(result.neutral).toBe(false);
      expect(result.violations[0]).toContain('不存在');
    });

    it('审计引擎自身 src 目录 → neutral=true', () => {
      // 扫描本模块所在的 src/ 目录
      const result = verifyProtocolNeutrality(__dirname + '/..');
      // 审计核心层不应有平台专属 SDK
      expect(result.neutral).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });
});
