import { useMemo, useState } from "react";
import type { PublicationSettings } from "@/lib/api/deploy";
import {
  emptySettings,
  getLastFtpServer,
  hasStoredSettings,
  loadSettings,
  saveSettings,
  type StoredSettings,
} from "./settings-store";

/**
 * Os campos da publicação.
 *
 * O formulário é **derivado**, não copiado: o que a pessoa digitou fica em
 * `typed`, o resto vem do que foi salvo para aquele repositório. Antes um
 * efeito copiava o armazenamento para dentro do estado a cada troca de
 * repositório, e o cuidado para não apagar o que já estava digitado virava uma
 * linha por campo — com um conjunto de "campos sujos" mantido à mão.
 *
 * Esvaziar um campo devolve o controle ao valor salvo, que é o que se espera
 * de um formulário que preenche sozinho.
 *
 * Senha e variáveis de build nunca são salvas: existem só na memória do
 * formulário, e por isso ficam de fora dessa derivação.
 */
export function usePublicationSettings({
  repoFullName,
  defaultFtpHost,
  initialDomain,
  knownDomain,
  knownSettings,
  detectedAutoDeploy,
}: {
  repoFullName: string;
  defaultFtpHost: string;
  /** Domínio vindo da coleta, quando a publicação começou por um projeto. */
  initialDomain?: string;
  /**
   * Domínio que o painel já publicou neste repositório. Vale quando este
   * navegador não guardou nada: o histórico é do painel, não da máquina.
   */
  knownDomain?: string | null;
  /**
   * O que o painel gravou na última configuração deste repositório — vale
   * para qualquer navegador. Ganha do que este navegador guardou, que pode
   * ser mais antigo.
   */
  knownSettings?: Partial<StoredSettings> | null;
  /** Lido do workflow de deploy do repositório: publica a cada push? */
  detectedAutoDeploy?: boolean;
}) {
  const [typed, setTyped] = useState<Partial<PublicationSettings>>(() =>
    initialDomain ? { domain: initialDomain } : {},
  );
  const [ftpPassword, setFtpPassword] = useState("");
  /** Muda a cada gravação, para reler o que acabou de ser salvo. */
  const [savedAt, setSavedAt] = useState(0);

  const stored = useMemo(() => {
    void savedAt;
    return repoFullName && hasStoredSettings(repoFullName)
      ? loadSettings(repoFullName)
      : null;
  }, [repoFullName, savedAt]);

  const settings: PublicationSettings = useMemo(
    () => ({
      ...emptySettings,
      ...(stored ?? {}),
      ...(knownSettings ?? {}),
      domain: stored?.domain || knownDomain || "",
      ftpServer:
        knownSettings?.ftpServer ||
        stored?.ftpServer ||
        getLastFtpServer() ||
        defaultFtpHost,
      // O repositório diz a verdade sobre o gatilho: o que está gravado lá
      // é o que roda, seja quem for que salvou por último.
      autoDeploy:
        detectedAutoDeploy ??
        knownSettings?.autoDeploy ??
        stored?.autoDeploy ??
        false,
      // Não são guardadas: o campo em branco significa "manter o que está no
      // repositório", e a senha é digitada a cada publicação.
      buildEnv: "",
      clearBuildEnv: false,
      ...typed,
      ftpPassword,
    }),
    [stored, typed, ftpPassword, defaultFtpHost, knownDomain, knownSettings, detectedAutoDeploy],
  );

  const update = (patch: Partial<PublicationSettings>) => {
    if ("ftpPassword" in patch) {
      setFtpPassword(patch.ftpPassword ?? "");
    }

    const resto = { ...patch };
    delete resto.ftpPassword;
    if (Object.keys(resto).length === 0) return;

    setTyped((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(resto)) {
        // Campo esvaziado volta a aceitar o valor guardado do repositório.
        if (value === "") delete next[key as keyof PublicationSettings];
        else Object.assign(next, { [key]: value });
      }
      return next;
    });
  };

  /**
   * Guarda o que não é sensível e zera as digitações pendentes: o que foi
   * gravado passa a ser o valor do repositório.
   */
  const persist = () => {
    if (!repoFullName) return;
    saveSettings(repoFullName, {
      domain: settings.domain.trim(),
      ftpServer: settings.ftpServer.trim(),
      ftpLogin: settings.ftpLogin.trim(),
      serverDir: settings.serverDir.trim(),
      protocol: settings.protocol,
      port: settings.port.trim(),
      autoDeploy: settings.autoDeploy,
    });
    setTyped({});
    setSavedAt(Date.now());
  };

  return { settings, update, persist };
}
