# 单服务器部署

本方案面向安装 systemd 的 Linux 服务器，示例命令采用 Debian / Ubuntu 的目录和用户管理方式。Node.js 24+ 运行 API，Nginx 提供前端、HTTPS 和同源 `/api/` 代理，SQLite 保存在发布目录之外。域名和广州服务器已购买；正式开放访问仍需完成域名状态、备案和 HTTPS 核验。

先部署关闭收款的版本；应用审核、同一套正式参数和回调联调完成后再启用收款。签约生效与应用上线是分别核验的状态。

本项目已确定的域名为 `wusan-ai.store`，服务器公网 IPv4 为 `8.138.134.95`，地域为华南3（广州）。Nginx 和服务端环境模板已填入该域名。在域名的 DNS 控制台添加主机记录 `@`、记录类型 `A`、记录值 `8.138.134.95` 的解析。

广州是中国内地节点，正式开放域名访问前需要完成 ICP 备案；可先安装服务器环境，备案流程参见 [阿里云官方说明](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)。域名若仍有 `clientHold` 状态，须先在域名控制台处理相应的实名、邮箱验证或其他锁定原因，再核验 DNS 生效。

## 1. 构建可上传的部署包

在目前开发项目中执行：

```sh
cp deploy/frontend.env.example .env.production.local
# 在本机编辑 .env.production.local，填写真实客服邮箱、经营主体和服务时间。
npm run package:deploy
```

输出为 `artifacts/deploy/wusan-ai-store-时间戳.tgz`。包内包含已构建的 `dist/`、后端及共享类型源码、依赖锁文件、部署模板和文件 SHA-256 清单 `release.json`。`node_modules`、本机 `.env`、`.alipay-sandbox.json`、沙箱账号、商户密钥和本机订单数据库不在打包范围内。

前端公开信息在构建时写入产物，改动后重新打包。所有 `VITE_` 配置都不能放密钥。部署包供服务器运行，修改前端、构建与测试仍在完整开发项目中进行。

## 2. 服务器需要准备的资源

- 一个域名，DNS 指向服务器公网 IP。
- Linux 服务器及持久磁盘，安装 Node.js 24+、npm、Nginx、tar；备份命令另用 sqlite3。
- 与域名匹配的有效 HTTPS 证书及完整证书链。示例使用证书工具常见的 `/etc/letsencrypt/live/域名/` 路径，也可改成云厂商签发证书的实际路径。
- 公网开放网站 80 / 443，API 5182 仅监听回环地址。

本文不替你购买资源。服务器地域、域名和业务相关的上线条件确定后，再按实际服务商要求配置。

## 3. 首次安装 API（暂不收款）

先确认 `/usr/local/bin/node --version` 为 24 或更新版本。若 Node 位于其他目录，修改 `deploy/wusan-api.service` 的 `ExecStart`。

上传部署包到服务器后，在服务器终端执行；下面的发布版本目录必须使用一个尚不存在的目录：

```sh
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin wusan
sudo install -d -m 755 /opt/wusan-ai-store/releases
sudo install -d -m 750 -o root -g wusan /etc/wusan-ai-store
sudo install -d -m 750 -o root -g wusan /etc/wusan-ai-store/keys
sudo install -d -m 700 -o wusan -g wusan /var/lib/wusan-ai-store

# 替换上传包路径和发布目录名；首次安装时新建，更新时另选新的目录。
sudo mkdir /opt/wusan-ai-store/releases/20261018-1
sudo tar -xzf /上传路径/wusan-ai-store-时间戳.tgz \
  -C /opt/wusan-ai-store/releases/20261018-1 --strip-components=1
cd /opt/wusan-ai-store/releases/20261018-1
sudo npm ci --omit=dev --ignore-scripts

# 首次安装建立此链接；若 current 已存在，应按后面的更新流程处理。
sudo ln -s /opt/wusan-ai-store/releases/20261018-1 /opt/wusan-ai-store/current
sudo install -m 640 -o root -g wusan deploy/production.env.example /etc/wusan-ai-store/production.env
```

编辑 `/etc/wusan-ai-store/production.env`，核对已填入的 `https://wusan-ai.store` 及其通知地址，保持 `ALIPAY_ENABLED=false`。此时不需要填写商户密钥，API 可提供商品与网站内容，付款入口关闭。

```sh
sudo install -m 644 deploy/wusan-api.service /etc/systemd/system/wusan-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now wusan-api
sudo systemctl status wusan-api --no-pager
curl --fail http://127.0.0.1:5182/api/health
```

切换正式配置前可用服务用户执行只读检查：

```sh
sudo -u wusan env WUSAN_ENV_FILE=/etc/wusan-ai-store/production.env \
  /usr/local/bin/node /opt/wusan-ai-store/current/scripts/profile.mjs production check
```

缺少正式密钥时检查会明确失败，但保持 `ALIPAY_ENABLED=false` 的内部预览仍能正常运行。检查不读取密钥文件内容或发起交易。沙箱使用单独配置、启动命令与数据库，详见 [支付宝接入说明](alipay.md)。

首次启动自动创建新数据库。更新发布目录不会覆盖 `/var/lib/wusan-ai-store/store.sqlite`。本机沙箱订单不复制到正式数据库；若需迁移其他正式数据，应另做完整数据库备份与迁移核验。

## 4. 域名与 HTTPS

备案或域名尚未就绪时，使用 `deploy/nginx-preview.conf`，它仅监听服务器回环地址 `127.0.0.1:8080`。禁用 Nginx 默认公网站点后启用该配置；保持 API 只监听 `127.0.0.1:5182`。在开发电脑通过 SSH 转发预览：

```sh
ssh -N -L 127.0.0.1:5195:127.0.0.1:8080 admin@8.138.134.95
# 浏览器访问 http://127.0.0.1:5195；若使用专用密钥，添加对应 -i 和已核验的 known_hosts 参数。
```

预览仅验证页面与 API；正式环境的 Secure cookie 和支付宝支付回跳须在真实 HTTPS 域名上验收。正式启用 HTTPS 配置时，先禁用预览站点。

先让 DNS 生效并取得证书。`deploy/nginx-https.conf` 的 443 配置引用真实证书文件，证书未签发时不能直接加载整份配置。证书工具支持 HTTP-01 webroot 时，可先配置一个只监听 80 的验证站点，root 为 `/var/www/letsencrypt`；也可以使用 DNS 验证签发证书。

证书就绪后：

1. 将 `deploy/nginx-https.conf` 复制到 Nginx 的站点配置目录，例如 `/etc/nginx/conf.d/wusan-ai-store.conf`。
2. 核对域名 `wusan-ai.store`、证书和前端目录路径。
3. 执行以下命令；语法检查通过才重载：

```sh
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://你的域名/api/health
curl --fail https://你的域名/api/payments/config
```

此时支付配置应返回 `enabled: false`、`environment: production`。访问首页、商品详情并刷新页面，确认前端路径回退正常。HTTPS 配置与证书链规则可见 [Nginx 官方文档](https://nginx.org/en/docs/http/configuring_https_servers.html)；进程重启行为可见 [systemd 官方文档](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)。

## 5. 正式支付配置和联调

在应用审核通过、确认当前产品权限可用后，由经营方在服务器本地填入同一正式应用的参数：

| 配置 | 内容 |
| --- | --- |
| `ALIPAY_APP_ID` | 通过审核、准备使用的正式应用 App ID |
| `ALIPAY_SELLER_ID` | 对应收款主体的 PID |
| `ALIPAY_PRIVATE_KEY_PATH` | 该应用的原始 PKCS#1 私钥字符串文件 |
| `ALIPAY_PUBLIC_KEY_PATH` | 该应用配置对应的支付宝公钥字符串文件 |
| `PUBLIC_SITE_URL` | 用户实际访问的 `https://域名`，不带路径 |
| `ALIPAY_NOTIFY_URL` | `https://域名/api/payments/alipay/notify` |

当前代码接收原始单行密钥字符串，不含 PEM 头尾、空格或换行。私钥由经营方使用官方密钥工具生成或转换并保存在服务器；不要发到聊天。密钥文件建议 `root:wusan`、权限 `0640`，且位于 `/etc/wusan-ai-store/keys/`，不在静态目录。缺字段时先保持关闭；更改为 `ALIPAY_ENABLED=true` 后重启 `wusan-api`。

通知地址必须保留支付宝 POST 请求体，不能经过登录页、验证码或前端 HTML 回退。可先检查无签名请求能到达 API，并被正确拒绝：

```sh
curl -i -X POST https://你的域名/api/payments/alipay/notify \
  -H 'Content-Type: application/x-www-form-urlencoded' --data 'out_trade_no=probe'
```

预期 HTTP 400、纯文本 `fail`。这只证明路由连通和无效通知被拒绝，不证明支付宝通知验签或真实收款通过。最终需经营方从正式站点完成授权的小额实付，核对收款主体、金额、有效通知返回 `success`、重复通知幂等以及查询补偿。未确认结果时先查询原订单，避免重复付款。

本地沙箱付款、签约生效、应用审核、公网回调和正式实付是分别验收的环节。交付方式、客服、售后及退款条件仍需按真实业务补齐。

## 6. 更新、备份与查看日志

新包解压到新的发布目录，安装该目录生产依赖；切换前使用 SQLite 备份工具备份完整数据库：

```sh
sudo install -d -m 700 /var/backups/wusan-ai-store
sudo sqlite3 /var/lib/wusan-ai-store/store.sqlite \
  ".backup '/var/backups/wusan-ai-store/before-release.sqlite'"
```

备份文件名每次更换，保存在受保护目录，含订单邮箱等业务数据。不要在 WAL 正在写入时只复制主 `.sqlite` 文件。

确认 `current` 是符号链接且新目录完整后，将链接切至新目录，重启 API 并检查健康接口；前端仍由同一个 Nginx root 提供，无需复制覆盖旧数据库：

```sh
test -L /opt/wusan-ai-store/current
# 确认上一条成功，并将路径替换为本次新建的发布目录。
sudo ln -sfn /opt/wusan-ai-store/releases/新版本目录 /opt/wusan-ai-store/current
sudo systemctl restart wusan-api
curl --fail https://你的域名/api/health
sudo journalctl -u wusan-api -n 100 --no-pager
```

代码回退可将链接指回保留的旧版本；如果数据库已执行新迁移，旧版本未必兼容，不能仅切回代码就视为完成回退。数据库恢复需停服，并按业务数据保留要求单独处理。
