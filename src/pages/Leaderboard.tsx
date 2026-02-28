import { Header } from '../components/Header';
import { SoarLeaderboard } from '../components/SoarLeaderboard';

export function Leaderboard() {
  return (
    <div className="min-h-screen flex flex-col bg-background dark:bg-[#0f1219] text-slate-900 dark:text-slate-100">
      <Header />
      <main className="flex-grow px-3 py-4 sm:px-4 md:px-6 w-full max-w-3xl mx-auto">
        <SoarLeaderboard />
      </main>
    </div>
  );
}
