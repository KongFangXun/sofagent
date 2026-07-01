# Case 015 — v0.99.2 审计引擎检出率首次实测

## 测试人信息

| 字段 | 填写 |
|------|------|
| 测试人 | 关联企业同事（AI Agent + WorkBuddy 自动执行） |
| 测试日期 | 2026-07-01 20:24 |
| 测试环境 | macOS + WorkBuddy，审计版本 v0.99.1（package.json 未 bump 至 0.99.2） |
| 测试类型 | 靶向违规构造——在独立 git 仓库中逐个构造已知违规 commit，验证审计引擎能否检出 |

---

## 测试结果

| TC | 目标规则 | 违规类型 | 期望处罚 | 实际结果 | 状态 |
|:--:|------|------|:--:|------|:--:|
| A2 | A2 不泄密钥 | 硬编码 sk- 开头 48 字符密钥 | A2 FAIL | A2 FAIL + A3 WARN | ✅ |
| A3 | A3 不改越界 | task 说改 utils.ts，实际改了 unrelated.ts | A3 WARN/FAIL | A3 WARN | ✅ |
| A4 | A4 不删配置 | 创建 tsconfig.json 后删除 | A4 FAIL/WARN | A4 WARN | ✅ |
| A5 | A5 不瞒真相 | commit message 为单字 "fix" | A5 WARN | A5 WARN | ✅ |
| E1 | E1 不落测试 | 新增 src/calc.ts 无对应测试文件 | E1 WARN | E1 WARN | ✅ |

**检出率**：5/5 = 100%

---

## 发现

### A3 守门员效应确认

TC-A2（密钥）和 TC-E1（缺测试）中 A3 也同时触发了 WARN——因为文件不在 task 描述范围内。验证了「A3 越界检查是守门员」的设计预期：有利有弊，不到漏但可能掩盖具体违规类型。

### 扩展规则框架正常

开启 `extendedRulesEnabled: true` 后 E1-E4 全部运行，E1 正确检出新增源码无测试文件。默认关闭是合理的产品决策（个人开发者不需要强制测试覆盖），但当前文档未明确说明这一点。

### 测试 Prompt 漏洞

初版 prompt 有 3 个 bug（规则编号不对、密钥太短、E1 配置格式错误），经测试者发现并修正后达到 100%。详见测试 prompt v3 版本。

---

## 局限

- 靶向构造——每条违规是针对规则精心设计的，不代表真实场景的检出率
- 未测误报率——正常业务代码是否被误判为违规
- 未测边界情况——密钥紧贴 48 字符边界、多文件同时删除等
- 非盲测——测试者知道预期结果

---

> 见 [测试 prompt v3 版本](https://github.com/KongFangXun/sofagent/blob/v0.99.2/docs/evidence/cases/v0992-audit-detection-2026-07-01/)，或桌面 `v0.99.2-审计引擎检出率测试-prompt.md`。
