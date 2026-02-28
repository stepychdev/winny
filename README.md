# Winny — the fairest social jackpot on-chain (Solana)

Website: https://winny-woad.vercel.app  
Solana Program: https://solscan.io/account/3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj

Winny is an on-chain SocialFi jackpot game on Solana.

Players can join rounds with USDC or with any supported SPL asset in their wallet. If the asset is not USDC, Winny routes it through Jupiter and normalizes the entry into real received USDC, so tickets are always based on actual value received on-chain:

**`$1 = 100 tickets`**

---

## What We Built During the Hackathon

We implemented the full playable game loop:

- users join rounds with USDC or other SPL assets
- non-USDC deposits are swapped into USDC through Jupiter Metis / Swap API
- rounds update live with pot, participants, and odds
- when the timer ends, the round locks
- MagicBlock VRF is requested
- winner selection is executed fully on-chain
- winner claims the pot (or uses Degen Claim Mode)

Additional systems we built:

- batch deposits (multiple assets in one entry flow)
- refund and auto-claim flows
- live participant feed and round history
- fairness and verification views
- chat, social feed, follow mechanics, missions, and leaderboard-style game features
- multisig admin tooling and protocol automation

---

## Unique Mechanic: Degen Claim Mode

Alongside a normal USDC claim, Winny includes **Degen Claim Mode**.

Instead of taking the prize in USDC, the winner can opt into a randomized token payout flow. This is designed to make the product feel more social, more streamable, and more *"what did I just win?"* than a standard jackpot UI.

We built the first production-oriented version of this flow and designed a more advanced executor-based architecture for future iterations.

---

## Sponsor Technologies We Used

### MagicBlock

We are applying for the MagicBlock track because MagicBlock is at the core of our fairness model.

We used:

- MagicBlock VRF for winner selection
- VRF-based on-chain settlement logic
- a second VRF-driven path for degen-claim design and testing

This is what makes the game provably fair without hidden server-side randomness.

### Tapestry

We are applying for the Tapestry track because Winny is not just a jackpot contract, it is a social game.

We used:

- Tapestry profile / identity API
- suggested friends
- activity feed / social graph groundwork

That gives us a path toward wallet-native social identity, follow relationships, and social discovery directly inside the game.

### OrbitFlare

We are applying for the OrbitFlare track because we built the first Solana Actions / Blinks-compatible layer for the game.

We implemented action-style endpoints for:

- round info
- join
- claim
- refund
- batch join
- degen-claim metadata

This makes Winny easier to expose outside the main frontend and opens the door to wallet-native, shareable, and embedded game interactions.

---

## Additional Core Technologies

Beyond sponsor tracks, these components were essential:

- Jupiter Metis / Swap API for atomic deposit normalization into USDC
- Squads V4 multisig for safer protocol governance and rollout control
- Pinocchio migration POC for lower overhead and better long-term Solana program performance

---

## Why This Product Is Interesting

Winny combines capabilities that usually live separately:

- on-chain fairness
- real token flows
- social game loops
- degen behavior
- transparent settlement

In simple terms, Winny is a fair, open, on-chain jackpot game that turns real Solana asset flows into a social, replayable game format.

---

## What’s Next

Planned next steps include:

- side-bets on participants
- stronger degen-claim execution
- richer social graph features
- NFT-based game modes
- more custom rooms and specialized round formats

