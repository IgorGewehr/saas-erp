'use client';

import React from 'react';
import { motion } from 'framer-motion';

export default function IntegrationSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="h-[110px] rounded-2xl shimmer" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + (r * 2 + i) * 0.06 }} className="h-[220px] rounded-2xl shimmer" />
          ))}
        </div>
      ))}
    </div>
  );
}
