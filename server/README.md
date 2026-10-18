# 商品、订单与支付宝后端

Node.js 24 内置 HTTP / SQLite，支付宝使用官方 `alipay-sdk`。支持商品内容读取、持久订单、电脑/手机网站支付、RSA2 通知验签与主动交易查询。

## 启动与配置

根目录执行 `npm run dev`，统一启动前端 5180、后端 5182；独立启动 API 使用 `npm run start:api`。根目录 `.env` 和进程环境变量可配置 `API_HOST`、`API_PORT`、`DATABASE_PATH`。

支付宝配置及开通步骤见 [docs/alipay.md](../docs/alipay.md)。未启用或配置不全时，公开支付状态为禁用，不创建可支付订单。`PUBLIC_SITE_URL` 必须与用户访问的网站源一致；生产要求 HTTPS。

## 接口

不提供跨域放行；浏览器通过同源 `/api` 代理访问。商品接口允许 GET / HEAD；写商品与内容仍返回 405。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/health` | 数据库健康检查 |
| GET | `/api/home` | 首页、商品、FAQ |
| GET | `/api/products` | 已发布商品，可用 `?category=Plus` / `Pro` |
| GET | `/api/products/:id` | 已发布商品详情 |
| GET | `/api/content` | 帮助文章与 FAQ |
| GET | `/api/payments/config` | 公开支付启用状态、沙箱 / 正式环境和提示；初始化浏览器 Cookie |
| GET | `/api/orders` | 当前浏览器最近 200 笔订单；无凭证时返回空列表 |
| POST | `/api/orders` | 创建订单，需要 JSON、条款确认、幂等编号 |
| GET | `/api/orders/:id` | 当前浏览器所属订单详情 |
| POST | `/api/orders/:id/payment` | JSON `{ "mobile": false }`，返回支付宝官方付款 URL |
| POST | `/api/orders/:id/refresh` | JSON `{}`，服务端向支付宝查询并验签后更新订单 |
| POST | `/api/payments/alipay/notify` | 支付宝 URL-encoded 通知；成功返回纯文本 `success`，失败 `failure` |

### 创建订单

```http
POST /api/orders
Content-Type: application/json
Idempotency-Key: 浏览器生成的UUID
Cookie: 当前浏览器访问凭证
```

```json
{
  "productId": "chatgpt-plus",
  "email": "buyer@example.com",
  "expectedPriceCents": 13000,
  "acceptedTerms": true
}
```

金额从数据库商品读取，`expectedPriceCents` 仅用于检测展示价格是否变化；客户端其他金额字段不会参与收费。下架、不可选、价格缺失或变化时拒绝创建。订单固定数量 1，周期、价格与商品服务条件按下单时快照保存。相同浏览器、相同幂等编号和相同内容返回原订单；复用编号但更换内容返回 409。

API 成功响应为 `{ "data": ... }`；错误为 `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`。常见状态：400 参数错误、403 请求来源错误、404 不存在或无访问权限、409 价格/状态/幂等冲突、413 请求过大、415 非 JSON、429 频率限制、502 支付宝查询失败、503 支付待配置或服务不可用。

响应设为 `no-store`。订单详情不返回邮箱、访问摘要、幂等编号或任何密钥。请求体限制为 16 KiB。创建订单限制为每后端连接地址每分钟 20 次；支付链接每浏览器每分钟 20 次、主动查询 30 次。限流保存在单进程内，反向代理后的创建限制按代理地址汇总；需要更高并发或多实例时，应在可信网关部署相应限流与身份机制。

### 访问保护

浏览器随机凭证为 256 bit，服务器仅将 SHA-256 摘要存入所属订单。Cookie 使用 HttpOnly、SameSite=Lax；HTTPS 站点使用 `__Host-` 前缀、Secure、Path=/。订单号不是访问凭证，其他浏览器的订单按 404 返回。更换设备或清除 Cookie 后暂不能自动找回，邮箱验证码服务未接入。

JSON 写请求检查 Content-Type 和 Origin / Fetch Metadata，拒绝跨站浏览器请求。支付宝通知不依赖 Cookie，必须验 RSA2 签名，再核对 app_id、seller_id、out_trade_no、金额和状态。

### 支付状态

- `pending`：待付款；付款入口有效期 30 分钟。过期仅停止发起付款，不能据此推断未到账。
- `paid`：有效通知或经过签名验证的主动查询显示 `TRADE_SUCCESS` / `TRADE_FINISHED`，并且金额等匹配。
- `closed`：支付宝返回 `TRADE_CLOSED`，或过期后主动查询确认交易不存在。

已付款不会被迟到的关闭/待付款通知降级。重复通知不会重复入账或修改首次确认时间。支付宝交易号具有唯一约束。主动查询失败时保持原状态并提示重试，不伪造付款结果。沙箱和正式环境不能交叉处理同一订单。

浏览器返回参数不参与状态判定。付款页会在可见时最多自动查询 12 次，间隔 5 秒，也可以手动查询。没有自动订阅交付、订单邮件、在线退款或退款状态同步；已付款始终显示“已付款”，不会伪装成已完成交付。

## 数据库与迁移

`DATABASE_PATH` 默认 `server/data/store.sqlite`。首次初始化及迁移在事务内执行，当前 schema 版本 3：

- `products`：商品、价格整数分、周期、可选/发布状态、服务说明 JSON。
- `content`：首页、FAQ、帮助文章。
- `orders`：订单快照、联系邮箱、所有者摘要、幂等编号、条款版本、付款状态、交易号、时间和支付环境。

从版本 2 升级会创建订单表，并将未被经营方修改的内置支付说明升级；自定义内容、商品价格、已删除商品均保留。`seed/content-v2.ts` 是历史文案迁移基线，不是运行时页面数据。历史浏览器草稿不会自动转成服务端订单。

仅在可信服务器终端维护商品：

```sh
npm run catalog -- list
npm run catalog -- price chatgpt-plus 130
```

价格按元输入、整数分保存。变更只影响新订单；旧订单保留快照。`active=0` 下架，`selectable=0` 展示但不可下单。其他服务条件可使用受信任的 SQLite 工具维护。

## 验证与部署

```sh
npm run test:api
npm run test:dev
npm run test:runtime
npm test
npm run build
E2E_CHANNEL=chrome npm run test:e2e
```

接口测试使用内存/临时数据库和生成的 RSA 密钥，不读取商户密钥、不向支付宝付款。覆盖订单访问、服务端定价、幂等、签名及商户字段、重复通知、状态单向更新、过期和查询补偿。真实沙箱应用权限与回调可达性需要按支付文档单独联调。

生产使用 HTTPS，Nginx 提供 `dist/`，`/api/` 代理至回环 API。数据库、服务端源码、密钥和 `.env` 不可发布到静态目录。生产包含 `server/`、`src/types/`、依赖及持久数据库目录。SQLite 使用 WAL，备份需使用数据库备份工具或停服后一起处理数据文件。部署前完善经营主体、服务供应、交付与售后条件。
