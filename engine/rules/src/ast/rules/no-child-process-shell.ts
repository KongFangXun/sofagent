// ============================================================
// no-child-process-shell.ts · child_process shell 执行管控
// v1.4.3（一）：exec/execSync 走 shell 解释器——参数拼接即命令注入。
// 语法级检测：文件里 import 了 child_process 的 exec* 绑定后又被调用
// ============================================================

import type { AstRule, AstNodeHost } from '../types';
import { walk, is, nodeText, collectImports } from '../walk';

/** child_process 家族里走 shell 的入口（spawn/spawnSync/fork 不走 shell，不在列） */
const SHELL_APIS = new Set(['exec', 'execSync']);

/** shell 元字符——出现在参数字面量里即高危 */
const SHELL_METACHARS = /[;&|`$><\n]/;

export const noChildProcessShellRule: AstRule = {
  id: 'no-child-process-shell',
  name: 'child_process shell 执行管控',
  severity: 'WARN',
  description: 'exec/execSync 走 shell——字面量含元字符或动态拼接参数即命令注入入口（动态参数 FAIL / 静态参数 WARN）',
  checkCode(ctx) {
    // 第一步：收集来自 child_process 的 import 绑定
    const imports = collectImports(ctx);
    const shellBindings = new Set<string>();
    for (const [name, mod] of imports) {
      if (mod === 'child_process' && SHELL_APIS.has(name)) shellBindings.add(name);
    }

    walk(ctx.sourceFile, (node) => {
      if (!is(ctx, node, 'CallExpression')) return;
      const callee = (node as AstNodeHost & { expression?: AstNodeHost }).expression;
      if (!is(ctx, callee, 'Identifier')) return;
      const name = nodeText(callee);
      if (!name || !shellBindings.has(name)) return;

      // 命中 exec*/execSync* 调用——按参数形态定级
      const args = (node as AstNodeHost & { arguments?: readonly AstNodeHost[] }).arguments ?? [];
      const first = args[0];
      if (!first) return;
      if (is(ctx, first, 'StringLiteral')) {
        const cmd = nodeText(first) ?? '';
        if (SHELL_METACHARS.test(cmd)) {
          ctx.report(node, `${name}() 的命令字面量含 shell 元字符——存在命令注入面`);
        } else {
          ctx.report(node, `${name}() 走 shell 执行——优先用 spawn(arg, { shell: false }) 传参数组`);
        }
      } else {
        // 模板字符串 / 变量拼接 → 动态命令
        ctx.report(node, `${name}() 的命令是动态构造（非字符串字面量）——命令注入高危入口`);
      }
    });
  },
};
