if [ -n "$FTP_PROTOCOL" ]; then
  echo "protocol=$FTP_PROTOCOL" >> "$GITHUB_OUTPUT"
  echo "Protocolo definido manualmente: $FTP_PROTOCOL"
  if [ "$FTP_PROTOCOL" = "ftp" ]; then
    echo "::warning::FTP simples escolhido no painel: o envio (inclusive a senha) trafega sem criptografia."
  fi
  exit 0
fi

# Modo automatico: exige FTPS explicito e nunca cai sozinho para FTP
# simples, que mandaria a senha sem criptografia. Antes qualquer falha
# do teste (timeout, rede instavel, certificado) virava envio em texto
# puro com um simples aviso; agora a publicacao para e diz o que
# escolher no painel.
#
# --insecure: o teste so confirma que o servidor aceita AUTH TLS. O
# envio usa o modo padrao do FTP-Deploy-Action, que tambem nao valida
# o certificado (comum em hospedagem compartilhada), mas criptografa.
# As credenciais vao pela stdin do curl para nao aparecerem na lista
# de processos do runner.
escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

status=0
printf 'user = "%s:%s"\n' "$(escape "$FTP_LOGIN")" "$(escape "$FTP_PASSWORD")" \
  | curl --config - --ssl-reqd --insecure --connect-timeout 15 --max-time 30 --silent --show-error \
    "ftp://$FTP_SERVER:$FTP_PORT/" --output /dev/null \
  || status=$?

case "$status" in
  0)
    echo "protocol=ftps" >> "$GITHUB_OUTPUT"
    echo "FTPS explicito disponivel; o envio sera criptografado."
    ;;
  64)
    echo "::error::O servidor nao aceita FTPS explicito (AUTH TLS). Se ele usa FTPS implicito (porta 990), escolha 'FTPS implicito' nas opcoes avancadas do painel. Para publicar sem criptografia, escolha 'FTP simples' explicitamente."
    exit 1
    ;;
  67)
    echo "::error::O servidor FTP recusou o login. Confira usuario e senha na configuracao do repositorio pelo painel."
    exit 1
    ;;
  6|7|28)
    echo "::error::Nao foi possivel conectar a $FTP_SERVER:$FTP_PORT (curl $status). Confira servidor e porta, ou tente de novo."
    exit 1
    ;;
  *)
    echo "::error::Falha ao negociar FTPS com o servidor (curl $status). Escolha o protocolo explicitamente nas opcoes avancadas do painel."
    exit 1
    ;;
esac
