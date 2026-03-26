'use client';

import { useState } from 'react';
import type { LeaderboardEntry, CreatorProfiles } from '@/types/deck';

interface DeckLeaderboardProps {
  leaderboard: {
    xcc: LeaderboardEntry[];
    all: LeaderboardEntry[];
  };
  highlightWallet: string | null;
  profiles: CreatorProfiles | null;
  onSelectWallet?: (wallet: string) => void;
}

function truncateWallet(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Avatar({ handle }: { handle: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!handle || failed) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] text-gray-500">
        {handle ? handle[0].toUpperCase() : '?'}
      </div>
    );
  }

  return (
    <img
      src={`/avatars/${handle.toLowerCase()}.jpg`}
      alt=""
      className="h-6 w-6 shrink-0 rounded-full object-cover bg-gray-800"
      onError={() => setFailed(true)}
    />
  );
}

export function DeckLeaderboard({ leaderboard, highlightWallet, profiles, onSelectWallet }: DeckLeaderboardProps) {
  const [tab, setTab] = useState<'xcc' | 'all'>('xcc');
  const entries = tab === 'xcc' ? leaderboard.xcc : leaderboard.all;

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] mb-1">
        <button
          onClick={() => setTab('xcc')}
          className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
            tab === 'xcc'
              ? 'text-white border-b-2 border-[#E53935]'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          XCC Creators
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'text-white border-b-2 border-[#E53935]'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          All Holders
        </button>
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-600">
            <th className="px-1.5 py-1.5 text-left w-8">#</th>
            <th className="px-1.5 py-1.5 text-left">Holder</th>
            <th className="px-1.5 py-1.5 text-right w-16">Score</th>
            <th className="px-1.5 py-1.5 text-right w-14">Direct</th>
            <th className="px-1.5 py-1.5 text-right w-14">Reach</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const isHighlighted = highlightWallet === entry.wallet;
            return (
              <tr
                key={entry.wallet}
                onClick={() => onSelectWallet?.(entry.wallet)}
                className={`transition-colors cursor-pointer border-b border-white/[0.03] ${
                  isHighlighted
                    ? 'bg-[#E53935]/10'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <td className="px-1.5 py-1.5 font-mono text-gray-600">
                  {i + 1}
                </td>
                <td className="px-1.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar handle={entry.handle} />
                    <div className="min-w-0 truncate">
                      {entry.displayName || entry.handle ? (
                        <span className="font-medium text-gray-200 truncate">
                          {entry.displayName || entry.handle}
                        </span>
                      ) : (
                        <span className="font-mono text-gray-500">
                          {truncateWallet(entry.wallet)}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono font-bold text-gray-200">
                  {entry.score}%
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono text-gray-500">
                  {entry.direct}
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono text-gray-500">
                  {entry.reach}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
