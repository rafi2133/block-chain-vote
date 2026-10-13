# Voting Smart Contract — Pseudocode and Flowcharts

Source: [`Voting.sol`](../contracts/contracts/Voting.sol), [`VoteToken.sol`](../contracts/contracts/VoteToken.sol), and the installed OpenZeppelin `ReentrancyGuard` / `ERC20Burnable` implementations. This document follows the current source, including the order of checks, state writes, and events.

Editable flowcharts: [`voting-contract-flow.drawio`](diagrams/voting-contract-flow.drawio).

- Page 1: `Vote Execution` — the exact voting path and its failure branches.
- Page 2: `Election Lifecycle` — preparation, publication, time-based states, and result reads.

PNG exports: [Vote Execution](diagrams/voting-contract-flow.drawio.png) · [Election Lifecycle](diagrams/voting-contract-lifecycle.drawio.png).

## 1. State and conventions

```text
CONSTANT VOTE_COST = 10^18       // 1 whole Token with 18 decimals
CONSTANT MAX_CANDIDATES = 20
CONSTANT MAX_ELIGIBILITY_BATCH = 100

IMMUTABLE admin
IMMUTABLE voteToken
electionCount = 0
reentrancyGuard = NOT_ENTERED   // Initialized by the inherited guard constructor

Election:
    creator
    startsAt, endsAt            // Unix timestamps, in seconds
    candidateCount
    metadataHash               // Commitment to off-chain election metadata
    published
    eligibleVoterCount
    totalVotes

elections[electionId] -> Election
eligible[electionId][wallet] -> Boolean, initially false
hasVoted[electionId][wallet] -> Boolean, initially false
voteCounts[electionId][candidateId] -> Integer, initially 0

sender = msg.sender             // The caller of the current contract function
now = block.timestamp           // The timestamp of the executing block
REVERT(error)                   // Abort this call and roll back its state writes/logs
```

On Sepolia, `voteToken` refers to the existing TOM Token. The local demo uses `VoteToken` (`VOTE`). The voting algorithm depends on the configured Token contract, rather than a hard-coded Token symbol.

## 2. Deployment and shared validation

```text
CONSTRUCTOR(tokenAddress):
    IF tokenAddress has no deployed code:
        REVERT InvalidConfiguration
    voteToken = contract at tokenAddress
    IF voteToken.decimals() != 18:
        REVERT InvalidConfiguration
    admin = sender

FUNCTION EXISTING(electionId):
    election = storage reference to elections[electionId]
    IF election.creator == ZERO_ADDRESS:
        REVERT ElectionNotFound
    RETURN election

FUNCTION DRAFT(electionId):
    election = EXISTING(electionId)
    IF sender != election.creator:
        REVERT Unauthorized
    IF election.published:
        REVERT ElectionFrozen
    RETURN election

FUNCTION VALIDATE(candidateCount, metadataHash, startsAt, endsAt):
    IF candidateCount < 2 OR candidateCount > MAX_CANDIDATES
       OR metadataHash == ZERO_HASH:
        REVERT InvalidConfiguration
    IF startsAt <= now OR endsAt <= startsAt:
        REVERT InvalidTimeWindow
```

## 3. Create and configure an election

```text
FUNCTION createElection(candidateCount, metadataHash, startsAt, endsAt):
    IF sender != admin:
        REVERT Unauthorized
    VALIDATE(candidateCount, metadataHash, startsAt, endsAt)

    electionCount = electionCount + 1
    electionId = electionCount
    elections[electionId] = Election(
        creator = sender,
        startsAt = startsAt,
        endsAt = endsAt,
        candidateCount = candidateCount,
        metadataHash = metadataHash,
        published = false,
        eligibleVoterCount = 0,
        totalVotes = 0
    )
    EMIT ElectionCreated(electionId, sender, metadataHash)
    RETURN electionId

FUNCTION updateDraft(electionId, candidateCount, metadataHash, startsAt, endsAt):
    election = DRAFT(electionId)
    VALIDATE(candidateCount, metadataHash, startsAt, endsAt)
    election.candidateCount = candidateCount
    election.metadataHash = metadataHash
    election.startsAt = startsAt
    election.endsAt = endsAt
    EMIT DraftUpdated(electionId, metadataHash)

FUNCTION setEligibility(electionId, voters[], isEligible):
    election = DRAFT(electionId)
    IF length(voters) == 0 OR length(voters) > MAX_ELIGIBILITY_BATCH:
        REVERT InvalidBatch

    FOR EACH voter IN voters:
        IF voter == ZERO_ADDRESS:
            REVERT InvalidAddress
        IF eligible[electionId][voter] == isEligible:
            CONTINUE           // Duplicate/no-op entries do not change the count

        eligible[electionId][voter] = isEligible
        IF isEligible:
            election.eligibleVoterCount += 1
        ELSE:
            election.eligibleVoterCount -= 1
        EMIT EligibilityUpdated(electionId, voter, isEligible)
```

The contract checks wallet addresses against the stored list. Real-world student identity verification belongs to the application workflow.

## 4. Publish the election

```text
FUNCTION publishElection(electionId):
    election = DRAFT(electionId)
    IF now >= election.startsAt:
        REVERT InvalidTimeWindow
    IF election.eligibleVoterCount == 0:
        REVERT NoEligibleVoters

    election.published = true
    EMIT ElectionPublished(electionId)
```

Publication freezes the configuration and eligible-wallet list. It makes the election available for voting at its scheduled start time.

## 5. Vote — exact contract execution order

```text
FUNCTION vote(electionId, candidateId) WITH nonReentrant:
    // OpenZeppelin modifier, before the function body:
    IF reentrancyGuard == ENTERED:
        REVERT ReentrancyGuardReentrantCall
    reentrancyGuard = ENTERED

    election = EXISTING(electionId)
    IF NOT election.published:
        REVERT NotPublished
    IF now < election.startsAt OR now >= election.endsAt:
        REVERT VotingNotOpen
    IF NOT eligible[electionId][sender]:
        REVERT NotEligible
    IF hasVoted[electionId][sender]:
        REVERT AlreadyVoted
    IF candidateId >= election.candidateCount:
        REVERT InvalidCandidate

    // Effects: provisional writes within this transaction.
    hasVoted[electionId][sender] = true
    voteCounts[electionId][candidateId] += 1
    election.totalVotes += 1

    // Interaction: Voting is the spender; sender is the Token owner.
    CALL voteToken.burnFrom(sender, VOTE_COST)
    // No Boolean return value is checked.
    // If the call reverts, propagate its error and revert the voting writes.

    EMIT VoteTokenBurned(electionId, sender, VOTE_COST)
    EMIT VoteCast(electionId, sender, candidateId)

    // OpenZeppelin modifier, after the function body:
    reentrancyGuard = NOT_ENTERED
    RETURN                     // No explicit return value in Solidity
```

`candidateId` is an unsigned integer. Valid candidate IDs are `0` through `candidateCount - 1`.

For the local OpenZeppelin-based Token, `burnFrom` performs the following operations. Sepolia TOM must provide compatible behavior:

```text
TOKEN FUNCTION burnFrom(owner, amount):
    spender = caller           // The Voting contract in the voting transaction
    SPEND_ALLOWANCE(owner, spender, amount)
        // Revert if the allowance is insufficient.
        // Decrease a finite allowance; an unlimited allowance stays unchanged.
    BURN(owner, amount)
        // Revert if the owner address/balance is invalid.
        // Reduce owner's balance and totalSupply.
        // Emit Transfer(owner, ZERO_ADDRESS, amount).
```

The vote and Token burn execute in one transaction. If the burn fails, `hasVoted`, candidate counts, `totalVotes`, Token writes, and that transaction's logs all roll back. The stored `eligible` flag is not consumed or changed by `vote`.

An earlier successful `approve` transaction remains effective if a later voting transaction fails. A reverted on-chain transaction can still consume ETH Gas.

### Voting failures

| Check | Failure |
| --- | --- |
| Reentrancy guard is already entered | `ReentrancyGuardReentrantCall` |
| Election ID has no creator | `ElectionNotFound` |
| Election is still a draft | `NotPublished` |
| `now < startsAt` or `now >= endsAt` | `VotingNotOpen` |
| Sender is not in the eligible list | `NotEligible` |
| Sender has already voted in this election | `AlreadyVoted` |
| `candidateId >= candidateCount` | `InvalidCandidate` |
| Token allowance is insufficient | Token error, e.g. `ERC20InsufficientAllowance` |
| Token balance is insufficient | Token error, e.g. `ERC20InsufficientBalance` |

## 6. Read states, results, and voter status

```text
FUNCTION getState(electionId):
    election = EXISTING(electionId)
    IF NOT election.published:
        RETURN Draft
    IF now < election.startsAt:
        RETURN Scheduled
    IF now < election.endsAt:
        RETURN Active
    RETURN Ended

FUNCTION getElection(electionId):
    election = COPY OF EXISTING(electionId)
    RETURN (election, getState(electionId))

FUNCTION getResults(electionId):
    election = EXISTING(electionId)
    counts = NEW ARRAY OF ZEROS(length = election.candidateCount)
    FOR candidateId FROM 0 TO election.candidateCount - 1:
        counts[candidateId] = voteCounts[electionId][candidateId]
    RETURN counts

FUNCTION getVoterStatus(electionId, voter):
    EXISTING(electionId)
    RETURN (eligible[electionId][voter], hasVoted[electionId][voter])
```

`getState` derives the state from publication and the current block timestamp. There is no administrator `closeElection` or `publishResults` function. `getResults` can read current counts before the election ends; the application decides when to display them as final results.

## 7. MetaMask preparation — outside the Voting contract

This application sequence is shown for context. It is separate from the contract's `vote` function.

```text
Connect MetaMask and select the required chain/account.
Read election configuration, eligibility, and Token balance.
Verify the metadata hash and candidate selection.

IF Token allowance(wallet, Voting.address) < VOTE_COST:
    Request MetaMask confirmation for Token.approve(Voting.address, VOTE_COST).
    Wait for a successful approval receipt.

Request MetaMask confirmation for Voting.vote(electionId, candidateId).
Wait for a successful voting receipt.
Refresh the on-chain results, voter status, and Token balance.
```

Approval changes the Token spending allowance. It does not record a vote or burn a Token. Each vote remains subject to the contract checks at execution time.

## 8. Classroom examples

| Example | Outcome |
| --- | --- |
| Eligible wallet, correct allowance/balance, valid candidate, `now == startsAt` | Vote succeeds; 1 TOM is burned on Sepolia |
| Same wallet votes again in the same election | `AlreadyVoted`; tally unchanged |
| Valid wallet with zero allowance | Token burn fails; all voting writes roll back |
| Correct allowance but zero Token balance | Token burn fails; tally and allowance changes in the failed vote roll back |
| Any vote at `now == endsAt` | `VotingNotOpen` |
| Wallet votes in a different election where it is eligible | Independent eligibility and repeat-vote checks |

Successful voting preserves `sum(voteCounts[electionId]) == totalVotes` and allows at most one vote per eligible wallet per election.
