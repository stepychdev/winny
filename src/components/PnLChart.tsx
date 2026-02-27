import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PnLDataPoint {
  date: string;
  time: string;
  pnl: number;
  cumulative: number;
}

interface PnLChartProps {
  transactions?: Array<{
    roundId: number;
    type: 'deposit' | 'win';
    amount: number;
    timestamp: number;
  }>;
}

type Period = 'day' | 'week' | 'all';

export function PnLChart({ transactions = [] }: PnLChartProps) {
  const [period, setPeriod] = useState<Period>('week');

  const data = useMemo(() => {
    const now = Date.now() / 1000;
    const dayInSeconds = 86400;
    const weekInSeconds = dayInSeconds * 7;

    let startTime = now;

    if (period === 'day') {
      startTime = now - dayInSeconds;
    } else if (period === 'week') {
      startTime = now - weekInSeconds;
    } else {
      startTime = 0;
    }

    // Filter transactions by time period and convert to activities
    const filteredTransactions = transactions.filter((tx) => tx.timestamp >= startTime);
    const activities: { timestamp: number; amount: number }[] = filteredTransactions.map((tx) => ({
      timestamp: tx.timestamp,
      amount: tx.type === 'deposit' ? -tx.amount : tx.amount,
    }));

    // Sort by timestamp
    activities.sort((a, b) => a.timestamp - b.timestamp);

    // Generate data points
    const chartData: PnLDataPoint[] = [];
    let cumulative = 0;

    if (activities.length === 0) {
      // Empty chart with a single point at 0
      return [{
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pnl: 0,
        cumulative: 0,
      }];
    }

    activities.forEach((activity) => {
      cumulative += activity.amount;
      const date = new Date(activity.timestamp * 1000);

      let dateStr = '';
      if (period === 'day') {
        dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (period === 'week') {
        dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } else {
        dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }

      chartData.push({
        date: dateStr,
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pnl: activity.amount,
        cumulative,
      });
    });

    // If no data for this period, return an empty chart
    if (chartData.length === 0) {
      return [{
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pnl: 0,
        cumulative: 0,
      }];
    }

    return chartData;
  }, [transactions, period]);

  const currentPnL = data.length > 0 ? data[data.length - 1].cumulative : 0;
  const isPositive = currentPnL >= 0;

  // Calculate period-specific totals from transactions
  const now = Date.now() / 1000;
  const dayInSeconds = 86400;
  const weekInSeconds = dayInSeconds * 7;
  let startTime = now;

  if (period === 'day') {
    startTime = now - dayInSeconds;
  } else if (period === 'week') {
    startTime = now - weekInSeconds;
  } else {
    startTime = 0;
  }

  const periodTransactions = transactions.filter((tx) => tx.timestamp >= startTime);
  const periodDeposits = periodTransactions
    .filter((tx) => tx.type === 'deposit')
    .reduce((sum, tx) => sum + tx.amount, 0);
  const periodWins = periodTransactions
    .filter((tx) => tx.type === 'win')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const periods: { value: Period; label: string }[] = [
    { value: 'day', label: '24H' },
    { value: 'week', label: '7D' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="bento-card p-6 lg:col-span-2">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-1">P&L</p>
          <p className={`text-3xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            ${currentPnL.toFixed(2)}
          </p>
        </div>
        <div className="flex gap-2">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                period === p.value
                  ? 'bg-primary text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#9CA3AF', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#9CA3AF', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#E5E7EB' }}
              formatter={(value: any) => [`$${((value as number) || 0).toFixed(2)}`, 'Cumulative PnL']}
              labelFormatter={(label) => label}
            />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="#EC4899"
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Period Deposits</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            ${periodDeposits.toFixed(2)}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Period Wins</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            ${periodWins.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}
