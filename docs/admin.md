# 管理后台与商品点击统计

入口为 `/admin`，使用独立管理员账号。第一期只提供商品点击统计，不开放商品修改、订单管理或退款操作。

## 统计口径

成功打开有效商品详情页记一次点击，包括直接通过地址访问。同一浏览器、同一商品 30 分钟内去重；刷新、React 重复上报和相同事件编号重试不会增加计数。管理员已登录的浏览器不计入，已识别的常见爬虫 User-Agent 不计入，但不能保证识别全部机器人。该数据用于衡量商品关注度，不等于真实人数或点击广告归因。

数据在 SQLite 的 `product_clicks` 表持久保存，使用服务端确定的 `production` / `sandbox` 环境。后台可筛选正式、测试或全部环境，按北京时间展示今日、近 7 天、近 30 天及自定义日期（最多 366 天），含点击趋势和所有商品排行。已下架或已删除商品的历史点击保留。没有历史数据补录；功能启用之前的点击无法恢复。

访客 Cookie 使用随机值，数据库仅保存其摘要，不保存 IP、邮箱、User-Agent 或完整浏览轨迹；前端会话存储保存单次统计编号。隐私说明同步更新。浏览器拒绝 Cookie、阻断统计请求或网络中断会影响统计完整性。

## 创建管理员

服务器首次部署后，由服务用户运行（凭据文件必须是项目目录之外的绝对路径，且尚不存在）：

```sh
sudo -u wusan env WUSAN_ENV_FILE=/etc/wusan-ai-store/production.env \
  /usr/local/bin/node /opt/wusan-ai-store/current/server/admin-cli.ts \
  create admin --credentials-file /var/lib/wusan-ai-store/.admin-initial.txt
```

命令随机生成初始密码，只写入权限 `0600` 的凭据文件，不打印到终端或进程参数。账号密码以 scrypt 哈希保存，登录 Cookie 为 HttpOnly / SameSite=Strict，服务器只保存会话令牌摘要，8 小时后过期；退出会立即撤销会话。没有默认通用密码或公开注册接口，账号已存在时拒绝覆盖。

凭据应通过受控方式交付给经营方并保管在密码管理器，交付后移除服务器上的初始明文凭据文件。不要将凭据放进源码、静态目录或 Git。当前版本不提供网页重置密码功能。

## 访问源与部署

`ADMIN_ORIGIN` 设置为管理员和商城浏览器实际访问的源，例如正式上线为 `https://wusan-ai.store`，Secure Cookie 自动启用。本机 SSH 内部预览时使用 `http://127.0.0.1:5195`，HTTP 只允许回环地址；切换公开域名时同时更新该配置并重启 API。它不改变支付宝正式环境的 HTTPS 回跳及通知要求。

后台 API：

- `GET /api/admin/session`：读取当前登录状态。
- `POST /api/admin/login`、`POST /api/admin/logout`：同源登录及退出。
- `GET /api/admin/analytics/products?start=YYYY-MM-DD&end=YYYY-MM-DD&environment=production`：须登录，返回汇总、趋势及排行。
- `POST /api/analytics/product-click`：匿名同源统计，参数为 `productId` 和随机 UUIDv4 `eventId`。客户端不能指定统计环境。

数据库 schema 升至 5。更新前先备份，旧版 API 不支持 schema 5；如需回退，应评估更新期间新增数据后按数据库恢复流程处理，不能只切换旧代码链接。

## 验证

`npm run test:api` 包含后台鉴权、去重、时区、环境、持久化和过期会话验证。`npm run test:admin:e2e` 自动创建并清理隔离数据库，用 Chrome 验证真实访客记录与后台读取、退出登录，以及桌面和手机布局，不使用正式账号或数据库。
