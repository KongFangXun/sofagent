# train-security.md · 训练引擎攻击面声明（红队视角）

> v1.4.1 块八定稿。本文档以**红队视角**回答：训练引擎开放后（企业数据进训练分区、Python 计算子进程被 spawn、训练产物可注册部署），攻击者会打哪里、我们挡住哪里、挡不住的明确说是谁的职责。**声明不清的攻击面等于不存在——本文档的诚实度就是它的价值。**

---

## 一、训练引擎覆盖的攻击面与措施

### 攻击面一 · job.json 路径注入

**威胁**：训练任务的路径字段（dataPath / checkpointPath / outputDir）被注入 `../` 逃逸、绝对路径、NUL 截断、Windows 盘符等构造——读写越出企业分区，污染或窃取其他目录。

**覆盖**：`engine/orchestrator/src/train/security-baseline.ts` 的 `validateTrainPath` 路径白名单（五重校验：相对路径强制 / 盘符与 UNC 拒绝 / NUL 拒绝 / 逐段过块四 `isSafePathSegment` / resolve 后 containment 兜底）+ zod `TrainPathSchema` 封装（spawn 前第三道门）。

**验证**：`src/__tests__/security-baseline.test.ts` 路径白名单组八用例（逃逸 / 绝对路径 / NUL / 盘符 / 裸点段 / 空输入 / 合法放行 / zod 封装）。

### 攻击面二 · 超参命令注入（spawn 环境外泄）

**威胁**：hyperparams 字符串值携带 shell 元字符（`;` `|` `&` `` ` `` `$` `(` `)` `<` `>` 换行等），经 spawn 环境拼接为任意命令执行。

**覆盖**：`sanitizeHyperparamsForSpawn` 元字符黑名单过滤。**语义是拒绝而非清洗**——清洗后放行会让训练跑在与提交者所见不同的参数上（静默偏差比快速失败更危险）。数字/布尔/null 放行；对象/数组递归（键路径定位首个违规处）；不可序列化类型（function/symbol）拒绝。

**验证**：命令注入过滤组七用例（逐元字符命中 / 管道与命令替换 / 数字布尔放行 / 嵌套拦截带键路径 / 嵌套干净放行 / 不可序列化拒绝）。

### 攻击面三 · 跨企业数据隔离

**威胁**：A 企业读取/推断 B 企业的训练任务（job 状态、loss/reward 事件流、产物）——商业机密经训练数据外泄。

**覆盖**（块四已落地）：`isolation-guard.ts` 资源归属校验（`assertEnterpriseAccess`）+ 路径段校验 + `train-job.ts` 受守卫查询（`getJobGuarded` / `readTrainEventsGuarded` / `listJobsGuarded`）。关键设计：**分区作用域读取**——请求方物理上只扫自家分区，其他企业 jobId 连存在性都不暴露（无权与不存在同形返回，防探测）。

**验证**：`src/__tests__/train-isolation.test.ts` 二十二用例（跨企业阻断 / listJobs 过滤 / 逃逸拦截 / 串目录防御纵深）。

### 攻击面四 · 云凭据经日志/审计泄漏

**威胁**：模型网关凭据（api_key/token 等）随 hyperparams、失败原因等字段写进审计日志明文落盘。

**覆盖**：**双轴脱敏**——`security-baseline.ts` 的 `maskCredentials`（**键名**轴：字段叫凭据名即 mask 值为 `***masked***`，容器键递归、非凭据键不误伤）+ `train-audit.ts` 的 `sanitizeDeep`（**值**轴：长得像密钥的文本就地打码，模式源为 @sofagent/core 的 `REDACTION_PATTERNS` 单一事实源）。铁律：先脱敏再签名（HMAC 链不因脱敏而破坏）。

**验证**：maskCredentials 组八用例（键名模式 / 深层嵌套递归 / 数组元素 / 大小写变体 / 非凭据不误伤 / 双轴互补）。

### 攻击面五 · 训练产物（权重）防篡改

**威胁**：训练完成的模型权重被篡改后注册部署——后门随「合法产物」进入生产。

**覆盖**（块六在途，此处为规划引用）：产物 HMAC 签名（artifact-signing）+ 部署加载前验签（verify）+ 验签失败阻断 `model_register`。审计事件 `artifact_tampered` 已在 train-audit.ts 事件类型表内预留。

**验证**：块六交付后补测试索引（当前状态如实：规划引用，非已落地）。

---

## 二、模型层职责边界（本版不覆盖、明确归属）

| 边界 | 归属 | 说明 |
|---|---|---|
| Python 沙箱逃逸 | v1.4.3 实装 | 计算面子进程的资源隔离（seccomp/容器级）不在 v1.4.1 范围；本版 `runSandboxSelfCheck` 只提供**代码侧防线**的就绪性自检（路径白名单 / 注入过滤 / 分区规范 / 凭据脱敏四项活性探针），实装后升级为「不过自检不允许 spawn」门禁 |
| 云凭据完整虚拟 key 边界 | v1.3.7 既有能力 | 凭据的签发/轮换/吊销生命周期归模型网关的虚拟 key 体系（v1.3.7）；本版训练侧只落**脱敏**（日志/审计不落明文），不重复建设凭据管理 |
| 权重加载阻断的完整链路 | 块六（本版在途） | 签名与验签算法本版交付，与部署面（model_register）的阻断接线随块六收口 |

## 三、声明为商业侧职责的攻击面（不在开源版范围）

以下攻击面**明确不在开源版覆盖范围**，属商业侧（企业交付合同内定制或商业版能力）：

- **训练数据投毒检测**：语料被恶意投毒（label 翻转 / 后门触发样本注入）的检测与清洗——需要领域相关的数据质检管线与统计基线，开源版只提供数据指纹（块五冻结 hash）供商业侧质检挂载。
- **基座模型后门检测**：开源基座权重本身携带后门（trigger 激活路径）的检测——需沙箱化行为评测农场，超出编排引擎职责。

开源版用户若需要上述能力，应在商业合同中明确；本文档不做「已覆盖」的暗示。

## 四、沙箱完整性自检（本版接口，v1.4.3 实装为门禁）

`runSandboxSelfCheck()` 返回结构化就绪报告：四项检查（path-whitelist / injection-filter / partition-layout / credential-masking）各 `{name, passed, detail}`，全过 `ready=true`。每项都是**真实活性探针**（用中性占位的恶意样本实跑防线函数——非装饰性报告）。v1.4.1 验收口径：接口可用即验收；v1.4.3 将其接入 spawn 前置门禁。

## 五、部署面提示（系统级边界——代码层无法覆盖）

- **macOS 数据主权清理**：执行 `train cleanup <enterpriseId>` 前，应先清理 Time Machine 本地快照（`tmutil listlocalsnapshots /` 确认 + 快照过期策略）——APFS 本地快照可能保留被覆写删除前的旧目录项/旧块引用，覆写（见块四 cleanup.ts 的单遍随机覆写选型说明）对快照内的历史副本无效。这是系统级备份面的边界，属部署纪律而非代码职责。
- **SSD 覆写的诚实边界**：SSD wear-leveling 使任何软件覆写（含 srm/Gutmann 多遍）都无法保证覆盖物理块；数据主权要求更高的客户应将训练数据目录落在加密卷（FileVault/LUKS），清理时销毁密钥——部署文档应如实告知。

---

## 六、红队核对清单

| 威胁 | 覆盖措施 | 验证方式 |
|---|---|---|
| job.json 路径 `../` 逃逸分区 | validateTrainPath 五重白名单 | security-baseline.test.ts · test_validateTrainPath_dotdot逃逸_拒绝且给逃逸类错误码 |
| 绝对路径 / `~` 展开劫持系统路径 | 同上（ABSOLUTE_PATH） | test_validateTrainPath_绝对路径_拒绝ABSOLUTE_PATH |
| NUL 字节截断绕过白名单 | 同上（NUL_BYTE） | test_validateTrainPath_NUL字节_拒绝NUL_BYTE |
| Windows 盘符 / UNC 跨平台注入 | 同上（DRIVE_LETTER） | test_validateTrainPath_盘符样式_拒绝DRIVE_LETTER |
| 超参字符串携带 shell 元字符 | sanitizeHyperparamsForSpawn 拒绝式过滤 | test_sanitizeHyperparamsForSpawn_shell元字符值_整组拒绝 |
| 管道 / 命令替换 / 反引号注入 | 同上（黑名单 14 字符） | test_sanitizeHyperparamsForSpawn_管道与命令替换_拒绝 |
| 嵌套对象深层注入（extra_args 数组内） | 递归过滤 + 键路径定位 | test_sanitizeHyperparamsForSpawn_嵌套对象数组_递归拦截 |
| A 企业读 B 企业 job/事件流 | 受守卫查询 + 分区作用域读取 | train-isolation.test.ts · test_getJobGuarded_A查B的job_结构化拒绝不泄露内容 |
| jobId 存在性探测（跨企业枚举） | 无权与不存在同形返回 | test_listJobsGuarded_按企业过滤_不泄露其他企业jobId存在性 |
| 企业标识注入扫别家分区 | isSafePathSegment 段校验 | test_listJobsGuarded_逃逸enterpriseId_段校验拒绝 |
| 数据被人为串目录后越权读 | state.json 归属兜底校验（防御纵深） | test_getJobGuarded_state被串目录归属不一致_防御纵深拒绝 |
| 凭据字段随审计明文落盘 | maskCredentials 键名轴 + sanitizeDeep 值轴 | test_maskCredentials_各键名模式_命中 / 深层嵌套_递归mask |
| 凭据键名大小写/分隔符变体绕过 | 归一化匹配（ApiKey/API_KEY/api-key） | test_maskCredentials_大小写不敏感变体_全命中 |
| 防线静默失效（回归不自知） | runSandboxSelfCheck 四项活性探针 | test_runSandboxSelfCheck_防线完好_四项全过ready为true |
| Python 沙箱逃逸 | **未覆盖——v1.4.3** | 无（如实声明） |
| 训练数据投毒 | **未覆盖——商业侧** | 无（如实声明） |
| 基座模型后门 | **未覆盖——商业侧** | 无（如实声明） |
| 权重篡改后部署 | 块六在途（签名+验签+阻断） | 块六交付后补索引 |

---

## 七、相关文件索引

| 文件 | 角色 |
|---|---|
| `engine/orchestrator/src/train/security-baseline.ts` | 路径白名单 / 注入过滤 / 凭据脱敏 / 沙箱自检（本块） |
| `engine/orchestrator/src/train/isolation-guard.ts` | 路径段校验与归属校验原语（块四——白名单底层） |
| `engine/orchestrator/src/train/cleanup.ts` | 数据主权覆写清理（块四） |
| `engine/orchestrator/src/train/train-audit.ts` | 审计链 + 值轴脱敏 sanitizeDeep（块三） |
| `engine/core/src/shared/secret-patterns.ts` | 密钥检测/脱敏正则单一事实源（REDACTION_PATTERNS） |
| `engine/orchestrator/src/__tests__/security-baseline.test.ts` | 本块测试（二十六用例） |
