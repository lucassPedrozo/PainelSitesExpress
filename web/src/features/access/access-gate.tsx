import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import joinvixMark from "@/assets/joinvix-mark.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccessGateProps = {
  message?: string;
  onSubmit: (token: string) => Promise<void>;
};

/**
 * Só aparece quando `PANEL_ACCESS_TOKEN` está definido no servidor — isto é,
 * quando o painel foi aberto para a rede local.
 */
export function AccessGate({ message, onSubmit }: AccessGateProps) {
  const [token, setToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setIsSubmitting(true);
    await onSubmit(token.trim()).finally(() => setIsSubmitting(false));
  };

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img
            src={joinvixMark}
            alt="Joinvix"
            width={213}
            height={218}
            className="mx-auto size-11"
          />
          <CardTitle className="mt-2">Painel Gerenciador</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use a sua chave de acesso. Ela não fica guardada no navegador: o
            painel a troca por uma sessão e a descarta.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="access-token">Chave de acesso</Label>
              <div className="relative">
                <KeyRound className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="access-token"
                  type="password"
                  autoComplete="current-password"
                  className="pl-8"
                  placeholder="Informe a chave do painel"
                  value={token}
                  aria-invalid={Boolean(message)}
                  aria-describedby={message ? "access-error" : undefined}
                  autoFocus
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <p
                id="access-error"
                className="min-h-4 text-xs text-destructive"
                aria-live="polite"
              >
                {message ?? " "}
              </p>
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={!token.trim() || isSubmitting}
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting ? "Validando..." : "Acessar painel"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
