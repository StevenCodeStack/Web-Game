import { useState } from 'react';
import { X, LogOut } from 'lucide-react';
import type { UserProfile } from '../../shared/types.ts';
import { apiFetch } from '../lib/config.ts';

interface AuthModalProps {
  open: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onAuthenticated: (token: string, user: UserProfile) => void;
  onLogout: () => void;
}

export function AuthModal({ open, user, onClose, onAuthenticated, onLogout }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const data = await apiFetch<{ token: string; user: UserProfile }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onAuthenticated(data.token, data.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest() {
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      onAuthenticated(data.token, data.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guest sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#11151E] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl font-bold text-slate-50">
            {user ? 'Operator Account' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {user ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-white/8 bg-[#0B0E15] p-4 space-y-2">
              <div className="text-sm text-slate-400">
                Active Operator · {user.isGuest ? 'Guest Trial Session' : 'Registered Account'}
              </div>
              <div className="font-display text-2xl font-bold text-slate-50">{user.username}</div>
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/8 text-xs">
                <div>
                  <div className="text-slate-400">MMR Rating</div>
                  <div className="font-mono-tabular text-base font-semibold text-cyan-400">{user.mmr}</div>
                </div>
                <div>
                  <div className="text-slate-400">Tags</div>
                  <div className="font-mono-tabular text-base font-semibold text-slate-100">{user.kills}</div>
                </div>
                <div>
                  <div className="text-slate-400">Wins</div>
                  <div className="font-mono-tabular text-base font-semibold text-slate-100">{user.wins}</div>
                </div>
              </div>
            </div>

            {user.isGuest && (
              <p className="text-xs text-slate-400 leading-relaxed">
                Guest sessions can play matches and build rooms immediately. Sign out to register a permanent account for persistent MMR and leaderboard stats.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 text-sm font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0B0E15] border border-white/6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-slate-800 text-slate-50' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={20}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Callsign (3-20 chars)"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0E15] border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0E15] border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Persistent Account'}
              </button>
            </form>

            <div className="pt-3 border-t border-white/8">
              <button
                type="button"
                disabled={loading}
                onClick={handleGuest}
                className="w-full py-2.5 px-4 rounded-lg border border-white/12 bg-white/4 hover:bg-white/8 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                Continue as Guest Striker (No Password)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
