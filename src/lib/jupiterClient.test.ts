// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import type { JupiterSwapInstructions } from "./jupiterClient";
import { buildMultiJupiterInstructions } from "./jupiterClient";

function serIx(programId: PublicKey, data: Buffer, writable = false) {
  return {
    programId: programId.toBase58(),
    accounts: [
      {
        pubkey: PublicKey.default.toBase58(),
        isSigner: false,
        isWritable: writable,
      },
    ],
    data: data.toString("base64"),
  };
}

function makeSwapSet(opts: {
  cuLimit: number;
  cuPrice: number;
  setupTag: number;
  swapTag: number;
  cleanupTag?: number;
}): JupiterSwapInstructions {
  const dummyProgram = new PublicKey("11111111111111111111111111111111");

  const setupData = Buffer.from([opts.setupTag]);
  const swapData = Buffer.from([opts.swapTag]);
  const cleanupData = opts.cleanupTag == null ? undefined : Buffer.from([opts.cleanupTag]);

  return {
    computeBudgetInstructions: [
      {
        programId: ComputeBudgetProgram.programId.toBase58(),
        accounts: [],
        data: ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cuLimit }).data.toString(
          "base64"
        ),
      },
      {
        programId: ComputeBudgetProgram.programId.toBase58(),
        accounts: [],
        data: ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: opts.cuPrice,
        }).data.toString("base64"),
      },
    ],
    setupInstructions: [serIx(dummyProgram, setupData)],
    swapInstruction: serIx(dummyProgram, swapData, true),
    cleanupInstruction: cleanupData ? serIx(dummyProgram, cleanupData) : undefined,
    addressLookupTableAddresses: [],
  };
}

describe("buildMultiJupiterInstructions", () => {
  it("merges compute budget and preserves leg order", () => {
    const a = makeSwapSet({
      cuLimit: 120_000,
      cuPrice: 100_000,
      setupTag: 11,
      swapTag: 12,
      cleanupTag: 13,
    });
    const b = makeSwapSet({
      cuLimit: 180_000,
      cuPrice: 250_000,
      setupTag: 21,
      swapTag: 22,
      cleanupTag: 23,
    });

    const ixs = buildMultiJupiterInstructions([a, b]);

    // Prefix: SetComputeUnitLimit + SetComputeUnitPrice
    expect(ixs[0].programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(ixs[0].data[0]).toBe(2);
    expect(ixs[0].data.readUInt32LE(1)).toBe(450_000); // 120k + 180k + 150k buffer

    expect(ixs[1].programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(ixs[1].data[0]).toBe(3);

    // Remaining order is leg1 setup/swap/cleanup, then leg2 setup/swap/cleanup
    expect(Array.from(ixs.slice(2).map((ix) => ix.data[0]))).toEqual([11, 12, 13, 21, 22, 23]);
  });

  it("clamps merged CU to Solana hard cap", () => {
    const big = makeSwapSet({
      cuLimit: 1_300_000,
      cuPrice: 100_000,
      setupTag: 1,
      swapTag: 2,
    });
    const ixs = buildMultiJupiterInstructions([big, big]);
    expect(ixs[0].data[0]).toBe(2);
    expect(ixs[0].data.readUInt32LE(1)).toBe(1_400_000);
  });
});

