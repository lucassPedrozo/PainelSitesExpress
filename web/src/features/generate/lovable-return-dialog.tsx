import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { useLovableConnection } from "./use-lovable";

type Connection = ReturnType<typeof useLovableConnection>;

/**
 * "Concluir a conexão": aberta logo depois de mandar a pessoa autorizar no
 * Lovable. É a mesma tela no localhost e na rede local.
 *
 * O Lovable só devolve o navegador a `http://localhost:<porta>`. Na máquina do
 * painel esse retorno conclui tudo sozinho, e esta janela percebe (o status é
 * conferido a cada 3 s) e se fecha. De outro computador, a aba de retorno não
 * abre — lá não há painel nessa porta —, mas o endereço dela carrega o código
 * da autorização: colado aqui, o painel conclui a conexão do mesmo jeito.
 */
export function LovableReturnDialog({ connection }: { connection: Connection }) {
  const { awaitingReturn, setAwaitingReturn, status, completeFromUrl } = connection;
  const [url, setUrl] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const concluida = Boolean(status?.connected) && (status?.missingScopes.length ?? 0) === 0;

  // O rascunho some quando a janela fecha — inclusive quando fecha sozinha,
  // porque a conexão foi concluída (isso é decidido em useLovableConnection).
  const [aberta, setAberta] = useState(awaitingReturn);
  if (aberta !== awaitingReturn) {
    setAberta(awaitingReturn);
    setUrl("");
    setErro(null);
  }

  const fechar = (aberto: boolean) => {
    if (!aberto) setAwaitingReturn(false);
  };

  const concluir = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await completeFromUrl(url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível concluir a conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={awaitingReturn} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Concluir a conexão com o Lovable</DialogTitle>
          <DialogDescription>
            Autorize o painel na aba do Lovable que acabou de abrir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-muted-foreground">
            {concluida ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <Loader2 className="size-4 animate-spin" />
            )}
            {concluida
              ? "Conectado."
              : "Aguardando a autorização — esta janela fecha sozinha quando o retorno chegar."}
          </div>

          <div className="space-y-2">
            <p>
              Depois de autorizar, a aba de retorno abriu uma página que{" "}
              <strong>não carrega</strong> (endereço começando com{" "}
              <code className="rounded bg-muted px-1 text-xs">http://localhost</code>)? Isso
              acontece quando o painel é usado de outro computador. Copie o endereço inteiro
              dessa aba e cole aqui:
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3333/api/lovable/callback?code=…&state=…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(erro)}
            />
            {erro && <p className="text-xs text-destructive">{erro}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => fechar(false)}>
            Fechar
          </Button>
          <Button onClick={() => void concluir()} disabled={!url.trim() || enviando}>
            {enviando && <Loader2 className="size-4 animate-spin" />}
            Concluir com este endereço
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
