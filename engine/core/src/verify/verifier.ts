// ============================================================
// verify/verifier.ts · Verifier 验证器主类
// v1.3.5 从 sofagent/audit/src/verify/verifier.ts 迁出
// ============================================================
// 从 verify.ts 中提取的 Verifier 类——管理检查项的记录与输出。

import { RED, GREEN, YELLOW, BOLD, NC } from './types.js';
import type { CheckItem, VerifyResult } from './types.js';

// ── 验证器主类 ──
export class Verifier {
  private passCount = 0;
  private warnCount = 0;
  private failCount = 0;
  private checks: CheckItem[] = [];
  private jsonMode: boolean;
  private quietMode: boolean;

  constructor(jsonMode: boolean, quietMode: boolean) {
    this.jsonMode = jsonMode;
    this.quietMode = quietMode;
  }

  /** 记录通过项。 */
  checkPass(desc: string): void {
    this.passCount++;
    this.checks.push({ status: 'pass', item: desc });
    if (!this.jsonMode && !this.quietMode) {
      console.log(`  ${GREEN}✓${NC} ${desc}`);
    }
  }

  /** 记录失败项。 */
  checkFail(desc: string): void {
    this.failCount++;
    this.checks.push({ status: 'fail', item: desc });
    if (this.jsonMode) {
      // JSON 模式不输出单项
    } else if (this.quietMode) {
      console.log(`  ${RED}✗${NC} ${desc}`);
    } else {
      console.log(`  ${RED}✗${NC} ${desc}`);
    }
  }

  /** 记录警告项。 */
  checkWarn(desc: string): void {
    this.warnCount++;
    this.checks.push({ status: 'warn', item: desc });
    if (this.jsonMode) {
      // JSON 模式不输出单项
    } else if (this.quietMode) {
      console.log(`  ${YELLOW}⚠${NC} ${desc}`);
    } else {
      console.log(`  ${YELLOW}⚠${NC} ${desc}`);
    }
  }

  /** 输出 banner。 */
  printBanner(): void {
    if (this.jsonMode || this.quietMode) return;
    console.log('');
    console.log('  ╔═══════════════════════════════════╗');
    console.log('  ║   sofagent · verify              ║');
    console.log('  ╚═══════════════════════════════════╝');
    console.log('');
  }

  /** 输出平台信息。 */
  printPlatformInfo(platform: string, target: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`  平台: ${platform} | 目标: ${target}`);
    console.log('');
  }

  /** 输出 section 标题。 */
  section(title: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`── ${title} ──`);
  }

  /** 输出空行分隔符。 */
  hr(): void {
    if (this.jsonMode || this.quietMode) return;
    console.log('');
  }

  /** 输出粗体黄色标题。 */
  printBoldYellow(title: string): void {
    if (this.jsonMode || this.quietMode) return;
    console.log(`${BOLD}${YELLOW}${title}${NC}`);
  }

  /** 获取检查结果。 */
  getResult(): VerifyResult {
    return {
      pass: this.passCount,
      warn: this.warnCount,
      fail: this.failCount,
      total: this.passCount + this.warnCount + this.failCount,
      checks: this.checks,
    };
  }

  /** 获取失败计数。 */
  get failTotal(): number { return this.failCount; }
  /** 获取通过计数。 */
  get passTotal(): number { return this.passCount; }
  /** 获取警告计数。 */
  get warnTotal(): number { return this.warnCount; }
  /** 获取总检查数。 */
  get total(): number { return this.passCount + this.warnCount + this.failCount; }

  /** 输出 JSON 结果。 */
  outputJson(): void {
    const result = this.getResult();
    const jsonOutput = {
      summary: {
        pass: result.pass,
        warn: result.warn,
        fail: result.fail,
        total: result.total,
      },
      checks: result.checks,
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  }

  /** 输出文本总结。 */
  outputSummary(): void {
    if (this.jsonMode) return;
    console.log('───────────────────────────────────────');
    console.log('');
    console.log(`  结果: ${GREEN}${this.passCount} 通过${NC} / ${YELLOW}${this.warnCount} 警告${NC} / ${RED}${this.failCount} 失败${NC}（共 ${this.total} 项）`);
    console.log('');
  }
}
