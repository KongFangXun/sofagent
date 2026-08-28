// ============================================================
// no-debugger.ts · 禁止 debugger 语句
// v1.4.2（一）：debugger 语句遗留在生产代码会冻结 Node 进程
// ============================================================

import type { AstRule } from '../types';
import { walk, is } from '../walk';

export const noDebuggerRule: AstRule = {
  id: 'no-debugger',
  name: '禁止 debugger 语句',
  severity: 'FAIL',
  description: 'debugger 语句遗留在生产代码会冻结 Node 进程',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      if (is(ctx, node, 'DebuggerStatement')) {
        ctx.report(node, '禁止遗留 debugger 语句——生产环境会冻结进程');
      }
    });
  },
};
