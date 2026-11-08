# 邀请返利提现

2026-11-08 已发布到生产。提现申请和后台审核已上线，真实转账开关继续关闭。资金状态使用独立测试库和模拟支付宝网关验证，未发起真实转账。

## 操作流程

用户登录后，在「邀请返利」查看可提现余额、审核/打款中金额和已到账金额，提交金额、支付宝手机号或邮箱、支付宝实名姓名，并输入商城登录密码确认。单次最低 0.10 元，与单笔转账产品接口下限一致，不超过实际可提现金额。没有提现手续费。申请提交后冻结相应金额，使用独立的申请编号避免网络重试重复扣减。

后台「邀请返利」新增「提现审核与打款」。超级管理员可见；普通管理员需要 `withdrawals.manage`（审核提现与打款）权限，该权限自动包含 `referrals.view`。仅有查看返利权限的管理员不能读取支付宝收款信息或审核提现。

1. **待审核**：可同意或驳回；驳回必须填写原因，金额释放。
2. **审核通过 · 待打款**：后台核对金额、支付宝账号和实名姓名后点击「打款至支付宝」，二次确认后发起转账；打款前也可驳回。
3. **打款处理中**：通过原提现单号查询结果，不得新建转账或重复打款；超时、网络错误、验签失败、返回字段不匹配均保持冻结。
4. **已到账**：只有支付宝验签且原单号、返回金额（如提供）及转账单号核对通过、状态为 `SUCCESS` 才记为已到账。
5. **打款失败**：支付宝明确返回原单 `FAIL` 或 `REFUND` 后释放金额，用户可重新申请并接受审核。接口未受理或结果未知时不会假定失败，需查询原单；持续无法核实的单据应使用原商户后台核对，不提供手工伪造成功入口。

后台每次审核、打款发起、未知结果及确认结果均写入独立审计流水，保留操作人和时间。收款人及金额在申请后不能直接修改，要先驳回再重新申请。用户仅能读取自己的记录，后台列表支持状态过滤和分页。测试和正式环境余额及提现单互相隔离。

余额 = 有效入账返利 − 审核/打款中冻结金额 − 已到账金额。退款导致返利失效后，可提现余额按实际重新计算；若无法覆盖已申请金额，审批与发起打款将被阻止。已在途或已到账的转账不因退款而重复发起或自动追回，对应差额保留为待核对余额，阻止后续透支。

## 支付宝配置

提现调用 `alipay.fund.trans.uni.transfer`，使用 `TRANS_ACCOUNT_NO_PWD` / `DIRECT_TRANSFER`；查单调用 `alipay.fund.trans.common.query`。提现单号直接作为不可变的 `out_biz_no`，不因重试或查单生成新号。转账使用 SDK 的响应验签。首次打款记录应用及商户标识，商户配置变化后拒绝用新商户查询旧单。

现有网页收款配置不代表已经开通支付宝单笔转账权限。实际启用前，需在商户侧开通对应产品并配置适用的已申报转账场景。配置均保留在服务器受保护目录，不写入前端：

- `ALIPAY_TRANSFER_ENABLED=false`：独立转账开关，默认关闭；关闭时仍可申请及审核。
- `ALIPAY_TRANSFER_SCENE_NAME`：商户已申报场景。
- `ALIPAY_TRANSFER_SCENE_REPORT_INFOS`：已申报场景要求的信息 JSON 数组，元素为 `info_type`、`info_content`。启用时必须有效且非空。
- 如果应用要求证书模式，完整填写 `ALIPAY_TRANSFER_APP_CERT_PATH`、`ALIPAY_TRANSFER_ROOT_CERT_PATH`、`ALIPAY_TRANSFER_PUBLIC_CERT_PATH`。转账单独使用证书 SDK，不改变原有网页支付 SDK。
- 应用、商户、私钥及环境沿用对应支付环境配置。必须先配置该环境的支付宝，再单独启用转账。不得在本地使用正式收款配置进行真实转账测试。

支付宝官方 SDK 文档：[单笔转账](https://github.com/alipay/alipay-sdk-java-all/blob/master/v3/docs/AlipayFundTransUniApi.md)、[转账查询](https://github.com/alipay/alipay-sdk-java-all/blob/master/v3/docs/AlipayFundTransCommonApi.md)。

## 接口和数据迁移

- `GET /api/referrals/withdrawals`：登录用户自己的余额及记录。
- `POST /api/referrals/withdrawals`：提交申请，要求 `Idempotency-Key` 以及 `amount`（元字符串）、`account`、`realName`、`password`。
- `GET /api/admin/referrals/withdrawals`：后台列表。
- `POST /api/admin/referrals/withdrawals/:id/approve|reject|pay|query`：同意、驳回、打款、查单；驳回需要 `reason`。

SQLite schema 15 增加 `referral_withdrawals` 和 `referral_withdrawal_events`，原订单及返利记录保留。发布前先备份数据库，再在副本验证迁移。回退需使用兼容 schema 15 的版本，或核对迁移后新增数据再恢复适当备份，不能直接用 schema 14 的旧服务读取新库。
