# 商品与内容后端

使用 Node.js 24 内置 HTTP 服务和 SQLite，没有额外数据库服务器或运行时依赖。这里是商品与内容服务，不是 OpenAI API 代理，不处理登录、真实订单、支付或订阅交付。

## 启动

在项目根目录运行：

```sh
npm run dev
```

统一启动前端（5180）与后端（5182）。也可以独立运行：

```sh
npm run start:api
```

环境配置从根目录 `.env` 或进程环境变量读取：

| 变量 | 默认值 |
| --- | --- |
| `API_HOST` | `127.0.0.1` |
| `API_PORT` | `5182` |
| `DATABASE_PATH` | `server/data/store.sqlite`，相对项目根目录 |

数据库首次初始化在事务内完成，schema 版本通过 `PRAGMA user_version` 维护。产品和内容仅在首次建库时写入，重启不覆盖数据库。代码中的 seed 不是运行时查询来源。

## HTTP 接口

所有接口为公共只读接口，不需要密钥，也不返回私有用户数据。允许 `GET` / `HEAD`，其他方法返回 405。不提供跨域放行，浏览器通过同源 `/api` 代理访问。

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/health` | 数据库连接健康状态 |
| GET | `/api/home` | 首页标题、描述、服务说明、步骤、商品与 FAQ |
| GET | `/api/products` | 按排序返回已发布商品 |
| GET | `/api/products?category=Plus` | Plus 分类，可用值 `Plus` / `Pro` |
| GET | `/api/products/:id` | 已发布商品详情 |
| GET | `/api/content` | 帮助文章与 FAQ |

成功响应：

```json
{
  "data": {
    "id": "chatgpt-plus",
    "name": "ChatGPT Plus",
    "category": "Plus",
    "priceCents": 13000,
    "currency": "CNY",
    "periodMonths": 1,
    "selectable": true,
    "mark": "Plus",
    "color": "green",
    "icon": "sparkles",
    "label": "日常精选",
    "description": "为日常灵感，多留一点空间。",
    "audience": "日常使用、学习与办公",
    "features": ["个人账号订阅", "按月选择，不自动扣费", "服务条件购买前确认"],
    "details": {
      "entitlements": null,
      "deliveryMethod": null,
      "deliveryTime": null,
      "accountRequirements": null,
      "afterSales": null
    }
  }
}
```

商品列表的 `data` 是以上对象的数组。未知业务字段为 null，不填虚构权益、交付或售后承诺。`selectable` 只表示允许核对信息及保存本机清单，不表示已开放在线交易。

错误响应：

```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "套餐不存在或已下架。",
    "requestId": "请求追踪编号"
  }
}
```

| HTTP 状态 | 含义 |
| --- | --- |
| 400 | 分类、查询参数或商品编号无效 |
| 404 | 商品未找到、已下架或接口不存在 |
| 405 | 不允许写入 |
| 503 | 服务器或数据库暂不可用 |

响应设置 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 和 `X-Request-Id`。异常日志只写到服务端，不向客户端返回数据库路径或堆栈。

## 数据维护

```sh
npm run catalog -- list
npm run catalog -- price chatgpt-plus 130
npm run catalog -- price chatgpt-pro-5x 660
npm run catalog -- price chatgpt-pro-20x 1150
npm run catalog -- price chatgpt-pro-50x-ph 3350
```

命令只能在有服务器文件访问权限的本地终端运行，不是公开管理接口。价格以元输入、整数分存储。非正数、精度超过两位小数、不安全整数、商品不存在时命令失败。

主要表：

- `products`：商品编号、名称、分类、价格、可选状态、发布状态、排序、币种、周期、展示与业务说明 JSON、更新时间。
- `content`：首页内容 `home`、常见问题 `faqs`、帮助文章 `articles`。

`active=0` 为下架，从首页、商品列表和详情接口同时隐藏；`selectable=0` 为展示但不可选择。暂不提供后台管理页面，其他业务字段可以使用受信任的 SQLite 工具维护。

已有浏览器套餐草稿不迁移为服务端订单。数据库价格修改后刷新页面即可生效；历史草稿保留原金额，详情页提示当前价格差异。

## 测试与部署

```sh
npm run typecheck
npm run test:api
npm test
npm run test:e2e
```

接口测试使用独立内存 / 临时数据库，覆盖价格、筛选、商品隐藏、参数校验、写入禁止、重启持久化、修改即时生效与金额约束。

生产部署使用 Nginx 提供 `dist/` 并代理 `/api/`，配置参考 `deploy/nginx.conf`。保持 API 仅监听回环地址，使用 HTTPS，并用进程管理器运行后端。服务器源码、数据库、环境变量文件不得公开。Vite 开发服务器也禁止直接读取 `server/` 文件。

此版本提供真实持久化的商品与内容读取，不等于具备完整生产交易能力。后续订单与支付必须添加服务端身份验证、服务端价格校验、订单快照、幂等写入与支付回调验证，不能信任浏览器金额或本机清单。
