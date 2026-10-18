# 服务器部署记录

核验时间：2026-10-18（Asia/Shanghai）。

## 已部署

- 服务器：`8.138.134.95`，华南3（广州），Ubuntu 24.04.2 LTS / x86_64，使用 `admin` 和专用 SSH 密钥管理。
- 运行环境：Node.js `v24.22.0`、npm `11.19.1`、Ubuntu 仓库 Nginx 和 sqlite3。Node 官方 Linux x64 包已核对 SHA-256。
- 当前发布目录：`/opt/wusan-ai-store/releases/20261018-095209`，`current` 符号链接指向此版本。此前发布目录仍保留；当前 schema 5 不能直接运行 schema 5 之前的 API，回退需先评估数据库恢复。
- 当前发布包：`artifacts/deploy/wusan-ai-store-2026-10-18T09-52-09-734Z.tgz`。
- 当前包 SHA-256：`16c72004863848e28c3e4bf18caa028d7b2646057d77a0e2f76f59c569c88d4c`；服务器端重新核对包和全部 68 个文件的清单。
- API 由专用无登录用户 `wusan` 运行，systemd 服务 `wusan-api` 已启动、启用开机自启，并通过重启检查。
- API 仅监听 `127.0.0.1:5182`，Nginx 预览仅监听 `127.0.0.1:8080`。没有公网网站监听；HTTPS 配置已放置在 `sites-available`，尚未启用。
- 正式环境配置在 `/etc/wusan-ai-store/production.env`，权限 `0640 root:wusan`。收款保持 `ALIPAY_ENABLED=false`，未上传沙箱凭据或正式商户私钥。
- 正式数据库新建在 `/var/lib/wusan-ai-store/store.sqlite`，目录 `0700`、文件 `0600`，未复制本机沙箱订单。
- 初始一致性备份：`/var/backups/wusan-ai-store/initial-20261018-0650.sqlite`，权限 `0600 root:root`，完整性检查通过。这是初始备份，尚未配置定时异地备份。
- 更新前备份：`/var/backups/wusan-ai-store/before-20261018-075737.sqlite`，完整性检查通过；旧服务和环境配置也保存在同一受保护目录中。

## 本次支付环境隔离更新

新增 `dev:sandbox`、`start:production` 与两套 `payment:check:*` 命令；显式沙箱配置和数据库独立。正式服务不再加载开发 `.env`；环境不匹配、数据库指向默认沙箱库时拒绝启动。前端构建与 API 支付配置解耦，付款表单网关必须与订单环境一致。

已通过 25 项 API 测试、4 项环境隔离测试、5 项启动测试和 4 项 Chrome 浏览器支付测试，生产构建成功。浏览器及接口自动测试使用模拟交易或测试密钥，没有发起真实扣款。

通过官方工具查询，正式应用 `wusan`（`2021007108662753`）本次仍为 `AUDIT`（审核中）。服务器已填入此前提供的正式 App ID / PID；收款保持关闭。

以服务用户执行生产预检：环境、独立数据库、站点地址、通知地址、App ID / PID 的静态检查通过；`private_key_file` 和 `alipay_public_key_file` 未通过，当前配置指向的两份正式密钥文件未就绪。工具不读取密钥文件内容、不打印密钥、不发起交易，静态检查不代表商户权限或真实交易已验证。

## 检查结果

主色调整为 `#005BF8`，同步按钮、选中分类、导航、品牌标识与后台强调色，浅色背景及深色主题调整为蓝色系。ChatGPT 黑白图标保留原始样式。生产构建、桌面 / 手机布局与主题持久化检查通过，已目视检查亮暗主题。此更新前备份为 `/var/backups/wusan-ai-store/before-20261018-095209.sqlite`。

首页横幅右侧新增 ChatGPT 官方 SVG 图标；手机端缩小并置于横幅右上角，支持亮暗主题。生产构建及桌面、手机、主题偏好共 3 项既有浏览器检查通过，已目视检查两种尺寸。此更新前备份为 `/var/backups/wusan-ai-store/before-20261018-094231.sqlite`。

首页已改为顶部横幅、左侧分类和右侧商品卡片；卡片仅保留封面、标题、价格和“查看详情”。移动端分类横向排列，商品双列显示；搜索、分类筛选及无结果重置均可用。已通过 21 项隔离数据库浏览器回归检查及生产构建，并目视检查 1440px / 390px 布局。此次首页升级前备份为 `/var/backups/wusan-ai-store/before-20261018-092951.sqlite`，数据库完整性检查通过，schema 保持 5。服务器核验首页、详情路由、四张商品封面和后台入口均返回 200，未登录后台统计返回 401；后台账号及原有统计保留，正式收款仍关闭。

后台第一期已部署，入口 `http://127.0.0.1:5195/admin`，独立账号 `admin`。初始随机密码已交付到本机受保护配置目录，权限 `0600`；服务器初始明文凭据文件已移除，SQLite 仅保存密码哈希及会话摘要。

新增 6 项后台 API 测试和 2 项隔离数据库浏览器测试均通过，原有 25 项 API 测试通过，生产构建通过；已目视检查 1440px 和 390px 后台布局。服务器实测登录、读取统计、退出与旧会话失效成功，未登录读取返回 401。正式数据库当前真实点击为 0，未插入示例点击。

此次升级前备份为 `/var/backups/wusan-ai-store/before-20261018-082339.sqlite`。先在备份副本上验证 schema 5 迁移，再切换服务，正式数据库完整性检查通过。`ADMIN_ORIGIN=http://127.0.0.1:5195` 供当前 SSH 内部预览使用；公开 HTTPS 域名启用时同时更新为 `https://wusan-ai.store`。后台使用说明见 [admin.md](admin.md)。

健康接口正常；四个商品正常读取；首页、结账页和订单页刷新正常；静态资源缓存正常；点文件访问返回 403；未知 API 返回 404；无效支付宝通知返回 400 / `fail`；支付配置为 `production` 且 `enabled: false`。Cookie 包含 HttpOnly、Secure。Nginx 语法检查通过。

预览通过 SSH 隧道供本机访问：`http://127.0.0.1:5195`。该地址只有本机隧道运行时可用，浏览器展示的是服务器部署版本。HTTP 预览不作为支付及 Secure Cookie 的 HTTPS 验收。

重新建立隧道：

```sh
ssh -i /Users/lzl/.config/wusan-ai-store/ssh/deploy-8.138.134.95 \
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/Users/lzl/.config/wusan-ai-store/ssh/known_hosts-8.138.134.95 \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -N -L 127.0.0.1:5195:127.0.0.1:8080 admin@8.138.134.95
```

## 开放网站前待完成

1. 域名 `wusan-ai.store` 本次公开 RDAP 查询仍为 `clientHold`，没有可解析 IPv4。进入阿里云域名控制台，按提示处理实名、邮箱验证或具体锁定原因；以解除后的实际状态为准。
2. 为域名添加 `@` 的 A 记录至 `8.138.134.95`，核验 DNS，并完成广州节点所需的 ICP 备案。
3. 取得 HTTPS 证书，启用已准备的 HTTPS 站点配置，停用内部预览配置，核验 80/443 及同源 API。
4. 补齐实际经营主体、客服、交付及退款信息；确认正式支付宝应用上线与产品权限。由经营方在服务器本地配置同一应用正式密钥，再进行授权的小额实付、通知验签、订单幂等与查询补偿验证。

当前服务器部署成功，公网网站及正式收款尚未启用。
