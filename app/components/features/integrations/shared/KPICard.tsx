'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

const COLOR_MAP: Record<string, { bg: string; text: string; iconBg: string }> = {
  violet: { bg: 'bg-violet-50 dark:bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-500/20' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-500/20' },
  blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-500/20' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-500/20' },
  red: { bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-600 dark:text-red-400', iconBg: 'bg-red-100 dark:bg-red-500/20' },
  gray: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400', iconBg: 'bg-gray-100 dark:bg-gray-700' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-500/10', text: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-500/20' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 dark:bg-rose-500/20' },
};

interface KPICardProps {
  title: string;
  value: string;
  change?: number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  warning?: boolean;
  delay?: number;
  compact?: boolean;
  budget?: { used: number; limit: number };
}

export default function KPICard({ title, value, change, subtitle, icon, color, warning, delay = 0, compact, budget }: KPICardProps) {
  const c = COLOR_MAP[color] || COLOR_MAP.gray;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={`surface rounded-2xl ${compact ? 'p-3.5' : 'p-4'} ${warning ? 'ring-2 ring-amber-300/60 dark:ring-amber-500/40' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-500 dark:text-gray-400 font-medium`}>{title}</span>
        <div className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded-lg flex items-center justify-center ${c.iconBg} ${c.text}`}>
          {icon}
        </div>
      </div>
      <p className={`${compact ? 'text-lg' : 'text-xl'} font-bold text-gray-900 dark:text-white tracking-tight`}>{value}</p>
      {change !== undefined && (
        <div className={`flex items-center gap-1 mt-1 text-[11px] font-medium ${change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
          {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{change >= 0 ? '+' : ''}{change.toFixed(1)}% vs mês anterior</span>
        </div>
      )}
      {subtitle && !change && <p className="text-[11px] text-gray-400 mt-1">{subtitle}</p>}
      {budget && (
        <div className="mt-2.5 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-gray-400">Budget</span>
            <span className={`font-semibold ${budget.used / budget.limit > 0.9 ? 'text-red-500' : budget.used / budget.limit > 0.7 ? 'text-amber-500' : 'text-gray-500'}`}>
              {Math.round(budget.used / budget.limit * 100)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(budget.used / budget.limit * 100, 100)}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: delay + 0.3 }}
              className={`h-full rounded-full ${
                budget.used / budget.limit > 0.9 ? 'bg-red-500' :
                budget.used / budget.limit > 0.7 ? 'bg-amber-400' :
                'bg-emerald-500'
              }`}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
