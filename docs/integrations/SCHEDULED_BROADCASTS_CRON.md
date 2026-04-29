# Scheduled Broadcasts — Setup do Cron

> Como configurar o disparo automático de campanhas agendadas.

## Endpoint

```
GET /api/broadcasts/process-scheduled
```

Aceita também POST (mesmo handler).

## Autenticação

```
Authorization: Bearer ${CRON_SECRET}
```

`CRON_SECRET` é uma variável de ambiente do saas-erp. Defina no `.env` ou
no `docker-compose.yml`. Ex:

```bash
CRON_SECRET=um-segredo-bem-grande-e-aleatorio-aqui
```

Se a variável não estiver definida, o endpoint responde 401 para qualquer chamada
(fechado por padrão).

## O que o endpoint faz

1. Lê broadcasts onde `status='scheduled' AND scheduledAt <= now`
2. Para cada um, chama internamente `/api/broadcasts/send` com header
   `x-cron-secret` que bypassa o user auth
3. Limita a 50 broadcasts por execução (evita pile-up se algo travar)
4. Concorrência interna de até 3 broadcasts em paralelo

## Setup recomendado — Docker (caso atual)

Adicione um container de cron no `docker-compose.yml`:

```yaml
services:
  saas-erp:
    # ... config existente
    environment:
      - CRON_SECRET=${CRON_SECRET}

  cron:
    image: alpine:latest
    depends_on:
      - saas-erp
    command: >
      sh -c "
        while true; do
          wget -qO- --header='Authorization: Bearer ${CRON_SECRET}' http://saas-erp:3000/api/broadcasts/process-scheduled
          sleep 60
        done
      "
    restart: unless-stopped
```

Esse container usa `wget` num loop com sleep 60s. Simples e suficiente
para a precisão de minuto que precisamos.

## Setup alternativo — cron-job.org / GitHub Actions

Se preferir usar serviço externo:

```bash
# cron-job.org com Authorization header
curl -X GET https://saas-erp.example.com/api/broadcasts/process-scheduled \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Configure pra rodar a cada 1 minuto (ou 5 minutos se precisão menor for OK).

## Resposta do endpoint

```json
{
  "processed": 3,
  "ok": 2,
  "failed": 1,
  "results": [
    { "broadcastId": "abc", "ok": true },
    { "broadcastId": "def", "ok": true },
    { "broadcastId": "ghi", "ok": false, "error": "WhatsApp Cloud channel not connected" }
  ]
}
```

## Observabilidade

Cada chamada de `/api/broadcasts/send` interna roda o fluxo completo:
- CAS de idempotência (broadcast → 'sending')
- preCreate broadcastMessages
- Loop com throttle e per-recipient updates
- Stats agregadas finais

O dispatch interno é assíncrono — o cron não espera o broadcast inteiro
processar. Apenas dispara e segue. Broadcasts grandes podem demorar minutos
para concluir.

## Cancelando agendamento

Na UI, dentro do dialog de detalhes da campanha em status `'scheduled'`,
um banner azul mostra "Agendada para X" com botão "Cancelar agendamento".
Cancelamento volta o status para `'draft'` e remove `scheduledAt` —
campanha pode ser disparada manualmente ou re-agendada (criar nova).

## Teste manual

```bash
# Agenda uma campanha pra 2 minutos a partir de agora via UI
# Espera o cron rodar
# Confere que status mudou de 'scheduled' → 'sending' → 'sent'

# Trigger manual do processamento (sem aguardar o cron)
curl -X GET https://saas-erp.example.com/api/broadcasts/process-scheduled \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

## Limitações conhecidas

- **Precisão**: depende do intervalo do cron. Com sleep 60s, broadcast pode
  ser disparada até 1 minuto após o `scheduledAt`. Aceitável para a maioria
  dos casos de uso.
- **Timezone**: `scheduledAt` é gravado em ISO 8601 UTC. UI faz a conversão
  pra timezone local. Não há suporte explícito para fuso por business.
- **Sem reagendamento**: depois de cancelar, o usuário precisa criar uma
  nova campanha. Não há "editar agendamento" hoje.
- **Cap de 50 por execução**: campanhas extras esperam o próximo ciclo do
  cron. Em uso normal não é problema; só relevante se houver pico de
  agendamentos no mesmo horário.
