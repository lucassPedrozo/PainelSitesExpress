/**
 * O que o motor próprio diz ao modelo.
 *
 * O prompt de sistema é fixo — nada de data, nome de cliente ou id nele — para
 * o cache de prompt valer de uma geração para a outra; o que muda por cliente
 * vai na mensagem do usuário. Ele descreve o resultado esperado, não um roteiro
 * passo a passo: os modelos atuais rendem mais com o objetivo claro do que com
 * instruções miúdas.
 */

export const SYSTEM_PROMPT = `Você cria sites institucionais para pequenas empresas brasileiras, a partir do briefing que o cliente preencheu.

O projeto já existe: Vite, React, TypeScript e Tailwind CSS, com a configuração pronta. Você escreve o conteúdo do site em src/, public/ e index.html, usando as ferramentas de arquivo. A configuração (package.json, vite.config, tsconfig) não muda — use só as dependências que já estão no package.json; leia-o antes de importar qualquer biblioteca.

O resultado precisa:
- ser um site estático: o build gera HTML, CSS e JS que vão para uma hospedagem por FTP, sem servidor;
- funcionar numa subpasta: importe imagens de src/assets (o Vite ajusta o caminho) e use caminhos relativos para o que estiver em public/;
- estar em português do Brasil, com o texto escrito a partir do briefing — sem inventar telefone, endereço, preço ou depoimento que o briefing não traga;
- ser responsivo, acessível (contraste, textos alternativos, hierarquia de títulos) e rápido;
- ter título, descrição e dados de compartilhamento no index.html;
- trazer no rodapé a assinatura "Desenvolvimento e Hospedagem | Joinvix", com link para https://www.joinvix.com.br/.

Escreva cada arquivo inteiro. Antes de terminar, confira que todo import aponta para um arquivo que existe. Ao final, responda com um resumo curto do que foi construído e do que ficou faltando no briefing.`;

/**
 * A mensagem do usuário para uma geração.
 *
 * @param {{ brief: string, notes?: string, assets?: string[], projectName?: string }} input
 */
export function buildUserPrompt({ brief, notes = "", assets = [], projectName = "" }) {
  const partes = [];
  if (projectName) partes.push(`Projeto: ${projectName}`);
  partes.push(`<briefing>\n${brief.trim()}\n</briefing>`);
  if (notes.trim()) {
    partes.push(`Observações de quem opera o painel (valem mais que o briefing quando conflitarem):\n${notes.trim()}`);
  }
  partes.push(
    assets.length
      ? `Imagens do cliente já copiadas para o projeto — use-as no lugar de imagens genéricas:\n${assets.map((a) => `- ${a}`).join("\n")}`
      : "O cliente não mandou imagens: use composições com cor e tipografia, sem imagens de banco.",
  );
  partes.push("Construa o site.");
  return partes.join("\n\n");
}
