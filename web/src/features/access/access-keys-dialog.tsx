import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AccessPermission, AccessUser } from "@/lib/api";
import {
  ACCESS_PERMISSIONS,
  createAccessKey,
  fetchAccessKeys,
  revokeAccessKey,
  setAccessKeyPermissions,
} from "@/lib/api";
import { PERMISSION_LABELS } from "@/lib/permissions";
import { queryKeys } from "@/lib/query";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDateTime, relativeTime } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Uma fileira de permissões — a mesma no formulário de criação e em cada chave
 * já existente, para o que se marca ao criar ser lido do mesmo jeito depois.
 */
function PermissionToggles({
  value,
  onChange,
  disabled = false,
  idPrefix,
  detailed = false,
}: {
  value: AccessPermission[];
  onChange: (permissions: AccessPermission[]) => void;
  disabled?: boolean;
  idPrefix: string;
  /** Com a explicação de cada permissão à vista — ao criar uma chave. */
  detailed?: boolean;
}) {
  return (
    <div className={detailed ? "grid gap-2 sm:grid-cols-2" : "flex flex-wrap gap-x-4 gap-y-1.5"}>
      {ACCESS_PERMISSIONS.map((permission) => {
        const { title, hint } = PERMISSION_LABELS[permission];
        const id = `${idPrefix}-${permission}`;
        const on = value.includes(permission);
        return (
          <div
            key={permission}
            className={detailed ? "flex items-start gap-2 rounded-lg border p-2.5" : "flex items-center gap-1.5"}
          >
            <Checkbox
              id={id}
              className={detailed ? "mt-0.5" : undefined}
              checked={on}
              disabled={disabled}
              onCheckedChange={(marcado) =>
                onChange(
                  marcado === true
                    ? [...value, permission]
                    : value.filter((item) => item !== permission),
                )
              }
            />
            {detailed ? (
              <Label htmlFor={id} className="cursor-pointer flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs leading-snug font-normal text-muted-foreground">{hint}</span>
              </Label>
            ) : (
              <Label htmlFor={id} title={hint} className="cursor-pointer text-xs font-normal">
                {title}
              </Label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Chaves de acesso, uma por pessoa.
 *
 * Antes havia uma chave só, no `.env`: quem saía obrigava a trocar a de todos,
 * e o painel não sabia quem tinha entrado. Aqui cada pessoa tem a sua, com data
 * do último acesso, e revogar uma **encerra as sessões dela na hora**.
 *
 * Cada chave carrega o que pode fazer. Ver os projetos, os arquivos e os
 * briefings não é uma permissão: é a base de qualquer acesso, e uma chave sem
 * isso não serviria para nada. O que se marca aqui é o direito de mudar coisas.
 *
 * A chave em claro aparece uma única vez — o painel guarda apenas o hash.
 */
export function AccessKeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* A chave zera o formulário e a chave recém-criada ao fechar, sem
            precisar de um efeito que limpe estado depois da renderização. */}
        <AccessKeysManager key={open ? "aberto" : "fechado"} open={open} />
      </DialogContent>
    </Dialog>
  );
}

function AccessKeysManager({ open }: { open: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [creating, setCreating] = useState(false);
  /** Chave sendo salva agora — evita dois cliques em sequência na mesma linha. */
  const [saving, setSaving] = useState<string | null>(null);
  /** Chave recém-criada, exibida até o diálogo fechar. */
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);

  const {
    data: users = [],
    isPending,
    error,
  } = useQuery({
    queryKey: queryKeys.accessKeys,
    queryFn: async () => (await fetchAccessKeys()).users,
    enabled: open,
    // Quem administra costuma abrir a tela para conferir o último acesso.
    staleTime: 0,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.accessKeys });

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const alvo = name.trim();
    if (!alvo) return;

    setCreating(true);
    try {
      const { key } = await createAccessKey(alvo, permissions);
      setFresh({ name: alvo, key });
      setName("");
      setPermissions([]);
      await refresh();
    } catch (err) {
      toast.error("Não foi possível criar a chave", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCreating(false);
    }
  };

  /**
   * A troca aparece na hora e é desfeita se o servidor recusar: esperar a
   * resposta para marcar a caixa fazia o clique parecer perdido.
   */
  const changePermissions = async (
    user: AccessUser,
    proximas: AccessPermission[],
  ) => {
    const anteriores = user.permissions;
    const patch = (lista: AccessPermission[]) =>
      queryClient.setQueryData<AccessUser[]>(queryKeys.accessKeys, (current) =>
        current?.map((item) =>
          item.id === user.id ? { ...item, permissions: lista } : item,
        ),
      );

    patch(proximas);
    setSaving(user.id);
    try {
      await setAccessKeyPermissions(user.id, proximas);
      // A pessoa pode estar mudando as próprias permissões.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    } catch (err) {
      patch(anteriores);
      toast.error(`Não foi possível mudar as permissões de ${user.name}`, {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(null);
    }
  };

  const revoke = async (user: AccessUser) => {
    try {
      const { sessionsClosed } = await revokeAccessKey(user.id);
      toast.success(`Chave de ${user.name} revogada`, {
        description: sessionsClosed
          ? `${sessionsClosed} sessão(ões) encerrada(s) agora.`
          : "Nenhuma sessão estava aberta.",
      });
      await refresh();
    } catch (err) {
      toast.error("Não foi possível revogar", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const copy = async (key: string) => {
    const ok = await copyToClipboard(key);
    if (ok) toast.success("Chave copiada");
    else toast.error("Não foi possível copiar");
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          Chaves de acesso
        </DialogTitle>
        <DialogDescription>
          Uma chave por pessoa. Toda chave vê os projetos, os arquivos e os
          briefings; o que se marca abaixo é o que ela pode <em>mudar</em>.
          Revogar corta o acesso na hora, sem afetar as outras.
        </DialogDescription>
      </DialogHeader>

      {fresh && (
        <Alert>
          <KeyRound />
          <AlertTitle>Chave de {fresh.name}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Copie agora: o painel guarda apenas o hash, e esta chave não será
              mostrada de novo.
            </p>
            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {fresh.key}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => copy(fresh.key)}
                aria-label="Copiar chave"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={create} className="space-y-2">
        <Label htmlFor="access-name">Nome de quem vai usar</Label>
        <div className="flex gap-2">
          <Input
            id="access-name"
            autoComplete="off"
            placeholder="Ana, Bruno, notebook da recepção…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || creating}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Criar
          </Button>
        </div>
        <PermissionToggles
          idPrefix="nova"
          detailed
          value={permissions}
          onChange={setPermissions}
          disabled={creating}
        />
      </form>

      <div className="overflow-hidden rounded-lg border">
        {isPending ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Carregando…
          </p>
        ) : error ? (
          /* Na própria lista, e não num toast: o erro é sobre o que deveria
             estar ali, e o toast some antes de alguém agir. */
          <div className="space-y-2 px-4 py-6 text-center text-sm">
            <p className="text-muted-foreground">
              Não foi possível listar as chaves. {(error as Error).message}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              Tentar novamente
            </Button>
          </div>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma chave criada. Enquanto isso, vale a chave do{" "}
            <code>.env</code> — a do administrador.
          </p>
        ) : (
          <ul className="divide-y">
            {users.map((user) => (
              <li key={user.id} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.lastSeenAt ? (
                        <span title={formatDateTime(user.lastSeenAt)}>
                          último acesso {relativeTime(user.lastSeenAt)}
                        </span>
                      ) : (
                        "ainda não usou"
                      )}
                    </p>
                  </div>
                  {saving === user.id && (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    onClick={() => revoke(user)}
                    aria-label={`Revogar a chave de ${user.name}`}
                    title={`Revogar a chave de ${user.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <PermissionToggles
                  idPrefix={user.id}
                  value={user.permissions}
                  onChange={(proximas) => changePermissions(user, proximas)}
                  disabled={saving === user.id}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
