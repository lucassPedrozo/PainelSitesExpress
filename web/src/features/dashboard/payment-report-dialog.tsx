import { useMemo, useState } from "react";
import { Download, PenLine, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatDate, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyNotice } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ETAPAS, toneClass, type Etapa } from "@/features/projects/stage";
import type { DashboardRow, DeveloperStats } from "./dashboard-metrics";
import {
  REPORT_ETAPAS,
  buildReport,
  reportCsv,
  reportDateLabels,
  reportFileName,
  reportTotals,
  type ReportDateField,
  type ReportFilters,
} from "./payment-report";

const TODOS = "__todos__";
const DATE_FIELDS: ReportDateField[] = ["delivered", "live", "generated", "received"];

/**
 * O relatório para o pagamento dos desenvolvedores: escolher as etapas (e,
 * se quiser, o desenvolvedor e o período), conferir na tela — os sites e o
 * total de cada um — e baixar a planilha. O que está na tela é o que vai no
 * arquivo.
 */
export function PaymentReportDialog({
  open,
  onOpenChange,
  rows,
  developers,
  tagName,
  now,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: DashboardRow[];
  /** Os desenvolvedores do "Por desenvolvedor" — as opções do filtro. */
  developers: DeveloperStats[];
  tagName: (id: string) => string | undefined;
  now: number;
}) {
  const [filtros, setFiltros] = useState<ReportFilters>({
    etapas: ["cliente", "publicacao"],
    developer: null,
    from: "",
    to: "",
    dateField: "delivered",
    onePerDomain: true,
    includeFinished: false,
  });
  const mudar = (patch: Partial<ReportFilters>) => setFiltros((atual) => ({ ...atual, ...patch }));

  const resultado = useMemo(() => buildReport(rows, filtros, tagName), [rows, filtros, tagName]);
  const totais = useMemo(() => reportTotals(resultado.rows), [resultado.rows]);
  // Quantos há em cada etapa com o desenvolvedor e o período escolhidos — o
  // número no botão de cada etapa.
  const porEtapa = useMemo(() => {
    const todos = buildReport(rows, { ...filtros, etapas: REPORT_ETAPAS }, tagName).rows;
    return new Map(REPORT_ETAPAS.map((etapa) => [etapa, todos.filter((linha) => linha.etapa === etapa).length]));
  }, [rows, filtros, tagName]);
  const manuais = resultado.rows.filter((linha) => linha.manual).length;
  const comPeriodo = Boolean(filtros.from || filtros.to);
  const periodoInvertido = Boolean(filtros.from && filtros.to && filtros.from > filtros.to);

  const alternarEtapa = (etapa: Etapa) =>
    mudar({
      etapas: filtros.etapas.includes(etapa) ? filtros.etapas.filter((item) => item !== etapa) : [...filtros.etapas, etapa],
    });

  const baixar = () => {
    const arquivo = new Blob([reportCsv(resultado.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(filtros, now);
    document.body.append(link);
    link.click();
    link.remove();
    // O navegador já começou o download; a URL pode ir embora logo depois.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Relatório baixado: ${pluralize(resultado.rows.length, "site")}`, { description: link.download });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="sectioned" className="h-dialog-tall sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Relatório para pagamento</DialogTitle>
          <DialogDescription>
            Os sites nas etapas escolhidas, com quem fez cada um e as datas de cada passo. Confira os totais antes de
            baixar: o que está aqui é o que vai na planilha.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Etapas</legend>
            <div className="flex flex-wrap gap-2">
              {REPORT_ETAPAS.map((etapa) => {
                const ligada = filtros.etapas.includes(etapa);
                const Icon = ETAPAS[etapa].icon;
                return (
                  <button
                    key={etapa}
                    type="button"
                    aria-pressed={ligada}
                    title={ETAPAS[etapa].hint}
                    onClick={() => alternarEtapa(etapa)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-ui font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:h-11",
                      ligada
                        ? cn("border-transparent", toneClass[ETAPAS[etapa].tone].soft)
                        : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {ETAPAS[etapa].label}
                    <span className="tabular-nums opacity-80">{porEtapa.get(etapa) ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="relatorio-dev">Desenvolvedor</Label>
              <Select value={filtros.developer ?? TODOS} onValueChange={(valor) => mudar({ developer: valor === TODOS ? null : valor })}>
                <SelectTrigger id="relatorio-dev" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os desenvolvedores</SelectItem>
                  {developers.map((dev) => (
                    <SelectItem key={dev.key} value={dev.key}>
                      {dev.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Período (opcional)</legend>
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="relatorio-de" className="sr-only">
                  De
                </Label>
                <Input
                  id="relatorio-de"
                  type="date"
                  value={filtros.from}
                  onChange={(event) => mudar({ from: event.target.value })}
                  className="w-40"
                  aria-describedby="relatorio-periodo-ajuda"
                />
                <span className="text-sm text-muted-foreground">até</span>
                <Label htmlFor="relatorio-ate" className="sr-only">
                  Até
                </Label>
                <Input
                  id="relatorio-ate"
                  type="date"
                  value={filtros.to}
                  onChange={(event) => mudar({ to: event.target.value })}
                  className="w-40"
                  aria-describedby="relatorio-periodo-ajuda"
                />
                <span className="text-sm text-muted-foreground">pela data de</span>
                <Select value={filtros.dateField} onValueChange={(valor) => mudar({ dateField: valor as ReportDateField })}>
                  <SelectTrigger className="w-44" aria-label="Data usada no período">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FIELDS.map((campo) => (
                      <SelectItem key={campo} value={campo}>
                        {reportDateLabels[campo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {comPeriodo && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => mudar({ from: "", to: "" })}>
                    Limpar período
                  </Button>
                )}
              </div>
              <p id="relatorio-periodo-ajuda" className="text-xs text-muted-foreground">
                {comPeriodo
                  ? `Entram os sites com ${reportDateLabels[filtros.dateField].toLowerCase()} dentro do período, os dois dias inclusos.`
                  : "Sem período: todos os sites que estão hoje nas etapas escolhidas."}
              </p>
            </fieldset>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="relatorio-dominio"
              checked={filtros.onePerDomain}
              onCheckedChange={(valor) => mudar({ onePerDomain: valor })}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="relatorio-dominio">Um site por domínio</Label>
              <p className="text-xs text-muted-foreground">
                Quando o cliente preencheu o formulário de novo, o mesmo site aparece em duas coletas. Ligado, entra a
                coleta onde o site foi feito.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="relatorio-finalizados"
              checked={filtros.includeFinished}
              onCheckedChange={(valor) => mudar({ includeFinished: valor })}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="relatorio-finalizados">Incluir os finalizados</Label>
              <p className="text-xs text-muted-foreground">
                Os projetos com a tag “Finalizado” em geral já foram pagos. Ligado, entram também, marcados na planilha.
              </p>
            </div>
          </div>

          {(periodoInvertido || resultado.duplicates > 0 || resultado.withoutDate > 0 || resultado.finished > 0 || manuais > 0) && (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                <ul className="space-y-0.5">
                  {periodoInvertido && <li>A data inicial é depois da final: nenhum site cabe no período.</li>}
                  {resultado.duplicates > 0 && (
                    <li>
                      {pluralize(resultado.duplicates, "coleta repetida ficou", "coletas repetidas ficaram")} de fora: o
                      domínio já está no relatório.
                    </li>
                  )}
                  {resultado.finished > 0 && (
                    <li>
                      {pluralize(resultado.finished, "finalizado ficou", "finalizados ficaram")} de fora — ligue
                      “Incluir os finalizados” para vê-{resultado.finished === 1 ? "lo" : "los"}.
                    </li>
                  )}
                  {resultado.withoutDate > 0 && (
                    <li>
                      {pluralize(resultado.withoutDate, "site ficou", "sites ficaram")} de fora por não ter{" "}
                      {reportDateLabels[filtros.dateField].toLowerCase()}.
                    </li>
                  )}
                  {manuais > 0 && (
                    <li>
                      {pluralize(manuais, "site está", "sites estão")} na etapa por escolha à mão (marcados com o lápis):
                      confira antes de pagar.
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {totais.length > 0 && (
            <section aria-labelledby="relatorio-totais" className="space-y-2">
              <h3 id="relatorio-totais" className="text-sm font-semibold">
                Total por desenvolvedor
              </h3>
              <ul className="flex flex-wrap gap-2">
                {totais.map((total) => (
                  <li key={total.developer} className="rounded-lg border bg-card px-3 py-2 text-sm">
                    <span className="font-medium">{total.developer}</span>
                    <span className="ml-2 font-semibold tabular-nums">{total.total}</span>
                    <span className="block text-xs text-muted-foreground">
                      {REPORT_ETAPAS.filter((etapa) => total.etapas.get(etapa))
                        .map((etapa) => `${total.etapas.get(etapa)} em ${ETAPAS[etapa].label}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {resultado.rows.length === 0 ? (
            <EmptyNotice
              icon={<Download />}
              title={filtros.etapas.length === 0 ? "Escolha ao menos uma etapa" : "Nenhum site com estes filtros"}
              description={
                filtros.etapas.length === 0
                  ? "O relatório lista os sites que estão nas etapas marcadas."
                  : "Troque as etapas, o desenvolvedor ou o período."
              }
              className="rounded-lg border"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-3xl text-sm">
                <caption className="sr-only">Sites do relatório, com o desenvolvedor, a etapa e as datas</caption>
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Site</th>
                    <th scope="col" className="px-3 py-2 font-medium">Desenvolvedor</th>
                    <th scope="col" className="px-3 py-2 font-medium">Etapa</th>
                    <th scope="col" className="px-3 py-2 font-medium">Gerado</th>
                    <th scope="col" className="px-3 py-2 font-medium">Enviado ao cliente</th>
                    <th scope="col" className="px-3 py-2 font-medium">No ar desde</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {resultado.rows.map((linha) => (
                    <tr key={linha.id} className="align-top">
                      <td className="px-3 py-2">
                        <span className="block font-medium">{linha.domain || linha.project}</span>
                        {linha.domain && linha.project !== linha.domain && (
                          <span className="block text-xs text-muted-foreground">{linha.project}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {linha.developer}
                        {linha.responsible && linha.generatedBy && linha.responsible !== linha.generatedBy && (
                          <span className="block text-xs text-muted-foreground">gerado por {linha.generatedBy}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex items-center gap-1 font-medium", toneClass[ETAPAS[linha.etapa].tone].text)}>
                          {linha.etapaLabel}
                          {linha.manual && <PenLine className="size-3" aria-label="definida à mão" />}
                        </span>
                        <span className="block text-xs text-muted-foreground">{linha.situation}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{linha.generatedAt ? formatDate(linha.generatedAt) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {linha.deliveredAt ? formatDate(linha.deliveredAt) : "—"}
                        {linha.deliveredBy && <span className="block text-xs text-muted-foreground">por {linha.deliveredBy}</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{linha.liveAt ? formatDate(linha.liveAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <p className="text-xs text-muted-foreground sm:mr-auto">
            {pluralize(resultado.rows.length, "site")} · a planilha traz também responsável, motor, repositório, link do
            cliente, tags e observação
          </p>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button type="button" disabled={resultado.rows.length === 0} onClick={baixar}>
            <Download />
            Baixar planilha (.csv)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
