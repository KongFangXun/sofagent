# Work模板市场 模板目录

> sofagent-work模板市场——社区驱动的行业工作流模板仓库。
> 主项目通过 git submodule 关联：`git submodule add https://github.com/KongFangXun/sofagent-work模板市场 .sofagent/workflows/hub`

| 行业 | 模板 | 描述 | 节点数 | 版本 |
|------|------|------|:--:|:--:|
| 制造业 | [应付账款审批](./templates/制造业/应付账款审批/) | 供应商发票 → 三单匹配 → 审批 → 付款 | 4 | v1.0 |

## 使用方式

### 浏览模板

```bash
sofagent hub list
```

### 部署模板

```bash
sofagent hub deploy 制造业/应付账款审批
```

### 提交模板

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 模板格式

所有模板遵循 [SPEC.md](./SPEC.md) 定义的格式规范。
