# Guia técnico · Painel Sites Express

Painel do fluxo inteiro de um Site Express: da coleta de material no Google Drive à
geração do site no Lovable e à publicação por FTP via GitHub Actions. Cada pasta de
primeiro nível dentro da pasta raiz do Drive é tratada como um **projeto** (a coleta
de material de um cliente).

O painel tem duas seções, alternadas no cabeçalho:

| Seção        | O que faz                                                      |
| ------------ | -------------------------------------------------------------- |
| **Projetos** | Coletas do Drive, tags, briefing e geração do site no Lovable   |
| **Deploy**   | Secrets, workflows e publicação dos repositórios da organização |

O botão **Publicar** no card (e no modal) de um projeto que já gerou site leva direto
à seção Deploy, com o domínio preenchido a partir do nome da pasta e o repositório
sugerido a partir do site gerado.

## Stack

| Camada   | Tecnologias                                                                     |
| -------- | ------------------------------------------------------------------------------- |
| Frontend | Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui, lucide-react, TanStack Query |
| Backend  | Node + Express, `googleapis` (Drive v3), API REST do GitHub                      |
| Comum    | `shared/` — o que API e interface precisam enxergar igual (as permissões)         |

A chave da service account e o token do GitHub **nunca** chegam ao navegador: toda
comunicação com o Drive e com o GitHub acontece no backend, que também faz proxy
autenticado das miniaturas e do conteúdo dos arquivos.

## Como rodar

```bash
npm run setup
```

```bash
npm run dev
```

- Painel: http://localhost:5173
- API: http://localhost:3333

O Vite já faz proxy de `/api` para a API, então basta abrir a porta 5173.

> O proxy do Vite roda com `changeOrigin: false` de propósito: a API só aceita
> requisições cujo `Origin` bate com o `Host`, e reescrever o `Host` derrubaria toda
> chamada do dev server com 403.

Em produção o mesmo processo serve painel e API na mesma porta:

```bash
npm run build
npm start
```

Depois abra http://localhost:3333.

### Quando a API não sobe com `npm run dev`

O `concurrently` sobe painel e API juntos, mas cada um vive em um processo
separado: se a API morre, o Vite continua de pé e o painel só devolve erro em
toda chamada de `/api`. Vale ler o painel `[api]` do log antes de qualquer outra
coisa.

**A porta 3333 já está ocupada.** É a causa mais comum, e vem de um `npm run dev`
anterior que ficou para trás — no Windows, fechar o terminal nem sempre derruba
os filhos do `concurrently` e do `node --watch`. A API avisa e sai com código 1.
Para achar e encerrar o processo pendurado, no PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3333 -State Listen | Select-Object OwningProcess
```

```powershell
Stop-Process -Id <pid> -Force
```

> No Git Bash, `taskkill /PID <pid> /F` não funciona: o MSYS converte `/PID` em
> caminho antes de o comando rodar. Use o PowerShell, ou `taskkill //PID <pid> //F`.

Alternativamente, `PORT=3334` no `.env` — mas aí o `target` do proxy em
`web/vite.config.ts` precisa acompanhar, senão o painel continua batendo em 3333.

**A API demora alguns segundos a mais que o Vite.** O `googleapis` é pesado para
carregar, então o painel costuma abrir antes de a API responder. Enquanto o log
não mostrar `Painel Gerenciador em http://localhost:3333`, as chamadas falham —
basta recarregar a página depois do banner.

**Faltou instalar as dependências dos subprojetos.** `npm install` na raiz só
instala o `concurrently`; `server/` e `web/` têm `package.json` próprios. Use
`npm run setup`, que instala os três.

**O `.env` está incompleto.** Sem `DRIVE_ROOT_FOLDER_ID` a API aborta no arranque,
antes mesmo de abrir a porta. Confira o `.env.example`.

Para isolar o problema, rode cada lado sozinho — sem o `concurrently` no meio, o
erro aparece inteiro:

```bash
npm run dev:api
```

### Lançador para Windows (`Painel Sites Express.exe`)

Para o uso do dia a dia, sem terminal: um duplo clique no
`Painel Sites Express.exe` da raiz sobe o painel (a mesma coisa que
`npm run build && npm start`) e mostra numa janela:

- **o estado**: no ar, iniciando, parado, falhou (com o motivo) ou "no ar fora do
  lançador", quando outro processo já serve a porta. Nesse caso ele não sobe um
  segundo painel. A cada 2 s o lançador confere se a API responde;
- **o endereço** do painel e, com `SERVER_HOST=0.0.0.0`, os endereços na rede local;
- **a interface**: se está compilada e se o código dela mudou desde a última
  compilação. Com a opção ligada, ele compila sozinho ao iniciar;
- **o log** ao vivo, com erros e avisos destacados, e uma cópia em `painel.log`.

Na primeira vez, se faltar alguma dependência, ele roda `npm run setup` sozinho.
**Iniciar**, **Parar** e **Reiniciar** fazem o que dizem. Minimizar esconde a janela na
bandeja com o painel no ar, e fechar pergunta se é para encerrar o painel. Tudo o que
o lançador sobe morre junto com ele, mesmo se ele for encerrado à força: não sobra
Node órfão segurando a porta.

O `.exe` não vai para o repositório. Para gerá-lo, ou regerá-lo depois de mudar
`launcher/PainelLauncher.cs` ou de mover a pasta do projeto, rode:

```bash
powershell -ExecutionPolicy Bypass -File launcher/build.ps1
```

Ele usa o compilador do .NET Framework que já vem no Windows, então não precisa
instalar nada além do Node. O caminho do projeto fica gravado no executável: uma
cópia na Área de Trabalho continua achando a pasta do projeto.

## Configuração

O arquivo `.env` na raiz define:

| Variável                  | Descrição                                                     |
| ------------------------- | ------------------------------------------------------------- |
| `DRIVE_ROOT_FOLDER_ID`    | ID da pasta do Drive que contém as pastas dos clientes         |
| `GOOGLE_CREDENTIALS_PATH` | Caminho da chave JSON da service account (relativo ou absoluto) |
| `PORT`                    | Porta da API (padrão `3333`)                                   |
| `CACHE_TTL_MS`            | Tempo de cache das respostas do Drive (padrão 60s)             |
| `LOVABLE_ENABLE_GENERATION` | `1` libera as chamadas que gastam crédito (padrão `0`)       |
| `LOVABLE_MAX_ATTACHMENTS` | Teto de anexos por envio (padrão 20)                            |
| `LOVABLE_MAX_ATTACHMENT_BYTES` | Teto por anexo (padrão 64 MB)                              |
| `GITHUB_TOKEN`            | Token fine-grained usado pela publicação                        |
| `GITHUB_ORG`              | Organização do GitHub cujos repositórios aparecem no Deploy      |
| `DEFAULT_FTP_HOST`        | Opcional: pré-preenche o servidor FTP em repositórios novos      |
| `SERVER_HOST`             | Interface de escuta da API (padrão `127.0.0.1`)                  |
| `PANEL_ACCESS_TOKEN`      | Chave de acesso ao painel — obrigatória fora do loopback          |
| `BETTERLINKS_MCP_URL`     | Endpoint MCP do BetterLinks, que encurta o link do cliente         |
| `BETTERLINKS_MCP_TOKEN`   | Token de conexão do MCP do BetterLinks                            |
| `BETTERLINKS_PUBLIC_BASE` | Opcional: domínio dos links curtos, se diferente do MCP            |
| `LAN_ALLOWED_HOSTS`       | Hostnames internos extras aceitos, separados por vírgula          |
| `DEV_AREA_URL`            | Domínio da área de desenvolvimento (link de aprovação do cliente) |
| `DEV_AREA_FTP_SERVER` / `_LOGIN` / `_PASSWORD` | FTP desse domínio                     |
| `DEV_AREA_FTP_DIR`        | Opcional: pasta do domínio no FTP (padrão `domains/<domínio>/public_html`) |
| `DEV_AREA_FTP_PROTOCOL` / `_PORT` | Opcionais: protocolo e porta do FTP da área              |
| `DEV_AREA_WATCH_INTERVAL_MS` | Varredura que acha repositórios novos (padrão 3 min; `0` desliga) |

A pasta raiz precisa estar compartilhada com o e-mail da service account
(o `client_email` do JSON da chave) como leitor.

> A chave `g-suite-*.json` está no `.gitignore` — nunca versione esse arquivo.

Nenhuma chave precisa ser editada à mão: a seção **Configurações** do cabeçalho
reúne todas, por assunto (Drive, geração, modelo de IA, GitHub, área de aprovação,
encurtador, rede). Cada seção grava sozinha no `.env` (modo `600`), preservando
comentários e ordem. As regras:

- **Só para quem tem a permissão "Configurar o painel".** A regra é a mesma no
  localhost e na rede local: quem decide é a chave de acesso, não o endereço. Sem a
  permissão a seção nem aparece, e a API responde 403 — ela grava tokens e senhas em
  disco.
- **Segredos nunca voltam para o navegador.** A tela recebe só se estão definidos e uma
  dica para reconhecê-los: prefixo e final nos tokens de formato conhecido
  (`github_pat_…SglD`), no máximo os dois últimos caracteres nas senhas (`••••yS`).
  Campo de segredo vazio mantém o gravado; **Apagar** remove.
- **Ou tudo entra, ou nada muda.** O pedido é validado inteiro antes de gravar: tipo,
  formato (token `github_pat_`, chave `sk-ant-`, `https://`), limites, e as regras que
  cruzam campos — abrir o painel para a rede (`SERVER_HOST`) exige a chave do
  administrador, e apagá-la com a rede aberta é recusado. Quebra de linha é recusada em
  qualquer valor: injetaria outra variável no `.env`.
- **O que só vale ao reiniciar é dito.** Chaves lidas na subida (`PORT`, `SERVER_HOST`,
  Drive, limites do Lovable, encurtador, intervalos de varredura) aparecem com "ao
  reiniciar"; depois de gravadas, um aviso lista as que esperam o reinício. As demais
  (GitHub, área de aprovação, IA, chave do painel) valem na hora.
- **Testes sem efeito colateral.** *Testar o acesso ao GitHub* só lê; *Testar a chave*
  do modelo de IA lista os modelos, sem gerar nada e sem custo.
- Trocar a chave do administrador encerra as sessões abertas com a antiga — inclusive
  a de quem trocou, que entra de novo com a nova.

As credenciais moram só aqui. O botão **Configurar** da tela de Deploy abre esta
mesma tela, já na seção GitHub e publicação — antes havia um segundo formulário, no
Deploy, que gravava quatro destas chaves com outros textos. (As rotas
`/api/deploy/config` continuam na API, com a mesma permissão `configurar`.)

## Política de rede

O painel guarda a chave da service account, o `refresh_token` do Lovable e o token do
GitHub. A API inteira, e não só a publicação, roda atrás da mesma política:

- aceita loopback, IPv4 privado (`10/8`, `172.16/12`, `192.168/16`) e IPv6 local;
- rejeita IPs públicos, hosts públicos, origens cruzadas e headers de proxy;
- não confia em `X-Forwarded-For` ou semelhantes;
- bloqueia progressivamente tentativas repetidas de autenticação e limita as operações
  que alteram repositórios;
- aplica CSP, bloqueio de iframe, `nosniff`, política de referrer e de permissões.

Por padrão a API escuta só em `127.0.0.1`, então nada trafega pela rede. Abrir para
outras máquinas exige `SERVER_HOST=0.0.0.0` **e** `PANEL_ACCESS_TOKEN` — o servidor
avisa no arranque se a chave estiver faltando. O tráfego continua em HTTP: use apenas
em rede confiável, sem expor a porta no roteador.

Antes de autenticar, a única rota que responde é `GET /api/gate`, e ela devolve
apenas `{ authenticationRequired }`. `/api/health` e `/api/deploy/status` **exigem a
chave**: sem isso entregariam o ID da pasta do Drive, o nome da organização no GitHub
e o host de FTP a qualquer aparelho da rede. A exceção é `/api/lovable/callback`, que
é navegação vinda do Lovable e não tem como mandar cabeçalho.

### Abrir para a rede interna

1. `SERVER_HOST=0.0.0.0` e `PANEL_ACCESS_TOKEN` preenchidos no `.env`.
2. `npm run build` — em produção o mesmo processo serve interface e API numa porta.
3. `npm start`.
4. Liberar a porta no firewall do Windows, **restrita à sub-rede local**, num
   PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "Painel Sites Express (LAN)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3333 -Profile Any -RemoteAddress LocalSubnet
```

O `-RemoteAddress LocalSubnet` é o que faz "só quem está no mesmo Wi-Fi": a regra
recusa qualquer origem fora da sub-rede, mesmo que a porta esteja aberta. E
`-Profile Any` cobre o caso comum de o Windows classificar o Wi-Fi como *Pública* —
uma regra só para o perfil *Privado* não valeria nessa rede.

Quem está na rede acessa por IP (`http://<ip-da-maquina>:3333`), pelo nome da máquina
(`http://<hostname>:3333`) ou por mDNS (`http://<hostname>.local:3333`) — os três
passam pela política de rede. O nome é mais durável, porque o IP muda com o DHCP.

Três camadas seguram o acesso, e nenhuma depende das outras:

| Camada                | O que faz                                                     |
| --------------------- | ------------------------------------------------------------- |
| Firewall (LocalSubnet) | Só a sub-rede local alcança a porta                           |
| Política de rede da API | Só endereços privados; rejeita proxy e origem cruzada         |
| `PANEL_ACCESS_TOKEN`  | Chave por aparelho, com bloqueio progressivo por tentativas    |

**O painel é o mesmo no localhost e na rede.** Nada muda pelo endereço de onde se
acessa: o que cada pessoa vê e pode fazer vem só das permissões da chave dela
(criadas e editadas na tela de chaves). Reescrever o `.env` — tokens, senhas do FTP,
chave de IA, rede — exige a permissão **Configurar o painel**; a chave do `.env`
sempre a tem.

### Chaves de acesso, uma por pessoa

A chave do `.env` (`PANEL_ACCESS_TOKEN`) é a **do administrador**. Cada pessoa
que usa o painel pela rede tem a sua, criada no botão de chaves do cabeçalho.
Administrar chaves exige a permissão **`administrar`** — a chave do `.env` sempre a
tem; uma chave pessoal, só se ela foi concedida. Sem a permissão, o botão não aparece e `/api/access-keys` responde 403.
A chave do `.env` é a única que a tela não cria nem revoga.

O que isso muda em relação a uma chave compartilhada:

- **revogar é isolado** — cortar o acesso de uma pessoa não obriga a trocar a de
  todas, e as sessões abertas dela caem no mesmo instante;
- o painel passa a **saber quem entrou** (último acesso por pessoa) e quem
  registrou cada entrega ao cliente;
- a chave é guardada **em hash** (sha256 com sal por pessoa), nunca em claro.
  São 32 bytes aleatórios: a entropia dispensa KDF lento, o que importa porque
  a verificação roda em toda requisição.

A chave em claro aparece **uma única vez**, na tela que a criou. Perdida, o
caminho é revogar e criar outra.

Com a chave definida, o painel troca-a uma vez por um cookie de sessão
(`HttpOnly`, `SameSite=Strict`) em `POST /api/session`. O cookie guarda **um id
de sessão descartável**, não a chave, e a interface **não guarda a chave** em lugar
nenhum: ela é digitada, trocada pelo cookie e descartada. Toda a interface —
inclusive miniaturas e previews, que entram por `<img>` e `<iframe>` — se autentica
pelo cookie.

As sessões ficam em `server/data/sessions.json`, **só como hash** do id: quem ler o
arquivo não obtém um cookie utilizável. Por isso reiniciar a API não obriga ninguém a
informar a chave de novo. Uma sessão cai após 12 h parada ou 7 dias de vida, ao sair
do painel, ao revogar a chave da pessoa e — no caso da chave do `.env` — quando ela é
trocada, seja pela tela de configuração ou à mão no arquivo.

Só tentativas com chave contam para o bloqueio progressivo por IP; um cookie vencido
recebe 401 (`code: "session-expired"`) sem bloquear ninguém.

Os ids de projeto, pasta e arquivo recebidos pela API precisam ter formato de id do
Drive e estar **dentro da pasta raiz das coletas** (`DRIVE_ROOT_FOLDER_ID`); o resto
responde 404, mesmo que a service account o enxergue. Erros internos voltam ao
navegador com uma mensagem genérica — o detalhe fica só no log do servidor.

O bloqueio de iframe é geral (`X-Frame-Options: DENY` e `frame-ancestors 'none'`), com
uma exceção: `/api/files/:id/thumbnail` e `/api/files/:id/raw` abrem para a **própria
origem**, porque é o painel que embute esse conteúdo — sem isso o navegador recusa o
quadro do PDF e mostra o próprio erro de conexão no lugar da pré-visualização. Em
troca, essas duas rotas endurecem o resto da política (`default-src 'none'`,
`script-src 'none'`, `object-src 'none'`) e servem como `text/plain` tudo que o
navegador executaria como página — HTML, XHTML, SVG e XML —, já que ali o arquivo é
conteúdo de terceiro rodando na origem do painel. O download (`?download=1`) preserva
o tipo original, porque aí nada é renderizado.

O acesso ao Google e ao GitHub permanece como conexão **de saída**; a restrição vale
para as conexões de entrada no painel.

## Funcionalidades

- **Listagem dos projetos** com o domínio em primeiro plano e **um selo de estado** no
  canto do card, derivado do próprio fluxo: *Publicação falhou* → *Publicando* →
  *No ar* → *Prévia falhou* → *Link entregue caiu* → *Entregue* → *Pronto para
  enviar* → *Parado no Lovable* → *Gerando no Lovable* → *Publicando prévia* → *Link
  não abre* → *Conectar ao GitHub* → *Site gerado* → *Briefing
  pronto* / *Material coletado* / *Sem material*. *No ar* vem da publicação do mesmo
  domínio (com ou sem `www.`) e só vale depois de uma execução de deploy terminar
  com sucesso no GitHub; com ele o card mostra o domínio em vez do link de preview,
  que deixou de importar. *Link entregue caiu*
  existe porque o cliente com link morto é o caso mais urgente, e antes aparecia
  como *Entregue*, em verde. Antes essa informação vivia espalhada num chip, dois ícones e uma
  caixa de seleção, e nenhum deles respondia sozinho "em que pé está isso?".
  Nº de arquivos, volume, subpastas e a distribuição por tipo ficam numa linha
  discreta sob o título. As tags ficam para as exceções (ver abaixo).
- **Vista "Fazer agora"** (padrão, lembrada no navegador): os projetos agrupados pelo
  que falta fazer, na ordem de urgência — *Publicação falhou*, *Prévia falhou*,
  *Link do cliente caiu*, *Agente esperando resposta*, *Enviar ao cliente*,
  *Conectar ao GitHub no Lovable*, *Criar ou conferir o link*, *Gerar o site*, *Sem briefing*, *Com o cliente — publicar quando aprovar*,
  *Em andamento*, *Sem material*. Os que estão no ar ficam fora; a vista **Todos**
  é a lista por data de antes, e **Finalizados** traz só os que têm a tag
  "Finalizado". Os finalizados eram um botão à parte, combinado com a vista — e em
  "Fazer agora" eles sumiam de novo (a fila esconde o que está no ar, e quase todo
  finalizado está), deixando a lista vazia. Como vista própria, não há combinação a
  dar errado, e a tag "Finalizado" sai da fileira de tags.
- **Andamento ao vivo**: o card (e a lista, e o modal) mostra o que está em curso,
  com o relógio correndo. Na geração, as quatro fases de toda construção —
  *Planejando*, *Escrevendo o site*, *Conferindo o build*, *Respondendo* —, a última
  ação do agente ("Criando src/components/Hero.tsx") e quantos arquivos ele já
  escreveu, lidos das mensagens do Lovable (`list_messages`, gratuita). Na
  publicação, no domínio ou na área de aprovação, o passo do deploy no GitHub
  ("Passo 8 de 13 · Instalando dependências e gerando o site") e a barra de
  progresso. Tempo restante não: medindo as gerações da organização, a primeira
  construção levou de 3 a 158 minutos (pausas esperando alguém entram na conta), e
  uma estimativa assim enganaria. A lista se atualiza sozinha a cada 10 s enquanto
  houver algo em curso — antes a área de aprovação ficava de fora, e o link pronto só
  aparecia recarregando a página.
- **Ações em massa**: a caixa no canto do card (ou a primeira coluna da lista) marca
  projetos; com algum marcado, clicar no card marca em vez de abrir, e uma barra fixa
  no rodapé oferece **Adicionar tag**, **Remover tag**, **Finalizar** / **Reabrir**,
  **Gerar em lote**, **Publicar na área** e **Verificar links** — cada botão diz
  quantos alcança, e só aparece quando serve a algum dos marcados. As tags vão três
  projetos por vez, e o que falhar volta ao que era.
- **Um botão de próximo passo** no card e na lista, que muda com o selo: *Gerar*,
  *Conectar GitHub*, *Criar link*, *Verificar link*, *Enviar ao cliente*, *Publicar*,
  *Responder*,
  *Acompanhar*, *Ver erro*, *Abrir site*. Fica sempre no mesmo lugar, o
  primeiro da barra; o resto (gerar outro site, publicar, copiar prompt, abrir no
  Lovable, renomear, abrir no Drive) mora no menu **…**.
- **Criar link** abre o editor do Lovable em outra aba e, no painel, o projeto com o
  campo do *Share preview* em foco — ao voltar com o link copiado, é só colar.
- **Enviar ao cliente** copia uma mensagem pronta para o WhatsApp, com o link curto,
  e registra a entrega, com *Desfazer* no aviso. Substituiu a caixa "pronto" do card e
  o "Marcar como entregue" do modal: o link que abre já está pronto — quem decide isso
  é a sonda do painel.
- **Gerar com um clique**: o *Gerar* do card (com briefing no Drive) abre uma
  confirmação curta com o envio padrão — o briefing como está, os compactados e as
  imagens recomendadas, a assinatura — e avisa o que vale saber antes (site já
  gerado, briefing repetido, anexos cortados pelo teto). *Revisar tudo* abre o
  diálogo completo. Sem briefing, vai direto para o diálogo completo.
- **Gerar em lote**: pelo grupo *Gerar o site* da vista "Fazer agora" (**Gerar os N
  em lote**) ou por qualquer seleção (barra de ações). Os projetos são lidos do Drive
  (três por vez), cada um com o seu envio padrão; os que não têm envio padrão ficam
  de fora com o motivo. O diálogo explica as três etapas antes de qualquer envio:
  **1. envio ao Lovable** — um por vez, uns segundos cada, e só esta etapa precisa da
  aba aberta; **2. construção no Lovable** — todos ao mesmo tempo, lá, com o andamento
  no card de cada um; **3. aviso de pronto**. Antes o texto dizia "um depois do outro"
  e parecia que a aba precisava ficar aberta durante toda a construção.
- **Responder ao agente parado**: quando o agente para esperando alguém, o painel lê
  a pergunta dele (a fala ao usuário, sem os pensamentos e comandos do registro) e o
  *Responder* do card abre um campo já com "Pode seguir." — é uma mensagem ao
  agente, então gasta crédito e passa pela mesma chave `LOVABLE_ENABLE_GENERATION`.
- **Publicar sem sair do projeto**: o *Publicar* abre um diálogo com o repositório
  já sugerido, e diz de onde veio a sugestão. Quando o painel
  já configurou aquele domínio no repositório, é um botão — **Publicar agora** —,
  sem senha. Senão, o formulário aparece e **Salvar e publicar** grava e dispara de
  uma vez. O andamento da execução aparece ali mesmo. Workflow de versão antiga não
  impede: ele publica, e o diálogo avisa. Simulação, workflows e histórico continuam
  na aba Deploy, a um link.
- **O repositório de cada site, sem adivinhação.** O repositório nasce quando o
  projeto é conectado ao GitHub no Lovable (o MCP não faz essa conexão), e o GitHub o
  batiza com o nome do projeto no Lovable: minúsculas, e tudo que não é letra ou
  número — acentos inclusive — vira hífen ("SBC Cobranças: Smart Recovery" →
  `sbc-cobran-as-smart-recovery`; conferido em todos os repositórios da organização
  que vieram do Lovable). O painel guarda esse nome em cada geração (`lovableName`, lido
  pelo `get_project`, que é gratuito) e sugere, nesta ordem: o repositório **já
  confirmado** para o site, o que **já publicou o domínio**, o que tem **o nome do
  projeto no Lovable** e, por último, o **palpite** pelo nome da coleta — só este vem
  marcado para conferir. Publicar confirma a escolha (`repoFullName` na geração), e
  da próxima vez ela vem certa. Sem repositório ainda, o diálogo diz o nome que ele vai
  ter e tem o botão *Atualizar* para reler a lista depois de conectar.
- **Por que não copiar o código do Lovable direto para o GitHub.** O `read_file` do
  MCP devolve arquivos binários como texto e troca cada byte inválido por `�`: no
  teste, `caminhao-hero.jpg` perdeu 54.329 bytes e começou com `efbfbd` em vez de
  `ffd8ff`. O código viria certo, as imagens não — inclusive as geradas pelo agente,
  que só existem lá. Até o Lovable entregar binários sem perda, a conexão com o GitHub
  pelo próprio Lovable é o único caminho sem perda.
- **Avisos**: quando um site termina ou para no Lovable, ou uma publicação termina
  (bem ou mal), aparece um aviso. Em outra aba, vira notificação do navegador (a
  permissão é pedida ao gerar ou publicar) e um contador no título da aba.
- **Visão em lista** em cinco colunas — projeto (com o material embaixo do nome),
  estado, link e tags, datas, ações. Cabe sem rolagem horizontal.
- **Ordenação** por data da coleta, nome, última atividade, quantidade de arquivos,
  volume ou quantidade de tags — em ordem crescente ou decrescente.
- **Faixas de data** separando a lista quando a ordenação é por data: *Hoje*, *Ontem*,
  *Últimos 7 dias*, *Últimos 30 dias*, depois por mês no ano corrente e por ano no que
  é mais antigo, cada faixa com a sua contagem. Nas outras ordenações a lista sai
  corrida — não há faixa que descreva a sequência. A referência de tempo é o instante
  da sincronização, o mesmo do rodapé, para o resumo e as faixas nunca discordarem.
- **Busca** por nome/domínio do projeto, alcançando também o nome dado no painel.
- **Visualização em grade ou lista**, com as **mesmas ações** nas duas: o próximo
  passo, o menu **…** e as tags editáveis. A lista é a visão densa e traz as mesmas
  informações em colunas.
- **Renomear o projeto** no painel. Quando o cliente não informa o domínio no
  formulário, a pasta nasce sem nome útil; o apelido dado aqui passa a valer no título,
  na busca, na ordenação e no atalho de publicação. A pasta no Drive **não** é
  renomeada — o acesso lá é somente leitura —, e apagar o apelido devolve o nome dela.
- **Modal de arquivos** por projeto, com miniaturas reais do Drive, navegação em
  subpastas (breadcrumb), busca e ordenação próprias.
- **Pré-visualização do arquivo** dentro do painel (imagem, PDF, vídeo, áudio, texto e
  documentos nativos do Google, exportados para PDF sob demanda), com navegação por
  setas ou teclado, download e link para o Drive.
- **Tags** por projeto, com cor e nome livres: aplicadas pelo card ou pelo modal, e
  criadas na hora digitando um nome novo no seletor. “Gerenciar tags” abre o CRUD
  completo (criar, renomear, trocar a cor, excluir com confirmação). Servem para as
  **exceções** — *Material incompleto*, *Aguardando cliente*, *Finalizado* —, não para
  a etapa: essa o selo calcula sozinho. As etiquetas de etapa dos primeiros meses
  (*A avaliar, Aprovado, Em produção, Entregue, Produzido*) repetiam o selo à mão —
  *A avaliar* chegou a 77 de 80 projetos — e foram removidas uma vez, na primeira
  subida desta versão. Nenhuma tag é aplicada automaticamente.
- **Gerar sem briefing no Drive**: o botão *Gerar* aparece em todo projeto. O servidor
  nunca exigiu o arquivo *Informações do Site* — só um prompt não vazio —, então
  esconder o botão apenas obrigava a subir um arquivo ao Drive para descrever o site.
  Sem briefing, o texto sai do campo de observações do próprio diálogo.
- **Vídeo, áudio e compactado como anexo**: liberados. O bloqueio era decisão do
  painel, não limite da API — medido contra o Lovable, `get_file_upload_url` emite URL
  assinada para `video/mp4`, `video/quicktime`, `application/zip`, `application/vnd.rar`
  e `audio/mpeg`; o PUT do conteúdo devolve **200**; e o schema de `files` em
  `create_project` não restringe `mime_type`. Vídeo e áudio não vêm pré-marcados e
  trazem uma ressalva na linha: o **upload** é aceito, o aproveitamento do conteúdo
  pelo modelo é que não foi possível confirmar sem gastar crédito. O **compactado vem
  marcado, antes das imagens**: é como se mandam mais imagens que o limite de anexos,
  e as fotos do cliente costumam chegar num `.zip`.
- **Observações adicionais na criação**: um campo próprio, ao lado do briefing, para as
  instruções do operador (paleta, seções a evitar, referências). Elas vão ao Lovable
  como um bloco separado, depois do briefing, e **o arquivo do Drive não é alterado** —
  o briefing é o que o cliente escreveu e vale como registro. O contador de caracteres
  mostra o texto composto, que é o que realmente é enviado.
- **Copiar o prompt do Lovable**: quando a pasta tem o arquivo *Informações do Site*, o
  menu **…** do card tem **Copiar prompt**, e o modal do projeto ganha **Ver prompt**
  (leitura antes de usar) e **Copiar prompt**. O texto é extraído no servidor — PDF via `unpdf`,
  documentos do Google via exportação para texto — e copiado já pronto para colar.
- **Filtro por tags** na barra de chips: seleção múltipla com modo **Qualquer** (padrão)
  ou **Todas**, mais o filtro **Sem tag** para achar o que ainda não foi triado. Os
  números das etapas e das tags contam **com os outros filtros aplicados** (vista,
  busca, e a outra fileira) — é o que aparece ao clicar. Antes as tags contavam todos
  os projetos, inclusive os finalizados escondidos, e uma etapa com "5" podia abrir
  uma lista com 1. Sob os filtros, uma linha diz quantos projetos estão na tela e por
  quais filtros, com um **Limpar filtros** só para busca, etapa e tags; a lista vazia
  diz o que está filtrando e oferece o mesmo botão.
- **Link do cliente**: o link de *Share preview* do Lovable, colado no modal do
  projeto, vira um endereço curto do próprio domínio via BetterLinks. O endereço
  é estável e repontável, e o painel verifica se ele realmente abre antes de
  liberar o envio.
- **Publicação por FTP** na seção Deploy: escolha do repositório com busca, gravação
  dos secrets e workflows, disparo do deploy (com dry-run) e acompanhamento das
  execuções do GitHub Actions em tempo real. O botão **Publicar** do projeto entra
  nessa tela já com o domínio da coleta e o repositório sugerido.
- **Registro de entrega**: o painel guarda *quando* o link foi enviado e *por quem*
  — a pergunta que antes só o histórico do WhatsApp respondia.
- **Histórico de publicação** na seção Deploy: quais domínios estão no ar, desde
  quando e por quem (ou "por edição no Lovable"), incluindo os últimos disparos de
  cada repositório e a última publicação que falhou, com o link do erro.
- **Resultado real da publicação**: o painel lê as execuções do workflow de deploy no
  GitHub — de qualquer origem, porque cada edição no Lovable faz push e o push publica
  sozinho. Depois de *Publicar agora* confere a cada 15 s até terminar; fora disso,
  uma passada a cada 10 min. Execuções canceladas (atropeladas pela concorrência do
  workflow) e simulações não contam. Antes o painel marcava *No ar* no disparo: na
  primeira conferência, um dos sites tinha os quatro disparos falhos e
  estava no ar por um push feito logo depois.
- **Verificação automática dos links de cliente**, a cada 30 min por padrão
  (`PREVIEW_WATCH_INTERVAL_MS`; `0` desliga e deixa só o botão manual).
- Tema claro/escuro.

## API

| Rota                          | Descrição                                                    |
| ----------------------------- | ------------------------------------------------------------ |
| `GET /api/gate`               | Se o painel pede chave — a única rota pública                |
| `GET /api/me`                 | Quem está usando o painel                                    |
| `GET/POST /api/access-keys`   | Lista e cria chaves de acesso (permissão `administrar`)       |
| `DELETE /api/access-keys/:id` | Revoga uma chave e encerra as sessões dela                    |
| `POST /api/projects/:id/generations/:lovableId/delivered` | Registra a entrega ao cliente |
| `POST /api/projects/:id/generations/:lovableId/reply` | Responde ao agente parado — **gasta crédito**, exige `confirm: true` |
| `PUT /api/projects/:id/generations/:lovableId/repository` | Liga o site ao repositório em que ele é publicado |
| `GET /api/deploy/publications` | Domínios publicados e o último envio de cada um              |
| `GET /api/health`             | Status da API e pasta raiz configurada                       |
| `PUT /api/projects/:id/generations/:lovableId/share-link` | Registra o Share preview e garante o link curto |
| `POST /api/projects/:id/generations/:lovableId/share-link/check` | Reconfere um link |
| `POST /api/share-links/check` | Varre todos os links de cliente                              |
| `GET /api/shortlinks/status`  | Se o encurtador está configurado                             |
| `GET /api/projects`           | Projetos com métricas agregadas (`?refresh=1` ignora o cache) |
| `GET /api/folders/:id/files`  | Conteúdo de uma pasta (`?refresh=1` ignora o cache)           |
| `GET /api/files/:id/thumbnail`| Miniatura do arquivo (`?size=400`, entre 32 e 1600)           |
| `GET /api/files/:id/raw`      | Conteúdo do arquivo (`?download=1` força download)            |
| `GET /api/projects/:id/brief` | Texto do arquivo *Informações do Site* (404 se não houver)     |
| `GET /api/tags`               | Tags com a contagem de projetos de cada uma                   |
| `POST /api/tags`              | Cria uma tag (`{ name, color }`)                              |
| `PATCH /api/tags/:id`         | Renomeia ou troca a cor                                       |
| `DELETE /api/tags/:id`        | Exclui a tag e a remove de todos os projetos                  |
| `PUT /api/projects/:id/tags`  | Define as tags de um projeto (`{ tagIds }`)                    |
| `PUT /api/projects/:id/name`  | Apelida o projeto no painel (`{ name }`; vazio volta ao Drive) |
| `GET /api/lovable/status`     | Se o painel está conectado ao Lovable e se a geração está liberada |
| `POST /api/lovable/connect`   | Registra o painel e devolve a URL de consentimento              |
| `GET /api/lovable/callback`   | Retorno do OAuth — troca o code pelos tokens                    |
| `POST /api/lovable/disconnect`| Revoga e esquece os tokens                                      |
| `GET /api/lovable/tools`      | Lista as tools do MCP (chamada gratuita, serve de teste)        |
| `GET /api/lovable/workspaces` | Workspaces da conta (gratuita) — a geração exige escolher um    |
| `GET /api/projects/:id/build-package` | Prompt do briefing + arquivos do projeto classificados  |
| `POST /api/projects/:id/generate/preview` | Ensaio: valida o envio sem tocar no Lovable         |
| `POST /api/projects/:id/generate` | Cria o site no Lovable — **consome crédito**                |
| `POST /api/session`           | Troca a chave de acesso pelo cookie de sessão                   |

Rotas da publicação, todas sob `/api/deploy`:

| Rota                                       | Descrição                                             |
| ------------------------------------------ | ----------------------------------------------------- |
| `GET /status`                              | Estado do painel de publicação (não exige autenticação) |
| `GET /config` · `POST /config`             | Lê e grava o `.env` — permissão `configurar`           |
| `POST /config/check`                       | Diagnóstico do token contra o GitHub (só leituras)      |
| `GET /repositories`                        | Repositórios da organização, paginados                  |
| `GET /repositories/:owner/:repo/workflows` | Workflows atuais, com a versão do template              |
| `GET .../workflows/preview`                | Conteúdo de um workflow do repositório                  |
| `DELETE .../workflows`                     | Remove YAMLs de `.github/workflows`                     |
| `GET .../runs`                             | Últimas execuções do GitHub Actions                     |
| `POST .../publication`                     | Grava os secrets e os dois workflows                    |
| `POST .../deploy`                          | Dispara o deploy (aceita `dryRun`)                      |

As métricas são levantadas com uma consulta por pasta, disparadas com concorrência
limitada (8 simultâneas, ~2,3s para 61 projetos) e guardadas no cache por 60s.

> Agrupar várias pastas numa única consulta com `OR` de `parents` parece mais rápido,
> mas a busca do Drive devolve resultados **incompletos** nesse formato — na nossa
> pasta, 499 arquivos em vez de 506. Não faça isso.

## Estrutura

```
.
├── .github/workflows/ # verificação do próprio painel (lint, tipos, testes, build)
├── .env               # configuração (não versionar; modelo em .env.example)
├── server/            # API Express: Google Drive, Lovable e publicação
│   ├── data/          # estado do painel e backups — criado na 1ª execução
│   ├── workflows/     # templates publicados nos repositórios dos clientes
│   │   ├── *.yml      # build e deploy via FTP
│   │   └── scripts/   # passos em Bash embutidos nos templates (testados)
│   └── src/
│       ├── index.js   # partida: confere a configuração, retoma sessões, escuta
│       ├── app.js     # monta a aplicação (middlewares e routers), sem abrir porta
│       ├── http.js    # HttpError, tratador de erros e o que o navegador pode ler
│       ├── config.js  # leitura do .env e configuração de runtime
│       ├── cache.js   # cache em memória com TTL, sem consultas duplicadas
│       ├── drive.js   # cliente do Drive, consultas e alcance da pasta raiz
│       ├── brief.js   # extração do texto do "Informações do Site"
│       ├── backup.js  # cópias diárias do banco e recuperação
│       ├── atomic-write.js  # gravação atômica e fila de escrita
│       ├── express.d.ts     # tipo de req.identity
│       ├── routes/
│       │   ├── access.js         # porteiro, sessão, identidade e chaves de acesso
│       │   ├── projects.js       # projetos, briefing, tags e apelido do projeto
│       │   ├── tags.js           # CRUD das tags
│       │   ├── files.js          # pastas, miniaturas e conteúdo (com Range)
│       │   ├── files-helpers.js  # regras puras das rotas de arquivo
│       │   └── drive-scoped.js   # :id válido e dentro da pasta raiz
│       ├── store/     # banco do painel (painel.json)
│       │   ├── db.js           # leitura, migração, recuperação e gravação
│       │   ├── tags.js         # tags e as tags de cada projeto
│       │   ├── project-names.js # apelido do projeto
│       │   ├── generations.js  # sites gerados e o link do cliente
│       │   ├── publications.js # histórico de publicação
│       │   └── access-users.js # chaves de acesso (em hash)
│       ├── security/
│       │   ├── authenticate.js   # quem está falando com a API
│       │   ├── access.js         # chaves em hash e sessões persistidas
│       │   ├── permissions.js    # o que cada chave pode fazer
│       │   ├── network.js        # política de acesso LAN
│       │   ├── drive-scope.js    # id válido e dentro da pasta raiz
│       │   ├── embedded-asset.js # cabeçalhos do conteúdo embutido
│       │   └── throttle.js       # bloqueio progressivo e rate limit
│       ├── lovable/
│       │   ├── oauth.js            # registro do cliente, PKCE e renovação do token
│       │   ├── mcp.js              # cliente MCP (JSON-RPC sobre HTTP)
│       │   ├── package.js          # prompt, anexos e validação do envio (só Drive)
│       │   ├── upload.js           # subida dos anexos ao storage do Lovable
│       │   ├── generate.js         # dispara a criação (o único gasto de crédito)
│       │   ├── generation-guard.js # trava contra gasto duplicado de crédito
│       │   └── routes.js           # rotas de conexão e geração
│       ├── preview/
│       │   ├── share-link.js # classificação do link "Share preview"
│       │   └── service.js    # link do cliente e varredura periódica
│       ├── shortlinks/
│       │   ├── mcp.js     # cliente do MCP do BetterLinks
│       │   └── service.js # link curto estável por projeto
│       └── deploy/
│           ├── github/              # API REST do GitHub
│           │   ├── client.js        # autenticação, erros, novas tentativas, paginação
│           │   ├── contents.js      # arquivos em .github/workflows
│           │   ├── repositories.js  # repositórios e execuções do Actions
│           │   └── access-check.js  # diagnóstico do token
│           ├── publication.js       # secrets (sealed box) e escrita dos workflows
│           ├── workflow-render.js   # substituição dos placeholders do YAML
│           ├── workflow-template.js # leitura dos templates em disco
│           ├── env-file.js          # leitura e escrita do .env
│           ├── settings.js          # tela de configuração
│           ├── input.js             # validação do que vem do navegador
│           ├── guards.js            # permissão, cota e organização
│           ├── operations.js        # disparo, remoção e versão dos workflows
│           └── routes.js            # rotas /api/deploy
├── shared/            # usado pelos dois lados (lista de permissões)
└── web/               # Aplicação Vite + React + shadcn/ui
    ├── public/        # favicon.png e apple-touch-icon.png (a marca Joinvix)
    └── src/
        ├── main.tsx   # provedores (consultas, tema) e o portão de acesso
        ├── App.tsx    # seção aberta, lista de projetos e alvo da publicação
        ├── app-header.tsx # marca, navegação entre seções, identidade e tema
        ├── assets/    # joinvix-logo.png (assinatura) e joinvix-mark.png (símbolo)
        ├── components/
        │   ├── ui/    # primitivos do shadcn/ui (só os usados)
        │   └── *.tsx  # peças genéricas, sem regra de negócio (ícone, tema)
        ├── features/  # uma pasta por área; componentes, hooks e regras juntos
        │   ├── access/         # portão, identidade e chaves de acesso
        │   ├── projects/       # lista, cartão, ações, estado e link do projeto
        │   ├── tags/           # tags: filtro, seletor, cores e gestão
        │   ├── project-files/  # diálogo de arquivos da coleta e link do cliente
        │   ├── generate/       # diálogo de geração no Lovable
        │   └── deploy/         # tela de publicação
        └── lib/
            ├── api/   # cliente da API: http.ts (comum) e um módulo por assunto;
            │          # deploy.ts só carrega com a tela de publicação
            └── *.ts   # sessão, cache de consultas, permissões e formatadores
```

Regra de organização da interface: o que pertence a uma área fica em
`features/<área>/`, com os testes ao lado do código. `components/` guarda só o que
não conhece o domínio, e `lib/` o que é infraestrutura compartilhada por várias áreas.

Os passos de shell dos workflows ficam em `server/workflows/scripts/*.sh` e são
embutidos nos templates YAML no momento da publicação. Isso permite testá-los de
verdade, com projetos de exemplo, em vez de confiar em texto solto dentro do YAML.

## Identidade visual

| Arquivo                          | Onde aparece                                     |
| -------------------------------- | ------------------------------------------------ |
| `web/public/favicon.png`         | Ícone da aba (213×218)                            |
| `web/public/apple-touch-icon.png`| Atalho em iOS/Android                             |
| `web/src/assets/joinvix-logo.png`| Assinatura horizontal, no cabeçalho (197×46)      |
| `web/src/assets/joinvix-mark.png`| Só o símbolo, na tela da chave de acesso          |

A assinatura existe em uma versão só, com o texto em azul-escuro, que sumiria no tema
escuro. Por isso ela é exibida sobre uma placa branca: no tema claro a placa se confunde
com o fundo do cabeçalho e desaparece; no escuro ela é o que mantém o logotipo legível.
Havendo um SVG ou uma versão clara da assinatura, dá para trocar a placa por troca de
arquivo entre os temas.

> Os arquivos são bitmap. A assinatura em 197×46 cobre bem os 20 px de altura do
> cabeçalho (≈2× em telas densas), mas não serve para uso impresso ou ampliado — para
> isso é preciso o vetor original.

## Banco do painel e backup

Tags, apelidos, gerações, links de cliente, chaves de acesso e histórico de
publicação vivem num arquivo só: `server/data/painel.json`. Até a versão anterior ele
se chamava `tags.json` — quando só guardava tags —, e é renomeado sozinho na primeira
leitura, sem perder nada. A escrita é atômica (temporário + `rename`), então uma
gravação interrompida não deixa JSON pela metade, e uma falha de gravação não impede as
seguintes. A primeira leitura é compartilhada: requisições simultâneas na subida não
criam cada uma o seu conjunto de tags iniciais.

A pasta de dados pode ser trocada por `PANEL_DATA_DIR` — útil para testar contra uma
cópia sem tocar nos dados de verdade.

Além disso, **antes de cada sobrescrita** o painel guarda uma cópia do dia em
`server/data/backups/painel-AAAA-MM-DD.json` (data local da máquina), mantendo as
últimas 15 — as cópias antigas `tags-AAAA-MM-DD.json` contam na mesma rotação. E se o
arquivo principal ficar ilegível, o painel **sobe a partir da cópia mais
recente que abre**, avisando alto no log em vez de morrer — perder tags e links
de cliente em silêncio é pior que voltar um dia no tempo.

## Testes

```bash
npm test          # backend (node --test) + interface (vitest)
npm run test:server
npm run test:web
npm run typecheck # tipos da API (checkJs) e da interface
npm run check     # lint + tipos + testes + build
```

O mesmo `npm run check` roda no GitHub Actions a cada push e pull request
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Nada nos testes fala com
Drive, GitHub ou Lovable, e o `.env` da máquina é ignorado dentro do `node --test` —
eles valem igual aqui e no CI.

**Backend (220):** a API de verdade numa porta local (entrada, sessão, bloqueio por
IP, permissões por chave, política de rede e respostas de erro), o banco do painel
(criação, migração do nome, recuperação de backup, travas do link do cliente), o
caminho que gasta crédito no Lovable (clique duplo, resposta incerta, recusa
explícita, site criado mas não gravado), alcance dos ids do Drive, gravação atômica,
geração dos workflows (com validação do YAML resultante), classificação do link de
share e detecção da pasta de build em cada layout suportado.

**Interface (112):** a lista de projetos sobre o cache de consultas (uma busca para
vários leitores, escrita otimista e desfazimento quando a API recusa), validação do
formulário de publicação (espelho dos validadores da API), regras do prompt e da
seleção de anexos, ordenação dos arquivos, faixas de data, o cliente HTTP (recusa,
sessão vencida, API fora do ar, tempo limite), a precedência do selo de
estado, o próximo passo de cada etapa, os avisos de site pronto e de publicação, e a
mensagem enviada ao cliente.

### Como a interface busca dados

As leituras passam por um cache de consultas (TanStack Query), com as chaves reunidas
em [`web/src/lib/query.ts`](../web/src/lib/query.ts). Isso substituiu o par
"`useEffect` + `useState` de carregando/erro" que cada tela repetia: agora duas telas
que pedem a mesma coisa fazem uma chamada só, reabrir um diálogo não refaz a busca, o
polling das execuções do GitHub é declarado junto da consulta (e só roda enquanto algo
está em andamento) e salvar algo invalida o que ficou velho, sem cada componente
lembrar de avisar os outros. As escritas continuam sendo chamadas diretas de
`lib/api/`, com atualização otimista do cache e desfazimento em caso de recusa.

## O briefing como prompt

O arquivo é reconhecido pelo início do nome (`Informações do Site`, tolerante a acento e
caixa), **no primeiro nível da pasta do projeto** — o mesmo alcance da detecção que
acende o botão no card. Hoje 34 das 62 coletas têm o arquivo, em dois formatos: PDF
(maioria) e documento do Google.

A extração roda no servidor e fica em cache por 10 minutos. O texto vai inteiro para a
área de transferência, sem cortes.

> A cópia depende de `navigator.clipboard`, que exige contexto seguro — `localhost` é
> um. Se o painel for aberto por IP na rede, o código cai no método legado
> (`execCommand`), e o botão avisa quando o navegador bloqueia.

## Onde as tags ficam salvas

O acesso ao Drive é somente leitura, então as tags vivem no painel, em
`server/data/painel.json` (escrita atômica, criado na primeira execução com três
etiquetas de exceção: *Material incompleto, Aguardando cliente, Finalizado*). Esse arquivo está no `.gitignore` — inclua-o na rotina de backup, ou troque
`store/` por um banco quando o painel sair da máquina local.

O mesmo arquivo guarda, por pasta do Drive, as gerações do Lovable (`generations`) e o
apelido dado ao projeto no painel (`names`). Pela mesma razão — leitura apenas — o
apelido não renomeia a pasta: renomear de verdade exigiria escopo de escrita e trocar o
compartilhamento da service account para Editor.

## Geração do site no Lovable

O botão **Gerar** (no card e no modal do projeto) abre a tela de geração: à esquerda o
prompt, já preenchido com o texto do *Informações do Site* e editável; à direita os
arquivos da pasta — subpastas incluídas — para marcar o que vai como anexo. Imagens e
compactados já vêm marcados (compactados primeiro), até o teto de anexos.

O briefing não é anexado: o texto dele já é o prompt, e mandar o arquivo junto seria
repetir. Vídeo e áudio ficam de fora. **O Lovable não publica quais
formatos aceita como anexo nem o tamanho máximo** — comece pelas imagens e ajuste os
tetos no `.env` conforme descobrir na prática.

### O workspace

`workspace_id` só é opcional para quem tem **um** workspace elegível; com mais de um, o
Lovable devolve `available_workspaces` em vez de criar. Como esta conta tem quatro
(uma própria e três como colaborador), o seletor no rodapé é obrigatório. O padrão é o
workspace do qual você é dono, e a escolha fica lembrada no navegador.

### O link do site gerado

O link só chega uma vez, na resposta do `create_project` — se não for gravado ali,
recuperá-lo depois vira busca manual dentro do Lovable. Então cada criação bem-sucedida
é registrada em `server/data/painel.json`, sob `generations`, por pasta do Drive.

O card passa a mostrar um selo verde com o link (`preview_url`, ou `url` quando o
projeto estiver publicado) e o modal lista todas as gerações daquela coleta — a mesma
pasta pode gerar mais de um site. `DELETE /api/projects/:id/generations/:lovableId`
remove um registro do painel sem tocar no projeto lá no Lovable.

### Acompanhamento da geração

O `create_project` volta assim que o projeto nasce; o site ainda vai ser construído.
Depois do **Gerar**, a API acompanha o agente sozinha (`get_project` e
`list_messages`, gratuitas) e grava na geração: **Gerando no Lovable**, **Parado no
Lovable** (o agente pausou esperando uma resposta no editor — aprovação ou checagem
de crédito — e não retoma sozinho) ou pronto. O card mostra o selo e a lista se
atualiza a cada 20 s enquanto houver site em andamento. O acompanhamento é retomado
se a API reiniciar e desiste depois de 3 horas.

### Assinatura Joinvix e o bloco "Já usado"

- **Assinatura.** Sempre presente, em três camadas:
  1. *Na geração:* o painel baixa as logos do repositório
     [`Sites-profissionais/joinvix-footer`](https://github.com/Sites-profissionais/joinvix-footer)
     (o mesmo do plugin de WordPress) e anexa a todo site: `logo-dark.png` (texto
     escuro) como "Rodapé Claro — para rodapé de fundo claro" e `logo-light.png`
     como "Rodapé Escuro — para rodapé de fundo escuro". A cópia fica em
     `server/data/assinatura/`, é renovada a cada 6 h e segura a geração se o GitHub
     não responder. Trocar a logo no repositório vale para os sites seguintes.
  2. *Quando o agente termina:* o painel lista os arquivos do projeto (gratuito) e
     procura a assinatura em `src/` ou `public/`. Faltando, pede ao agente **uma vez**,
     com as logos anexadas — é uma mensagem, então gasta crédito, e só roda com
     `LOVABLE_ENABLE_GENERATION=1`. O modal do projeto avisa se ela continuar faltando.
  3. *Na publicação:* o build (GitHub Actions) procura o link `joinvix.com.br` no site
     pronto; sem ele, copia a logo para dentro do site e insere uma faixa com a
     assinatura antes do `</body>`. Nenhum site publicado sai sem ela.
- **"Já usado".** A skill `novo-site` termina cada site com a linha `Já usado: …`
  (paleta, tipografia, hero, elemento memorável). Quando o agente termina, o painel lê
  a linha e a põe no topo do bloco entre `<!-- ja-usado:inicio -->` e
  `<!-- ja-usado:fim -->` da Workspace Knowledge, guardando as cinco últimas — ou
  menos, se não couberem nos 10 mil caracteres do Lovable. Só esse trecho é tocado.

### Teto de tamanho dos anexos

O limite de **64 MB por anexo é do painel**, não do Lovable: o armazenamento dele
aceitou PUT de 25 e 60 MB (200 OK) e não anuncia teto. Ele subiu de 20 para 64 MB
porque metade dos vídeos e compactados reais das coletas passava de 20 MB — a
liberação desses tipos ficaria só no papel.

Aumentar mais é seguro de testar: o upload dos anexos acontece **antes** de
`create_project`, a única chamada que consome crédito. Um arquivo recusado aborta a
geração sem custo. Ajuste em `LOVABLE_MAX_ATTACHMENT_BYTES`.

> A gravação passou a existir depois da primeira geração bem-sucedida, então aquele
> site foi registrado à mão. Daqui em diante é automático.

### O que o MCP não faz — e a conferência que resolve

**Esconder o badge do Lovable, desligar os comentários do preview e ligar o GitHub
continuam manuais.** As 40 tools não expõem nenhuma das três: `set_project_visibility`
só troca o nível de acesso (`draft`, `private`, `public`, `workspace_view`), o
`get_project` não devolve campo de badge ou comentário, e o `add_connector` diz por
escrito que *"connectors must always be added through the dashboard — the MCP cannot
add them programmatically"*.

O badge só aparece em site publicado no `lovable.app` — o link de *Share preview*,
que é o que vai ao cliente, não tem badge a esconder. Por isso a caixa "pronto" que
existia para lembrar disso saiu: o que libera o envio é a sonda do link.

### Nome do projeto no Lovable

Não dá para definir. O `create_project` **não tem parâmetro de nome** — o Lovable gera
um a partir do prompt (o briefing do `ipmmanutencao` virou "Ivan's Tech Repair"). Não
existe tool de renomear. O que dá para controlar é a **URL publicada**:
`deploy_project` aceita `name`, que é o slug de `*.lovable.app`.

### Projetos finalizados

A etiqueta **Finalizado** (criada sozinha na primeira execução após esta versão) tira o
projeto do painel. O botão *Finalizados* na barra de ordenação mostra só eles, e some
quando não há nenhum.

> Renomear a pasta no Drive para `[Finalizado] - ...` ficou de fora: o painel usa o
> escopo `drive.readonly` e a service account é leitora da pasta. Renomear exigiria
> escopo de escrita e trocar o compartilhamento para Editor — decisão adiada.

### Tamanho dos documentos do Google

Para arquivos nativos do Google o painel mostra o tamanho como desconhecido, não o
número que o Drive informa: aquele valor é do documento, não do PDF que sobe. Num caso
real, 15 KB de Doc viraram 160 KB de PDF exportado.

### A trava de crédito

`create_project` e `send_message` são as únicas tools do Lovable que debitam crédito, e
o painel só usa a primeira. Ela está atrás de três travas:

1. `LOVABLE_ENABLE_GENERATION=1` no `.env` — sem isso a API responde 423 e nada é
   enviado;
2. `confirm: true` no corpo do POST — sem isso, 428;
3. a confirmação na interface, que diz quantos caracteres e quantos anexos vão.

**Conferir envio** roda um ensaio: valida a seleção e mostra exatamente o que seria
mandado, sem falar com o Lovable e sem gastar nada. Use antes de gerar.

### Como conectar

A autenticação é OAuth — o Lovable não oferece API key. O painel se registra sozinho
via Dynamic Client Registration, que o Lovable mantém aberto **para redirect de
loopback**; é o caso aqui (`http://localhost:3333/api/lovable/callback`). Clique em
**Conectar ao Lovable** e autorize na aba que abrir. A janela **Concluir a conexão**
acompanha o retorno: na máquina do painel ele chega sozinho e a janela se fecha. De
outro computador da rede, a aba de retorno termina numa página que não carrega (ela
aponta para `localhost`, e lá não há painel) — copie o endereço dessa aba e cole na
janela; o painel conclui a troca com o `code` e o `state` dele
(`POST /api/lovable/callback/manual`, permissão `gerar`). Endereço de outra
autorização é recusado pelo `state`. O `refresh_token` fica em
`server/data/lovable-auth.json` (modo 600, dentro da pasta já ignorada pelo git) e a
API renova o acesso sozinha.

**Permissões.** O painel pede `projects:create/read/write`, `workspaces:read` e
`workspaces:write` — a última para manter o bloco "Já usado" da Workspace Knowledge.
O Lovable prende as permissões ao cliente registrado: reconectar com o mesmo
`client_id` reaproveita as antigas. Por isso, quando a lista muda, o painel registra
um cliente novo, e o diálogo de geração mostra **Reconectar** enquanto a conexão
atual não tiver tudo. Os tokens guardam o `client_id` que os emitiu, para a
renovação não quebrar no meio da troca.

> Se um dia o painel sair do localhost, o registro dinâmico deixa de funcionar. As
> saídas são o fluxo de `client_id_metadata_document` (o servidor do Lovable anuncia
> suporte) ou pedir allowlist do redirect ao suporte deles.

## Motores de geração (Lovable e "Lovable próprio")

O painel está preparado para produzir sites por dois motores: o **Lovable** (o de hoje)
e o **Lovable próprio** — um modelo de IA, pela chave configurada, escrevendo o site
num projeto-modelo da organização. O segundo está **arquitetado e não ligado**: nenhuma
rota o chama, `GENERATION_ENGINE` só aceita `lovable`, e escolher, guardar ou testar a
chave de IA não muda nada no que funciona.

O que já existe (`server/src/engines/`, `server/src/ai/`):

| Peça | O que faz |
| --- | --- |
| `engines/index.js` | Registro dos motores e o estado de cada um (mostrado em Configurações) |
| `ai/providers.js` | Provedores de modelo: formato da chave, modelos oferecidos, teste da chave sem custo. Hoje Anthropic (Claude), pelo SDK oficial; um provedor novo é uma entrada a mais |
| `engines/own/workspace.js` | Os arquivos do site em memória. O modelo só escreve `src/`, `public/` e `index.html`; `package.json`, `vite.config`, lockfiles e workflows vêm do modelo de projeto e não mudam — nem um briefing com instrução maliciosa acrescenta dependência com script de instalação ou mexe no workflow que recebe a senha do FTP |
| `engines/own/tools.js` | As ferramentas de arquivo (listar, ler, escrever, apagar), com cada entrada conferida antes de executar |
| `engines/own/prompt.js` | O prompt de sistema (fixo, para o cache valer entre gerações) e a mensagem com o briefing |
| `engines/own/generate.js` | O laço de geração: streaming, adaptive thinking, entrada das ferramentas em streaming, parada em `max_tokens` e `refusal`, cache do prefixo e, no Opus 5 e no Fable 5.1, o fallback do servidor quando o modelo recusa por política |

O caminho previsto, do briefing ao link de aprovação: o mesmo pacote de envio do
Lovable → cópia do projeto-modelo (Vite, React, TypeScript, Tailwind, assinatura e modo
SPA prontos) com os anexos em `src/assets/` → o modelo escreve o site → repositório novo
na organização, num commit só (sem "conectar ao GitHub": nasce ligado) → o workflow da
área de aprovação publica, e daí em diante nada muda. "Responder" vira um pedido de
ajuste com os arquivos atuais, um commit e uma nova publicação.

Falta para ligar: o repositório-modelo, a criação do repositório e o commit pela API
do GitHub, o registro da geração com `engine: "own"` e a rota. O laço foi testado com
um cliente falso; a primeira geração real vai gastar crédito do provedor.

## Site feito fora do painel ("Vincular site existente")

Tudo o que o painel faz com um site — prévia na área de aprovação, link do cliente,
envio, publicação no domínio — depende do registro que o **Gerar** cria. Um site feito
no Lovable à mão, ou fora do Lovable, não tinha esse registro e ficava sem caminho.
**Vincular site existente**, no menu **…** do projeto, cria o mesmo registro:

- **de onde vem o site:** o link do projeto no Lovable, um repositório da organização,
  ou os dois. Só o Lovable: o painel acha o repositório pelo nome do projeto, como nos
  gerados. Só o repositório: o site é tratado como de fora do Lovable — sem "Abrir no
  Lovable" nem Share preview, e o link do cliente é a prévia;
- **em que etapa ele está:** *pronto para aprovação* (próximo passo: **Publicar
  prévia**), *já enviado ao cliente* (próximo passo: publicar no domínio) ou *já está no
  ar* (registra o domínio como publicado por aquele repositório — recusado se o
  repositório já publica outro domínio);
- **publicar a prévia agora:** grava o workflow da área de aprovação no repositório e
  publica. Se falhar, o vínculo fica gravado e a tela diz o motivo.

Um site vinculado não entra sozinho na área de aprovação, ao contrário dos gerados: ele
pode já estar com o cliente por outro caminho. O repositório precisa ser da organização
configurada — o token do GitHub só enxerga ela; um site em outra conta precisa ser
transferido para lá antes.

**Trocar o projeto do Lovable.** Quando o site é refeito num projeto novo (o cliente
pediu mudanças), **Trocar projeto do Lovable**, no menu **…**, aponta o site para o
projeto novo em vez de criar outro registro. Continuam o link que o cliente já recebeu
(o link curto é reapontado quando o Share preview novo for colado) e a pasta da prévia.
Recomeçam o Share preview, o repositório, o nome no Lovable e a marcação de enviado — o
site novo precisa ser conferido e enviado de novo. O repositório antigo perde o
workflow da prévia, para não publicar mais na pasta; a publicação no domínio do cliente
não muda até o repositório ser trocado no Deploy. Em site vinculado de fora do Lovable,
o mesmo item aparece como **Definir projeto do Lovable**.

**Sites sem build.** Além dos sites Vite, a área de aprovação e o deploy aceitam site
estático (HTML, CSS e JS prontos, sem `package.json`, com `index.html` na raiz): o build
é pulado, a raiz do repositório é publicada e, na prévia, os caminhos absolutos
(`/css/…`, `href="/"`, `url(/img/…)`) ganham a pasta na frente — só no runner, sem
commit. Caminhos montados por JavaScript em tempo de execução não são alcançados.

## Área de desenvolvimento (link de aprovação)

Com `DEV_AREA_*` no `.env`, o link que vai ao cliente deixa de ser o Share preview do
Lovable: cada site é publicado numa pasta própria de um domínio da Joinvix
(`https://aprovacao.exemplo.com.br/zezinho/`), e é ela que o cliente abre para
aprovar. Depois da aprovação, o site vai para o domínio do cliente pelo **Publicar**
de sempre.

O fluxo, sem ninguém pedir:

1. O site é gerado. O card mostra **Conectar ao GitHub** — a conexão é feita no
   editor do Lovable (o MCP não faz isso), e o botão do card leva até lá.
2. A varredura (a cada 3 min, `DEV_AREA_WATCH_INTERVAL_MS`) acha o repositório pelo
   nome do projeto no Lovable, grava os secrets `DEV_AREA_FTP_*` e o workflow
   `Area-de-desenvolvimento.yml`. O commit do workflow já é um push, e o push publica.
3. Cada edição no Lovable faz push e publica de novo na mesma pasta — o cliente vê a
   versão nova no mesmo link.
4. Quando uma execução termina bem, o painel lê o `joinvix-build.json` da pasta. Só
   com **o commit daquela execução** lá o link vale (*Pronto para enviar*): abrir não
   basta, porque a pasta pode estar com a versão anterior.

Entram sozinhos os sites novos: sem link curto nem entrega registrada, e cujo
repositório ainda não publica no domínio do cliente. Qualquer outro — inclusive o que
já tem Share preview ou link curto — entra por **Publicar na área de aprovação**, no
menu **…** do card ou no modal do projeto; conferida a pasta, ela passa a ser o link
do cliente. Com o site já na área, o mesmo botão publica de novo. A pasta é do
projeto: gerar o site de novo publica no mesmo endereço, e o workflow sai do
repositório antigo. Duas coletas com o mesmo nome recebem pastas numeradas.

### Por que pasta, e não subdomínio

`zezinho.aprovacao.exemplo.com.br` seria mais simples para o site (ele rodaria na
raiz), mas pede um subdomínio e um certificado por cliente no DirectAdmin, e a
conta tem só FTP. O DNS curinga já responde, mas o servidor devolve a página padrão
e o certificado de outro domínio. Se um dia houver acesso ao painel da hospedagem, a
troca é a base virar `/` e o endereço mudar — o resto do fluxo continua.

### O que muda no build, só na área

Os sites do Lovable são feitos para a raiz do domínio. Na pasta, o workflow da área
adapta o checkout **no runner** — nada é commitado, e o código que vai ao domínio do
cliente continua o mesmo:

| O que quebraria                                   | O que o workflow faz                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| JS e CSS buscados em `/assets/`                    | `vite build --base=/zezinho/` em todo script que roda o Vite   |
| React Router mostra a própria 404 em `/zezinho/`   | `<BrowserRouter basename="/zezinho">` (TanStack lê a base sozinho) |
| `"/videos/v1.mp4"`, `"/favicon.png"` no código      | a pasta na frente dos caminhos para arquivos de `public/`      |
| `<a href="/#contato">`                              | um script no `<head>` corrige os `<a>` no navegador            |
| `.htaccess` mandando rotas para `/index.html`       | `RewriteBase` e fallback apontam para a pasta                   |
| Google indexar o site antes da aprovação            | `noindex` na página e no cabeçalho `X-Robots-Tag`               |

O `--base` vai direto no `vite build` do `package.json` porque os builds do Lovable
costumam ser `vite build && node scripts/flatten-dist.mjs`: no fim do `npm run build`
ele iria para o script de pós-build. Os links de navegação são corrigidos no
navegador, e não no código, porque o mesmo texto (`href: "/#home"`) às vezes vai para
um `<Link to>`, que já recebe a base do roteador — reescrever duplicaria a pasta.

Conferido com três sites da organização (React Router e TanStack Start, com rotas
internas, vídeos e âncoras): todos abriram na pasta, inclusive entrando direto por uma
rota interna. Site que não é Vite, ou que já fixa `--base`, falha no build com a
mensagem dizendo por quê — e o Share preview continua disponível.

### Credenciais

A senha do FTP da área vai como secret para todo repositório que entra nela. Prefira
uma conta FTP presa ao domínio da área (aí `DEV_AREA_FTP_DIR=/`), para que uma senha
vazada não alcance os sites de produção.

## Link do cliente (Share preview + encurtador)

Sem a área de desenvolvimento configurada — e para os sites de antes dela —, o link
que vai ao cliente é um endereço curto do próprio domínio
(`formularios.joinvix.com.br/nome-do-cliente`) que redireciona para a prévia do
site no Lovable. Ele é **estável**: pertence ao projeto, não à geração. Quando a
prévia é recriada, o painel reponta o mesmo endereço — quem já recebeu o link
continua com ele valendo.

### Por que o link precisa ser colado à mão

O `preview_url` que a API do Lovable devolve (`id-preview--<id>.lovable.app`)
**não abre para o cliente**: responde `401 Unauthorized` e, no navegador,
termina na tela de login do Lovable. Marcar o projeto como `public` via
`set_project_visibility` não muda isso — essa flag abre o projeto dentro do
lovable.dev, não o container da prévia.

O que abre é o link do botão **Share** → **Create new preview link**, no formato
`lovable.dev/preview/<código>`. Ele responde `307` para o host da prévia
carregando um `__lovable_token` (JWT `access_type: viewer`). E o MCP do Lovable,
nas suas 40 tools, **não tem nenhuma que o crie** — por isso o operador gera o
link lá e cola no modal do projeto, do mesmo jeito que já confere o badge.

### Validade do link

Pela documentação do Lovable (setembro de 2026), **no plano Pro o link de Share
preview expira em 7 dias**; no Business a validade é escolhida na criação (24 h, 7
dias, 30 dias ou "nunca"). O workspace da JoinVix é Pro. Um link também morre se for
excluído no Lovable ou se o projeto sair de lá.

Por isso a validação é **sonda, não conta de datas**: o painel bate na URL sem
seguir o redirecionamento e lê a resposta.

| Resposta                        | Estado           | O que significa                        |
| ------------------------------- | ---------------- | -------------------------------------- |
| `307` para `*.lovable.app`      | Aberto ao cliente | O link abre o site sem pedir login     |
| `404` / `410`                   | Não abre          | O link foi excluído no Lovable          |
| `401` / `403`                   | Não abre          | Exige autenticação                      |
| Outra                           | Não verificado    | Instabilidade — não condena o link      |

**A trava:** registrar a entrega exige estado `alive`. A API recusa com 409 quem
não tem link ou tem link que não abre, e o card só oferece *Enviar ao cliente* com o
link aberto. O botão **Verificar links**, na barra de projetos, roda a varredura em
todos de uma vez.

**O que é sondado é o que o cliente recebe.** Antes de sondar a prévia, o painel
lê o link curto no BetterLinks e sincroniza o endereço e o destino (se alguém
repontou no WordPress, é para lá que o cliente vai). Com a prévia aberta, sonda
também o link curto: ele tem de responder `307` para a prévia. Um link curto em 404
reprova, mesmo com a prévia viva.

### O prefixo do BetterLinks

O BetterLinks tem um prefixo configurado (`siteprofissional`), e os links criados
depois dele respondem em `formularios.joinvix.com.br/siteprofissional/<slug>`; os
anteriores continuam na raiz. O endereço real é o `short_url` do link, não o slug —
montar pelo slug entregava ao cliente um endereço em 404. Três cuidados decorrem disso:

- o painel monta a URL pública pelo `short_url`, e relê o link pelo ID depois de criar;
- ao repontar, envia o `short_url` exato, e não o `link_slug`: com o slug o BetterLinks
  antepõe o prefixo atual, e um link antigo mudaria de endereço;
- o `list-links` passou a responder paginado (`results`, `has_more`); o painel lê os
  dois formatos. No formato novo ele enxergava zero links e, sem achar o do projeto,
  criava outro em vez de repontar.

> **Nota de implementação.** O `update-link` do BetterLinks é chamado sempre com
> o conjunto completo de campos. Com um update parcial (só `ID` e `target_url`)
> a linha muda no banco mas o cache de redirecionamento não é invalidado: o link
> seguiu servindo o destino antigo por mais de 6 minutos. Com o payload completo,
> o novo destino vale na hora.

## Publicação do site (GitHub Actions + FTP)

A seção **Deploy** publica projetos (Lovable, Vite, React Router, Next export, Astro…)
em hospedagem FTP, usando GitHub Actions.

O **repositório é o contexto da tela inteira** e fica numa barra no topo, junto da
organização, da branch padrão e da visibilidade. Enquanto nenhum for escolhido a tela
mostra só o convite para escolher — nada abaixo teria conteúdo antes disso.

Escolhido o repositório, a tela se divide em coluna principal (o que você faz) e
trilho lateral (o que o repositório mostra):

| Bloco                          | Onde  | O que faz                                       |
| ------------------------------ | ----- | ----------------------------------------------- |
| **1 · Configurar publicação**  | principal | Destino, acesso ao servidor e entrega → *Salvar configuração*, que grava os secrets e os dois workflows |
| **2 · Publicar**               | principal | Dry-run e estado de prontidão → *Publicar agora* |
| **Workflows no repositório**   | trilho | Lista o que existe em `.github/workflows`, com preview → *Limpar workflows* |
| **Execuções recentes**         | trilho | Histórico do GitHub Actions, atualizado sozinho enquanto houver deploy em andamento |

Os dados não sensíveis (domínio, servidor, login, pasta remota, protocolo) ficam
salvos por repositório no navegador, então republicar um site já configurado exige
apenas a senha e um clique. A senha FTP nunca é persistida.

> Trocar de repositório recupera o que estava salvo, mas **nunca por cima do que você
> digitou** — o campo preenchido à mão continua como está. Para deixar o valor salvo
> voltar, esvazie o campo e escolha o repositório de novo.

O formulário valida os mesmos limites da API antes de enviar (domínio, host, porta de
1 a 65535, pasta remota e o formato `CHAVE=valor` das variáveis de build). Quando algo
é recusado, o erro aparece no campo — e, se ele estiver dentro de *Opções avançadas*,
a seção abre sozinha e o foco vai até lá.

Ligue **Simular envio (dry-run)** para validar todo o processo — build, detecção da
pasta e conexão FTP — sem gravar nada no servidor de hospedagem.

### Permissões do token

Em *Settings → Developer settings → Personal access tokens → Fine-grained tokens*, com
acesso aos repositórios da organização:

| Permissão | Nível             | Para quê                                       |
| --------- | ----------------- | ---------------------------------------------- |
| Metadata  | Leitura           | listar repositórios                            |
| Contents  | Leitura e escrita | gravar e remover os workflows                  |
| Workflows | Leitura e escrita | obrigatória para escrever em `.github/workflows/` |
| Secrets   | Leitura e escrita | `FTP_*`, `DEPLOY_DOMAIN`, `BUILD_ENV_FILE`     |
| Actions   | Leitura e escrita | botão *Publicar agora* e histórico de execuções |

O botão **Testar acesso**, na tela de configuração, valida o token contra o GitHub e
informa a data de expiração antes do primeiro deploy. Ele só faz leituras: as
permissões de escrita são exercidas de fato ao salvar a configuração de um repositório.

### Secrets criados no repositório

| Secret            | Origem              | Obrigatório                                  |
| ----------------- | ------------------- | -------------------------------------------- |
| `DEPLOY_DOMAIN`   | campo Domínio       | sim                                          |
| `FTP_SERVER`      | campo Servidor FTP  | sim                                          |
| `FTP_LOGIN`       | campo Login FTP     | sim                                          |
| `FTP_PASSWORD`    | campo Senha FTP     | sim                                          |
| `FTP_SERVER_DIR`  | opções avançadas    | não (padrão `domains/<domínio>/public_html`) |
| `FTP_PROTOCOL`    | opções avançadas    | não (padrão: detecção automática)            |
| `FTP_PORT`        | opções avançadas    | não (padrão `21`)                            |
| `BUILD_ENV_FILE`  | opções avançadas    | não                                          |

Os secrets opcionais deixados em branco são **removidos** do repositório, para que
configuração antiga não continue valendo — com uma exceção: `BUILD_ENV_FILE`. As
variáveis de build costumam carregar chaves de API, então o painel **não as guarda no
navegador** para preencher o campo de novo (como a senha do FTP). Por isso, deixar o
campo em branco **mantém** as variáveis já gravadas; para apagá-las, marque "Remover as
variáveis de build gravadas no repositório".

> **A pasta remota muda conforme a hospedagem.** O padrão
> `domains/<domínio>/public_html` é a convenção da Hostinger. Em **cPanel** a raiz do
> domínio principal é `public_html`, e um subdomínio fica em
> `public_html/<subdomínio>` — nesses casos o campo tem de ser preenchido, senão o
> envio vai para uma pasta que não existe. O caminho é sempre **relativo à home do
> usuário FTP**: autenticando como `minha-conta`, `public_html` já significa
> `/home/minha-conta/public_html`. Não use o caminho absoluto do sistema de arquivos —
> contas cPanel costumam ficar presas à própria home, onde a barra inicial já é ela.

`BUILD_ENV_FILE` recebe linhas `CHAVE=valor` e vira um `.env.production.local` durante
o build — útil para projetos Lovable que dependem de `VITE_SUPABASE_URL` e afins. O
arquivo é apagado do runner logo após o build.

### Detecção do build

Este é o ponto que costumava quebrar a publicação: o mesmo gerador ora produz um SPA
estático em `dist/`, ora um build híbrido com `dist/client` + `dist/server`. Enviar
`dist/` inteiro nesse segundo caso publica o bundle de servidor e deixa o site sem
`index.html` na raiz. O workflow resolve a pasta correta antes de enviar:

| Layout                                        | Pasta publicada                                    |
| --------------------------------------------- | -------------------------------------------------- |
| Vite SSR, React Router framework mode          | `dist/client`                                      |
| Nuxt, Angular, builds com pasta pública separada | `dist/public`, `dist/spa`, `dist/static`, `dist/browser` |
| Vite/Astro estático                            | `dist`                                             |
| Remix, React Router v7                         | `build/client`                                     |
| Create React App                               | `build`                                            |
| Next.js `output: export`                       | `out`                                              |
| Nuxt 3                                         | `.output/public`                                   |
| SvelteKit adapter-static                       | `.svelte-kit/output/client`                        |

O critério é a presença de `index.html` — ou de `_shell.html`, que é como o TanStack
Start em modo SPA nomeia o shell; nesse caso o passo gera o `index.html` a partir dele.
Se nada for encontrado, o job falha listando o conteúdo real das pastas de build, em
vez de enviar arquivos errados. O passo também gera, dentro da pasta publicada, um
`404.html` (cópia do `index.html`) e um `.htaccess` com fallback de rotas, compressão e
cache de assets.

As variáveis de repositório `PUBLISH_DIR` (força a pasta) e `SPA_FALLBACK=false`
(desativa `404.html` e `.htaccess`) sobrescrevem esse comportamento.

### Projetos TanStack Start (Lovable recente)

Os projetos gerados pelo Lovable hoje usam TanStack Start e, por padrão, compilam com
Nitro para Cloudflare Workers: o build produz `.output/server` e **nenhum HTML
estático** — não há o que enviar por FTP. Antes isso pedia converter o
`vite.config.ts` à mão, site por site, e todo site novo falhava na primeira
publicação (o Linknet falhou assim no primeiro teste da área de aprovação).

Agora os três workflows (área de aprovação, deploy e build) têm o passo **Ensure
static build**, que faz a conversão **só no runner, sem commit**:

```ts
export default defineConfig({
  nitro: false,                 // sem runtime de servidor
  tanstackStart: {
    spa: { enabled: true },     // o build emite _shell.html
    server: { entry: "server" },
  },
});
```

Só o template padrão, intocado, é convertido. Projeto que já declara `spa`,
`prerender` ou `nitro` fica como está: alguém já escolheu como ele sai estático — há
sites na organização que pré-renderizam cada rota (melhor para SEO), com pós-build
próprio, e ligar o SPA por cima quebraria o que funciona. O passo de detecção cuida do resto: achata `dist/client`,
descarta o bundle de servidor, converte `_shell.html` em `index.html` e cria o
fallback de rotas. Workflows de versão anterior (7) não têm o passo; o painel avisa, e
salvar a configuração de novo atualiza.

### Protocolo de transferência

Com o protocolo em **Automático**, o workflow exige FTPS explícito (AUTH TLS) e
**interrompe a publicação** se o servidor não aceitar, com a instrução do que escolher.
Ele nunca cai sozinho para FTP simples: antes, qualquer falha do teste — timeout, rede
instável, certificado — virava envio da senha em texto puro com um simples aviso.
Servidores sem FTPS precisam de `FTP simples` escolhido explicitamente nas opções
avançadas (a execução registra um aviso); os que usam a porta 990, de `FTPS implícito`.

As actions de terceiros são fixadas por **commit**, não por tag, porque recebem a senha
do FTP e uma tag pode ser movida para outro código. O Bun também tem versão fixa. Para
atualizar, troque o SHA (com a tag no comentário ao lado) e incremente a versão do
template.

### Workflows desatualizados

Os templates carregam um marcador `# joinvix-deploy-template: <versão>`. Ao selecionar
um repositório, o painel compara esse marcador com a versão que ele gera e avisa quando
o repositório ainda roda um workflow antigo. Basta clicar em **Salvar configuração**
para atualizar. A versão 7 acrescentou o passo que garante a assinatura Joinvix no
site publicado — repositórios configurados antes publicam sem essa garantia até
serem atualizados.

Quem mexer nos templates deve incrementar `WORKFLOW_TEMPLATE_VERSION` em
[`server/src/deploy/workflow-render.js`](../server/src/deploy/workflow-render.js); há
teste garantindo que os dois arquivos carreguem o marcador.

> **Limpar workflows** alcança todo YAML dentro de `.github/workflows`, inclusive
> arquivos que não foram criados pelo painel. A confirmação lista os arquivos e marca
> quais vieram daqui — leia antes de confirmar.

## Próximos passos previstos

O upload de anexos já foi validado contra o servidor real (tools gratuitas). O que
falta é a primeira criação de fato — só ela confirma quais formatos o Lovable aceita
como anexo e o teto de tamanho, que não são documentados.

> Os schemas das tools estão em `mcp.lovable.dev/skill.md`, e o `tools/list` do MCP
> devolve `inputSchema` e `outputSchema` de cada uma. Consulte de lá antes de supor
> qualquer formato — foi supondo que a primeira tentativa quebrou.
