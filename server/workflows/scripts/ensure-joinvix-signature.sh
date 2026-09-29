# Garante a assinatura Joinvix no site publicado.
# O agente do Lovable coloca a assinatura no rodape quando segue a Workspace
# Knowledge; quando nao coloca, este passo insere uma faixa com a logo no fim
# da pagina. Nenhum site sai sem ela. A logo e copiada para dentro do site:
# nada e carregado de fora em tempo de execucao.
set -euo pipefail

dist_dir="${DIST_DIR:-dist}"
logo_url="${JOINVIX_SIGNATURE_LOGO_URL:-https://cdn.jsdelivr.net/gh/Sites-profissionais/joinvix-footer@main/joinvix-footer-main/assets/logo-dark.png}"
logo_file="joinvix-assinatura.png"

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [ ! -d "$dist_dir" ]; then
  echo "::warning::Pasta de build nao encontrada ($dist_dir); assinatura nao conferida."
  exit 0
fi

# O link da assinatura aparece no HTML ou no bundle JS do React.
if grep -rqiE 'joinvix\.com\.br' "$dist_dir" --include='*.html' --include='*.js'; then
  echo "Assinatura Joinvix presente no site."
  summary "Assinatura Joinvix: presente no site."
  exit 0
fi

# Logo: arquivo local (testes) ou o repositorio joinvix-footer.
if [ -n "${JOINVIX_SIGNATURE_LOGO_FILE:-}" ]; then
  cp "$JOINVIX_SIGNATURE_LOGO_FILE" "$dist_dir/$logo_file"
elif ! curl -fsSL --retry 2 --max-time 30 -o "$dist_dir/$logo_file" "$logo_url"; then
  echo "::warning::Nao foi possivel baixar a logo da assinatura Joinvix; o site segue sem ela."
  summary "Assinatura Joinvix: AUSENTE (logo indisponivel no build)."
  exit 0
fi

block='<div id="joinvix-assinatura" style="width:100%;background:#ffffff;border-top:1px solid rgba(0,0,0,0.06);padding:10px 16px;box-sizing:border-box;display:flex;justify-content:center"><a href="https://www.joinvix.com.br/" target="_blank" rel="noopener noreferrer" style="display:inline-block"><img src="./joinvix-assinatura.png" alt="Joinvix" width="175" height="25" loading="lazy" style="height:24px;width:auto;display:block"></a></div>'

inserted=0
while IFS= read -r -d '' page; do
  if grep -qi '</body>' "$page"; then
    tmp="$(mktemp)"
    # Antes do primeiro </body>: depois do #root, no fim da pagina.
    BLOCK="$block" awk 'BEGIN { done = 0 }
      !done && tolower($0) ~ /<\/body>/ {
        i = index(tolower($0), "</body>")
        print substr($0, 1, i - 1) ENVIRON["BLOCK"] substr($0, i)
        done = 1
        next
      }
      { print }' "$page" > "$tmp"
    mv "$tmp" "$page"
    inserted=$((inserted + 1))
  fi
done < <(find "$dist_dir" -maxdepth 1 -name '*.html' -print0)

if [ "$inserted" -eq 0 ]; then
  echo "::warning::Nenhum HTML com </body> em $dist_dir; assinatura nao inserida."
  exit 0
fi

echo "::notice::O site nao tinha a assinatura Joinvix; ela foi inserida no fim da pagina ($inserted arquivo(s))."
summary "Assinatura Joinvix: inserida pelo build em $inserted arquivo(s) HTML."
