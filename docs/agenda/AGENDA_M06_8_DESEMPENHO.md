# Agenda — desempenho, custo e segurança (M06.8)

> Concluído/analisado em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: 4 itens do checklist M06.8. Esta fatia entrega o item de menor risco/maior valor
> imediato (janela de datas no listener) e analisa os outros 3 com a mesma disciplina de "não
> deixar como lacuna silenciosa" já usada pro item de consolidação de lembretes na M06.5 —
> **um deles é bloqueado por precisar de decisão do usuário, não de engenharia.**

## 1. Entregue: janela de datas no listener da Agenda

`AgendaModule.tsx` mantinha um `onSnapshot` em **todos** os agendamentos do tenant, pra sempre —
sem filtro de data, sem `limit`, só `where('businessId','==',...)` + `orderBy('date')`. Pra uma
clínica com anos de histórico, isso cresce sem limite em custo de leitura, memória e tempo de
carga inicial.

Corrigido com uma janela generosa e fixa: 180 dias pra trás, 365 dias pra frente a partir de
"agora" no momento em que o componente monta. Reaproveita o índice composto
`[businessId, date]` já existente (`firestore.indexes.json`) — nenhum índice novo. Cobre
qualquer uso realista de agendamento/consulta recente sem crescer pra sempre.

**Limitação aceita, não um bug**: a janela é calculada UMA VEZ no mount do componente, não
"desliza" sozinha se a aba ficar aberta por muitos meses sem recarregar a página — como o app já
mantém módulos montados entre trocas de aba (`mountedTabs`), uma sessão de trabalho
extremamente longa sem nenhum reload veria a janela ficar gradualmente desatualizada. Aceitável
pra uso normal (sessões são recarregadas com alguma frequência na prática); resolver de verdade
exigiria recalcular a janela periodicamente ou reagir à navegação do calendário — fora do
escopo desta correção pontual.

**O que fica fora da janela**: histórico mais antigo que 180 dias não aparece mais na grade da
Agenda em si. Isso é aceitável porque já existem caminhos dedicados pra histórico mais antigo,
com suas próprias queries: Relatórios (`ReportsModule.tsx`) e a Timeline do cliente
(`ClientTimeline.tsx`, que já faz sua própria busca independente, não lê do estado da Agenda).

## 2. Analisado, deliberadamente não corrigido: paginação/lookup de clientes

`AgendaModule.tsx` carrega **todos** os clientes ativos do tenant numa `useQuery` (não um
listener ao vivo — já cacheada com `staleTime: 5min`, perfil de custo bem mais barato que o
listener de agendamentos). Investigado antes de mexer: essa lista não é só um mapa
id→nome (`clientsMap`) — é passada inteira pro `AppointmentFormDialog` (`clients={clients}`,
linha ~3997), que precisa dela pra um seletor de cliente **pesquisável** na hora de agendar.

Isso muda o problema: não dá pra simplesmente limitar/paginar a query sem quebrar a função real
do seletor — um `limit()` cortaria clientes arbitrariamente (por ordem alfabética ou de
inserção), tornando alguns pacientes **impossíveis de agendar** pela busca. Isso seria uma
regressão funcional pior que o problema de custo que resolveria. A correção de verdade exigiria
busca no servidor (Firestore só suporta prefix-match limitado, sem um índice de busca de
verdade tipo Algolia/Typesense) ou uma UI de paginação com scroll infinito no seletor — nenhuma
das duas é um ajuste pontual seguro de fazer sem testar ao vivo num navegador.

**Fica documentado como analisado, não como lacuna esquecida**: o custo real hoje é menor que o
do listener de agendamentos (query cacheada, não ao vivo) — prioridade mais baixa que o item 1.

## 3. Analisado, deliberadamente não corrigido: extrair `AgendaModule.tsx` (4035 linhas)

Investigação da estrutura atual do arquivo (sem executar a extração): o componente principal
`AgendaModule()` (linha 2108 até o fim, ~1950 linhas) concentra handlers grandes
(`handleSaveAppointment` sozinho tem ~380 linhas). Mas o arquivo também define, no mesmo
arquivo, vários componentes-irmãos **já razoavelmente autocontidos**, com fronteira de props
clara:

| Componente | Linhas aprox. | Risco de extrair |
|---|---|---|
| `ServiceManagementDialog` | ~920 (609-1529) | Baixo — só precisa `services`/`business`/`user` |
| `ViewAppointmentDialog` | ~400 (1648-2057) | Baixo — props já explícitas (retrabalhadas nesta sessão em M06.3b/M06.4a) |
| `DeleteConfirmDialog`, `MiniCalendar`, `AppointmentBlock`, `AgendaSkeleton` + helpers puros (`getAppointmentTop`, `generateRecurrenceDates`, etc.) | ~300-400 juntos | Baixo |

Só esses três grupos, movidos pra arquivos próprios (mecânico: cortar/colar + ajustar imports),
reduziriam o arquivo de ~4035 pra ~2400-2500 linhas — sem tocar a lógica de orquestração mais
arriscada (os `handle*` do componente principal, fortemente acoplados a state via closures).

**Por que não executado agora, mesmo de baixo risco aparente**: (1) sem sessão de navegador ao
vivo pra verificar visualmente depois de mover ~1600 linhas de componentes de UI pra outros
arquivos — o tipo de mudança onde um import esquecido ou uma prop mal encaminhada só aparece
rodando de verdade, não no `tsc --noEmit`; (2) este arquivo já recebeu edições reais em quase
toda fatia desta sessão (bloqueios, anamnese, no-show, confirmação, buffer) — empilhar uma
refatoração estrutural grande em cima disso, sem deixar as mudanças recentes "assentarem" e
serem testadas ao vivo primeiro, aumenta o risco de mascarar um problema real de uma fatia
anterior atrás do ruído de uma refatoração grande. Fica documentado como um plano concreto e
executável (tabela acima) pra uma fatia futura dedicada, com navegador disponível pra validar.

## 4. Não implementado — decisão de PRODUTO, não de engenharia: visibilidade por profissional

`firestore.rules` (`match /appointments/{appointmentId}`) permite que **qualquer** membro
autenticado com papel `operator` ou acima leia **todos** os agendamentos do tenant — não há
segregação por profissional. O item do checklist diz explicitamente "**decidir** explicitamente
a visibilidade por profissional" — o verbo já indica que isto não é um bug técnico, é uma
pergunta de política que só o dono do negócio pode responder: **a clínica quer que um dentista
veja a agenda/pacientes de outro dentista, ou não?**

Não há uma resposta tecnicamente "correta" — depende de como a clínica realmente opera (equipe
pequena e confiável vs. profissionais autônomos dividindo espaço, por exemplo). Implementar
qualquer uma das duas respostas sem essa confirmação seria decidir uma política de acesso a
dado de saúde de paciente por conta própria — exatamente o tipo de decisão que este projeto
reserva pro usuário, não pra escolha de engenharia autônoma. **Fica pendente, sinalizado
explicitamente, aguardando a decisão do usuário** — não implementado nem "resolvido" com uma
suposição.

## 5. Verificação

Item 1 (janela de datas): verificado por `tsc --noEmit` limpo e suíte completa sem regressão.
Sem teste automatizado novo — `AgendaModule.tsx` não tem nenhum teste unitário próprio hoje
(componente de UI grande, verificado historicamente por smoke manual em navegador, mesma
convenção já seguida em toda fatia desta sessão que tocou este arquivo). **Não testado
manualmente em navegador** nesta rodada — antes de confiar de verdade: abrir a Agenda, navegar
pra um mês há mais de 6 meses atrás e confirmar que os agendamentos daquele período realmente
somem da grade (comportamento esperado, não bug) e que agendamentos dentro da janela continuam
aparecendo e atualizando ao vivo normalmente.

Itens 2-4: análise registrada, nenhuma mudança de código — nada a verificar além da própria
documentação.
