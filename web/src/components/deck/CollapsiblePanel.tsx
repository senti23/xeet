'use client';

import { useRef, useEffect } from 'react';

interface CollapsiblePanelProps {
  title: string;
  badge?: string | number;
  badgeColor?: string;
  isOpen: boolean;
  onToggle: () => void;
  onFirstOpen?: () => void;
  children: React.ReactNode;
}

export function CollapsiblePanel({
  title,
  badge,
  badgeColor = '#888780',
  isOpen,
  onToggle,
  onFirstOpen,
  children,
}: CollapsiblePanelProps) {
  const hasOpened = useRef(false);

  useEffect(() => {
    if (isOpen && !hasOpened.current) {
      hasOpened.current = true;
      onFirstOpen?.();
    }
  }, [isOpen, onFirstOpen]);

  return (
    <div className="border-b border-white/[0.06]">
      {/* Header — 44px */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:text-white"
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] text-gray-500 transition-transform duration-200"
            style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span>{title}</span>
          {badge != null && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: `${badgeColor}20`,
                color: badgeColor,
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </button>

      {/* Body — grid transition */}
      <div
        className="transition-[grid-template-rows] duration-200 ease-out"
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
        }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
