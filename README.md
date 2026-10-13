# Ballot — 学生填空项目

学生只需完成 `contracts/contracts/Voting.sol` 的三个核心函数。Vue 前端、Express API、MetaMask 交互、ERC-20 Token、选举发布流程和部署工具已经提供。界面、代码标注及图中文字使用英文。

| 任务 | 函数 | 实现内容 |
| --- | --- | --- |
| SC-01 | `createElection` | 管理员权限、配置校验、创建草稿、递增编号、事件和返回值 |
| SC-02 | `vote` | 投票条件、禁止重复、计票、销毁 1 枚 Token、事件与原子回滚 |
| SC-03 | `getResults` | 检查活动存在、按候选人顺序返回票数数组 |

每处 TODO 暂时执行 `revert StudentImplementationRequired(taskId)`。未填完时**编译可以成功，测试预期失败**；这是练习的初始状态。不要通过删除测试、改函数接口、取消 `nonReentrant` 或绕过 Token 销毁来消除失败。

占位函数总是回退，因此初次编译的“未使用参数”“不可达代码”等警告是预期现象；补全逻辑后再检查实际剩余警告。

## 1. 安装与完成合约

需要 Node.js **24.12+ 的受支持偶数版本**、npm，以及装有 MetaMask 的浏览器。参考验证环境使用 Node.js 26。

在解压后的项目根目录执行：

```sh
npm ci
npm run compile
npm run test:task1
```

按 `SC-01 → SC-02 → SC-03` 的顺序填写 `Voting.sol`。使用对应测试查看进度：

```sh
npm run test:task1
npm run test:task2
npm run test:task3
npm run test:tasks
```

SC-02 和 SC-03 的测试需要已完成 SC-01；包含实际选票的 SC-03 测试还需要 SC-02。最后执行完整验收：

```sh
npm run verify
```

这会检查占位代码、运行全部合约与 API 测试、执行类型检查并构建前端。编译产物由你完成的合约生成，项目未提供已完成合约的 ABI/字节码来替代作业。

## 2. 运行完整本地系统

```sh
npm run dev
```

启动器先验收合约，然后启动 Hardhat、部署本地 VOTE 与 Voting、分发演示 Token、创建两场演示投票，并启动 Express 与 Vue。打开它打印的 `http://localhost:...` 地址。

默认本地链为 `http://127.0.0.1:8545`，Chain ID 为 `31337`。API 从 `3001` 启动；前端通常从 `5173` 启动。若已有同端口项目，请停止你自己那份旧项目，或为 API/前端设置 `.env`。本地链使用固定端口 `8545`。

1. 打开 **MetaMask setup**，按页面说明导入公开的 **Voter 01** 本地测试账户。
2. 连接 MetaMask，切换到 Hardhat Local，并签署登录消息。
3. 打开 **Campus improvement fund**，选择候选人并点击 **Cast vote**。
4. 依次确认 `approve`（额度不足时）和 `vote`，检查成功回执、票数和余额变化。
5. 切换为 **Administrator** 测试账户后，可使用 **Create election** 创建自己的活动。

公开 Hardhat 账户仅用于本地测试，不能用于 Sepolia。`npm run dev` 重启会创建新的本地链；Sepolia 的已确认选票保留在测试网上。

## 3. 配置并部署到 Sepolia

```sh
# macOS / Linux；Windows 可使用 Copy-Item .env.sepolia.example .env.sepolia
cp .env.sepolia.example .env.sepolia
npm run dev:sepolia
```

在 MetaMask 浏览器打开打印的 `/sepolia` 页面，用**自己的 Sepolia 钱包**连接并选择 **Deploy with MetaMask**。确认部署，等待两次确认后，系统自动保存你自己的 Voting 地址并激活工作区。

这里复用教师提供的 TOM：`0xE2311e42e7685f097efCf96aF6CeEF11d5Adbe54`，每次成功投票销毁 **1 TOM**。管理员需要 Sepolia ETH；选民需要 Sepolia ETH、至少 1 TOM，以及已登记的投票资格。TOM 不由学生版自动铸造，需要教师分发。

详细参数、投票步骤、重启与网站部署见 [部署指南](docs/DEPLOYMENT.md)。默认 MetaMask 流程不需要在文件中填写私钥或助记词。

## 4. 提供的项目内容

```text
contracts/contracts/Voting.sol  仅三个核心函数留空
contracts/contracts/VoteToken.sol
contracts/test/StudentTasks.ts  分任务验收
contracts/test/Voting.ts        完整规则回归测试
server/src/                    已完成的 API、身份验证、SQLite、链上读取
web/src/                       已完成的 Vue 页面、MetaMask 交互和样式
shared/                        类型、Token 配置与部署验证
scripts/                       本地启动、数据初始化、Sepolia 启动
docs/ASSIGNMENT.md              任务要求和提交清单
docs/CONTRACT_PSEUDOCODE.md      合约伪代码
docs/diagrams/                 可编辑 draw.io 与 PNG
```

这里只包含源码、依赖锁文件和配置示例。数据库、部署描述文件和编译产物会在你自己的运行过程中生成。

## 常见问题

- `StudentImplementationRequired(1/2/3)`：对应 TODO 尚未完成。
- `NotPublished`：创建交易成功后，还需要登记选民并发布；可在草稿页恢复发布。
- 确认过钱包但票数为 0：区分登录签名、Token 授权和投票；以投票回执为准。
- `Unable to read the workspace`：先检查 API 与 RPC；读取失败不代表链上选票被删除。
- `Request origin is not allowed`：访问地址必须与 `APP_ORIGIN` 一致，包括协议和端口。
- 部署后改了 Solidity：先完成测试；已有合约不会因修改本地文件而更新。新实验使用新的项目副本和自己的新部署。
