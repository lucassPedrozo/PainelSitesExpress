# Auditoria de UI/UX · Painel Sites Express

Data: outubro de 2026. Critério de julgamento: os princípios de produto do
`PRODUCT.md`, em especial o primeiro — *o próximo passo de cada projeto é sempre
visível; ninguém deveria precisar deduzir o que falta*.

Como foi feita: leitura de toda a interface (`web/src`), dos testes e da
documentação; captura de telas com o Chrome instalado (Playwright) nos dois temas
e em 1400, 1024 e 390 px de largura, com uma chave de acesso fornecida pelo
responsável. Vistas no navegador, antes e depois: tela de acesso, lista de
projetos (grade, lista, filtros, vista "Fazer agora"), diálogo do projeto com o
link do cliente, diálogo de geração, diálogo de publicação, Deploy (sem
repositório, com repositório configurado, em edição), Configurações e chaves de
acesso. Nenhuma ação com efeito externo foi confirmada. Os estados que só
existem depois dessas ações (geração em andamento, agente parado, publicação
com falha no domínio) foram conferidos pelo código e pelos testes.

Gravidade: **alta** (atrapalha o fluxo ou esconde o que falta), **média**
(inconsistência ou atrito que custa tempo), **baixa** (polimento).

Cada achado traz: o que está errado · por que atrapalha · o que foi feito.

---

## Transversal (componentes e padrões compartilhados)

### T1 · alta · Avisos e selos de estado desenhados à mão em cada tela

- **O que**: faixas de aviso aparecem com cinco receitas diferentes
  (`border-b bg-warning/10` no diálogo de geração, `rounded-lg border
  border-warning/30 bg-warning/8` na geração em lote e nas Configurações,
  `Alert` do shadcn no Deploy, texto solto em âmbar no rodapé do formulário de
  geração). Os selos de estado também: `StageBadge`, a pílula do link do cliente,
  o "Não salvo" das Configurações e os selos dos motores de geração repetem as
  mesmas classes de `tone.ts` cada um do seu jeito.
- **Por quê**: o mesmo significado ("atenção", "em andamento", "pronto") tem
  cara diferente conforme a tela, e cada nova tela recria a receita.
- **Feito**: `Badge` ganhou as variantes `success`, `warning` e `info`, e
  `Alert` ganhou `warning`, `info` e `success`, as duas lendo os tokens de
  `--success`, `--warning` e `--info`. As telas passaram a usar os componentes
  em vez das classes soltas.

### T2 · média · Estados vazios com três componentes diferentes

- **O que**: há `EmptyState` em `components/page-header.tsx` (cartão inteiro),
  outro `EmptyState` em `project-files/file-list.tsx`, e blocos vazios escritos
  à mão nos cartões de workflows, execuções, publicações e chaves de acesso.
- **Por quê**: ícone, tamanho e espaçamento variam; o leitor não reconhece "este
  bloco está vazio" como um padrão só.
- **Feito**: um `EmptyNotice` (versão em linha, para dentro de listas e
  cartões) ao lado do `EmptyState` de página, e as cinco ocorrências passaram a
  usá-lo. O `EmptyState` duplicado de `file-list.tsx` foi removido.

### T3 · média · Plurais com "(s)" por toda parte

- **O que**: "anexo(s)", "arquivo(s)", "repositório(s)", "link(s)
  conferido(s)", "removido(s), falha(s)", "sessão(ões) encerrada(s)".
- **Por quê**: lê-se como texto de sistema, não como um painel escrito para
  pessoas — e o produto já escreve em português cuidado em todo o resto.
- **Feito**: `pluralize()` em `lib/format.ts`, usada em todas as ocorrências.
  As funções locais de plural (`project-progress.ts`, `bulk-actions-bar.tsx`)
  passaram a usar a mesma.

### T4 · média · Tamanhos e variantes de botão sem regra

- **O que**: os rodapés dos diálogos usam `size="lg"` em uns (Renomear,
  formulário de publicação, cartão Publicar) e o padrão em outros; "Cancelar" é
  `outline` num diálogo e `ghost` em três; botões de ícone usam `size="icon"`
  com `className="size-7"`/`"size-8"` por cima em vez de `icon-sm`.
- **Por quê**: botões vizinhos com alturas diferentes e um "Cancelar" que ora
  parece botão, ora parece link.
- **Feito**: tamanho padrão em todos os rodapés (o `lg` ficou só no botão
  largo da tela de acesso); "Cancelar"/"Fechar"/"Voltar"/"Descartar" sempre
  `outline`, como o `AlertDialogCancel` do shadcn; botões de ícone com as
  variantes `icon-sm`/`icon-xs` do próprio `Button`.

### T5 · média · Nome do produto muda de tela para tela

- **O que**: o cabeçalho diz "Painel Gerenciador / Sites Express", a tela de
  acesso diz "Painel Gerenciador", o título da aba diz "Painel Gerenciador ·
  Sites Express", o `PRODUCT.md` diz "Painel Sites Express".
- **Feito**: "Painel Sites Express" no cabeçalho, na tela de acesso e no título
  da aba. (A seção continua se chamando **Deploy**, como no guia técnico e no
  vocabulário de quem opera — ver decisões em aberto.)

### T6 · média · Informação importante só no `title` (hover)

- **O que**: o motivo de cada etapa (`status.detail`: "Falta criar o link do
  cliente no Lovable") só aparece ao passar o mouse sobre o selo. No toque e no
  teclado ninguém vê.
- **Por quê**: é exatamente a frase que diz "o que falta" — o princípio 1.
- **Feito**: o card mostra a frase na linha "Próximo" (quando nada está em
  andamento), e o cabeçalho do projeto a mostra por extenso sob o título.

### T7 · baixa · Ícones com tamanho explícito dentro de botões

- **O que**: `<Icon className="size-4" />` dentro de botões `sm` (que já
  dimensionam o ícone em 14 px) em vários lugares, e `size-3.5` em outros.
- **Feito**: removidos os tamanhos redundantes nos pontos tocados pela
  auditoria; o `Button` decide.

---

## Geração (diálogo "Gerar site")

### G1 · alta · A tela não diz se o material é suficiente

- **O que**: o diálogo mostra o briefing bruto, os arquivos e um contador de
  caracteres. Nada responde "este envio tem o que um site precisa?": se há
  fotos, se há logo, se há telefone/WhatsApp, se o briefing é curto.
- **Por quê**: quem opera descobre que o material era raso só depois de
  gastar crédito — o caso que mais custa.
- **Feito**: uma faixa **"O que vai no envio"** no topo do diálogo, calculada
  por `briefing-assessment.ts` (com testes): briefing (tamanho e se é curto),
  contato (telefone/WhatsApp/e-mail no texto), fotos do cliente (imagens e
  compactados marcados), logo (arquivo com "logo"/"marca" no nome), imagens
  de banco e observações. Cada item é um selo: verde quando está, âmbar quando
  falta, e um texto diz como completar (observações, anexos ou banco de
  imagens). O rodapé resume o mesmo em uma frase antes do botão.

### G2 · alta · O bloqueio da geração aparece por último, em cinza

- **O que**: quando `LOVABLE_ENABLE_GENERATION` está desligado, o motivo
  aparece no rodapé, em texto `muted`, abaixo de tudo; a pessoa preenche a tela
  inteira e descobre no fim que o botão não vai funcionar.
- **Feito**: vira um `Alert` de aviso no topo do corpo do diálogo, antes do
  prompt. O mesmo para a assinatura Joinvix incompleta.

### G3 · média · Rodapé lotado

- **O que**: no rodapé convivem gerações anteriores, resultado da conferência,
  resultado da geração, a linha "Vão junto, em todo site: logo-dark.png e
  logo-light.png", o aviso de geração desligada, o seletor de workspace sem
  rótulo, o contador de anexos e dois botões.
- **Feito**: gerações anteriores sobem para junto do cabeçalho (é contexto
  *antes* de gerar); a assinatura vira um item da faixa "O que vai no envio";
  o workspace ganha rótulo e `aria-label`; o rodapé fica com o resumo do envio
  e os dois botões.

### G4 · média · Briefing em fonte monoespaçada de 12 px

- **O que**: o texto do cliente (parágrafos em português) é mostrado em
  `font-mono text-xs`; o diálogo "Ver prompt" mostra o mesmo texto em sans
  14 px.
- **Feito**: sans, 14 px, nos dois lugares.

### G5 · baixa · Nota dos anexos longa demais

- **O que**: um parágrafo de quatro linhas explicando vídeo, áudio e
  compactado embaixo da lista, sempre.
- **Feito**: uma linha; o detalhe de cada tipo continua na própria linha do
  arquivo (`attachWarning`).

### G6 · achado sem alteração · Montagem do prompt limita o resultado com briefing raso

Ver **Decisões em aberto → Prompt**. O texto enviado ao Lovable não foi tocado.

---

## Deploy

### D1 · alta · O caminho comum passa por um formulário inteiro

- **O que**: com o repositório escolhido, a tela mostra sempre o formulário
  "1 · Configurar publicação" (seis campos, senha vazia) e só depois o cartão
  "2 · Publicar". Para republicar um site já configurado — o caso de todos os
  dias — a pessoa rola por um formulário que não precisa tocar.
- **Por quê**: o caminho curto "escolher, conferir, publicar" fica longo, e
  o formulário sugere que é preciso preencher algo.
- **Feito**: quando o repositório já tem o workflow de deploy e uma publicação
  gravada, o formulário vira um cartão-resumo **"Publicação configurada"**
  (domínio, servidor, login, pasta, protocolo, gatilho de push, quando e por
  quem) com o botão **Alterar configuração**; o cartão **Publicar** passa a ser
  o primeiro da coluna. O formulário completo continua a um clique, e é o que
  aparece quando falta configurar. A numeração de passos só aparece quando os
  dois passos existem.

### D2 · alta · A lista de domínios publicados fica no fim da página

- **O que**: "Publicações" (quais domínios estão no ar, qual falhou) é o
  último bloco, depois das duas colunas. Mas é por domínio que a pessoa pensa
  — os nomes de repositório vêm do Lovable ("green-ground-glow").
- **Feito**: sem repositório escolhido, a lista de publicações aparece logo
  abaixo do convite "Escolha um repositório", que agora diz também que dá para
  clicar num domínio da lista. Com repositório escolhido ela continua no fim,
  como consulta.

### D3 · média · Sugestão de repositório num toast

- **O que**: ao vir do botão **Publicar** de um projeto, a tela avisa num
  toast "Repositório sugerido: X — confirme antes de publicar", que some em
  segundos. O diálogo de publicação faz melhor: escreve o motivo embaixo do
  seletor.
- **Feito**: o motivo passa a aparecer embaixo do seletor na tela de Deploy
  também (`SuggestionNote`, compartilhado), com o aviso em âmbar só quando é
  palpite. Sem casamento, a nota diz isso no lugar. Os toasts saíram.

### D4 · média · "Configurar" ambíguo no cabeçalho

- **O que**: o botão **Configurar** do cabeçalho abre as Configurações do
  painel (token do GitHub); o passo 1 da tela se chama "Configurar
  publicação".
- **Feito**: o botão passa a se chamar **GitHub e token**, e abre a mesma
  seção.

### D5 · média · Texto técnico no formulário

- **O que**: "Os dados vão para a API local e viram GitHub Actions secrets."
- **Feito**: "Destino e acesso FTP gravados como secrets no repositório do
  site. A senha não fica no navegador."

### D6 · achado parcial · A falha não diz o que aconteceu

- **O que**: uma execução que falhou aparece como "Falhou · abrir no GitHub"
  (execuções) e "última publicação falhou · ver erro" (publicações). A API
  não devolve em que passo o deploy parou, então a interface não tem como
  dizer "falhou na conexão FTP" sem abrir o GitHub. Na área de aprovação a
  API já devolve `detail`, e lá a tela diz o motivo.
- **Feito na interface**: as execuções falhas mostram o nome do passo quando a
  API o enviar (`failedStep`, campo opcional) e um texto que orienta ("abra a
  execução para ver o log do passo"). Ver **Decisões em aberto → Backend**.

### D8 · média · Clicar num domínio antes de a lista de repositórios chegar não faz nada

- **O que**: a lista de publicações chega na hora; a lista de repositórios
  do GitHub leva alguns segundos. Um domínio clicado nesse intervalo não
  encontrava o repositório e o clique se perdia (às vezes com um toast
  "não encontrado" que sumia antes de ser lido). Visto no navegador durante a
  verificação.
- **Feito**: a escolha fica guardada e o repositório abre assim que a lista
  chega.

### D7 · baixa · Plurais, cabeçalhos e espaçamento

- "66 repositório(s) na organização configurada", "2 arquivo(s) · 4 KB",
  "1 removido(s), 0 falha(s)" → `pluralize`. Estados vazios dos três cartões
  → `EmptyNotice`.

---

## Lista de projetos

### P1 · alta · O card gasta uma linha fixa com "Nada em andamento"

- **O que**: todo card tem seis linhas fixas; a sexta, "Andamento", diz "Nada
  em andamento" em quase todos. Ao mesmo tempo, a frase que diz o que falta
  (`status.detail`) está escondida no hover do selo.
- **Feito**: a linha passa a ser **"Andamento"** com o progresso quando há
  algo rodando e **"Próximo"** com a frase da etapa quando não há — a mesma
  altura, e o card passa a responder "o que falta" sem hover.

### P2 · média · Barra de ações em massa: rótulo ambíguo

- **O que**: "Gerar em lote (2 sem site)" — não se sabe se são 2 que vão ou
  2 que ficam de fora.
- **Feito**: "Gerar em lote" leva o total selecionado e o `title` explica que
  os que já têm site são avisados no diálogo (que já faz isso).

### P3 · média · Botão de direção da ordenação ocupa texto em tela estreita

- **Feito**: abaixo de `lg` fica só o ícone, com `aria-label`.

### P4 · baixa · Cabeçalho do diálogo do projeto não diz o porquê da etapa

- **Feito**: a frase da etapa aparece em texto sob o título (ver T6).

### P5 · observado, mantido · Tabela com rolagem horizontal abaixo de 896 px

- A visão em lista força `min-w-4xl`; abaixo disso a tabela rola. É o
  comportamento esperado de uma visão densa; a grade é a visão para telas
  estreitas.

---

## Diálogo do projeto (arquivos e link do cliente)

### A1 · média · Bloco "Link do cliente" sem ordem de leitura

- **O que**: título, pílula de estado, "Ver captura", "Verificar agora",
  aviso de assinatura, detalhe da sonda, etapas da área de aprovação,
  endereço, botão de envio, caixa tracejada "Publicar na área" e o formulário
  do Share preview — tudo na mesma hierarquia.
- **Feito**: ordem fixa — (1) título com estado e a ação de verificar; (2) as
  etapas da área de aprovação, quando o site está nela; (3) o endereço com
  copiar/abrir e, na mesma linha, a ação principal (**Enviar ao cliente** ou o
  registro da entrega); (4) detalhes em cinza (sonda, assinatura); (5) ações
  secundárias (publicar na área, trocar o preview). Nenhum controle saiu.

### A2 · baixa · Dois componentes de estado vazio no navegador de arquivos

- Ver T2.

---

## Configurações

### C1 · média · Avisos e selos próprios

- Faixa "Reinicie o painel…" e o selo "Não salvo" escritos à mão → `Alert`
  de aviso e `Badge` `warning` (T1).

### C2 · baixa · "Descartar" como `ghost`

- → `outline` (T4).

### C3 · observado, mantido · Motor "Lovable próprio — Em preparação"

- O cartão do motor desligado aparece na seção Geração. É informação para
  quem configura, não para quem gera; fica, porque a seção é só de quem tem a
  permissão `configurar`.
- Depois da auditoria o motor próprio saiu do painel, e o cartão com ele.

---

## Acesso

### S1 · alta · Revogar uma chave não pede confirmação

- **O que**: o ícone de lixeira revoga a chave e derruba as sessões da pessoa
  no mesmo clique. É irreversível e fica ao lado das caixas de permissão.
- **Por quê**: princípio 3 (nada irreversível por acidente). A chave perdida
  obriga a criar outra e distribuí-la de novo.
- **Feito**: um `AlertDialog` de confirmação com o nome da pessoa e o efeito
  ("encerra as sessões abertas dela"). A ação é a mesma; só passou a ser
  confirmada.

### S2 · média · Nome do produto (T5) e plural "sessão(ões)" (T3).

---

## Hierarquia da lista de projetos (passe de layout, 02/10/2026)

Pedido: "a tela parece lotada e os números importantes são difíceis de achar;
melhorar a hierarquia mantendo as cores e os recursos". Tela avaliada: a
seção Projetos, que é o painel de trabalho. Nada foi removido nem mudou de
comportamento; as cores são os mesmos tokens.

### H1 · alta · Os números que importam eram os menores da tela

- **O que**: quantos projetos esperam cada passo — a pergunta que abre o
  painel — vivia em dois lugares igualmente apagados: o contador de 11px dos
  chips de etapa e o título de grupo em caixa alta cinza ("ENVIAR AO CLIENTE
  14"). O total ("19 projetos com algo a fazer") dividia uma linha de 12px
  com os totais do Drive, que são contexto.
- **Por quê**: no teste de olhos semicerrados o que sobressaía eram os 14
  botões escuros dos cards e a caixa branca dos filtros; os números, não.
- **Feito**: `WorkSummary` (`features/projects/work-summary.tsx`): o total
  e, na fila, um índice "N · passo" por grupo em tamanho de título (20px,
  tabular), na cor da urgência do grupo (a mesma do selo); cada número rola
  até o grupo e leva o foco (`groupAnchor`). Os totais do Drive continuam na
  mesma linha, miúdos e à direita. Os títulos de grupo (grade e tabela)
  passaram de legenda em caixa alta para título de 14px com o número ao
  lado. `QUEUE` ganhou `short` (rótulo curto para o índice) e `tone`.

### H2 · média · O painel de filtros tinha o peso de um card

- **O que**: as duas fileiras de filtro ficavam numa caixa branca com
  sombra, igual aos cards logo abaixo.
- **Por quê**: controle e conteúdo com o mesmo desenho; a caixa era a
  segunda coisa que o olho pegava.
- **Feito**: filtros sem caixa, sobre o fundo da página; os chips desligados
  viraram pinos claros com fio de borda (`FilterChip`), como os botões
  `outline` da barra. Um fio separa a lente (barra + filtros) do resumo.

### H3 · média · Ritmo único de 24px

- **O que**: barra, filtros, resumo, grupos — tudo a 24px de distância, e o
  título de um grupo tão perto do grupo anterior quanto dos próprios cards.
- **Feito**: 16px entre barra e filtros e 8px entre as fileiras (controles
  juntos); fio + 24px antes do resumo; 16px do resumo ao primeiro grupo;
  32px entre grupos e 12px do título aos cards (mais espaço acima do título
  do que abaixo).

### H4 · média · No celular, mais da metade da primeira tela era controle

- **O que**: a 390px os chips empilhavam um por linha (cerca de 260px só de
  filtros) e a barra ocupava três linhas; o primeiro card começava perto de
  580px.
- **Feito**: as fileiras de chips viram trilhos que rolam de lado abaixo de
  `sm` (sangrando até a borda da tela, o sinal de que há mais), com as
  ações da fileira numa linha própria; o seletor de ordenação
  fica mais estreito e "Verificar links" mostra só o ícone (nome no
  `aria-label` e no `title`, como o "Atualizar" do cabeçalho): a barra cabe
  em duas linhas.

### H5 · observado, mantido · Um botão escuro por card

- Cada card mostra o próximo passo como botão primário. Numa grade de 14
  eles pesam, mas são a ação do card (PRODUCT.md: "botão de próximo passo
  correspondente"); a hierarquia foi resolvida fortalecendo os números e os
  títulos, não enfraquecendo o botão.

---

## Configurações (reforma) e assistente Gemini (02/10/2026)

Pedido: "a tela de configuração está muito bagunçada e parece amadora", e usar
a chave gratuita do Gemini na criação dos sites (sugestões para o prompt e
para o banco de imagens). Nenhum campo nem ação sumiu; o backend foi mexido
porque a chave do Gemini tem de ficar no servidor (`server/src/gemini/`).

### C4 · alta · Campos em grade de duas colunas, com a ajuda esticando o vizinho

- **O que**: cada seção punha os campos lado a lado; a ajuda longa de um
  esticava a linha do outro, e um campo de porta ocupava meia tela.
- **Feito**: uma coluna por seção — nome e variável à esquerda (15rem),
  controle e ajuda à direita; controles com largura máxima, números mais
  estreitos e com a leitura humana ao lado ("60000 = 1 min", "67108864 =
  64 MB"); conteúdo limitado a 56rem (`settings-field.tsx`, `settings-form.ts`).

### C5 · alta · Segredo com selo, link "Apagar" e caixa "Novo valor" sempre à vista

- **Feito**: segredo gravado mostra "Definida · dica" com os botões Trocar e
  Apagar; a caixa só abre ao clicar em Trocar, ou quando não há nada gravado.
  Nada deixou de ser possível.

### C6 · média · Cartões aninhados dos motores

- **Feito**: os motores viraram uma linha da seção (nome, selo, descrição),
  sem caixa dentro de caixa.

### C7 · média · Nada dizia o estado de cada integração

- **Feito**: selo "Configurado / Incompleto / Não configurado" no título das
  seções que dependem de segredo; ponto âmbar no menu lateral nas seções com
  alteração não salva; "vale ao reiniciar" junto da variável, não do rótulo.

### Assistente (Gemini)

- Seção nova "Assistente (Gemini)" com chave, modelo preferido (só Flash) e
  teste que lista os modelos. Na geração, o bloco "Analisar com Gemini"
  (`assistant-panel.tsx`): resumo, o que falta, sugestões com "Inserir" nas
  observações e buscas com "Buscar estas fotos", que preenchem a aba do banco
  de imagens (`use-stock-search.ts`) e buscam na hora. O prompt ao Lovable não
  muda por conta do assistente. Detalhes em `docs/GUIA-TECNICO.md`.

### G7 · alta · Diálogo de geração vazava sobre o rodapé com a análise aberta

- **O que**: com o painel da análise aberto e observações longas, as duas
  colunas ficavam mais altas que o espaço entre o topo e o rodapé; o contador
  de caracteres e os resultados do banco apareciam por cima do rodapé, e a
  caixa do briefing encolhia até uma fresta.
- **Por quê**: a `Textarea` cresce com o conteúdo sem teto; em duas colunas
  a linha da grade era `auto` (crescia com o conteúdo) e as seções não
  rolavam por dentro; o briefing tinha `min-h-0`.
- **Feito**: linha da grade presa à altura que sobra (`grid-rows-1`), cada
  seção com `overflow-y-auto` em duas colunas, briefing com `lg:min-h-40`,
  observações com `max-h-48` e rolagem própria, listas de anexos e de fotos
  com `min-h-40`; o painel do assistente saiu da faixa do topo para a coluna
  do briefing, abaixo das observações que ele preenche, sem rolagem aninhada.
  Conferido a 1200×830 (o tamanho do relato), 1400×900 e 390×844.

---

## Estados conferidos pelo código (não provocados de verdade)

- Geração em andamento / agente parado: `project-progress.ts`,
  `project-progress-view.tsx`, `reply-agent-dialog.tsx` e os testes
  `project-progress.test.ts` e `use-stage-alerts.test.ts`.
- Publicação com falha: `project-status.ts` (`deploy-failed`,
  `dev-failed`), `publications-card.tsx`, `runs-card.tsx`,
  `dev-area-steps.ts` e `dev-area-steps.test.ts`.
- Sem permissão: `usePermissions` + `HintWhenDisabled`; as ações ficam
  desabilitadas com o motivo no `title` — mantido.

---

## Decisões em aberto (dependem do responsável)

### Prompt enviado ao Lovable (não alterado)

Hoje `composePrompt()` manda o briefing cru, um bloco "## Observações
adicionais" quando há, e o bloco das imagens de banco. O painel em si não
acrescenta instrução nenhuma: tipo de site, idioma, seções esperadas, o que
fazer quando faltar informação, o papel de cada anexo.

Na verificação apareceu um dado importante: pelo menos as coletas recentes
já trazem um "Informações do Site" gerado pelo formulário da Joinvix, que
**começa com uma instrução própria** ("Construa o site descrito abaixo,
seguindo a Workspace Knowledge da JoinVix… Declare paleta, tipografia…") e só
depois traz os dados do cliente. Nesses casos o enquadramento já existe e um
bloco fixo do painel entraria em conflito com ele. O problema fica nas
coletas antigas, nos briefings escritos à mão e nos projetos sem arquivo —
justamente os rasos.

Proposta concreta, para aprovação antes de qualquer mudança (ela altera o que
uma operação paga produz):

1. **Bloco de enquadramento só quando o briefing não traz o seu**: texto
   editável nas Configurações (`LOVABLE_PROMPT_PREAMBLE`), aplicado quando o
   briefing não começa com instrução reconhecível (por exemplo, não contém
   "Workspace Knowledge" nem "Construa o site") ou quando ele é curto
   (abaixo do limiar da faixa "O que vai no envio", 800 caracteres). Conteúdo
   sugerido: "Site institucional em português do Brasil. Estrutura: cabeçalho
   com logo e WhatsApp, hero, sobre, serviços, diferenciais, depoimentos só
   se houver, contato com formulário e WhatsApp, rodapé com a assinatura
   Joinvix (anexos `logo-dark.png`/`logo-light.png`). Quando faltar uma
   informação, infira pelo segmento e marque o texto com `[CONFIRMAR]` em vez
   de omitir a seção." O diálogo mostraria o bloco como um item a mais da
   faixa ("Enquadramento do painel · incluído"), para nunca ser surpresa.
2. **Papel dos anexos no prompt**: uma linha por arquivo marcado, com o nome
   de upload e o que ele é (o painel já sabe o tipo; a logo é detectada pelo
   nome, como a faixa faz).
3. **Campos que o painel já conhece**: domínio da coleta e nome do projeto,
   em duas linhas no topo ("Domínio: x.com.br").

A faixa "O que vai no envio" já mostra ao operador o que falta; o item 1 é o
que faria o modelo se comportar melhor quando ainda assim faltar.

### Backend — passo em que o deploy falhou

Para a falha dizer "o que aconteceu" sem abrir o GitHub, a API precisa expor,
na execução falha, o nome do passo que falhou (a mesma leitura de jobs que já
alimenta `progress.current` nas execuções em andamento). A interface já lê o
campo opcional `failedStep` em `WorkflowRun` e `lastAttempt`; sem ele, mostra
só "Falhou" e o link.

### Nome da seção "Deploy"

O vocabulário do produto usa "publicação" para a etapa; a seção se chama
"Deploy" no cabeçalho, no guia técnico e nas falas de quem opera. Mantida como
"Deploy", com "Publicar/publicação" em todas as ações dentro dela. Se preferir
"Publicação" como nome da seção, é uma troca de rótulo no `app-header.tsx` e
em três textos que apontam para "a aba Deploy".

---

## Padronização da interface (14/10/2026)

Pedido: padronizar a interface inteira a partir de uma referência visual da tela
Projetos (direção, não especificação de dados), para que cada tela responda *o
que está acontecendo e o que eu faço agora* e mostre só informação correta,
completa e útil. A proposta (fase 1) foi aprovada com as seis recomendações e as
escolhas em aberto; esta seção registra o que foi feito. O sistema resultante
está em `DESIGN.md`, na raiz.

O comportamento não mudou: travas (`LOVABLE_ENABLE_GENERATION`,
`CLAUDE_ENABLE_GENERATION`), confirmações, regras de permissão e o filtro do
log continuam iguais, e nenhum segredo passou a chegar ao navegador. Nenhuma
dependência nova.

### P1 · Sistema: uma fonte para cada decisão

- **Tokens** (`web/src/index.css`): paleta OKLCH nos dois temas, com um tom por
  etapa (`stage-*`) e um por estado (`success`, `warning`, `info`,
  `destructive`), cada um com a versão suave do fundo; `destructive-solid` só
  para o passo de um projeto com problema. Contraste conferido par a par: texto
  principal 17:1, apoio 6–7:1, ação 5,6–8:1, selos 4,9–8,6:1. Escala de texto
  própria (`text-page`, `text-section`, `text-ui`, `text-numeral`, `text-2xs`),
  raio base de 8 px, moldes de grade com nome (`grid-aside`, `grid-lead`,
  `grid-icon-row`, `grid-files`, `grid-gantt`, `h-dialog-tall`) e a largura
  `tabela:` (900 px). Saíram os tokens `chart-*` e `sidebar-*` e os raios
  2xl–4xl, que nenhuma tela usava.
- **Etapa** (`features/projects/stage.ts`, com teste): os ~30 estados internos
  de `project-status.ts` viram 7 etapas (Material, Geração, Link, Cliente,
  Publicação, No ar, Arquivos), um selo de problema quando há (vermelho para
  erro, âmbar para parado) e um grupo do "Fazer agora". Selo, contadores,
  filtro, ordem da lista, Dashboard, Gantt e linha do tempo leem daqui; o
  botão vem de `next-step.ts`, que ganhou `variant` (preenchido, contornado ou
  vermelho) e a frase do que acontece.
- **`cn`** (`lib/utils.ts`): o `cn` lia `text-page`, `text-ui` etc. como cor e,
  ao lado de um `text-muted-foreground`, descartava um dos dois. Agora ele
  conhece os degraus próprios, e os componentes de `ui/` importam dali.
- **Componentes criados**: `PageHeader`, `EmptyState`, `EmptyNotice` e
  `ErrorNotice` (`components/page-header.tsx`), `SectionCard`, `CounterCard`,
  `When` (data relativa com a completa no tooltip), `DisabledHint` e `Reason`
  (o motivo de um controle desligado, escrito), `Field` (saiu do Deploy para
  `components/`), `DialogBody`; variantes `danger` e `destructive` suave no
  `Button`, `success`/`warning`/`info` no `Badge` e no `Alert`.
- **Formatação** (`lib/format.ts`, com teste): uma função de data
  (`formatWhen`: relativa até 7 dias, absoluta depois), datas inválidas sem
  derrubar a tela, `pluralize` em todo plural, valores em dólar com vírgula.

### P2 · Projetos

- **Cabeçalho do app**: logo, seções com ícone e sublinhado, uma busca (fora de
  Projetos ela leva à lista já filtrada), atualizar e o menu de conta (nome,
  tipo de chave, permissões, chaves de acesso, tema e sair). No celular as
  seções viram abas sob o cabeçalho.
- **"Fazer agora"** (`work-now.tsx`): cinco contadores do que depende da equipe
  e três do que espera o painel ou o cliente; somados, são os Ativos. Cada um
  filtra a lista. A segunda faixa de números saiu.
- **Lista** (`project-table.tsx`): tabela única a partir de 900 px — projeto
  (domínio; o nome só quando é outro), etapa, última atividade, material,
  próximo passo e um botão — e cartões abaixo disso. A grade de cartões e a
  alternância grade/tabela saíram. Abas Ativos, No ar e Finalizados; filtros
  numa linha (`list-filters.tsx`: etapa, tags num menu, ordem); sem paginação.
- **Coluna lateral**: Fila do Claude só quando há algo nela, e a atividade
  recente de todos os projetos (`activity-feed.tsx`).
- **Ações** (`project-actions.tsx`): um botão por linha, o resto no menu "⋯" em
  grupos; sem permissão, o botão fica desligado e a linha diz por quê.
- **Tags**: pílula neutra com o ponto da cor (a cor forte fica com o selo); a
  contagem ao lado de cada tag vem dos projetos carregados.

### P3 · Diálogo do projeto

- Cabeçalho com o projeto, o selo e a frase do próximo passo; a ação principal
  aparece num lugar só.
- Aba nova **Resumo** (`project-summary.tsx`): link do cliente, material e
  publicação no domínio, na ordem de leitura. A aba Arquivos ficou só com os
  arquivos, sem o bloco fixo que ocupava quase toda a altura. Abas Claude e
  Linha do tempo como antes.
- Link do cliente (`client-link.tsx`, `dev-area-steps.ts`): sem "Não
  verificado" quando não há link, sem "Conferindo…" girando à toa, sem "Pronto
  para enviar" depois da entrega.
- Linha do tempo: marcos do Claude, "No ar desde" (primeira publicação) e
  "Última publicação" com esses nomes, "Do recebimento ao ar".
- Pré-visualização: setas somem quando não há para onde ir, Google Docs sem
  tamanho "—", o aviso de carregado não chama `setState` durante o render.
- Vincular site, Enviar ao GitHub e Ver prompt: corpo com rolagem própria e o
  que falta escrito ao lado do botão.

### P4 · Geração e motor Claude

- **Lovable**: depois de gerar, o rodapé vira "Fechar" e "Abrir no Lovable" —
  um segundo clique não gera outro site. A confirmação deixou de dizer que é
  "a única ação que consome créditos" (responder ao agente também consome).
  "Desconectar" foi para o menu "⋯"; um contador de caracteres só; o motivo de
  "Gerar" desligado, escrito. Responder ao agente passou a conferir a
  permissão `gerar`, que o servidor já exigia.
- **Briefing do Claude**: modelo e esforço à vista, o resto em "Opções
  avançadas · N fora do padrão"; "Conferir" e "Gerar site" numa barra que fica
  à vista durante a revisão. O ensaio manda o mesmo pedido do "Gerar" e o
  resultado some quando o briefing ou as opções mudam.
- **Site do Claude**: uma ação principal por vez ("Enviar ao GitHub" com versão
  pendente, senão "Pedir ajuste"); a tabela de etapas virou "Histórico
  técnico", que abre sozinho quando a última etapa falhou. Comando, frase
  digitada, ids e estimativa ficam em "Detalhes técnicos" recolhidos.
- **Fila do Claude**: botão no cabeçalho de Projetos, cartão na coluna lateral
  e diálogo; posição real na fila, "Descartar" destrutivo, sem "há NaN s".
- **Lote**: com um projeto só, a tela é a de um projeto; bloqueado em âmbar,
  não vermelho; plurais corretos.

### P5 · Deploy

- Falha de leitura aparece como erro com "Tentar novamente", nunca como "0
  repositórios", "Nenhuma publicação" ou "0 arquivos · —"; os toasts de falha
  de leitura saíram.
- O selo "configurado" do seletor vem do servidor (`configuredAt`), não do
  armazenamento do navegador.
- Publicações: o autor só aparece quando o disparo é o mesmo envio que está no
  ar (`deployAuthor`, com teste); estado só no selo.
- Execuções: resultados do GitHub Actions traduzidos; sem "Parou em…" (a API
  não informa o passo); a falha mais recente leva ao GitHub.
- Simulação (dry-run) em "Mais opções"; workflows num cartão recolhido
  "Detalhes técnicos"; "Salvar configuração", "Publicar agora" e "Limpar
  workflows" conferem a permissão `publicar` e escrevem o motivo.
- Diálogo de publicar com o mesmo desenho dos outros: cabeçalho, corpo com
  rolagem, "Cancelar" ao lado da ação da vez.

### P6 · Dashboard

- As contas são as da tela Projetos: "Sites ativos" é a aba Ativos sem os
  projetos só de arquivos (que não são site), "Com problema" é o contador
  Resolver; "Projetos por etapa" usa as mesmas etapas e abre a
  lista filtrada.
- A geração conta a partir de quando o material foi para o Claude (ou do
  clique em Gerar no Lovable); "Foram ao ar" usa a primeira publicação e conta
  cada domínio uma vez, mesmo com várias coletas.
- Gantt com as cores das etapas e o selo pequeno; a atividade recente mudou
  para Projetos.

### P7 · Configurações e acesso

- Cartão "Integrações" no topo, com o estado de cada uma e o que falta. O
  estado segue o critério do servidor: um GitHub com token e sem organização
  aparece "Incompleto", não "Configurado".
- Seções em `SectionCard`; "vale depois de reiniciar o painel" e "obrigatório"
  escritos, não só no `title`; o aviso de reiniciar saiu do toast de sucesso.
- Teste do GitHub mostra a validade do token e avisa 14 dias antes de vencer.
- Erro ao carregar com "Tentar novamente"; a tela de erro de conexão não fixa
  mais `localhost:3333`.
- Chaves de acesso: corpo com rolagem, último acesso por `When`, erro separado
  do vazio. Tags: carregando, erro e vazio distintos; uma paleta só.

### Dados corrigidos

Numeração da proposta (`docs/proposta-padronizacao/README.md`).

1. **Última atividade** — servidor: a atividade do Drive é o `createdTime` mais
   recente (quando o arquivo entrou na pasta), não o `modifiedTime` do
   computador do cliente (`drive.js`, `routes/projects.js`). Interface:
   `last-activity.ts` junta Drive, gerações, link, publicação e Claude, e
   alimenta a coluna, a ordem e a atividade recente.
2. **Subpastas** — servidor: `statsForFolder` conta recursivamente (até 4
   níveis, uma consulta por subpasta, mesmo cache), com teste
   (`drive-stats.test.js`).
3. **Dashboard com outra regra** — as duas telas leem `stage.ts`.
4. **"Aguardando geração" com o Claude gerando** — a geração começa no envio do
   material ao Claude.
5. **Duas datas de "no ar"** — "No ar desde" e "Última publicação", com esses
   nomes, em todas as telas.
6. **Atividade recente** — filtra pela data do evento e conhece os marcos do
   Claude.
7. **Erro mostrado como vazio** — `ErrorNotice` em Projetos, Deploy,
   Configurações, chaves e tags.
8. **Autor da publicação** — `deployAuthor`.
9. **Link do cliente** — estados corrigidos.
10. **Gerar no Lovable depois de gerar** — rodapé troca; texto da confirmação
    corrigido.
11. **"Conferir" do briefing** — usa o mesmo pedido do "Gerar" e some quando
    algo muda (ver o item em aberto abaixo).
12. **Permissões** — a tela confere a mesma permissão que o servidor e escreve
    o motivo.
13. **Textos quebrados** — plurais por `pluralize`, sem "undefined", "NaN" ou
    "etapa de etapa", dólar com vírgula, datas inválidas sem quebrar, resultado
    do GitHub em português, sem `localhost:3333` fixo.
14. **Contagens divergentes** — tags contadas pelos projetos carregados; estado
    das integrações pelo critério do servidor; selo "configurado" do servidor;
    uma data de recebimento no diálogo do projeto.

Servidor: além dos itens 1 e 2, os projetos do painel ganharam `hasSite` (há
fonte de site na pasta "site"). Sem site, o próximo passo é "Gerar com o
Claude", e não um passo de publicação (`routes/local-projects.js`, com teste).

### Removido

- Telas e peças substituídas: `project-card.tsx`, `project-list.tsx`,
  `work-summary.tsx`, `stage-filter.tsx`, `projects-toolbar.tsx`,
  `date-groups.ts`, `work-queue.ts` (e testes), `project-site.tsx` (e teste),
  `components/filter-chip.tsx`, `tags/tag-filter-bar.tsx`,
  `access/panel-identity.tsx`, `components/theme-toggle.tsx` (o tema foi para o
  menu de conta), `dashboard/phase-color.ts`, `lib/tone.ts`,
  `components/ui/scroll-area.tsx`.
- `configuredRepositories` (o selo do navegador), `useErrorToast`, o tipo
  `failedStep`, o `tagBadgeClass`, o selo "Não salvo" no cabeçalho das seções.

### Correções da revisão visual

Achados nas capturas "depois" e corrigidos antes de fechar:

- Com a lista carregando ou com falha, os contadores do "Fazer agora" e as
  abas mostravam 0; agora mostram "—" e "Sem a lista, não há o que contar", e
  a atividade recente não diz "Nada aconteceu ainda" sem dado.
- Tags espremidas ao lado do material perdiam o nome (sobrava o ponto); agora
  descem para a linha de baixo.
- Na aba Claude de um site entregue, "Enviar ao GitHub" aparecia no cabeçalho e
  no cartão; ficou só no cartão.
- O aviso de geração desligada repetia a frase do título; ficou só o como ligar.
- Deploy sem GitHub configurado: o cabeçalho tirou "Reler repositórios" e
  "GitHub e token" (o aviso já leva às Configurações).
- Lote do Lovable: projetos criados no painel aparecem bloqueados com o motivo,
  sem pedir ao servidor um pacote do Drive que não existe (era um 409 no
  console).
- Os links das seções ganharam o anel de foco dos outros controles; textos que
  ainda falavam do "card" do projeto.

### Verificação

- `npm run lint`: nenhum erro; 11 avisos de *fast refresh* (arquivos que
  exportam um componente e uma constante, como o `button.tsx` do shadcn).
- `npm run typecheck` (web e servidor): limpo.
- Testes: servidor 496 passando e 1 pulado; interface 262 passando. O motor não
  foi tocado.
- Detector do impeccable sobre `web/src`: nenhum achado.
- Capturas na instância isolada (porta 3334, dados semeados, motor falso),
  1440, 1024 e 390 px, claro e escuro: 378 telas — Projetos (abas, filtro,
  seleção), diálogo do projeto (resumo, arquivos, linha do tempo) em quatro
  estados, geração e lote, seis estados do Claude, fila, Dashboard, Deploy,
  Configurações, conta e chaves. Nenhuma tela rola na horizontal a 390 px e
  nenhum controle visível ficou sem nome acessível.
- Casos-limite, com a resposta da API interceptada no navegador: lista vazia,
  um projeto só com nome longo, API respondendo 500, e a ordem do teclado na
  tela Projetos (pular para o conteúdo, seções, busca, conta, ações da página,
  contadores, abas).
- Não vistos na tela: Deploy com repositório configurado e publicações (a
  instância não tem GitHub) — conferidos pelo código e pelos testes
  (`publications-card.test.ts`, `publish-target.test.ts`, `validation.test.ts`).
  Nenhuma ação com custo ou efeito externo foi confirmada.

### Resumo e aba Claude (pedido depois da entrega)

Relato: "a tela de resumo está muito vazia, e a tela do Claude está muito
poluída… existe muito conteúdo para pouco espaço"; o diálogo podia crescer.

- **Diálogo do projeto**: de 64rem × 90% para até 92rem × 94% da tela
  (`h-dialog-full`, `max-w-dialog`). As colunas seguem a largura do diálogo
  (`@container`), então valem também em tela pequena com o diálogo cheio.
- **Resumo** (`project-summary.tsx`): o caminho até o domínio em seis etapas,
  com a data de cada uma cumprida e a atual no tom dela (ou do problema); o
  texto do briefing à vista, rolando por dentro; o site do Claude com as
  primeiras telas; e, ao lado, o material (tipos de arquivo e as miniaturas das
  imagens da pasta) e as cinco últimas atividades. Cada bloco leva à aba com o
  detalhe. O briefing usa a mesma consulta do "Ver prompt" e as miniaturas a
  mesma lista da aba Arquivos: nenhuma leitura a mais do Drive.
- **Aba Claude**: no cabeçalho do site, "Validar" e "Fotografar telas" (não
  gastam); à esquerda o GitHub e o pedido de ajuste, à direita a última crítica
  com as notas em duas colunas e o parecer encurtado ("Ler o parecer
  inteiro"); as telas maiores, quatro por linha. Com o site feito, o briefing e
  as execuções ficam recolhidos, com o estado à vista na linha do título.
- **Briefing do Claude em revisão**: os campos à esquerda, as fotos e as opções
  do site à direita.
- **Corrigido no caminho**: as "Opções avançadas" do briefing apareciam sempre
  abertas (o `forceMount` do Radix monta e mostra; faltava esconder pelo
  `data-state`). No celular, o cabeçalho do diálogo espremia o domínio e o selo
  ao lado do botão, e a aba Claude sumia à direita; agora as ações descem e as
  abas rolam de lado.
- Conferido na instância isolada, com uma crítica de rodada 2 semeada, a 1440,
  1000 e 390 px e no tema escuro; as miniaturas do material foram simuladas,
  porque o Drive falso não as gera.

### Faixas de data, edição do projeto e o ritmo dos últimos dias (pedido depois da entrega)

- **Faixas de data** voltaram (`date-groups.ts`, que tinha saído com a grade, e o
  teste dele): Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, o mês e o ano, presas ao
  topo na tabela e nos cartões. Valem quando a ordem é por data (coleta ou última
  atividade); a ordem padrão passou a ser **Coleta mais recente**.
- **Editar o projeto** (substitui "Renomear"): domínio, nome, etapa, data de
  recebimento, responsável e observação interna. Servidor: `store/project-details.js`,
  rota `PATCH /api/projects/:id/details` (permissão *organizar*), tudo conferido antes
  de gravar, com teste (`project-details.test.js`). A lista sai da API com o domínio e
  a data corrigidos; `details` diz o que foi mexido.
- **Etapa manual** (decisão do responsável: vale até o próximo fato): seis estados
  novos (`manual-material`… `manual-no-ar`) com etapa, grupo do "Fazer agora" e
  botão próprios; o selo leva um lápis e a frase diz quem escolheu e quando. Perde a
  validade quando `lastFactAt` passa da escolha. Testes em `stage.test.ts`.
- **Responsável e observação**: na linha e no cartão, no cabeçalho do diálogo, na busca;
  o responsável vence quem gerou o site no "Por desenvolvedor" do Dashboard.
- **"Fazer agora"**: os contadores continuam; embaixo, o ritmo dos últimos 7 ou 30 dias
  (novos — coletas e criados no painel —, gerados, enviados, no ar), calculado por
  `summarize` do Dashboard, que ganhou `receivedInPanel`, `generated` e `delivered`.
- **Corrigido no caminho**: a faixa de data ocupava sete colunas com a do material
  escondida, e o navegador criava uma coluna fantasma que espremia os nomes; agora ela
  ocupa as colunas visíveis.
- Removidos: `rename-project-dialog.tsx` e `applyName`/`setProjectName` da interface
  (a rota `PUT /api/projects/:id/name` continua no servidor).

### Relatório para pagamento (pedido depois da entrega)

Pedido: extrair do Dashboard os sites por etapa ("envio ao cliente", "publicação",
as duas…) — relatórios usados no pagamento dos desenvolvedores.

- Botão *Relatório para pagamento* no cabeçalho do Dashboard, num diálogo com
  filtros próprios: etapas (várias, com a contagem de cada uma), desenvolvedor,
  período opcional pela data de um passo, "Um site por domínio" e "Incluir os
  finalizados". Os sites e o total por desenvolvedor (com a quebra por etapa)
  aparecem antes do download; o rodapé diz quantos vão no arquivo.
- Regras contra pagamento errado, cada uma com teste (`payment-report.test.ts`):
  etapa e desenvolvedor iguais aos do Dashboard; recoleta do mesmo domínio fora por
  padrão; finalizados fora por padrão; quem não tem a data do período sai e é contado;
  etapa escolhida à mão marcada e avisada; campo que o Excel leria como fórmula
  neutralizado.
- Planilha: CSV com ";", UTF-8 com a marca e CRLF — abre no Excel em português com os
  acentos certos. Conferido na instância isolada: baixado pelo navegador, lido de volta.
- Corrigido no caminho: o bloco de ações do cabeçalho de página não quebrava linha
  (`shrink-0` sem limite) e, no celular, o Dashboard rolava de lado; agora ele cabe na
  largura e quebra.

### Seletores, campos, edição em massa e ocultar (pedido depois da entrega)

Relato: "algumas caixas de seleção estão bugadas, assim como os campos de seleção
que estão com uma borda que acaba deixando o projeto amador".

- **Seletores**: abriam no modo "alinhado ao item" do Radix — a lista por cima do
  próprio campo, com o item escolhido sobreposto a ele e cortado. Agora abrem embaixo
  (`position="popper"`, à esquerda, 4 px de distância), com respiro em volta dos
  itens. Vale para todos os seletores do painel (`components/ui/select.tsx`).
- **Campos focados**: borda e anel de 2 px na cor do foco a 60% formavam uma moldura
  dupla escura. Agora a borda escurece e um halo leve (3 px, 15%) aparece — em
  `input`, `textarea`, `select` e `input-group`. O foco de botão, só no teclado, segue.
- **Menu de tags**: "Sem tag" ficava numa caixa de cantos arredondados com a borda em
  cima, e sobrava um vão embaixo; agora um separador e o mesmo desenho dos outros itens.
- **Edição em massa**: *Editar* na barra de seleção (responsável e etapa).
- **Ocultar projetos**: menu ⋯ e barra de seleção; aba *Ocultos*; fora dos
  contadores, do Dashboard e do relatório. Servidor: `hidden` em
  `store/project-details.js`, com teste.
- Conferido na instância isolada, com capturas antes e depois de cada controle e o
  fluxo inteiro (marcar, editar três, ocultar, mostrar de novo) lido de volta na API.

### Em aberto

- **Ensaio do briefing do Claude**: o servidor usa o modelo e o esforço
  escolhidos no ensaio, mas as opções do site (rodadas, referências) só entram
  no briefing no "Gerar". A tela avisa quando o ensaio leu a versão gravada.
  Para o ensaio conferir também as opções, o motor teria de revisar o briefing
  com elas sem gravar — mudança no pacote do motor, não feita.
- **Passo em que o deploy falhou**: segue a decisão de backend registrada
  acima. A tela deixou de prometer o dado; quando a API o enviar, volta a
  "Parou em…".
- **Cores e tipografia da Joinvix**: o `DESIGN.md` não cria regras de marca
  além do logo e do nome até as oficiais serem indicadas.
- **Seção "Deploy"**: mantido o nome, como recomendado.
