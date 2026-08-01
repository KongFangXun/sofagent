# 团队工作方法论

> 给所有项目的软件开发团队（齐活林 + 许清楚 + 高见远 + 寇豆码 + 严过关）看的操作手册。
> 每个项目各版本开发完，把新踩的坑追加到 §六。

---

## 一、模型分工策略

核心原则：**DeepSeek 做 95%，GLM-5.2 只做终审。push 也用 DeepSeek。**

| 阶段 | 谁做 | 模型 | 成本 | 说明 |
|------|------|------|------|------|
| PRD / 竞品分析 | 许清楚 | DeepSeek | 趋近 0 | GLM 不参与需求阶段 |
| 架构设计 + 任务分解 | 高见远 | DeepSeek | 趋近 0 | 含时序图/类图/文件清单 |
| 代码实现 | 寇豆码 | DeepSeek | 趋近 0 | 全部代码由 DeepSeek 写 |
| QA 测试 | 严过关 | DeepSeek | 趋近 0 | 语法/功能/兼容性/默认关闭 |
| 主理人全量审查 | 齐活林 | DeepSeek | 趋近 0 | 部署循环/逻辑正确性/铁律合规 |
| **终审** | GLM-5.2 | **GLM-5.2** | **~1000 积分** | 审干净后的最终版本，**只此一轮** |
| commit + push + tag | DeepSeek | DeepSeek | 趋近 0 | 代码已审完，推只是传数据 |

### GLM 终审原则

- 审查对象是 git diff 的最终版本（包在一个 md 里）
- 只跑一轮，拿到的发现一次性本地修完
- 修完直接推，不再回给 GLM 再审
- 审查 prompt 是标准化的（见下方 §五），让 GLM 不花积分在理解项目上

---

## 二、BSD/macOS 兼容检查清单

macOS 默认 `/bin/bash` 是 3.2.57，sed 是 BSD 版本。

### sed

| ❌ GNU 语法 | ✅ POSIX/BSD 替代 |
|------------|------------------|
| `\s` | `[[:space:]]` |
| `\b` | `[[:<:]]` / `[[:>:]]` |
| `\w` | `[[:alnum:]_]` |
| `\d` | `[0-9]` |

### bash

| ❌ bash 4+ 特性 | ✅ bash 3.2 兼容 |
|-----------------|-----------------|
| `declare -A`（关联数组） | 并行普通数组 `arr1=(); arr2=()` + `for i in "${!arr1[@]}"` |
| `[[ ]]` | `[ ]` 或 `test` |
| `${var^^}` / `${var,,}` | `tr '[:lower:]' '[:upper:]'` |

### grep + pipefail

```bash
# ❌ grep -c 零匹配时 exit 1 + set -o pipefail → 脚本退出
count=$(grep -c "^## " file.md)

# ✅ 单独变量赋值
count=$(grep -c "^## " file.md 2>/dev/null || true)

# ✅ 管道中用 {} 分组
result=$({ grep -ch "^## " dir/*.md 2>/dev/null || echo "0"; } | awk '{s+=$1}END{print s+0}')
```

### 空数组 + set -u

```bash
# ❌ 空数组迭代触发 unbound variable
for item in "${arr[@]}"; do ... done

# ✅ 长度守卫
if [ ${#arr[@]} -gt 0 ]; then
  for item in "${arr[@]}"; do ... done
fi
```

---

## 三、部署检查清单

每次 install.sh 改动后必须检查：

- [ ] 新增脚本是否在部署循环中（`for script in ...`）
- [ ] 新增 lib/ 文件是否有单独部署逻辑
- [ ] 摘要输出（`已部署文件`）与部署循环一致
- [ ] uninstall.sh 能清理干净
- [ ] `install → verify → uninstall` 全流程跑通

---

## 四、开发流程（标准 SOP 精简版）

```
需求确认
  │
  ├─→ 架构设计（高见远，DeepSeek）
  │     └─→ 输出 system_design.md + 任务列表
  │
  ├─→ 代码实现（寇豆码，DeepSeek）
  │     └─→ 全量代码 + 全局一致性审查（IS_PASS）
  │
  ├─→ QA 测试（严过关，DeepSeek）
  │     ├─→ 语法检查：bash -n 所有 .sh
  │     ├─→ 功能测试：在临时目录中模拟
  │     ├─→ BSD 兼容性：必须在 macOS 原生 bash 3.2 上跑
  │     └─→ 默认关闭验证：新功能不启用时不影响老用户
  │
  ├─→ 主理人全量审查（齐活林，DeepSeek）
  │     ├─→ 逐文件读
  │     ├─→ 部署完整性
  │     ├─→ 铁律合规
  │     └─→ 写审查结论 + 审查 MD
  │
  ├─→ GLM-5.2 终审（仅此一轮）
  │     └─→ 传入审查 prompt（含 diff + 设计决策 + 已知修复）
  │
  └─→ commit + push + tag（DeepSeek）
```

---

## 四-bis、版本交付物（2026-06-20 确立）

每个版本开发完，产出两类互补文档：

| 类型 | 位置 | 格式 | 受众 |
|------|------|------|------|
| **正式版本历史** | `CHANGELOG.md`（根目录） | Keep a Changelog 短条目 | 用 GitHub 看版本差异的用户 |
| **公开开发日志** | `docs/changelog/vX.Y.md` | 单版本详细叙事 | 想了解开发过程 / dogfooding 的读者 |

### 设计原则
- **dogfooding 定调**：开发日志展示 sofagent 开发时也走了多视角审查 + 行业研究驱动 + 策略重构流程
- **不再用一次性 delivery 文件**：旧的 `~/Workbuddy/delivery-vX.Y.md`（做完就删）已废弃
- **README 单入口**：README 树形图 + 收尾段指向 `docs/changelog/`，其他文档（HANDBOOK/DEVELOPMENT/ARCHITECTURE）不加引用——各有受众边界

---

## 五、GLM 终审 prompt 模板

每次版本完成后，用以下结构生成审查 prompt 发给 GLM：

```markdown
你是 [项目名] vX.Y.Z 的第三方代码审查员。

## 做了什么
（3-5 句话）

## 改动清单
| 文件 | 操作 | 行数 | 说明 |
|------|------|------|------|

## 设计决策
1. ...
2. ...

## 已知处理过的边缘情况
- ...
- ...

## 已知问题（如有）
- ...
```

模板的目的：**让 GLM 不花积分在「理解项目」上，直接进入「找问题」阶段。**

---

## 六、跨项目坑位汇总

> 每次版本开发结束，把实际踩的坑补一条。格式：`[项目] vX.Y.Z — 坑描述 — 怎么避`

- [sofagent] v0.7.0 — BSD sed `\s` / `\b` 不兼容 → 用 `[[:space:]]` / `[[:<:]]`
- [sofagent] v0.7.0 — bash 3.2 无 `declare -A` → 用并行普通数组
- [sofagent] v0.7.0 — `grep -c` 零匹配 + pipefail → `|| true` 或 `{ }` 分组
- [sofagent] v0.7.0 — 空数组 + `set -u` → `${#arr[@]} -gt 0` 守卫
- [sofagent] v0.7.0 — install.sh 部署循环漏新脚本 → 每个新脚本加进 for 循环
- [sofagent] v0.7.0 — `||` 运算符优先级断开管道 → `{ cmd || fallback; } | next`
- [sofagent] v0.62 — 文件删除后引用未全修 → Grep 搜文件名本身，不只搜目录名
- [sofagent] v0.60 — `set -euo pipefail` + `ls "$DIR"/*.md` 目录不存在静默退出 → 先 `[ -d "$DIR" ]`
- [sofagent] v0.61 — MD 层面改不动加载链跳步 → 强制力来自外部，不在 MD 里挣扎
