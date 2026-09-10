// hosted-channel.example.mjs · TrainChannel 托管 API 参考适配示例
// ============================================================
//
// 教学形态（非引擎核心依赖）——演示如何把一个虚构的托管训练 API
// 适配为 sofagent TrainChannel 四动作。真实适配按
// docs/guides/train-channel-spec.md 规范实现。
//
// 运行：node tools/train/examples/hosted-channel.example.mjs
// （内置 fake 轮询——零真实网络，纯演示状态机归一）

// ── 虚构托管 API 的原生类型 ──

/** API 原生状态（适配方文档给定） */
const RAW_STATUS = {
  QUEUED: 'pending',
  TRAINING: 'running',
  COMPLETED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/** 假的 API client（真实适配换成 fetch 调用——凭据从 credentialRef 解析） */
function fakeApiClient(credentialRef) {
  let state = 'QUEUED';
  let ticks = 0;
  return {
    async createJob(jobDir, sha) {
      return { job_id: `hosted-${Date.now()}` };
    },
    async getStatus(jobId) {
      ticks++;
      if (state === 'QUEUED' && ticks > 1) state = 'TRAINING';
      if (state === 'TRAINING' && ticks > 3) state = 'COMPLETED';
      return { status: state, error_msg: state === 'FAILED' ? 'OOM' : undefined };
    },
    async listArtifacts(jobId) {
      return [
        { name: 'adapter.safetensors', url: `https://fake.host/${jobId}/adapter.safetensors`, sha256: 'a'.repeat(64), size: 1024 },
      ];
    },
    async cancelJob(jobId) {
      state = 'CANCELLED';
      return { status: state };
    },
  };
}

// ── TrainChannel 适配实现 ──

/** 适配器：托管 API → TrainChannel 四动作 */
export function createHostedChannel(credentialRef) {
  const api = fakeApiClient(credentialRef);
  return {
    name: 'hosted-fake',

    async submit(jobDir, jobSpec) {
      const r = await api.createJob(jobDir, jobSpec.jobJsonSha256);
      return { remoteJobId: r.job_id, accepted: true };
    },

    async status(remoteJobId) {
      const raw = await api.getStatus(remoteJobId);
      // 状态归一：原生值 → ChannelStatus（未知值 pending 兜底 + rawStatus 保留）
      const status = RAW_STATUS[raw.status] ?? 'pending';
      return {
        status,
        rawStatus: raw.status,
        error: raw.error_msg,
        recentEvents:
          status === 'running'
            ? [{ at: new Date().toISOString(), kind: 'progress', percent: 50 }]
            : [],
      };
    },

    async artifacts(remoteJobId) {
      const list = await api.listArtifacts(remoteJobId);
      // sha256 必填——产物校验链（篡改拒绝）依赖
      return list.map((a) => ({
        name: a.name,
        uri: a.url,
        sha256: a.sha256,
        sizeBytes: a.size,
      }));
    },

    async cancel(remoteJobId, reason) {
      const raw = await api.cancelJob(remoteJobId);
      return {
        status: RAW_STATUS[raw.status] ?? 'cancelled',
        rawStatus: raw.status,
        recentEvents: [{ at: new Date().toISOString(), kind: 'status', status: 'cancelled', message: reason }],
      };
    },
  };
}

// ── 演示主流程（node 直跑） ──

if (process.argv[1] && process.argv[1].endsWith('hosted-channel.example.mjs')) {
  const channel = createHostedChannel('vault://demo-cred-ref');
  const submit = await channel.submit('/tmp/job', { jobId: 'demo-1', jobJsonSha256: 'b'.repeat(64) });
  console.log('submit →', submit);
  for (let i = 0; i < 5; i++) {
    const st = await channel.status(submit.remoteJobId);
    console.log(`status → ${st.status}（raw=${st.rawStatus}）`);
    if (st.status === 'succeeded') {
      console.log('artifacts →', await channel.artifacts(submit.remoteJobId));
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
