// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CampusAchievement
 * @dev Soulbound (ERC-5192), revocable, hash-verifiable certificate NFTs.
 *
 *  - SECURE MINTING: minting is only possible by (a) a MINTER_ROLE holder
 *    directly, or (b) anyone presenting a voucher signed by a MINTER_ROLE
 *    holder. This keeps the gasless "student claims" flow working while
 *    blocking unauthorised minting.
 *  - HASH VERIFICATION: every certificate stores a SHA-256 fingerprint
 *    (fileHash). `verifyHash` tells a verifier whether a document is
 *    authentic, revoked, or unknown.
 *  - SOULBOUND: no transfers, no approvals. Only mint and burn.
 *  - REVOCABLE: admin can revoke a token, or cancel a not-yet-claimed
 *    certificate by hash (so its voucher can no longer be used).
 *  - BULK: `batchMint` issues many certificates in a single transaction.
 */
contract CampusAchievement is ERC721, ERC721URIStorage, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _lastTokenId; // token ids start at 1 (0 means "none")

    struct Achievement {
        string title;
        string achievementType; // "certificate" | "badge" | "reward"
        string issuerName;
        string eventName;
        address studentAddress;
        uint256 issuedAt;
        bool verified;
        bool revoked;
        bytes32 fileHash;
    }

    mapping(uint256 => Achievement) public achievements;
    mapping(bytes32 => uint256) public hashToToken; // fileHash => tokenId
    mapping(bytes32 => bool) public hashRevoked;    // fileHash => cancelled/revoked

    event AchievementMinted(
        uint256 indexed tokenId,
        address indexed student,
        string title,
        string achievementType,
        string issuerName,
        uint256 timestamp
    );
    event CertificateHashRecorded(uint256 indexed tokenId, bytes32 indexed fileHash);
    event AchievementVerified(uint256 indexed tokenId, address indexed verifier);
    event AchievementRevoked(
        uint256 indexed tokenId,
        address indexed student,
        address indexed revokedBy,
        string reason,
        uint256 timestamp
    );
    event HashRevoked(bytes32 indexed fileHash, address indexed revokedBy, string reason);
    /// @dev ERC-5192: emitted when a token becomes locked (always, at mint)
    event Locked(uint256 tokenId);

    struct MintInput {
        address to;
        string tokenURI;
        string title;
        string achievementType;
        string issuerName;
        string eventName;
        bytes32 fileHash;
    }

    constructor(address defaultAdmin) ERC721("CampusAchievement", "CAW") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
    }

    // ------------------------------------------------------------------
    // Minting
    // ------------------------------------------------------------------

    /**
     * @dev Digest a MINTER_ROLE holder signs to authorise one certificate.
     *      Bound to this contract + chain so it cannot be replayed elsewhere.
     */
    function voucherDigest(
        address to,
        bytes32 fileHash,
        string memory title,
        string memory achievementType,
        string memory issuerName,
        string memory eventName
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                to,
                fileHash,
                keccak256(bytes(title)),
                keccak256(bytes(achievementType)),
                keccak256(bytes(issuerName)),
                keccak256(bytes(eventName))
            )
        );
    }

    /**
     * @param signature Admin voucher signature (ignored if caller is a minter)
     */
    function mintAchievement(
        address to,
        string memory _tokenURI,
        string memory title,
        string memory achievementType,
        string memory issuerName,
        string memory eventName,
        bytes32 fileHash,
        bytes memory signature
    ) public returns (uint256) {
        if (!hasRole(MINTER_ROLE, msg.sender)) {
            bytes32 digest = voucherDigest(to, fileHash, title, achievementType, issuerName, eventName)
                .toEthSignedMessageHash();
            address signer = digest.recover(signature);
            require(hasRole(MINTER_ROLE, signer), "Invalid issuer signature");
        }
        return _issue(MintInput(to, _tokenURI, title, achievementType, issuerName, eventName, fileHash));
    }

    /// @dev Bulk issuance in one transaction. Minter only.
    function batchMint(MintInput[] calldata items)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256[] memory ids)
    {
        require(items.length > 0 && items.length <= 100, "Batch size 1-100");
        ids = new uint256[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            ids[i] = _issue(items[i]);
        }
    }

    function _issue(MintInput memory m) internal returns (uint256 tokenId) {
        require(m.fileHash != bytes32(0), "Hash required");
        require(hashToToken[m.fileHash] == 0, "Already issued");
        require(!hashRevoked[m.fileHash], "Certificate revoked");

        tokenId = ++_lastTokenId;

        _safeMint(m.to, tokenId);
        _setTokenURI(tokenId, m.tokenURI);

        achievements[tokenId] = Achievement({
            title: m.title,
            achievementType: m.achievementType,
            issuerName: m.issuerName,
            eventName: m.eventName,
            studentAddress: m.to,
            issuedAt: block.timestamp,
            verified: true,
            revoked: false,
            fileHash: m.fileHash
        });
        hashToToken[m.fileHash] = tokenId;

        emit AchievementMinted(tokenId, m.to, m.title, m.achievementType, m.issuerName, block.timestamp);
        emit CertificateHashRecorded(tokenId, m.fileHash);
        emit Locked(tokenId);
    }

    // ------------------------------------------------------------------
    // Verification
    // ------------------------------------------------------------------

    /**
     * @notice Check a document fingerprint.
     * @return valid     true only if issued on-chain and not revoked
     * @return isRevoked true if the certificate was revoked / cancelled
     * @return tokenId   token id (0 if not minted)
     * @return student   wallet the certificate is bound to (0 if none)
     */
    function verifyHash(bytes32 fileHash)
        external
        view
        returns (bool valid, bool isRevoked, uint256 tokenId, address student)
    {
        tokenId = hashToToken[fileHash];
        isRevoked = hashRevoked[fileHash];
        if (tokenId != 0) student = achievements[tokenId].studentAddress;
        valid = tokenId != 0 && !isRevoked;
    }

    // ------------------------------------------------------------------
    // Revocation
    // ------------------------------------------------------------------

    /// @dev Revoke (burn) an issued certificate.
    function revokeAchievement(uint256 tokenId, string memory reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_exists(tokenId), "Token does not exist");
        _revoke(tokenId, reason);
    }

    /**
     * @dev Revoke by document hash. Works before AND after claiming:
     *      if not yet minted, the hash is blocked so its voucher becomes useless.
     */
    function revokeByHash(bytes32 fileHash, string memory reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(!hashRevoked[fileHash], "Already revoked");
        uint256 tokenId = hashToToken[fileHash];
        if (tokenId != 0 && _exists(tokenId)) {
            _revoke(tokenId, reason);
        } else {
            hashRevoked[fileHash] = true;
            emit HashRevoked(fileHash, msg.sender, reason);
        }
    }

    function _revoke(uint256 tokenId, string memory reason) internal {
        Achievement storage a = achievements[tokenId];
        address student = a.studentAddress;
        a.revoked = true;
        a.verified = false;
        hashRevoked[a.fileHash] = true;
        _burn(tokenId);
        emit AchievementRevoked(tokenId, student, msg.sender, reason, block.timestamp);
        emit HashRevoked(a.fileHash, msg.sender, reason);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getAchievement(uint256 tokenId) external view returns (Achievement memory) {
        require(_exists(tokenId), "Token does not exist");
        return achievements[tokenId];
    }

    /// @dev Works for revoked tokens too.
    function getAchievementRecord(uint256 tokenId) external view returns (Achievement memory) {
        return achievements[tokenId];
    }

    function totalMinted() external view returns (uint256) {
        return _lastTokenId;
    }

    function hasAchievement(address student, string memory title) external view returns (bool, uint256) {
        for (uint256 i = 1; i <= _lastTokenId; i++) {
            if (
                !achievements[i].revoked &&
                achievements[i].studentAddress == student &&
                keccak256(bytes(achievements[i].title)) == keccak256(bytes(title))
            ) {
                return (true, i);
            }
        }
        return (false, 0);
    }

    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, minter);
    }

    // ------------------------------------------------------------------
    // Soulbound (ERC-5192)
    // ------------------------------------------------------------------

    function locked(uint256 tokenId) external view returns (bool) {
        require(_exists(tokenId), "Token does not exist");
        return true;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721) {
        require(
            from == address(0) || to == address(0),
            "Soulbound: this certificate cannot be transferred"
        );
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: approvals disabled");
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert("Soulbound: approvals disabled");
    }

    // ------------------------------------------------------------------
    // Required overrides
    // ------------------------------------------------------------------

    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, AccessControl) returns (bool)
    {
        return interfaceId == 0xb45a3c0e || super.supportsInterface(interfaceId); // ERC-5192
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function _exists(uint256 tokenId) internal view override returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}
