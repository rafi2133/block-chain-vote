# 智能合约核心代码任务

只编辑 `contracts/contracts/Voting.sol` 的三处 `TODO SC-01/02/03`。函数签名、数据结构、公开映射、事件、费用常量和辅助方法与前后端接口保持一致。

## SC-01：创建选举

完成 `createElection`：

1. 只有部署时的管理员可以调用，其他地址触发 `Unauthorized`。
2. 调用提供的 `_validate` 检查候选人数、元数据哈希与时间。
3. 递增 `electionCount`，第一个 ID 为 1。
4. 保存完整 `Election`；初始 `published=false`，人数和总票数均为 0。
5. 发出 `ElectionCreated` 并返回 ID。

验收命令：`npm run test:task1`。

## SC-02：校验、计票与销毁 Token

完成 `vote`，保留提供的 `nonReentrant` 修饰器：

1. 活动存在：使用 `_existing`。
2. 已发布；否则 `NotPublished`。
3. 执行时满足 `startsAt <= block.timestamp < endsAt`；否则 `VotingNotOpen`。
4. `msg.sender` 合资格；否则 `NotEligible`。
5. 该地址在本场尚未投过；否则 `AlreadyVoted`。
6. 无符号候选人 ID 小于 `candidateCount`；否则 `InvalidCandidate`。
7. 更新 `hasVoted`、对应候选人票数和 `totalVotes`。
8. 调用 `voteToken.burnFrom(msg.sender, voteCost)`。不要捕获失败后继续计票；失败必须传播并回滚整笔投票。
9. 依次发出 `VoteTokenBurned`、`VoteCast`。

`voteCost` 为 `10^18` 最小单位，即 18 位精度的一枚 Token。`eligible` 标记不因投票变成 false；重复投票由 `hasVoted` 控制。候选人从 0 编号。

验收命令：`npm run test:task2`。这一阶段的测试直接读取公开映射，不依赖 SC-03，方便单独排查投票实现。

## SC-03：读取票数

完成 `getResults`：

1. 检查选举存在。
2. 创建长度为 `candidateCount` 的内存数组。
3. 按候选人编号复制 `voteCounts`，返回数组。

结果读取不需要管理员权限，也不要求活动已结束。`getState` 会根据发布标记和链上时间返回 Draft、Scheduled、Active、Ended。

验收命令：`npm run test:task3`。

## 保持不变的接口

`updateDraft`、`setEligibility`、`publishElection`、`getState`、`getElection`、`getVoterStatus`、构造函数和辅助校验已经完成。它们负责名单、发布冻结与状态读取；无需另行实现后端代投或钱包私钥签名。

辅助材料：[伪代码](CONTRACT_PSEUDOCODE.md)、[合约流程图](diagrams/voting-contract-flow.drawio)、[功能结构图](diagrams/voting-system-architecture.drawio)。

## 提交清单

- 完成的项目源码和 `npm run verify` 通过记录。
- 一次本地成功投票：交易哈希、候选人票数、Token 余额变化。
- 至少一次失败投票的解释：重复、无资格、授权不足或余额不足。
- Sepolia Chain ID、你自己的 Voting 地址、TOM 地址、管理员地址。
- 一次 Sepolia 成功投票的回执及其 `VoteCast` / `VoteTokenBurned` / TOM `Transfer` 事件。
- 解释为什么 `approve` 不等于投票、为什么 Token 销毁失败不会留下计票变化。

提交源码时不打包 `node_modules`、真实 `.env`、SQLite、会话、私钥或助记词。自己的数据库与部署描述文件应留在本机/服务器并作私有备份，以便恢复页面数据。
