# 伍叁 AI 订阅服务项目

React + TypeScript + Vite 前端，Node.js + SQLite 商品与订单后端，已接入支付宝官方 SDK。支持服务端定价、订单持久化、电脑/手机网站支付、回调验签和主动查询。尚未开通商户应用时，页面显示“支付宝待配置”，不创建可支付订单。

## 技术栈

React 19、TypeScript、Vite、React Router、Lucide React、Node.js 内置 HTTP / SQLite、Vitest、Node Test Runner、Playwright。

`index.html` 是 Vite 的应用入口。实际页面、组件、数据、交互和样式都位于 `src/`，不能通过双击 HTML 预览，需要启动开发服务器。

## 安装和运行

需要 Node.js 24 或更新版本，使用其内置 TypeScript 执行与 SQLite 支持。

```sh
npm install
npm run dev
```

### macOS / Linux 启动与 Node 版本

所有 npm 命令会先检查运行时，优先使用当前 Node.js 24+；当前版本较旧时，会尝试本机已存在的 Codex Node.js 24 和 PATH 中的可用运行时。因此即使终端的 `node -v` 仍是 16，本机存在可用运行时也可以直接执行 `npm run dev`。这个选择只作用于当前命令及其子进程，不修改系统 Node.js。

如果没有可用的 Node.js 24，启动器会显示明确提示。使用 nvm 时，在项目目录执行 `nvm install`、`nvm use` 后再运行 `npm install`；也可安装 Node.js 24，或通过 `WUSAN_NODE_BINARY=/absolute/path/to/node npm run dev` 指定已有运行时。项目内的 `.nvmrc` 与 `.node-version` 已声明版本 24。

后端依赖 Node.js 内置 TypeScript 和 SQLite，仅添加 TypeScript loader 不能解决 Node.js 16 的运行问题。依赖安装也建议使用 Node.js 24，以避免 npm 的版本警告。

`npm run dev` 会同时启动后端与前端。网站访问 `http://127.0.0.1:5180`；后端监听 `http://127.0.0.1:5182`。前端 `/api` 请求代理至后端，避开本机 `5173`、`5174` 上的其他工具。启动前会检查两个端口，占用时列出冲突并退出，不会关闭其他服务或自动切换。重复启动时，请先在原终端按 Ctrl+C 停止旧服务；如果网站已在运行，也可直接打开原地址。

仅前端端口冲突时，可运行 `npm run dev -- --port 5181`。若两个端口都被占用，或需要同时运行多个实例，macOS / Linux 可使用 `API_PORT=5184 npm run dev -- --port 5183`；Windows PowerShell 先执行 `$env:API_PORT=5184`，再执行 `npm run dev -- --port 5183`。也可在 `.env` 中设置 `API_PORT=5184`。前端 API 代理会使用同一后端端口配置。

第一次启动自动创建 `server/data/store.sqlite` 并初始化四款实际套餐、首页和帮助内容。之后重启不会覆盖修改过的数据，也不会重新添加已删除的商品。数据库及环境变量文件均不提交到版本库。

后端健康检查：`http://127.0.0.1:5182/api/health`。独立启动可分别运行 `npm run start:api` 和 `npm run dev:client`。按 Ctrl+C 退出统一开发命令时会一同停止其启动的前后端子进程。

### 当前 Windows 环境

最简单的方式是在项目文件夹中双击 `start.cmd`。它会在当前窗口选择已有 Node.js 运行时、安装依赖，再启动网站。看到 Vite 打印 `Local: http://127.0.0.1:5180/` 后再打开浏览器。运行期间不要关闭该窗口；失败时窗口会保留报错。

这个入口不依赖 PowerShell 脚本执行策略，也不会修改系统 Node.js 或关闭其他工具。

本机系统 Node.js 为 16，Codex 已提供可用的 Node.js 24。下面的 PowerShell 启动脚本会优先选择满足版本要求的运行时，并将安装文件和 npm 缓存保存在项目中：

```powershell
.\scripts\dev.ps1 -Install
```

安装完成后运行 `.\scripts\dev.ps1`，也可以用 `-Port 5181` 指定另一端口。

若本机限制执行 PowerShell 脚本，可在当前终端临时选用已经存在的 Node.js 运行时，并直接执行 npm CLI：

```powershell
$node = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$npm = Join-Path (Split-Path (Get-Command npm.cmd).Source) "node_modules\npm\bin\npm-cli.js"
$env:Path = (Split-Path $node) + ";" + $env:Path
& $node $npm install --cache .npm-cache --no-audit --no-fund
& $node $npm run dev
```

此选择仅影响当前终端，不修改系统 Node.js 配置。

## 工程结构

```text
src/
  app/          应用路由、主题和弹窗/提示状态
  layouts/      公共导航、页脚与路由布局
  pages/        各个独立业务页面
  components/   商品、价格、图标、弹窗等公共组件
  types/        商品、文章及本机清单的类型
  services/     本机清单服务及单元测试
  hooks/        页面标题和清单状态订阅
  config/       站点配置
  lib/          金额、时间及表单校验
  main.tsx      React 挂载入口
  styles.css    响应式布局与浅色/深色主题
tests/e2e/      浏览器交互、路由与布局检查
server/        商品 API、数据库初始化与迁移、接口测试、数据维护命令
server/seed/   仅供首次建库的实际套餐、首页内容、帮助文章与 FAQ
server/data/   本地 SQLite 数据库，禁止公开访问或提交到版本库
public/        自有品牌资源与部署重写规则
deploy/        Nginx 静态站点配置示例
scripts/       Windows 本地启动辅助
```

## 页面路由

| 地址 | 页面 |
| --- | --- |
| `/` | 套餐目录、分类筛选、对比和 FAQ |
| `/products/:productId` | 套餐详情、购买指南和服务须知 |
| `/checkout/:productId` | 订阅信息核对、邮箱校验和条款确认 |
| `/orders` | 当前浏览器的服务器订单、搜索、付款状态筛选与本机套餐清单 |
| `/orders/:orderRef` | 服务器订单 / 历史本机草稿详情 |
| `/help`、`/help/:articleId` | 帮助中心、分类、全文关键词搜索与文章 |
| `/support` | 咨询和售后表单框架 |
| `/terms`、`/privacy` | 服务须知与隐私说明草稿 |
| `/pay/:orderRef` | 支付宝付款、倒计时、支付结果与服务端查询 |

采用正常路径路由，支持浏览器前进、后退和刷新。页面按路由延迟加载；无效链接显示对应空状态，渲染异常由应用错误边界处理。

## 站点配置

可将 `.env.example` 复制为 `.env`，配置名称、客服邮箱、后端端口和数据库路径；所有 `VITE_` 配置都会进入浏览器，不可放密钥或敏感信息。`API_HOST`、`API_PORT` 和 `DATABASE_PATH` 仅在服务端读取。生产环境也可以使用进程环境变量。

商品、首页、帮助与 FAQ 均存储于 SQLite。前端没有商品数据副本或断网时的静态数据回退。页面支持加载、错误重试、商品下架与空目录状态。

在项目目录维护数据库价格：

```sh
npm run catalog -- list
npm run catalog -- price chatgpt-plus 130
```

修改后刷新页面即可获取新售价，不需要重建前端。金额参数为元，支持最多两位小数，数据库内部使用整数分。其他字段可通过受信任的本地数据库工具维护，不开放商品管理写接口。订单与支付接口说明见 [server/README.md](server/README.md)。

2026 年 10 月 16 日已按经营方提供的信息更新本站实际月度售价，金额以整数分存储：

| 套餐 | 人民币 / 月 |
| --- | ---: |
| ChatGPT Plus | 130 元 |
| ChatGPT Pro 5x | 660 元 |
| ChatGPT Pro 20x | 1,150 元 |
| ChatGPT Pro 50x | 3,350 元 |

以上为本站售价，不代表 OpenAI 官方定价。四个套餐均可核对订阅信息及保存本机清单；支付宝配置完成后可创建订单并付款。保留原有商品 ID，避免破坏既有链接和历史清单。

## 支付宝接入与配置

商户尚未开通时保持 `ALIPAY_ENABLED=false`。按 [支付宝开通与配置步骤](docs/alipay.md) 完成应用、网站支付签约、公钥配置、沙箱验证和公网回调部署后，再切换正式环境。

付款流程：核对套餐与邮箱 → 服务器按当前价格创建订单 → 跳转支付宝官方收银台 → 验签通知 / 主动查询核实结果 → 查看订单。支付链接不包含联系邮箱，金额只使用服务器订单快照。订单付款期限为 30 分钟，不自动续费。

## 当前业务范围

已提供商品与内容、服务器订单、支付宝电脑/手机网站支付、RSA2 回调验签、主动查询、订单状态列表与详情。订单由当前浏览器的 HttpOnly Cookie 凭证保护，知道订单号不能访问他人订单。生产环境需使用 HTTPS，配置 `PUBLIC_SITE_URL` 后启用 Secure Cookie；沙箱与正式订单不能混用。

订单创建会保存联系邮箱、商品及服务条件快照、价格、条款版本与付款信息；前端和日志不返回邮箱或私钥。重复提交使用幂等编号，重复支付通知不会重复入账。订单列表显示最近 200 笔当前浏览器可访问的订单。

历史本机草稿继续保留，草稿不含邮箱，也不会自动转换为可信订单。创建订单时重新核对服务端价格，下架、不可选、价格变化的商品不能按旧金额付款。

尚未提供后台管理、邮箱验证码找回、订单邮件、自动订阅交付、在线退款或代理服务。支付宝是支付渠道，付款成功不等于完成交付。经营主体、服务供应、交付、客服、售后和退款条件需经营方补充；不虚构未提供的信息。清除 Cookie 或更换设备后不能直接访问原订单，邮箱找回未开放前请保留原浏览器凭证与订单号。

## 验证与构建

```sh
npm run typecheck
npm run test:runtime
npm run test:dev
npm test
npm run test:api
npm run build
npm run test:e2e
```

Playwright 需要可用的浏览器。如果尚未安装浏览器，运行 `npx playwright install chromium`。本机已有 Chrome 时，可设置 `$env:E2E_CHANNEL = "chrome"` 后运行浏览器测试。

测试覆盖数据库迁移与持久化、商品定价、订单幂等与访问隔离、RSA2 回调验签、商户及金额核对、重复通知、过期付款、主动查询、浏览器下单与支付结果、历史草稿、错误重试及响应式布局。支付接口测试使用生成的临时密钥和隔离数据库，浏览器支付测试拦截网关，不产生真实扣款。接口测试使用隔离数据库，不改动本机业务数据库。截图写入 `artifacts/`。

## 部署

完整的 Linux 单服务器部署步骤见 [部署指南](docs/deployment.md)。运行 `npm run package:deploy` 可生成排除本机密钥、沙箱配置和数据库的运行包；`deploy/` 提供 HTTPS Nginx、systemd 和默认关闭收款的正式环境模板。

`npm run build` 生成前端 `dist/`。在服务器运行 Node.js 24 的 `npm run start:api`，使用进程管理器保持运行。Nginx 将网站根目录设为 `dist/`，并将 `/api/` 代理至 `127.0.0.1:5182`，参考 `deploy/nginx.conf`。启用 HTTPS，后端端口不要直接暴露到公网。

生产部署需要 `server/`、共享类型源码 `src/types/`、`package.json` 及可写的数据库目录，但这些文件不能作为静态网站资源发布。备份 SQLite 时使用数据库备份工具或先停止后端，再复制数据库；不要在 WAL 写入过程中只复制主文件。`DATABASE_PATH` 建议设置为持久磁盘的绝对路径。

React Router 使用浏览器路径，页面请求应回退至 `index.html`；`/api/` 必须先匹配到后端，不能回退 HTML。仅部署 `dist/` 或使用原静态托管回退规则已不足以运行本站，需要另行配置 API 代理。构建后可先启动后端，再运行 `npm run preview` 本地检查产物。正式收款前按支付宝配置文档完成商户开通、签约、沙箱验证、HTTPS 回调与经营服务条件配置。
