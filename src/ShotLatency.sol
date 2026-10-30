// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, ebool, euint64, externalEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// One Battleship shot, end to end: an encrypted 64-cell board, a public shot at one cell, hit or miss computed under
/// FHE, and the answer published onchain with the decrypt signature.
contract ShotLatency {
    address public immutable owner = msg.sender;
    euint64 private board;
    ebool[] public shots;

    event BoardSet();
    event Shot(uint256 indexed id, uint8 cell, ebool hit);
    event Revealed(uint256 indexed id, bool hit);

    /// Bit i of the board is 1 when a ship covers cell i. Nobody, this contract included, can read it. Only the
    /// deployer sets it, so the benchmark always checks answers against its own board.
    function setBoard(externalEuint64 encryptedBoard, bytes calldata proof) external {
        require(msg.sender == owner, "only owner");
        board = FHE.asEuint64(encryptedBoard, proof);
        FHE.allowThis(board);
        emit BoardSet();
    }

    /// The cell is public (everyone sees where you fired); whether it hit stays encrypted until revealed.
    function fire(uint8 cell) external returns (uint256 id) {
        require(cell < 64, "cell out of range");
        euint64 mask = FHE.asEuint64(uint256(1) << cell);
        ebool hit = FHE.ne(FHE.and(board, mask), FHE.asEuint64(0));
        FHE.allowThis(hit);
        FHE.allowPublic(hit);
        id = shots.length;
        shots.push(hit);
        emit Shot(id, cell, hit);
    }

    function reveal(uint256 id, bool hit, bytes calldata signature) external {
        FHE.publishDecryptResult(shots[id], hit, signature);
        emit Revealed(id, hit);
    }
}
