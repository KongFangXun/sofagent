// ============================================================
// dsh-home.test.ts · DSH 节点根目录优先级（F6.7 R7-3）
// ============================================================
// 判据：介质载荷（SOFAGENT_MEDIA_DSH）必须**优先于**本机 $DSH_HOME 被读取，
// 否则「装了介质却仍读 ~/.dsh」= 介质里的 DSH 节点只是被拷了一份、没被用过。
// ============================================================
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { dshHomeRoot, dshSessionsRoot } from '../dsh-adapter';

const ENV_MEDIA = 'SOFAGENT_MEDIA_DSH';
const ENV_HOME = 'DSH_HOME';

describe('dsh-adapter · 根目录优先级', () => {
  afterEach(() => {
    delete process.env[ENV_MEDIA];
    delete process.env[ENV_HOME];
  });

  it('三者都未设 ⇒ 回退 ~/.dsh', () => {
    expect(dshHomeRoot()).toBe(join(homedir(), '.dsh'));
  });

  it('只有 $DSH_HOME ⇒ 用它', () => {
    process.env[ENV_HOME] = '/tmp/dsh-home';
    expect(dshHomeRoot()).toBe('/tmp/dsh-home');
  });

  it('介质载荷设置后优先于 $DSH_HOME（介质内读源）', () => {
    process.env[ENV_HOME] = '/tmp/dsh-home';
    process.env[ENV_MEDIA] = '/tmp/media/dsh';
    expect(dshHomeRoot()).toBe('/tmp/media/dsh');
    expect(dshSessionsRoot()).toBe(join('/tmp/media/dsh', 'sessions'));
  });

  it('显式入参优先于介质载荷（测试/多实例隔离不被环境变量劫持）', () => {
    process.env[ENV_MEDIA] = '/tmp/media/dsh';
    expect(dshHomeRoot('/tmp/explicit')).toBe('/tmp/explicit');
  });

  it('介质载荷为空串 ⇒ 视为未设置（不劫持 @DSH_HOME）', () => {
    process.env[ENV_HOME] = '/tmp/dsh-home';
    process.env[ENV_MEDIA] = '';
    expect(dshHomeRoot()).toBe('/tmp/dsh-home');
  });
});
