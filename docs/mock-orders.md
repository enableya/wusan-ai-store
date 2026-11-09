# 本地模拟订单与回归测试

预览：`npm run dev:orders:mock`，打开 `http://127.0.0.1:5230/orders`。

这个独立预览进程使用 27 条内存订单，模拟一个有免付开通权限的账号。付款与充值关闭；所有 `/api/` 请求都由模拟处理器响应，不连接商城数据库或支付宝。点击取消可以演示未付款取消或已付款退款待审核，重启命令恢复初始数据。它不改变正常的 `127.0.0.1:5180` 开发站点，不添加正式产品中的模拟入口；模拟脚本及数据不打入生产发布包。

数据定义：`tests/fixtures/orders.ts`；响应与状态转换：`tests/mocks/orders.ts`；页面回归：`tests/e2e/orders.spec.ts`。

| 场景 | 数据键 |
| --- | --- |
| 待付款、已关闭、待充值、账号验证中 | `pending`、`closed`、`awaiting_recharge`、`validating` |
| 排队、处理中、已办理等待结算 | `queued`、`processing`、`settling` |
| 成功有邮箱、成功缺历史邮箱 | `success`、`success_missing_email` |
| 未扣款、上游取消但结算未知、核对中、人工确认 | `no_charge`、`upstream_cancelled_uncertain`、`reconciling`、`manual_review` |
| 续费已设置、续费待处理、续费扣款成功 | `renewal_ready`、`renewal_attention`、`renewal_paid` |
| 上游未知状态、历史订单无充值状态 | `unknown`、`legacy_unknown` |
| 免付待充值、免付充值成功 | `staff_awaiting`、`staff_success` |
| 取消核实、退款待审核、驳回、退款处理中、已退款、未付款取消 | `cancellation_checking`、`refund_review`、`refund_rejected`、`refund_pending`、`refunded`、`cancelled_unpaid` |
| 支付核验不可用 | `verification_disabled` |

初始数量：全部 27、待付款 2、已付款 17、已关闭 1、订单已取消 5、免付开通 2。免付开通不会重复计入已付款。

执行回归：`npm run test:orders`。脚本自动创建临时数据库，使用隔离的 `127.0.0.1:5220`/`5222` 服务，退出后清理临时库；这些端口已被占用时退出报错，不复用其他进程。页面的全部 API 都被 mock 拦截，测试不会发起真实付款、充值或退款。

用例覆盖手机/桌面状态文案与颜色、邮箱有值/缺失、免付与已付款分组、所有标签数量及零数量隐藏、切换筛选与订单号/商品搜索、刷新/空列表/读取失败重试、列表和详情取消的二次确认与结果同步、重复取消、取消失败和过期确认、普通账号隐藏免付订单、本机草稿不计入真实订单数量。测试截图位于 `artifacts/orders-mock-matrix-390.png` 和 `artifacts/orders-mock-matrix-1440.png`。

模拟测试验证页面行为；后端交易核验、权限及真实数据库状态约束继续由 `npm run test:api` 的隔离数据库测试验证。
