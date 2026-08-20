// ============================================================
// ast-engine.test.ts · AST 规则引擎单测（真实 TS7 server）
// v1.3.9（一）：验收——引擎可解析 TS/JS 并匹配语义级规则
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AstRuleEngine } from '../engine';

// TS server 启动有秒级开销——套件内共享一个引擎实例
let engine: AstRuleEngine;

beforeAll(() => {
  engine = new AstRuleEngine();
});

afterAll(() => {
  engine.close();
});

describe('AstRuleEngine · 语义级规则匹配', () => {
  it('no-eval：检测 eval() 调用', () => {
    const findings = engine.scan([
      { path: 'a.ts', content: 'const x = eval("1+1");\n' },
    ]);
    expect(findings.some((f) => f.ruleId === 'no-eval' && f.line === 1)).toBe(true);
  });

  it('no-eval：检测 new Function() 且误报为零（普通函数调用不报）', () => {
    const findings = engine.scan([
      { path: 'a.ts', content: 'const f = new Function("return 1");\nconst g = foo(1);\n' },
    ]);
    const evalHits = findings.filter((f) => f.ruleId === 'no-eval');
    expect(evalHits).toHaveLength(1); // 只有 new Function 命中，foo() 不报
    expect(evalHits[0]?.line).toBe(1);
  });

  it('no-hardcoded-secret：密钥类变量 + 长字符串命中；短常量/占位符不误报', () => {
    const findings = engine.scan([
      {
        path: 'b.ts',
        content: [
          'const apiKey = "sk-abcdefghij1234567890";',   // 命中：密钥名 + 长值
          'const token = "short";',                       // 不报：值太短
          'const secret = "xxxxxxxxxxxxxxxx";',           // 不报：占位符
          'const greeting = "hello-world-1234567890";',   // 不报：非密钥名
          'const config = { accessToken: "ghp_abcdefghij1234567890AB" };', // 命中：属性赋值
        ].join('\n'),
      },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-hardcoded-secret');
    expect(hits).toHaveLength(2);
    expect(hits[0]?.line).toBe(1);
    expect(hits[1]?.line).toBe(5);
  });

  it('no-child-process-shell：来自 child_process 的 exec 调用按参数形态定级', () => {
    const findings = engine.scan([
      {
        path: 'c.ts',
        content: [
          'import { exec, spawn } from "child_process";',
          'exec("ls -la; rm -rf /");',          // FAIL 级：字面量含元字符
          'exec("ls -la");',                    // WARN 级：静态命令
          'exec(computeCmd());',                // 动态构造——高危
          'spawn("ls", ["-la"]);',              // spawn 不在 shell 家族，不报
        ].join('\n'),
      },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-child-process-shell');
    expect(hits).toHaveLength(3); // exec×3 命中，spawn 不报
    expect(hits[0]?.line).toBe(2);
  });

  it('no-dynamic-require：require(变量) 命中，require("字面量") 不报', () => {
    const findings = engine.scan([
      { path: 'd.ts', content: 'const m = require(someVar);\nconst n = require("fs");\n' },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-dynamic-require');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
  });

  it('no-debugger：debugger 语句命中', () => {
    const findings = engine.scan([
      { path: 'e.ts', content: 'function f() {\n  debugger;\n}\n' },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-debugger');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
  });

  it('no-sql-string-concat：query 参数拼接变量命中', () => {
    const findings = engine.scan([
      { path: 'f.ts', content: 'db.query("SELECT * FROM t WHERE id=" + userId);\n' },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-sql-string-concat');
    expect(hits).toHaveLength(1);
  });

  it('no-empty-catch：空 catch 命中，有语句的 catch 不报', () => {
    const findings = engine.scan([
      {
        path: 'g.ts',
        content: [
          'try { f(); } catch (e) {}',
          'try { g(); } catch (e) { console.error(e); }',
        ].join('\n'),
      },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-empty-catch');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
  });

  it('no-insecure-url：http:// 外部端点命中，localhost 不报', () => {
    const findings = engine.scan([
      {
        path: 'h.ts',
        content: [
          'const a = "http://api.example.com/v1";',
          'const b = "http://localhost:3000/dev";',
          'const c = "https://api.example.com/v1";',
        ].join('\n'),
      },
    ]);
    const hits = findings.filter((f) => f.ruleId === 'no-insecure-url');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
  });

  it('JS 文件同样可解析（.js 后缀走 JS 语法）', () => {
    const findings = engine.scan([
      { path: 'i.js', content: 'const x = eval("2");\n' },
    ]);
    expect(findings.some((f) => f.ruleId === 'no-eval')).toBe(true);
  });

  it('语法错误的代码不崩——TS 解析器容错恢复仍可产出 findings', () => {
    const findings = engine.scan([
      { path: 'j.ts', content: 'const x = eval("1" ;; {{{\n' },
    ]);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.some((f) => f.ruleId === 'no-eval')).toBe(true);
  });

  it('ruleIds 过滤：只跑指定规则', () => {
    const scoped = new AstRuleEngine({ ruleIds: ['no-eval'] });
    try {
      const findings = scoped.scan([
        { path: 'k.ts', content: 'const x = eval("1");\ndebugger;\n' },
      ]);
      expect(findings.every((f) => f.ruleId === 'no-eval')).toBe(true);
      expect(findings.some((f) => f.ruleId === 'no-debugger')).toBe(false);
    } finally {
      scoped.close();
    }
  });
});
