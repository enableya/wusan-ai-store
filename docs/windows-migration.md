# 腾讯云 Windows 部署与迁移记录

2026-10-31 已迁移至腾讯云东京 `43.167.196.132`，系统通过控制台和远程连接核验为 Windows Server 2025 Datacenter 中文版。正式入口为 https://wusan-ai.store，后台为 https://wusan-ai.store/admin。阿里云仍管理域名，根域 A 记录已改为腾讯云地址，TTL 600；两台权威 DNS 与公网访问均已核验。

## 数据与回退

最终切换前停止原广州服务器 `8.138.134.95` 的 `wusan-api`，再生成一致性快照 `/var/backups/wusan-ai-store/tencent-final-20261031T094749Z.sqlite`。快照 SHA-256 为 `bb6b1a9c867284b3ca9fd81bd84f368cf02945230f21081106ea72c41954dd47`，完整性检查通过，schema 6，包含 4 个商品、0 个订单、1 个后台账号、6 条商品点击记录。正式数据库在新机恢复，不重新初始化账号；原后台密码登录、读取统计、退出与会话失效已通过域名 HTTPS 验收。浏览器验收拦截点击统计，不产生示例点击或订单。

旧实例、旧发布目录和源站备份继续保留，原 API 保持停止以避免双写。新站开始写入后，回退必须先停止新站并备份、同步最新数据，不能直接把解析切回旧库；schema 6 也不能直接运行较旧 schema 的代码。

## Windows 运行布局

- `C:\WusanAI\releases\20261031-tencent`：已构建的前端、服务端和 SHA-256 文件清单，Windows 上单独安装生产依赖，不复制 Linux node_modules。
- `C:\WusanAI\current`：指向当前发布目录的 junction。
- `C:\WusanAI\bin`：Node.js 24.22.0、Caddy 2.11.7、WinSW 2.12.0。Node SHA-256 和 Caddy SHA-512 对照发布方校验文件通过；WinSW 来自官方 HTTPS 发布，另核对传输前后 SHA-256。
- `C:\ProgramData\WusanAI\production.env`、`keys`：独立正式配置和密钥，未放入仓库或发布包。
- `C:\ProgramData\WusanAI\data\store.sqlite`：正式数据库，保留原账号哈希与业务记录。
- `C:\ProgramData\WusanAI\logs`、`caddy`：服务日志与 Caddy TLS 状态。
- `C:\ProgramData\WusanAI\backups`：受保护的本机数据库快照。

`WusanApi`、`WusanWeb` 使用 LocalService 并设置自动启动和失败重启。管理员及 SYSTEM 管理程序和配置；LocalService 对程序、环境和密钥仅读，对数据库、日志及 TLS 状态目录可写。密钥 ACL 已通过真实 NTFS 正反向检查：拒绝 Everyone 读取和 LocalService 写入。部署 SSH 已核对控制台返回的主机指纹，TCP/22 仅允许部署来源地址；来源 IP 变更时需同步更新云防火墙和 Windows 防火墙。

## HTTPS 与验收

公网 TCP/80、443 已放行，Caddy 自动跳转 HTTP 到 HTTPS，API 仅监听 `127.0.0.1:5182`，Caddy 管理端仅监听 `127.0.0.1:2019`。预览模板显式绑定 `127.0.0.1:8080`，正式配置不开放该端口。前端静态目录为 `current/dist`，环境文件、服务端源码和部署路径显式拒绝访问。

Let's Encrypt 正式证书已签发，域名为 `wusan-ai.store`，本次证书有效至 2027-01-29 UTC。Caddy 负责自动续期，需持续保留 DNS 指向、80/443 可达、TLS 状态目录和服务写权限。验收使用正常证书验证，没有关闭 TLS 校验。

公网桌面与 390px 手机访问、四个商品、详情表单、原后台账号登录、Secure/HttpOnly/SameSite Cookie、退出后未登录访问返回 401、私有路径返回 403、浏览器无运行异常均已通过。Windows 生产预检 10/10 通过，使用正式网关只读查询验证请求签名和支付宝响应验签，没有创建或支付真实订单。

## 数据库备份

计划任务 `WusanDailyBackup` 以 SYSTEM 在北京时间每天 03:00 执行：

```powershell
C:\WusanAI\bin\node.exe C:\WusanAI\current\scripts\backup-database.mjs C:\ProgramData\WusanAI\data\store.sqlite C:\ProgramData\WusanAI\backups
```

脚本使用 SQLite 在线备份，转为不依赖 WAL/SHM 的独立快照，完整性检查成功后才轮换超过 14 天的同名格式备份。已实际运行计划任务，退出码为 0，并在独立副本验证恢复。备份目录仅管理员和 SYSTEM 可访问。本机快照不能覆盖整台服务器丢失的风险，后续应另加异地备份。

## 支付状态与后续

正式应用继续使用 `2021007108662753`，PID `2088132908533024`；通知地址为 `https://wusan-ai.store/api/payments/alipay/notify`。测试与正式环境独立，正式配置保持 `ALIPAY_ENABLED=false`，商城“立即购买”仍不可支付。

迁移验收不能代替实际收款验收。开放购买前需确认当前签约、商品准入及经营资料，完成经授权的实际付款、归属与金额核对、异步通知及订单状态验收。此前正式只读查询成功不代表已完成真实付款。

## 官方依据

- OpenSSH：https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse
- 管理员公钥 ACL：https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration
- Caddy Windows 服务：https://caddyserver.com/docs/running#windows-service
- WinSW 2 配置：https://github.com/winsw/winsw/blob/v2.12.0/doc/xmlConfigFile.md
