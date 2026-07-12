# Work模板市场 模板格式规范

## workflow.yml Schema

```yaml
# 模板元信息
meta:
  name: "模板名称"          # 必填
  industry: "行业"           # 必填
  version: "1.0"            # 必填，semver
  description: "描述"       # 必填
  author: "作者"            # 可选
  tags: ["标签1", "标签2"]  # 可选

# 工作流节点
nodes:
  - id: "node-1"            # 必填，唯一
    name: "节点名称"        # 必填
    description: "节点描述" # 可选
    prompt: "节点 prompt"   # 必填
    actions:                # 可选，声明的允许操作
      - "action_name"
    knowledgeDomain:        # 可选，知识库访问域
      include:
        - "domain/path"
      exclude:
        - "restricted/path"
    constraints:            # 可选，约束条件
      maxRetries: 3
      timeout: 300
    nextNodes:              # 可选，下游节点
      - "node-2"

# 全局配置
config:
  loopCheckMaxRounds: 20
  carefulModifyThreshold: 0.2
```

## 必备文件

每个模板目录必须包含：

| 文件 | 说明 |
|------|------|
| `workflow.yml` | 工作流定义（必填） |
| `README.md` | 适配指南（必填） |
| `skills/` | Skill 定义（可选） |
| `knowledge/` | 知识库初始数据（可选） |
| `subagents/` | Sub Agent 定义（可选） |

## 命名规范

- 模板路径：`行业/场景名称/`（中文或英文均可）
- 行业不含特殊字符（`/` 除外，作为层级分隔符）
- 场景名称不含空格，用连字符分隔

## 校验

```bash
bash tools/validate.sh templates/制造业/应付账款审批/
```
