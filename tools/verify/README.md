# tools/verify/ — 独立验签器（第三方举证面）

> **边界**：本目录是**面向第三方**的独立验签工具——审计师 / 监管 / 法院技术顾问**无需安装 sofagent**，只需一份裸 `node` 与两三个审计文件，即可独立重算并校验 HMAC 哈希链完整性。可信根是**密码学与副本算法**，不是「信任 sofagent」。与 `tools/` 其他维护者脚本不同，本工具**只读、零依赖、可离线**。

## 一、为什么需要独立验签器

sofagent 的审计证据链（`history.jsonl` 历史链 + `decision-log.jsonl` 决策链）此前只能由 sofagent 自身校验——作为举证材料时，其可信度依赖**维护方的中立性**。独立验签器把可信根从「信任 sofagent」换成「信任密码学」：任何一方都能用同一份公开算法在自己的机器上重算链、比对签名，得出「链完整 / 被篡改 / 链头不符」的结论。

覆盖面：

- **平台层**：PR 审阅举证（这条变更流过哪些审计）；
- **模型层**：训练信号溯源（规则集版本 + 审计留痕）；
- **开源用户 / 合规**：合规审计、司法举证。

## 二、运行

零依赖铁律：`verify-chain.mjs` 只 import `node:` 内置模块，**不 import 任何 `@sofagent/*` 包或引擎源码**。裸 `node` 即可运行：

```
node tools/verify/verify-chain.mjs --selftest
node tools/verify/verify-chain.mjs --data-dir /path/to/.sofagent/data
node tools/verify/verify-chain.mjs --history ./history.jsonl --decision ./decision-log.jsonl --key ./audit.key --fingerprint a1b2c3d4
```

### 命令行选项

| 选项 | 说明 |
|------|------|
| `--data-dir <dir>` | 数据根目录——自动定位 `<dir>/audit/history.jsonl` 与 `<dir>/audit/decision-log.jsonl`（以及 `<dir>/audit/history-chain-head` 链头锚点）。 |
| `--history <file>` | 显式指定历史链文件路径（覆盖自动定位）。锚点按 `<file 同目录>/history-chain-head` 定位。 |
| `--decision <file>` | 显式指定决策链文件路径（覆盖自动定位）。 |
| `--key <file>` | HMAC 密钥文件。缺省读 `SOFAGENT_KEY_PATH` 环境变量，再缺省 `~/.sofagent-key`。密钥缺失时**降级**为仅验 `prevHash` 链（与引擎同语义）。 |
| `--fingerprint <fp>` | 环境指纹（8 hex）。缺省按**本机环境**计算，且 `dataDir` 段为空——与引擎写侧默认口径一致。**换机举证时务必显式给出**写入时的指纹（见下「环境指纹」）。 |
| `--json` | 以 JSON 输出（机器消费，含每条结果的 `expected` / `actual`）。 |
| `--selftest` | 合成 golden vector 自检（零外部依赖；退出 0 = 通过）。 |
| `--help`, `-h` | 显示帮助。 |

默认（无 `--history` / `--decision` / `--data-dir`）按解析链 `SOFAGENT_DATA` > `$SOFAGENT_HOME/data` > `~/.sofagent/data` 定位**双链**，一次运行同时校验历史链与决策链。

## 三、输入格式

验签器读取的是 sofagent 的 **JSONL 链文件**——每行一条 JSON 记录，`\n` 分隔。记录里的链接字段由引擎写入：

| 字段 | 含义 |
|------|------|
| `prevHash` | 前一条记录的内容哈希前 16 hex（创世条目为字面量 `genesis`）。 |
| `hashVersion` | `2` = 写入时纳入环境指纹；缺省 / 非 2 = 旧算法（无指纹）。 |
| `envFingerprint` | 写入时的环境指纹（8 hex）——读侧指纹漂移时用于区分「真篡改」与「换机」。 |
| `hmacAlgo` | `'stable'` = 用稳定序列化签名（新条目，可正确验签）。 |
| `hmacSig` | HMAC-SHA256 签名前 32 hex（无密钥写入时缺省）。 |

验签器**不解析业务字段**（如 `ruleResults` / `why`）——只按算法重算 `prevHash` 与 `hmacSig` 并比对。任何业务字段被改动都会导致重算签名与记录不符。

## 四、三态输出

主结论分三类（外加两档降级态），每条给出足够定位信息：

| 状态 | 退出码 | 含义与输出 |
|------|--------|-----------|
| **链完整**（`ok`） | 0 | 所有记录 `prevHash` + `hmacSig` 均可复算一致（且有锚点者链头一致）。 |
| **某条断裂**（`tampered`） | 2 | 检测到篡改——**报出条目号（0-based）与期望值 / 实际值**（如 `期望值：hmacSig = …` / `实际值：hmacSig = …`）。 |
| **链头不匹配**（`head-mismatch`） | 2 | 链头锚点校验失败——尾部被截断（锚点条数 > 实际条数）或锚位条目被重写（`headHash` 不符）。 |
| 不可复验（`unverifiable`） | 1 | 环境指纹漂移（密钥轮换 / hostname / git 路径 / dataDir 变化），或条目缺签名——**属历史证据不可复验，非篡改**，不冒充红态。 |
| 记录不足（`insufficient`） | 1 | 记录不足 2 条，无法构成可验证的防篡改链。 |

**双链取最严**：同一次运行校验双链时，最终退出码取两条链里**最严重**的一档（`tampered` / `head-mismatch` > `unverifiable` / `insufficient` > `ok`）。

### 链头不匹配 vs 决策链

链头锚点文件（`history-chain-head`，结构 `{version, entryCount, headHash, envFingerprint, updatedAt}`）**只有历史链有**；引擎当前**不为 `decision-log.jsonl` 维护锚点**。因此：

- **历史链**：可判「链头不匹配」（截断 / 重写）；
- **决策链**：**无锚点**——验签器**如实说明**并**降级**到纯链完整性校验（不假装有锚点、不虚构链头结论）。决策链的防篡改面止于「`prevHash` + `hmacSig` 链自洽」。

> 诚实边界：链头锚点属**防篡改证据强化**而非密码学保证——能同时重写链文件与锚点文件的攻击者仍可伪造一致状态。它能拦的是「只截断链文件、锚点未同步改」这一最常见形态。

## 五、环境指纹

写入时的环境指纹 = `sha256(hostname-username-gitDir-dataDir)` 前 8 hex：

- `gitDir` = 在写入时的 `cwd` 执行 `git rev-parse --git-dir` 的输出（trim）；失败为 `unknown`。
- `dataDir` = 写侧显式覆盖参数；引擎默认写路径为 `undefined`（即指纹 base 尾段为空）。

**第三方换机举证的要点**：换到另一台机器 / 另一 git 路径复算时，指纹必然不同，`hmacSig` 会「对不上」——此时验签器给出的是 **`unverifiable`（不可复验，黄）而非篡改（红）**。要拿到确定结论，请：

1. 在同一台机器、同一仓库路径下复算，或
2. 用 `--fingerprint` **显式给出写入时的指纹**（若取证时已知），或
3. 结合 `envFingerprint` 字段人工核对——若记录内 `envFingerprint` 与当前一致而 `hmacSig` 不符，才是**确证篡改**。

## 六、第三方举证用法（示例流程）

1. **取证**：拿到 `history.jsonl`（+ `history-chain-head`）、`decision-log.jsonl` 与（如可获取）`~/.sofagent-key` 的副本。三者均为静态文件，可离线带走。
2. **复算**：在任意装有 Node.js 的机器上运行本工具，指向上述文件。
3. **读结论**：
   - 退出码 0 → 链完整，可作为**未被改动**的举证；
   - 退出码 2 → 报出**条目号与期望值 / 实际值**，可精确定位被改动的记录；
   - 退出码 1 → 记录为**不可复验**（多为换机导致指纹漂移），需按第五节显式给出指纹复算。
4. **复核**：`--json` 输出可直接被脚本 / SIEM 消费，便于批量对账与存档。

## 七、自检

`node tools/verify/verify-chain.mjs --selftest` 内置 **golden vector 硬锚**（固定密钥 + 固定记录 → 常量 `hmacSig` / `prevHash`）与**篡改注入合成回归**（篡改中间条目 → 必报断链并定位条目号；伪造链头 → 必报链头不匹配）。golden 常量锚定 HMAC 协议本身——若哪天算法（如签名截断长度 / 稳定序列化语义）被改动，自检立即变红，**不让「验签器恒真」的假绿溜过去**。
