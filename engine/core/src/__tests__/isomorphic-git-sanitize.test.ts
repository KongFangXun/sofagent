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
    const latest = data.snapshots[data.snapshots.length - 1];
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
    const latest = data.snapshots[data.snapshots.length - 1];
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
    const latest = data.snapshots[data.snapshots.length - 1];
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
    const latest = data.snapshots[data.snapshots.length - 1];

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
    const latest = data.snapshots[data.snapshots.length - 1];

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
    const latest = data.snapshots[data.snapshots.length - 1];

    expect(latest.files).not.toHaveProperty('rules.test.ts');
    expect(latest.files).toHaveProperty('main.ts');
  });
});
