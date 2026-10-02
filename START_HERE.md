# START HERE — CAW26 (fixed claim flow)

## Run it (first time)
1. `npm install --legacy-peer-deps`
2. Copy `.env.example` to `.env.local` and fill in the Firebase values + `DEPLOYER_PRIVATE_KEY`
   (use a TEST wallet only; never share this file or commit it).
3. `npm run compile`
4. `npm run deploy:baseSepolia`   ← writes the new contract address into `src/config/contract.js`
5. `npm run doctor`               ← must end with "All checks passed"
6. `npm run dev`                  ← open http://localhost:5173

Optional: `npm test` runs the contract + claim simulations on a private local chain (no internet, no cost).

## Firebase (once)
- Turn on **Firestore**.
- Publish the rules: `npm i -g firebase-tools && firebase login && firebase use <project-id> && npm run deploy:rules`
  (or paste `firestore.rules` into Console → Firestore → Rules).
- Wiping data: delete the documents in `certificates`, `users`, `auditLogs`. Nothing else needs deleting.
  The main admin profile is re-created automatically when that wallet logs in.

## What a student needs to claim
Base Sepolia network selected in the wallet, and EITHER a little test USDC (UGF gasless payment) OR a little
Base Sepolia ETH (press the "pay gas myself" fallback in the UGF window).

## Claim flow (what happens)
Admin assigns file -> SHA-256 + admin-signed voucher saved -> student presses Claim ->
free pre-flight check (revoked? already minted? voucher valid?) -> UGF payment -> contract mints ->
app reads the AchievementMinted event -> Firestore marked claimed.

## If a claim fails
Run `npm run doctor`. The error box now says the real reason in plain words.
Same file cannot be issued twice: after wiping Firestore, use NEW files or redeploy the contract
(old on-chain records are permanent).
