# templates/ · 交付物模板（以 sofagent 自身为案例）

> 本目录的文件既是格式参考，也是一份完整的真实案例——
> 填的是 **sofagent 项目自身** 的企业画像、部署方案、节点文档、Skill。
>
> 用户读这些文件，既能学会模板怎么填，又能理解 FDE 12 步流程到底产出什么。
> 一举两得：讲了 FDE 怎么用，又讲了 workflow 怎么梳理、节点怎么搭建。

## 文件清单

| 模板 | 对应步骤 | 谁填 | 用途 |
|------|----------|------|------|
| `enterprise-profile.md` | §3 建档，§4-§12 持续回写 | FDE | 交付手册第一章：企业画像 |
| `deployment-plan.md` | §4-§7 产出 | FDE | 交付手册第二章：部署方案 |
| `nodes/node-template.md` | §7 产出，§8-§10 更新 | FDE | 工作流节点文档（人读 + 编排引擎读） |
| `skills/skill-template/SKILL.md` | §7-§8 定制 | FDE | 工作流节点 Skill 层（AI 读） |

## 为什么填 sofagent 自己

templates/ 不是装到本地的——是给 FDE 读的案例参考。与其留大量空占位符，不如填一份真实的：

1. **用户读模板就理解 FDE 怎么用**——不用再去翻 FDE.md 12 步细节
2. **模板本身就是一个完整交付示例**——用户照着抄就行
3. **解释了 workflow 怎么梳理、节点怎么搭建**——因为 FDE 自己就是例子
4. **sofagent 吃自己的狗粮**——自己的 workflow 先跑通，才好意思给客户部署

## 不在这个目录里的（不用模板）

| 交付物 | 为什么不用模板 |
|--------|---------------|
| `fde.md`（运行规范） | sofagent 安装包自带，在 `SKILL/harness/data/fde.md`，直接复用 |
| `quick-start.md`（上手文档） | sofagent 安装包自带，在 `FDE/quick-start.md`，直接复用 |
| AI 知识库（think.md / task/logs / eval.md / orchestrator/） | AI 节点跑起来后自动积累，模板在 `SKILL/harness/data/` 下 |

> 💡 **这个目录是 FDE 自己读的案例参考，产出不落在这里。** FDE 读 templates/ 填完内容后，产出落到用户项目根目录的企业名文件夹（如 `{企业名}/`），详见 [FDE.md §9 交接清单](../FDE.md#9-交接清单)。用户打开 Finder 就能看到。

## 交付物分两类

### 一、交付手册（一份文档）

FDE 离场前打包给企业的文档，只含 4 章：

| 章节 | 模板 | 备注 |
|------|------|------|
| 企业画像 | `enterprise-profile.md` | FDE 写 |
| 部署方案 | `deployment-plan.md` | FDE 写 |
| 运行规范 | `fde.md` | 安装包自带 |
| 上手文档 | `quick-start.md` | 安装包自带 |

### 二、AI 节点（三层实体，独立于交付手册）

每个 🔄/⚡ 节点有三层实实在在的实体，每层有对应模板：

| 层 | 形式 | 给谁读 | 模板 |
|----|------|--------|------|
| 📄 文档层 | `nodes/[节点名].md` | **人读 + 编排引擎读** | `nodes/node-template.md` |
| 🧠 Skill 层 | `skills/[节点名]/SKILL.md` | **AI 读** | `skills/skill-template/SKILL.md` |
| 🔴 运行层 | 设备上的 session | **活的** | 文档里 checklist 确认 |

> 为什么没有 .yaml 配置层？
> sofagent-orchestrator compose 接受自然语言输入，不读 .yaml 配置文件。节点文档（.md）同时服务两个消费者——
> 企业方人读（看懂这个节点是什么）+ 编排引擎读（Agent 把文档注入给 sofagent-orchestrator compose 拆任务）。
> 配置信息用表格写在 .md 里就够了，不需要单独一个没人读的 .yaml。

## install.sh --base-only 不装这个目录

templates/ 是给 FDE 读的案例参考，**不是装到客户设备上的**。客户设备上跑的是：
- `{企业名}/nodes/`（基于模板填出来的实际节点文档）
- `{企业名}/skills/`（基于模板填出来的实际企业 Skill）

install.sh --base-only 只装运行时必需的：sofagent 底座 + fde.md。FDE §9 交接清单填完后，产出落盘到用户项目根目录的企业名文件夹。
