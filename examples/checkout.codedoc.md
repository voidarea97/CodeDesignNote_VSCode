# 结算设计

```codedoc
{
  "title": "金额以分计算",
  "target": { "file": "examples/checkout.js", "start": 5, "end": 7 },
  "related": [
    { "file": "examples/discount.js", "start": 3, "end": 5, "label": "折扣规则" }
  ]
}
```

报价接口用**整数分**返回原价、折扣额和实付金额，避免浮点数舍入影响金额比较。

- `subtotalInCents` 是折扣前的金额。
- `total` 保留为分，由调用方负责显示货币格式。

```codedoc
{
  "title": "折扣门槛",
  "target": { "file": "examples/discount.js", "start": 3, "end": 5 },
  "related": [
    { "file": "examples/checkout.js", "start": 6, "label": "应用折扣的调用处" }
  ]
}
```

订单小计达到 100 元时减 10 元。门槛比较包含 100 元整。
