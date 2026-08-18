# SubAgent 沙箱攻击面声明（v1.3.7 交付①）

> 组件：`engine/orchestrator/src/sandbox/`（filesystem-backend / network-gateway / tool-gate / virtual-key / async-subagent）
> 版本：v1.3.6（当前 SSOT；本组件随 v1.3.7 发布）
> 依据：docs/changelog/v1.3/v1.3.7.md §一「沙箱完整性自检与攻击面声明」

## 一、五类攻击面 × 防御措施

| 攻击面 | 防御措施 | 实现位置 |
|--------|---------|---------|
| **沙箱逃逸**（SubAgent 绕过虚拟 FS 直接写物理磁盘） | 启动时完整性自检（`integrityCheck()` 校验 writeVirtual/approve 函数 toString 指纹未漂移）+ SubAgent 全部写操作经虚拟层（未审批不落盘；monkey-patch 模式下绕过 = 进程级 deny） | filesystem-backend.ts `integrityCheck()` / index.ts `createSandboxSession()` |
| **网络白名单绕过**（DNS 隧道 / ICMP / raw socket 逃逸） | 出站全量拦截（不只 HTTP）：monkey-patch `net.connect` / `net.createConnection` / `dns.lookup` / `dns.resolve`——白名单外域名/IP deny + deny 事件审计（上限 1000 条防刷爆）；IP 直连按 CIDR 白名单判定（防域名解析绕过） | network-gateway.ts `installNetworkGuard()` |
| **虚拟 key 泄漏**（SubAgent 提取虚拟 key 向外发送） | 虚拟 key 限 scope（数据流契约：越界拒绝）+ token bucket 限速（默认 1 QPS，突发 5）；真实 key 不进 SubAgent 可见 env（host 边界注入——`buildSandboxEnv()` 只放 vk- key）；日志脱敏（`mask()` 把 vk- 全串打码） | virtual-key.ts |
| **工具调用伪装**（伪造工具名绕过 tool-gate） | 按工具唯一 ID（Symbol）判定——名称字符串可伪造，Symbol 身份不可构造；未注册 ID 一律 deny（fail-closed） | tool-gate.ts `createToolGate()` |
| **沙箱资源耗尽**（fork bomb / 磁盘填充） | 虚拟 FS 容量上限（默认 32MB 总量 / 8MB 单文件）+ 超限 deny + quota-deny 审计事件；deny 事件带上限防审计刷爆 | filesystem-backend.ts 配额 / network-gateway.ts `maxDenyEvents` |

## 二、防御边界（明确不防什么——诚实声明）

- **OS 级硬隔离**（bubblewrap/seatbelt）：**本版不做**，留 v1.3.9+——本版虚拟 FS 是应用层隔离，不防 kernel exploit / ptrace / 侧信道
- **主 Agent**：本版沙箱仅限 SubAgent；主 Agent 运行时策略强制留 v1.3.9（meta-harness）
- **FS monkey-patch 的边界**：`installNetGuard` 只 patch net/dns 出站入口；SubAgent 若通过 shell 子进程绕过（如 `curl` 子进程）需配合 v1.3.9 OS 级沙箱彻底封堵——当前版本 shell 工具应经 tool-gate 注册为 high 风险（前置审批）缓解

## 三、与 v1.3.0 middleware 的叠加关系

```
v1.3.0: createReactAgent → wrapToolCall middleware（记录+告警）→ 工具执行 → 物理磁盘
v1.3.7: createReactAgent → wrapToolCall middleware → 沙箱层（allow/deny + 虚拟执行）→ 审批 → 物理磁盘
```

middleware 不删除——它是沙箱的「审计记录层」，沙箱是「执行隔离层」。两者叠加。

## 四、证据流边契约（v1.2.5 P6 拆入）

`write → virtual → audit → approve → physical`，每步输出留不可篡改审计记录（vfs-events.jsonl append-only + HMAC 链，`verifyChain()` 可重放验证）。

## 五、自检使用方式

```ts
import { createSandboxSession } from '@sofagent/orchestrator/sandbox';

const session = createSandboxSession({ dataDir });
if (!session.integrity.ok) {
  // hook 指纹漂移——拒绝启动沙箱，取 exportEvents() 上报审计
  throw new Error(`沙箱完整性自检失败: ${session.integrity.detail}`);
}
```
