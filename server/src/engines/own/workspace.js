/**
 * Os arquivos do site em construção, em memória, antes de irem para o GitHub.
 *
 * O caminho de cada arquivo vem do modelo — é saída não confiável. O modelo
 * escreve só o que é conteúdo do site (`src/`, `public/`, `index.html`); a
 * configuração do projeto (package.json, vite.config, lockfiles, workflows)
 * vem do modelo de projeto e não muda. Assim nem um briefing com instrução
 * maliciosa consegue acrescentar dependência com script de instalação nem
 * mexer no workflow que recebe a senha do FTP.
 */

export const LIMITS = {
  maxFiles: 300,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
};

const ALLOWED = [/^src\/[A-Za-z0-9._\-/]+$/, /^public\/[A-Za-z0-9._\-/]+$/, /^index\.html$/];

export class WorkspaceError extends Error {}

/**
 * Normaliza e confere um caminho vindo do modelo.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function safePath(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new WorkspaceError("Caminho vazio.");
  const path = raw.trim().replace(/^\.\//, "");
  if (path.length > 200) throw new WorkspaceError("Caminho longo demais.");
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\\")) {
    throw new WorkspaceError("Use caminho relativo com barras normais.");
  }
  if (path.split("/").some((parte) => parte === ".." || parte === "." || parte === "")) {
    throw new WorkspaceError("Caminho com segmento inválido.");
  }
  if (!ALLOWED.some((padrao) => padrao.test(path))) {
    throw new WorkspaceError(
      "Só dá para escrever em src/, public/ e index.html; a configuração do projeto vem do modelo.",
    );
  }
  return path;
}

export class Workspace {
  /** @param {Record<string, string>} [seed] arquivos do modelo de projeto */
  constructor(seed = {}) {
    /** @type {Map<string, string>} */
    this.files = new Map(Object.entries(seed));
    /** Caminhos que o modelo escreveu ou apagou — o que muda no commit. */
    this.touched = new Set();
  }

  totalBytes() {
    let total = 0;
    for (const content of this.files.values()) total += Buffer.byteLength(content, "utf8");
    return total;
  }

  write(rawPath, content) {
    const path = safePath(rawPath);
    if (typeof content !== "string") throw new WorkspaceError("Conteúdo precisa ser texto.");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > LIMITS.maxFileBytes) throw new WorkspaceError(`Arquivo passa de ${LIMITS.maxFileBytes} bytes.`);
    if (!this.files.has(path) && this.files.size >= LIMITS.maxFiles) {
      throw new WorkspaceError(`O site passa de ${LIMITS.maxFiles} arquivos.`);
    }
    const anterior = this.files.has(path) ? Buffer.byteLength(this.files.get(path), "utf8") : 0;
    if (this.totalBytes() - anterior + bytes > LIMITS.maxTotalBytes) {
      throw new WorkspaceError("O site passa do tamanho total permitido.");
    }
    this.files.set(path, content);
    this.touched.add(path);
    return { path, bytes };
  }

  read(rawPath) {
    // Ler pode ir além do que se escreve: o modelo precisa ver a configuração.
    const path = typeof rawPath === "string" ? rawPath.trim().replace(/^\.\//, "") : "";
    if (!this.files.has(path)) throw new WorkspaceError(`Arquivo não existe: ${path}`);
    return this.files.get(path);
  }

  remove(rawPath) {
    const path = safePath(rawPath);
    if (!this.files.delete(path)) throw new WorkspaceError(`Arquivo não existe: ${path}`);
    this.touched.add(path);
    return { path };
  }

  list() {
    return [...this.files.keys()].sort();
  }
}
