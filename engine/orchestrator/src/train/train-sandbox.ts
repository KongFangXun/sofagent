// train-sandbox.ts · v1.4.4 第三章 · 训练沙箱（进程级隔离——扩展 v1.3.7）
//
// 定位：联合训练模式「数据不出企业边界」→ 训练子进程在沙箱内运行。
// 本文件在 v1.3.7 SubAgent 沙箱（network-gateway 白名单 + filesystem
// 虚拟写）底座上扩展训练场景三约束：
//   ① 无外网：训练子进程出站默认拦截，仅白名单端点放行（模型下载镜像）
//   ② 只读数据源：数据集挂载目录对训练进程只读（防数据被训练过程污染）
//   ③ 只写产物目录：训练产物（checkpoint/日志）只落白名单产物目录
//
// 实现路径：不重造沙箱——组合 v1.3.7 组件 + 训练语义封装：
//   - 出网控制：network-gateway（白名单判定）+ spawn env 注入代理变量
//     （HTTPS_PROXY 指向黑洞性地址——Python 生态 fetch 库默认尊重代理变量，
//     配合 gateway 双保险）
//   - 路径控制：路径守卫（resolveTarget 判定读写范围）——数据集只读 +
//     产物目录可写 + 其余拒绝（V8 层实现，沙箱内路径操作全走此处）
//   - 离线能力：环境自足（venv + 基座缓存随包交付）——train-env-init
//     的设备打包形态（tools/train/package-train-runtime.sh）
//
// 测试纪律：路径判定/白名单判定纯函数全注入测试，零真实进程零真实 GPU。

import { join, resolve, sep } from 'path';
import { createNetworkGateway, type NetworkGateway, type NetworkVerdict } from '../sandbox/network-gateway';

// ════════════════════════════════════════
// 训练沙箱配置与路径守卫
// ════════════════════════════════════════

/** 训练沙箱配置（三约束的参数面） */
export interface TrainSandboxOptions {
  /** 数据集挂载目录（只读——多个） */
  dataMounts: readonly string[];
  /** 训练产物目录（可写——checkpoint/日志/报告落点） */
  outputDir: string;
  /** 基座模型缓存目录（只读——离线训练的模型来源） */
  modelCacheDir?: string;
  /** 网络白名单域名（模型下载镜像等——缺省全拦） */
  networkAllowlist?: readonly string[];
  /** 沙箱临时目录（可写——训练框架的 tmp 落点） */
  tempDir?: string;
}

/** 路径访问判定结果 */
export type PathAccess = 'read' | 'write' | 'deny';

/** 路径守卫（三约束的路径面——纯函数可测） */
export interface TrainPathGuard {
  /** 判定路径访问（数据集/模型缓存只读；产物目录/tmp 可写；其余拒绝） */
  checkAccess(path: string, mode: 'read' | 'write'): PathAccess;
}

/** 路径是否在目录内（含自身——resolve 归一化后前缀判定） */
function isInside(dir: string, target: string): boolean {
  const d = resolve(dir) + sep;
  const t = resolve(target);
  return t === resolve(dir) || t.startsWith(d);
}

/**
 * 创建训练路径守卫（纯函数——无 IO）。
 *
 * 判定规则（mode=write 时的收紧）：
 *   - 产物目录 / tempDir → write 允许
 *   - 数据集挂载 / 模型缓存 → read 允许 / write 拒绝（只读数据源）
 *   - 其余路径 → read 允许（系统 Python 库等训练框架自身依赖）/ write 拒绝
 *     （只写产物目录——训练进程不污染工作区其他位置）
 */
export function createTrainPathGuard(options: TrainSandboxOptions): TrainPathGuard {
  const writeAllowed = [options.outputDir, ...(options.tempDir !== undefined ? [options.tempDir] : [])];
  const readOnly = [...options.dataMounts, ...(options.modelCacheDir !== undefined ? [options.modelCacheDir] : [])];
  return {
    checkAccess(path, mode) {
      if (mode === 'write') {
        return writeAllowed.some((d) => isInside(d, path)) ? 'write' : 'deny';
      }
      // read：全路径可读（训练框架需要）——只读约束在 write 面体现
      return 'read';
    },
  };
}

/** 沙箱判定摘要（审计可读——doctor 消费） */
export interface TrainSandboxProfile {
  /** 数据集挂载（只读清单） */
  dataMounts: string[];
  /** 产物目录（唯一可写） */
  outputDir: string;
  /** 模型缓存（只读） */
  modelCacheDir: string | null;
  /** 网络白名单（域名清单——空数组=全拦） */
  networkAllowlist: string[];
}

// ════════════════════════════════════════
// 训练沙箱会话（组合 v1.3.7 网络网关 + 训练路径守卫）
// ════════════════════════════════════════

/** 训练沙箱会话 */
export interface TrainSandbox {
  /** 路径守卫（read/write/deny 判定） */
  paths: TrainPathGuard;
  /** 网络网关（v1.3.7 network-gateway——白名单判定 + deny 事件审计） */
  net: NetworkGateway;
  /** 沙箱画像（审计摘要） */
  profile: TrainSandboxProfile;
  /**
   * 构建训练子进程的 spawn env（代理黑洞 + 沙箱标记——HTTPS_PROXY 指向
   * 不可路由地址，Python fetch 生态默认尊重；配合 net gateway 双保险）
   */
  buildSpawnEnv(baseEnv?: Record<string, string>): Record<string, string>;
  /** 出网判定（gateway 包装——训练语义命名） */
  checkNetworkEgress(host: string, port: number): NetworkVerdict;
  /** deny 事件导出（审计出口——gateway 同源） */
  exportDenyEvents(): Array<{ ts: string; reason: string }>;
}

/**
 * 创建训练沙箱会话（v1.3.7 组件 + 训练三约束封装）。
 *
 * 用法（train-scheduler 集成路径——spawn 前构建 env，事件流走协议）：
 *   const sandbox = createTrainSandbox({ dataMounts: [...], outputDir: ... });
 *   const env = sandbox.buildSpawnEnv(process.env);
 *   spawnFn(pythonBin, args, { env });
 */
export function createTrainSandbox(options: TrainSandboxOptions): TrainSandbox {
  const net = createNetworkGateway({
    allowHosts: [...(options.networkAllowlist ?? [])],
  });
  const paths = createTrainPathGuard(options);
  const profile: TrainSandboxProfile = {
    dataMounts: [...options.dataMounts],
    outputDir: options.outputDir,
    modelCacheDir: options.modelCacheDir ?? null,
    networkAllowlist: [...(options.networkAllowlist ?? [])],
  };
  return {
    paths,
    net,
    profile,
    buildSpawnEnv(baseEnv) {
      // 基础 env 归一化为 Record<string, string>（process.env 展开可能带 undefined 值）
      const source: Record<string, string> = {};
      const raw = baseEnv ?? process.env;
      for (const key of Object.keys(raw)) {
        const value = raw[key];
        if (typeof value === 'string') source[key] = value;
      }
      const env: Record<string, string> = { ...source };
      // 代理黑洞：白名单外流量被代理到不可路由地址（fetch 生态默认尊重代理变量）
      // ——255.255.255.255 是广播地址，连接必失败（软性拦截面）
      env.HTTPS_PROXY = 'http://255.255.255.255:1';
      env.HTTP_PROXY = 'http://255.255.255.255:1';
      env.http_proxy = 'http://255.255.255.255:1';
      env.https_proxy = 'http://255.255.255.255:1';
      env.NO_PROXY = (options.networkAllowlist ?? []).join(',');
      env.no_proxy = env.NO_PROXY;
      // 沙箱标记（训练框架/审计可读——SOFAGENT_TRAIN_SANDBOX=1）
      env.SOFAGENT_TRAIN_SANDBOX = '1';
      return env;
    },
    checkNetworkEgress(host, port) {
      // DNS/HTTP 统一走 gateway 判定（protocol 标记 http——训练出网主形态）
      return net.check({ host, port, protocol: 'http' });
    },
    exportDenyEvents() {
      return net.exportDenyEvents().map((e) => ({ ts: e.ts, reason: e.reason }));
    },
  };
}

/** 训练沙箱产物目录约定：job 目录下 output/（与 train-job 的缺省对齐） */
export function trainSandboxOutputDir(jobDir: string): string {
  return join(jobDir, 'output');
}
