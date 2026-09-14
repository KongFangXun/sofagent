// ============================================================
// installer-skill.test.ts · T6：installer skill 定义单测（失败诊断路径覆盖）
// ============================================================
//
// installer skill 是 SKILL/harness/ 下的规范资产（prompt 驱动——Agent
// 读 md 自主执行），单测对象是**定义文件的结构完整性**：
//
//   1. 四步分步引导齐全（验收 ①：依赖检测 → install.sh 执行 → 安装
//      结果校验 → 触发 G9 设备注册——标题逐项断言）；
//   2. 每步失败路径有结构化诊断（验收 ② 不打哑炮——step/status/
//      advice/rollback 字段模板齐）；
//   3. 每步可回滚/可中断（验收 ③——rollback 字段逐步出现）；
//   4. 安装后自检（验收 ④——doctor 全绿判据存在）；
//   5. fail-closed 语义正确转述（验签失败不重试、policy 校验失败是
//      设计行为不是故障——防 Agent 错误自愈）；
//   6. 上游输入闭环（上岗 prompt 四要素——device_register 身份码来源）；
//   7. 文件行数预算（check-docs §5 上限 200 的前置一致性）。
//
// 为什么测 md 而不是测执行：installer 的执行者是设备侧 Agent（读
// prompt 行为），引擎侧能锁的是**定义不被改坏**——步骤缺失/诊断字段
// 缺失时本测试红，护住验收面的最小结构。
// ============================================================

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SKILL_FILE = path.resolve(__dirname, '../../../../SKILL/harness/installer.md');

function readSkill(): string {
  return fs.readFileSync(SKILL_FILE, 'utf-8');
}

describe('T6 · installer skill 定义（SKILL/harness/installer.md）', () => {
  it('文件存在于 harness 目录（与既有 skill 同命名式样 kebab-case）', () => {
    expect(fs.existsSync(SKILL_FILE)).toBe(true);
    expect(path.basename(SKILL_FILE)).toMatch(/^[a-z][a-z0-9-]*\.md$/);
  });

  it('验收 ①：四步分步引导标题齐全（依赖检测 → install.sh → 校验 → G9 注册）', () => {
    const md = readSkill();
    expect(md).toContain('## 第 0 步 · 前置确认（读上岗 prompt）');
    expect(md).toContain('## 第 1 步 · 环境依赖检测');
    expect(md).toContain('## 第 2 步 · install.sh 执行');
    expect(md).toContain('## 第 3 步 · 安装结果校验');
    expect(md).toContain('## 第 4 步 · 触发 G9 设备注册');
  });

  it('验收 ②：结构化诊断不打哑炮——step/status/advice/rollback 字段模板齐', () => {
    const md = readSkill();
    // 完整诊断块（step≥1 的失败诊断）至少 4 处——第 0 步前置确认是简式（missing 单字段），不计入；
    // 匹配用行级（嵌套 checks 对象跨多个 }，[^}]* 会在内层截断）
    const diagBlocks = md
      .split('\n')
      .filter((line) => line.trim().startsWith('{ "step": ') && !line.trim().startsWith('{ "step": 0'))
      .filter((line) => line.includes('"status"'));
    expect(diagBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of diagBlocks) {
      expect(block).toContain('"step"');
      expect(block).toContain('"status"');
      expect(block).toContain('"advice"');
      expect(block).toContain('"rollback"');
    }
  });

  it('验收 ③：每步可回滚/可中断——rollback 字段在第 1-4 步各出现', () => {
    const md = readSkill();
    // 以二级标题为锚分段（避免「第 N 步」正文内嵌「第」字截断）
    const headings = ['## 第 1 步', '## 第 2 步', '## 第 3 步', '## 第 4 步', '## 完成判据'];
    for (let i = 0; i < 4; i++) {
      const start = md.indexOf(headings[i]!);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = md.indexOf(headings[i + 1]!, start);
      const seg = md.slice(start, end === -1 ? md.length : end);
      expect(seg).toContain('"rollback"');
    }
  });

  it('验收 ④：安装后自检全绿——doctor 判据存在', () => {
    const md = readSkill();
    expect(md).toContain('doctor');
    expect(md).toContain('退出码 0');
    expect(md).toContain('doctor 全绿');
  });

  it('fail-closed 语义正确转述：验签失败不重试（回派单方换身份码）', () => {
    const md = readSkill();
    expect(md).toContain('invalid-identity');
    expect(md).toContain('不要重试');
    expect(md).toContain('重新签发');
  });

  it('fail-closed 语义正确转述：--policy 校验失败是设计行为不是故障（不绕过重试）', () => {
    const md = readSkill();
    expect(md).toContain('fail-closed');
    expect(md).toContain('设计行为不是故障');
    expect(md).toContain('不要重试绕过');
  });

  it('上游输入闭环：上岗 prompt 四要素 + device_register 消费身份码', () => {
    const md = readSkill();
    expect(md).toContain('上岗 prompt');
    expect(md).toContain('device_register');
    expect(md).toContain('身份码');
  });

  it('装完即注册链路：注册后立即心跳（availableModels 上报与 T10 联动）', () => {
    const md = readSkill();
    expect(md).toContain('reportHeartbeat');
    expect(md).toContain('availableModels');
    expect(md).toContain('注册即在线');
  });

  it('行数预算：不超过 check-docs §5 的 200 行上限', () => {
    const lines = readSkill().split('\n');
    expect(lines.length).toBeLessThanOrEqual(200);
  });
});
