import type { BuildFile, BuildPackage } from "@/lib/api";
import { pluralize } from "@/lib/format";

/**
 * O que o envio tem e o que falta, antes de gastar crédito.
 *
 * O diálogo mostrava o briefing bruto e um contador de caracteres; nada
 * respondia "este material dá um site?". Quem opera descobria que o briefing
 * era raso só depois da geração. Aqui a resposta é calculada a partir do que
 * o painel já sabe — o texto, os anexos marcados e as fotos de banco — e vira
 * uma faixa de selos no topo do diálogo, com a dica de como completar.
 *
 * São heurísticas, não leitura do conteúdo: um briefing curto pode bastar e
 * um longo pode ser vazio. Por isso os itens avisam, nunca bloqueiam.
 */

/** Abaixo disto o briefing costuma não ter serviços, diferenciais e público. */
export const SHORT_BRIEF_CHARS = 800;

export type AssessmentKey =
  | "briefing"
  | "contact"
  | "photos"
  | "logo"
  | "stock"
  | "notes"
  | "signature";

export type AssessmentStatus = "ok" | "warn" | "neutral";

export type AssessmentItem = {
  key: AssessmentKey;
  status: AssessmentStatus;
  /** O selo: curto, com o número quando ele diz algo. */
  label: string;
  /** Como completar — só nos itens que avisam. */
  hint?: string;
};

export type Assessment = {
  items: AssessmentItem[];
  /** Quantos itens pedem atenção. */
  warnings: number;
  /** Dois ou mais avisos: o material é raso e vale completar antes. */
  shallow: boolean;
  /** Uma frase para o rodapé, ao lado do botão de gerar. */
  summary: string;
};

/** Telefone com DDD, "whatsapp" ou um e-mail, em qualquer lugar do texto. */
const CONTACT = /(\(?\d{2}\)?\s?9?\d{4}[-\s.]?\d{4})|whats?app|zap|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** O arquivo da logo, pelo nome: "logo.png", "Logotipo Final.ai", "marca.svg". */
export const looksLikeLogo = (file: Pick<BuildFile, "name" | "kind">) =>
  file.kind === "image" && /\b(logo|logotipo|logomarca|marca|brand)\b/i.test(file.name.normalize("NFC"));

export function assessBriefing({
  pkg,
  prompt,
  observations,
  selected,
  stockCount,
}: {
  pkg: BuildPackage;
  /** O briefing como está na caixa (editável). */
  prompt: string;
  observations: string;
  selected: ReadonlySet<string>;
  stockCount: number;
}): Assessment {
  const items: AssessmentItem[] = [];
  const briefing = prompt.trim();
  const notas = observations.trim();
  const texto = `${briefing}\n${notas}`;
  const marcados = pkg.files.filter((file) => selected.has(file.id));

  // ---- Briefing ----------------------------------------------------------
  if (!briefing) {
    items.push({
      key: "briefing",
      status: "warn",
      label: "Sem briefing",
      hint: "Descreva o site nas observações: empresa, serviços, público e tom.",
    });
  } else if (briefing.length < SHORT_BRIEF_CHARS) {
    items.push({
      key: "briefing",
      status: "warn",
      label: `Briefing curto · ${pluralize(briefing.length, "caractere")}`,
      hint: "Complemente nas observações o que o cliente não escreveu: serviços, diferenciais, público, região.",
    });
  } else {
    items.push({
      key: "briefing",
      status: "ok",
      label: `Briefing · ${pluralize(briefing.length, "caractere")}`,
    });
  }

  // ---- Contato -----------------------------------------------------------
  items.push(
    CONTACT.test(texto)
      ? { key: "contact", status: "ok", label: "Contato no texto" }
      : {
          key: "contact",
          status: "warn",
          label: "Sem telefone ou e-mail",
          hint: "Informe nas observações o WhatsApp e o e-mail que o site deve mostrar.",
        },
  );

  // ---- Fotos do cliente ----------------------------------------------------
  const imagens = marcados.filter((file) => file.kind === "image").length;
  const compactados = marcados.filter((file) => file.kind === "archive").length;
  if (imagens + compactados > 0) {
    const partes = [
      imagens > 0 ? pluralize(imagens, "imagem", "imagens") : null,
      compactados > 0 ? pluralize(compactados, "compactado") : null,
    ].filter(Boolean);
    items.push({ key: "photos", status: "ok", label: `Fotos do cliente · ${partes.join(", ")}` });
  } else if (stockCount > 0) {
    items.push({ key: "photos", status: "neutral", label: "Sem fotos do cliente" });
  } else {
    items.push({
      key: "photos",
      status: "warn",
      label: "Sem fotos",
      hint: "Marque imagens ou compactados do Drive, ou busque fotos no banco de imagens.",
    });
  }

  // ---- Logo ----------------------------------------------------------------
  if (marcados.some(looksLikeLogo)) {
    items.push({ key: "logo", status: "ok", label: "Logo marcada" });
  } else if (pkg.files.some((file) => looksLikeLogo(file) && !file.blockedReason)) {
    items.push({
      key: "logo",
      status: "warn",
      label: "Logo não marcada",
      hint: "Há um arquivo que parece ser a logo do cliente — marque-o nos anexos.",
    });
  } else {
    items.push({
      key: "logo",
      status: "warn",
      label: "Sem logo",
      hint: "Nenhum anexo parece ser a logo. Peça ao cliente ou diga nas observações como tratar a marca.",
    });
  }

  // ---- Banco de imagens --------------------------------------------------
  if (stockCount > 0) {
    items.push({ key: "stock", status: "ok", label: `Banco de imagens · ${pluralize(stockCount, "foto")}` });
  }

  // ---- Assinatura ------------------------------------------------------------
  items.push(
    pkg.signature.missing.length === 0
      ? { key: "signature", status: "ok", label: "Assinatura Joinvix" }
      : {
          key: "signature",
          status: "warn",
          label: "Assinatura incompleta",
          hint: `Falta ${pkg.signature.missing.map((v) => `“Rodapé ${v}”`).join(" e ")}: o painel não baixou do joinvix-footer. Se gerar assim, o build da publicação insere a assinatura no fim da página.`,
        },
  );

  // ---- Observações: contadas por último, porque a dica depende do resto -----
  const avisosAteAqui = items.filter((item) => item.status === "warn").length;
  if (notas) {
    items.push({ key: "notes", status: "ok", label: `Observações · ${pluralize(notas.length, "caractere")}` });
  } else if (avisosAteAqui > 0) {
    items.push({
      key: "notes",
      status: "warn",
      label: "Sem observações",
      hint: "Use as observações para completar o que falta — elas vão ao Lovable depois do briefing.",
    });
  } else {
    items.push({ key: "notes", status: "neutral", label: "Sem observações" });
  }

  const warnings = items.filter((item) => item.status === "warn").length;
  const faltando = items.filter((item) => item.status === "warn").map((item) => item.label.toLowerCase());
  return {
    items,
    warnings,
    shallow: warnings >= 2,
    summary:
      warnings === 0
        ? "Material completo para gerar."
        : `${pluralize(warnings, "ponto")} a completar antes de gerar: ${faltando.join(", ")}.`,
  };
}
