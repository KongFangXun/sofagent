// ============================================================
// rule-a2.test.ts · A2 不泄密钥——密钥泄漏检测测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanA2 } from './rule-a2-secret-leak';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A2 不泄密钥', () => {
  it('新增行含 AWS Access Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/config.ts', ['+const key = "AKIAIOSFODNN7EXAMPLE"'])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('data URI 内嵌 base64 图像 → PASS（合法资源不误报）', () => {
    // 实锤场景：dashboard logo PNG base64 data-URI 解码后随机段撞 AWS Secret Key 正则
    // fixture secret 运行时拼接（项目纪律——A2 fixture 不落字面量）
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');
    const pngB64 = Buffer.from(
      '\x89PNG\r\n\x1a\n' + 'x'.repeat(200) + awsLike.slice(0, 12) + 'y'.repeat(100),
    ).toString('base64');
    const ctx = makeCtx([makeDiffFile('web/index.html', [`+<img src="data:image/png;base64,${pngB64}" alt="logo">`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('data URI 同行混真密钥 → FAIL（豁免不遮真泄漏）', () => {
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join(''); // fixture secret 运行时拼接
    const pngB64 = Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(100)).toString('base64');
    const ctx = makeCtx([
      makeDiffFile('web/index.html', [`+<img src="data:image/png;base64,${pngB64}"> const k = "${awsLike}"`]),
    ]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  // v1.4.8 fresh-eyes（finding-10）：非 web 资源 mime 的 data URI 不再整段豁免——
  // `data:application/octet-stream;base64,<标准b64>` 载荷曾被静默删除后放行
  it('非资源 mime data URI 内嵌 base64 密钥 → FAIL（finding-10 收口）', () => {
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join(''); // fixture secret 运行时拼接
    const payload = Buffer.from(awsLike).toString('base64');
    const ctx = makeCtx([
      makeDiffFile('src/payload.ts', [`+const blob = "data:application/octet-stream;base64,${payload}";`]),
    ]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('非资源 mime data URI 内嵌 URL-safe base64 密钥 → FAIL（finding-10 收口）', () => {
    const skLike = ['sk', '-live0123456789abcdef0123456789ab'].join(''); // fixture secret 运行时拼接
    const payload = Buffer.from(skLike).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const ctx = makeCtx([
      makeDiffFile('src/payload.ts', [`+const blob = "data:application/octet-stream;base64,${payload}";`]),
    ]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  // v1.4.8 fresh-eyes（finding-11）：测试文件豁免不再静默——命中降级 WARN 人工确认
  it('测试文件内密钥形态 → WARN（豁免不再静默全绿）', () => {
    const skLike = ['sk', '-live0123456789abcdef0123456789ab'].join(''); // fixture secret 运行时拼接
    const ctx = makeCtx([
      makeDiffFile('src/payload.test.ts', [`+const apiKey = "${skLike}";`]),
    ]);
    const result = scanA2(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details.join('; ')).toContain('测试文件豁免命中');
  });

  it('SVG data URI（图标内嵌）→ PASS', () => {
    const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6a2 2 0 1 1 0 4'/%3E%3C/svg%3E";
    const ctx = makeCtx([makeDiffFile('web/app.html', [`+<i class="bi bi-x" style="background:url("${svg}")">`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('新增行含 Private Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/key.ts', ['+-----BEGIN RSA PRIVATE KEY-----'])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 OpenAI API Key → FAIL', () => {
    const longKey = 'sk-' + 'a'.repeat(48);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${longKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 GitHub Token → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/ci.ts', ['+const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"'])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 OpenAI Project Key (sk-proj-) → FAIL', () => {
    const projKey = 'sk-proj-' + 'a'.repeat(48);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${projKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Anthropic API Key (sk-ant-api03-) → FAIL', () => {
    const antKey = 'sk-ant-api03-' + 'a'.repeat(43);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${antKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 DeepSeek API Key (sk- 32位) → FAIL', () => {
    const dsKey = 'sk-' + 'a'.repeat(32);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${dsKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  // v1.3.6 B24: Stripe 下划线前缀——fixture 运行时拼接（铁律：测试不字面写真实格式密钥）
  it('新增行含 Stripe sk_live_ 下划线 key → FAIL', () => {
    const stripeKey = 'sk_live_' + 'a'.repeat(24);
    const ctx = makeCtx([makeDiffFile('src/pay.ts', [`+const stripeKey = "${stripeKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Stripe sk_test_ 下划线 key → FAIL', () => {
    const stripeKey = 'sk_test_' + 'a'.repeat(24);
    const ctx = makeCtx([makeDiffFile('src/pay.ts', [`+const stripeKey = "${stripeKey}"`])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('无密钥 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = scanA2(ctx);
    expect(result.status).toBe('PASS');
  });

  // v1.3.8 P0-2 回归：FFFD 短路绕过——攻击者把密钥后拼非法 UTF-8 字节再 base64/hex，
  // 解码产生 \uFFFD。旧逻辑「含 FFFD 即整体放弃解码」会让密钥候选逃逸（实测复现：
  // base64(AWS 密钥 + 0xd4 0x90 0x8b) 旧逻辑返回 null）。
  // 修复：解码后剥离 \uFFFD 再跑密钥正则（密钥本体是 ASCII，FFFD 是干扰尾巴）。
  // 场景：encoded.txt 内容即裸 base64（printf '<密钥>' | base64 > encoded.txt）。
  describe('FFFD 短路绕过（非法 UTF-8 尾字节）', () => {
    // 运行时拼接密钥形态（铁律：测试不字面写真实格式密钥，与文件上方用例的拆分手法一致）
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');

    it('base64 密钥 + 非法 UTF-8 尾字节 → 剥离 FFFD 后仍 FAIL（不再整体放弃）', () => {
      // payload 运行时拼接：密钥 + 非法 UTF-8 序列（0xd4 0x90 0x8b）→ 解码产生 \uFFFD
      const payload = Buffer.concat([
        Buffer.from(awsLike),
        Buffer.from([0xd4, 0x90, 0x8b]),
      ]).toString('base64');
      const ctx = makeCtx([makeDiffFile('encoded.txt', [`+${payload}`])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('hex 密钥 + 非法 UTF-8 尾字节 → 剥离 FFFD 后仍 FAIL', () => {
      const payload = Buffer.concat([
        Buffer.from(awsLike),
        Buffer.from([0xd4, 0x90, 0x8b]),
      ]).toString('hex');
      const ctx = makeCtx([makeDiffFile('encoded.hex', [`+${payload}`])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('合法 base64 密钥（无 FFFD 污染）→ 仍 FAIL（无回归）', () => {
      const payload = Buffer.from(awsLike).toString('base64');
      const ctx = makeCtx([makeDiffFile('plain-b64.txt', [`+${payload}`])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('纯随机二进制 base64（剥离 FFFD 后无密钥特征）→ 不误报 PASS', () => {
      // 全随机字节解码后既无可打印密钥也无中文 → 清洗后仍为空候选 → 不告警
      const payload = Buffer.from([0xd4, 0x90, 0x8b, 0xff, 0xfe, 0x81, 0xa2, 0xb3]).toString('base64');
      const ctx = makeCtx([makeDiffFile('noise.txt', [`+${payload}`])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('PASS');
    });
  });

  // 二进制文件盲区 WARN（红队实测：二进制 blob 无内容行可扫，密钥可藏身）
  describe('新增二进制文件 WARN', () => {
    it('新增 .bin 文件 → WARN（二进制不扫内容）', () => {
      const ctx = makeCtx([makeDiffFile('assets/blob.bin', ['diff --git a/assets/blob.bin b/assets/blob.bin', 'Binary files /dev/null and b/assets/blob.bin differ'], 'added')]);
      const result = scanA2(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details.join(' ')).toContain('二进制文件不扫内容');
    });

    it('新增 .exe/.dll/.so/.dylib 文件 → WARN', () => {
      for (const p of ['dist/tool.exe', 'lib/native.dll', 'lib/plugin.so', 'lib/mac.dylib']) {
        const ctx = makeCtx([makeDiffFile(p, [], 'added')]);
        const result = scanA2(ctx);
        expect(result.status, p).toBe('WARN');
      }
    });

    it('无二进制扩展名但 diff 标记 Binary files differ（内容含 NUL 字节）→ WARN', () => {
      // git 对含 NUL 字节的文件（如伪装 .txt 的 blob）自动按二进制处理
      const ctx = makeCtx([makeDiffFile('data/payload.txt', ['diff --git a/data/payload.txt b/data/payload.txt', 'index 0000000..abc1234', 'Binary files /dev/null and b/data/payload.txt differ'], 'added')]);
      const result = scanA2(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details.join(' ')).toContain('人工确认');
    });

    it('修改既有二进制文件（非新增）→ 不告警（只审新增盲区）', () => {
      const ctx = makeCtx([makeDiffFile('assets/blob.bin', ['Binary files a/assets/blob.bin and b/assets/blob.bin differ'], 'modified')]);
      const result = scanA2(ctx);
      expect(result.status).toBe('PASS');
    });

    it('新增二进制文件不拦截——可与密钥 FAIL 共存且 FAIL 优先', () => {
      const key = 'sk-' + 'a'.repeat(40);
      const ctx = makeCtx([
        makeDiffFile('assets/lib.so', [], 'added'),
        makeDiffFile('src/cfg.ts', [`+const k = "${key}"`]),
      ]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details.join(' ')).toContain('二进制文件不扫内容');
    });
  });

  // v1.5.2 A-8：CI 场景二进制夹带升 FAIL（exit 2）——拦截强度与证据形态解耦。
  // quick 本地交互维持 WARN（上一 describe 全覆盖）；此处断言 --ci 双态。
  describe('新增二进制文件 CI 场景二分（A-8）', () => {
    it('ciMode=true 新增 .bin → FAIL + CI 拦截文案（不给不存在的豁免入口）', () => {
      const ctx = makeCtx(
        [makeDiffFile('assets/blob.bin', ['diff --git a/assets/blob.bin b/assets/blob.bin', 'Binary files /dev/null and b/assets/blob.bin differ'], 'added')],
        { ciMode: true },
      );
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
      const msg = result.details.join(' ');
      expect(msg).toContain('二进制文件不扫内容');
      expect(msg).toContain('CI 场景二进制入库默认拦截——确认无风险请拆出文本清单人工核');
    });

    it('ciMode=true 无二进制文件 → 行为不变（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('src/plain.ts', ['+export const x = 1;'], 'added')], { ciMode: true });
      const result = scanA2(ctx);
      expect(result.status).toBe('PASS');
    });

    it('ciMode 缺省（本地交互）→ 维持 WARN（回归保护，双态断言之默认态）', () => {
      const ctx = makeCtx([makeDiffFile('assets/blob.bin', ['Binary files /dev/null and b/assets/blob.bin differ'], 'added')]);
      const result = scanA2(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details.join(' ')).not.toContain('CI 场景二进制入库默认拦截');
    });
  });

  // finding-13：内容扫描盲区处置可配置——config.A2.blindSpotAction（默认 "warn" 保持兼容，
  // "fail" 时本地模式二进制盲区也升 FAIL；-diff 形态恒 FAIL 不受配置降级）
  describe('内容扫描盲区处置配置（finding-13）', () => {
    const makeBinCtx = (overrides?: Record<string, unknown>) =>
      makeCtx(
        [makeDiffFile('assets/blob.bin', ['diff --git a/assets/blob.bin b/assets/blob.bin', 'Binary files /dev/null and b/assets/blob.bin differ'], 'added')],
        overrides,
      );

    it('blindSpotAction=fail 本地模式二进制盲区 → FAIL（可配置升级）', () => {
      const result = scanA2(makeBinCtx({ config: { A2: { blindSpotAction: 'fail' } } as any }));
      expect(result.status).toBe('FAIL');
      expect(result.details.join(' ')).toContain('blindSpotAction=fail 已将二进制盲区升为拦截');
    });

    it('默认（未配置）→ 本地模式维持 WARN（兼容回归）', () => {
      expect(scanA2(makeBinCtx()).status).toBe('WARN');
    });

    it('blindSpotAction=warn 显式配置 → 仍 WARN（显式与缺省同义）', () => {
      expect(scanA2(makeBinCtx({ config: { A2: { blindSpotAction: 'warn' } } as any })).status).toBe('WARN');
    });

    it('-diff 形态不受配置降级：blindSpotAction=warn 仍 FAIL（结构性隐藏证据恒拦截）', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+secrets.js -diff'])], { config: { A2: { blindSpotAction: 'warn' } } as any });
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('blindSpotAction=fail 无盲区文件 → 不误伤（PASS）', () => {
      const ctx = makeCtx([makeDiffFile('src/plain.ts', ['+export const x = 1;'], 'added')], { config: { A2: { blindSpotAction: 'fail' } } as any });
      expect(scanA2(ctx).status).toBe('PASS');
    });
  });

  // v1.3.8 P1-A2 回归：.gitattributes -diff 两步隐身——原仅 WARN 放行：
  // 第一步提交 .gitattributes 标记 secrets.js -diff（WARN 不拦截），
  // 第二步提交密钥文件，git diff 无内容行 → A2 静默全绿。升级为 FAIL。
  describe('.gitattributes -diff 隐身（升级 FAIL）', () => {
    it('第一步：提交 .gitattributes 标记 -diff → FAIL（不再 WARN 放行）', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+secrets.js -diff'])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details.join(' ')).toContain('-diff');
    });

    it('通配符标记 *.env -diff → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+*.env -diff'])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('带附加属性 key.bin -diff merge=keep → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+key.bin -diff merge=keep'])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('普通 .gitattributes 行（非 -diff）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+*.png binary'])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('PASS');
    });
  });

  // ── v1.4.0 交付四③：SECRET_ASSIGNMENT_REGEX 赋值形态 ──
  describe('A2 · 赋值形态检测（v1.4.0）', () => {
    it('api_key= 赋值形态 → FAIL', () => {
      // 密钥样本运行时拼接（A2 fixture 纪律：字面量密钥会被审计规则自触发）
      const ctx = makeCtx([makeDiffFile('config.txt', ['+api_key=' + 'abcdef1234567890abcdef1234567890'])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('token: 冒号赋值形态 → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('config.yml', ['+token: "' + 'abcdef1234567890abcdef1234567890' + '"'])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('password= 赋值形态 → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('env.sh', ['+password=' + 'abcdef1234567890abcdef1234567890'])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('占位符值（REPLACE_ME）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('config.ts', ['+apiKey = "REPLACE_ME"'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('短值（<8 字符）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('config.ts', ['+password=abc'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('env 引用值（process.env.XXX）→ PASS（不误伤运行时读取）', () => {
      // v1.4.5 收编时实锤：apiKey: process.env.SOFAGENT_MODEL_API_KEY 同构写法
      // 全仓通行，值段字符集恰好命中赋值正则——env 引用是代码不是硬编码密钥
      const ctx = makeCtx([
        makeDiffFile('provider.ts', ['+      apiKey: process.env.SOFAGENT_MODEL_API_KEY || \'\',']),
      ]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('函数调用 RHS（apiKey: resolveApiKey(role)）→ PASS（v1.4.8 修复）', () => {
      // 误报根因实证：捕获组把标识符 `resolveApiKey` 当硬编码值——函数调用语义同 env 引用，
      // 都是运行时读取。此前形态曾拦下文档中对代码的描述（条目 4 范围裁剪的根因）
      const ctx = makeCtx([
        makeDiffFile('loop/agent-runner.ts', ['+      apiKey: resolveApiKey(role),']),
      ]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('函数调用带参（const apiKey = buildApiKey(role, opts)）→ PASS（尾锚防贪婪回溯）', () => {
      // 无尾锚 `(?![\w(])` 时，`buildApiKey(` 会回溯成 `buildApiKe` 绕过断言再命中——本用例锁死
      const ctx = makeCtx([
        makeDiffFile('loop/agent-runner.ts', ['+  const apiKey = buildApiKey(role, opts);']),
      ]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('无引号真硬编码仍判 FAIL（修复不松绑）', () => {
      // 与函数调用修复的对照面：值段非调用形态、非 env 引用、非占位符 → 仍必须拦
      const ctx = makeCtx([
        makeDiffFile('config.env', ['+service_token=' + 'abcdef1234567890abcdef1234567890']),
      ]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('env 引用变体（const token = os.Getenv）→ PASS', () => {
      const ctx = makeCtx([makeDiffFile('main.go', ['+token := os.Getenv("GITHUB_TOKEN")'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });
  });

  // ── v1.4.1 F-15：base64 函数参数位绕过（报告四红队实锤堵洞）──
  // 攻击形态：密钥 base64 编码后放进 Buffer.from 第二参数位——旧值提取
  // 正则只覆盖等号/冒号后的值，函数参数位完全逃逸（exit 0 放行）。
  // 修复：candidatePlaintexts 新增 extractCallArgLiterals——提取调用参数里的
  // 编码串候选，解码命中密钥正则即 FAIL。
  describe('A2 · 函数参数位绕过（v1.4.1 F-15）', () => {
    // 运行时拼接密钥形态（铁律：测试不字面写真实格式密钥）
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');

    it('Buffer.from base64 函数参数位 → FAIL（红队实锤形态）', () => {
      // payload 运行时拼接生成，测试源码内无字面密钥
      const payload = Buffer.from(awsLike).toString('base64');
      const ctx = makeCtx([makeDiffFile('src/decode.ts', [
        `+const key = Buffer.from("${payload}", "base64").toString();`,
      ])]);
      const result = scanA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('atob 函数参数位 → FAIL', () => {
      const payload = Buffer.from(awsLike).toString('base64');
      const ctx = makeCtx([makeDiffFile('src/web.ts', [`+const k = atob("${payload}");`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('Buffer.from hex 函数参数位 → FAIL', () => {
      const payload = Buffer.from(awsLike).toString('hex');
      const ctx = makeCtx([makeDiffFile('src/hex.ts', [
        `+const key = Buffer.from("${payload}", "hex").toString();`,
      ])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('普通函数调用的普通字符串参数 → PASS（不误伤）', () => {
      // 非编码串参数（普通单词）解码不出密钥特征 → 不告警
      const ctx = makeCtx([makeDiffFile('src/ok.ts', ['+const s = Buffer.from("hello world", "utf8");'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('函数参数位 + 非法 UTF-8 尾字节（FFFD）→ 剥离后仍 FAIL', () => {
      // 攻击组合：函数参数位 + FFFD 干扰尾——两条防御叠加
      const payload = Buffer.concat([
        Buffer.from(awsLike),
        Buffer.from([0xd4, 0x90, 0x8b]),
      ]).toString('base64');
      const ctx = makeCtx([makeDiffFile('src/adv.ts', [
        `+const k = Buffer.from("${payload}", "base64");`,
      ])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });
  });

  // ── v1.4.1 F-15：同类绕过面自查（hex 转义 / 字符串拼接）──
  describe('A2 · 编码转义与拼接绕过（v1.4.1 F-15 自查）', () => {
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');

    it('\\xNN hex 转义形态 → FAIL', () => {
      // "\x41\x4b..." 还原后命中 AWS 密钥正则
      const escaped = [...awsLike].map((c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      const ctx = makeCtx([makeDiffFile('src/esc.ts', [`+const k = "${escaped}";`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('字符串拆两半拼接 → FAIL', () => {
      // 密钥拆两半各自无特征，合并后才命中
      const ctx = makeCtx([makeDiffFile('src/split.ts', [
        `+const k = "${awsLike.slice(0, 4)}" + "${awsLike.slice(4)}";`,
      ])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('链式三段拼接 → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('src/chain.ts', [
        `+const k = "${awsLike.slice(0, 2)}" + "${awsLike.slice(2, 4)}" + "${awsLike.slice(4)}";`,
      ])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('普通字符串拼接（无密钥特征）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('src/plain.ts', ['+const msg = "hello" + " " + "world";'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });
  });

  // ── v1.4.2 H-02：四类高价值密钥盲区补齐（Google/Slack/JWT/AWS Secret）──
  // 密钥样本全部运行时拼接（铁律：测试不字面写真实格式密钥，A2 fixture 纪律）
  describe('A2 · 四类盲区补齐（v1.4.2 H-02）', () => {
    it('新增行含 Google API Key（AIza 前缀）→ FAIL', () => {
      const googleKey = 'AIza' + 'Sy' + 'a'.repeat(33); // AIza + 35 位 body
      const ctx = makeCtx([makeDiffFile('src/gcp.ts', [`+const apiKey = "${googleKey}"`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('新增行含 Slack Token（xoxb- 前缀）→ FAIL', () => {
      const slackToken = 'xox' + 'b-' + 'a1'.repeat(12);
      const ctx = makeCtx([makeDiffFile('src/slack.ts', [`+const token = "${slackToken}"`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('新增行含 JWT（eyJ 三段式）→ FAIL', () => {
      const jwt = 'eyJ' + 'hbGciOiJIUzI1NiIs'.slice(0, 12) + '.' + 'c3ViamVjdC1wbG9'.slice(0, 12) + '.' + 'sig-nOtReAl'.slice(0, 8);
      const ctx = makeCtx([makeDiffFile('src/auth.ts', [`+const bearer = "${jwt}"`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('新增行含 AWS Secret Access Key（40 位 base64 + aws 关键词同行）→ FAIL', () => {
      // 动态构造 40 位样本——字面拼接会被 joinAdjacentLiterals（F-15）合并自触发 A2
      const aws40 = 'wJalrXUtnFEMIK7MDeng'.padEnd(40, 'bPxRfiCYEX');
      expect(aws40).toHaveLength(40);
      const ctx = makeCtx([makeDiffFile('src/aws.ts', [`+const awsSecretKey = "${aws40}"`])]);
      expect(scanA2(ctx).status).toBe('FAIL');
    });

    it('普通 40 位 base64 串（无 aws/secret/key 关键词同行）→ PASS（不误报）', () => {
      // git commit SHA / sha1 hash 等合法 40 位 hex-base64 串不应触发 AWS Secret 误报
      const hash = 'a1b2c3d4e5f6' + '6789abcdef01'.repeat(2) + 'aabbccddee'; // 40 位
      const ctx = makeCtx([makeDiffFile('src/hash.ts', [`+const commitSha = "${hash}"`])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('AIza 短串（<35 位 body）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('src/short.ts', ['+const s = "AIza-short";'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('xox 非法前缀变体（xoxz-）→ PASS（不误伤）', () => {
      const bad = 'xox' + 'z-' + 'a1'.repeat(12);
      const ctx = makeCtx([makeDiffFile('src/bad.ts', [`+const s = "${bad}"`])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });

    it('普通 base64 短串（非 JWT 三段式）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('src/enc.ts', ['+const s = "YWJjZGVmZ2hpamtsbW5vcA==";'])]);
      expect(scanA2(ctx).status).toBe('PASS');
    });
  });
});

// ============================================================
// v1.4.5 T14: 解码失败 debug 留痕测试
// ============================================================
describe('A2 解码失败 debug 留痕（T14）', () => {
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.SOFAGENT_DEBUG;
  });

  afterEach(() => {
    if (originalDebug === undefined) delete process.env.SOFAGENT_DEBUG;
    else process.env.SOFAGENT_DEBUG = originalDebug;
  });

  it('SOFAGENT_DEBUG=1 时_解码候选丢弃输出 debug 痕到 stderr（脱敏后）', () => {
    process.env.SOFAGENT_DEBUG = '1';
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = ((chunk: string) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;

    try {
      // charset 通过但解码出纯二进制（不可打印）→ 候选被丢弃 → debug 痕
      // 构造：合法 base64 字符集、长度 %4==0、≥8——解码为控制字符块。
      // 候选必须是纯编码形态（无引号/分号）——charset 门槛在引号处即静默
      // 拒绝（return null 不到解码层），触发不了「解码成功但不可打印」路径
      const binaryB64 = Buffer.from('\x01\x02\x03\x04\x05\x06\x07\x08').toString('base64');
      const ctx = makeCtx([makeDiffFile('src/bin.ts', [`+${binaryB64}`])]);
      scanA2(ctx);

      const debugLines = stderrWrites.filter((w) => w.includes('[sofagent-audit][debug]'));
      // 至少一条 base64 候选丢弃记录（整行候选——纯编码形态直达解码层）
      expect(debugLines.length).toBeGreaterThanOrEqual(1);
      // debug 输出不含原始候选明文的完整形态（截断到 48 字符）
      for (const line of debugLines) {
        expect(line.length).toBeLessThan(300); // 截断保护（含前缀与 reason 余量）
      }
    } finally {
      (process.stderr as { write: unknown }).write = originalWrite;
    }
  });

  it('SOFAGENT_DEBUG 未设_零 debug 输出（默认零噪声）', () => {
    delete process.env.SOFAGENT_DEBUG;
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = ((chunk: string) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;

    try {
      const binaryB64 = Buffer.from('\x01\x02\x03\x04\x05\x06\x07\x08').toString('base64');
      const ctx = makeCtx([makeDiffFile('src/bin2.ts', [`+${binaryB64}`])]);
      scanA2(ctx);
      expect(stderrWrites.filter((w) => w.includes('[sofagent-audit][debug]'))).toHaveLength(0);
    } finally {
      (process.stderr as { write: unknown }).write = originalWrite;
    }
  });
});
