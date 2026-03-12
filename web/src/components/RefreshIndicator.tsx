'use client';

import { useState, useEffect } from 'react';

interface RefreshIndicatorProps {
  lastUpdated: string | null;
}

export function RefreshIndicator({ lastUpdated }: RefreshIndicatorProps) {
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!lastUpdated) return;
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000);
      setSecondsAgo(diff);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  if (!lastUpdated) {
    return <span className="text-gray-500 text-xs">Loading...</span>;
  }

  const color = secondsAgo < 30 ? 'text-green-400' : secondsAgo < 90 ? 'text-yellow-400' : 'text-red-400';

  return (
    <span className={`text-xs ${color}`}>
      Updated {secondsAgo}s ago
    </span>
  );
}
