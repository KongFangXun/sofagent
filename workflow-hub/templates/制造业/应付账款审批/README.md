# 应付账款审批 · 适配指南

## 适配步骤

### 1. 改供应商列表

编辑 `knowledge/supplier-whitelist.yml`，将示例供应商替换为你公司的实际供应商：

```yaml
suppliers:
  - name: "你的供应商A"
    tax_id: "91110000XXXXXXXX"
    payment_terms: "net_30"
  - name: "你的供应商B"
    tax_id: "91110000XXXXXXXX"
    payment_terms: "net_60"
```

### 2. 改审批人列表

编辑 `knowledge/approver-list.yml`，替换审批人姓名和联系方式：

```yaml
approvers:
  dept_manager:
    name: "张三"
    email: "zhangsan@yourcompany.com"
  finance_director:
    name: "李四"
    email: "lisi@yourcompany.com"
```

### 3. 改审批阈值

在 `workflow.yml` 中修改 `approval-route` 节点的金额阈值：

```yaml
# 示例：调整为适合你公司的阈值
- 金额 < 50,000：自动审批
- 金额 50,000 - 500,000：部门经理审批
- 金额 > 500,000：财务总监审批
```

### 4. 改付款账户

编辑 `knowledge/payment-accounts.yml`：

```yaml
accounts:
  - bank: "你的银行"
    account: "6222XXXXXXXXXXXX"
    currency: "CNY"
```

## 部署

```bash
sofagent hub deploy 制造业/应付账款审批
```

## 节点说明

| 节点 | 职责 | 行动 |
|------|------|------|
| 发票接收 | OCR 解析发票 | `scan_invoice`, `validate_format` |
| 三单匹配 | 比对 PO/入库单/发票 | `three_way_match`, `flag_discrepancy` |
| 审批路由 | 按金额路由审批 | `approve`, `reject`, `escalate`, `notify_approver` |
| 付款执行 | 执行付款 | `execute_payment`, `record_payment`, `update_balance` |
