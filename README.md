# 🎰 Winny — Provably Fair Social Jackpot on Solana

> **Live on mainnet:** [winny-woad.vercel.app](https://winny-woad.vercel.app)  
> **Program:** [`3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj`](https://solscan.io/account/3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj)  
> **285 commits · 43,000+ lines of code · 141+ rounds played · fully deployed and operational on Solana mainnet**

Winny is a **production-grade, fully on-chain social jackpot** game. Not a demo. Not a devnet prototype.  
This is a live mainnet product with real USDC flows, real VRF randomness, and a 2-of-3 Squads V4 multisig protecting every admin operation.

---

## Table of Contents

### Product
- [What is Winny?](#what-is-winny)
- [How a Round Works](#how-a-round-works)
- [Degen Claim Mode](#degen-claim-mode)
- [Game Features](#game-features)
- [Monetization & Growth](#monetization--growth)

### Sponsor Track Integrations
- [MagicBlock — VRF, SOAR & Provable Fairness](#magicblock--vrf-soar--provable-fairness)
- [Jupiter — Metis, Ultra, Swap API & Mobile](#jupiter--metis-ultra-swap-api--mobile)
- [Tapestry — On-chain Social Identity](#tapestry--on-chain-social-identity)
- [OrbitFlare — Solana Actions / Blinks](#orbitflare--solana-actions--blinks)
- [Metaplex — NFT Deposits via DAS](#metaplex--nft-deposits-via-das)

### Technical Specification
- [Architecture Overview](#architecture-overview)
- [On-chain Program (Pinocchio)](#on-chain-program-pinocchio)
- [Instruction Map](#instruction-map)
- [Runtime Dispatch Architecture](#runtime-dispatch-architecture)
- [Performance Benchmarks](#performance-benchmarks)
- [Crank & Backend Infrastructure](#crank--backend-infrastructure)
- [RPC Proxy — Zero Key Exposure](#rpc-proxy--zero-key-exposure)
- [Security & Transparency](#security--transparency)
- [Full Tech Stack](#full-tech-stack)
- [Project Stats](#project-stats)
- [Running Locally](#running-locally)
- [What's Next](#whats-next)

---

# Product

## What is Winny?

Winny is a **provably fair SocialFi jackpot** on Solana.

Players join rounds with **USDC** or **any SPL token** (or even NFTs). Non-USDC assets are atomically swapped into real USDC via Jupiter, so every ticket is backed by real value on-chain.

**$1 USDC = 100 tickets.** More tickets = higher odds. When the timer ends, MagicBlock VRF picks a winner. Everything is verifiable. Everything is on-chain.

This is not a simulated casino — Winny is a real token-flow game where you can verify every outcome on [Solscan](https://solscan.io/account/3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj).

**Key differentiators:**

- **100% on-chain** — every deposit, every VRF request, every claim is a Solana transaction. No server-side randomness. No trust assumptions.
- **Mainnet-live** — the protocol is deployed, battle-tested through 141+ rounds, and actively running.
- **Multi-asset** — USDC, any SPL token, NFTs. Jupiter normalizes everything to real market value.
- **Social** — Tapestry profiles, activity feed, follow mechanics. It's a game you play *with friends*.
- **Degen mode** — instead of claiming USDC, let VRF pick a random token from 4,500+ mints. "What did I just win?"

---

## How a Round Works

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. OPEN        Players deposit USDC / any SPL token / NFT         │
│                 Non-USDC is swapped to USDC atomically via Jupiter │
│                                                                     │
│  2. LOCKED      Timer ends → crank locks the round                 │
│                                                                     │
│  3. VRF         MagicBlock VRF is requested on-chain               │
│                                                                     │
│  4. SETTLED     VRF callback writes randomness → winner selected   │
│                                                                     │
│  5. CLAIM       Winner claims the pot in USDC                      │
│        ─ OR ─   Winner opts into Degen Claim Mode 🎲               │
│                                                                     │
│  6. CLEANUP     Round PDA + participant PDAs are closed / reclaimed │
└─────────────────────────────────────────────────────────────────────┘
```

Each step is a separate on-chain instruction. Anyone can verify the flow on Solscan.

### 🔍 On-Chain Proof: A Full Round Lifecycle (with Degen Claim)

Every round is executed 100% on-chain. Here is a comprehensive trace of a real, completed round (PDA: [`8XWdjJ...wnz`](https://solscan.io/account/8XWdjJr2fFT3enmxd1u2Kh29w1YkE2i9poMezo3vAwnz)) on Solana Mainnet:

1. **[Start Round]** - Admin crank allocates the Round PDA and sets the timer. 
   → [Tx: `5ffHzG...nTAh`](https://solscan.io/tx/5ffHzG8w2cX6mUqWn121Td5aHDG4UgfPNxUfzAWeEwTTDyFKFwjm3UbuvRgz3N6nNza5XzAEJhGrXssUocs3nTAh)
2. **[Deposit Player 1]** - Player 1 joins the round with pure USDC. Participant PDA is funded.
   → [Tx: `4tksQM...xcH`](https://solscan.io/tx/4tksQMJM9dTdf5Ve7EqB6ySnTuYguK3jbj3UFtvUG5eC7HvQhFrBGZ4ZaPNWXJMCb8yrtVN5SLWMULJVfj4s6xcH)
3. **[Deposit Player 2]** - Player 2 joins with a non-USDC SPL token. The contract queries the **Jupiter API** (`/ultra/v1`) to atomically swap the asset into USDC.
   → [Tx: `5Uynm1...iis`](https://solscan.io/tx/5Uynm1bwngs4n96spY1PANiw4uzeBWDea79XDkJ4Jr1pKjGVqmvnLKBcX3PqYC7fXWa321NbTkJpo3FW3K6bEiis)
4. **[Lock Round]** - The timer ends and the round state is locked.
   → [Tx: `VdQbJv...xxV`](https://solscan.io/tx/VdQbJv6a3GmQWgz6PtwnMhZjMC7zAhRsqcfThMcVgxJJEkqakcZ1Y55FhhMoz6fjPNTpYDZavsmRuzZcCBVHxxV) *(+ other crank txs)*
5. **[Request VRF]** - Entropy is requested from the **MagicBlock VRF Plugin** for fair winner selection.
   → [Tx: `2Uig5H...kwc`](https://solscan.io/tx/2Uig5HJfCSSCSiZduUQegFCRRvVNCCg7qmgyPpuoH1JsEyGn2dFkw6S8QEC2cnDcf1P1yR9kybjLN9J1Au3Gfkwc)
6. **[Settle Round]** - VRF callback is received. MagicBlock generates provable randomness and selects the winner fully on-chain.
   → [Tx: `4cvRKB...pS3`](https://solscan.io/tx/4cvRKBdD4uWSY7kR6CqAgWbNSESyCS1PbrerDmWCUKnX152MMyGWJ9QndqkGKpUytucQLQQvmk1YHqqFsrHkP8S3)
7. **[Degen VRF Request]** - Winner opts into Degen Mode! A second **MagicBlock VRF** is requested to pick random payout tokens.
   → [Tx: `2JDrGJ...CuV`](https://solscan.io/tx/2JDrGJUTaWNok1g4SEZvhczUgXWGfr6cjmwCHCZy3GB3W8C7CtMYrzFzKkhvU7H4CbstnJkmUWMHuYiT3ZBAyCuV)
8. **[Degen Execution 1]** - First attempt to execute the random payout swap via **Jupiter**. 
   → [Tx: `Jjo2hR...D9X`](https://solscan.io/tx/Jjo2hR8PzM4bT7DUyvHgU2dyNdpZ4i7XB7vkgvzRq6UnrJtosnXmW5xAUBjXv6RdSq66Z6q18zXKTbLMsafzD9X) ❌ *(Failed: Slippage/Liquidity bounds exceeded on Jupiter)*
9. **[Degen Execution 2]** - Executor dynamically retries the **Jupiter** integration for the payout and succeeds.
   → [Tx: `63GFWD...fch`](https://solscan.io/tx/63GFWDwP55vFVFZBPoKcdHd2SfRjQiUbFVjw5ka86HedDykJ6qQVpR9xu5fyezcWka4shREbLcYEZhw8U7XDufch) ✅ *(Success!)*
10. **[Prize Transfer & Cleanup]** - The winner receives their payout. Rent is reclaimed by closing the Round and Participant PDAs.
    → [Tx: `3pzdMA...yfW`](https://solscan.io/tx/3pzdMA6NswrLjv4dEY6G1oVBotC8Me4APxnjdZinRwDV11DmvWYSBtnzeFmWoJQDNTumMwNWMqjNYE9Zbvp45yfW), [Tx: `3uGhfC...Uw3y`](https://solscan.io/tx/3uGhfChxzx42PCuspw7aByiQXUBWsiYFugdHgHktmjSbBfKhzvS6hqB6PUBmjUDQaWeXFgLgXHXTDEWxpnuvUw3y) *(+ several cleanup trace txs)*

---

## Degen Claim Mode

Instead of claiming in boring USDC, the winner can try **Degen Claim Mode** — a VRF-driven random token payout.

### How it works:

1. A second MagicBlock VRF is requested specifically for the degen claim
2. VRF randomness determines **10 candidate tokens** from a pool of **4,500+ SPL tokens**
3. The **Degen Executor** (off-chain service) tries each candidate in order:
   - Gets a Jupiter quote with dynamic slippage escalation (100 → 200 → 350 → 500 bps)
   - Builds an atomic transaction: `begin_degen_execution` → Jupiter swap → `finalize_degen_success`
   - The on-chain program verifies the swap output matches the minimum threshold
4. If no swap succeeds within the timeout window, the system falls back to a USDC payout via `auto_claim_degen_fallback`

The winner knows their candidates **after VRF fulfillment** — the fun is discovering which random token they receive. It's designed to be streamable, social, and "what did I just win?".

### On-chain guarantees:

- The executor **cannot steal funds** — `begin_degen_execution` requires executor ATA balance = 0, and `finalize_degen_success` verifies the receiver got at least `min_out_raw` tokens
- The candidate derivation is **deterministic from VRF randomness** — anyone can verify the correct token was selected
- After the fallback timeout passes, **anyone** can trigger the USDC fallback claim — funds are never stuck

---

## Game Features

| Feature | Description |
|---------|-------------|
| **Multi-asset deposits** | USDC, any SPL token, NFTs — all normalized to USDC tickets via Jupiter |
| **Batch deposits** | Deposit multiple assets in one flow |
| **Degen Claim Mode** | VRF-randomized token payout from 4,500+ SPL tokens |
| **Live participant feed** | Real-time WebSocket updates as players join |
| **Winner wheel animation** | Animated spinning wheel driven by on-chain winning ticket + randomness |
| **Missions system** | Daily / weekly / achievement quests with XP, levels, and streaks |
| **Social profiles** | Tapestry-powered identity, follows, activity feed, comments |
| **Chat** | Real-time in-game chat via Firebase |
| **Player cabinet** | P&L chart, round history, unclaimed prize management |
| **Fairness verification** | Dedicated page with step-by-step on-chain verification guide |
| **Round history** | Full archive of all past rounds with winners and outcomes |
| **Notifications** | In-app notification system for wins, deposits, claims |
| **Dark mode** | Full light/dark theme support |
| **Mobile-optimized** | Jupiter Mobile detection + responsive design + deep links |
| **Squads V4 multisig** | 2-of-3 multisig controls every admin action and program upgrade |
| **Auto-claim / refund** | Automated claim and refund flows — funds are never stuck |
| **Solana Actions / Blinks** | Play Winny from any wallet or platform that supports Blinks |

---

## Monetization & Growth

Winny is designed with **multiple monetization paths** and **organic growth loops**:

### Revenue streams

| Channel | Mechanism |
|---------|-----------|
| **Protocol fee** | Configurable % fee on every round payout, sent to treasury USDC ATA |
| **Degen Claim spread** | Jupiter swap slippage + routing naturally creates a small spread |
| **NFT deposit spread** | Bid-ask spread between marketplace floor and actual execution |
| **Custom rooms** (planned) | Premium private rooms with configurable buy-in and duration |
| **Side bets** (planned) | Bet on the winner from outside the round |

### Organic growth loops

| Loop | How it drives traffic |
|------|----------------------|
| **Referral rewards** | Invite-link system that tracks and rewards referrers — viral word-of-mouth |
| **FOMO mechanics** | Live pot display, countdown timer, real-time participant feed — urgency to join before the round locks |
| **Degen virality** | "I just won 500,000 BONK instead of $5 USDC" — shareable, streamable moments that drive organic content |
| **Social activity feed** | Tapestry events (wins, deposits, follows) create network effects — see what friends are playing |
| **Missions & XP** | Daily/weekly quests + streak bonuses keep players coming back day after day |
| **Blinks distribution** | Winny round links embedded in X posts, Discord, Telegram — play without ever visiting the site |
| **Jupiter Mobile** | Discovery through the Jupiter mobile app ecosystem — 500K+ users |

---

# Sponsor Track Integrations

## MagicBlock — VRF, SOAR & Provable Fairness

**Track relevance:** *Execution Engine — Randomized & Verifiable Game Mechanics*

MagicBlock products are the **core of Winny's fairness model and competitive layer**.

### VRF (Verifiable Random Function)

We use MagicBlock VRF in **two independent paths**:

1. **Winner selection VRF** — after the round locks, a MagicBlock VRF request is sent. The callback writes 32 bytes of randomness on-chain, which determines the `winning_ticket`. This number selects the winner proportional to their ticket share. **No server-side randomness anywhere.**

2. **Degen Claim VRF** — a second, independent VRF request determines which random token the winner receives in Degen Claim Mode. The 32 bytes of randomness are fed into a sha256-based candidate derivation algorithm that selects 10 tokens from a pool of 4,500+.

Both VRF paths are:
- Requested on-chain via `request_vrf` / `request_degen_vrf`
- Settled via on-chain callbacks (`vrf_callback` / `degen_vrf_callback`)
- Fully verifiable — anyone can re-derive the winner from the on-chain randomness and VRF proof

### SOAR (Solana On-chain Achievement & Ranking)

MagicBlock SOAR is integrated as the on-chain achievement and leaderboard system. Player achievements (wins, streaks, volumes) and rankings are tracked through SOAR, providing a competitive layer that lives entirely on-chain. SOAR scores feed into the Missions system, enabling cross-game reputation and portable player profiles.

### On-chain file references

| File | Purpose |
|------|---------|
| `handlers/request_vrf.rs` | VRF request for winner selection |
| `handlers/vrf_callback.rs` | Winner settlement from VRF randomness |
| `handlers/request_degen_vrf.rs` | VRF request for degen claim candidates |
| `handlers/degen_vrf_callback.rs` | Degen candidate selection from VRF |
| `runtime/vrf_program.rs` | VRF runtime dispatch |
| `runtime/degen_vrf_program.rs` | Degen VRF runtime dispatch |

---

## Jupiter — Metis, Ultra, Swap API & Mobile

**Track relevance:** *Game Economies Using Real Token Pricing*, *Jupiter Mobile-Native Authentication & In-Game Swaps*

Jupiter powers **every token flow** in Winny. We use the full breadth of Jupiter infrastructure:

### Swap API v1 (Metis routing engine)

All swap operations use Jupiter's **Swap API v1** (`/swap/v1/quote` + `/swap/v1/swap-instructions`), which is powered by the **Metis routing engine** — Jupiter's optimized on-chain routing algorithm that finds the best price across all Solana DEXes.

- **Frontend deposits** — multi-token → USDC conversion via Metis routing
- **Degen Claim execution** — USDC → random token swap with dynamic slippage escalation (100 → 200 → 350 → 500 bps) and max-accounts shrinking (64 → 48 → 36 → 28 → 22)

### Ultra Order Flow ✅

Ultra order flow is **live** for Degen Claim execution. Ultra provides **intent-based swaps** with MEV protection:
- Better fill prices via solvers competing for the order
- Built-in MEV protection (no sandwich attacks on degen payouts)
- Simpler integration: submit intent, get fill — no swap instruction construction needed

### Jupiter Mobile

Winny has first-class Jupiter Mobile support:

- **In-app browser detection** — `isJupiterMobile()` checks User-Agent + injected wallet to determine if the user is inside Jupiter Mobile
- **Contextual UX** — `JupiterMobileBanner` component shows "You're in Jupiter Mobile" when detected, or "Open in Jupiter Mobile" with deep links when not
- **Wallet adapter integration** — when in Jupiter Mobile, wallet connection is seamless via the injected provider (no manual "Connect Wallet")
- **Deep links** — `getJupiterMobileDeeplink()` generates links that open Winny directly inside Jupiter Mobile
- **Store links** — automatic App Store / Play Store redirect when Jupiter Mobile is not installed

### Implementation scope

| File | Lines | Role |
|------|-------|------|
| `src/lib/jupiterApi.ts` | 100+ | Core Jupiter HTTP client with retry, backoff, API key auth |
| `src/lib/jupiterClient.ts` | 200+ | Quote → swap-instructions → transaction builder for frontend |
| `crank/src/degenExecutor.ts` | 650 | Degen Executor — Jupiter quote + swap for random token payout |
| `src/lib/jupiterMobile.ts` | 106 | Mobile detection, deep links, store redirects |
| `src/components/JupiterMobileBanner.tsx` | 70 | Contextual UI banner component |

---

## Tapestry — On-chain Social Identity

**Track relevance:** *On-chain Social*

Winny is a **social game**, not just a contract. Tapestry provides the social backbone:

- **Profile auto-creation** — when a player connects their wallet, Winny silently imports/creates a Tapestry profile in the background
- **Social activity feed** — deposits, wins, follows, and comments are published as Tapestry events and displayed in the Social tab
- **Follow mechanics** — players can follow/unfollow other players from their profile pages
- **Player profiles** — the Cabinet page shows Tapestry profile cards with follower counts and activity history
- **Search / discovery** — Tapestry search API for finding other players
- **Event types** — `win`, `deposit`, `comment`, `like`, `following` — all published to the social graph

### Implementation scope

| File | Lines | Role |
|------|-------|------|
| `src/lib/tapestry/api.ts` | 245 | Full Tapestry API client (profiles, follow, events, search) |
| `src/lib/tapestry/types.ts` | — | TypeScript types for Tapestry entities |
| `src/lib/tapestry/events.ts` | — | Event publisher for game actions |
| `src/lib/tapestry/normalize.ts` | — | Data normalization + `normalize.test.ts` |
| `src/hooks/useTapestryProfile.ts` | — | Profile hook (create, fetch, update) |
| `src/hooks/useTapestryActivityFeed.ts` | — | Activity feed hook with pagination |
| `src/hooks/useTapestryComments.ts` | — | Comments hook for round discussions |
| `src/hooks/useTapestryProfiles.ts` | — | Multi-profile batch fetching |
| `src/hooks/useTapestrySearch.ts` | — | Player search / discovery |
| `src/components/social/SocialProfileCard.tsx` | 175 | Wallet identity card with follow/unfollow |
| `src/components/social/SocialActivityCard.tsx` | 256 | Activity feed with game event sub-types |
| `api/tapestry/index.ts` | 319 | Server-side Tapestry proxy (hides API key) |

---

## OrbitFlare — Solana Actions / Blinks

**Track relevance:** *Solana Actions & Blinks*

We implemented **full Solana Actions endpoints** (1,589 lines of server-side code) that make Winny playable outside the main frontend — from **any wallet, X post, Discord bot, or Telegram channel** that supports Blinks:

| Action | Endpoint | What it does |
|--------|----------|-------------|
| View round | `/api/actions/round` | Shows current round pot, players, timer |
| Join | `/api/actions/join` | Deposit USDC into the current round |
| Batch join | `/api/actions/join-batch` | Multi-asset deposit in one action |
| Claim | `/api/actions/claim` | Winner claims their USDC prize |
| Degen claim | `/api/actions/claim-degen` | Opt into random token payout |
| Refund | `/api/actions/claim-refund` | Claim refund from cancelled round |

The Actions are registered in `public/actions.json` and follow the `@solana/actions` standard. Every action builds a real versioned transaction on the server side and returns it to the client for signing.

The shared action handler (`api/actions/_shared.ts`, 560 lines) includes:
- Auto-detection of the active round
- Round eligibility scanning with caching
- Network-aware configuration (devnet / mainnet)
- Full Anchor IDL integration for transaction construction

---

## Metaplex — NFT Deposits via DAS

**Track relevance:** *Dynamic & Upgradeable Game Assets*

Winny supports **NFT deposits** alongside fungible tokens:

- The frontend uses **DAS (Digital Asset Standard) API** via Helius to enumerate wallet NFTs
- NFT floor prices are fetched from **Tensor** and **Magic Eden** bid APIs
- When a player deposits an NFT, the system routes it through the marketplace bid flow and the resulting value enters the pot as USDC tickets
- This means **any Metaplex NFT** in a player's wallet can potentially be used as a jackpot entry

### Implementation scope

| File | Role |
|------|------|
| `src/hooks/useWalletNfts.ts` | DAS API enumeration + bid price fetching |
| `src/lib/tensorClient.ts` | Tensor bid API integration |
| `src/lib/magicEdenClient.ts` | Magic Eden bid API integration |
| `src/components/DepositPanel.tsx` | NFT tab — browse, select, deposit |

---

# Technical Specification

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React/Vite)                        │
│  20,500 LOC · 96 source files · 21 test files · Vercel deployment    │
│                                                                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│   │ Deposit  │  │  Wheel   │  │  Social  │  │   Cabinet / History  │ │
│   │  Panel   │  │Animation │  │  Feed    │  │   Missions / Chat    │ │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘ │
└────────┼──────────────┼──────────────┼───────────────────┼─────────────┘
         │              │              │                   │
    ┌────▼──────────────▼──────────────▼───────────────────▼───────┐
    │              Cloudflare Worker — RPC Proxy                    │
    │     HTTP JSON-RPC + WebSocket · API keys server-side only    │
    └────┬──────────────────────────────────┬──────────────────────┘
         │                                  │
    ┌────▼──────────────┐            ┌──────▼──────────────────────┐
    │   Helius RPC      │            │     Jupiter Swap API v1     │
    │   (mainnet+DAS)   │            │     (Metis routing engine)  │
    └────┬──────────────┘            └──────┬──────────────────────┘
         │                                  │
    ┌────▼──────────────────────────────────▼──────────────────────┐
    │           SOLANA MAINNET                                      │
    │                                                               │
    │   ┌───────────────────────────────────────────────────┐      │
    │   │   Jackpot Program (Pinocchio)                      │      │
    │   │   3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj   │      │
    │   │   15,400 LOC · 22 handlers · 9 runtime dispatchers │      │
    │   └───────────────────────┬───────────────────────────┘      │
    │                           │                                   │
    │   ┌───────────────┐  ┌───▼───────────┐  ┌────────────────┐  │
    │   │ MagicBlock VRF│  │ SPL Token     │  │ Squads V4      │  │
    │   │ (2 paths)     │  │ Program       │  │ Multisig       │  │
    │   └───────────────┘  └───────────────┘  └────────────────┘  │
    └──────────────────────────────────────────────────────────────┘
         ▲                                  ▲
    ┌────┴──────────────┐            ┌──────┴──────────────────────┐
    │   Crank Service   │            │   Degen Executor            │
    │   2,100 LOC · 3s  │            │   650 LOC · Jupiter swaps   │
    │   poll interval   │            │   dynamic slippage          │
    └───────────────────┘            └─────────────────────────────┘
```

---

## On-chain Program (Pinocchio)

> **15,400 lines of Rust** · **124 unit tests** · deployed via Squads V4 multisig

We **migrated from Anchor to [Pinocchio](https://github.com/anza-xyz/pinocchio)** for:
- **−41% binary size** (469 KB vs Anchor's 797 KB)
- **Lower CU consumption** across all instructions
- **Zero-copy account access** — raw byte offsets, no deserialization overhead
- **Full memory control** — every byte of every PDA is managed manually

The program is split into **handler** modules (pure validation + state mutation logic) and **runtime** modules (Pinocchio account parsing + CPI dispatch). Handlers are **pure functions** that take raw account bytes, validate constraints, mutate state, and return transfer amounts. No `Anchor::Context` — just bytes, offsets, and discriminators.

---

## Instruction Map

### Admin & Config

| Instruction | Handler | Description |
|-------------|---------|-------------|
| `init_config` | `init_config.rs` | Bootstrap the protocol — set admin, USDC mint, treasury ATA, fee bps |
| `update_config` | `update_config.rs` | Update fee, round duration, min players, ticket unit |
| `transfer_admin` | `transfer_admin.rs` | Transfer admin authority (multisig transition) |
| `set_treasury_usdc_ata` | `set_treasury_usdc_ata.rs` | Update treasury token account |
| `upsert_degen_config` | `upsert_degen_config.rs` | Set executor key, fallback timeout, degen pool hash |

### Round Lifecycle

| Instruction | Handler | Description |
|-------------|---------|-------------|
| `start_round` | `start_round.rs` | Open a new round, allocate Round PDA |
| `deposit_any` | `deposit_any.rs` | Accept USDC deposit, create/update Participant PDA |
| `lock_round` | `lock_round.rs` | Lock the round when timer expires |
| `request_vrf` | `request_vrf.rs` | Request MagicBlock VRF for winner selection |
| `vrf_callback` | `vrf_callback.rs` | Process VRF randomness, compute winning ticket |

### Claims

| Instruction | Handler | Description |
|-------------|---------|-------------|
| `claim` | `claim.rs` | Winner claims USDC payout + fee to treasury |
| `auto_claim` | `auto_claim.rs` | Crank auto-claims for inactive winners |

### Degen Execution

| Instruction | Handler | Description |
|-------------|---------|-------------|
| `request_degen_vrf` | `request_degen_vrf.rs` | Second VRF for random token selection |
| `degen_vrf_callback` | `degen_vrf_callback.rs` | Process VRF, derive 10 token candidates |
| `begin_degen_execution` | `begin_degen_execution.rs` | Validate candidate, transfer USDC to executor |
| `finalize_degen_success` | `finalize_degen_success.rs` | Verify swap output ≥ min_out_raw, mark claimed |
| `claim_degen` | `claim_degen.rs` | Direct degen claim path |
| `claim_degen_fallback` | `claim_degen_fallback.rs` | USDC fallback if swap fails |

### Refunds & Cleanup

| Instruction | Handler | Description |
|-------------|---------|-------------|
| `admin_force_cancel` | `admin_force_cancel.rs` | Admin cancels a stuck/invalid round |
| `cancel_round` | `cancel_round.rs` | Cancel round when conditions aren't met |
| `claim_refund` | `claim_refund.rs` | Players reclaim deposits from cancelled round |
| `close_participant` | `close_participant.rs` | Reclaim participant PDA rent |
| `close_round` | `close_round.rs` | Reclaim round PDA rent after settlement |

---

## Runtime Dispatch Architecture

The program uses a **cascading dispatch** pattern — a single `process_instruction` entry point routes through 9 sub-programs by instruction discriminator. If one sub-program returns `InvalidInstructionData`, the next is tried:

```
process_instruction
  ├── admin_config_program     → init_config, update_config, transfer_admin,
  │                               set_treasury_usdc_ata, upsert_degen_config
  ├── round_lifecycle_program  → start_round, lock_round
  ├── refunds_program          → admin_force_cancel, cancel_round, claim_refund
  ├── deposits_program         → deposit_any
  ├── claims_program           → claim, auto_claim
  ├── terminal_cleanup_program → close_participant, close_round
  ├── vrf_program              → request_vrf, vrf_callback
  ├── degen_vrf_program        → request_degen_vrf, degen_vrf_callback
  └── degen_execution_program  → begin_degen_execution, finalize_degen_success,
                                  claim_degen, claim_degen_fallback
```

Every instruction uses **Anchor-compatible 8-byte discriminators** (`sha256("global:<name>")[..8]`) for seamless client-side compatibility — the frontend still uses the Anchor TypeScript SDK to build transactions.

---

## Performance Benchmarks

> Measured with [Mollusk SVM Bencher](https://github.com/buffalojoec/mollusk) v0.10.3 against the production SBF ELF.

We care deeply about **blockchain resource efficiency**. Every compute unit matters — lower CU means lower transaction fees for players, more headroom for complex operations (like Jupiter swap + on-chain verification in a single transaction), and less pressure on Solana's compute budget during high-load blocks.

### Pinocchio vs Anchor — Full CU Comparison

| Instruction | Pinocchio (Zero-Copy) | Anchor (Mainnet/Est) | Difference | Savings |
| :--- | :---: | :---: | :---: | :---: |
| **Typical Round Flow (Happy Path)** | | | | |
| `start_round` | 37,195 | 48,629 | −11,434 | 🚀 23.5% |
| `deposit_any` | 19,956 | 23,989 | −4,033 | 🚀 16.8% |
| `lock_round` | 5,959 | 5,959 | 0 | 0% |
| `request_vrf` | 11,325 | 24,371 | −13,046 | 🚀 53.5% |
| `vrf_callback` | 6,997 | 6,130 | +867 | 👎 *−14.1%* |
| `claim` | 19,177 | 24,604 | −5,427 | 🚀 22.1% |
| `close_participant` | 5,658 | 7,211 | −1,553 | 🚀 21.5% |
| `close_round` | 8,508 | 11,632 | −3,124 | 🚀 26.9% |
| **Total (Classic Round)** | **114,775** | **152,525** | **−37,750** | 🚀 **24.7%** |
| | | | | |
| **Degen Execution Path** | | | | |
| `request_degen_vrf` | 11,325 | ~24,000 | −12,675 | 🚀 52.8% |
| `degen_vrf_callback` | 6,997 | ~6,100 | +897 | 👎 *−14.7%* |
| `begin_degen_execution` | 10,400 | ~38,000 | −27,600 | 🚀 72.6% |
| `finalize_degen_success` | 12,500 | ~18,000 | −5,500 | 🚀 30.5% |
| `claim_degen` | 19,177 | ~24,500 | −5,323 | 🚀 21.7% |
| **Total (Degen Round Flow)** | **137,675** | **208,020** | **−70,345** | 🚀 **33.8%** |
| | | | | |
| **Admin & Fallback Actions** | | | | |
| `init_config` | 3,827 | 10,994 | −7,167 | 🚀 65.2% |
| `update_config` | 3,680 | 4,060 | −380 | 🚀 9.4% |
| `transfer_admin` | 3,167 | 4,261 | −1,094 | 🚀 25.7% |
| `upsert_degen_config` | 7,965 | ~11,000 | −3,035 | 🚀 27.6% |
| `set_treasury_usdc_ata` | 3,500 | ~7,000 | −3,500 | 🚀 50.0% |
| `cancel_round` | 15,400 | ~22,500 | −7,100 | 🚀 31.5% |
| `claim_refund` | 14,100 | ~19,500 | −5,400 | 🚀 27.7% |
| `claim_degen_fallback` | 14,031 | ~32,000 | −17,969 | 🚀 56.1% |
| `auto_claim` | 19,177 | ~24,500 | −5,323 | 🚀 21.7% |
| `admin_force_cancel` | 5,870 | 5,600 | +270 | 👎 *−4.8%* |
| **Total (Admin & Fallback)** | **90,717** | **141,415** | **−50,698** | 🚀 **35.9%** |

> **Jupiter Degen Safety Margin:** By saving ~30,000 CU on Degen-round management instructions, we free up critical headroom for Jupiter V6 swaps (which independently consume 180–200k CU). With Pinocchio, total transaction cost stays within the 200k CU limit; with Anchor, it would exceed the limit, requiring multiple transactions and higher priority fees.

### Program Size & Deployment Cost

| Metric | Pinocchio | Anchor | Difference |
| --- | :---: | :---: | :---: |
| **Compiled .so size** | **468 KB** | 797 KB | 🚀 **1.7× smaller** |
| **Mainnet deployment cost** | **~6.58 SOL** | ~11.16 SOL | 🚀 **~4.58 SOL cheaper** |

The benchmark harness is in `benches/compute_units.rs` (627 lines) and can be reproduced with `scripts/run_cu_bench.sh`.

---

## Crank & Backend Infrastructure

### Crank Service

> **2,100 lines TypeScript** · autonomous round lifecycle manager · 3-second poll interval

The crank is a headless Node.js process that drives the entire round lifecycle without human intervention:

- **Round management** — `start_round` → `lock_round` → `request_vrf` → settle → cleanup
- **VRF cooldown guard** — 15-second minimum between VRF requests to avoid duplicate CPI calls
- **Stuck round detection** — exponential backoff for rounds stuck in unexpected states
- **Auto-claim** — if the winner doesn't claim within the window, the crank triggers `auto_claim`
- **PDA cleanup** — closes participant and round PDAs to reclaim rent after settlement
- **Zero-downtime** — runs as a systemd service with auto-restart

### Degen Executor

> **650 lines TypeScript** · separate process · Jupiter swap engine

- Watches for `DegenClaim` accounts in `VrfReady` status
- Derives 10 candidates from VRF randomness (mirrors Rust `derive_degen_candidate_index_at_rank`)
- **Dynamic slippage escalation** — 100 → 200 → 350 → 500 bps per retry
- **Max accounts shrinking** — 64 → 48 → 36 → 28 → 22 to fit the 1232-byte transaction limit
- Falls back to direct-route single-hop if multi-hop route is too large
- Drains stale executor ATA balance before each attempt (prevents error 6043)
- Triggers `auto_claim_degen_fallback` after all candidates fail and the timeout passes

### Frontend

> **20,500 lines** · 96 source files · 21 test files · React 18 + Vite + Tailwind

| Feature | Implementation |
|---------|---------------|
| Live round display | WebSocket subscription + zero-copy buffer parsing |
| Deposit panel | USDC direct, any SPL via Jupiter, NFT tab via Tensor/ME bids |
| Winner wheel | Animated wheel driven by on-chain winning_ticket + randomness |
| Social layer | Tapestry API — profiles, follows, activity feed, comments |
| Missions | Daily/weekly/achievement quests with XP, levels, streaks |
| Player cabinet | P&L chart with Recharts, round history, unclaimed prize management |
| Chat | Firebase Realtime Database |
| Fairness page | Step-by-step on-chain verification guide with Solscan links |
| Jupiter Mobile | UA detection + deeplinks + contextual banner |

---

## RPC Proxy — Zero Key Exposure

**No API key is ever exposed to the client.** All Helius RPC traffic is routed through a **Cloudflare Worker** (`rpc-proxy/`) that holds the `HELIUS_API_KEY` server-side.

```
Browser  ──HTTP/WS──▶  Cloudflare Worker  ──▶  Helius RPC (mainnet)
                        (rpc-proxy/)              ?api-key=***
                        ALLOWED_ORIGINS check
                        CORS headers
                        WS keepalive (20s)
```

The proxy handles:
- **Origin allowlist** — only configured domains can call through
- **WebSocket proxying** — full duplex WS relay with message buffering during connect
- **Keepalive pings** — automatic 20-second heartbeats prevent WS timeouts

Additional server-side proxies:
- **Tapestry API** — `api/tapestry/index.ts` (Vercel serverless function) hides Tapestry API credentials
- **Solana Actions** — `api/actions/` endpoints use server-side RPC URLs via `SOLANA_RPC_UPSTREAM` env var  
- **Jupiter API** — the crank/executor use `x-api-key` headers server-side; the frontend uses `VITE_JUPITER_API_KEY` only in the build process

**Result:** The frontend source code and browser network tab contain **zero secrets**.

---

## Security & Transparency

### Squads V4 Multisig

The protocol is governed by **two separate Squads V4 multisigs** with split roles:

| Multisig | Role | Threshold | Timelock |
|----------|------|-----------|----------|
| **Ops vault** | Protocol config admin (fees, round params, pause) | 2-of-3 | None |
| **Upgrade vault** | Program upgrade authority | 2-of-3 | **12 hours** |

Every admin action — config update, fee change, pause toggle, program upgrade — requires 2-of-3 member approval. Program upgrades have a mandatory **12-hour timelock** so anyone can inspect the buffer before execution.

- **Ops multisig:** [`GJFvhkxMyHCB6KhZpdaLgDk4k7hCfGpSQVQt4VcHG5EA`](https://solscan.io/account/GJFvhkxMyHCB6KhZpdaLgDk4k7hCfGpSQVQt4VcHG5EA)
- **Upgrade multisig:** [`Fpw43sfnsXCixHaBNw8uyYYJHZd8d48dhiaTNLXdAUmD`](https://solscan.io/account/Fpw43sfnsXCixHaBNw8uyYYJHZd8d48dhiaTNLXdAUmD)

### Full on-chain transparency

- **Every round** — open, lock, VRF request, VRF callback, claim — is a separate mainnet transaction. Nothing happens off-chain.
- **VRF randomness** — 32 bytes written to the Round PDA by MagicBlock. Anyone can verify the proof.
- **Winner selection** — deterministic from `winning_ticket = hash(vrf_randomness) % total_tickets`. Re-derivable.
- **Degen candidates** — deterministic from `sha256(vrf_randomness || rank)`. Re-derivable.
- **Treasury fee** — sent to a known USDC ATA in every claim transaction. Auditable on Solscan.
- **Program upgrade** — requires 12-hour timelock multisig. The buffer is inspectable before execution.
- **Provably fair page** — the frontend includes a dedicated [Fairness](https://winny-woad.vercel.app/fairness) page that guides users through step-by-step on-chain verification.

---

## Full Tech Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Blockchain** | Solana (mainnet) | Deployed, live, 141+ rounds |
| **On-chain program** | Pinocchio | 15,400 LOC Rust, 22 handlers, 9 runtime dispatchers |
| **VRF** | MagicBlock VRF | 2 independent paths (winner + degen) |
| **Leaderboards** | MagicBlock SOAR | On-chain achievements and rankings |
| **Swaps** | Jupiter Swap API v1 (Metis) | `/swap/v1/quote` + `/swap/v1/swap-instructions` |
| **Mobile** | Jupiter Mobile SDK | UA detection, deep links, in-app browser |
| **Social** | Tapestry Protocol | Profiles, follows, activity feed, comments, search |
| **NFT data** | Metaplex DAS via Helius | NFT enumeration + Tensor/MagicEden bid pricing |
| **Actions** | Solana Actions / Blinks | 7 endpoints, `@solana/actions` standard |
| **Frontend** | React 18 + TypeScript + Vite | 20,500 LOC, Tailwind CSS, Recharts |
| **Tests** | Vitest + Mollusk SVM Bencher | 21 frontend test files, 4 crank test files, 124 Rust unit tests |
| **Wallet** | Solana Wallet Adapter | Phantom, Solflare, Jupiter Mobile, Backpack |
| **Chat** | Firebase Realtime Database | Real-time in-game chat |
| **RPC** | Helius (mainnet + DAS API) | Proxied via Cloudflare Worker — zero key exposure |
| **RPC Proxy** | Cloudflare Worker | HTTP + WebSocket proxy, 195 LOC |
| **API Proxy** | Vercel Serverless Functions | Tapestry + Actions + Solana RPC, 1,589 LOC |
| **Crank** | Node.js + tsx (systemd) | 2,100 LOC, 3s poll, auto-restart |
| **Degen Executor** | Node.js + tsx (systemd) | 650 LOC, Jupiter swap engine |
| **Admin** | Squads V4 | 2 multisigs (Ops + Upgrade), 2-of-3 threshold |
| **Benchmarks** | Mollusk SVM Bencher 0.10.3 | CU profiling for every instruction |
| **CI/CD** | Vercel (frontend) + systemd (crank) | Zero-downtime deploys |

---

## Project Stats

| Metric | Value |
|--------|-------|
| Total git commits | 285 |
| Rust (on-chain program) | 15,400 lines |
| TypeScript (frontend) | 20,500 lines |
| TypeScript (crank + executor) | 7,400 lines |
| TypeScript (API/proxy) | 1,784 lines |
| Frontend test files | 21 |
| Crank test files | 4 (63 tests) |
| Rust unit tests | 124 |
| On-chain instructions | 22 |
| Runtime dispatchers | 9 |
| Source files (total) | 200+ |
| Degen token pool | 4,500+ tokens |
| Mainnet rounds played | 141+ |
| Binary size (Pinocchio) | 469 KB (−41% vs Anchor) |

---

## Running Locally

### Prerequisites

- Node.js 20+
- Rust + Cargo
- Solana CLI
- A funded wallet keypair

### Frontend

```bash
cd xyzcasino
cp .env.example .env          # configure RPC_URL, PROGRAM_ID, etc.
npm install
npm run dev                    # starts Vite dev server on :5173
```

### Crank (mainnet)

```bash
cd xyzcasino/crank
npm install
npm run start:mainnet          # polls every 3s, manages round lifecycle
```

### Degen Executor (mainnet)

```bash
cd xyzcasino/crank
npm run start:degen:mainnet    # watches for VrfReady claims, executes swaps
```

### Tests

```bash
# Frontend tests
cd xyzcasino && npx vitest run

# Crank tests (63 tests)
cd xyzcasino/crank && npm test

# On-chain program tests (124 tests)
cd xyzcasino/jackpot_pinocchio_poc && cargo test

# CU benchmarks
cd xyzcasino/jackpot_pinocchio_poc && ./scripts/run_cu_bench.sh
```

---

## What's Next

- ~~**Ultra order flow** — Jupiter Ultra for MEV-protected degen claim swaps~~ ✅
- **Side bets** — bet on which player will win
- ~~**SOAR leaderboards** — full MagicBlock SOAR leaderboard UI + cross-game reputation~~ ✅
- **Referral program** — on-chain referral tracking with protocol fee sharing
- **NFT game modes** — NFT-only rounds and NFT prizes
- **Custom rooms** — private rounds, configurable duration and buy-in
- **Prediction markets** — gamified Jupiter prediction market integration
- **Ephemeral Rollups** — MagicBlock ER for sub-second in-round state updates

---

<p align="center">
  <strong>Built for the Solana hackathon · Deployed on mainnet · 100% on-chain and verifiable</strong><br>
  <em>Program ID: <a href="https://solscan.io/account/3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj"><code>3wi11KBqF3Qa7JPP6CH4AFrcXbvaYEXMsEr9cmWQy8Zj</code></a></em>
</p>
