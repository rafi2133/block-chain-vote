# 配置、Sepolia 与完整应用部署

## 先验收学生合约

在项目根目录运行 `npm ci`，完成三个 TODO，然后运行：

```sh
npm run verify
```

未完成的占位函数会明确拒绝执行。`dev`、`dev:sepolia` 和根目录的 `deploy:sepolia` 命令在启动/部署前会检查占位代码并运行合约测试。

## A. 本机开发与 MetaMask 部署

复制 `.env.sepolia.example` 为 `.env.sepolia`。Windows 使用 `Copy-Item`，macOS/Linux 使用 `cp`。

| 参数 | 示例 | 用途 |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` | `https://sepolia.drpc.org` | 后端读取及验证；可换为自己的 Sepolia RPC |
| `PORT` | `3002` | 本机 Express API 端口 |
| `WEB_PORT` | `5175` | Vue 开发服务器端口 |
| `APP_ORIGIN` | `http://localhost:5175` | 浏览器实际访问源；不带路径或末尾斜杠 |
| `SEPOLIA_PRIVATE_KEY` | 不填写 | 仅可选 CLI 部署需要；MetaMask 路径不需要 |

链 ID 固定为 `11155111`，TOM 固定为 `0xE2311e42e7685f097efCf96aF6CeEF11d5Adbe54`（`shared/sepolia.ts`），费用固定为每票销毁 1 TOM。学生只需配置 RPC、端口和访问源，用自己的钱包部署自己的 Voting 合约。

```sh
npm run dev:sepolia
```

启动器编译你完成的 Solidity，然后启动 API 与 Vue。用装有 MetaMask 的浏览器访问打印的 `/sepolia` 页面：

1. 检查 TOM 信息和销毁规则。
2. 用自己的 Sepolia 钱包连接。该部署钱包会成为管理员；需要测试 ETH。
3. 选择 **Deploy with MetaMask** 并确认合约部署。
4. 等待两次确认。API 校验当前字节码、TOM 构造参数和部署管理员，保存你的部署描述文件。
5. 管理员创建候选人列表，录入 `student-01,0x...` 形式的选民绑定，依次确认创建、登记和发布。
6. 活动建议设置“5 分钟后开始，持续 0.25 小时”。必须在开始前完成发布。
7. 选民连接自己的钱包，选择候选人，确认所需授权和投票。每个选民需要 TOM、Sepolia ETH 和登记资格。

TOM 由教师分发；学生版不会自动领取或铸造 TOM。MetaMask 的钱包账户提供管理员身份，应用无需另填管理员私钥。Voting 地址、ABI、部署块等参数由程序生成，无需手工粘贴到前端。

如果关闭页面时部署已经广播，在 **Resume a submitted deployment** 中填写该交易哈希恢复验证，先检查回执再决定是否重新部署。

## B. 启动构建后的前端与 API

Vue 的构建产物由 Express 同时托管，无需运行 Vite：

```sh
cp .env.production.example .env.production
npm run verify
npm run start:sepolia
```

默认访问 `http://localhost:3002/sepolia`，`APP_ORIGIN=http://localhost:3002`。`start:sepolia` 优先加载 `.env.production`，否则加载 `.env.sepolia`。这一流程也允许在干净工作区的构建页面中完成首次 MetaMask 部署。

## C. 发布到自己的服务器

1. 将你完成的项目源码复制到服务器，例如 `/srv/voting-student-starter`。安装匹配的 Node.js 与 npm，执行 `npm ci` 和 `npm run verify`。本项目直接使用 `tsx` 运行后端，因此需要完整安装依赖，不能使用 `npm ci --omit=dev`。
2. 从 `.env.production.example` 创建 `.env.production`，设置服务器端 RPC、`PORT=3002` 和 `APP_ORIGIN=https://你的域名`。
3. 通过你的进程管理器持续运行 `npm run start:sepolia`。Express 监听 `127.0.0.1:3002`，放在同机 HTTPS 反向代理后面。
4. 配置域名、HTTPS 证书和反向代理，让页面与 `/api` 使用同一来源。已经配置 TLS 的 Nginx `server` 块可以使用：

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

5. 若在服务器页面首次部署，直接访问 `https://你的域名/sepolia` 并在自己的 MetaMask 中确认。若复用本机已经完成的部署，私下迁移**同一项目副本**的 `shared/deployments/11155111.json` 与 `server/data/sepolia.sqlite`，再启动服务。两者分别用于部署连接与应用元数据；只迁移合约地址无法恢复所有页面资料。
6. 检查 `/api/sepolia/status` 的 `ready=true`、`/api/health` 的链 ID 为 `11155111`，并完成一次钱包登录及实际投票验收。

域名、证书与服务器由学生/教师提供。不要通过 Vite 开发服务器公开托管课堂系统，也不要把 RPC 密钥放进 `VITE_*` 环境变量。

## 可选：Hardhat CLI 部署

在本机 `.env.sepolia` 设置自己 Sepolia 测试钱包的 `SEPOLIA_PRIVATE_KEY` 后：

```sh
npm run deploy:sepolia
npm run dev:sepolia
```

CLI 使用该钱包部署，仍绑定现有 TOM，并拒绝覆盖已有的 Sepolia 部署记录。通常优先使用 MetaMask，避免在配置文件中处理私钥。

## 重启、迁移与参数变化

- 重启 Sepolia 服务会复用当前目录自己的 `shared/deployments/11155111.json` 与 `server/data/sepolia.sqlite`。
- 数据库不保存链上计票权威，但包含候选人元数据、身份绑定与会话；应作私有备份。
- 改变开发端口时，同时更新 `WEB_PORT` 与 `APP_ORIGIN`；构建模式使用 API 端口对应的来源或 HTTPS 域名。
- 现有 Sepolia 合约不会因本地重新编译而改变。更换实现做新实验时，先备份旧项目，在新的干净副本中完成测试和新部署，不删除旧记录来尝试“修复”读取错误。
- RPC 请求失败时检查 `SEPOLIA_RPC_URL`、网络和限流；当前测试网服务使用单条 JSON-RPC 请求。
- 活动未发布就不能投票；截止时间由区块时间决定，不需要另发一笔“关闭活动”交易。`getResults` 可读取实时计数。
