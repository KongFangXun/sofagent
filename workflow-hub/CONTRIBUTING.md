# 贡献指南

## 如何贡献模板

### 1. Fork 本仓库

```bash
git clone https://github.com/KongFangXun/sofagent-work模板市场.git
cd sofagent-work模板市场
```

### 2. 创建模板目录

```bash
mkdir -p templates/行业/场景名称/{skills,knowledge,subagents}
```

### 3. 编写模板文件

至少需要 `workflow.yml` 和 `README.md`。参见 [SPEC.md](./SPEC.md) 格式规范。

### 4. 本地校验

```bash
bash tools/validate.sh templates/行业/场景名称/
```

### 5. 提交 PR

- PR 标题格式：`[模板] 行业/场景名称`
- PR 描述中说明模板用途和适用场景
- 确保校验通过

## 模板质量标准

- [ ] workflow.yml 格式正确，通过 validate.sh
- [ ] README.md 包含适配指南（改什么字段、注意什么）
- [ ] 节点数合理（建议 3-8 个）
- [ ] 每个节点有清晰的 actions 声明
- [ ] 无硬编码敏感信息（密钥、内部 URL 等）

## 许可证

所有贡献的模板默认采用 MIT 许可证（与本仓库一致）。
