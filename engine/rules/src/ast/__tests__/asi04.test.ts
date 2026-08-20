// ============================================================
// asi04.test.ts · OWASP ASI04 供应链 SBOM 检测单测
// v1.3.9（一）：验收——依赖清单扫描生成 SBOM 且可查（离线 fixture）漏洞库
// ============================================================

import { describe, it, expect } from 'vitest';
import { AstRuleEngine } from '../engine';
import { buildSbom, parseGoMod } from '../rules/asi04-sbom';
import { inRange } from '../rules/semver';

function scanManifest(path: string, content: string) {
  const engine = new AstRuleEngine({ ruleIds: ['asi04-sbom'] });
  try {
    return engine.scan([{ path, content }]);
  } finally {
    engine.close();
  }
}

describe('ASI04 · SBOM 供应链检测', () => {
  it('package.json 生成 SBOM 且命中离线漏洞库', () => {
    const pkg = JSON.stringify({
      name: 'victim-app',
      dependencies: {
        lodash: '^4.17.20',        // 命中 CVE-2021-23337（<4.17.21）
        express: '^4.18.0',        // 漏洞库无此包——不报
      },
      devDependencies: {
        minimist: '1.2.5',         // 命中 CVE-2021-44906（<1.2.6）
      },
    });
    const hits = scanManifest('package.json', pkg);
    expect(hits).toHaveLength(2);
    const names = hits.map((h) => h.message);
    expect(names.some((m) => m.includes('lodash') && m.includes('CVE-2021-23337'))).toBe(true);
    expect(names.some((m) => m.includes('minimist') && m.includes('CVE-2021-44906'))).toBe(true);
  });

  it('已修复版本不报（版本在漏洞区间外）', () => {
    const pkg = JSON.stringify({
      dependencies: { lodash: '^4.17.21' }, // 恰好修复版
    });
    const hits = scanManifest('package.json', pkg);
    expect(hits).toHaveLength(0);
  });

  it('go.mod 解析 require 行 + require 块两种形态', () => {
    const goMod = [
      'module example.com/app',
      '',
      'require (',
      '\tgithub.com/gorilla/websocket v1.4.0', // 命中 GO-2020-0035（<1.4.1）
      '\tgithub.com/other/lib v2.0.0',
      ')',
      '',
      'require github.com/extra/deps v1.0.0',
    ].join('\n');
    const sbom = parseGoMod(goMod);
    expect(sbom).toHaveLength(3);
    expect(sbom[0]?.name).toBe('github.com/gorilla/websocket');
    expect(sbom[0]?.line).toBe(4);
    expect(sbom[2]?.name).toBe('github.com/extra/deps');

    const hits = scanManifest('go.mod', goMod);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('gorilla/websocket');
  });

  it('区间 AND 语义：多条件组合命中正确', () => {
    const pkg = JSON.stringify({
      dependencies: {
        node_fetch_probe: '1.0.0', // 无此包，不报——占位防止空对象优化
        axios: '1.4.0',            // 命中（>=1.3.0 <1.6.0）
      },
    });
    const hits = scanManifest('package.json', pkg);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('axios');
  });

  it('inRange 单元语义：边界与 AND 条件', () => {
    expect(inRange('4.17.20', '<4.17.21')).toBe(true);
    expect(inRange('4.17.21', '<4.17.21')).toBe(false);
    expect(inRange('1.5.0', '>=1.3.0 <1.6.0')).toBe(true);
    expect(inRange('1.6.0', '>=1.3.0 <1.6.0')).toBe(false);
    expect(inRange('1.2.0', '=1.2.0')).toBe(true);
    expect(inRange('2.0.0', '1.2')).toBe(false); // 裸版本=等于
  });

  it('buildSbom 按清单类型分派；非清单文件返回空', () => {
    expect(buildSbom('package.json', '{"dependencies":{"a":"1.0.0"}}')).toHaveLength(1);
    expect(buildSbom('src/index.ts', 'const x = 1')).toHaveLength(0);
  });

  it('损坏的 package.json 不崩（返回空 SBOM）', () => {
    const hits = scanManifest('package.json', '{ broken json !!!');
    expect(hits).toHaveLength(0);
  });
});
