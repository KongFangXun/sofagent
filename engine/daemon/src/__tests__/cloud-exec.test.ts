// cloud-exec.test.ts · 章十二 ssh 通道适配器测试（fake exec 注入——零真实网络）
import { describe, it, expect } from 'vitest';
import { createSshTrainChannel, type ExecFn } from '../cloud-exec';
import { normalizeDualChannelEvent, chainDualChannelEvent } from '../cloud-events';

/** fake exec：记录调用 + 可编程响应（返回值或 throw） */
function makeFakeExec(
  responses: Array<(cmd: string, args: string[]) => { stdout: string; stderr: string }>,
): ExecFn & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  let i = 0;
  const fn: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r(cmd, args);
  };
  return Object.assign(fn, { calls });
}

describe('章十二：ssh 通道适配器（cloud-exec）', () => {
  it('submit = upload + spawn 两命令（execFile 数组防注入）', async () => {
    const exec = makeFakeExec([
      () => ({ stdout: '', stderr: '' }),
      () => ({ stdout: '', stderr: '' }),
    ]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const r = await channel.submit('/local/job-1', {
      jobId: 'job-1',
      jobJsonSha256: 'a'.repeat(64),
    });
    expect(r).toEqual({ remoteJobId: 'job-1', accepted: true });
    // 第一条 scp 上传（args[0]='scp' 提为命令、其余为参数——数组形态防注入）
    expect(exec.calls[0].cmd).toBe('scp');
    expect(exec.calls[0].args).toEqual(['-r', '/local/job-1', 'user@vm1:/tmp/sofagent-train/job-1']);
    // 第二条 ssh spawn
    expect(exec.calls[1].cmd).toBe('ssh');
    expect(exec.calls[1].args[0]).toBe('user@vm1');
  });

  it('status：远端事件尾 → 状态机归一（done → succeeded）', async () => {
    const exec = makeFakeExec([
      () => ({
        stdout: [
          JSON.stringify({ type: 'progress', step: 10 }),
          JSON.stringify({ type: 'progress', step: 20 }),
          JSON.stringify({ type: 'done' }),
        ].join('\n'),
        stderr: '',
      }),
    ]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const st = await channel.status('job-1');
    expect(st.status).toBe('succeeded');
    expect(st.recentEvents.length).toBe(2); // progress 两条进事件（done 决定状态）
  });

  it('status：failed 事件 → failed + error 携因', async () => {
    const exec = makeFakeExec([
      () => ({ stdout: JSON.stringify({ type: 'failed', reason: 'CUDA OOM' }), stderr: '' }),
    ]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const st = await channel.status('job-1');
    expect(st.status).toBe('failed');
    expect(st.error).toBe('CUDA OOM');
  });

  it('status：空输出 → pending', async () => {
    const exec = makeFakeExec([() => ({ stdout: '{}', stderr: '' })]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const st = await channel.status('job-1');
    expect(st.status).toBe('pending');
  });

  it('artifacts：sha256sum 输出 → 产物清单', async () => {
    const sha = 'b'.repeat(64);
    const exec = makeFakeExec([
      () => ({ stdout: `${sha}  adapter.safetensors\n`, stderr: '' }),
    ]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const arts = await channel.artifacts('job-1');
    expect(arts).toHaveLength(1);
    expect(arts[0].name).toBe('adapter.safetensors');
    expect(arts[0].sha256).toBe(sha);
    expect(arts[0].uri).toContain('user@vm1');
  });

  it('cancel = stop + cleanup 两命令（失联止损）', async () => {
    const exec = makeFakeExec([
      () => ({ stdout: '', stderr: '' }),
      () => ({ stdout: '', stderr: '' }),
    ]);
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    const st = await channel.cancel('job-1', '预算超支');
    expect(st.status).toBe('cancelled');
    // 第一条 pkill 强杀
    expect(exec.calls[0].args.join(' ')).toContain('pkill');
    // 第二条 rm -rf 清理
    expect(exec.calls[1].args.join(' ')).toContain('rm');
  });

  it('命令超时：exec 抛错向上传播（fail-loud）', async () => {
    const err = new Error('ETIMEDOUT');
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: ExecFn = Object.assign(
      async (cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        throw err;
      },
      {},
    );
    const channel = createSshTrainChannel({ endpoint: 'user@vm1', exec });
    await expect(channel.status('job-1')).rejects.toThrow('ETIMEDOUT');
  });
});

describe('章十二：双通道事件归一（cloud-events）', () => {
  it('done → completed 挂链；progress → 不挂链', () => {
    const done = normalizeDualChannelEvent({ source: 'local', event: { type: 'done' } });
    expect(done.auditType).toBe('train_job_completed');
    expect(done.statusTransition?.to).toBe('completed');
    const prog = normalizeDualChannelEvent({ source: 'local', event: { type: 'progress', step: 5 } });
    expect(prog.auditType).toBeNull();
  });

  it('failed → failed 挂链（云通道标注 remoteJobId）', () => {
    const r = normalizeDualChannelEvent({
      source: 'cloud',
      event: { type: 'failed', reason: 'OOM' },
      remoteJobId: 'cloud-9',
    });
    expect(r.auditType).toBe('train_job_failed');
    expect(r.summary).toContain('云通道 cloud-9');
  });

  it('chainDualChannelEvent：归一 + emitTrainAudit 挂链成功', () => {
    const r = chainDualChannelEvent({
      enterpriseId: 'ent-1',
      trainJobId: 'job-1',
      dataSourceHash: 'c'.repeat(16),
      event: { source: 'local', event: { type: 'done' } },
      dataDir: `/tmp/sofagent-chain-test-${process.pid}`,
    });
    expect(r.auditType).toBe('train_job_completed');
    expect(r.chained).toBe(true);
  });
});
