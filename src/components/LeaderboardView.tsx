import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LeaderboardEntry } from '../../shared/types.ts';
import { apiFetch } from '../lib/config.ts';

export function LeaderboardView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadLeaderboard() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ entries: LeaderboardEntry[] }>('/api/leaderboard');
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLeaderboard();
  }, []);

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-cyan-400 mb-1">Ranked Standings</div>
          <h1 className="font-display text-3xl font-bold text-slate-50">Global Operator Leaderboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Persistent MMR, laser accuracy, and tag ratios recorded across completed matches.
          </p>
        </div>

        <button
          type="button"
          onClick={loadLeaderboard}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-[#11151E] hover:bg-[#181D29] text-xs font-semibold text-slate-200 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/8 bg-[#11151E]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/8 text-xs font-medium text-slate-400">
              <th className="py-3.5 px-5">Rank</th>
              <th className="py-3.5 px-5">Operator</th>
              <th className="py-3.5 px-5 text-right">MMR</th>
              <th className="py-3.5 px-5 text-right">Matches</th>
              <th className="py-3.5 px-5 text-right">W - L</th>
              <th className="py-3.5 px-5 text-right">Tags</th>
              <th className="py-3.5 px-5 text-right">K/D</th>
              <th className="py-3.5 px-5 text-right">Accuracy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  Loading operator standings...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  No registered operators have completed ranked matches yet. Sign in and finish a match to claim #1.
                </td>
              </tr>
            ) : (
              entries.map((entry, idx) => {
                const kd = entry.deaths > 0 ? (entry.kills / entry.deaths).toFixed(2) : entry.kills.toFixed(2);
                const acc =
                  entry.shotsFired > 0
                    ? `${Math.round((entry.shotsHit / entry.shotsFired) * 100)}%`
                    : '0%';
                return (
                  <tr key={entry.id} className="hover:bg-white/2 transition-colors">
                    <td className="py-3.5 px-5 font-mono-tabular text-slate-400">#{idx + 1}</td>
                    <td className="py-3.5 px-5 font-semibold text-slate-100">{entry.username}</td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular font-semibold text-cyan-400">
                      {entry.mmr}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular text-slate-300">
                      {entry.matchesPlayed}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular text-slate-300">
                      {entry.wins}-{entry.losses}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular text-slate-200">{entry.kills}</td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular text-slate-200">{kd}</td>
                    <td className="py-3.5 px-5 text-right font-mono-tabular text-slate-300">{acc}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
