# Guia técnico · Painel Sites Express

Painel do fluxo inteiro de um Site Express: da coleta de material no Google Drive à
geração do site — no Lovable ou pelo Claude Code desta máquina (ver "Motor Claude") —
e à publicação por FTP via GitHub Actions. Cada pasta de
primeiro nível dentro da pasta raiz do Drive é tratada como um **projeto** (a coleta
de material de um cliente). Projetos também podem ser criados no próprio painel, sem
pasta no Drive — para guardar arquivos ou para publicar um site já desenvolvido (ver
"Projetos criados no painel").

O painel tem duas seções, alternadas no cabeçalho:

| Seção        | O que faz                                                      |
| ------------ | -------------------------------------------------------------- |
| **Projetos** | Coletas do Drive, tags, briefing e geração do site (Lovable ou Claude) |
| **Deploy**   | Secrets, workflows e publicação dos repositórios da organização |

O botão **Publicar** na linha (e no diálogo) de um projeto que já gerou site leva direto
à seção Deploy, com o domínio preenchido a partir do nome da pasta e o repositório
sugerido a partir do site gerado.

## Stack

| Camada   | Tecnologias                                                                     |
| -------- | ------------------------------------------------------------------------------- |
| Frontend | Vite + React 19 + TypeScript, Tailwind v4, shadcn/ui, lucide-react, TanStack Query |
| Backend  | Node + Express, `googleapis` (Drive v3), API REST do GitHub                      |
| Comum    | `shared/` — o que API e interface aplicam do mesmo jeito (permissões, domínio, regras e listas fixas) |

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
`npm run setup`, que instala os quatro: a raiz, `server/`, `web/` e o pacote do
motor (`joinvixable/`, quando ele está na pasta).

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
- **a interface**: se está compilada e se o código dela (o `web/` e o `shared/`,
  que ela importa) mudou desde a última compilação. Com a opção ligada, ele compila
  sozinho ao iniciar;
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
| `GENERATION_ENGINE`       | O motor que vem marcado na tela de geração: `lovable` (padrão) ou `claude` |
| `CLAUDE_ENABLE_GENERATION` | `1` libera o uso do Claude Code, que consome a assinatura (padrão `0`) |
| `CLAUDE_MODEL`            | Opcional: modelo do Claude Code; vazio usa o que o motor espera (`claude-opus-5-5`) |
| `CLAUDE_REASONING_EFFORT`           | Opcional: esforço de raciocínio (`low`, `medium`, `high`, `xhigh`, `max`); vazio usa o que o motor espera |
| `CLAUDE_REVIEW_ROUNDS`    | Opcional: rodadas de crítica e refino depois da geração, de `1` a `4`; vazio usa o padrão do motor |
| `CLAUDE_PARALLEL_SITES`   | Opcional: quantos sites nascem ao mesmo tempo (briefing, geração, crítica e refino), de `1` a `3`; vazio usa `3` |
| `CLAUDE_PARALLEL_ADJUSTMENTS` | Opcional: quantos ajustes rodam ao mesmo tempo, ao lado da criação de sites, de `0` (tudo em uma fila só) a `5`; vazio usa `5` |
| `CLAUDE_ART_DIRECTION`    | Opcional: direção de arte dos sites (`sobria`, `autoral`, `ousada`); vazio usa o padrão do motor |
| `CLAUDE_MOTION`           | Opcional: movimento dos sites (`discreto`, `expressivo`, `cinematografico`); vazio usa o padrão do motor |
| `CLAUDE_HUMAN_APPROVAL`   | Escolha da rota criativa: vazio usa o padrão do motor, `1` para depois da direção e espera alguém escolher, `0` segue |
| `CLAUDE_BIN` / `CLAUDE_BROWSER_PATH` | Opcionais: caminho do `claude` e do navegador das capturas, se o painel não os achar |
| `PIXABAY_API_KEY`         | Chave do Pixabay para o banco de imagens na geração (vazia, a aba fica desligada) |
| `GEMINI_API_KEY`          | Chave gratuita do Gemini (AI Studio) para o assistente da geração (vazia, o botão some) |
| `GEMINI_MODEL`            | Opcional: modelo Flash preferido; vazio usa `gemini-flash-lite-latest` e `gemini-flash-latest` |
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
| `PREVIEW_WATCH_INTERVAL_MS` | Varredura que reconfere os links de cliente (padrão 30 min; `0` desliga) |

`JOINVIX_FOOTER_ASSETS_URL` diz de onde vêm os arquivos da assinatura Joinvix anexada
a toda geração no Lovable (vazia, o repositório `joinvix-footer`). A configuração mora
num arquivo só, o `.env` da raiz: é ele que a API, o lançador, a varredura de segredos e
a tela de Configurações leem.

A pasta raiz precisa estar compartilhada com o e-mail da service account
(o `client_email` do JSON da chave) como leitor.

> A chave `g-suite-*.json` está no `.gitignore` — nunca versione esse arquivo.

Nenhuma chave precisa ser editada à mão: a seção **Configurações** do cabeçalho
reúne todas, por assunto (Drive, geração, motor Claude, assistente Gemini, GitHub,
área de aprovação, encurtador, rede). Cada seção é um cartão com os campos numa
coluna — o nome e a variável à esquerda, o controle e a ajuda à direita —, o estado
da integração no título ("Configurado", "Incompleto", "Não configurado") e grava
sozinha no `.env` (modo `600`), preservando comentários e ordem. As regras:

- **Só para quem tem a permissão "Configurar o painel".** A regra é a mesma no
  localhost e na rede local: quem decide é a chave de acesso, não o endereço. Sem a
  permissão a seção nem aparece, e a API responde 403 — ela grava tokens e senhas em
  disco.
- **Segredos nunca voltam para o navegador.** A tela recebe só se estão definidos e uma
  dica para reconhecê-los: prefixo e final nos tokens de formato conhecido
  (`github_pat_…SglD`, `AIza…stuv`), no máximo os dois últimos caracteres nas senhas
  (`••••yS`). Um segredo gravado mostra "Definida" com os botões **Trocar** (abre a
  caixa do valor novo) e **Apagar**; a caixa vazia mantém o gravado.
- **Ou tudo entra, ou nada muda.** O pedido é validado inteiro antes de gravar: tipo,
  formato (token `github_pat_`, `https://`), limites, e as regras que
  cruzam campos — abrir o painel para a rede (`SERVER_HOST`) exige a chave do
  administrador, e apagá-la com a rede aberta é recusado. Trocar o endereço ao qual um
  segredo gravado é enviado (o MCP do encurtador, o servidor FTP da área de aprovação)
  exige digitar o segredo de novo: quem configura não o vê e não pode desviá-lo para
  outro servidor. Quebra de linha é recusada em qualquer valor: injetaria outra
  variável no `.env`.
- **O que só vale ao reiniciar é dito.** Chaves lidas na subida (`PORT`, `SERVER_HOST`,
  Drive, limites do Lovable, encurtador, intervalos de varredura) aparecem com "ao
  reiniciar"; depois de gravadas, um aviso lista as que esperam o reinício. As demais
  (GitHub, área de aprovação, motor Claude, Gemini, Pixabay, chave do painel) valem na
  hora.
  Campos em milissegundos e bytes mostram a leitura humana ao lado ("60000 = 1 min").
- **Testes sem efeito colateral.** *Testar o acesso ao GitHub* só lê; *Testar a chave*
  do Gemini lista os modelos, sem gerar nada e sem custo. A única
  exceção é *Testar Claude*, que dispara o Claude Code de verdade: pede confirmação,
  exige a trava ligada e nunca roda sozinho (ver "Motor Claude").
- **Programa que o painel lança só entra se for o esperado.** O caminho do `claude` e o
  do navegador das capturas aceitam apenas o executável de nome conhecido, instalado
  nesta máquina e fora das pastas do painel.
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

**Sem chave nenhuma, só esta máquina.** Sem a chave do `.env` e sem chave
cadastrada, o painel não pede identificação e tudo é permitido — mas só a quem está
na própria máquina (loopback). Pela rede, a API responde 403 a tudo, inclusive ao
porteiro (`/api/gate`), e a tela de entrada mostra o motivo. A tela de
Configurações já recusa abrir para a rede sem a chave; a regra cobre o `.env`
editado à mão.

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
trocada, seja pela tela de configuração ou à mão no arquivo. Para isso a sessão do
administrador guarda uma marca da chave do `.env`, derivada com scrypt: ela não
serve para testar chaves em massa a partir do arquivo.

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

- **Listagem dos projetos** numa tabela (cartões abaixo de 900 px), com o domínio em
  primeiro plano — o nome só aparece quando é outro — e **um selo de etapa**:
  *Material*, *Geração*, *Link*, *Cliente*, *Publicação*, *No ar* ou *Arquivos*. Um
  problema troca o selo pelo dele, em vermelho (*Publicação falhou*, *Prévia falhou*,
  *Envio falhou*, *Geração falhou*, *Link não abre*, *Link caiu*) ou em âmbar (*Agente
  parado*, *Interrompida*), para nunca ficar escondido atrás da etapa. A fonte é
  `web/src/features/projects/stage.ts`: os estados de `project-status.ts` viram
  etapa, problema e grupo de trabalho, e o selo, os contadores, o filtro, a
  ordem da lista e o Dashboard leem dali. *No ar* vem da publicação do mesmo domínio
  (com ou sem `www.`) e só vale depois de uma execução de deploy terminar com sucesso
  no GitHub. As colunas: projeto (o domínio; embaixo, o nome e o material; depois,
  os selos da ferramenta e as tags, numa linha só deles), etapa, última atividade
  (abaixo de 1280 px, sob o selo de etapa), situação (a frase do porquê; o passo por extenso
  repetia o selo e o botão) e a ação, com o botão sempre da mesma largura e, sob ele, "Abrir site" (o domínio) e
  "Abrir área de aprovação" (o link do cliente; cinza e desligado quando não há).
  Sob o nome, a origem e a data: "Pasta do Google Drive · recebida em…" ou "Criado
  no painel em…". Toda linha (e todo cartão no celular) tem a mesma altura; o que é
  longo corta. Só a coluna do projeto cresce, e a
  coluna lateral (fila do Claude e atividade recente) fica ao lado da lista só a
  partir de 1600 px; abaixo disso, desce para debaixo dela.
  A última atividade junta o Drive (quando o arquivo entrou na pasta), as gerações, o
  link, a publicação e o Claude.
- **A ferramenta do site** aparece ao lado das tags, no projeto e na busca: *Lovable*
  (gerado pelo painel ou vinculado pelo endereço do editor; o selo abre o editor),
  *Claude* (motor do painel) ou *Externo* (vinculado só pelo repositório, ou enviado dos
  arquivos). Um projeto com sites de mais de uma ferramenta mostra todas, a do site atual
  primeiro, e "Abrir no Lovable" acha o site do Lovable mesmo com um do Claude depois
  dele (`web/src/features/projects/site-engine.ts`). Buscar "lovable" ou "claude" filtra
  por ferramenta; o nome do projeto no Lovable também entra na busca. As marcas (Lovable,
  Claude, Google Drive, Gemini, GitHub) estão em `web/src/components/brand-icons.tsx`,
  nos desenhos oficiais — o do Lovable é o `icon.svg` do site deles, os outros vêm do
  simple-icons.
- **Coleta repetida.** O cliente às vezes manda o formulário de novo, e cada envio vira
  uma pasta. O site fica registrado na pasta em que foi gerado; a outra, sem site, recebe
  da API o site do mesmo domínio (`domainSite`, ver `server/src/routes/projects-helpers.js`)
  e passa a mostrar *Outra coleta* com a ferramenta do site, em vez de pedir *Gerar*. O
  passo é "Abrir coleta do site". Como os projetos só de arquivos, ela fica fora dos
  contadores, do Dashboard e do relatório: o site do domínio conta uma vez, na coleta dele.
- **Topo da tela**: o gráfico dos projetos novos do mês, recebidos pelo Drive e
  criados no painel, dia a dia. Os grupos de trabalho — cinco do que depende de alguém
  da equipe (*Resolver*, *Revisar*, *Gerar*, *Criar link*, *Enviar ao cliente*) e três
  do que espera o painel ou o cliente (*Em andamento*, *Com o cliente*, *Sem material*)
  — ordenam a lista por prioridade, e o Dashboard leva à lista já filtrada pelo que
  resolver. A lista tem três abas: **Ativos**, **No ar** (o que o GitHub confirma) e
  **Finalizados** (a tag "Finalizado"). Um site no ar com uma publicação nova falhando
  fica em Ativos, porque é problema. Ao lado da lista, a atividade recente de todos os
  projetos; a fila do Claude abre pelo botão do topo, que mostra quantos pedidos há. O
  ritmo dos últimos dias (projetos novos, sites gerados, enviados, no ar) fica só no
  Dashboard: repetido aqui, eram os mesmos números em dois lugares.
- **Andamento ao vivo**: a lista (e o diálogo do projeto) mostra o que está em curso,
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
- **Ações em massa**: a primeira coluna da lista marca projetos; com algum marcado,
  clicar na linha marca em vez de abrir, e uma barra fixa
  no rodapé oferece **Adicionar tag**, **Remover tag**, **Finalizar** / **Reabrir**,
  **Gerar em lote**, **Publicar na área** e **Verificar links** — cada botão diz
  quantos alcança, e só aparece quando serve a algum dos marcados. As tags vão três
  projetos por vez, e o que falhar volta ao que era.
- **Um botão de próximo passo** em cada linha, que muda com a etapa: *Gerar*,
  *Conectar GitHub*, *Criar link*, *Verificar link*, *Enviar ao cliente*, *Publicar*,
  *Responder*, *Acompanhar*, *Ver erro*, *Abrir site*. Preenchido quando o passo
  depende de alguém agora, contornado quando quem anda é o painel ou o cliente,
  vermelho quando o projeto tem problema. Sem a permissão da chave, fica desligado e a
  coluna "Próximo passo" diz por quê. O resto (gerar outro site, publicar, copiar
  prompt, abrir no Lovable, renomear, abrir no Drive) mora no menu **…**, em grupos.
- **Criar link** abre o editor do Lovable em outra aba e, no painel, o projeto com o
  campo do *Share preview* em foco — ao voltar com o link copiado, é só colar.
- **Enviar ao cliente** copia uma mensagem pronta para o WhatsApp, com o link curto,
  e registra a entrega, com *Desfazer* no aviso. Substituiu a caixa "pronto" do card e
  o "Marcar como entregue" do modal: o link que abre já está pronto — quem decide isso
  é a sonda do painel.
- **Gerar com um clique**: o *Gerar* da linha (com briefing no Drive) abre uma
  confirmação curta com o envio padrão — o briefing como está, os compactados e as
  imagens recomendadas, a assinatura — e avisa o que vale saber antes (site já
  gerado, briefing repetido, anexos cortados pelo teto). *Revisar tudo* abre o
  diálogo completo. Sem briefing, vai direto para o diálogo completo.
- **Gerar em lote**: por qualquer seleção (barra de ações). Os projetos são lidos do Drive
  (três por vez), cada um com o seu envio padrão; os que não têm envio padrão ficam
  de fora com o motivo. O diálogo explica as três etapas antes de qualquer envio:
  **1. envio ao Lovable** — um por vez, uns segundos cada, e só esta etapa precisa da
  aba aberta; **2. construção no Lovable** — todos ao mesmo tempo, lá, com o andamento
  na linha de cada um; **3. aviso de pronto**. Antes o texto dizia "um depois do outro"
  e parecia que a aba precisava ficar aberta durante toda a construção.
- **Responder ao agente parado**: quando o agente para esperando alguém, o painel lê
  a pergunta dele (a fala ao usuário, sem os pensamentos e comandos do registro) e o
  *Responder* da linha abre um campo já com "Pode seguir." — é uma mensagem ao
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
- **Ordenação**: *Coleta mais recente* (o padrão), coleta mais antiga, *Última
  atividade*, *Prioridade* (o que quebrou primeiro, depois o que espera uma decisão, o
  que está a um clique do cliente e por fim o que só espera; dentro de cada grupo, o
  parado há mais tempo) e nome. Sem paginação: são poucas dezenas de projetos, e a
  busca e os filtros (etapa, tags e o grupo que o Dashboard liga) resolvem.
- **Faixas de data** separando a lista quando a ordenação é por data (coleta ou
  última atividade): *Hoje*, *Ontem*, *Últimos 7 dias*, *Últimos 30 dias*, depois por
  mês no ano corrente e por ano no que é mais antigo, cada faixa com a sua contagem e
  presa ao topo enquanto rola. Contadas em dias de calendário: à 00h30, a coleta de
  ontem à noite está em *Ontem*. A referência é o instante da leitura da lista
  (`date-groups.ts`).
- **Busca** por nome/domínio do projeto, alcançando também o nome dado no painel. Fora
  da tela Projetos, a busca do cabeçalho leva à lista já filtrada.
- **Editar o projeto** (menu **…** → *Editar informações*, permissão *organizar*):
  domínio, nome no painel, etapa, data de recebimento, responsável e observação
  interna. Cada campo vazio volta ao cálculo do painel. A pasta no Drive **não** muda —
  o acesso lá é somente leitura. O que foi corrigido fica em `server/data/painel.json`,
  sob `details` (`server/src/store/project-details.js`), e a lista já vem da API com o
  domínio e a data corrigidos — o domínio é o que liga o projeto à publicação, e a data
  muda a ordem, as faixas e o Dashboard. O responsável aparece na linha, no diálogo e
  no "Por desenvolvedor" do Dashboard (vence quem gerou o site); a observação, cortada na
  linha e inteira no diálogo; os dois entram na busca. A **etapa escolhida à mão** troca
  o selo (com um lápis) e o botão de próximo passo, e vale até acontecer um fato mais
  novo no projeto — gerar, vincular, enviar ao cliente, publicar a prévia ou o domínio,
  mandar ao GitHub, uma execução do Claude (`lastFactAt` em `project-status.ts`).
  Conferências periódicas (o link, o agente) não contam. Rota:
  `PATCH /api/projects/:id/details`, que confere tudo antes de gravar.
- **Editar vários de uma vez**: com projetos marcados, a barra de seleção tem
  *Editar* (responsável — definir ou tirar — e etapa, cada um começando em "Não mudar")
  e *Ocultar* / *Mostrar*. Cada projeto é gravado sozinho, três por vez; uma falha não
  desfaz os outros e o aviso diz quantos falharam.
- **Ocultar projeto** (menu **…** ou barra de seleção): pasta de teste, coleta que não
  vai virar site. O projeto sai das abas de trabalho, dos contadores,
  da atividade recente, do Dashboard e do relatório para pagamento, e fica na aba
  **Ocultos** (que só aparece quando há algum), com quem ocultou e quando. "Mostrar de
  novo" devolve. Gravado em `details.hidden`; a pasta no Drive não muda.
- **Relatório para pagamento** (Dashboard → *Relatório para pagamento*): os sites que
  estão nas etapas escolhidas (Material, Geração, Link, Cliente, Publicação, No ar — uma
  ou várias), com filtro opcional por desenvolvedor e por período, este pela data de
  envio ao cliente, de publicação, de geração ou de recebimento (os dois dias
  inclusos). A tela mostra os sites e o total por desenvolvedor antes do download; o
  arquivo é um CSV que o Excel em português abre direto (separador ";", UTF-8 com a
  marca, datas dd/mm/aaaa), com etapa, situação ("Pronto para enviar", "Com o cliente",
  "Publicação falhou"…), se a etapa foi escolhida à mão, desenvolvedor, responsável,
  quem gerou, motor, as datas de cada passo com quem os fez, repositório, link do
  cliente, tags, finalizado e observação. As contas são as do Dashboard (`buildRows`):
  o desenvolvedor é o responsável definido, senão quem gerou o site. Para não pagar
  duas vezes: um domínio coletado de novo entra uma vez só (a coleta onde o site foi
  feito), e os projetos com a tag "Finalizado" ficam de fora — os dois por padrão,
  com a contagem do que saiu na tela. Texto que começa com "=", "+", "-" ou "@"
  ganha um apóstrofo, para o Excel não o rodar como fórmula. Gerado no navegador, com
  a lista já carregada (`features/dashboard/payment-report.ts`, com teste).
- **Modal de arquivos** por projeto, com miniaturas reais do Drive, navegação em
  subpastas (breadcrumb), busca e ordenação próprias.
- **Pré-visualização do arquivo** dentro do painel (imagem, PDF, vídeo, áudio, texto e
  documentos nativos do Google, exportados para PDF sob demanda), com navegação por
  setas ou teclado, download e link para o Drive.
- **Conteúdo dos `.zip`**: no modal de arquivos, o compactado abre como uma pasta — as
  subpastas dele, a grade com miniaturas, a busca, a ordenação e a mesma
  pré-visualização (imagem, PDF e texto; o resto baixa). Uma faixa no topo diz de
  qual zip é a lista e oferece **Baixar o .zip**. O painel não baixa o arquivo
  inteiro: o índice do zip fica nos últimos bytes, e cada item diz onde os seus bytes
  começam, então a API lê do Drive por faixa só o fim do arquivo para listar e o
  trecho do item para abri-lo, descomprimindo conforme envia
  (`server/src/archive/zip-reader.js`, sem dependência nova). Nos zips das coletas
  reais, o índice saiu numa leitura só, em 1 a 2 s. Nomes gravados pelo Windows sem
  a marca de UTF-8 são lidos em CP850, e o lixo do sistema (`__MACOSX/`,
  `.DS_Store`, `Thumbs.db`) fica de fora. O que não abre diz por quê: ZIP64 (mais de
  4 GB ou 65.535 arquivos), item com senha, compressão que não seja *store* ou
  *deflate*, e zip dentro de zip. Vídeo e áudio de dentro do zip só baixam: o player
  precisa saltar no arquivo, e um fluxo descomprimido na hora não atende a salto. A
  miniatura de um item é a própria imagem (o Drive não gera miniatura do que está
  dentro do zip), por isso só as de até 4 MB a ganham. RAR e 7z continuam só com
  download.
- **Linha do tempo do projeto**: a aba ao lado de *Arquivos* no modal (ou **Linha do
  tempo** no menu **…** da linha) conta, em ordem, o que aconteceu, quando e por quem:
  material recebido (a criação da pasta no Drive), briefing recebido, material
  complementado (arquivo que entrou mais de uma hora depois), site gerado ou
  vinculado, construção concluída no Lovable, troca de projeto, área de aprovação
  configurada, prévia no ar ou falha, link enviado ao cliente, publicação no domínio
  configurada, cada disparo e simulação, site no ar e a última falha. Cada passo
  mostra a hora, o autor e quanto tempo depois do anterior aconteceu — é o que mostra
  onde o projeto ficou parado. No topo: quando foi recebido, **quem gerou o site** e
  quanto levou do recebimento à geração, da geração ao envio ao cliente e do
  recebimento ao ar (a primeira publicação). A linha sai de datas que o painel já guardava,
  então vale para os projetos antigos; o que faltava passou a ser gravado: quem
  clicou em **Gerar** (`createdBy`, o nome da chave de acesso), quando o agente
  terminou (`agentDoneAt`, só na passagem para "pronto", para as conferências
  seguintes não empurrarem a data), quando o briefing e o último arquivo entraram na
  pasta (`createdTime` deles — o `modifiedTime` de um upload é a data do arquivo no
  computador do cliente) e quem disparou cada publicação. Os sites gerados antes
  disso aparecem com **responsável não registrado**, e não com um palpite. Sem chaves
  de acesso configuradas também não há a quem atribuir. *No ar desde* é a primeira
  publicação bem-sucedida e *Última publicação* a mais recente — cada edição no Lovable
  publica de novo —, com esses nomes no projeto, na linha do tempo e no Dashboard.
- **Tags** por projeto, com cor e nome livres: aplicadas pela linha ou pelo diálogo do projeto, e
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
  menu **…** da linha tem **Copiar prompt**, e o modal do projeto ganha **Ver prompt**
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
| `GET /api/files/:id/archive`  | O que há dentro de um `.zip` (`?refresh=1` relê o Drive)       |
| `GET /api/files/:id/archive/:index` | Um item de dentro do `.zip`, descomprimido (`?download=1`) |
| `GET /api/projects/:id/brief` | Texto do arquivo *Informações do Site* (404 se não houver)     |
| `GET /api/tags`               | Tags com a contagem de projetos de cada uma                   |
| `POST /api/tags`              | Cria uma tag (`{ name, color }`)                              |
| `PATCH /api/tags/:id`         | Renomeia ou troca a cor                                       |
| `DELETE /api/tags/:id`        | Exclui a tag e a remove de todos os projetos                  |
| `PUT /api/projects/:id/tags`  | Define as tags de um projeto (`{ tagIds }`)                    |
| `PUT /api/projects/:id/name`  | Apelida o projeto no painel (`{ name }`; vazio volta ao Drive) |
| `POST /api/projects`          | Cria um projeto no painel (`{ name, kind: "site" \| "files" }`) |
| `DELETE /api/projects/:id`    | Exclui um projeto criado no painel, com os arquivos dele       |
| `PUT /api/projects/:id/files?path=` | Guarda um arquivo no projeto (corpo cru)                 |
| `DELETE /api/projects/:id/files?path=` | Apaga um arquivo ou uma pasta do projeto              |
| `GET /api/projects/:id/site-sources` | Onde há um site nos arquivos do projeto, e o repositório |
| `POST /api/projects/:id/repository` | Cria (ou atualiza) o repositório com o site — permissão `publicar` |
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

As rotas do motor Claude (`/api/claude/…` e `/api/projects/:id/claude/…`) estão na
seção "Motor Claude".

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
├── server/            # API Express: Drive, Lovable, motor Claude e publicação
│   ├── data/          # estado do painel e backups — criado na 1ª execução
│   ├── workflows/     # templates publicados nos repositórios dos clientes
│   │   ├── *.yml      # build, deploy via FTP e área de aprovação
│   │   └── scripts/   # passos em Bash embutidos nos templates (testados)
│   └── src/
│       ├── index.js   # partida: confere a configuração, retoma sessões, escuta
│       ├── app.js     # monta a aplicação (middlewares e routers), sem abrir porta
│       ├── http.js    # HttpError, tratador de erros e o que o navegador pode ler
│       ├── config.js  # leitura do .env e configuração de runtime
│       ├── cache.js   # cache em memória com TTL, sem consultas duplicadas
│       ├── drive.js   # cliente do Drive, consultas e alcance da pasta raiz
│       ├── brief.js   # extração do texto do "Informações do Site"
│       ├── brief-file.js    # qual arquivo da pasta é o briefing
│       ├── atomic-write.js  # gravação atômica e fila de escrita
│       ├── express.d.ts     # tipo de req.identity
│       ├── routes/    # todos os routers HTTP (a ordem de montagem está no app.js)
│       │   ├── access.js         # porteiro, sessão, identidade e chaves de acesso
│       │   ├── local-projects.js # projetos criados no painel: arquivos e envio ao GitHub
│       │   ├── projects.js       # projetos, briefing, tags, nome e detalhes corrigidos à mão
│       │   ├── projects-helpers.js # o site do domínio que está em outra coleta
│       │   ├── tags.js           # CRUD das tags
│       │   ├── files.js          # pastas, miniaturas e conteúdo (com Range)
│       │   ├── files-helpers.js  # regras puras das rotas de arquivo
│       │   ├── lovable.js        # Lovable (conexão e geração), link do cliente, área de aprovação, sites vinculados e imagens de banco
│       │   ├── claude.js         # rotas /api/claude e /api/projects/:id/claude, e os ajustes (edits)
│       │   ├── assistant.js      # o assistente (Gemini) da tela de geração
│       │   ├── deploy.js         # rotas /api/deploy
│       │   └── settings.js       # rotas /api/settings (a tela de Configurações)
│       ├── security/
│       │   ├── authenticate.js   # quem está falando com a API
│       │   ├── access.js         # chaves em hash e sessões persistidas
│       │   ├── permissions.js    # o que cada chave pode fazer
│       │   ├── network.js        # política de acesso LAN
│       │   ├── drive-scope.js    # id válido e dentro da pasta raiz (regra pura)
│       │   ├── project-scope.js  # middlewares: :id válido e dentro da pasta raiz
│       │   ├── embedded-asset.js # cabeçalhos do conteúdo embutido
│       │   └── throttle.js       # bloqueio progressivo e rate limit
│       ├── store/     # banco do painel (painel.json)
│       │   ├── db.js           # leitura, migração, recuperação e gravação
│       │   ├── backup.js       # cópias diárias do banco e recuperação
│       │   ├── tags.js         # tags e as tags de cada projeto
│       │   ├── project-names.js # apelido do projeto
│       │   ├── project-details.js # o que a equipe corrige à mão (domínio, data, etapa…)
│       │   ├── local-projects.js # projetos criados no painel
│       │   ├── generations.js  # sites gerados e o link do cliente
│       │   ├── publications.js # histórico de publicação
│       │   ├── claude.js       # registro do motor Claude: projetos, fila e execuções
│       │   ├── repo-edits.js   # a memória dos ajustes pelo Claude em sites de repositório
│       │   └── access-users.js # chaves de acesso (em hash)
│       ├── archive/   # zip: leitura por faixa de bytes, o tipo dos itens e o gravador
│       ├── local/     # arquivos em disco dos projetos do painel e a origem do site
│       ├── lovable/
│       │   ├── oauth.js            # registro do cliente, PKCE e renovação do token
│       │   ├── mcp.js              # cliente MCP (JSON-RPC sobre HTTP)
│       │   ├── package.js          # prompt, anexos e validação do envio (só Drive)
│       │   ├── upload.js           # subida dos anexos ao storage do Lovable
│       │   ├── generate.js         # dispara a criação (o único gasto de crédito)
│       │   ├── generation-guard.js # trava contra gasto duplicado de crédito
│       │   ├── progress.js         # acompanha o agente do Lovable depois do "Gerar"
│       │   ├── activity.js         # o que o agente está fazendo agora
│       │   ├── agent-text.js       # o que o agente disse, tirado da mensagem crua
│       │   ├── signature.js        # a assinatura Joinvix do rodapé, anexada a toda geração
│       │   ├── style-registry.js   # o bloco "Já usado" da Workspace Knowledge
│       │   └── link.js             # site existente, vinculado a um projeto
│       ├── engines/
│       │   ├── index.js            # os motores e o estado de cada um
│       │   └── claude/             # o motor Claude (ver "Motor Claude")
│       │       ├── command.js      # a linha de comando do claude -p
│       │       ├── environment.js  # o ambiente dos processos filhos, por lista de permissão
│       │       ├── executor.js     # dispara, lê o stream, decide como terminou
│       │       ├── guardian.js     # encerra o claude se o painel morrer
│       │       ├── queue.js        # sites e ajustes em cotas próprias; pausada depois de um reinício
│       │       ├── stream.js       # linhas legíveis e o filtro do que vai à tela
│       │       ├── workspace.js    # a pasta de trabalho, na pasta de dados
│       │       ├── motor.js        # a conversa com o pacote do motor
│       │       ├── material.js     # o material do projeto na pasta de trabalho
│       │       ├── office.js       # documentos de escritório, abertos para o agente
│       │       ├── attachments.js  # as imagens que acompanham um pedido de ajuste
│       │       ├── publish.js      # o site a caminho do GitHub
│       │       ├── adopt.js        # site feito na ferramenta antiga, trazido para o motor
│       │       ├── history.js      # o histórico de layouts trazido da ferramenta antiga
│       │       ├── service.js      # travas, fila, resumo do card e envio
│       │       ├── edicao/         # a edição livre (ajustes em sites de repositório)
│       │       └── fixtures/       # o claude falso e o motor de mentira dos testes
│       ├── devarea/   # a área de aprovação: cada site numa pasta própria de um domínio
│       ├── preview/
│       │   ├── share-link.js # classificação do link "Share preview"
│       │   └── service.js    # link do cliente e varredura periódica
│       ├── shortlinks/
│       │   ├── mcp.js     # cliente do MCP do BetterLinks
│       │   └── service.js # link curto estável por projeto
│       ├── gemini/    # o assistente: cliente do Gemini e análise do briefing
│       ├── images/    # imagens de banco do Pixabay
│       ├── settings/
│       │   ├── schema.js    # as chaves do .env que a tela de Configurações edita
│       │   ├── service.js   # leitura e gravação das configurações
│       │   └── env-file.js  # escrita do .env (a leitura é do dotenv)
│       └── deploy/
│           ├── github/              # API REST do GitHub
│           │   ├── client.js        # autenticação, erros, novas tentativas, paginação
│           │   ├── contents.js      # arquivos em .github/workflows
│           │   ├── repositories.js  # repositórios e execuções do Actions
│           │   ├── git-data.js      # criação de repositório e commit de um site inteiro
│           │   └── access-check.js  # diagnóstico do token
│           ├── publication.js       # secrets (sealed box) e escrita dos workflows
│           ├── workflow-render.js   # substituição dos placeholders do YAML
│           ├── workflow-template.js # leitura dos templates em disco
│           ├── settings.js          # as configurações da rota legada /api/deploy/config
│           ├── input.js             # validação do que vem do navegador
│           ├── guards.js            # permissão, cota e organização
│           ├── operations.js        # disparo, remoção e versão dos workflows
│           └── watch.js             # acompanha as execuções do workflow de deploy
├── joinvixable/       # o pacote do motor Claude — repositório privado, fora do git daqui
├── scripts/           # varredura de segredos, atalho do motor, histórico de layouts e a isca do Claude
├── shared/            # o que API e interface aplicam igual; cada .js tem o seu .d.ts
│   ├── access-permissions.js # as permissões das chaves
│   ├── domain.js      # domínio da coleta e nome da pasta
│   ├── lovable-repo.js # nome do repositório (do Lovable e de um repositório novo)
│   ├── deploy-rules.js # padrões e limites da configuração de publicação
│   ├── project-fields.js # etapas manuais e tamanhos dos campos do projeto
│   ├── tag-colors.js  # as cores das tags
│   ├── claude-options.js # níveis do motor Claude e limite dos anexos do ajuste
│   ├── external-site.js # site que não veio do Lovable (prefixo ext-)
│   ├── stock-images.js # nomes e caminhos das imagens de banco no pacote e no prompt
│   └── secret-formats.js # formatos de credencial (varredura e envio ao GitHub)
└── web/               # Aplicação Vite + React + shadcn/ui
    ├── public/        # favicon.png e apple-touch-icon.png (a marca Joinvix)
    └── src/
        ├── main.tsx   # provedores (consultas, tema) e o portão de acesso
        ├── App.tsx    # seção aberta, lista de projetos e alvo da publicação
        ├── app-header.tsx # marca, navegação entre seções, identidade e tema
        ├── assets/    # joinvix-logo.png (assinatura), joinvix-mark.png (símbolo) e marcas
        ├── components/
        │   ├── ui/    # primitivos do shadcn/ui (só os usados)
        │   └── *.tsx  # peças genéricas, sem regra de negócio (cabeçalho, cartões, campos, detalhes técnicos)
        ├── features/  # uma pasta por área; componentes, hooks e regras juntos
        │   ├── access/         # portão, menu da conta e chaves de acesso
        │   ├── projects/       # lista, ações, estado, etapas e linha do tempo do projeto
        │   ├── project-files/  # diálogo do projeto: resumo, arquivos, andamento e link do cliente
        │   ├── tags/           # tags: filtro, seletor, cores e gestão
        │   ├── generate/       # diálogo de geração no Lovable, com a escolha do motor
        │   ├── material/       # anexos e imagens de banco, usados pelos dois motores
        │   ├── claude/         # o motor Claude: briefing, site, fila, lote e envio
        │   ├── repo-edits/     # a aba Ajustes: pedidos ao Claude em sites de repositório
        │   ├── dashboard/      # Dashboard, linha do tempo dos projetos e relatório para pagamento
        │   ├── settings/       # tela de configuração, com o estado do motor Claude
        │   └── deploy/         # tela de publicação
        └── lib/
            ├── api/   # cliente da API: http.ts e errors.ts (comuns) e um módulo por assunto
            └── *.ts   # sessão, cache de consultas, permissões, notificações e formatadores
```

Regra de organização da interface: o que pertence a uma área fica em
`features/<área>/`, com os testes ao lado do código. `components/` guarda só o que
não conhece o domínio, e `lib/` o que é infraestrutura compartilhada por várias áreas.

Na API, `routes/` é a camada HTTP: todos os routers moram ali, e a ordem em que o
`app.js` os monta faz parte do contrato. As pastas de cada integração (`deploy/`,
`lovable/`, `engines/claude/`, `devarea/` e as outras) têm o serviço; `store/` é o
banco; `security/`, os middlewares. O que a API e a interface precisam aplicar do
mesmo jeito (listas fixas, limites, padrões) fica em `shared/`, com um `.d.ts` para a
interface e para o typecheck da API.

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
npm test          # backend (node --test) + interface (vitest) + pacote do motor
npm run test:server
npm run test:web
npm run test:motor # só o pacote do motor (pulado com aviso onde ele não está)
npm run lint      # oxlint na interface, na API, no shared/ e nos scripts/
npm run typecheck # tipos da API e dos scripts/ (checkJs), da interface e do pacote do motor
npm run check     # lint + tipos + testes + build
```

O mesmo `npm run check` roda no GitHub Actions a cada push e pull request
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Nada nos testes fala com
Drive, GitHub, Lovable ou com o Claude de verdade (o executor é exercitado com um
`claude` falso), e o `.env` da máquina é ignorado dentro do `node --test` — eles
valem igual aqui e no CI. O pacote do motor não está no repositório público: no CI
os testes que dependem dele são pulados, e os das rotas rodam com um motor de mentira.

**Backend (511):** a API de verdade numa porta local (entrada, sessão, bloqueio por
IP, permissões por chave, política de rede e respostas de erro), o banco do painel
(criação, migração do nome, recuperação de backup, travas do link do cliente, o que
a equipe corrige à mão em cada projeto), o
caminho que gasta crédito no Lovable (clique duplo, resposta incerta, recusa
explícita, site criado mas não gravado), alcance dos ids do Drive, gravação atômica,
geração dos workflows (com validação do YAML resultante), classificação do link de
share e detecção da pasta de build em cada layout suportado.

**Interface (314):** a lista de projetos sobre o cache de consultas (uma busca para
vários leitores, escrita otimista e desfazimento quando a API recusa), validação do
formulário de publicação (espelho dos validadores da API), regras do prompt e da
seleção de anexos, ordenação dos arquivos, filtros, ordem e faixas de data da lista, a formatação de
datas e plurais, o cliente HTTP (recusa, sessão vencida, API fora do ar, tempo
limite), a precedência do selo de estado, a etapa e o grupo de trabalho de cada
estado, a etapa escolhida à mão e quando ela perde a validade, as contas do Dashboard, o relatório para pagamento, o autor de cada publicação, o próximo passo de cada etapa, os avisos de site pronto e de publicação, e a
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
acende o botão na linha. Hoje 34 das 62 coletas têm o arquivo, em dois formatos: PDF
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

O botão **Gerar** (na linha e no diálogo do projeto) abre a tela de geração: à esquerda o
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

O projeto passa para a etapa *Link* (o site existe, falta o link do cliente) e o
diálogo lista todas as gerações daquela coleta — a mesma
pasta pode gerar mais de um site. `DELETE /api/projects/:id/generations/:lovableId`
remove um registro do painel sem tocar no projeto lá no Lovable.

### Acompanhamento da geração

O `create_project` volta assim que o projeto nasce; o site ainda vai ser construído.
Depois do **Gerar**, a API acompanha o agente sozinha (`get_project` e
`list_messages`, gratuitas) e grava na geração: **Gerando no Lovable**, **Parado no
Lovable** (o agente pausou esperando uma resposta no editor — aprovação ou checagem
de crédito — e não retoma sozinho) ou pronto. A linha mostra o selo e a lista se
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

## Assistente (Gemini)

A tela de geração tem o botão **Analisar com Gemini**, que lê o briefing como está
na caixa (editável), as observações já escritas e os nomes dos arquivos da pasta, e
devolve quatro coisas: um resumo do negócio, o que o briefing não traz e um site
institucional precisa, instruções prontas para as **Observações adicionais** e buscas
para o banco de imagens (uma por seção do site). Tudo é sugestão: um texto só entra
no envio quando a pessoa clica em **Inserir**, e as buscas só rodam ao clicar em
**Buscar estas fotos** — que preenche a aba Banco de imagens e busca no Pixabay na
hora. O prompt enviado ao Lovable não muda por conta do assistente; a faixa "O que vai
no envio" (heurística, de graça) continua existindo ao lado.

A chave (`GEMINI_API_KEY`) é do nível gratuito do Google AI Studio e o painel foi
feito para ela continuar assim (`server/src/gemini/`):

- **Só modelos Flash.** `GEMINI_MODEL` recusa qualquer id sem "flash". O padrão é o
  apelido `gemini-flash-lite-latest` (responde em segundos; a análise medida saiu em
  2,4 s) e, se faltar cota, `gemini-flash-latest`, com o pensamento no nível mais
  baixo — o Flash completo "pensa" por padrão e levava mais de 20 s num pedido mínimo.
  Os apelidos são mantidos pelo Google apontando para o Flash atual; os ids com versão
  envelhecem (`gemini-2.5-flash` deixou de aceitar usuários novos em 2026). Se nem os
  apelidos responderem (404), o painel lista o catálogo da chave (gratuito) e tenta
  outro Flash de texto, do mais novo ao mais antigo. Cota esgotada (429), sobrecarga
  (503) e demora passam a vez ao próximo modelo.
- **Nada roda sozinho.** Cada chamada nasce de um clique; a mesma entrada (briefing,
  observações, arquivos) volta do cache por 24 h; a rota aceita no máximo 8 análises
  por minuto no painel inteiro — a cota é da chave, não de quem usa.
- **A chave fica no servidor**, vai num cabeçalho (nunca na URL) e nunca aparece em
  mensagem de erro; o navegador recebe só se o assistente está configurado e os
  modelos que o painel tenta. A tela de Configurações testa a chave listando os
  modelos, sem gerar nada.
- Rotas: `GET /api/assistant/status`, `POST /api/projects/:id/assistant/briefing`
  (permissão `gerar`; corpo `briefing`, `observations`, `projectName`, `fileNames`) e
  `POST /api/settings/check/gemini` (permissão `configurar`).

## Motores de geração (Lovable e Claude)

O painel produz sites por dois motores, escolhidos **a cada geração**, na própria tela:
o **Lovable** e o **Claude** — o Claude Code desta máquina, pelo login da assinatura
(seção seguinte). `GENERATION_ENGINE` só diz qual vem marcado; a escolha aparece
quando os dois servem para o projeto (projeto criado no painel não tem geração pelo
Lovable, e o Claude some onde o pacote do motor não está instalado). O estado de cada
motor aparece em Configurações → Geração de sites, e o registro que o informa é
`server/src/engines/index.js`.

## Motor Claude

O segundo motor do painel é o **Claude Code desta máquina**, em modo não interativo
(`claude -p`), pelo login da assinatura — sem chave de API. Ele lê o material do
projeto, escreve o briefing e, depois de alguém revisar, escreve o site. O site
gerado não é entregue de imediato: passa por rodadas de **crítica**, feitas por uma
sessão do Claude que não o escreveu, e de **refino**, feitas por quem o escreveu. O
painel prepara a pasta de trabalho, digita cada pedido, põe na fila o passo seguinte,
acompanha as execuções, guarda o que aconteceu e manda o site entregue ao GitHub, de
onde ele segue pelo caminho de sempre: área de aprovação, link do cliente e domínio.

Antes havia uma ferramenta à parte (o Joinvixable), com página, porta e fila próprias.
Ela deixou de existir como servidor: o que era dela virou o **pacote do motor** e o
que era da página virou telas do painel.

### O pacote do motor (`joinvixable/`)

Prompts, biblioteca de seções, template, ferramentas e pipeline moram no pacote
`joinvixable/`, na raiz do painel. Ele é conhecimento interno e **não é versionado
neste repositório**: vive num repositório privado, clonado nessa pasta (que está no
`.gitignore` e na varredura de segredos). `npm run setup` instala as dependências dele
quando a pasta existe; `npm test` e `npm run typecheck` rodam os testes e os tipos
dele pelo `scripts/motor.mjs`, que pula o passo com aviso onde o pacote não está.

Sem o pacote — num clone público, no CI sem a chave de leitura — o painel sobe e
funciona normalmente: o motor aparece como *Não instalado* em Configurações, a escolha
"Claude" some das telas de geração e os testes que precisam dele são pulados. Os
testes das rotas usam um motor de mentira e rodam em qualquer lugar.

O servidor do painel é JavaScript e o motor é TypeScript rodado por `tsx`, então nada
do motor é importado: cada pergunta é um processo filho (`engines/claude/motor.js`).
As consultas respondem em JSON na última linha da saída (`scripts/consulta.ts`), e os
comandos de sempre — validar e telas — respondem pelo código de saída e pelo texto.
Nada nesse arquivo dispara o Claude.

### O fluxo, pela linha do projeto

| Passo | O que acontece | Gasta a assinatura? |
| --- | --- | --- |
| **Gerar briefing** | A tela de geração, com o motor Claude marcado, mostra o texto das informações do site, as observações e os arquivos do projeto. *Conferir pedido* é o ensaio: mostra o que seria copiado, a frase e o comando. *Gerar briefing* copia o material marcado para a pasta de trabalho e põe o pedido na fila | Só o *Gerar briefing* |
| **Revisar e gerar** | O briefing aparece no projeto, com o que a conferência do motor aceitou, avisou ou recusou. Dá para corrigir pelos campos ou pelo JSON e gravar, sem gastar. *Conferir* mostra o pedido; *Gerar site* enfileira | Só o *Gerar site* |
| **Acompanhar** | A linha mostra a etapa e o tempo; a aba **Claude** do projeto, o log ao vivo, com *Cancelar execução*. A **Fila do Claude**, no topo da tela Projetos e ao lado da lista, mostra o que roda, o que espera e o que um reinício interrompeu | Não |
| **Escolher a rota** | Com a parada ligada, a geração para em *aguardando aprovação* depois da direção criativa: a direção, as rotas propostas e as fotos de banco aparecem no projeto. *Aprovar e gerar o site* segue com a direção como está; escolher outra rota refaz a direção com ela e volta a esperar a aprovação, agora com a direção nova | Sim, ao seguir |
| **Criticar e refinar** | Gerado e validado, o site entra em crítica: uma sessão nova do Claude, que não o escreveu, dá notas, aponta problemas e diz se o site está aprovado. Se não está, quem o escreveu é retomado para o refino, e a rodada seguinte começa por outra crítica. A sequência termina quando a crítica aprova ou as rodadas acabam. O painel põe cada passo na fila sozinho | Sim, cada execução |
| **Receber o site** | Site entregue: etapas, a última crítica, telas, *Validar* e *Fotografar telas* (rodam nesta máquina, sem o Claude) e a linha do GitHub | Não |
| **Ajustar** | *Pedir ajuste* retoma a sessão de quem escreveu o site. Validado, o commit novo sai (sozinho, para quem pode publicar) e a área de aprovação publica de novo | Sim |

Gerar em lote é pôr vários pedidos na mesma fila: quem ainda não tem briefing pede o
briefing, quem já tem um briefing aceito pede o site, e cada projeto que não pode
entrar aparece com o motivo. O passo seguinte de um site em andamento passa à frente
dos pedidos que ainda não começaram (ver "A sequência de um site").

Os selos e os grupos de trabalho que o motor acrescenta: *Geração
interrompida*, *Geração falhou*, *Direção para aprovar*, *Gerando com o Claude*,
*Gerando briefing*, *Na fila do Claude*, *Briefing recusado* e *Briefing para revisar*.
Site gerado e ainda fora do GitHub cai em *Enviar ao GitHub*.

O estado da fila é relido a cada 4 s enquanto algo roda e a cada 30 s em repouso — é
assim que uma aba fica sabendo do pedido feito em outra. O log ao vivo é uma consulta
com cursor, repetida a cada 2 s; não há conexão aberta.

### Nada que custa acontece por acaso

As rotas que disparam o `claude -p` respondem, nesta ordem, como as do Lovable:

| Resposta | Quando |
| --- | --- |
| `403` | A chave de acesso não tem a permissão `gerar` |
| `428` | Faltou `confirm: true` no corpo |
| `409` | O projeto já tem um pedido rodando, esperando ou interrompido; há um teste do Claude em andamento; ou o motor recusou (briefing com pendência, etapa aberta, cliente que já tem site, site sem nada a continuar) |
| `400` | O pedido não passa na conferência (arquivo de outro projeto, vídeo marcado, modelo ou esforço inválido, rota que não está entre as propostas) |
| `423` | A trava está desligada |

A trava é `CLAUDE_ENABLE_GENERATION` — desligada por padrão, separada da do Lovable e
relida a cada pedido (vale na hora, sem reiniciar). Com ela desligada o ensaio
funciona inteiro: plano, frase e comando, sem copiar nem enfileirar nada. Na tela,
toda ação que gasta passa por uma confirmação que diz que o Claude Code vai ser
disparado e que consome a assinatura, e o botão repete isso.

Quem pede a geração de um site autoriza a sequência inteira dele: a geração e as
rodadas de crítica e refino. Os passos seguintes entram na fila sem outro clique, em
nome de quem pediu. A trava é conferida de novo a cada passo — desligada no meio, a
sequência para onde está, nada é entregue, e a linha oferece *Continuar*, que pede a
confirmação e a trava como qualquer ação que gasta.

Depois de um reinício do painel a fila volta **pausada** e o que rodava aparece como
*interrompido*: reabrir o painel nunca gasta sozinho, e nenhuma sequência segue por
conta própria. Retomar pede a mesma confirmação e a mesma trava.

### O executor (`server/src/engines/claude/`)

| Peça | O que faz |
| --- | --- |
| `command.js` | A linha de comando do `claude -p`, a partir do contrato do motor (`joinvixable/config/headless.json`) e das regras de leitura que só o painel conhece |
| `environment.js` | O ambiente dos processos filhos, por lista de permissão |
| `executor.js` | Dispara o claude, digita o pedido pelo stdin, lê o stream, decide como terminou e registra |
| `guardian.js` | Um processo pequeno entre o painel e o claude: se o painel morre sem aviso, encerra o claude com a árvore inteira |
| `queue.js` | A fila: uma cota para a criação de sites e outra para os ajustes, o passo seguinte de um site na frente; pausada depois de um reinício |
| `stream.js` | As linhas legíveis do `stream-json` e o filtro do que vai à tela |
| `workspace.js` | A pasta de trabalho, dentro da pasta de dados |
| `motor.js` | A conversa com o pacote do motor, por processos filhos |
| `material.js` | O material do projeto (Drive ou painel) copiado para a pasta de trabalho |
| `office.js` | Documentos de escritório, abertos para o agente |
| `attachments.js` | As imagens que acompanham um pedido de ajuste |
| `publish.js` | Os arquivos do site que vão ao GitHub e o que bloqueia o envio |
| `adopt.js` | Um site feito na ferramenta antiga, trazido para o motor |
| `history.js` | O histórico de layouts trazido da ferramenta antiga |
| `service.js` | Junta tudo: travas, fila, a sequência de cada site, as opções do projeto, resumo do card, envio ao GitHub |
| `edicao/` | A edição livre: ajustes pelo Claude em sites de repositório (ver "Ajustes pelo Claude em sites do Lovable") |

As rotas do motor ficam em `server/src/routes/claude.js`, com as outras da API.

As garantias do executor, cada uma com teste:

- **Login da assinatura, nunca chave de API.** As variáveis de chave não entram no
  ambiente do claude, e a execução é interrompida se o próprio claude disser, no
  `system/init`, que achou uma (`apiKeySource`).
- **Lista fechada.** Ferramentas `Bash`, `Read`, `Edit`, `Write`, `Glob` e `Grep`; no
  Bash, só os `npm run -s cliente | new-project | step | tool` do runbook.
  Modo `dontAsk` com `--permission-prompts none`: o que não está na lista é recusado.
  Sem servidores MCP (`--strict-mcp-config`), sem comandos de barra
  (`--disable-slash-commands`). Sem rede — a exceção é o `WebFetch` dos domínios
  citados nas observações do briefing, e só deles. O que o claude disser ter aberto
  fora disso (um servidor MCP do perfil, uma ferramenta a mais, outro modo de
  permissão) encerra a execução.
- **O runbook chega por arquivo.** O painel gera o runbook das fontes do motor a cada
  execução e o entrega em `--append-system-prompt-file`. As configurações vêm só da
  fonte `user` (`--setting-sources user`) mais o arquivo do painel (`--settings`).
- **O pedido vai pelo stdin**, com uma das seis frases do runbook (gerar o briefing,
  gerar o site do cliente, continuar, criticar, refinar, ajustar).
- **O modelo e o esforço são resolvidos quando a execução começa**: valem os que o
  projeto escolheu; sem escolha, os das Configurações; sem nada lá, o modelo que o
  motor espera e o esforço que o contrato dele dá ao tipo do pedido (crítica e refino
  usam o da criação). O ensaio mostra o comando pela mesma ordem, e *Testar Claude*
  fica com o modelo das Configurações.
- **Vários sites nascem ao mesmo tempo**, até `CLAUDE_PARALLEL_SITES` (3 por padrão): briefing, geração, continuação, crítica e refino de cada um seguem sem esperar os outros. Quando uma etapa termina, a vaga continua com o site enquanto o passo seguinte dele entra na fila, e esse passo passa à frente dos pedidos que ainda não começaram: um site novo não para outro no meio. Cada site é comparado com os já entregues; dois nascendo juntos não se enxergam.
- **Os ajustes rodam ao lado da criação**, em cota própria, até `CLAUDE_PARALLEL_ADJUSTMENTS` de uma vez (5 por padrão; `0` volta a uma fila só, criação e ajustes, um de cada vez). Nunca duas execuções no mesmo site. Cada execução anota o projeto em que as ferramentas dela agem em um arquivo próprio (`<dados>/joinvixable/atual/<id>.txt`, passado em `JOINVIXABLE_ATUAL`), e uma não escreve no projeto da outra.
- **O tipo do site muda depois de gerado.** No card do site, "Várias páginas" grava `multiplas_paginas` no briefing do projeto (e no do cliente) pela consulta `tipo-de-site`, sem usar o Claude. Ligado, o ajuste recebe as regras de páginas (`prompts/paginas-ajuste.md`) e a validação aceita as páginas que `content.json` listar; num site entregue elas não precisam mais ser as do design brief, então um ajuste cria, tira ou divide páginas. Desligar é recusado enquanto o site tiver outras páginas.
- **O que é do mesmo build não é refeito.** As telas, as medições e a forma de um site ficam guardadas na sessão dele com o carimbo do `dist` (`telas.json`, `medidas.json`, `forma.json`) e valem enquanto o build for o mesmo; as capturas e as medições usam vários navegadores de uma vez (`navegadores_em_paralelo`, em `joinvixable/config/limits.json`). A validação que o painel pede depois de cada execução só refaz o build quando algum arquivo mudou desde a última que passou (`validacao.json`).
- **Sucesso é código de saída 0 e a validação do motor passando.** *Aguardando
  aprovação* é um estado próprio, nem sucesso nem falha. Etapa que ficou aberta é
  falha, com *Continuar de onde parou* e *Encerrar etapa*.
- **Ajuste, continuação e refino retomam a sessão de quem escreveu o site**
  (`--resume`) e recuam para uma sessão nova quando ela sumiu.
- **A crítica abre sempre uma sessão nova**, sem `--resume`, e a sessão dela nunca é a
  que as execuções seguintes retomam: quem critica não viu o site nascer, e quem
  refina não herda a conversa do crítico.
- **Cancelamento em dois tempos** (interrompe; se não sair, encerra), com a árvore de
  processos inteira — no Windows, `taskkill /T /F`.
- **Cada execução fica registrada**: sessão, duração, estado, mensagem e o stream
  bruto em disco.
- **O custo que aparece é a estimativa do Claude Code**: o `total_cost_usd` que o CLI
  informa de cada execução, a preço de API. O consumo de verdade sai da assinatura, e
  o número é sempre mostrado com esse rótulo.

### A sequência de um site

Uma geração não é uma execução só. O motor diz, em `estado`, onde o site está no
pipeline (`pipeline`: a fase, a rodada e o total de rodadas), se ele foi entregue e
qual é o pedido que o faz andar (`proximo`: `continuar`, `criticar`, `refinar` ou
nenhum). O painel só segue o que o motor indica:

1. Quando uma execução do projeto termina em **sucesso**, o painel olha o estado do
   site. Se o motor o dá por **entregue**, a sequência acabou. Senão, e havendo um
   `proximo`, esse pedido entra na fila para o mesmo projeto, com quem pediu e a
   permissão de publicar do pedido que abriu a sequência.
2. **Falha, cancelamento, interrupção e *aguardando aprovação* não encadeiam.** A
   sequência também para com a trava desligada e quando o motor pede de novo um passo
   que ela já deu no mesmo ponto do pipeline — uma execução que saiu sem erro e não fez
   o site andar não é repetida sem alguém decidir.
3. ***Continuar*** põe na fila o `proximo` do site, seja ele qual for, e é recusado
   com a mensagem do motor quando não há nenhum (site entregue, direção esperando
   alguém). Retomar uma execução interrompida faz o mesmo.
4. **A entrega acontece uma vez, no fim**: só quando o motor dá o site por entregue ele
   entra na lista de sites do projeto e vai ao GitHub. Entre a geração e a última
   rodada de refino, nada sai desta máquina. Para um site gerado antes das rodadas de
   crítica e refino, entregue continua sendo "revisão concluída".

A crítica mais recente — a rodada, o veredito, as notas e os problemas apontados — e
as rotas criativas propostas chegam à tela com o site, em `GET
/api/projects/:id/claude`.

### O que o agente não vê

O processo do painel carrega o token do GitHub, as senhas de FTP e os tokens do
Lovable e do BetterLinks. Três barreiras separam isso do agente:

1. **O ambiente é uma lista de permissão.** Só passa o que o sistema, o Claude Code e
   as ferramentas do motor precisam. A única chave que chega ao agente é a do Pixabay,
   porque a busca de fotos de banco roda como filha dele.
2. **Regras de leitura.** O agente roda de `<dados>/joinvixable/trabalho/` e não lê
   fora dela. Por cima disso, o painel nega o `.env`, a chave da service account e
   tudo o que há na pasta de dados fora da pasta de trabalho (`painel.json`, sessões,
   tokens do Lovable, backups), para as ferramentas de arquivo e para o shell.
3. **O filtro da tela.** O stream bruto fica em disco, inteiro. À tela vão só as
   linhas legíveis, com as pastas desta máquina trocadas por rótulos (`<pasta do
   motor>`, `<painel>`, `~`) e os segredos do painel apagados. O mesmo filtro passa
   pelas mensagens de recusa, pela revisão do briefing e pelo estado do site que o
   motor devolve — a direção criativa, as rotas e a crítica.

### A saída do modelo não é confiável

- **O `dist` nunca é servido na origem do painel.** As telas são imagens (só raster,
  conferidas pelo caminho real); o site abre na área de aprovação.
- **A configuração do repositório vem do template**, não do projeto: `package.json`,
  lockfile, `vite.config`, `tsconfig`, `tailwind.config`, `postcss.config` e
  `index.html`. Do projeto vão `src/`, `public/`, `content.json` e `imagens.json`.
  Briefing, direção criativa, sessão das etapas e `dist` ficam nesta máquina.
- **Dois bloqueios antes do envio**: pacote importado que o template não declara, e
  qualquer arquivo que carregue uma credencial deste painel ou um formato de
  credencial conhecido (o motivo cita a variável, nunca o valor).
- **Arquivo travado alterado reprova a validação**, e site que não valida não é
  enviado.
- **A pasta de trabalho de cada projeto tem o nome que o painel escolhe**
  (`<domínio>-<4 hex>`), nunca um nome vindo do material.

### Do site entregue ao GitHub

Site entregue — com a sequência de crítica e refino terminada — entra na lista de
sites do projeto (com `engine: "claude"`). Se quem pediu a geração tem a permissão
`publicar` e o GitHub está configurado, o painel cria o repositório na organização e
envia sozinho; senão a linha para em **Enviar ao GitHub**
e o botão abre o plano do envio — o que vai, o que não vai e o que acontece depois.
Com a área de aprovação configurada, o envio instala o workflow dela, e cada commit
publica a prévia. Envio automático que falha não derruba a execução: a linha guarda o
motivo e o site continua esperando.

### Assinatura Joinvix, em três camadas

1. **No kit do site.** O template traz o componente travado
   `src/componentes/AssinaturaJoinvix.tsx` e as duas logos em `public/joinvix/`. O
   rodapé é escrito para cada site, e as instruções do agente dizem onde a assinatura
   fica: dentro do `<footer>`, depois da linha legal, sobre o fundo do próprio rodapé.
2. **Na validação do motor.** Site que não usa o componente é recusado, e o build é
   conferido pelo mesmo sinal que a publicação procura.
3. **No build de publicação.** O script `ensure-joinvix-signature.sh` dos workflows
   continua valendo para qualquer site, de qualquer motor.

### Onde o estado fica

```
<dados>/joinvixable/
  trabalho/                 a raiz que o agente enxerga
    clientes/<pasta>/       material copiado do projeto e o briefing
    projects/<slug>/        o site: código, dist e a sessão das etapas
    .history/               o histórico de layouts (ver "O que vem da ferramenta antiga")
  execucoes/<id>.jsonl      o stream bruto de cada execução
  atual/<id>.txt            o projeto em que as ferramentas de cada execução agem
  entrada/                  passagem das cópias que vão para a pasta de trabalho
  rodando.lock              a trava das execuções em curso
  runbook.md                o runbook, gerado a cada execução
  configuracoes-do-agente.json
```

`<dados>` é a pasta de dados do painel (`server/data`, ou `PANEL_DATA_DIR`). No
`painel.json`, a chave `claude` guarda os projetos que passaram pelo motor — com o
modelo e o esforço que cada um escolheu (`options`) e o ponto do pipeline em que o
site está —, a fila e as últimas 300 execuções, com as gravações atômicas do resto do
banco. As opções do site (páginas, banco de imagens, skills, observações, rodadas,
direção de arte, movimento, escolha de rota e referências) não ficam no banco: moram
no briefing, na pasta do cliente, e quem as grava e confere é o motor.

### O que vem da ferramenta antiga

Cada site entregue fica no histórico de layouts (`trabalho/.history/layouts.jsonl`, com
as telas de abertura em `trabalho/.history/telas/`): a rota de direção de arte, o
conceito, as fontes, o sistema de design e a forma da página, medida no site construído.
É contra ele que o site seguinte é comparado, no plano e depois de pronto. A pasta de
trabalho nasce vazia, então o histórico do Joinvixable antigo é trazido uma vez:

```bash
npm run motor:historico -- "<pasta do Joinvixable antigo>"
```

O comando só copia: a pasta de origem não é alterada, o que o painel já tem continua
lá (o que vem de fora é mais antigo e entra na frente), rodar de novo não duplica
nada, e a saída mostra só a contagem.

**Um site feito na ferramenta antiga** entra pelo painel: **Novo projeto → Site para
publicar**, com a pasta inteira do site enviada (a que tem `.session/session.json` e
`content.json`, não só o build). A aba **Claude** do projeto reconhece a pasta e
oferece **Trazer para o motor Claude**, que copia o site para a pasta de trabalho do
motor — sem `node_modules`, `dist` nem `.env`, com o nome de pasta que o painel
escolhe — e o registra como site do motor. Trazer não dispara o Claude. Daí em diante
ele é um site do motor como os gerados aqui: **Enviar ao GitHub** leva a configuração
do template (o `package.json` de um site antigo não declara dependência, e por isso
não constrói no GitHub) e deixa de fora briefing, direção criativa e sessão; **Pedir
ajuste** funciona, e cada ajuste validado vira um commit que republica a prévia. Se o
projeto já tinha esse site registrado com repositório e área de aprovação, é o mesmo
registro que continua — o repositório e o link do cliente não mudam.

O envio comum de projeto do painel ("Enviar site ao GitHub") recusa uma pasta dessas
e aponta para a aba Claude. Sites cujo código só existe no GitHub ou no Lovable não
entram por aqui: o motor trabalha sobre o formato de projeto dele.

| Rota | Descrição |
| --- | --- |
| `GET /api/projects/:id/claude/adopt` | As pastas do projeto em que há um site do motor |
| `POST /api/projects/:id/claude/adopt` | Traz o site para o motor — permissão `gerar`, não gasta |

### Configurações e "Testar Claude"

A seção **Motor Claude** de Configurações reúne a trava, o modelo, o esforço de
raciocínio, as rodadas de crítica e refino, a direção de arte, o movimento, a escolha
da rota criativa (padrão do motor, parar ou seguir), o programa do Claude Code e o
navegador das capturas. Todas valem na hora. O programa e o navegador só aceitam o
executável esperado (`claude`, Chrome, Edge ou Chromium), instalado nesta máquina e
fora das pastas do painel — sem isso, quem configura o painel poderia apontar para um
arquivo enviado como material e fazê-lo rodar aqui.

O que cada escolha alcança:

| Configuração | Vazia | Como chega à execução | Quem pode escolher outra |
| --- | --- | --- | --- |
| `CLAUDE_MODEL` | O modelo que o motor espera (`claude-opus-5-5`) | `--model` | Cada projeto (`options.modelo`) |
| `CLAUDE_REASONING_EFFORT` | O esforço do contrato do motor para o tipo do pedido (`high`) | `--effort` | Cada projeto (`options.esforco`) |
| `CLAUDE_REVIEW_ROUNDS` | As rodadas padrão do motor | `JOINVIXABLE_RODADAS` | Cada site, no briefing (`rodadas`) |
| `CLAUDE_ART_DIRECTION` | A direção de arte padrão do motor | `JOINVIXABLE_DIRECAO_DE_ARTE` | Cada site, no briefing (`direcao_de_arte`) |
| `CLAUDE_MOTION` | O movimento padrão do motor | `JOINVIXABLE_MOVIMENTO` | Cada site, no briefing (`movimento`) |
| `CLAUDE_HUMAN_APPROVAL` | O padrão do motor | `JOINVIXABLE_APROVACAO_HUMANA` | Cada site, no briefing (`escolher_rota`) |

As quatro variáveis `JOINVIXABLE_…` entram no ambiente dos processos do motor e no do
agente só quando a configuração está preenchida; do ambiente do próprio painel nenhuma
delas é herdada. O modelo é um texto livre, com a regra de sempre — só o id ou o
apelido, nada que pareça outra opção do `claude` —, e a mesma regra vale para o modelo
que um projeto escolhe. `GET /api/projects/:id/claude/options` devolve o que o projeto
escolheu, o que vale no lugar do que ele não escolheu e as opções do site.

A primeira linha da seção é o **estado nesta máquina**: pacote instalado, versão do
Claude Code (`claude --version`), navegador encontrado, modelo e esforço em uso e o
comando de uma geração. Nada disso dispara o Claude Code.

**Testar Claude** é a exceção entre os testes da tela: faz uma pergunta mínima ao
Claude Code de verdade, com o modelo das Configurações, para conferir o login da
assinatura, e consome um pouco dela.
Só roda no clique, depois da confirmação, com a trava ligada e sem nada em andamento
— e responde 403, 428, 409 e 423 como as rotas que geram.

### Rotas do motor Claude

| Rota | Descrição |
| --- | --- |
| `GET /api/claude/status` | Motor instalado, trava, fila e o motor que vem marcado |
| `GET /api/claude/events?cursor=` | O log ao vivo, a partir do cursor |
| `POST /api/claude/queue/cancel` | Cancela a execução em andamento |
| `POST /api/claude/queue/resume` | Retoma a fila pausada — **gasta**, exige `confirm: true` |
| `POST /api/claude/queue/interrupted/:itemId/resume` | Retoma uma execução interrompida — **gasta** |
| `DELETE /api/claude/queue/interrupted/:itemId` | Descarta uma interrompida |
| `DELETE /api/claude/queue/:itemId` | Tira da fila um pedido que ainda espera |
| `GET /api/projects/:id/claude` | Briefing, revisão, site (com o pipeline, as rotas e a última crítica) e execuções do projeto |
| `GET /api/projects/:id/claude/material` | O material do projeto, classificado |
| `GET /api/projects/:id/claude/runs/:runId/log` | O log legível de uma execução |
| `GET /api/projects/:id/claude/images/:tipo?path=` | Telas, foto do material ou miniatura |
| `GET /api/projects/:id/claude/options` | O modelo e o esforço do projeto, os padrões que valem no lugar deles e as opções do site |
| `PUT /api/projects/:id/claude/options` | Grava o modelo e o esforço do projeto (`modelo`, `esforco`) e, em `site`, as opções do site — não gasta |
| `POST /api/projects/:id/claude/briefing/preview` | Ensaio do briefing — não gasta |
| `POST /api/projects/:id/claude/briefing` | Pede o briefing — **gasta** |
| `PUT /api/projects/:id/claude/briefing` | Grava o briefing corrigido |
| `POST /api/projects/:id/claude/generate/preview` | Ensaio do site — não gasta |
| `POST /api/projects/:id/claude/generate` | Pede o site — **gasta**. Em `opcoes`, as opções do site, gravadas no briefing antes de o pedido entrar na fila |
| `POST /api/projects/:id/claude/adjust` | Pede um ajuste — **gasta**. Em `anexos`, as imagens que seguem com ele |
| `PUT /api/projects/:id/claude/adjust/attachments` | Sobe uma imagem do próximo ajuste (corpo cru; PNG, JPG, WebP ou GIF, até 8 MB, seis por pedido). Fica em `.session/anexos/` do site, fora do que vai ao GitHub |
| `DELETE /api/projects/:id/claude/adjust/attachments` | Tira uma imagem do rascunho |
| `POST /api/projects/:id/claude/continue` | Põe na fila o passo seguinte do site: continuar, criticar ou refinar — **gasta** |
| `POST /api/projects/:id/claude/approve` | Aprova a direção e segue — **gasta** |
| `POST /api/projects/:id/claude/route` | Escolhe outra rota criativa (`rota`: o número dela) e segue para a direção ser refeita — **gasta** |
| `POST /api/projects/:id/claude/abort` | Encerra a etapa aberta |
| `POST /api/projects/:id/claude/stock-photos/refuse` | Tira uma foto de banco da direção |
| `GET /api/projects/:id/claude/repository` | O plano do envio ao GitHub |
| `POST /api/projects/:id/claude/repository` | Envia ao GitHub — permissão `publicar` |
| `POST /api/projects/:id/claude/validate` | Build e validação nesta máquina |
| `POST /api/projects/:id/claude/captures/telas` | Fotografa as telas do site |
| `GET /api/settings/claude` | O estado do motor nesta máquina — permissão `configurar` |
| `POST /api/settings/check/claude` | "Testar Claude" — **gasta**, permissão `configurar` |

As que mudam alguma coisa pedem a permissão `gerar`. Os pedidos que gastam e os dois
ensaios aceitam `modelo` e `esforco` no corpo: nos pedidos, a escolha fica gravada no
projeto quando o pedido entra na fila; nos ensaios, vale só para o comando mostrado.

### Como é testado

`npm run motor:isca` (`scripts/isca-do-claude.mjs`) é a conferência que os testes não
fazem: monta o mesmo comando de uma geração numa pasta temporária com arquivos-isca e
mostra o comando, sem disparar nada. Com `--executar`, roda o Claude Code de verdade
(consome a assinatura, e só com autorização) e confere se o agente respeita a lista
fechada, o login da assinatura e o runbook. Mesmo sem `--executar`, o script carrega o
`.env` do painel e roda consultas do pacote do motor.

Nenhum teste chama o Claude de verdade. `CLAUDE_BIN` aponta para um claude falso
(`engines/claude/fixtures/claude-falso.mjs`), que emite eventos `stream-json` de
exemplo em vários cenários: sucesso, login que falhou, chave de API no lugar da
assinatura, servidor MCP ou ferramenta fora do contrato, execução lenta, processo que
não sai no primeiro sinal, sessão que sumiu, e o site que passa por crítica e refino —
com a crítica que aprova antes do fim, o passo que falha e o passo que termina sem
fazer o site andar. As rotas rodam na API de verdade — política de rede, sessão,
permissões — com um motor de mentira (`fixtures/motor-falso.mjs`), que responde às
mesmas consultas do pacote e deixa uma sequência inteira ser percorrida; os testes que
usam o
pacote de verdade (o contrato de permissões, o runbook, o site do template passando
pelos scripts da área de aprovação) são pulados onde ele não está.

As telas foram vistas no navegador com esse mesmo claude falso, numa instância
isolada do painel (dados temporários, sem o `.env` da máquina): cada estado do card,
a fila, o lote, o envio e a seção de Configurações, nos dois temas e em largura de
celular.

## Ajustes pelo Claude em sites do Lovable (edição livre)

Um site feito no Lovable (ou vinculado de fora) que já mora num repositório do GitHub pode receber ajustes pelo Claude Code desta máquina, pela aba **Ajustes** do projeto (ao lado da aba Claude). Dá para alternar: um dia pelo Claude, no outro pelo Lovable — o Lovable sincroniza com o GitHub nos dois sentidos, e o painel sempre parte do que está no GitHub.

**Quando a aba aparece:** o site mais recente do projeto tem repositório (`devArea.repoFullName` ou `repoFullName`) e não é do motor Claude (esse tem os ajustes dele, na aba Claude). É preciso o token do GitHub configurado. Pedir um ajuste pede as permissões `gerar` (gasta a assinatura) e `publicar` (o resultado vai ao GitHub e à área de aprovação do cliente), a trava "Liberar o uso do Claude" ligada e a confirmação de gasto (`confirm: true`).

**Como um ajuste roda** (`server/src/engines/claude/edicao/`), como um pedido `edicao` na mesma fila do Claude, na cota dos ajustes, e nunca dois no mesmo repositório:

1. **preparar** — o painel mantém um clone do repositório em `<dados>/joinvixable/edicao-<dono>--<nome>/` e o alinha com a última versão do branch principal (o que o Lovable sincroniza): `fetch`, `reset --hard`, `clean` (as dependências ficam). Instala as dependências quando o `package.json` ou a trava mudaram (`npm ci --ignore-scripts`; nenhum script do repositório roda só por instalar). As imagens do pedido entram em `.painel-anexos/` (ignorada pelo Git) ou, as de usar no site, em `public/img/ajustes/`.
2. **editar** — o `claude -p` roda dentro do clone, com o contrato da edição livre (`edicao/contrato.js`): lê e edita qualquer arquivo do clone e roda `npm run build`/`npm run lint`; não roda `git`, não instala pacote, não apaga nem move pelo shell, e não toca em `package.json`, travas de dependência, configuração do gerenciador de pacotes (`.npmrc`, `.yarnrc`, `bunfig.toml`, `.pnpmfile.cjs`), `vite.config`, `.github/` e `.env`. Nada fora do clone é legível (o banco, o motor, os outros clones, os segredos do painel). As regras do ajuste vão no prompt de sistema; o pedido leva de onde o ajuste parte (quem fez a última alteração) e a memória dos ajustes anteriores. As guardas de sempre valem: login da assinatura (nunca chave de API), sem MCP, sem plugin, sem ferramenta fora do contrato, log filtrado. O contrato da edição nega pelo menos os comandos de shell e as leituras que o do motor nega, tem as mesmas variáveis de ambiente e o mesmo modelo padrão; `edicao/contrato.test.js` compara os dois quando o pacote do motor está na pasta.
3. **conferir** — o painel confere o que mudou: nada do que é intocável, nenhum import fora do `package.json` (quebraria no GitHub), nenhuma credencial no código, e `npm run build` passando. Sem alteração, o ajuste termina como "sem mudança".
4. **enviar** — um commit normal, com o autor "Claude (Painel Sites Express)" e a marca `Ajuste-Painel: <id>` no fim da mensagem. Se o GitHub andou durante o ajuste (alguém editou no Lovable), o commit vai para cima do que chegou (rebase só local; o histórico do GitHub nunca é reescrito — o Lovable perderia o que não estava lá) e o build é conferido de novo; mexendo nas mesmas linhas, é **conflito** e nada é enviado. O push publica a área de aprovação sozinho (o workflow dela roda a cada push), e o painel passa a acompanhá-la.

O token do GitHub vai em cada comando que fala com o GitHub, por variável de ambiente do Git (cabeçalho de autorização), com o gerenciador de credenciais da máquina desligado; nunca fica gravado no clone e some de qualquer mensagem.

**Quem fez a última alteração** (`edicao/origem.js`): **Lovable** pelo robô dele (`lovable-dev[bot]` como autor, `gpt-engineer-app[bot]` como committer — visto nos repositórios da organização); **Claude** pela marca `Ajuste-Painel`; **Painel** quando o commit só mexe em `.github/` (os workflows de publicação, que não contam como alteração do site); **Pessoa** em qualquer outro caso, com o nome do autor.

**A memória dos ajustes** fica em `painel.json` → `repoEdits[projectId]` (`store/repo-edits.js`, até 200 por projeto): o pedido, quem pediu, a versão de onde partiu (e quem tinha feito a última alteração), a situação (`queued`, `running`, `pushed`, `unchanged`, `failed`, `conflict`, `cancelled`, `interrupted`), o que o Claude disse ter feito, o commit e os arquivos. O próximo pedido leva os últimos ajustes como contexto. Um ajuste que rodava quando o painel caiu vira "interrompido" e pode ser retomado (parte da versão de agora) ou descartado.

**Cuidado com o Lovable:** não edite o site no Lovable enquanto um ajuste roda. O painel junta o que chegou ao GitHub, mas o que estiver só no editor do Lovable, ainda não sincronizado, pode ser substituído pela versão do GitHub na sincronização seguinte (é o comportamento documentado do Lovable para histórico divergente).

| Rota | Descrição |
| --- | --- |
| `GET /api/projects/:id/edits` | A aba: se o projeto pode, o repositório, a última versão já lida, o pedido em andamento e a memória. Não fala com o GitHub |
| `GET /api/projects/:id/edits/version` | Alinha o clone com o GitHub e devolve a última versão e as alterações recentes, com quem fez cada uma |
| `POST /api/projects/:id/edits` | Pede um ajuste — **gasta**, exige `gerar`, `publicar` e `confirm: true` |
| `PUT /api/projects/:id/edits/attachments?name=&draft=` | Sobe uma imagem para o próximo pedido (corpo cru, até 8 MB) |
| `DELETE /api/projects/:id/edits/attachments?draft=&file=` | Tira uma imagem do rascunho |
| `GET /api/projects/:id/edits/:editId/log` | O log de um ajuste, refeito do stream guardado |

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

## Projetos criados no painel (sem Drive e sem repositório)

Nem todo site nasce de uma coleta. Um site desenvolvido inteiro com o Claude não tem
pasta no Drive nem repositório no GitHub, e material às vezes chega por fora do
formulário. **Novo projeto**, na barra da seção Projetos, cria o projeto no próprio
painel, de um de dois tipos:

- **Site para publicar** — entra na fila "Fazer agora", no grupo *Enviar o site ao
  GitHub*, com o selo e o botão **Enviar ao GitHub**;
- **Só arquivos** — um lugar para guardar material. Selo *Arquivos*, fora da fila (não
  há passo a cobrar). O item **Enviar site ao GitHub** continua no menu **…**, se um
  dia houver um site ali.

O projeto usa tudo o que as coletas usam — tags, apelido, linha do tempo, vínculo de
site, prévia, envio ao cliente, publicação —, porque essas tabelas são por id de
projeto. O que ele não tem é a geração pelo Lovable (ela monta o envio a partir da
pasta do Drive; as rotas respondem 409) e o "Abrir no Drive". No menu aparece
**Excluir projeto**, que as coletas não têm, e **Gerar site com o Claude**: o motor
Claude lê os arquivos enviados ao painel, do mesmo jeito que lê a pasta do Drive.

### Onde os arquivos ficam

Em disco, em `server/data/projetos/<id>/` — a mesma pasta de dados do banco, já fora
do git. O Drive continua somente leitura. O modal do projeto é o mesmo das coletas
(grade, busca, pré-visualização, `.zip` abrindo como pasta), com **Enviar arquivos**,
**Enviar uma pasta** (com as subpastas; `node_modules` e `.git` nem sobem) e a lixeira
em cada item. As rotas de pasta e de arquivo têm os mesmos endereços das do Drive: o
router dos projetos locais vem antes e atende o id que reconhece
(`painel-<16 hex>` para o projeto, `<projeto>~<caminho em base64url>` para um item); o
resto segue para o Drive. Todo caminho vindo do navegador é conferido antes de tocar o
disco (sem `..`, sem nome que o Windows recuse, sempre dentro da pasta do projeto), e o
conteúdo sai com as mesmas travas do Drive: HTML e SVG como texto puro, CSP fechada.
O teto é de 500 MB por arquivo.

> Os arquivos não entram no backup diário do `painel.json`. Inclua
> `server/data/projetos/` na rotina de backup da máquina.

### Enviar o site ao GitHub

O diálogo tem duas partes:

1. **Código do site.** O painel procura sozinho, nos arquivos do projeto, onde há um
   site: pastas (até dois níveis) e `.zip` com `package.json` ou `index.html` na raiz —
   a pasta que só embrulha o projeto dentro do zip é desconsiderada. **Enviar a pasta
   do site** escolhe a pasta no computador e a grava em `site/` (substituindo a versão
   anterior); **Enviar um .zip** guarda o compactado. Cada origem mostra quantos
   arquivos vão, o tamanho e se tem build.
2. **Repositório.** O nome sugerido sai do nome do projeto (`cliente.com.br` →
   `cliente-com-br`); o repositório nasce privado, na organização configurada.

Não vão ao repositório, e o diálogo diz quantos de cada: `node_modules`, `.git`,
`.github` (os workflows recebem a senha do FTP — quem os grava é o painel), saídas de
build quando há `package.json` (`dist`, `.next`, `.output`…), arquivos `.env` (podem
ter chaves; as variáveis de build são informadas ao publicar) e lixo do sistema. Os
tetos: 50 MB por arquivo, 3.000 arquivos, 500 MB no total.

O envio usa a API de dados do git (`deploy/github/git-data.js`): um blob por arquivo,
uma árvore e **um commit**. A API de conteúdo faria um commit por arquivo, e cada um
dispararia o workflow de push. Num repositório que já existe, só sobe o que mudou (o
SHA do blob é calculado aqui e comparado com o da árvore atual), o que está em
`.github/workflows/` é mantido, e sem mudança nenhuma não há commit.

Depois do envio o site fica registrado como um site vinculado de fora do Lovable
(`ext-…`, com o repositório confirmado), e segue o caminho de todos: **Publicar
prévia** (ou já no envio, com a caixa marcada), **Enviar ao cliente** e **Publicar**
no domínio. Enviar de novo — **Atualizar o site no GitHub**, no menu — grava uma
versão nova no mesmo repositório, e o que já publica (prévia ou domínio) publica de
novo sozinho, pelo push.

> **O token precisa de mais uma permissão.** Criar repositório exige *Administration:
> Read and write* e acesso a **All repositories** da organização — com "Only select
> repositories", o repositório recém-criado ficaria fora do alcance do próprio token.
> Sem isso o GitHub responde 403 e o diálogo diz o que falta. Quem preferir não dar
> essa permissão cria o repositório vazio no GitHub e usa **Vincular site existente**.

## Área de desenvolvimento (link de aprovação)

Com `DEV_AREA_*` no `.env`, o link que vai ao cliente deixa de ser o Share preview do
Lovable: cada site é publicado numa pasta própria de um domínio da Joinvix
(`https://aprovacao.exemplo.com.br/zezinho/`), e é ela que o cliente abre para
aprovar. Depois da aprovação, o site vai para o domínio do cliente pelo **Publicar**
de sempre.

O fluxo, sem ninguém pedir:

1. O site é gerado. A linha mostra **Conectar ao GitHub** — a conexão é feita no
   editor do Lovable (o MCP não faz isso), e o botão da linha leva até lá.
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
menu **…** da linha ou no diálogo do projeto; conferida a pasta, ela passa a ser o link
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
não tem link ou tem link que não abre, e a linha só oferece *Enviar ao cliente* com o
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
| Administration | Leitura e escrita | criar o repositório de um projeto do painel (opcional; exige acesso a *All repositories*) |

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

**Motor Claude: a primeira execução real pelo painel.** Tudo o que está descrito na
seção "Motor Claude" foi provado com o `claude` falso. Uma execução com o Claude Code
de verdade ainda precisa confirmar cinco coisas que o falso não prova: que o login da
assinatura é o que o CLI usa, que as permissões do contrato bastam para o agente
trabalhar e barram o resto (inclusive com o perfil pessoal de quem roda, que entra
pela fonte `user`), que a sequência de crítica e refino se sustenta com sessões de
verdade — uma nova a cada crítica, a do autor retomada a cada refino —, que o site sai
com a assinatura Joinvix e que ele chega à área de aprovação.

As duas primeiras têm uma ferramenta própria, a **execução-isca**:

```bash
npm run motor:isca                 # mostra o comando exato, a pasta e o pedido — não dispara nada
npm run motor:isca -- --executar   # dispara o claude -p de verdade (consome a assinatura)
```

Ela monta o mesmo comando de um ajuste, numa pasta de dados temporária com
arquivos-isca (um `.env`, um banco na pasta de dados, um arquivo fora da pasta de
trabalho), e pede ao agente que cite o runbook e tente o que não pode: ler as iscas,
rodar `git`, `cat` e `ls`, criar um arquivo solto, buscar uma página. O resultado
sai conferência por conferência — `ok`, `FALHOU` ou `sem prova`, quando o agente
nem tentou — e vale refazer depois de atualizar o Claude Code ou de mexer nas
configurações pessoais dele (`~/.claude`). Se uma regra pessoal alargar a lista
fechada, a saída é tirar a fonte `user` do contrato (`fontes_de_configuracao`, em
`joinvixable/config/headless.json`) e conferir de novo.

**Lovable.**

O upload de anexos já foi validado contra o servidor real (tools gratuitas). O que
falta é a primeira criação de fato — só ela confirma quais formatos o Lovable aceita
como anexo e o teto de tamanho, que não são documentados.

> Os schemas das tools estão em `mcp.lovable.dev/skill.md`, e o `tools/list` do MCP
> devolve `inputSchema` e `outputSchema` de cada uma. Consulte de lá antes de supor
> qualquer formato — foi supondo que a primeira tentativa quebrou.
