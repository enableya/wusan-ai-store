# LoveCodex 卡密兑换对接 API 文档

适用于第三方系统对接 **https://lovecodex.cn/** 的公开兑换功能：卡密验证、Session 校验、充值提交、卡密查询、进度查询和换卡。

文档日期：2026-10-11。接口按当前已上线版本整理。

本文只介绍客户侧公开接口，不包含管理接口、内部支付接口、服务器配置或私有凭据。所有卡密、邮箱、订单号及凭证示例均为虚构占位值，不能用于实际兑换。

---

## 一、通用约定

| 项目 | 说明 |
|---|---|
| 站点 | `https://lovecodex.cn` |
| Base URL | `https://lovecodex.cn/api` |
| 请求体 | JSON，使用 `Content-Type: application/json` |
| 字符编码 | UTF-8 |
| HTTP 方法 | 以各接口声明为准；Session 上传是 **PUT** |
| 对接方式 | 推荐调用方后端请求本站；不要假设本站允许任意第三方网页直接跨域请求 |
| 全局 API Key | 本文接口不需要后台 Token 或全局 API Key |
| 业务凭证 | 兑换会话需要 `redemptionToken`；本站订单号查询通常需要 `claimToken` |

### 1. 响应格式

本站响应字段通常位于顶层，**不是统一包在 `data` 中**。

成功示例：

```json
{
  "ok": true,
  "order": {}
}
```

失败示例：

```json
{
  "ok": false,
  "error": "VOUCHER_REQUIRED",
  "detail": "请输入完整卡密。"
}
```

失败业务码可能在 `error` 或 `code` 中；说明可能在 `detail`、`message` 中。建议按下列顺序读取：

```javascript
const code = body.error || body.code || "REQUEST_FAILED";
const message = body.detail || body.message || "请求未完成，请稍后查询。";
```

同时检查 HTTP 状态与 `ok`。HTTP 200 或 `ok: true` 只代表本次接口调用成功，**不代表充值成功**。

### 2. 三种凭证不要混用

| 名称 | 来源 | 用途 |
|---|---|---|
| 完整卡密 `voucherCode` | 用户持有 | 验证卡密、按卡密查询、换卡 |
| `redemptionToken` | 创建兑换会话返回 | 上传 Session 和提交该兑换会话 |
| `claimToken` | 首次提交订单返回；部分通道查询也可能返回 | 读取对应订单进度 |

`redemptionId`、`orderNo` 和以上凭证都应视为不透明字符串：原样保存和使用，不依赖前缀、长度或内部结构选择套餐。

### 3. Session 格式

统一建议只提交 **完整 ChatGPT Session JSON 字符串**，包含账号邮箱和有效 `accessToken`。

获取方式：用户登录 ChatGPT 后访问 `https://chatgpt.com/api/auth/session`，复制完整 JSON。

不要提交只有邮箱的对象、截断 JSON、网页 HTML、单独密码，或把完整 Session 当成 URL 参数。为兼容所有通道，不使用单独的 accessToken 或 Session Cookie 代替完整 JSON。

---

## 二、推荐接入流程

```text
GET  /api/bootstrap
  → 取得当前 terms / privacy 版本

POST /api/v2/redemptions/prepare
  → 验证完整卡密，取得 redemptionId、redemptionToken、商品信息

PUT  /api/v2/redemptions/{redemptionId}/session
  → 上传完整 Session，等待 SESSION_READY

POST /api/v2/redemptions/{redemptionId}/submit
  → 携带 Idempotency-Key 和条款版本，保存 orderNo、claimToken

POST /api/v2/status/by-order
  → 查询订单处理结果

其他入口：
POST /api/v2/status/by-voucher   按完整卡密查询
POST /api/v2/status/by-vouchers  批量卡密查询，最多 200 张
POST /api/v2/vouchers/exchange  一次性换卡
```

本站按卡密自动选择对应商品及可用通道。只有本站明确不存在的卡密才可能进入已接入的合作通道；调用方不需要直接请求合作方接口，也不能用商品名称覆盖卡密本身的套餐。

---

## 三、初始化与商品信息

### GET `/api/bootstrap`

读取公开商品列表及提交时必须携带的条款版本。

无需请求体。

响应示例（节选）：

```json
{
  "ok": true,
  "products": [
    {
      "id": "chatgpt-plus",
      "name": "ChatGPT Plus",
      "active": true
    }
  ],
  "policyVersions": {
    "terms": "2026-08-28",
    "privacy": "2026-08-28"
  }
}
```

示例中的日期仅用于说明格式。**实际提交必须使用本次初始化返回的版本，不要永久写死。** 对接页面应向用户展示相应条款与 Session 处理告知。

如只需要商品列表，可调用 `GET /api/products`，响应为 `{ "ok": true, "products": [...] }`。卡密对应的实际商品仍以验证接口返回值为准。

---

## 四、验证卡密并创建兑换会话

### POST `/api/v2/redemptions/prepare`

请求字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `voucherCode` | string | 是 | 完整卡密；建议不超过 160 字符 |

```json
{
  "voucherCode": "DEMO-AAAA-BBBB-CCCC-DDDD"
}
```

成功响应 HTTP 200 或 201：

```json
{
  "ok": true,
  "redemptionId": "<REDEMPTION_ID>",
  "redemptionToken": "<REDEMPTION_TOKEN>",
  "product": {
    "id": "chatgpt-plus",
    "name": "ChatGPT Plus"
  },
  "voucher": {
    "codePreview": "DEMO-…DDDD",
    "state": "AVAILABLE"
  },
  "expiresAt": "2026-10-11T06:30:00.000Z"
}
```

- 保存 `redemptionId` 和 `redemptionToken`，后续两个步骤需要使用。
- 会话有效期以 `expiresAt` 为准；重复验证可能使合作通道的旧会话凭证失效，不应在同一流程里反复调用。
- `externalRelay: true`（可选）表示合作通道。对接页面应在发送 Session 前告知用户将通过合作服务完成处理。
- 已使用、禁用、处理中或不可用卡密可能被拒绝；查看历史结果应使用“按卡密查询”，不要反复创建兑换会话。

常见业务码：`VOUCHER_REQUIRED`、`VOUCHER_NOT_FOUND`、`VOUCHER_USED`、`VOUCHER_DISABLED`、`VOUCHER_IN_USE`、`PRODUCT_UNAVAILABLE`。合作通道还可能返回 `PORTAL_*` 类错误，以实际说明为准。

---

## 五、上传并校验 Session

### PUT `/api/v2/redemptions/{redemptionId}/session`

请求头：

```http
Content-Type: application/json
X-Redemption-Token: <REDEMPTION_TOKEN>
```

请求字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionInput` | string | 是 | 完整 Session JSON 的字符串形式 |

```json
{
  "sessionInput": "{\"user\":{\"email\":\"user@example.invalid\"},\"accessToken\":\"<VALID_ACCESS_TOKEN>\",\"expires\":\"<SESSION_EXPIRY>\"}"
}
```

上例不是可执行 Session。实际调用应将用户取得的完整对象序列化为字符串，不删减其字段，不使用 `"..."` 代替内容。建议上限为 512,000 字节。

成功响应示例（节选）：

```json
{
  "ok": true,
  "redemption": {
    "redemptionId": "<REDEMPTION_ID>",
    "state": "SESSION_READY",
    "product": {
      "id": "chatgpt-plus",
      "name": "ChatGPT Plus"
    },
    "session": {
      "accountDisplay": "user@example.invalid",
      "accountHint": "user@example.invalid",
      "planType": "free",
      "validation": "local_only"
    },
    "expiresAt": "2026-10-11T06:30:00.000Z"
  }
}
```

| 返回字段 | 含义 |
|---|---|
| `redemption.state` | `SESSION_READY` 表示允许继续提交；不是付款成功 |
| `session.accountDisplay` | 本次校验返回的账号显示信息，可选 |
| `session.planType` | 识别到的当前套餐；与目标商品不同 |
| `session.validation` | `local_only` 表示本地格式检查，`confirmed` 表示该通道已完成相应预检；不应据此显示已充值 |
| `redemption.expiresAt` | 本次返回的有效期；合作预检可能只有约 180 秒，应及时提交 |

校验完成后建议清空输入框中的原 Session。若预检过期，重新上传有效 Session；不要跳过预检直接重复充值。

常见业务码：`SESSION_REQUIRED`、`SESSION_INVALID`、`SESSION_EXPIRED`、`SESSION_PLAN_UNCONFIRMED`、`REDEMPTION_NOT_FOUND`、`REDEMPTION_EXPIRED`、`REDEMPTION_STATE_INVALID`，以及合作通道的 `PORTAL_SESSION_INVALID`、`PORTAL_PRECHECK_FAILED`。

---

## 六、提交充值

### POST `/api/v2/redemptions/{redemptionId}/submit`

请求头：

```http
Content-Type: application/json
X-Redemption-Token: <REDEMPTION_TOKEN>
Idempotency-Key: demo-submit-0001
```

`Idempotency-Key` 为 8–160 位字符串，只允许英文字母、数字、下划线、点、冒号和连字符。建议每次新的业务提交使用随机 UUID，并在调用方持久保存。

**同一次提交的网络重试必须复用相同的兑换会话、凭证及幂等键。不能因为超时就换一个幂等键再提交。**

请求体：

```json
{
  "termsVersion": "2026-08-28",
  "privacyVersion": "2026-08-28"
}
```

成功受理示例，HTTP 200 或 201：

```json
{
  "ok": true,
  "replayed": false,
  "claimToken": "<ORDER_CLAIM_TOKEN>",
  "order": {
    "orderNo": "<ORDER_NO>",
    "orderState": "QUEUED",
    "progress": 0,
    "product": {
      "id": "chatgpt-plus",
      "name": "ChatGPT Plus"
    },
    "settlement": {
      "state": "UNKNOWN",
      "reconcileState": "pending"
    }
  }
}
```

- `replayed: true` 表示返回已有提交结果；该字段在部分通道中可能省略。
- 保存 `order.orderNo` 和 `claimToken`。本地订单的 `claimToken` 不保证在重放时再次返回。
- 如果响应中断或未取得查询凭证，用完整卡密查询原结果；不要自动创建第二笔订单。
- 合作通道可能返回 `MANUAL_REVIEW / UNKNOWN` 表示提交结果仍待确认，此时也是查询原结果，不是重新充值。

常见业务码：`IDEMPOTENCY_KEY_REQUIRED`、`POLICY_VERSION_REQUIRED`、`REDEMPTION_ALREADY_SUBMITTED`、`SESSION_REQUIRED`、`DEPLOYMENT_DRAINING`、`PORTAL_PRECHECK_EXPIRED`、`PORTAL_REDEEM_REJECTED`。通道和账号资格还可能产生其他业务拒绝码，调用方应兼容未知错误码并展示可读说明。

---

## 七、按完整卡密查询

### POST `/api/v2/status/by-voucher`

无需兑换会话凭证。完整卡密本身是查询依据，只向卡密持有人展示结果。

```json
{
  "voucherCode": "DEMO-AAAA-BBBB-CCCC-DDDD"
}
```

成功响应示例：

```json
{
  "ok": true,
  "voucher": {
    "codePreview": "DEMO-…DDDD",
    "state": "CONSUMED",
    "exchangeEligible": false,
    "product": {
      "id": "chatgpt-plus",
      "name": "ChatGPT Plus"
    }
  },
  "order": {
    "orderNo": "<ORDER_NO>",
    "orderState": "FULFILLED",
    "progress": 100,
    "accountEmail": "user@example.invalid",
    "settlement": {
      "state": "PAID",
      "reconcileState": "matched"
    }
  }
}
```

- 未产生订单时，`order` 可能为 `null` 或不返回。
- `accountEmail` 在有可靠记录时可能是完整邮箱；字段可能缺失，不应自行猜测或补全。
- `exchangeEligible` 用于展示换卡入口，最终能否换卡仍以换卡接口当次校验为准。
- 部分通道额外返回 `claimToken` 和 `externalRelay`；若返回查询凭证，应与订单号一起保存。
- 已使用卡密仍可以查询，不要将 `CONSUMED` 当作查询请求失败。

### POST `/api/v2/status/by-vouchers`（可选：批量查询）

```json
{
  "voucherCodes": [
    "DEMO-AAAA-BBBB-CCCC-DDDD",
    "DEMO-EEEE-FFFF-GGGG-HHHH"
  ]
}
```

最多 200 张；每项为非空字符串，长度不超过 160。服务端会去除卡密空白、转大写并去重，保持首次出现顺序。

```json
{
  "ok": true,
  "results": [
    {
      "index": 0,
      "ok": true,
      "voucher": {
        "state": "AVAILABLE",
        "exchangeEligible": true,
        "product": { "id": "chatgpt-plus", "name": "ChatGPT Plus" }
      },
      "order": null
    },
    {
      "index": 1,
      "ok": false,
      "code": "VOUCHER_NOT_FOUND",
      "detail": "卡密不存在，请核对后重试。"
    }
  ]
}
```

`index` 对应**规范化并去重后的输入数组**。请先在调用端采用相同规则去重。某张失败不会代表整批失败，每一项都应分别检查 `ok`；失败说明也可能使用 `message`。

大量合作通道卡密建议每批 1–3 张、逐批查询，以降低上游限流和网关超时风险。`localOnly: true` 可选，用于只查本站登记数据；默认不传时按可用通道自动查询。

---

## 八、查询订单进度

### POST `/api/v2/status/by-order`

推荐请求：

```json
{
  "orderNo": "<ORDER_NO>",
  "claimToken": "<ORDER_CLAIM_TOKEN>"
}
```

也可将查询凭证放入 `X-Order-Claim-Token` 请求头，不要放进 URL。

响应：

```json
{
  "ok": true,
  "order": {
    "orderNo": "<ORDER_NO>",
    "orderState": "FULFILLING",
    "progress": 60,
    "accountEmail": "user@example.invalid",
    "product": {
      "id": "chatgpt-plus",
      "name": "ChatGPT Plus"
    },
    "settlement": {
      "state": "UNKNOWN",
      "reconcileState": "pending"
    }
  }
}
```

常见附加字段：

| 字段 | 说明 |
|---|---|
| `failure.code` / `failure.message` | 失败原因代码和中文说明，可选 |
| `paymentLastError` | 可显示的处理说明，可选 |
| `relayMessage` | 合作通道的处理结果说明，可选 |
| `automation.state` / `automation.message` | 自动处理是否已结束及说明，可选 |
| `timeline` | 可显示的步骤或事件列表，可选 |
| `createdAt` / `updatedAt` / `completedAt` | 创建、更新、完成时间，可能为空 |
| `renewalSetup` | 提前续费设置的独立状态，见下文 |

缺少查询凭证时，应改用完整卡密查询。本地订单号以及本站生成的合作订单引用通常不能仅凭订单号查看详情。当前接入的部分合作通道支持直接查询其原始订单号，这是该通道的例外，不适用于所有订单；如返回 `claimToken`，后续使用返回的订单号与凭证。

**查询频率建议：**优先每 5 秒一次；收到 429 后按 `Retry-After`（若有）退避，否则指数退避。达到约 10 分钟后暂停自动轮询，提示用户稍后手动查询。不要在查询循环中再次调用提交或换卡。

### 可选：本站订单状态推送

`POST /api/v2/status/stream`，请求体同 `by-order`。成功响应是 `text/event-stream`，`data:` 内容包含订单状态；使用支持 POST 流式读取的客户端，而不是只能 GET 的原生 `EventSource`。

该接口用于本站订单；`externalRelay: true` 的合作订单使用 `by-order` 查询。推送断线不代表充值失败，只恢复状态查询，不重新提交充值。

---

## 九、状态判断规则

### 卡密状态 `voucher.state`

| 值 | 含义 |
|---|---|
| `AVAILABLE` | 当前可用 |
| `RESERVED` | 已占用或处理中，应查询进度 |
| `CONSUMED` | 已使用；也可能用于已完成的续费设置 |
| `DISABLED` | 已禁用或旧卡已作废 |
| `EXPIRED` | 已失效 |

### 订单状态 `order.orderState`

| 值 | 建议显示 |
|---|---|
| `SESSION_REQUIRED` | 等待账号信息 |
| `QUEUED` | 已受理，排队中 |
| `FULFILLING` | 处理中 |
| `RECONCILE_ONLY` / `MANUAL_REVIEW` | 结果核对中／待人工确认 |
| `FULFILLED` | 办理已完成；结合结算和续费状态展示 |
| `NO_CHARGE` | 本次未完成且已确认未扣款；卡密能否重用以卡密查询为准 |
| `CANCELED` | 已取消或该通道本次处理已结束，不单凭此值推断未扣款 |

### 结算状态 `order.settlement.state`

| 值 | 含义及处理 |
|---|---|
| `PAID` | 已确认充值付款成功，可回显成功 |
| `NO_CHARGE` | 已确认本次未扣款；查看失败原因及卡密是否恢复 |
| `UNKNOWN` | 付款结果尚未确认；不重复提交，不自动换卡 |

不要仅凭 HTTP 200、`ok: true`、进度 100%、卡密已使用或“请求受理”显示充值成功。优先处理 `PAID`，并区分下面的提前续费状态。

### 提前续费的显示

如果存在 `renewalSetup`，不要把“设置成功”与“本期实际扣款”混为一谈：

| `renewalSetup.state` | 建议显示 |
|---|---|
| `ready` | 续费设置成功，等待下个续费周期扣款；显示返回的 `message` |
| `paid` | 续费扣款成功 |
| `attention` | 续费设置需要处理，联系售后 |

`ready` 时可能仍是 `settlement.state = UNKNOWN`，这是等待未来账期的业务状态，不应重复购买充值。若 `automation.state = FAILED`，显示其失败说明；若同时表示原付款仍待确认，仍只查询原结果。

---

## 十、更换新卡密

### POST `/api/v2/vouchers/exchange`

```json
{
  "voucherCode": "DEMO-AAAA-BBBB-CCCC-DDDD"
}
```

成功响应 HTTP 200 或 201：

```json
{
  "ok": true,
  "replayed": false,
  "oldVoucher": {
    "codePreview": "DEMO-…DDDD",
    "state": "DISABLED"
  },
  "replacement": {
    "voucherCode": "DEMO-NEW-AAAA-BBBB-CCCC",
    "state": "AVAILABLE",
    "productId": "chatgpt-plus"
  },
  "exchangedAt": "2026-10-11T06:00:00.000Z"
}
```

- 返回的新卡密在 `replacement.voucherCode`，应立即提供复制及保存功能。
- 换卡成功后旧卡作废，套餐保持一致。新卡前缀可能与旧卡不同，不应依赖前缀判断商品。
- 已换来的新卡通常不能再换；充值中、已使用、结果未确认或后台禁用的卡不能直接换。
- 本地未使用且无订单的可用卡，或失败后已确认未扣款且完成释放的卡，可能符合换卡条件。
- 同一旧卡的已保存成功结果可重放；`replayed` 可能为 `true`。
- 合作通道返回 `PORTAL_EXCHANGE_PENDING` 时，应联系售后核对原结果，不要不断尝试作废卡密。

常见业务码：`VOUCHER_EXCHANGE_NOT_ELIGIBLE`、`VOUCHER_ALREADY_EXCHANGED`、`VOUCHER_NOT_RELEASED`、`VOUCHER_DISABLED`、`VOUCHER_EXCHANGE_BUSY`、`PORTAL_EXCHANGE_PENDING`、`PORTAL_EXCHANGE_UNAVAILABLE`、`PORTAL_EXCHANGE_REJECTED`。

换卡是改变卡密状态的操作，不是只读查询。不要在查询失败时自动触发换卡。

---

## 十一、超时、限流与错误处理

| 情况 | 处理建议 |
|---|---|
| HTTP 400 / 422 | 检查参数、Session、条款版本；展示中文说明 |
| HTTP 403 | 凭证无效或无权访问；用完整卡密恢复查询，不猜测 Token |
| HTTP 404 | 资源或卡密未找到；批量查询按每项结果处理 |
| HTTP 409 | 当前状态不允许操作；先查询已有结果 |
| HTTP 410 | 会话过期；尚未提交时重新验证，已提交则查询原订单 |
| HTTP 429 | 按 `Retry-After` 退避；不要并发重试 |
| HTTP 5xx / 超时 / 非 JSON | 连接或服务暂时异常；写操作结果可能未知，先查询原结果 |

当前通用公开写接口限流为每来源 IP 约 120 次／分钟，具体接口还有更严格的独立限额。例如，按本站订单号查询约为每来源和订单凭证 180 次／15 分钟。限额可能调整，应始终兼容 429，不将这些数值作为并发额度承诺。

建议只读请求超时为 15–30 秒，Session 预检及提交允许更长等待。无论客户端等待多久，**超时都不能作为未提交或未扣款的证据**。

成功响应中的未知字段可以忽略；未知订单状态应显示“等待确认”，不要默认当成功或失败。

---

## 十二、隐私与接入注意事项

1. 文档、截图、日志、错误追踪和客服工单中不要记录真实完整卡密、Session、`redemptionToken` 或 `claimToken`。
2. 真实请求仅通过 HTTPS 发送；不要把敏感参数拼进 URL 或公开页面地址。
3. 完整邮箱可能由授权查询接口返回，仅向拥有卡密或有效查询凭证的当前用户展示。
4. 不要收集 ChatGPT 密码或邮箱密码；本文兑换流程不要求这些字段。
5. 用户应知道其 Session 的用途；合作通道应在提交前有清晰告知，不在用户仅浏览或粘贴时自动转交。
6. 区分充值提交与查询；页面刷新、断线重连、轮询恢复都只恢复查询。
7. 不要在公开仓库或共享文档中保存真实接口响应。测试请使用专门的测试账号、测试卡密及脱敏结果。

---

## 十三、最小请求示例

以下示例用 `fetch` 表示请求方式，推荐在调用方服务端执行。示例没有内置真实卡密或 Session，也不提供自动重试写操作。

```javascript
const API = "https://lovecodex.cn/api";

async function request(path, { method = "POST", body, headers = {} } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("接口响应中断或格式异常；若为提交操作，请先查询原结果。");
  }
  if (!response.ok || result.ok === false) {
    const error = new Error(result.detail || result.message || "请求未完成");
    error.code = result.error || result.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

// 只读查询：voucherCode 由用户提供，不写入日志。
async function queryVoucher(voucherCode) {
  return request("/v2/status/by-voucher", { body: { voucherCode } });
}

// 已受理订单查询：使用首次提交时保存的凭证。
async function queryOrder(orderNo, claimToken) {
  return request("/v2/status/by-order", { body: { orderNo, claimToken } });
}
```

充值接入应完整实现“初始化 → 创建兑换会话 → 上传 Session → 幂等提交 → 保存订单查询凭证 → 查询结果”的顺序，不省略中间状态检查。
