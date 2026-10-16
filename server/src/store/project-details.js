import { findDomain } from "../../../shared/domain.js";
import { MANUAL_STAGES, MAX_NOTE, MAX_RESPONSIBLE } from "../../../shared/project-fields.js";
import { httpError } from "../http.js";
import { flush, read } from "./db.js";

/* ------------------------------------------------------------------ *
 * O que a equipe corrige à mão num projeto
 *
 * O painel calcula o domínio (do nome da pasta), a data de recebimento (da
 * criação da pasta) e a etapa (do que aconteceu de fato). Quando o cálculo
 * erra — a pasta nasceu com o nome errado, o site foi publicado fora do
 * painel —, quem opera corrige aqui. Cada campo ausente volta ao cálculo.
 *
 * A etapa manual guarda quando e por quem foi escolhida: a interface só a
 * respeita enquanto nada mais novo acontecer no projeto (gerar, enviar,
 * publicar). O responsável e a observação interna são só do painel.
 *
 * Ocultar tira o projeto da lista de trabalho, dos contadores, do Dashboard e
 * do relatório — pasta de teste, coleta que não vai virar site. Ele continua
 * no Drive e volta com "Mostrar".
 * ------------------------------------------------------------------ */

/** Uma data à frente do relógio é erro de digitação; um dia de folga cobre o fuso. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60_000;

/**
 * @typedef {{
 *   domain?: string,
 *   receivedAt?: string,
 *   responsible?: string,
 *   note?: string,
 *   stage?: { etapa: string, at: string, by: string | null },
 *   hidden?: { at: string, by: string | null },
 * }} ProjectDetails
 */

/** @returns {Promise<Record<string, ProjectDetails>>} */
export async function listProjectDetails() {
  const { details } = await read();
  return details;
}

const text = (value) => String(value ?? "").trim();
const has = (patch, key) => Object.prototype.hasOwnProperty.call(patch, key);

/**
 * Aplica as mudanças de `patch`: cada campo presente é gravado, e vazio
 * (`""` ou `null`) volta ao cálculo do painel. Campo ausente não muda.
 * Tudo é conferido antes de gravar: um campo inválido não deixa os outros
 * pela metade.
 *
 * @param {string} projectId
 * @param {Record<string, unknown>} patch
 * @param {{ by?: string | null, now?: Date }} [options]
 * @returns {Promise<ProjectDetails | null>}
 */
export async function updateProjectDetails(projectId, patch, { by = null, now = new Date() } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw httpError(400, "Envie os campos a mudar.");
  }

  /** @type {Partial<Record<keyof ProjectDetails, unknown>>} */
  const next = {};

  if (has(patch, "domain")) {
    const valor = text(patch.domain);
    if (valor) {
      const found = findDomain(valor);
      if (!found?.exact) throw httpError(400, "Domínio inválido. Use só o endereço, como cliente.com.br.");
      next.domain = found.domain;
    } else next.domain = null;
  }

  if (has(patch, "receivedAt")) {
    const valor = text(patch.receivedAt);
    if (valor) {
      const time = Date.parse(valor);
      if (!Number.isFinite(time)) throw httpError(400, "Data de recebimento inválida.");
      if (time > now.getTime() + FUTURE_TOLERANCE_MS) {
        throw httpError(400, "A data de recebimento não pode estar no futuro.");
      }
      next.receivedAt = new Date(time).toISOString();
    } else next.receivedAt = null;
  }

  if (has(patch, "responsible")) {
    const valor = text(patch.responsible);
    if (valor.length > MAX_RESPONSIBLE) throw httpError(400, `Responsável muito longo (máx. ${MAX_RESPONSIBLE}).`);
    next.responsible = valor || null;
  }

  if (has(patch, "note")) {
    const valor = text(patch.note);
    if (valor.length > MAX_NOTE) throw httpError(400, `Observação muito longa (máx. ${MAX_NOTE} caracteres).`);
    next.note = valor || null;
  }

  if (has(patch, "stage")) {
    const valor = text(patch.stage);
    if (valor && !/** @type {string[]} */ (MANUAL_STAGES).includes(valor)) throw httpError(400, "Etapa desconhecida.");
    next.stage = valor ? { etapa: valor, at: now.toISOString(), by: by ?? null } : null;
  }

  if (has(patch, "hidden")) {
    if (typeof patch.hidden !== "boolean" && patch.hidden !== null) throw httpError(400, "Ocultar é sim ou não.");
    next.hidden = patch.hidden ? { at: now.toISOString(), by: by ?? null } : null;
  }

  const data = await read();
  const atual = { ...(data.details[projectId] ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (value === null) delete atual[key];
    else atual[key] = value;
  }

  if (Object.keys(atual).length > 0) data.details[projectId] = atual;
  else delete data.details[projectId];

  await flush();
  return data.details[projectId] ?? null;
}
