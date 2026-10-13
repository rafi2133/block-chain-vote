// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VoteToken} from "./VoteToken.sol";

/// @notice Public, single-choice voting for a verified address list.
/// @dev This contract enforces one address / one vote, not real-world identity or secrecy.
contract Voting is ReentrancyGuard {
    enum State { Draft, Scheduled, Active, Ended }
    struct Election {
        address creator;
        uint64 startsAt;
        uint64 endsAt;
        uint32 candidateCount;
        bytes32 metadataHash;
        bool published;
        uint256 eligibleVoterCount;
        uint256 totalVotes;
    }

    address public immutable admin;
    VoteToken public immutable voteToken;
    uint256 public constant voteCost = 1e18;
    uint256 public electionCount;
    uint256 public constant MAX_CANDIDATES = 20;
    uint256 public constant MAX_ELIGIBILITY_BATCH = 100;
    mapping(uint256 => Election) private elections;
    mapping(uint256 => mapping(address => bool)) public eligible;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint256 => uint256)) public voteCounts;

    /// @dev Teaching-only placeholder; replace each TODO body with your implementation.
    error StudentImplementationRequired(uint8 taskId);

    error Unauthorized();
    error ElectionNotFound();
    error InvalidConfiguration();
    error InvalidTimeWindow();
    error ElectionFrozen();
    error NoEligibleVoters();
    error InvalidBatch();
    error InvalidAddress();
    error NotPublished();
    error VotingNotOpen();
    error NotEligible();
    error AlreadyVoted();
    error InvalidCandidate();

    event ElectionCreated(uint256 indexed electionId, address indexed creator, bytes32 metadataHash);
    event DraftUpdated(uint256 indexed electionId, bytes32 metadataHash);
    event EligibilityUpdated(uint256 indexed electionId, address indexed voter, bool isEligible);
    event ElectionPublished(uint256 indexed electionId);
    event VoteCast(uint256 indexed electionId, address indexed voter, uint256 indexed candidateId);
    event VoteTokenBurned(uint256 indexed electionId, address indexed voter, uint256 amount);

    constructor(address tokenAddress) {
        if (tokenAddress.code.length == 0) revert InvalidConfiguration();
        voteToken = VoteToken(tokenAddress);
        if (voteToken.decimals() != 18) revert InvalidConfiguration();
        admin = msg.sender;
    }

    function createElection(uint32 candidateCount, bytes32 metadataHash, uint64 startsAt, uint64 endsAt)
        external returns (uint256 electionId)
    {
        if (msg.sender != admin) revert Unauthorized();
        _validate(candidateCount, metadataHash, startsAt, endsAt);
        electionCount += 1;
        electionId = electionCount;

        elections[electionId] = Election({
            creator: msg.sender,
            startsAt: startsAt,
            endsAt: endsAt,
            candidateCount: candidateCount,
            metadataHash: metadataHash,
            published: false,
            eligibleVoterCount: 0,
            totalVotes: 0
        });

        emit ElectionCreated(electionId, msg.sender, metadataHash);
    }

    function updateDraft(uint256 electionId, uint32 candidateCount, bytes32 metadataHash, uint64 startsAt, uint64 endsAt)
        external
    {
        Election storage election = _draft(electionId);
        _validate(candidateCount, metadataHash, startsAt, endsAt);
        election.candidateCount = candidateCount;
        election.metadataHash = metadataHash;
        election.startsAt = startsAt;
        election.endsAt = endsAt;
        emit DraftUpdated(electionId, metadataHash);
    }

    function setEligibility(uint256 electionId, address[] calldata voters, bool isEligible) external {
        Election storage election = _draft(electionId);
        if (voters.length == 0 || voters.length > MAX_ELIGIBILITY_BATCH) revert InvalidBatch();
        for (uint256 i; i < voters.length; ++i) {
            address voter = voters[i];
            if (voter == address(0)) revert InvalidAddress();
            if (eligible[electionId][voter] == isEligible) continue;
            eligible[electionId][voter] = isEligible;
            if (isEligible) ++election.eligibleVoterCount;
            else --election.eligibleVoterCount;
            emit EligibilityUpdated(electionId, voter, isEligible);
        }
    }

    function publishElection(uint256 electionId) external {
        Election storage election = _draft(electionId);
        if (block.timestamp >= election.startsAt) revert InvalidTimeWindow();
        if (election.eligibleVoterCount == 0) revert NoEligibleVoters();
        election.published = true;
        emit ElectionPublished(electionId);
    }

    function vote(uint256 electionId, uint256 candidateId) external nonReentrant {
        Election storage election = _existing(electionId);
        if (!election.published) revert NotPublished();
        if (block.timestamp < election.startsAt || block.timestamp >= election.endsAt) revert VotingNotOpen();
        if (!eligible[electionId][msg.sender]) revert NotEligible();
        if (hasVoted[electionId][msg.sender]) revert AlreadyVoted();
        if (candidateId >= election.candidateCount) revert InvalidCandidate();

        hasVoted[electionId][msg.sender] = true;
        voteCounts[electionId][candidateId] += 1;
        election.totalVotes += 1;

        voteToken.burnFrom(msg.sender, voteCost);
        emit VoteTokenBurned(electionId, msg.sender, voteCost);
        emit VoteCast(electionId, msg.sender, candidateId);
    }

    function getElection(uint256 electionId) external view returns (Election memory election, State state) {
        election = _existing(electionId);
        state = getState(electionId);
    }

    function getState(uint256 electionId) public view returns (State) {
        Election storage election = _existing(electionId);
        if (!election.published) return State.Draft;
        if (block.timestamp < election.startsAt) return State.Scheduled;
        if (block.timestamp < election.endsAt) return State.Active;
        return State.Ended;
    }

    function getResults(uint256 electionId) external view returns (uint256[] memory counts) {
        Election storage election = _existing(electionId);
        counts = new uint256[](election.candidateCount);

        for (uint256 candidateId; candidateId < election.candidateCount; ++candidateId) {
            counts[candidateId] = voteCounts[electionId][candidateId];
        }
    }

    function getVoterStatus(uint256 electionId, address voter) external view returns (bool isEligible, bool voted) {
        _existing(electionId);
        return (eligible[electionId][voter], hasVoted[electionId][voter]);
    }

    function _existing(uint256 electionId) private view returns (Election storage election) {
        election = elections[electionId];
        if (election.creator == address(0)) revert ElectionNotFound();
    }

    function _draft(uint256 electionId) private view returns (Election storage election) {
        election = _existing(electionId);
        if (msg.sender != election.creator) revert Unauthorized();
        if (election.published) revert ElectionFrozen();
    }

    function _validate(uint32 candidateCount, bytes32 metadataHash, uint64 startsAt, uint64 endsAt) private view {
        if (candidateCount < 2 || candidateCount > MAX_CANDIDATES || metadataHash == bytes32(0)) revert InvalidConfiguration();
        if (startsAt <= block.timestamp || endsAt <= startsAt) revert InvalidTimeWindow();
    }
}
