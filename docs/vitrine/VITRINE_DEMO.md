# Vitrine — demo para a rádio (catálogo, proposta e recebimento no tablet)

Módulo **Vitrine** (menu lateral, ícone de loja). Feito para o vendedor mostrar o catálogo de
serviços ao cliente no tablet (navegador, sem PWA), negociar, cadastrar o cliente, fechar o
negócio e registrar os recebimentos — **sem nota fiscal e sem boleto**.

Não é um 4º modo de uso nem uma entidade nova: é uma tela sobre o que já existe
(Produtos do Estoque + pedido B2B + Financeiro + Clientes).

```
Estoque (produtos)  ──►  Vitrine (catálogo)  ──►  Proposta  ──►  Pedido B2B
                                                                   │ confirmar → faturar
                                                                   ▼
                                Clientes (ficha/timeline)   ◄──  Recebíveis (Financeiro)
                                                                   │ "Receber" por parcela
                                                                   ▼
                                                              Transaction paga
```

## Pré-requisitos

- **O app precisa ser reimplantado** com estes commits — nada disso vale antes disso.
- Usuário da demo com papel **manager ou acima** (`founder`/`admin`/`manager`). O operador monta
  a proposta e fecha o negócio, mas **não negocia valor, não aplica promoção e não vê/registra
  recebimentos** (o servidor recusa desconto de operador com 403 e as regras do Firestore só
  liberam `transactions` a partir de gerente).
- **Cadastrar promoções** exige **admin ou acima** (é uma escrita em `businesses/{id}`).
- Nenhuma variável de ambiente nova. Nenhuma mudança em regras/índices do Firestore.

## Checklist de dados (fazer antes da demo)

Em **Estoque → Produtos**, para cada serviço do catálogo:

| Campo | O que fazer | Por quê |
|---|---|---|
| Nome, categoria | Preencher | Vira o card e os chips de categoria ("Outros" se vazia) |
| Preço de venda | Preencher (> 0) | Item sem preço aparece como "Sob consulta" e **não entra na proposta** |
| **Não controlar estoque** | **Ligar** | Serviço não tem saldo. Sem isso, o faturamento exige saldo em estoque |
| Saldo | Pode ficar 0 | Só importa para itens COM controle de estoque |
| Fotos | Adicionar direto da câmera/galeria | Ao salvar, cada foto é **reduzida no próprio navegador** (lado maior 1600 px, JPEG 82%, ~150–400 KB; HEIC do iPad vira JPEG). Fotos **já cadastradas** antes disso não são reduzidas — reenviar para otimizar |
| Especificações | No cadastro do produto → **Especificações** → *Adicionar especificação* (rótulo + valor) | Viram a **tabela de especificações** na Vitrine, na ordem que você definir (↑/↓). Ex.: `Duração` → `30 segundos` · `Horário` → `nobre` · `Inserções` → `60 por mês` |
| Descrição | Texto livre (opcional) | Aparece abaixo da tabela. Produtos antigos com linhas `Rótulo: valor` na descrição continuam mostrando a tabela; para migrar, abra o produto e use **Converter em especificações** |
| Opções (variações) | Opcional (ex.: 15s / 30s / 60s) | Aparecem como escolha ao adicionar; o preço vem da opção |

Depois:

1. **1–2 promoções** (Vitrine → faixa vermelha → *Criar promoção*, como admin): percentual ou
   valor fixo, pedido mínimo e validade opcionais.
2. **2–3 clientes de exemplo** em Clientes (ou cadastrar na hora, durante a demo — o cadastro
   rápido pede só nome, telefone e e-mail).
3. Conferir se o tablet está com o sistema em **HTTPS** (túnel Cloudflare — ver `DEPLOY.md`).
   Em `http://IP-da-rede` funciona, mas sem o contexto seguro do navegador.

## Roteiro da demo (~10 min)

1. **Catálogo** — abrir *Vitrine*. Mostrar a grade, buscar ("spot"), filtrar por categoria.
2. **Detalhe** — tocar num item: galeria (arrastar de lado), especificações, opções.
3. **Modo apresentação** — *Modo apresentação*: tela cheia, *Anterior/Próximo*. Tocar em
   **Ocultar preços** para mostrar só o serviço; **Sair** (canto superior) ou Esc volta.
4. **Promoções** — mostrar a faixa vermelha com as promoções vigentes.
5. **Proposta** — em um item, *Adicionar à proposta* (escolher a opção, se houver). Repetir com
   outro. Abrir o botão flutuante **Proposta · N itens · R$ …**.
6. **Cliente** — *Escolher cliente* → buscar ou *Cadastrar novo cliente* (nome + telefone).
7. **Negociação (gerente)** — tocar numa promoção **ou** digitar o **valor negociado** (ex.:
   `4.500,00`). O desconto e o total se atualizam.
8. **Pagamento** — escolher à vista ou parcelas (2x…12x); o cronograma mostra cada vencimento.
9. **Fechar negócio** — cria o pedido, confirma e fatura; aparece **Negócio fechado!**.
10. **Receber** — em cada parcela, *Receber* → forma de pagamento (PIX, dinheiro, cartão, outro)
    → *Confirmar recebimento*. A parcela vira **Recebido**.
11. **Onde ficou registrado** — atalhos: *Financeiro* (receitas por parcela), *Clientes* (a ficha
    do cliente → *Timeline* mostra o pedido e as receitas), *Vendas* (o pedido, com o KPI
    "Receita faturada").

## O que o sistema faz por baixo

- **Fechar negócio** = `POST /api/b2b-orders` (idempotente) → `PATCH …/transition` para
  `confirmado` → `faturado`. Faturar gera **N receitas `pendente`** (categoria "Vendas B2B",
  vencimentos de 30 em 30 dias a partir do dia do fechamento) e baixa estoque **só dos itens
  com controle de estoque**.
- **Preço** — o servidor sempre recalcula; a tela só manda a intenção (item + quantidade) e o
  **total esperado**. Se o catálogo mudou no meio da negociação, o servidor recusa (409
  `STALE_QUOTE`) *antes* de criar o pedido; a Vitrine já atualiza os preços da proposta ao vivo.
- **Recebimento** — `POST /api/transactions/{id}/settle` (gerente+): só receita, só
  `paymentDate`/`paymentMethod`, e repetir numa parcela já paga não sobrescreve nada.
- **Promoção** vira o **desconto manual do pedido** (motivo `Promoção: <nome>`); não é preço
  promocional por produto.

## Comportamentos que podem surpreender

- **Depois de tentar fechar, a proposta fica travada.** Se o faturamento falhar (ex.: item com
  controle de estoque sem saldo), o pedido já existe: *Tentar de novo* retoma do ponto em que
  parou (sem duplicar), ou *Descartar e editar* cancela o pedido e libera a edição. Editar e
  reenviar com a mesma chave devolveria o pedido antigo com o conteúdo antigo — por isso a trava.
- **Item com controle de estoque sem saldo bloqueia o fechamento** (com o motivo na tela).
- **Item que exige personalização obrigatória** (modificadores) não entra na proposta — fechar
  esse tipo pelo Vendas/PDV.
- **Promoção abaixo do pedido mínimo bloqueia** o fechamento (em vez de fechar sem desconto).
- **Adicionar um item depois de um negócio fechado começa a próxima proposta.**
- **Todos os tenants veem o item "Vitrine" no menu** (todos os modos de uso). Quem não quiser
  pode ocultar em *Configurações → Modo do Sistema* (personalizar o menu lateral, por usuário).
- **KPI do Vendas** passou de "Receita entregue" para **"Receita faturada"** (faturado + enviado
  + entregue) — antes um negócio recém-fechado aparecia como R$ 0.
- **Descrição do recebível** usa `#ABC123` (últimos 6 do pedido, igual à tela de Vendas).

## Correção incluída (vale para todo o sistema)

Faturar/cancelar pedido B2B ignorava "Não controlar estoque": um serviço cadastrado como produto
com saldo 0 estourava *Estoque insuficiente* ao faturar. Agora esses itens não movimentam estoque
(baixa e estorno). Cobertura em `tests/services/orderTransitionCancelInvoice.test.ts`.

## Fora do escopo desta versão

- **Boleto** e **PIX/cartão ao vivo** no pedido (o recebimento é registrado manualmente).
- **PWA/offline** (é navegador; sem conexão o fechamento mostra erro e permite tentar de novo).
- **Nota fiscal** (NFS-e/NFC-e/NF-e continuam nos módulos próprios; não há emissão aqui).
- Preço promocional por produto, PDF/impressão da proposta, política de desconto para operador,
  `Client.totalSpent`.
- A negociação real da rádio (regras de preço/comissão) — entra quando o cliente explicar.

## Teste manual no tablet (não foi possível validar visualmente durante o desenvolvimento)

A lógica está coberta por testes (`npm run test`: proposta, fechamento com retomada, recebimento,
promoções, render de tela). O que **só um tablet real confirma** — passar por esta lista:

- [ ] Retrato **e** paisagem: grade (2/3/4 colunas), detalhe, gaveta da proposta.
- [ ] Tocar em campo de texto **não dá zoom** (campos usam 16px).
- [ ] Alvos de toque confortáveis (≥ 44 px) e sem atraso de 300 ms.
- [ ] Galeria: arrastar de lado com inércia; setas só aparecem com mouse.
- [ ] Fotos carregam rápido (miniaturas); foto quebrada mostra placeholder, não tela vazia.
- [ ] Modo apresentação cobre a tela toda; **Sair** e **Ocultar preços** sempre visíveis.
- [ ] Trocar de aba (ex.: ir ao Financeiro) fecha as sobreposições e **mantém a proposta**.
- [ ] Fechar negócio no caminho feliz e **derrubando o Wi-Fi** no meio (deve avisar e permitir
      *Tentar de novo* sem duplicar o pedido — conferir em Vendas que há **um** pedido só).
- [ ] Registrar recebimento à noite: a data gravada é a do relógio do tablet (não "amanhã").
- [ ] Ficha do cliente → Timeline mostra o pedido e as receitas.
- [ ] Modo escuro.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Item aparece como **Sob consulta** e não dá pra adicionar | Preço de venda 0 no cadastro |
| *Estoque insuficiente* ao fechar | Item COM controle de estoque sem saldo — ligar "Não controlar estoque" (serviço) ou repor |
| Não aparece campo de negociação nem *Receber* | Usuário abaixo de gerente |
| Não aparece *Gerenciar promoções* | Usuário abaixo de admin |
| "O valor do catálogo mudou…" | Alguém alterou o preço durante a negociação; a proposta já foi atualizada — conferir o total e fechar de novo |
| Fotos lentas | Imagens cadastradas antes da redução automática; reenviar a foto pelo Estoque |
