'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, FileText, AlertCircle } from 'lucide-react';

interface FormField {
  id: string;
  type: string;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
  helperText?: string;
}

interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
}

export default function PublicFormPage() {
  const params = useParams();
  const formId = params?.formId as string;

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Get clientId/name from URL params (optional — pre-fill when sent via WhatsApp)
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const clientId = searchParams?.get('clientId') || undefined;
  const clientName = searchParams?.get('clientName') || undefined;
  const appointmentId = searchParams?.get('appointmentId') || undefined;

  useEffect(() => {
    if (!formId) return;
    (async () => {
      try {
        const res = await fetch(`/api/forms/template?id=${formId}`);
        if (!res.ok) {
          setError('Formulário não encontrado');
          return;
        }
        const data = await res.json();
        setTemplate(data.data);
      } catch {
        setError('Erro ao carregar formulário');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [formId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!template) return;
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: formId,
          clientId,
          clientName,
          appointmentId,
          responses,
          submittedVia: 'link',
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
      setError('Erro ao enviar formulário');
    }
    setIsSubmitting(false);
  };

  const updateField = (fieldId: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [fieldId]: value }));
  };

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      </div>
    );
  }

  // Error
  if (error && !template) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  // Success
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-sm"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Enviado com sucesso!</h2>
          <p className="text-gray-500">Obrigado por preencher o formulário. Suas informações foram salvas.</p>
        </motion.div>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg mx-auto"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 mx-auto rounded-xl bg-red-100 flex items-center justify-center mb-3">
            <FileText className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
          {template.description && (
            <p className="text-gray-500 mt-2 text-sm">{template.description}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600 flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {template.fields.map(field => (
            <div key={field.id}>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>

              {field.type === 'text' && (
                <input
                  type="text"
                  placeholder={field.placeholder}
                  required={field.required}
                  value={(responses[field.id] as string) || ''}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors"
                />
              )}

              {field.type === 'textarea' && (
                <textarea
                  placeholder={field.placeholder}
                  required={field.required}
                  rows={3}
                  value={(responses[field.id] as string) || ''}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors resize-none"
                />
              )}

              {field.type === 'number' && (
                <input
                  type="number"
                  placeholder={field.placeholder}
                  required={field.required}
                  value={(responses[field.id] as string) || ''}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors"
                />
              )}

              {field.type === 'date' && (
                <input
                  type="date"
                  required={field.required}
                  value={(responses[field.id] as string) || ''}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors"
                />
              )}

              {field.type === 'select' && field.options && (
                <select
                  required={field.required}
                  value={(responses[field.id] as string) || ''}
                  onChange={(e) => updateField(field.id, e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-400 outline-none transition-colors bg-white"
                >
                  <option value="">{field.placeholder || 'Selecione...'}</option>
                  {field.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}

              {field.type === 'radio' && field.options && (
                <div className="space-y-2 mt-1">
                  {field.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name={field.id}
                        value={opt}
                        checked={responses[field.id] === opt}
                        onChange={() => updateField(field.id, opt)}
                        required={field.required}
                        className="accent-red-500"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}

              {field.type === 'checkbox' && field.options && (
                <div className="space-y-2 mt-1">
                  {field.options.map(opt => {
                    const checked = Array.isArray(responses[field.id]) && (responses[field.id] as string[]).includes(opt);
                    return (
                      <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const current = (responses[field.id] as string[]) || [];
                            updateField(field.id, checked ? current.filter(v => v !== opt) : [...current, opt]);
                          }}
                          className="accent-red-500"
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}

              {field.helperText && (
                <p className="text-xs text-gray-400 mt-1">{field.helperText}</p>
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : null}
            {isSubmitting ? 'Enviando...' : 'Enviar'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Aevo
        </p>
      </motion.div>
    </div>
  );
}
