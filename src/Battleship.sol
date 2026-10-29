// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, ebool, euint8, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// Battleship against a house fleet that nobody can see. The 8x8 board is split into four 4x4 sectors, one ship per
/// sector (lengths 4, 3, 3, 2). Each ship's orientation and position come from FHE randomness and stay encrypted;
/// every shot reveals only miss, hit or sunk.
///
/// Cell i is row i / 8, column i % 8. Bit i of a ship mask is 1 when the ship covers cell i.
contract Battleship {
    uint8 public constant MISS = 0;
    uint8 public constant HIT = 1;
    uint8 public constant SUNK = 2;

    struct Game {
        address player;
        uint64 shotMask; // cells fired at
        uint64 hitMask; // cells revealed as hits
        uint8 sunkMask; // bit q set when the ship in sector q is sunk
        uint8 shots;
        bool pending; // a shot is waiting for its reveal
        uint8 pendingCell;
        euint8 pendingResult;
        euint64[4] ships;
    }

    Game[] private games;
    mapping(address => uint256) public latestGame; // game id + 1, 0 when the player has none

    euint8 private missCode;
    euint8 private hitCode;
    euint8 private sunkCode;
    euint64 private zero64;

    event GameStarted(uint256 indexed gameId, address indexed player);
    event Shot(uint256 indexed gameId, uint8 cell, euint8 result);
    event Revealed(uint256 indexed gameId, uint8 cell, uint8 result);
    event Won(uint256 indexed gameId, uint8 shots);

    constructor() {
        missCode = FHE.asEuint8(MISS);
        hitCode = FHE.asEuint8(HIT);
        sunkCode = FHE.asEuint8(SUNK);
        zero64 = FHE.asEuint64(0);
        FHE.allowThis(missCode);
        FHE.allowThis(hitCode);
        FHE.allowThis(sunkCode);
        FHE.allowThis(zero64);
    }

    function shipLength(uint8 sector) public pure returns (uint8) {
        return sector == 0 ? 4 : sector == 3 ? 2 : 3;
    }

    /// The sector a cell belongs to: 0 top left, 1 top right, 2 bottom left, 3 bottom right.
    function sectorOf(uint8 cell) public pure returns (uint8) {
        return (cell / 32) * 2 + (cell % 8) / 4;
    }

    function newGame() external returns (uint256 gameId) {
        gameId = games.length;
        Game storage game = games.push();
        game.player = msg.sender;
        for (uint8 sector = 0; sector < 4; sector++) {
            game.ships[sector] = _placeShip(sector);
            FHE.allowThis(game.ships[sector]);
        }
        latestGame[msg.sender] = gameId + 1;
        emit GameStarted(gameId, msg.sender);
    }

    /// One random byte places the ship: bit 0 picks vertical or horizontal, bits 1-2 the line it sits on, bits 3-7
    /// (mod the free room) how far along that line it starts. The shape is shifted from the sector's top left corner.
    function _placeShip(uint8 sector) private returns (euint64) {
        uint8 len = shipLength(sector);
        uint64 corner = uint64(sector / 2) * 32 + uint64(sector % 2) * 4;
        uint64 horizontal = ((uint64(1) << len) - 1) << corner;
        uint64 vertical;
        for (uint8 i = 0; i < len; i++) vertical |= uint64(1) << (corner + i * 8);

        euint8 entropy = FHE.randomEuint8();
        ebool isVertical = FHE.eq(FHE.and(entropy, FHE.asEuint8(1)), FHE.asEuint8(1));
        euint8 line = FHE.and(FHE.shr(entropy, FHE.asEuint8(1)), FHE.asEuint8(3));
        euint8 along = FHE.rem(FHE.shr(entropy, FHE.asEuint8(3)), FHE.asEuint8(5 - len));

        euint8 row = FHE.select(isVertical, along, line);
        euint8 col = FHE.select(isVertical, line, along);
        euint8 offset = FHE.or(FHE.shl(row, FHE.asEuint8(3)), col);
        euint64 shape = FHE.select(isVertical, FHE.asEuint64(vertical), FHE.asEuint64(horizontal));
        return FHE.shl(shape, FHE.asEuint64(offset));
    }

    /// The cell is public; the result stays encrypted until revealed. The same operations run for every shot, so gas
    /// says nothing about the answer.
    function fire(uint256 gameId, uint8 cell) external {
        Game storage game = games[gameId];
        require(game.player == msg.sender, "not your game");
        require(game.sunkMask != 15, "game over");
        require(!game.pending, "reveal the last shot first");
        require(cell < 64, "cell out of range");
        uint64 bit = uint64(1) << cell;
        require(game.shotMask & bit == 0, "already fired there");

        euint64 ship = game.ships[sectorOf(cell)];
        ebool hit = FHE.ne(FHE.and(ship, FHE.asEuint64(bit)), zero64);
        // Sunk when no cell of the ship is left unhit, counting this one.
        ebool sunk = FHE.eq(FHE.and(ship, FHE.asEuint64(~(game.hitMask | bit))), zero64);
        euint8 result = FHE.select(hit, FHE.select(sunk, sunkCode, hitCode), missCode);
        FHE.allowThis(result);
        FHE.allowPublic(result);

        game.shotMask |= bit;
        game.shots += 1;
        game.pending = true;
        game.pendingCell = cell;
        game.pendingResult = result;
        emit Shot(gameId, cell, result);
    }

    /// Anyone can publish the decrypted result; the signature proves it came from CoFHE's threshold network.
    function reveal(uint256 gameId, uint8 result, bytes calldata signature) external {
        Game storage game = games[gameId];
        require(game.pending, "no shot to reveal");
        FHE.publishDecryptResult(game.pendingResult, result, signature);

        uint8 cell = game.pendingCell;
        game.pending = false;
        if (result != MISS) game.hitMask |= uint64(1) << cell;
        if (result == SUNK) game.sunkMask |= uint8(1) << sectorOf(cell);
        emit Revealed(gameId, cell, result);
        if (game.sunkMask == 15) emit Won(gameId, game.shots);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player,
            uint64 shotMask,
            uint64 hitMask,
            uint8 sunkMask,
            uint8 shots,
            bool pending,
            uint8 pendingCell,
            euint8 pendingResult
        )
    {
        Game storage game = games[gameId];
        return (game.player, game.shotMask, game.hitMask, game.sunkMask, game.shots, game.pending, game.pendingCell,
            game.pendingResult);
    }

    function gameCount() external view returns (uint256) {
        return games.length;
    }
}
