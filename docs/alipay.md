# AI 网页应用收款接入

本项目使用支付宝官方 Node.js SDK `alipay-sdk`。电脑和手机浏览器均通过 `alipay.trade.page.pay`、`FAST_INSTANT_TRADE_PAY` 生成 POST 表单，浏览器提交后进入支付宝收银台。

## 沙箱运行

建议使用独立配置和数据库运行沙箱：

```sh
cp deploy/sandbox.env.example .env.sandbox.local
chmod 600 .env.sandbox.local
npm run payment:check:sandbox
npm run dev:sandbox
```

该命令使用 `http://127.0.0.1:5190` 和 API `5192`，数据库为 `server/data/sandbox.sqlite`。若端口已有服务占用，先在原终端停止对应服务；不要启动重复实例。配置预检只检查文件存在及权限，不会代替官方沙箱校验或实际付款。

兼容原有 `npm run dev` 和 `.env`。显式沙箱命令只读取 `.env.sandbox.local`，正式服务不会读取本机 `.env`，两者通过服务端配置切换，不提供浏览器切换网关的开关。

项目根目录的 `.alipay-sandbox.json` 是沙箱配置的唯一来源，服务端按源码位置定位该文件，从 `appIds[0]` 直接读取应用、商家、支付宝公钥和 Node.js 对应的 `appPrivatePkcsKey`。文件必须保持仅所有者可读，不要把内容复制到 `.env`、前端或 Git。

在 `.env` 中配置 `ALIPAY_ENABLED=true`、`ALIPAY_ENV=sandbox`，并将 `PUBLIC_SITE_URL` 设置为浏览器实际访问的站点源。默认开发地址为 `http://127.0.0.1:5180`。执行 `npm run dev` 启动，选择套餐、创建订单、点击“前往支付宝付款”。沙箱付款需使用沙箱买家账号；扫码需要支付宝沙箱客户端。

`ALIPAY_NOTIFY_URL` 在没有公网 HTTPS 地址时留空。当前本地验收通过主动交易查询确认支付结果。异步通知入口 `/api/payments/alipay/notify` 已实现表单解析、SDK 验签、应用/商家/订单/金额校验、持久化事件幂等和纯文本 `success` / `fail` 响应，退款事件不会标记付款成功。公网通知仍需部署后联调。

默认回跳为 `/pay/订单号`；没有订单上下文时 `/pay` 展示中性查询引导。订单访问必须持有下单浏览器的 HttpOnly Cookie。回跳参数只触发服务端查询，不能直接确认付款。查询返回未知或待付款状态会保留未确认状态。

## 关单与退款

已登录下单浏览器可向 `POST /api/orders/订单号/close` 提交 `{}`。服务端先查询，再关闭未付款交易；已付款订单不会调用关单。前端仍以查询结果为准。

退款通过服务器本地命令执行，服务器访问权限就是操作权限，未开放公开退款接口：

```sh
npm run payment -- refund 商户订单号 唯一退款请求号 退款金额 退款原因
# 至少等待 10 秒后查询
npm run payment -- refund-query 唯一退款请求号
```

每次新退款使用新请求号；超时或未知结果重试时必须复用原请求号、金额和原因。数据库持久保存退款请求并预留退款金额，累计已退款和待确认退款不能超过原支付金额。`fund_change=Y` 确认资金变化；其他结果保持待确认，通过同请求号查询，只有 `REFUND_SUCCESS` 确认退款完成。退款查询及资金操作均验证支付宝响应签名。

不要对生产订单执行测试退款或关单。沙箱订单和正式订单不能交叉操作。

## 生产配置与验收

生产配置模板 `deploy/production.env.example` 已填入经营方此前提供的正式 App ID / PID；它们仍需与最终通过审核、获准使用的应用核对。模板默认关闭收款，不能仅凭这些标识认为正式支付已开通。

服务器上的检查命令（使用服务用户，以核对其实际读取权限）：

```sh
cd /opt/wusan-ai-store/current
sudo -u wusan env WUSAN_ENV_FILE=/etc/wusan-ai-store/production.env \
  /usr/local/bin/node scripts/profile.mjs production check
```

命令仅输出检查项和通过/未通过，不读取私钥文件内容、不打印环境变量、不联网创建交易。私钥和支付宝公钥采用受保护文件方式；若检查失败，退出码为 1。即使静态检查全通过，应用权限、密钥匹配、公网通知和真实交易仍需分别核验。

正式启动用 `npm run start:production`，默认配置位于 `/etc/wusan-ai-store/production.env`；可通过 `WUSAN_ENV_FILE` 指定另一受保护文件。systemd 部署继续使用 `wusan-api` 服务，环境必须为 `production` 且数据库独立；配置与环境不符会停止启动，不回退到沙箱。

当前服务器预检显示以下两份文件未就绪，需由经营方在服务器本地配置：

- `/etc/wusan-ai-store/keys/app-private.keytext`：当前正式应用的原始单行 PKCS#1 私钥。
- `/etc/wusan-ai-store/keys/alipay-public.keytext`：同一正式应用配置对应的支付宝公钥。

文件应为 `root:wusan`、`0640`，父目录为 `0750 root:wusan`，不放进静态目录，也不发到聊天。格式转换由经营方使用支付宝官方密钥工具完成，不添加 PEM 头尾或自行调整原始值。配置后运行上述只读预检；暂不启用收款，等应用审核及公网 HTTPS/通知验收完成后再进行授权的小额实付。

生产使用 `ALIPAY_ENV=production`、正式应用的 App ID、seller ID、原始 PKCS#1 私钥及支付宝公钥。通过 `ALIPAY_PRIVATE_KEY_PATH`、`ALIPAY_PUBLIC_KEY_PATH` 指向受保护文件，或使用对应无 `_PATH` 的环境变量。传给 SDK 的值不含 PEM 头尾，不做格式转换。生产与沙箱共用验签、金额和归属校验流程。

上线前需要完成 AI 网页应用收款签约及应用审核，确认所有密钥属于同一应用，配置真实 HTTPS 的 `PUBLIC_SITE_URL` 和 `ALIPAY_NOTIFY_URL`，完成公网通知、重复通知、补偿查询和实际授权交易验收。反向代理将 `/api/` 转发到服务端，其余路由回退到前端 `index.html`。仅本地测试不能证明生产就绪。

支付状态与订阅交付分开处理；当前没有自动交付、订单邮件、邮箱找回或管理后台。保留 SQLite 备份并通过受信任渠道核实售后请求。

## 自动检查

`npm run test:api` 验证订单归属、金额、签名、退款事件排除、持久化幂等、退款预留和重试；`npm run build` 检查前端构建，`npm run test:e2e` 检查桌面和手机付款表单及结果页。模拟测试不等于真实沙箱付款通过。
