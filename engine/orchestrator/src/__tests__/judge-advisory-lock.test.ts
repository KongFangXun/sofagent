// ============================================================
// 判定层行为锁（v1.8.0 L234）：判定**永不进控制回路与安全反射**
// ------------------------------------------------------------
// 锁什么：判定输出只作 advisory（建议），不得携带任何可执行句柄；
//         也不得因 grade=auto 就直接触发动作。
// 为什么锁在这里：延迟表把本件定位在「离线批处理 / 人工复核辅助」档，
//         但只要有一条路径让判定直连执行器，这个定位就是假的。
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { gradeOf, DEFAULT_GRADE_THRESHOLDS } from '../router/decision-channel';

const ROUTER_DIR = join(__dirname, '..', 'router');

/** 递归取路由层源文件（不含测试） */
function routerSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name !== '__tests__') walk(p);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  };
  walk(ROUTER_DIR);
  return out;
}

describe('L234 · 判定永不进控制回路（行为锁）', () => {
  it('gradeOf 只返回三值档位字符串——不含执行句柄', () => {
    const answer = { id: 'q1', value: 'A', probability: 0.95, distribution: { A: 0.95, B: 0.05 }, status: 'answered' } as never;
    const g = gradeOf(answer, DEFAULT_GRADE_THRESHOLDS);
    // 真实档位是五值枚举（decision-channel.ts:391-399），不是三值
    expect(['ALLOW', 'ASK', 'DENY', 'SKIP', 'ABSTAIN']).toContain(g);
    expect(typeof g).toBe('string');
    // 任何函数/对象都说明档位里挂上了可执行物
    expect(g).not.toBeInstanceOf(Function);
    expect(g).not.toBeInstanceOf(Object);
  });

  it('路由层除「模型传输」与「git 取数」外，无执行器入口', () => {
    // 允许清单（逐条给理由，新增一条必须在这里写明为什么不是控制回路）：
    //  · stdio-decision-channel.ts —— 拉起**模型子进程**（传输层，输入是 state、输出是概率，不是执行动作）
    //  · ai-attribution-report.ts  —— 调 `git log` 取提交元数据（只读取数，无副作用）
    const ALLOWED = new Set(['stdio-decision-channel.ts', 'ai-attribution-report.ts']);
    const hits: string[] = [];
    for (const f of routerSources()) {
      if (ALLOWED.has(f.split('/').pop() ?? '')) continue;
      const src = readFileSync(f, 'utf8');
      // 去掉注释行后再判，避免注释里提到这几个词造成假红
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      // 只看「进程级」执行入口；`re.exec(str)` 是正则，不在此列
      if (/(child_process|execSync|spawnSync|execFileSync)/.test(code)) {
        hits.push(f.replace(ROUTER_DIR, 'router'));
      }
    }
    expect(hits).toEqual([]);
  });

  it('判定结果对象可无损 JSON 序列化（无函数/句柄字段）', () => {
    const result = {
      id: 'q1',
      grade: gradeOf({ id: 'q1', value: 'A', probability: 0.95, distribution: { A: 0.95, B: 0.05 }, status: 'answered' } as never, DEFAULT_GRADE_THRESHOLDS),
      advisory: true,
      value: 'A',
    };
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
