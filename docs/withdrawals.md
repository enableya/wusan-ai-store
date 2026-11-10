# 邀请返利提现

2026-11-09 本地改为人工打款流程，尚未发布。以下新流程须随本次版本发布后才会在线上生效。2026-11-08 上线版本仍为提现申请、后台审核及默认关闭的接口转账。

## 操作流程

用户登录后，在「邀请返利」查看可提现余额、审核/打款中金额和已到账金额，提交金额、支付宝手机号或邮箱、支付宝实名姓名，并输入商城登录密码确认。单次最低 0.10 元，与单笔转账产品接口下限一致，不超过实际可提现金额。没有提现手续费。申请提交后冻结相应金额，使用独立的申请编号避免网络重试重复扣减。

后台「邀请返利」新增「提现审核与打款」。超级管理员可见；普通管理员需要 `withdrawals.manage`（审核提现与打款）权限，该权限自动包含 `referrals.view`。仅有查看返利权限的管理员不能读取支付宝收款信息或审核提现。

1. **待审核**：可同意或驳回；驳回必须填写原因，金额释放。
2. **审核通过 · 待打款**：点击「领取人工打款」登记经办人，余额仍冻结，网站不发起转账。领取前可驳回。
3. **人工打款处理中**：经办人在支付宝中核对账号、实名姓名及金额并手动完成转账。仅领取人能登记完成或退回，其他管理员不能再次领取。结果未知时保持冻结，不得重复转账。
4. **登记已打款**：经办人核实支付宝显示成功后，填写实际交易号（16–64 位数字）、实际金额、转账时间，上传不超过 512 KB 的 PNG/JPG 成功凭证，并勾选核实确认。金额必须一致，时间不得早于申请或晚于当前时间，交易号不能被其他提现单使用。完成后显示「已到账 · 人工核实打款」。这是管理员凭证登记，不是支付宝接口自动验真。
5. **退回待打款**：仅在未转账或已明确失败时，由经办人填写原因并确认无成功转账后退回，金额仍冻结。之后可重新领取或驳回；处理中不能直接驳回，结果未知不得退回，不会因超时自动解锁。

凭证存储在服务端数据库，通过受保护的后台图片接口读取，不放在静态目录，仅提现管理员可查看。用户可查看自己的金额、交易号、时间及人工核实状态，但不能读取后台凭证和经办记录。重复提交同一登记不重复扣款，完成记录不可覆盖修改。

后台每次审核、人工领取、退回、完成登记及历史接口核对均写入审计流水，保留操作人和时间。收款人和金额在申请后不可修改，需先驳回再申请。测试和正式环境互相隔离。

余额 = 有效返利 − 冻结金额 − 已到账金额。退款造成余额不足时，审批和领取被阻止。领取后实际转账前应刷新核对余额及退款情况。若转账已成功，之后返利失效不应阻止如实登记，对应差额继续作为待核对余额，阻止后续透支。

若经办人账号被删除或无法登录，应先核对支付宝原始记录，再由受信任的服务器维护人员处理归属；不能为重新领取而直接清除处理中状态。

## 历史接口打款

人工流程不依赖单笔转账产品或 `ALIPAY_TRANSFER_ENABLED`。新申请为 `manual` 模式，旧发起接口打款请求一律拒绝，即使网关已启用也不会新发起接口转账。

历史 `processing` 且为 `api` 的记录仅保留 `alipay.fund.trans.common.query` 原单查询，不允许转为人工打款，避免重复转账。查询继续按原商户、原单号、金额及 SDK 响应验签核对；未知结果保持冻结，明确成功或失败后才结算或释放。

历史查询仍依赖原环境的应用、商户及受保护密钥配置。网关开关默认 `ALIPAY_TRANSFER_ENABLED=false`；历史接口在途单需要查单时，使用原商户有效场景 `ALIPAY_TRANSFER_SCENE_NAME`、`ALIPAY_TRANSFER_SCENE_REPORT_INFOS`，证书模式时同时提供 `ALIPAY_TRANSFER_APP_CERT_PATH`、`ALIPAY_TRANSFER_ROOT_CERT_PATH`、`ALIPAY_TRANSFER_PUBLIC_CERT_PATH`。不得在本地使用生产配置进行转账测试。

## 接口和数据迁移

- `GET /api/referrals/withdrawals`：登录用户自己的余额及记录。
- `POST /api/referrals/withdrawals`：提交申请，要求 `Idempotency-Key` 以及 `amount`（元字符串）、`account`、`realName`、`password`。
- `GET /api/admin/referrals/withdrawals`：后台列表。
- `POST /api/admin/referrals/withdrawals/:id/approve|reject|query`：同意、驳回及历史接口查单，驳回需要 `reason`；旧 `pay` 接口已停用。
- `POST /api/admin/referrals/withdrawals/:id/manual-start`：领取人工打款，不转账。
- `POST /api/admin/referrals/withdrawals/:id/manual-complete`：`transferNo`、`paidAt`（UTC ISO 时间）、`amount`（元字符串）、`receipt`（PNG/JPG base64 data URL）、`confirmed:true`。仅该接口的请求上限放宽至 720000 字节。
- `POST /api/admin/referrals/withdrawals/:id/manual-release`：`reason`、`confirmed:true`，确认没有成功转账后退回。
- `GET|HEAD /api/admin/referrals/withdrawals/:id/receipt`：仅提现管理员可读，禁止缓存，凭证不暴露为静态文件。

SQLite schema 20 新增 `payout_method`（历史默认 `api`）及 `referral_manual_payouts`，保存经办、登记信息和凭证。原记录不变，备份需包含凭证表。发布前备份并在副本验证迁移；旧 schema 19 服务不能直接打开 schema 20 库。生产产生新数据后不得直接覆盖旧快照丢弃新增业务，须保全数据并使用兼容版本回退。

本机原生 esbuild 被文件保护拦截时，先执行 `npm run build`，再设置 `E2E_PREVIEW=true` 运行 `npm run test:admin:e2e`，浏览器回归使用同一隔离数据库和本地端口检查构建产物。
