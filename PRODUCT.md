# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipe pequena e interna da Joinvix, na rede da empresa, com papéis diferentes. Cada pessoa entra com a própria chave de acesso, e a chave diz o que ela pode mudar: organizar, gerar, publicar, configurar, administrar. Ver projetos, arquivos e briefings é a base de qualquer acesso.

O trabalho é conduzir sites institucionais de clientes ("Sites Express") de ponta a ponta. Em geral há até 20 projetos em andamento ao mesmo tempo, então cada um é acompanhado individualmente: a pessoa abre o painel para saber em que etapa cada site está e executar o próximo passo.

O cliente final não usa o painel. Ele só recebe o link de aprovação do site.

## Product Purpose

Conduzir o fluxo inteiro de um site institucional feito em escala: coleta do material do cliente no Google Drive, geração do site (no Lovable ou pelo motor Claude, o Claude Code desta máquina), link de aprovação para o cliente e publicação final por FTP via GitHub Actions.

Cada pasta de primeiro nível na pasta raiz do Drive é um projeto. Para cada um, o painel diz em que etapa está e qual é o próximo passo. Sucesso é o site certo no ar no domínio do cliente, sem ninguém precisar sair do painel para descobrir o que falta ou por que algo falhou.

## Positioning

Um único lugar para todas as etapas, do briefing ao domínio no ar, com o estado real de cada uma: o resultado da publicação é lido das execuções do workflow no GitHub, e não do disparo. Nenhum segredo chega ao navegador, e nenhuma ação que custa dinheiro acontece por acidente.

## Operating Context

- Roda localmente no Windows (há um lançador próprio), acessado pelo navegador em `localhost` ou pela rede interna.
- Fontes e destinos externos: Google Drive (material e briefing), Lovable (geração, debita crédito), Claude Code instalado na máquina (geração pelo motor Claude, consome a assinatura), GitHub (repositórios e Actions), FTP da hospedagem do cliente, encurtador BetterLinks (link do cliente).
- Etapas de um projeto e o botão de próximo passo correspondente: Gerar, Criar link, Enviar ao cliente, Publicar.
- No motor Claude o próximo passo acompanha o trabalho do agente: Revisar e gerar (briefing pronto), Corrigir briefing (a conferência recusou), Acompanhar (rodando ou na fila, da geração à última rodada de crítica e refino), Aprovar direção ou escolher outra rota, Continuar (sequência que parou no meio), Ver erro, Retomar ou descartar (interrompida por um reinício) e Enviar ao GitHub (site entregue).
- Área de aprovação: cada site é publicado numa pasta de um domínio próprio a cada push; esse é o link que o cliente recebe.
- Interface e mensagens em português do Brasil.

## Capabilities and Constraints

- Listagem dos projetos com o domínio em primeiro plano, selo de estado e próximo passo; vista "Fazer agora" agrupada pelo que falta fazer; ações em massa.
- Geração no Lovable (individual e em lote), acompanhamento ao vivo e resposta ao agente quando ele para esperando alguém.
- Ajustes pelo Claude em sites do Lovable (aba Ajustes): o painel parte da última versão do GitHub, o Claude ajusta, o build é conferido e o painel faz um commit normal — o Lovable recebe pela sincronização dele, então dá para alternar entre os dois. Mostra quem fez a última alteração (Lovable, Claude ou uma pessoa) e guarda a memória dos ajustes pedidos.
- Geração pelo motor Claude (individual e em lote): o Claude escreve o briefing a partir do material do projeto, uma pessoa revisa, e ele escreve o site. O site gerado passa por rodadas de crítica, feitas por uma sessão que não o escreveu, e de refino; cada passo é uma execução que o painel põe na fila sozinho, e o site só é entregue no fim. Uma execução por vez, numa fila só; log ao vivo, cancelamento, modelo e esforço por projeto, escolha opcional da rota criativa, telas do site, ajuste e envio do site entregue ao GitHub.
- Publicação por FTP/FTPS: o painel grava secrets e workflows no repositório do site, faz simulação (dry-run) e dispara o deploy; histórico por domínio com link do erro quando falha.
- Pré-visualização dos arquivos do Drive, tags livres com cor, filtros, busca, ordenação e faixas de data.
- Configurações gravadas no `.env` com validação; chaves de acesso individuais e revogáveis.
- Restrição: segredos (service account, tokens do Lovable e do GitHub, senhas de FTP) vivem só no backend; a interface recebe no máximo uma dica mascarada.
- Restrição: a geração no Lovable debita crédito e fica atrás de uma trava explícita (`LOVABLE_ENABLE_GENERATION=1`).
- Restrição: a geração pelo motor Claude consome a assinatura do Claude Code e fica atrás de outra trava (`CLAUDE_ENABLE_GENERATION=1`). Com ela desligada, o ensaio do pedido funciona e nada é disparado. Toda ação que dispara o Claude pede confirmação na tela; a da geração vale para a sequência inteira do site, e a trava é conferida de novo a cada passo.
- Restrição: o agente do motor Claude não recebe as credenciais do painel, e o que ele escreve é tratado como não confiável: nada do site gerado é servido na origem do painel, e o log passa por um filtro antes de ir à tela.
- Restrição: todo site gerado leva a assinatura Joinvix.
- Stack existente: React 19, Vite, Tailwind v4, shadcn/Radix, lucide-react, Geist; API em Node + Express.
- Vocabulário do produto: projeto, geração, área de aprovação (área de dev), link do cliente, publicação, workflow, chave de acesso, tag.
- Vocabulário do motor Claude: motor, briefing, conferência (o que aceita ou recusa o briefing), ensaio (conferir o pedido sem gastar), direção criativa, rota criativa, execução, fila do Claude, etapa, crítica, refino, rodada, ajuste, telas, trava ("Liberar o uso do Claude").

## Brand Commitments

O painel segue a identidade da Joinvix (confirmado pelo usuário). Ativos no repositório: `web/src/assets/joinvix-logo.png`, `web/src/assets/joinvix-mark.png`, `web/public/favicon.png`, `web/public/apple-touch-icon.png`. Nome do produto: "Painel Sites Express" (título da página: "Painel Gerenciador · Sites Express").

Em aberto: as cores e a tipografia oficiais da Joinvix ainda não foram indicadas; o usuário ficou de apontar os arquivos. Até lá, não inventar regras de marca além do logo e do nome.

## Evidence on Hand

- Dados reais do fluxo em `server/data/` (não versionado): projetos, gerações, publicações e histórico de execuções.
- Documentação: `README.md` e `docs/GUIA-TECNICO.md`.
- Não há depoimentos, métricas de uso ou material de marketing; o painel é ferramenta interna e trabalho futuro não deve fabricá-los.

## Product Principles

1. O próximo passo de cada projeto é sempre visível; ninguém deveria precisar deduzir o que falta.
2. O painel mostra o que aconteceu de fato, não o que foi pedido: estado lido da fonte (GitHub, Lovable, link), com o erro ao alcance quando falha.
3. Nada que custa dinheiro ou vai para o domínio do cliente acontece por acidente.
4. Segredos nunca chegam ao navegador.
5. Cada pessoa só vê habilitado o que a chave dela permite mudar.
