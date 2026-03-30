'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Mail, Send, CheckCircle2, XCircle,
  Eye, MousePointer, ArrowRight, AlertCircle,
} from 'lucide-react';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatNumber, timeAgo } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface CommunicationTabProps {
  resendConfig: IntegrationConfig | null;
}

interface EmailEntry {
  id: string;
  to: string;
  subject: string;
  status: 'delivered' | 'bounced' | 'complained' | 'sent';
  sentAt: number;
}

// ============================================
// DEMO DATA
// ============================================
const DEMO_EMAILS: EmailEntry[] = [
  { id: 'e1', to: 'cliente@empresa.com', subject: 'Bem-vindo ao Aevo!', status: 'delivered', sentAt: Date.now() - 1_200_000 },
  { id: 'e2', to: 'admin@contoso.com.br', subject: 'Relatorio Semanal - Marco 2026', status: 'delivered', sentAt: Date.now() - 3_600_000 },
  { id: 'e3', to: 'lead@startup.io', subject: 'Proposta Comercial - Plano Enterprise', status: 'delivered', sentAt: Date.now() - 7_200_000 },
  { id: 'e4', to: 'bounce@invalid.com', subject: 'Confirmacao de Agendamento', status: 'bounced', sentAt: Date.now() - 14_400_000 },
  { id: 'e5', to: 'user@gmail.com', subject: 'Codigo de Convite: AB3K9M', status: 'delivered', sentAt: Date.now() - 28_800_000 },
  { id: 'e6', to: 'team@parceiro.com', subject: 'Nota Fiscal Emitida #1247', status: 'delivered', sentAt: Date.now() - 43_200_000 },
  { id: 'e7', to: 'spam-trap@old.net', subject: 'Atualizacao de Termos de Uso', status: 'complained', sentAt: Date.now() - 86_400_000 },
];

// ============================================
// COMPONENT
// ============================================
export default function CommunicationTab({ resendConfig }: CommunicationTabProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resend state
  const [emailsSent, setEmailsSent] = useState(0);
  const [delivered, setDelivered] = useState(0);
  const [opened, setOpened] = useState(0);
  const [clicked, setClicked] = useState(0);
  const [bounced, setBounced] = useState(0);
  const [complained, setComplained] = useState(0);
  const [deliveryRate, setDeliveryRate] = useState(0);
  const [openRate, setOpenRate] = useState(0);
  const [clickRate, setClickRate] = useState(0);
  const [recentEmails, setRecentEmails] = useState<EmailEntry[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    let resendData: any = null;

    // Fetch Resend data
    if (resendConfig?.apiKey) {
      try {
        const res = await fetch('/api/integrations/resend', { headers: { 'x-api-key': resendConfig.apiKey } });
        if (res.ok) resendData = await res.json();
        else throw new Error('Resend API error');
      } catch {
        // Will fall back to demo
      }
    }

    const usingDemo = !resendData;
    if (usingDemo) {
      setError('Usando dados de demonstracao. Configure a integracao Resend nas configuracoes Enterprise.');
    }

    // Resend data or demo
    const emailTotal = resendData?.emailsSent ?? 4_523;
    const deliveredTotal = resendData?.delivered ?? 4_489;
    const openedTotal = resendData?.opened ?? 2_847;
    const clickedTotal = resendData?.clicked ?? 1_234;
    const bouncedTotal = resendData?.bounced ?? 12;
    const complainedTotal = resendData?.complained ?? 2;

    setEmailsSent(emailTotal);
    setDelivered(deliveredTotal);
    setOpened(openedTotal);
    setClicked(clickedTotal);
    setBounced(bouncedTotal);
    setComplained(complainedTotal);
    setDeliveryRate(resendData?.deliveryRate ?? 99.2);
    setOpenRate(deliveredTotal > 0 ? Math.round(openedTotal / deliveredTotal * 100 * 10) / 10 : 0);
    setClickRate(openedTotal > 0 ? Math.round(clickedTotal / openedTotal * 100 * 10) / 10 : 0);
    setRecentEmails(resendData?.recentEmails?.map((e: any) => ({
      id: e.id,
      to: e.to,
      subject: e.subject,
      status: e.status,
      sentAt: e.sentAt,
    })) || DEMO_EMAILS);

    setLoading(false);
  };

  if (loading) return <IntegrationSkeleton rows={2} />;

  const emailStatusConfig: Record<string, { dot: string; label: string }> = {
    delivered: { dot: 'bg-emerald-400', label: 'Entregue' },
    sent: { dot: 'bg-blue-400', label: 'Enviado' },
    bounced: { dot: 'bg-red-400', label: 'Bounce' },
    complained: { dot: 'bg-amber-400', label: 'Spam' },
  };

  return (
    <div className="space-y-6">
      {error && <DemoDataBanner message={error} />}

      {/* Email KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="E-mails Enviados (30d)"
          value={formatNumber(emailsSent)}
          icon={<Send className="w-4 h-4" />}
          color="blue"
          delay={0}
        />
        <KPICard
          title="Taxa de Entrega"
          value={`${deliveryRate}%`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="emerald"
          delay={0.05}
        />
        <KPICard
          title="Taxa de Abertura"
          value={`${openRate}%`}
          subtitle={`${formatNumber(opened)} abertos de ${formatNumber(delivered)} entregues`}
          icon={<Eye className="w-4 h-4" />}
          color="violet"
          delay={0.1}
        />
        <KPICard
          title="Taxa de Clique"
          value={`${clickRate}%`}
          subtitle={`${formatNumber(clicked)} cliques de ${formatNumber(opened)} abertos`}
          icon={<MousePointer className="w-4 h-4" />}
          color="amber"
          delay={0.15}
        />
      </div>

      {/* Email Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Delivery Funnel */}
        <div className="surface rounded-2xl p-5">
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-5 flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-500" />
            Funil de Entrega
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Enviados', value: emailsSent, icon: <Send className="w-3.5 h-3.5" />, color: 'text-blue-500' },
              { label: 'Entregues', value: delivered, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-emerald-500' },
              { label: 'Abertos', value: opened, icon: <Eye className="w-3.5 h-3.5" />, color: 'text-violet-500' },
              { label: 'Clicados', value: clicked, icon: <MousePointer className="w-3.5 h-3.5" />, color: 'text-amber-500' },
            ].map((step, i, arr) => {
              const pct = emailsSent > 0 ? Math.round(step.value / emailsSent * 100) : 0;
              return (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 ${step.color}`}>{step.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{step.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{formatNumber(step.value)}</span>
                          <span className="text-[10px] text-gray-400">({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 + i * 0.1 }}
                          className={`h-full rounded-full ${
                            i === 0 ? 'bg-blue-500' :
                            i === 1 ? 'bg-emerald-500' :
                            i === 2 ? 'bg-violet-500' :
                            'bg-amber-500'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex items-center gap-3 py-1">
                      <div className="w-3.5 flex justify-center">
                        <ArrowRight className="w-2.5 h-2.5 text-gray-300 dark:text-gray-600 rotate-90" />
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {arr[i + 1] && step.value > 0 ? `${Math.round(arr[i + 1].value / step.value * 100)}% conversao` : ''}
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Bounce & Complaint rates */}
          <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 flex gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-[11px] text-gray-500">Bounces: {bounced}</span>
              <span className="text-[10px] text-gray-400">({emailsSent > 0 ? (bounced / emailsSent * 100).toFixed(2) : 0}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[11px] text-gray-500">Reclamacoes: {complained}</span>
              <span className="text-[10px] text-gray-400">({emailsSent > 0 ? (complained / emailsSent * 100).toFixed(3) : 0}%)</span>
            </div>
          </div>
        </div>

        {/* Recent Emails */}
        <div className="surface rounded-2xl p-5">
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 text-blue-500" />
            E-mails Recentes
          </h3>
          <div className="space-y-1.5">
            {recentEmails.map((email, i) => {
              const statusCfg = emailStatusConfig[email.status];
              return (
                <motion.div
                  key={email.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-2 h-2 rounded-full ${statusCfg.dot} flex-shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{email.subject}</p>
                      <p className="text-[11px] text-gray-400 truncate">{email.to}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                      email.status === 'delivered' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                      email.status === 'bounced' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' :
                      email.status === 'complained' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                      'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    }`}>
                      {statusCfg.label}
                    </span>
                    <span className="text-[11px] text-gray-400">{timeAgo(email.sentAt)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
