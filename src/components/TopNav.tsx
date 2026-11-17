import type { UserProfile } from '../../shared/types.ts';

export type NavTab = 'play' | 'arenas' | 'builder' | 'leaderboard';

interface TopNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: UserProfile | null;
  onOpenAuth: () => void;
}

export function TopNav({ activeTab, onSelectTab, user, onOpenAuth }: TopNavProps) {
  const navItems: { id: NavTab; label: string }[] = [
    { id: 'play', label: 'Matchmaking' },
    { id: 'arenas', label: 'Arenas' },
    { id: 'builder', label: 'Map Builder' },
    { id: 'leaderboard', label: 'Leaderboard' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#090B10]/95">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
        <button
          type="button"
          onClick={() => onSelectTab('play')}
          className="font-display text-xl font-bold tracking-wider text-slate-50 whitespace-nowrap shrink-0 cursor-pointer hover:text-cyan-300 transition-colors"
        >
          PRISM ARENA
        </button>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`whitespace-nowrap shrink-0 pb-1 transition-colors cursor-pointer border-b-2 ${
                  active
                    ? 'border-cyan-400 text-slate-50'
                    : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {user ? user.username : 'Sign In'}
          </button>
        </div>
      </div>

      {/* Mobile secondary nav row */}
      <div className="flex md:hidden items-center justify-around border-t border-white/6 px-4 py-2 text-xs">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTab(item.id)}
            className={`px-2 py-1 whitespace-nowrap shrink-0 ${
              activeTab === item.id ? 'text-cyan-400 font-semibold' : 'text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}
