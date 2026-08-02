// ============================================================
// rule-a21.test.ts · A21 不植后门——持久化检测测试 (v1.2.5)
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA21 } from './rule-a21-persistence';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A21 不植后门', () => {
  it('新增 LaunchAgent plist → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/install.sh', [
        '+cp evil.plist ~/Library/LaunchAgents/com.evil.plist',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('diff 含 KeepAlive → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('config/agent.plist', [
        '+<key>KeepAlive</key>',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('systemd service → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('config/evil.service', [
        '+[Unit]',
        '+[Service]',
        '+WantedBy=multi-user.target',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('crontab 写入 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        '+(crontab -e) 2>/dev/null',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('注册表 Run → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/win-setup.bat', [
        '+reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v Evil /t REG_SZ /d evil.exe',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('普通文件创建 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', [
        '+const x = 1;',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', ['+const x = 1;']),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('@reboot 定时任务 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/cron.sh', [
        '+@reboot /usr/local/bin/evil-agent',
      ]),
    ]);
    const result = checkRuleA21(ctx);
    expect(result.status).toBe('FAIL');
  });
});
