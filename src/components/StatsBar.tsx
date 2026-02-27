import { Trophy, Users, Percent, Hash } from 'lucide-react';

interface StatsBarProps {
  totalPot: number;
  playerCount: number;
  yourShare: number;
  roundId: number;
}

export function StatsBar({ totalPot, playerCount, yourShare, roundId }: StatsBarProps) {
  const stats = [
    {
      label: 'Total Pot',
      value: `$${totalPot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: Trophy,
      color: 'text-yellow-400',
    },
    {
      label: 'Players',
      value: playerCount.toString(),
      icon: Users,
      color: 'text-green-400',
    },
    {
      label: 'Your Share',
      value: yourShare > 0 ? `${yourShare.toFixed(1)}%` : '—',
      icon: Percent,
      color: 'text-purple-400',
    },
    {
      label: 'Round',
      value: `#${roundId}`,
      icon: Hash,
      color: 'text-cyan-400',
    },
  ];

  return (
    <div className="w-full border-b border-white/5 bg-[#0a0a12]">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between py-3 overflow-x-auto no-scrollbar gap-8">
          {stats.map((stat, idx) => (
            <div key={idx} className="flex items-center gap-3 min-w-max">
              <div className={`p-1.5 rounded-lg bg-white/5 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                  {stat.label}
                </span>
                <span className="text-sm font-display font-bold text-white">
                  {stat.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
