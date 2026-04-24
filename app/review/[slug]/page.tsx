'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Star, CheckCircle2, Loader2, MessageSquare, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PublicReviewPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [business, setBusiness] = useState<{ id: string; nomeFantasia: string; logo?: string; googleReviewUrl?: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [clientName, setClientName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from URL params
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const professionalId = searchParams?.get('professionalId') || undefined;
  const professionalName = searchParams?.get('professionalName') || undefined;
  const serviceName = searchParams?.get('serviceName') || undefined;
  const appointmentId = searchParams?.get('appointmentId') || undefined;

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const res = await fetch(`/api/booking/info?slug=${slug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.data?.business) {
            const biz = data.data.business;
            setBusiness({
              id: biz.id,
              nomeFantasia: biz.nomeFantasia,
              logo: biz.logo,
              googleReviewUrl: biz.googleReviewUrl,
            });
          }
        }
      } catch { /* ignore */ }
      setIsLoading(false);
    })();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || rating === 0) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          clientName: clientName.trim() || undefined,
          professionalId,
          professionalName,
          serviceName,
          appointmentId,
          rating,
          comment: comment.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erro ao enviar');
        setIsSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Erro ao enviar avaliação');
    }
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Negócio não encontrado</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Obrigado pela avaliação!</h2>
          <p className="text-gray-500 mb-6">Sua opinião é muito importante para nós.</p>
          {business.googleReviewUrl && (
            <a
              href={business.googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
            >
              <Star size={16} />
              Avalie também no Google
            </a>
          )}
        </motion.div>
      </div>
    );
  }

  const displayRating = hoverRating || rating;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {business.logo ? (
            <img src={business.logo} alt={business.nomeFantasia} className="w-16 h-16 mx-auto rounded-2xl object-cover mb-3 border border-gray-200" />
          ) : (
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-100 flex items-center justify-center mb-3">
              <Star className="w-7 h-7 text-red-500" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-gray-900">{business.nomeFantasia}</h1>
          <p className="text-gray-500 mt-1 text-sm">Como foi sua experiência?</p>
          {professionalName && (
            <p className="text-xs text-gray-400 mt-1">Profissional: {professionalName}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle size={16} />{error}
            </div>
          )}

          {/* Star rating */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    size={36}
                    className={cn(
                      'transition-colors',
                      n <= displayRating ? 'text-amber-400 fill-amber-400' : 'text-gray-200'
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-500">
              {displayRating === 0 && 'Toque para avaliar'}
              {displayRating === 1 && 'Péssimo'}
              {displayRating === 2 && 'Ruim'}
              {displayRating === 3 && 'Regular'}
              {displayRating === 4 && 'Bom'}
              {displayRating === 5 && 'Excelente!'}
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Seu nome (opcional)</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Como você gostaria de ser identificado?"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors"
            />
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <MessageSquare size={14} className="inline mr-1" />
              Conte mais sobre sua experiência (opcional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="O que você mais gostou? O que poderia melhorar?"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || rating === 0}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Star size={18} />}
            {isSubmitting ? 'Enviando...' : 'Enviar avaliação'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">Powered by Aevo</p>
      </motion.div>
    </div>
  );
}
