// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice A fixed-supply demonstration token. The deployer distributes it to voters.
contract VoteToken is ERC20Burnable {
    constructor() ERC20("Ballot Vote Token", "VOTE") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}
