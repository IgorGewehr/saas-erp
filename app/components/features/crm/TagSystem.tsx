'use client';

import { useState } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTagConfig, ALL_PRESET_TAGS } from './shared';

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const cfg = getTagConfig(tag);
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors', cfg.bg, cfg.text)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="ml-0.5 hover:opacity-70 transition-opacity">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function TagPicker({ currentTags, onToggle, onAddCustom }: {
  currentTags: string[];
  onToggle: (tag: string) => void;
  onAddCustom: (tag: string) => void;
}) {
  const [customTag, setCustomTag] = useState('');

  const handleAddCustom = () => {
    const t = customTag.trim().toLowerCase();
    if (t && !currentTags.includes(t)) {
      onAddCustom(t);
      setCustomTag('');
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tags</p>
      <div className="flex flex-wrap gap-1.5">
        {ALL_PRESET_TAGS.map((tag) => {
          const cfg = getTagConfig(tag);
          const isActive = currentTags.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggle(tag)}
              className={cn(
                'flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-all',
                isActive
                  ? cn(cfg.bg, cfg.text, 'border-current/20')
                  : 'bg-transparent border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? cfg.dot : 'bg-gray-400')} />
              {cfg.label}
              {isActive && <Check size={10} className="ml-0.5" />}
            </button>
          );
        })}
      </div>
      {currentTags.filter((t) => !ALL_PRESET_TAGS.includes(t)).map((tag) => (
        <TagBadge key={tag} tag={tag} onRemove={() => onToggle(tag)} />
      ))}
      <div className="flex gap-1.5 mt-1">
        <input
          type="text"
          placeholder="Tag personalizada..."
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          className="flex-1 text-xs px-2.5 py-1.5 bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-500/50 transition-colors"
        />
        <button onClick={handleAddCustom} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
