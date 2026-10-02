# CAW26 — Certificate verification upgrade

## What was added
| Feature | Where |
|---|---|
| Secure minting (admin-signed vouchers, `MINTER_ROLE` enforced) | `contracts/CampusAchievement.sol` |
| SHA-256 hash stored on-chain + `verifyHash()` | contract, `src/utils/hash.js`, `AdminPanel.jsx` |
| Verify by uploading the file | `src/pages/Verify.jsx` |
| Revocation (before or after claim) | contract `revokeByHash`, Admin → Issued Log → Revoke |
| Soulbound (ERC-5192, approvals blocked) | contract |
| Bulk issuance from CSV (one tx per 25 certs) | Admin → Bulk Issue |
| Audit log | Admin → Audit Log, `src/utils/audit.js` |
| Verifier role + dashboard | `/verifier`, tick "I am an employer / verifier" on profile |
| IPFS storage (Pinata) with automatic fallback | `api/pin.js`, `src/utils/ipfs.js` |

## Setup (in this order)
1. `npm run compile`
2. Optional: `EXTRA_MINTERS=0xOtherAdmin1,0xOtherAdmin2` (other admin wallets must hold MINTER_ROLE to sign vouchers)
3. `npm run deploy:baseSepolia`  → rewrites `src/config/contract.js` with the NEW address + ABI
4. IPFS (optional): in Vercel add `PINATA_JWT` and `ADMIN_WALLETS` (see `.env.example`). Without them the app falls back to database storage.
5. `npm run dev`

The address in `src/config/contract.js` is a zero placeholder until step 3.
Certificates minted on the old contract are not migrated.

## New issuing flow
1. Admin → Assign: file is pinned to IPFS, SHA-256 computed, admin signs a free voucher.
2. Student → Achievements → Claim NFT (gasless via UGF) sends the voucher; the contract checks the signature.
3. Verifier uploads the file at `/verify`; the browser hashes it and asks the contract.

Seeded demo certificates have no voucher: use Issued Log → "Approve all pending".

## Test the contract
`npx hardhat --config hardhat.config.cjs run scripts/security-test.cjs`

## Claim-flow fixes (v2)
| Problem | Fix |
|---|---|
| Claim cost ~4.6M gas (whole SVG stored on-chain), UGF/gas sponsors could reject it | Compact on-chain URI: ~640k gas (`useMintNFT.js`) |
| Student paid via UGF and only then saw a revert | Free pre-flight simulation + friendly reasons (`utils/revert.js`) |
| A tx to a wrong/zero address was saved as "claimed" with a fake token id | Token id now read only from OUR contract's `AchievementMinted` event |
| Mint OK but Firestore update failed = silent, then "Already issued" on retry | Error surfaced; pressing Claim again syncs an already-minted certificate |
| Button stuck on "Processing" if UGF window closed | 4-minute watchdog resets it |
| Admin signed vouchers with a wallet that had no MINTER_ROLE | `signVoucher` refuses; deploy grants roles to all site admins |
| Demo certificate auto-added to every new student | Off by default (`VITE_ENABLE_DEMO_CERT=true` to enable) |
| No health check / claim test / Firestore rules | `npm run doctor`, `npm test`, `firestore.rules`, `storage.rules` |
