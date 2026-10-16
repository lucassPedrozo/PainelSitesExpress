# Garante a assinatura Joinvix no site publicado.
# O agente do Lovable coloca a assinatura no rodape quando segue a Workspace
# Knowledge; quando nao coloca, este passo insere uma faixa com a logo no fim
# da pagina. Nenhum site sai sem ela. A logo e copiada para dentro do site:
# nada e carregado de fora em tempo de execucao.
#
# Em todo site, com a assinatura vinda do agente ou inserida aqui, a logo fica
# com a mesma altura: 45px no desktop e 36px no celular. Quem garante e uma
# regra de CSS posta no <head> de cada pagina, que vale por cima do que o
# site tiver definido.
set -euo pipefail

dist_dir="${DIST_DIR:-dist}"
logo_url="${JOINVIX_SIGNATURE_LOGO_URL:-https://cdn.jsdelivr.net/gh/Sites-profissionais/joinvix-footer@main/joinvix-footer-main/assets/logo-dark.png}"
logo_file="joinvix-assinatura.png"
# A versao branca da logo, para quando o rodape do site e escuro.
logo_light_url="${JOINVIX_SIGNATURE_LOGO_LIGHT_URL:-https://cdn.jsdelivr.net/gh/Sites-profissionais/joinvix-footer@main/joinvix-footer-main/assets/logo-light.png}"
logo_light_file="joinvix-assinatura-clara.png"

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [ ! -d "$dist_dir" ]; then
  echo "::warning::Pasta de build nao encontrada ($dist_dir); assinatura nao conferida."
  exit 0
fi

# A altura da logo, igual em todo site. Alcanca a imagem dentro do link da
# assinatura, onde quer que o agente a tenha posto, e a faixa inserida abaixo.
# O link vale com ou sem o ".br" (joinvix.com.br ou joinvix.com).
size_rule='<style id="joinvix-assinatura-tamanho">a[href*="joinvix.com"] img,#joinvix-assinatura img{height:45px!important;width:auto!important;max-width:none!important;max-height:none!important}@media (max-width:767px){a[href*="joinvix.com"] img,#joinvix-assinatura img{height:36px!important}}</style>'

apply_size() {
  local sized=0 page tmp
  while IFS= read -r -d '' page; do
    if grep -q 'joinvix-assinatura-tamanho' "$page" || ! grep -qi '</head>' "$page"; then
      continue
    fi
    tmp="$(mktemp)"
    RULE="$size_rule" awk 'BEGIN { done = 0 }
      !done && tolower($0) ~ /<\/head>/ {
        i = index(tolower($0), "</head>")
        print substr($0, 1, i - 1) ENVIRON["RULE"] substr($0, i)
        done = 1
        next
      }
      { print }' "$page" > "$tmp"
    mv "$tmp" "$page"
    sized=$((sized + 1))
  done < <(find "$dist_dir" -name '*.html' -print0)
  echo "Altura da logo Joinvix (45px no desktop, 36px no celular) aplicada em $sized pagina(s)."
}

# O link da assinatura aparece no HTML ou no bundle JS do React, com ou sem o
# ".br": um rodape que ja tem a logo com link para joinvix.com nao pode ganhar
# uma segunda faixa embaixo.
if grep -rqiE 'joinvix\.com' "$dist_dir" --include='*.html' --include='*.js'; then
  echo "Assinatura Joinvix presente no site."
  summary "Assinatura Joinvix: presente no site."
  apply_size
  exit 0
fi

# Logo: arquivo local (testes) ou o repositorio joinvix-footer.
if [ -n "${JOINVIX_SIGNATURE_LOGO_FILE:-}" ]; then
  cp "$JOINVIX_SIGNATURE_LOGO_FILE" "$dist_dir/$logo_file"
  cp "$JOINVIX_SIGNATURE_LOGO_FILE" "$dist_dir/$logo_light_file"
elif ! curl -fsSL --retry 2 --max-time 30 -o "$dist_dir/$logo_file" "$logo_url"; then
  echo "::warning::Nao foi possivel baixar a logo da assinatura Joinvix; o site segue sem ela."
  summary "Assinatura Joinvix: AUSENTE (logo indisponivel no build)."
  exit 0
fi

# A logo branca e opcional: sem ela a faixa continua clara, com a logo escura.
if [ ! -f "$dist_dir/$logo_light_file" ]; then
  curl -fsSL --retry 2 --max-time 30 -o "$dist_dir/$logo_light_file" "$logo_light_url" || rm -f "$dist_dir/$logo_light_file"
fi

# A faixa nasce clara e, com a pagina aberta, toma a cor do rodape do site:
# le o fundo do ultimo <footer> (ou do corpo da pagina) e troca a logo pela
# branca quando ele e escuro. Uma faixa branca colada num rodape escuro
# destoava do site. O rodape de um site em React so existe depois de montado,
# por isso a leitura se repete por alguns segundos.
block='<div id="joinvix-assinatura" style="width:100%;background:#ffffff;padding:14px 16px;box-sizing:border-box;display:flex;justify-content:center"><a href="https://www.joinvix.com.br/" target="_blank" rel="noopener noreferrer" style="display:inline-block"><img src="./joinvix-assinatura.png" data-clara="./joinvix-assinatura-clara.png" alt="Joinvix" width="315" height="45" loading="lazy" style="height:45px;width:auto;display:block"></a></div><script>(function(){var f=document.getElementById("joinvix-assinatura");if(!f)return;var i=f.querySelector("img"),e=i.getAttribute("src"),c=i.getAttribute("data-clara"),n=0;function cor(el){for(;el&&el.nodeType===1;el=el.parentElement){var p=(getComputedStyle(el).backgroundColor.match(/[0-9.]+/g)||[]).map(Number);if(p.length>=3&&(p.length<4||p[3]>0.5))return p}return null}function aplicar(){var r=document.querySelectorAll("footer"),p=cor(r.length?r[r.length-1]:document.body);if(p){f.style.background="rgb("+p[0]+","+p[1]+","+p[2]+")";var escuro=0.2126*p[0]+0.7152*p[1]+0.0722*p[2]<140;i.onerror=function(){i.onerror=null;i.src=e;f.style.background="#ffffff"};i.src=escuro&&c?c:e}if(++n<20&&!r.length)setTimeout(aplicar,300)}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",aplicar);else aplicar();window.addEventListener("load",aplicar)})();</script>'

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

apply_size

echo "::notice::O site nao tinha a assinatura Joinvix; ela foi inserida no fim da pagina ($inserted arquivo(s))."
summary "Assinatura Joinvix: inserida pelo build em $inserted arquivo(s) HTML."
