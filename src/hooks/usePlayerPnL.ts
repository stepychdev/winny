import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { findMaxRoundId, fetchRoundBatch } from './useRoundHistory';
import type { HistoryRound, ParticipantDeposit } from './useRoundHistory';

export interface PlayerPnLData {
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
 * Calculate any player's P&L from their participation history.
 * Same logic as useUserPnL but takes an explicit wallet address.
 */
export function usePlayerPnL(playerAddress: string | null) {
  const { connection } = useConnection();
  const [data, setData] = useState<PlayerPnLData>({
    transactions: [],
    totalDeposited: 0,
    totalWon: 0,
    totalPnL: 0,
    roundCount: 0,
    winCount: 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerAddress) {
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

    const fetchPlayerPnL = async () => {
      setLoading(true);
      try {
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
        const roundBatchSize = 100;

        for (let endId = maxId; endId >= 1; endId -= roundBatchSize) {
          const startId = Math.max(1, endId - roundBatchSize + 1);
          const ids: number[] = [];

          for (let id = endId; id >= startId; id--) {
            ids.push(id);
          }

          const rounds = await fetchRoundBatch(connection, ids);

          rounds.forEach((round: HistoryRound) => {
            const userDeposit = round.participantDeposits?.find(
              (d: ParticipantDeposit) => d.address === playerAddress
            );

            if (userDeposit) {
              roundCount++;

              transactions.push({
                roundId: round.roundId,
                type: 'deposit',
                amount: userDeposit.usdc,
                timestamp: round.endTs,
              });
              totalDeposited += userDeposit.usdc;

              if (round.winner === playerAddress) {
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
        console.error('Failed to fetch player PnL:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayerPnL();
  }, [connection, playerAddress]);

  return { ...data, loading };
}
