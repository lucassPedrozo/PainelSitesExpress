# Painel Sites Express

## Visão geral

O Painel Sites Express conduz o fluxo inteiro de um site institucional feito em escala: da coleta de material do cliente no Google Drive à geração do site no Lovable, ao link de aprovação que o cliente abre e à publicação final por FTP via GitHub Actions. Cada pasta de primeiro nível dentro da pasta raiz do Drive é um **projeto**, e o painel diz, para cada um, em que etapa ele está e qual é o próximo passo.

O princípio que orienta o projeto: **nenhum segredo chega ao navegador, e nenhuma ação que custa dinheiro acontece por acidente**. A chave da service account, o `refresh_token` do Lovable, o token do GitHub e as senhas de FTP vivem só no backend; a interface recebe no máximo uma dica mascarada (`github_pat_…a1b2`). A geração no Lovable, única operação que debita crédito, fica atrás de uma trava explícita no `.env` — enquanto ela não é ligada, o painel monta e confere o envio inteiro, mas nunca chama `create_project`.

A API inteira roda atrás de uma política de rede própria: escuta só em `127.0.0.1` por padrão, aceita apenas loopback e faixas privadas quando aberta para a rede interna, rejeita origens cruzadas e headers de proxy, e exige uma chave de acesso por pessoa, guardada em hash e revogável isoladamente.

## Funcionalidades

- Listagem dos projetos do Drive com o domínio em primeiro plano, selo de estado e um botão de próximo passo que muda conforme a etapa: *Gerar*, *Criar link*, *Enviar ao cliente*, *Publicar*
- Vista "Fazer agora", que agrupa os projetos pelo que falta fazer, e ações em massa sobre vários projetos de uma vez
- Geração do site no Lovable via MCP (OAuth), com o briefing do Drive como prompt, anexos (imagem, PDF, vídeo, áudio, compactado) e observações adicionais
- Geração em lote, acompanhamento ao vivo do andamento e resposta ao agente do Lovable quando ele para esperando alguém
- Trava de crédito: sem `LOVABLE_ENABLE_GENERATION=1`, nenhuma chamada que custa crédito é feita
- Assinatura Joinvix garantida em todo site gerado, conferida em três camadas (prompt, verificação no código e script no build)
- Área de aprovação: cada site é publicado numa pasta de um domínio próprio a cada push, e esse é o link que o cliente recebe
- Link do cliente mascarado por encurtador (BetterLinks via MCP), com o mesmo endereço curto reapontado quando o preview muda e verificação automática periódica
- Publicação por FTP/FTPS com GitHub Actions: o painel grava os secrets (criptografados com libsodium) e os workflows no repositório, faz dry-run e dispara o deploy
- Resultado real da publicação lido das execuções do workflow no GitHub, e não do disparo, com histórico por domínio e link do erro quando falha
- Detecção automática do build (Vite, React Router, Next export, Astro, TanStack Start) e do gerenciador de pacotes
- Pré-visualização dos arquivos do Drive dentro do painel, com miniaturas servidas por proxy autenticado
- Tags com cor e nome livres, filtros por tag, busca, ordenação e faixas de data
- Tela de Configurações que grava o `.env` com validação completa antes de escrever, sem nunca devolver um segredo ao navegador
- Chaves de acesso individuais com permissões granulares (organizar, gerar, publicar, configurar, administrar)
- Banco local em JSON com escrita atômica, backup diário rotativo e recuperação automática a partir da cópia mais recente legível
- Lançador para Windows com estado do servidor, endereços na rede local e log ao vivo
- Motor de geração próprio (modelo de IA escrevendo o site num projeto-modelo) arquitetado e desligado, pronto para ser ativado

## Estrutura do projeto

```text
.
|-- .github/
|   `-- workflows/
|       `-- ci.yml
|-- docs/
|   `-- GUIA-TECNICO.md
|-- launcher/
|   |-- PainelLauncher.cs
|   `-- build.ps1
|-- server/
|   |-- src/
|   |   |-- ai/
|   |   |-- deploy/
|   |   |   `-- github/
|   |   |-- devarea/
|   |   |-- engines/
|   |   |   `-- own/
|   |   |-- lovable/
|   |   |-- preview/
|   |   |-- routes/
|   |   |-- security/
|   |   |-- settings/
|   |   |-- shortlinks/
|   |   |-- store/
|   |   |-- app.js
|   |   |-- backup.js
|   |   |-- config.js
|   |   |-- drive.js
|   |   `-- index.js
|   |-- workflows/
|   |   |-- scripts/
|   |   |-- build.yml
|   |   |-- deploy-via-ftp.yml
|   |   `-- dev-area-via-ftp.yml
|   |-- package.json
|   `-- tsconfig.json
|-- shared/
|   |-- access-permissions.js
|   |-- domain.js
|   `-- lovable-repo.js
|-- web/
|   |-- public/
|   |-- src/
|   |   |-- components/
|   |   |   `-- ui/
|   |   |-- features/
|   |   |   |-- access/
|   |   |   |-- deploy/
|   |   |   |-- generate/
|   |   |   |-- project-files/
|   |   |   |-- projects/
|   |   |   |-- settings/
|   |   |   `-- tags/
|   |   |-- lib/
|   |   |   `-- api/
|   |   |-- App.tsx
|   |   `-- main.tsx
|   |-- package.json
|   `-- vite.config.ts
|-- .env.example
|-- package.json
`-- README.md
```

- `server/` — API em Node + Express: Drive, Lovable (MCP), GitHub, FTP, encurtador, política de rede e banco local
- `server/workflows/` — os workflows e scripts que o painel grava nos repositórios dos sites; o `ci.yml` da raiz é só a verificação do próprio painel
- `web/` — interface em React, organizada por funcionalidade
- `shared/` — o que API e interface precisam enxergar igual: permissões, leitura do domínio da coleta e nome do repositório
- `launcher/` — lançador para Windows, compilado localmente com `build.ps1`

## Como executar

**Requisitos:** Node.js 22, uma service account do Google com leitura na pasta raiz do Drive e, para publicar, um token fine-grained do GitHub. As chaves ficam no `.env`, criado a partir do `.env.example`, que nunca é versionado — assim como a chave JSON da service account e a pasta `server/data/`.

**Instalar as dependências** da raiz, da API e da interface:

```bash
npm run setup
```

**Criar o `.env`** a partir do modelo e preencher a pasta raiz do Drive e o caminho da chave:

```bash
cp .env.example .env
```

**Rodar em desenvolvimento** (API e interface juntas):

```bash
npm run dev
```

Abra `http://localhost:5173`. O Vite faz proxy de `/api` para a API em `http://localhost:3333`. Depois da primeira subida, as demais chaves podem ser preenchidas pela tela **Configurações** do painel, sem editar o `.env` à mão.

**Rodar em produção**, com painel e API na mesma porta:

```bash
npm run build
```

```bash
npm start
```

**Verificação completa** (lint, tipos, testes e build — o mesmo que roda no CI):

```bash
npm run check
```

**Só os testes:**

```bash
npm test
```

Nenhum teste fala com Drive, Lovable, GitHub ou FTP de verdade: as integrações são exercitadas com dublês, e o CI roda sem nenhuma chave configurada.

A arquitetura completa — política de rede, chaves de acesso, API, geração no Lovable, área de aprovação, encurtador, publicação por FTP, permissões do token e detecção do build — está em [`docs/GUIA-TECNICO.md`](docs/GUIA-TECNICO.md).

## Stacks

- Node.js 22
- Express
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- shadcn/ui e Radix UI
- TanStack Query
- Google Drive API v3 (`googleapis`)
- Lovable (MCP com OAuth)
- API REST do GitHub e GitHub Actions
- libsodium (secrets do GitHub)
- BetterLinks (MCP)
- Anthropic SDK (motor próprio, desligado)
- Node test runner e Vitest
- oxlint
- C# (lançador para Windows)

## Hook para portfólio

**Categoria:** Produto interno / Automação de operação

**Resumo:** Painel que conduz a produção de sites institucionais em escala, da coleta de material no Google Drive à geração no Lovable, aprovação do cliente e publicação por FTP via GitHub Actions, com todas as credenciais isoladas no backend.

**Contexto:** A produção de cada site passava por cinco ferramentas diferentes — Drive, Lovable, GitHub, hospedagem FTP e encurtador de links — com passos manuais entre elas: copiar o briefing, gerar o site, criar o repositório, configurar secrets e workflows, montar o link do cliente e conferir se a publicação realmente foi ao ar. Cada passo manual era um ponto de erro e de retrabalho, e não havia visão única de em que etapa cada cliente estava.

**Resultados:** Um painel único em que cada projeto mostra sua etapa e o próximo passo em um botão; geração e publicação em lote; link de aprovação estável para o cliente, que não muda quando o site é refeito; e a confirmação de que um site está no ar vem da execução real do workflow, não do disparo.

**Destaques:**

- Nenhuma credencial chega ao navegador: Drive, Lovable, GitHub e FTP são acessados só pelo backend, e a interface recebe no máximo uma dica mascarada
- Trava de crédito que impede qualquer chamada paga ao Lovable enquanto não é ligada explicitamente
- Política de rede aplicada à API inteira: loopback por padrão, apenas faixas privadas na rede interna, rejeição de origens cruzadas e headers de proxy, CSP e bloqueio progressivo de tentativas
- Chaves de acesso individuais em hash (sha256 com sal), com permissões granulares e revogação que derruba as sessões na hora
- Secrets gravados no GitHub criptografados com libsodium e actions fixadas por commit nos workflows gerados
- Status de publicação lido das execuções reais do GitHub Actions, ignorando execuções canceladas e simulações
- Banco local com escrita atômica, backup diário rotativo e subida a partir da última cópia legível se o arquivo principal corromper
- Mais de 430 testes automatizados (API e interface) rodando no CI a cada push, sem nenhuma chave real

**Stack:**

- Node.js
- Express
- React
- TypeScript
- Tailwind CSS
- GitHub Actions
- Google Drive API
- Lovable (MCP)
