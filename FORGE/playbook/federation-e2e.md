# sofagent 联邦查询跨进程 E2E 测试

验证 `@sofagent/daemon` 联邦查询（v1.1.8 引入）在**真实跨进程**场景下的完整性。补现有单测（`federation.test.ts`，同进程 mock channel 直投）未覆盖的缺口。

> 本 E2E 已被 acceptance-test.sh **场景 320** 纳入验收体系（v1.4.0 起），每次发版验收自动运行。

## 为什么需要这个测试

| 维度 | 现有单测 | 本 E2E |
|------|---------|--------|
| 进程边界 | 同进程 mock 两个 peer | **两个独立 Node 进程**（fork），loopback TCP 传输 |
| 传输层 | `createMemoryChannel` 内存直投 | **真实 TCP socket**（127.0.0.1） |
| 配对 | 直接构造 `PairedPeer`（跳过协商） | **完整配对流程**（createPairingSession → pairByCode → 指纹确认） |
| 篡改 | 未覆盖 | **密文改 1 字节 → 解密失败** |
| 离线 | 同进程标记离线 | **真实 kill 对端进程** → 降级 |

架构一致性：与生产相同——channel 只搬运密文帧，保密靠第 3 层 AES-256-GCM（channel.ts 注释明确此设计）。

## 运行方式

**前置**：sofagent 仓库已 `npm install` + 构建（`engine/*/dist/` 存在）。

```bash
# 在 sofagent 仓库根目录运行（脚本自动定位仓库）
cd /Users/kongfangxun/WorkBuddy/sofagent
node FORGE/playbook/federation-e2e.mjs

# 或显式指定仓库路径
SOFAGENT_REPO=/Users/kongfangxun/WorkBuddy/sofagent node FORGE/playbook/federation-e2e.mjs
```

无需管理员权限、无需网络外连（全程 127.0.0.1 loopback）、无需双设备。

## 预期输出与判定

- 全部场景 PASS → 最后一行 `结果：10 PASS / 0 FAIL`，**exit 0**
- 任一场景 FAIL → 对应行 `❌`，**exit 1**（判定标准：`echo $?`）
- 跑完自动清理临时目录（`/tmp/sofagent-e2e-*`），不留残留

## 覆盖场景（10 断言）

1. **场景一 · 配对协商**：双方 ECDH 共享密钥一致；peerId = 指纹（防公钥调包的锚点）
2. **场景二 · 跨进程加密查询**：A 发查询帧 → fork 的子进程 B 解密 → 本地 knowledge 检索 → 加密回传 → A 收到正确结果；帧加解密往返一致
3. **场景三 · 篡改检测**：中间人翻转密文 1 字节 → AES-GCM 解密失败（完整性校验生效）
4. **场景四 · 离线降级**：SIGKILL 终止 B → fetchFromPeer 返回 null（不抛错）→ `withOfflineFallback` 降级本地知识库返回结果（审计打点 `federation_query{merged:1, onlinePeers:0}`）
5. **场景五 · trust 白名单**：peer 返回标 public 但内容含 AKIA 密钥串 → 降权 trust=web + WARN；trust 取本地白名单不采信 peer 自报

## 已知边界（本 E2E 不覆盖）

- **OpenClaw 生产通道联调**：`loadOpenClawChannel()`（channel.ts 中动态加载 openclaw SDK）仍是「接入点留待联调」状态——需要两台真实设备 + OpenClaw 运行。本 E2E 用 TCP 模拟该通道的「搬运密文」角色。
- USB 密钥载体配对（`pairByFederationFile` / `usb-key.ts`）——已有 `usb-key.test.ts` 单测覆盖，本脚本聚焦跨进程查询链路。
- 真实公网联邦（两台机器经局域网/公网互联）——建议后续在双设备联调时跑通后留记录。

## 实测记录

**2026-08-22 · macOS + Node v24.19.0 · `10 PASS / 0 FAIL · exit 0` · 一次跑通，无需改任何代码**

前置核对全部满足（Node ≥18 / `engine/core/dist` + `engine/daemon/dist/federation` 构建产物在 / 脚本依赖 9 个符号全部导出）；五场景全过：配对协商（ECDH 一致 + 指纹锚点）· 跨进程加密查询（A→fork 子进程 B→TCP→解密→检索→加密回传）· 篡改检测（密文翻 1 字节 → AES-GCM 解密失败）· 离线降级（SIGKILL 杀 B → null → 本地知识库）· trust 白名单（标 public 含 AKIA → 降权 WARN）。

> 该实测记录已作为 v1.4.0「联邦查询跨设备 E2E」排期的证据基线（E2E 脚本固化入仓时复用此验收标准）。

## 常见失败排查

| 现象 | 原因 |
|------|------|
| `未找到 sofagent 仓库` | 不在仓库根目录运行，或未设 SOFAGENT_REPO |
| `Cannot find module .../engine/core/dist` | 仓库未构建——先跑 `npm run build` |
| 场景二 FAIL | fork 子进程未能启动——检查 Node 版本（需 ≥18，支持 fetch 无关；脚本用 net/fork 均内置） |
| 场景四审计行缺失 | 属正常（审计打点走 stderr，不影响判定） |
