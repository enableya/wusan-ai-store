# 伍叁 AI 订阅服务项目

React + TypeScript + Vite 前端，以及 Node.js + SQLite 商品后端。首页、套餐列表、套餐对比、详情、信息核对和帮助内容通过真实 HTTP 接口读取数据库。后台管理、支付及真实订单服务不在本期范围内。

## 技术栈

React 19、TypeScript、Vite、React Router、Lucide React、Node.js 内置 HTTP / SQLite、Vitest、Node Test Runner、Playwright。

`index.html` 是 Vite 的应用入口。实际页面、组件、数据、交互和样式都位于 `src/`，不能通过双击 HTML 预览，需要启动开发服务器。

## 安装和运行

需要 Node.js 24 或更新版本，使用其内置 TypeScript 执行与 SQLite 支持。

```sh
npm install
npm run dev
```

`npm run dev` 会同时启动后端与前端。网站访问 `http://127.0.0.1:5180`；后端监听 `http://127.0.0.1:5182`。前端 `/api` 请求代理至后端，避开本机 `5173`、`5174` 上的其他工具。端口被占用时会明确报错，不会关闭其他服务或自动切换；需要时运行 `npm run dev -- --port 5181`。

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
| `/orders` | 订单框架、搜索、状态筛选与本机套餐清单 |
| `/orders/:orderRef` | 本机套餐草稿详情 |
| `/help`、`/help/:articleId` | 帮助中心、分类、全文关键词搜索与文章 |
| `/support` | 咨询和售后表单框架 |
| `/terms`、`/privacy` | 服务须知与隐私说明草稿 |
| `/pay/:orderRef` | 支付未开放提示 |

采用正常路径路由，支持浏览器前进、后退和刷新。页面按路由延迟加载；无效链接显示对应空状态，渲染异常由应用错误边界处理。

## 站点配置

可将 `.env.example` 复制为 `.env`，配置名称、客服邮箱、后端端口和数据库路径；所有 `VITE_` 配置都会进入浏览器，不可放密钥或敏感信息。`API_HOST`、`API_PORT` 和 `DATABASE_PATH` 仅在服务端读取。生产环境也可以使用进程环境变量。

商品、首页、帮助与 FAQ 均存储于 SQLite。前端没有商品数据副本或断网时的静态数据回退。页面支持加载、错误重试、商品下架与空目录状态。

在项目目录维护数据库价格：

```sh
npm run catalog -- list
npm run catalog -- price chatgpt-plus 130
```

修改后刷新页面即可获取新售价，不需要重建前端。金额参数为元，支持最多两位小数，数据库内部使用整数分。其他字段可通过受信任的本地数据库工具维护，暂不开放任何公开写接口。接口与部署说明见 `server/README.md`。

2026 年 10 月 16 日已按经营方提供的信息更新本站实际月度售价，金额以整数分存储：

| 套餐 | 人民币 / 月 |
| --- | ---: |
| ChatGPT Plus | 130 元 |
| ChatGPT Pro 5x | 660 元 |
| ChatGPT Pro 20x | 1,150 元 |
| ChatGPT Pro 50x | 3,350 元 |

以上为本站售价，不代表 OpenAI 官方定价。四个套餐均可核对订阅信息及保存本机清单。保留原有商品 ID，避免破坏既有链接和历史清单。

## 当前业务边界

**已有商品与内容后端，没有后台管理页面、支付、邮箱验证码发送、真实订单、订阅交付、退款或代理服务。**

套餐价格使用经营方确认的实际数据，来自服务端数据库。未提供的具体权益、交付条件、客服及售后信息不做虚构，在数据库中保存为 null 并显示待确认。没有有效价格或不可选的套餐不能进入下单信息页，下架商品接口返回 404。`tradingEnabled` 固定为 false，仅说明当前业务范围，并不是可以开启真实交易的开关。

保存操作只生成本机套餐清单，不是真实订单。清单仅包含商品、保存时价格快照、随机编号和时间；不保存邮箱、咨询内容、密码、Session 或验证码。重复保存同套餐、同价格不会产生重复记录。兼容上一版浏览器内的非敏感套餐清单数据结构；历史金额保留，详情页在价格变动时提示当前售价；不同访问地址的浏览器存储不互通。已移除虚构订单示例及其入口，无法访问的订单引用均显示空状态。

交付方式、供应授权、购买资格、主体信息、交付时限、客服时间、售后及退款条款仍待确认。支付宝是拟定支付渠道，不是交付方式。

未来应以服务端验证的身份、价格、供应状态、订单快照和支付结果为准，不能把当前本机清单转换为可信交易记录。

## 验证与构建

```sh
npm run typecheck
npm test
npm run test:api
npm run build
npm run test:e2e
```

Playwright 需要可用的浏览器。如果尚未安装浏览器，运行 `npx playwright install chromium`。本机已有 Chrome 时，可设置 `$env:E2E_CHANNEL = "chrome"` 后运行浏览器测试。

测试覆盖数据库初始化及重启持久化、HTTP 接口和参数校验、公开写入禁止、下架状态、真实数据库价格一致性、前端接口读取、服务失败及重试、历史价格快照、套餐筛选、键盘操作、草稿去重与删除、交易边界、主题记忆和 320/360/390/768/1024/1440/1920 像素布局。接口测试使用隔离数据库，不改动本机业务数据库。截图写入 `artifacts/`。

## 部署

`npm run build` 生成前端 `dist/`。在服务器运行 Node.js 24 的 `npm run start:api`，使用进程管理器保持运行。Nginx 将网站根目录设为 `dist/`，并将 `/api/` 代理至 `127.0.0.1:5182`，参考 `deploy/nginx.conf`。启用 HTTPS，后端端口不要直接暴露到公网。

生产部署需要 `server/`、共享类型源码 `src/types/catalog.ts`、`package.json` 及可写的数据库目录，但这些文件不能作为静态网站资源发布。备份 SQLite 时使用数据库备份工具或先停止后端，再复制数据库；不要在 WAL 写入过程中只复制主文件。`DATABASE_PATH` 建议设置为持久磁盘的绝对路径。

React Router 使用浏览器路径，页面请求应回退至 `index.html`；`/api/` 必须先匹配到后端，不能回退 HTML。仅部署 `dist/` 或使用原静态托管回退规则已不足以运行本站，需要另行配置 API 代理。构建后可先启动后端，再运行 `npm run preview` 本地检查产物。正式交易上线前仍需完成身份验证、订单、支付与交付服务。
