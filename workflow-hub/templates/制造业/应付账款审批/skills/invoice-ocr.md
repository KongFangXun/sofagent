# 发票 OCR 解析 Skill

## 触发条件

当节点需要从发票图像/PDF 中提取结构化数据时触发。

## 输入

- 发票文件（图像或 PDF）
- 供应商数据库参考

## 输出

```yaml
invoice:
  supplier_name: ""
  invoice_number: ""
  invoice_date: ""
  amount: 0.00
  line_items:
    - description: ""
      quantity: 0
      unit_price: 0.00
      total: 0.00
```

## 适配

1. 替换 OCR 引擎为你的内部服务
2. 调整字段映射以匹配你的发票格式
