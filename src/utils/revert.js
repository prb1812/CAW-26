// Turns raw blockchain / wallet / UGF errors into messages a student can act on.
// Pure JS (no import.meta) so it can also be unit-tested with plain node.
const RULES = [
  [/Invalid issuer signature/i,
    "The issuer's approval signature is not valid on the deployed contract. Ask the admin to open Admin → Issued Log and approve this certificate again (the admin wallet must hold MINTER_ROLE on the current contract)."],
  [/Already issued/i,
    "This certificate document has already been minted on-chain. Press Claim again so your dashboard can sync with it."],
  [/Certificate revoked/i, "This certificate was revoked by the issuer."],
  [/Hash required/i, "This certificate has no document fingerprint yet. Ask the admin to approve it first."],
  [/Soulbound/i, "This certificate is soulbound (non-transferable)."],
  [/user rejected|user denied|ACTION_REJECTED|rejected the request/i, "You cancelled the request in your wallet."],
  [/insufficient funds|exceeds the balance|insufficient balance/i,
    "Not enough balance to pay for this transaction. Add a little Base Sepolia ETH (or the USDC UGF asks for) and try again."],
  [/nonce too low|replacement transaction underpriced/i, "Your wallet has a pending transaction. Wait a minute or reset the account in MetaMask, then retry."],
  [/network|chain.*mismatch|wrong network|unsupported chain/i, "Please switch your wallet to Base Sepolia and try again."],
  [/missing revert data|CALL_EXCEPTION/i,
    "The contract rejected this claim (no reason given). Most often the app is still pointing at an old or wrong contract address — run `npm run doctor`."],
  [/timeout|timed out|failed to fetch|429|rate limit/i, "The network is slow or rate-limited right now. Wait a few seconds and try again."],
];

export function explainRevert(err) {
  const raw = [
    err?.revert?.args?.[0],
    err?.reason,
    err?.shortMessage,
    err?.info?.error?.message,
    err?.error?.message,
    err?.message,
  ].filter(Boolean).join(" | ");
  for (const [re, msg] of RULES) if (re.test(raw)) return msg;
  return raw ? raw.slice(0, 220) : "Unknown error while claiming.";
}
