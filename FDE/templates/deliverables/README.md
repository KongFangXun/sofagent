# FDE 交付物模板（三层交付 · 引擎五渲染骨架）

> 模板外置（v1.4.4 第七章·九）：本目录三个模板是引擎五 `distillDeliverables` 的渲染骨架——FDE 现场改模板即可定制交付物样式，无需走包发版。

## 一、模板清单

| 模板 | 渲染产物 | 用途 |
|------|---------|------|
| `node-manual.md` | `<nodeId>-manual.md` | 文档层——节点交付手册（人读） |
| `node-skill.md` | `<nodeId>-skill.md` | Skill 层——Agent 可执行的作业指导 |
| `node-node.yaml` | `<nodeId>-node.yaml` | 运行层——workflow 节点片段（引擎六组装用） |

## 二、占位符约定

模板用 `{{key}}` 占位，渲染时按节点访谈数据（五要素 + 判定标签）注入：

| 占位符 | 数据来源 |
|--------|---------|
| `{{nodeId}}` / `{{description}}` | 节点标识与描述 |
| `{{input}}` / `{{output}}` / `{{owner}}` / `{{duration}}` / `{{bottleneck}}` | 五要素 |
| `{{tag}}` / `{{tagLabel}}` | 自动化标签（auto/enhance/none）与中文展示 |
| `{{sixSteps}}` | 六步作业分解（引擎按五要素生成，多行文本） |

## 三、渲染规则（fail-closed）

- 模板缺失 / 占位符渲染后残留 → 回退内置默认骨架（引擎行为不变，交付不中断）
- 模板文件名与占位符键名是稳定契约——定制时保留全部占位符，多余内容随意加
- 模板查找链：`SOFAGENT_REPO_ROOT/FDE/templates/deliverables/` → `cwd/FDE/templates/deliverables/` → 包相对路径——三级全 miss 才回退内置
