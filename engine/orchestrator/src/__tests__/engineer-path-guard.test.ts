// ============================================================
// engineer-path-guard.test.ts · engineer 路径守卫安全回归测试
// ============================================================
//
// 背景（为什么必须有这个文件）：
//   engineer-execute 层把 LLM 产出的 `change.file` 直接拼进
//   `execSync('git add -- "<file>"')`——字符串经 /bin/sh 解释，文件名里的
//   `$(...)` / 反引号会被当成命令执行（实测可写任意文件）；同时
//   `join(cwd, '../../x')` 会解析出项目根之外的落点（路径穿越）。
//   修复后改为 execFileSync 参数数组 + isSafeRelativePath 校验 + 解析后前缀锚定三层。
//
// 覆盖：
// - isSafeRelativePath：合法路径放行 / 八类非法路径拒绝（含长度与控制字符边界）
// - EngineerChangeSchema：恶意 JSON 在 zod 层即被拒（走到 execute 之前）
// - engineerExecute 纵深防御：绕过 zod 直接构造对象，三类攻击仍不得落盘
// - 不误伤：合法文件照常写入，批次内单条被拒不中断其余变更
// - 无 shell：gitRunner 收到的是参数数组（文件名含空格不被 shell 拆词）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isSafeRelativePath, EngineerChangeSchema } from '../loop/engineer-decide';
import { engineerExecute } from '../loop/engineer-execute';
import type { EngineerDecide } from '../loop/engineer-decide';

/** 每个用例独立临时目录（避免互相污染 + 便于断言「未逃逸出根目录」） */
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-path-guard-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ============================================================
// 一、isSafeRelativePath：合法路径必须放行（防误伤）
// ============================================================

describe('isSafeRelativePath · 合法路径放行', () => {
  it('test_isSafeRelativePath_普通相对路径_放行', () => {
    expect(isSafeRelativePath('src/index.ts')).toBe(true);
  });

  it('test_isSafeRelativePath_深层多级目录_放行', () => {
    expect(isSafeRelativePath('engine/audit/src/cli/agent-shield.ts')).toBe(true);
  });

  it('test_isSafeRelativePath_前导点斜杠_放行', () => {
    expect(isSafeRelativePath('./src/index.ts')).toBe(true);
  });

  it('test_isSafeRelativePath_重复前导点斜杠_放行', () => {
    expect(isSafeRelativePath('././src/index.ts')).toBe(true);
  });

  it('test_isSafeRelativePath_文件名含空格_放行', () => {
    // 空格是合法文件名字符，且正是「有无 shell」的探测器（shell 会拆词）
    expect(isSafeRelativePath('src/my file.ts')).toBe(true);
  });

  it('test_isSafeRelativePath_文件名含点但非点点_放行', () => {
    expect(isSafeRelativePath('src/..hidden/config.json')).toBe(true);
  });

  it('test_isSafeRelativePath_路径中间含点点形态的正常目录名_放行', () => {
    // "a..b" 不是 ".." 段——不能被段过滤误杀
    expect(isSafeRelativePath('src/a..b/c.ts')).toBe(true);
  });
});

// ============================================================
// 二、isSafeRelativePath：非法路径必须拒绝
// ============================================================

describe('isSafeRelativePath · 非法路径拒绝', () => {
  it('test_isSafeRelativePath_父目录逃逸_拒绝', () => {
    expect(isSafeRelativePath('../escape.ts')).toBe(false);
  });

  it('test_isSafeRelativePath_路径中段逃逸_拒绝', () => {
    // 易漏：逃逸段不在开头，只在开头检查 startsWith('../') 的实现会放过
    expect(isSafeRelativePath('src/../../escape.ts')).toBe(false);
  });

  it('test_isSafeRelativePath_POSIX绝对路径_拒绝', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
  });

  it('test_isSafeRelativePath_Windows盘符绝对路径_拒绝', () => {
    expect(isSafeRelativePath('C:\\Windows\\system32')).toBe(false);
  });

  it('test_isSafeRelativePath_UNC路径_拒绝', () => {
    expect(isSafeRelativePath('\\\\server\\share\\evil.ts')).toBe(false);
  });

  it('test_isSafeRelativePath_命令替换美元符_拒绝', () => {
    expect(isSafeRelativePath('x$(touch /tmp/pwned).ts')).toBe(false);
  });

  it('test_isSafeRelativePath_反引号_拒绝', () => {
    expect(isSafeRelativePath('x`id`.ts')).toBe(false);
  });

  it('test_isSafeRelativePath_反斜杠_拒绝', () => {
    // POSIX 上反斜杠是合法文件名字符，但会让路径语义跨平台分裂——统一拒绝
    expect(isSafeRelativePath('src\\index.ts')).toBe(false);
  });

  it('test_isSafeRelativePath_换行符截断命令行_拒绝', () => {
    expect(isSafeRelativePath('ok.ts\nrm -rf /')).toBe(false);
  });

  it('test_isSafeRelativePath_回车符_拒绝', () => {
    expect(isSafeRelativePath('ok.ts\rrm -rf /')).toBe(false);
  });

  it('test_isSafeRelativePath_空字符串_拒绝', () => {
    expect(isSafeRelativePath('')).toBe(false);
  });

  it('test_isSafeRelativePath_纯空白_拒绝', () => {
    expect(isSafeRelativePath('   ')).toBe(false);
  });

  it('test_isSafeRelativePath_只有点_拒绝', () => {
    expect(isSafeRelativePath('.')).toBe(false);
  });

  it('test_isSafeRelativePath_只有点点_拒绝', () => {
    expect(isSafeRelativePath('..')).toBe(false);
  });

  it('test_isSafeRelativePath_超长路径_拒绝', () => {
    // MAX_RELATIVE_PATH_LENGTH=512——超长路径是资源耗尽型攻击面
    expect(isSafeRelativePath('a/'.repeat(400))).toBe(false);
  });

  it('test_isSafeRelativePath_非字符串输入_拒绝', () => {
    // 反序列化路径可能产出非字符串——类型守卫兜住，不能靠上层保证
    expect(isSafeRelativePath(123 as unknown as string)).toBe(false);
    expect(isSafeRelativePath(null as unknown as string)).toBe(false);
  });
});

// ============================================================
// 三、EngineerChangeSchema：恶意 decide JSON 在校验层即被拒
// ============================================================

describe('EngineerChangeSchema · 恶意 JSON 校验拦截', () => {
  it('test_EngineerChangeSchema_命令替换路径_校验失败', () => {
    const r = EngineerChangeSchema.safeParse({
      file: 'x$(touch /tmp/pwned).ts',
      action: 'create',
      description: 'd',
    });
    expect(r.success).toBe(false);
  });

  it('test_EngineerChangeSchema_父目录穿越路径_校验失败', () => {
    const r = EngineerChangeSchema.safeParse({
      file: '../../../etc/passwd',
      action: 'create',
      description: 'd',
    });
    expect(r.success).toBe(false);
  });

  it('test_EngineerChangeSchema_绝对路径_校验失败', () => {
    const r = EngineerChangeSchema.safeParse({
      file: '/etc/passwd',
      action: 'edit',
      description: 'd',
    });
    expect(r.success).toBe(false);
  });

  it('test_EngineerChangeSchema_合法路径与默认diffHint_校验通过', () => {
    const r = EngineerChangeSchema.safeParse({
      file: 'src/ok.ts',
      action: 'create',
      description: 'd',
    });
    expect(r.success).toBe(true);
    // diffHint 有 default('')——缺失时不报错，取空串
    expect(r.success && r.data.diffHint).toBe('');
  });
});

// ============================================================
// 四、engineerExecute 纵深防御：绕过 zod 直接构造对象仍不得逃逸
// ============================================================

/** 构造一个最小 decide 对象（绕过 zod——模拟内部调用/反序列化路径） */
function rawDecide(file: string, diffHint = 'PAYLOAD'): EngineerDecide {
  return {
    changes: [{ file, action: 'create', description: 'attack', diffHint }],
    rationale: 'r',
  };
}

describe('engineerExecute · 绕过 zod 的纵深防御', () => {
  it('test_engineerExecute_命令替换路径_拒绝落盘且不执行', async () => {
    const res = await engineerExecute(rawDecide('x$(touch PWNED_MARKER).ts'), {
      cwd: tmpRoot,
      dryRun: true,
    });
    expect(res.allSuccess).toBe(false);
    expect(res.changes[0]!.success).toBe(false);
    // 关键：任何名为 PWNED_MARKER 的文件都不应在系统临时目录出现
    expect(fs.existsSync(path.join(os.tmpdir(), 'PWNED_MARKER'))).toBe(false);
  });

  it('test_engineerExecute_父目录穿越路径_拒绝落盘', async () => {
    const res = await engineerExecute(rawDecide('../../escape_exec.txt'), {
      cwd: tmpRoot,
      dryRun: true,
    });
    expect(res.changes[0]!.success).toBe(false);
    // 解析后锚定同样生效：不因 dryRun 而放行
    expect(res.changes[0]!.summary).toContain('拒绝');
  });

  it('test_engineerExecute_绝对路径_拒绝落盘', async () => {
    const res = await engineerExecute(rawDecide('/tmp/absolute_escape.txt'), {
      cwd: tmpRoot,
      dryRun: true,
    });
    expect(res.changes[0]!.success).toBe(false);
    expect(fs.existsSync('/tmp/absolute_escape.txt')).toBe(false);
  });

  it('test_engineerExecute_单条被拒_不中断同批其余合法变更', async () => {
    const res = await engineerExecute(
      {
        changes: [
          { file: '../evil.ts', action: 'create', description: 'attack', diffHint: 'X' },
          { file: 'src/ok.ts', action: 'create', description: 'legit', diffHint: 'OK' },
        ],
        rationale: 'r',
      },
      { cwd: tmpRoot, dryRun: true },
    );
    expect(res.changes).toHaveLength(2);
    expect(res.changes[0]!.success).toBe(false);
    expect(res.changes[1]!.success).toBe(true);
    expect(res.allSuccess).toBe(false);
  });
});

// ============================================================
// 五、不误伤 + 无 shell：合法路径照常写，git 走参数数组
// ============================================================

describe('engineerExecute · 合法路径真实写盘与无 shell 调用', () => {
  it('test_engineerExecute_合法文件_真实写盘且内容正确', async () => {
    const res = await engineerExecute(rawDecide('src/ok-file.ts', 'export const ok = 1;'), {
      cwd: tmpRoot,
      // dryRun=false：真实写盘；gitRunner 注入空实现（临时目录内无 git 仓库）
      gitRunner: () => '',
    });
    expect(res.allSuccess).toBe(true);
    const written = path.join(tmpRoot, 'src', 'ok-file.ts');
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf-8')).toBe('export const ok = 1;');
  });

  it('test_engineerExecute_文件名含空格_gitRunner收到未拆词的数组元素', async () => {
    const calls: string[][] = [];
    await engineerExecute(rawDecide('src/my file.ts', 'X'), {
      cwd: tmpRoot,
      gitRunner: (args) => {
        calls.push(args);
        return '';
      },
    });
    // 走 shell 的话 'src/my file.ts' 会被拆成 'src/my' 与 'file.ts' 两个参数
    const addCall = calls.find((c) => c[0] === 'add');
    expect(addCall).toBeDefined();
    expect(addCall).toEqual(['add', '--', 'src/my file.ts']);
  });

  it('test_engineerExecute_git不可用_降级为文件清单不抛错', async () => {
    const res = await engineerExecute(rawDecide('src/ok.ts', 'X'), {
      cwd: tmpRoot,
      gitRunner: () => {
        throw new Error('git not found');
      },
    });
    expect(res.allSuccess).toBe(true);
    expect(res.diff).toContain('[git 不可用]');
  });
});
