import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { findMaxRoundId, fetchRoundBatch } from './useRoundHistory';
import type { HistoryRound, ParticipantDeposit } from './useRoundHistory';

export interface UserPnLData {
  transactions: Array<{
    roundId: number;
    type: 'deposit' | 'win';
    amount: number;
    timestamp: number;
  }>;
  totalDeposited: number;
  totalWon: number;
  totalPnL: number;
  roundCount: number;
  winCount: number;
}

/**
 * Calculate user's P&L from their participation history.
 * Fetches user's role in past rounds and calculates:
 * - All deposits (even if they lost)
 * - All winnings (claimed + unclaimed)
 * - Timestamps for each transaction
 */
export function useUserPnL() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [data, setData] = useState<UserPnLData>({
    transactions: [],
    totalDeposited: 0,
    totalWon: 0,
    totalPnL: 0,
    roundCount: 0,
    winCount: 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setData({
        transactions: [],
        totalDeposited: 0,
        totalWon: 0,
        totalPnL: 0,
        roundCount: 0,
        winCount: 0,
      });
      return;
    }

    const fetchUserPnL = async () => {
      setLoading(true);
      try {
        const userAddress = publicKey.toBase58();
        const maxId = await findMaxRoundId(connection);

        if (maxId <= 0) {
          setLoading(false);
          return;
        }

        const transactions: Array<{
          roundId: number;
          type: 'deposit' | 'win';
          amount: number;
          timestamp: number;
        }> = [];

        let totalDeposited = 0;
        let totalWon = 0;
        let winCount = 0;
        let roundCount = 0;
        let scannedRounds = 0;
        const roundBatchSize = 100;

        // Scan all existing rounds in chunks to keep totals accurate and memory usage low.
        for (let endId = maxId; endId >= 1; endId -= roundBatchSize) {
          const startId = Math.max(1, endId - roundBatchSize + 1);
          const ids: number[] = [];

          for (let id = endId; id >= startId; id--) {
            ids.push(id);
          }

          const rounds = await fetchRoundBatch(connection, ids);
          scannedRounds += rounds.length;

          rounds.forEach((round: HistoryRound) => {
            // Check if user was participant
            const userDeposit = round.participantDeposits?.find(
              (d: ParticipantDeposit) => d.address === userAddress
            );

            if (userDeposit) {
              roundCount++;

              // Record deposit (always happens when participant)
              transactions.push({
                roundId: round.roundId,
                type: 'deposit',
                amount: userDeposit.usdc,
                timestamp: round.endTs,
              });
              totalDeposited += userDeposit.usdc;

              // Check if user won this round
              if (round.winner === userAddress) {
                // Record win (they get the total pool)
                transactions.push({
                  roundId: round.roundId,
                  type: 'win',
                  amount: round.totalUsdc,
                  timestamp: round.endTs,
                });
                totalWon += round.totalUsdc;
                winCount++;
              }
            }
          });
        }

        console.log(
          `[useUserPnL] Scanned ${scannedRounds} rounds, user participated in ${roundCount}, totalDeposited: $${totalDeposited.toFixed(2)}, totalWon: $${totalWon.toFixed(2)}`
        );

        // Sort by timestamp descending (newest first)
        transactions.sort((a, b) => b.timestamp - a.timestamp);

        const totalPnL = totalWon - totalDeposited;

        setData({
          transactions,
          totalDeposited,
          totalWon,
          totalPnL,
          roundCount,
          winCount,
        });
      } catch (e) {
        console.error('Failed to fetch user PnL:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchUserPnL();
  }, [connection, publicKey]);

  return { ...data, loading };
}
