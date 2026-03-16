'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Info } from 'lucide-react';

export default function DemoDataBanner({ message, type = 'warning' }: { message: string; type?: 'warning' | 'info' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm ${
        type === 'info'
          ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400'
          : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
      }`}
    >
      {type === 'info' ? <Info className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      <span>{message}</span>
    </motion.div>
  );
}
