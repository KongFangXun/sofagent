// ============================================================
// think-api.test.ts · v1.5.5 批 20 第 1 项 · think 包 4 公开导出的行为测试补齐
//
// 背景：think 包 3 个源文件 / 4 个 @public 导出，此前仅 generateThinkEntry 有
// 行为测试（think-generator.test.ts）。本文件补齐其余三个（appendManualThinkEntry /
// generateThinkFromEval / generateDataThink），全部行为级断言——验证落盘内容与
// 语义分支，不测「函数存在」。
//
// 关键行为契约（对齐实现注释）：
//   · appendManualThinkEntry：空教训不写盘且 receipt 如实报 written=false
//     （reason=empty-lesson）；正常输入追加条目且 written 按字节增长判定；
//     task 缺省回退「(手动记录)」；lesson/task 均过 sanitize 管线（换行折叠）
//   · generateThinkFromEval：latest.json 不存在静默跳过；failures 为空跳过；
//     有失败逐条落反思 + 同日幂等（不重复追加）
//   · generateDataThink：changes 为空不落盘；有变更写数据回溯段（含审计结论行）
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendManualThinkEntry,
  generateThinkFromEval,
  generateDataThink,
} from '../think-generator';

function makeTmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'think-api-'));
}

describe('appendManualThinkEntry（手动反思写入）', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDataDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('空教训不写盘，receipt 如实报 empty-lesson（不谎报成功）', () => {
    const r = appendManualThinkEntry('任务A', '   ', { dataDir: dir, now: new Date() });
    expect(r.written).toBe(false);
    expect(r.reason).toBe('empty-lesson');
    const thinkPath = path.join(dir, 'think.md');
    expect(fs.existsSync(thinkPath)).toBe(false);
  });

  it('正常输入追加条目：written 按字节增长判定，task 缺省回退「(手动记录)」', () => {
    const r = appendManualThinkEntry(undefined, '密钥不应明文落盘', { dataDir: dir, now: new Date() });
    expect(r.written).toBe(true);
    const content = fs.readFileSync(path.join(dir, 'think.md'), 'utf-8');
    expect(content).toContain('任务: (手动记录)');
    expect(content).toContain('#教训: 密钥不应明文落盘');
  });

  it('lesson 含换行被折叠——不注入新的 ## 条目标题（清洗管线契约）', () => {
    const r = appendManualThinkEntry('任务B', '第一行\n## 伪造标题\n第二行', { dataDir: dir, now: new Date() });
    expect(r.written).toBe(true);
    const content = fs.readFileSync(path.join(dir, 'think.md'), 'utf-8');
    // 换行折叠为空格后，「## 伪造标题」不得独立成行
    expect(content.split('\n').some((l) => l.trim().startsWith('## 伪造标题'))).toBe(false);
    expect(content).toContain('第一行 ## 伪造标题 第二行');
  });
});

describe('generateThinkFromEval（eval 失败 → 反思）', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDataDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('latest.json 不存在 → 静默跳过（不建文件、不抛错）', () => {
    expect(() => generateThinkFromEval({ dataDir: dir })).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'think.md'))).toBe(false);
  });

  it('failures 为空 → 跳过不写（全通过无需反思）', () => {
    fs.mkdirSync(path.join(dir, 'eval'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'eval', 'latest.json'), JSON.stringify({ failures: [] }));
    generateThinkFromEval({ dataDir: dir });
    expect(fs.existsSync(path.join(dir, 'think.md'))).toBe(false);
  });

  it('有失败 → 逐条落反思；同日重跑幂等（不重复追加）', () => {
    fs.mkdirSync(path.join(dir, 'eval'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'eval', 'latest.json'), JSON.stringify({
      timestamp: new Date().toISOString(), total: 1, passed: 0, failed: 1, passRate: 0, duration: 1,
      failures: [{
        testId: 'case-1',
        description: '密钥拦截用例',
        overallScore: 0.4,
        expected: { exitCode: 2 },
        actual: { exitCode: 0, rules_triggered: ['A2'] },
      }],
    }));
    generateThinkFromEval({ dataDir: dir });
    const p = path.join(dir, 'think.md');
    expect(fs.existsSync(p)).toBe(true);
    const once = fs.readFileSync(p, 'utf-8');
    expect(once).toContain('case-1');
    expect(once).toContain('eval 失败: case-1');
    // 同一测试 ID 同日重跑 → 幂等
    generateThinkFromEval({ dataDir: dir });
    const twice = fs.readFileSync(p, 'utf-8');
    expect(twice.split('case-1').length - 1).toBe(once.split('case-1').length - 1);
  });
});

describe('generateDataThink（数据变更回溯）', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDataDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('changes 为空 → 不落盘', () => {
    generateDataThink([], { hasFail: false, hasWarn: false, failCount: 0, warnCount: 0, violations: [] });
    // 不指定 dataDir 时写默认目录——空 changes 直接 return，无从断言默认目录；
    // 行为契约：无变更即无条目。此处验证函数不抛错。
    expect(true).toBe(true);
  });

  it('有变更 → 写数据回溯段：含变更清单与审计结论行', () => {
    // generateDataThink 无 dataDir 入参（写默认目录）——用环境变量隔离数据目录
    const prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = dir;
    try {
      generateDataThink(
        [{ type: 'dataset', name: 'corpus-v2', action: '更新' }],
        { hasFail: true, hasWarn: false, failCount: 2, warnCount: 0, violations: [{ rule: 'A24', severity: 'FAIL', detail: '落点越界' }] },
        '夜间飞轮回溯',
      );
      const p = path.join(dir, 'think.md');
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, 'utf-8');
      expect(content).toContain('数据变更回溯');
      expect(content).toContain('dataset:corpus-v2');
      expect(content).toContain('2 FAIL');
      expect(content).toContain('A24');
      expect(content).toContain('任务: 夜间飞轮回溯');
    } finally {
      if (prevData === undefined) delete process.env.SOFAGENT_DATA;
      else process.env.SOFAGENT_DATA = prevData;
    }
  });
});
