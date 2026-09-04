// ============================================================
// config-sign-journey.test.ts · v1.4.5 R4-P0 旅程测试
// config.yml 签名旅程端到端（spec 验收块）：
//   签名基线 → 手动编辑 config.yml → loadConfig FAIL
//   且报错含 --sign-config 指引 → --sign-config 重签 → loadConfig 通过。
//
// 环境隔离（双层）：
//   - SOFAGENT_KEY_PATH → 临时密钥文件（不碰真实 ~/.sofagent-key）；
//   - SOFAGENT_HOME → 沙箱目录（切断「项目 config 不存在/解析异常时回退
//     全局 ~/.sofagent/config.yml」的路径——否则会误读真实用户配置）；
//   - SOFAGENT_HOME_ALLOWED_PREFIXES → 放行 tmpdir（v1.3.2 路径白名单先例）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { loadConfig, signConfig, ConfigSignatureError } from '../config-loader';

describe('R4-P0 · config.yml 签名旅程（编辑 → FAIL+指引 → 重签 → 通过）', () => {
  let tmpDir: string;
  let keyPath: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sofagent-journey-${Date.now()}-${randomBytes(3).toString('hex')}`);
    mkdirSync(join(tmpDir, '.sofagent'), { recursive: true });
    keyPath = join(tmpDir, 'test-key');
    // 临时密钥文件（SOFAGENT_KEY_PATH 指向真实文件——与 ~/.sofagent-key 等价形态）
    writeFileSync(keyPath, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });

    // 快照并隔离环境（SOFAGENT_HOME 必须指向沙箱——见文件头「环境隔离」）
    savedEnv = {
      SOFAGENT_KEY_PATH: process.env.SOFAGENT_KEY_PATH,
      SOFAGENT_CONFIG: process.env.SOFAGENT_CONFIG,
      SOFAGENT_DATA: process.env.SOFAGENT_DATA,
      SOFAGENT_HOME: process.env.SOFAGENT_HOME,
      SOFAGENT_HOME_ALLOWED_PREFIXES: process.env.SOFAGENT_HOME_ALLOWED_PREFIXES,
    };
    process.env.SOFAGENT_KEY_PATH = keyPath;
    process.env.SOFAGENT_HOME = tmpDir; // 全局 config 回退落沙箱（tmpDir/config.yml 不存在 → 回退链自然断）
    process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = tmpdir();
    delete process.env.SOFAGENT_CONFIG;
    delete process.env.SOFAGENT_DATA;

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  const configPath = (): string => join(tmpDir, '.sofagent', 'config.yml');

  /** 写入已签名的基线 config.yml（模拟 --init 完成 + 签名） */
  function writeSignedBaseConfig(): void {
    writeFileSync(configPath(), 'audit:\n  carefulModifyThreshold: 0.2\n', 'utf-8');
    signConfig(configPath()); // 无密钥则抛错——beforeEach 已备密钥
  }

  /** 模拟用户手动编辑（在 audit: 段内新增一条规则）。
   *  插入点在 signature 行之前 + 2 空格缩进——signConfig 把 signature 追加在
   *  文件末尾，真实用户编辑就是在 audit 段内加行；追加到文件末尾会变成
   *  顶层/语法错（顶层 loopCheckMaxRounds 不被消费，签名字段后的缩进行
   *  甚至 YAML 非法——均偏离旅程语义）。
   *  注：spec 原文的「追加注释行」不改 canonical（注释不进 YAML 对象），
   *  验签不会 FAIL——编辑语义取「新增规则键」才能驱动完整旅程。 */
  function editConfigByHand(): void {
    const edited = readFileSync(configPath(), 'utf-8').replace(
      'carefulModifyThreshold: 0.2',
      'carefulModifyThreshold: 0.2\n  loopCheckMaxRounds: 25',
    );
    writeFileSync(configPath(), edited, 'utf-8');
  }

  it('旅程主线：编辑后 FAIL 且报错含 --sign-config 指引 → 重签后通过', () => {
    writeSignedBaseConfig();

    // 基线态：签名有效，正常加载（确认读的是沙箱内本仓库 config——改基线阈值验证）
    expect(loadConfig(tmpDir).carefulModifyThreshold).toBe(0.2);

    // 用户手动编辑 → 签名不匹配 FAIL（fail-closed）
    editConfigByHand();
    let threw: unknown = null;
    try {
      loadConfig(tmpDir);
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeNull();
    expect(threw).toBeInstanceOf(ConfigSignatureError);
    // spec 验收：报错含 --sign-config 逃生通道指引
    expect((threw as Error).message).toContain('sofagent-audit --sign-config');
    expect((threw as Error).message).toContain('重新签名');

    // 重签（--sign-config 的库层等价调用）→ 恢复启动
    const result = signConfig(configPath());
    expect(result).toBe('updated');
    const config = loadConfig(tmpDir);
    // 编辑内容真实生效（旅程闭环 = 恢复可用且改动被保留）
    expect(config.loopCheckMaxRounds).toBe(25);
  });

  it('旅程分支：删除签名字段 → strict 模式拒绝启动，报错含重签指引（防删除式绕过）', () => {
    writeSignedBaseConfig();

    // 用户/Agent 删掉 signature 行（R4-P0 + T1/A1 的删除式绕过面）
    const stripped = readFileSync(configPath(), 'utf-8')
      .split('\n')
      .filter((l) => !/^signature\s*:/.test(l.trimStart()))
      .join('\n');
    writeFileSync(configPath(), stripped, 'utf-8');

    let threw: unknown = null;
    try {
      loadConfig(tmpDir, true); // strict/CI 场景
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(ConfigSignatureError);
    expect((threw as Error).message).toContain('sofagent-audit --sign-config');
  });

  it('旅程分支：重签后再次篡改 → 再次 FAIL（防「签一次永久免疫」误解）', () => {
    writeSignedBaseConfig();
    editConfigByHand();
    expect(() => loadConfig(tmpDir)).toThrow(ConfigSignatureError);

    signConfig(configPath());
    expect(loadConfig(tmpDir).loopCheckMaxRounds).toBe(25); // 恢复

    // 再次手改（改值）→ 再次 FAIL
    const content = readFileSync(configPath(), 'utf-8').replace(
      'loopCheckMaxRounds: 25',
      'loopCheckMaxRounds: 30',
    );
    writeFileSync(configPath(), content, 'utf-8');
    expect(() => loadConfig(tmpDir)).toThrow(ConfigSignatureError);
  });
});
