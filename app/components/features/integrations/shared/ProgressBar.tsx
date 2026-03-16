'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface ProgressBarProps {
  items: { label: string; value: number; color: string }[];
  total?: number;
  showValues?: boolean;
  delay?: number;
}

export default function ProgressBar({ items, total, showValues = true, delay = 0 }: ProgressBarProps) {
  const computedTotal = total || items.reduce((sum, i) => sum + i.value, 0);

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = computedTotal > 0 ? (item.value / computedTotal * 100) : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-24 truncate">{item.label}</span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: delay + i * 0.08 }}
                className={`h-full rounded-full ${item.color}`}
              />
            </div>
            {showValues && (
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-12 text-right">
                {item.value.toLocaleString('pt-BR')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
