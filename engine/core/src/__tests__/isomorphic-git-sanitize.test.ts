// ============================================================
// isomorphic-git-sanitize.test.ts · .git-shadow 快照密钥脱敏单测
// v1.3.4 交付 1（P0）：验证 scanFiles / commitSnapshot 的 sanitize 管道 +
//   快照滚动覆盖 + 测试 fixture 排除规则。
//
// 覆盖场景：
//   1. 含 AKIA / ghp_ / sk- 的文件被快照后 → snapshots.json 中 content 为脱敏文本（含 ***）
//   2. 连续跑 51 次 commitSnapshot() → snapshots 数组长度 = 50（滚动覆盖最旧）
//   3. 测试 fixture 目录（含已知密钥样本）不被快照
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { commitSnapshot, listSnapshots } from '../filesystem/isomorphic-git';
// v1.3.9 四十五：直接导入共享常量做检测/脱敏对齐断言（v1.4.9 P0-2 起全族对齐 13 检测 → 13 脱敏）
import { SECRET_PATTERNS, REDACTION_PATTERNS } from '../shared/secret-patterns';

// v2 存储格式适配（2026-08-16 磁盘治理）：snapshots.json 现为 { version:2, blobs, snapshots[fileIndex] }
// 旧断言直接读磁盘期望 v1 形状（files: path→content）——此 helper 透明还原，断言意图不变。
function hydrateLatest(data: { version?: number; blobs?: Record<string, string>; snapshots: Array<{ sha: string; timestamp: string; fileIndex?: Record<string, string>; files?: Record<string, string> }> }) {
  const latest = data.snapshots[data.snapshots.length - 1];
  if (!latest) return undefined;
  if (data.version === 2 && latest.fileIndex) {
    const files: Record<string, string> = {};
    for (const [p, h] of Object.entries(latest.fileIndex)) {
      files[p] = data.blobs?.[h] ?? '';
    }
    return { ...latest, files };
  }
  return latest;
}


describe('isomorphic-git 快照密钥脱敏（交付 1 · P0）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-shadow-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境清理失败可接受 */ }
  });

  it('含 AWS AKIA key 的目录快照后 → snapshots.json 中 content 含 *** 脱敏标记', () => {
    // 在 tmpDir 下创建一个含密钥的文件
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    fs.writeFileSync(
      path.join(tmpDir, 'config.txt'),
      `AWS_SECRET_ACCESS_KEY=${awsKey}\nother content here`,
    );

    // 提交快照
    commitSnapshot(tmpDir);

    // 读取 snapshots.json，验证密钥已被脱敏
    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);
    const content = latest.files['config.txt'];

    // 原始 AKIA 密钥不应出现在快照中
    expect(content).not.toContain(awsKey);
    // 应包含脱敏标记
    expect(content).toContain('AKIA***');
  });

  it('含 GitHub Token (ghp_) 的目录快照后 → content 含 *** 脱敏标记', () => {
    const ghToken = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234';
    fs.writeFileSync(path.join(tmpDir, 'secrets.env'), `GITHUB_TOKEN=${ghToken}`);

    commitSnapshot(tmpDir);

    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);
    const content = latest.files['secrets.env'];

    expect(content).not.toContain(ghToken);
    expect(content).toContain('gh***');
  });

  it('含 sk- 开头 API key 的目录快照后 → content 含 *** 脱敏标记', () => {
    const apiKey = 'sk-1234567890abcdefghijklmnopqrstuv';
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), `const key = "${apiKey}";`);

    commitSnapshot(tmpDir);

    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);
    const content = latest.files['app.ts'];

    expect(content).not.toContain(apiKey);
    expect(content).toContain('sk-***');
  });

  it('连续跑 51 次 commitSnapshot() → snapshots 数组长度 = 50（滚动覆盖最旧）', () => {
    // 创建一个基础文件
    fs.writeFileSync(path.join(tmpDir, 'track.txt'), 'content');

    // 连续提交 51 次
    for (let i = 0; i < 51; i++) {
      // 每次改动文件内容，生成不同的快照
      fs.writeFileSync(path.join(tmpDir, 'track.txt'), `content-${i}`);
      commitSnapshot(tmpDir);
    }

    // 验证 snapshots.json 中数组长度 = 50（第 1 个被滚动覆盖）
    const snapshots = listSnapshots(tmpDir);
    expect(snapshots.length).toBe(50);
  });

  it('测试 fixture 目录（含已知密钥样本）不被快照', () => {
    // 创建 fixtures/ 目录含密钥样本
    fs.mkdirSync(path.join(tmpDir, 'fixtures'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fixtures', 'leak-sample.txt'),
      'AKIAIOSFODNN7EXAMPLE',
    );

    // 创建一个正常文件
    fs.writeFileSync(path.join(tmpDir, 'normal.txt'), 'normal content');

    commitSnapshot(tmpDir);

    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);

    // fixtures/ 目录下的文件不应出现在快照中
    expect(latest.files).not.toHaveProperty(path.join('fixtures', 'leak-sample.txt'));
    // 正常文件应在
    expect(latest.files).toHaveProperty('normal.txt');
  });

  it('.env.example 不被快照', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.example'),
      'API_KEY=sk-test1234567890abcdefghijklmnopqrstuv',
    );
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'console.log("hi");');

    commitSnapshot(tmpDir);

    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);

    expect(latest.files).not.toHaveProperty('.env.example');
    expect(latest.files).toHaveProperty('index.ts');
  });

  it('*.test.ts 文件不被快照', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'rules.test.ts'),
      'const fakeKey = "AKIAIOSFODNN7EXAMPLE";',
    );
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export {};');

    commitSnapshot(tmpDir);

    const snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
    const data = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    const latest = hydrateLatest(data);

    expect(latest.files).not.toHaveProperty('rules.test.ts');
    expect(latest.files).toHaveProperty('main.ts');
  });

  // v1.3.9 四十五 / v1.4.9 P0-2：REDACTION_PATTERNS 与 SECRET_PATTERNS 全族对齐——
  // 检测命中的**每一种** secret pattern 落盘前均被脱敏（PEM 私钥块与 v1.4.2 H-02 四新族
  // 此前「检出但原样落盘」= 不对称洞；脱敏表落后检测表 = 审计工具自身成第二泄漏点）。
  //
  // 🔴 守卫空转根治（v1.4.9 P0-2）：主循环由 **SECRET_PATTERNS 驱动**（不再是与检测表
  // 平行的手写清单——平行清单正是本洞的成因：v1.4.2 扩检测表时无人想起同步脱敏表）。
  // 样本按 label 登记，另加两条漂移锁：① 检测族新增但样本表未补 → 红；
  // ② 样本表残留已删除/改名的检测族 → 红。任一侧漏配即红，无须人工记得同步。
  it('检测命中的每种 secret pattern 落盘前均被脱敏（SECRET_PATTERNS 驱动 · 全族对齐）', () => {
    // 每族检测各造一条样本（运行时拼接，非真实密钥——铁律：测试不字面写真实格式密钥）
    // A2 自指误报规避：PEM 样例的 BEGIN/END 头尾也走拼接，不写完整字面量。
    const pemSample = [
      '-----BEGIN ',
      ['PRIVATE ', 'KEY'].join(''),
      '-----\n',
      'x'.repeat(40),
      '\n-----END ',
      ['PRIVATE ', 'KEY'].join(''),
      '-----',
    ].join('');
    // label → 样例：label 必须与 SECRET_PATTERNS 的 label 逐字同源（漂移锁①② 保证）
    const SAMPLE_BY_LABEL: Record<string, string> = {
      'AWS Access Key': 'AKIA' + 'A'.repeat(16),
      'Private Key': pemSample,
      'Anthropic API Key': 'sk-ant-api03-' + 'a'.repeat(40),
      'OpenAI Project Key': 'sk-proj-' + 'a'.repeat(40),
      'OpenAI Service Account Key': 'sk-svcacct-' + 'a'.repeat(40),
      'OpenAI Admin Key': 'sk-admin-' + 'a'.repeat(40),
      'Possible API Key (OpenAI/DeepSeek)': 'sk-' + 'a'.repeat(32),
      'GitHub Token': 'ghp_' + 'b'.repeat(36),
      'Stripe Secret Key': 'sk_live_' + 'c'.repeat(24),
      'Google API Key': 'AIza' + 'd'.repeat(35),
      'Slack Token': 'xoxb-' + 'e'.repeat(12),
      'JWT Token': 'eyJ' + 'f'.repeat(12) + '.' + 'g'.repeat(12) + '.' + 'h'.repeat(8),
      // 裸 40 位族检测侧带 contextKeyword（同行须含 aws|secret|key 才报告）——样例自带该语境。
      // 样例取**非纯 hex** 的 40 位 base64（真实 AWS secret 形态）；纯 hex 40 位属链字段形态，
      // 走脱敏侧放行分支（见本文件下方「链字段不得被打码」回归锁）。
      'Possible AWS Secret Access Key': 'aws secret ' + 'Ab0Z'.repeat(10),
    };

    // 漂移锁①：SECRET_PATTERNS 每个 label 必须有样例（新增检测族忘补样例 → 此处红）
    const missing = SECRET_PATTERNS.filter(({ label }) => !(label in SAMPLE_BY_LABEL)).map(({ label }) => label);
    expect(missing, `SECRET_PATTERNS 有族缺测试样例（新增检测族须同步补脱敏+样例）：${missing.join(', ')}`).toEqual([]);
    // 漂移锁②：样例表不得残留已不存在的检测族（检测族改名/删除 → 样例须同步）
    const liveLabels = new Set(SECRET_PATTERNS.map(({ label }) => label));
    const stale = Object.keys(SAMPLE_BY_LABEL).filter((label) => !liveLabels.has(label));
    expect(stale, `样例表含已不存在的检测族（检测族已改名/删除）：${stale.join(', ')}`).toEqual([]);

    // 主循环：遍历 SECRET_PATTERNS 本身（非手写清单）——遍历即覆盖，无须人工同步
    for (const { label, pattern } of SECRET_PATTERNS) {
      const sample = SAMPLE_BY_LABEL[label] as string;

      // 0. 样例必须真的被**本族**检测正则命中（否则后面两步在假样本上空转 = 守卫空转）
      expect(pattern.test(sample), `${label} 样例应被自身检测正则命中（样本已漂移）`).toBe(true);

      // 1. 检测命中（SECRET_PATTERNS 至少一条能检出该样本）
      const detected = SECRET_PATTERNS.some(({ pattern: p }) => p.test(sample));
      expect(detected, `${label} 应被 SECRET_PATTERNS 检测`).toBe(true);

      // 2. 落盘前脱敏（REDACTION_PATTERNS 循环后原样密钥不再出现）
      let redacted = sample;
      for (const { pattern: redactionPattern, replacement } of REDACTION_PATTERNS) {
        redactionPattern.lastIndex = 0;
        redacted = redacted.replace(redactionPattern, replacement);
      }
      expect(redacted, `${label} 应含脱敏标记`).toContain('REDACTED');
      expect(redacted, `${label} 原样密钥不应再落盘`).not.toContain(sample);
    }
  });

  // v1.4.9 P0-2 回归锁：裸 40 位脱敏**必须放行纯 hex 标识**——
  // 审计链自带 commitSha/parentSha/treeSha（40 位纯 hex）、prevHash（16）、envFingerprint（8）、
  // hmacSig（32）全是紧凑 hex；而 audit-history.shouldExempt 的值维豁免判据是
  // 「sanitizeFreeText(value) === value」。裸 40 位若无条件命中，链字段会被打成
  // ***REDACTED*** ⇒ 对账三重键失配（post-commit 恒落未命中，反噬 P0-1 的修复）、
  // HMAC/链校验全废。此锁即该洞的防复发：纯 hex 40 位经全表脱敏后必须逐字节恒等。
  it('裸 40 位脱敏放行纯 hex 标识（审计链 SHA/父树/HMAC 不得被打码）', () => {
    const hexSha40 = 'a1b2c3d4'.repeat(5); // 40 位纯 hex（git SHA 形态）
    expect(hexSha40).toHaveLength(40);
    const hexSha16 = 'a29c31ee02303b9d'; // prevHash 形态
    const hexSha32 = '1eda5a4569cecd95157b0cbd1eda5a45'; // hmacSig 形态
    const runRedaction = (input: string): string => {
      let out = input;
      for (const { pattern, replacement } of REDACTION_PATTERNS) {
        pattern.lastIndex = 0;
        out = out.replace(pattern, replacement);
      }
      return out;
    };
    // 逐字段恒等（链完整性）
    expect(runRedaction(hexSha40)).toBe(hexSha40);
    expect(runRedaction(hexSha16)).toBe(hexSha16);
    expect(runRedaction(hexSha32)).toBe(hexSha32);
    // 🔴 最严苛形态：即便同行带 aws|secret|key 语境（检测侧会报告），纯 hex 标识仍不得被打码——
    //    链完整性优先于宽口径脱敏（真实 AWS secret 恰为纯 hex 的概率 ≈ (22/64)^40 ≈ 1e-19）。
    const jsonlLine = '{"parentSha":"' + hexSha40 + '","treeSha":"' + hexSha40
      + '","task":"rotate aws secret key","hmacSig":"' + hexSha32 + '"}';
    const redactedLine = runRedaction(jsonlLine);
    expect(redactedLine).toBe(jsonlLine);
    // 反向确认：同长度的**非 hex** 40 位串必须仍被打码（放行分支不得扩成「全放行」）
    const b64NonHex = 'Ab0Z'.repeat(10);
    expect(runRedaction(b64NonHex)).not.toBe(b64NonHex);
    expect(runRedaction(b64NonHex)).toContain('REDACTED');
  });
});
