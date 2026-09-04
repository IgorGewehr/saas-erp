'use client';

import { Dialog } from '@mui/material';
import FormulariosTab from '@/app/components/features/crm/FormulariosTab';

/**
 * M06.4a: segundo ponto de entrada pro builder de formulários — a aba
 * original (`FormulariosTab`) só era alcançável de dentro do CRM, que é
 * Enterprise-only (mesma trava do Kanban). Reaproveita o MESMO componente
 * (mesma coleção `formTemplates`, sem duplicar lógica) num Dialog acessível
 * pela Agenda, disponível sem precisar de Enterprise — a aba do CRM continua
 * existindo intacta pra quem já usa Enterprise.
 *
 * `isDark`/`userName` não são lidos em nenhum lugar dentro de
 * `FormulariosTab` (confirmado lendo o componente) — passados como
 * placeholder, sem precisar de um hook de tema real aqui.
 */
export default function FormTemplatesDialog({
  open,
  onClose,
  businessId,
  userId,
  userName,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  userId: string;
  userName: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '16px', maxHeight: '85vh' } }}>
      <FormulariosTab businessId={businessId} userId={userId} userName={userName} isDark={false} />
    </Dialog>
  );
}
