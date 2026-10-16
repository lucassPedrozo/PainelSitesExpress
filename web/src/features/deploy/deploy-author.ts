import type { Publication } from "@/lib/api/deploy";
import { timeOf } from "@/lib/format";

/**
 * Um disparo e o envio que ficou no ar são o mesmo evento quando estão a
 * poucos minutos um do outro: o GitHub cria a execução segundos depois do
 * disparo, e o "último envio" é a hora em que ela foi criada.
 */
const MESMO_ENVIO_MS = 10 * 60_000;

/**
 * Quem fez o envio que está no ar, quando dá para saber.
 *
 * "último envio" vem da execução que terminou bem (de qualquer origem: um
 * push do Lovable também publica); o autor vem do registro de disparos do
 * painel. Antes a linha juntava a data de um com o autor do outro — uma
 * simulação de hoje assinava o envio de semana passada. Agora o autor só
 * aparece quando o disparo real mais recente é esse mesmo envio.
 */
export function deployAuthor(item: Publication): string | null {
  const envio = timeOf(item.lastDeployAt);
  if (envio === null) return null;

  const run = item.lastRun;
  const execucao = timeOf(run?.at);
  if (run?.event === "push" && execucao !== null && Math.abs(execucao - envio) <= MESMO_ENVIO_MS) {
    return "edição no Lovable";
  }

  const real = item.deploys?.find((deploy) => !deploy.dryRun);
  if (!real?.by) return null;
  const disparo = timeOf(real.at);
  if (disparo !== null && Math.abs(disparo - envio) <= MESMO_ENVIO_MS) return real.by;

  // A execução mais recente veio do painel, terminou bem e o último disparo
  // não foi simulação: é o envio que está no ar, mesmo com relógios
  // desencontrados entre o painel e o GitHub.
  const ultimo = item.deploys?.[0];
  if (
    run?.event === "workflow_dispatch" &&
    run.status === "success" &&
    ultimo?.dryRun === false &&
    ultimo.by
  ) {
    return ultimo.by;
  }
  return null;
}
