#!/usr/bin/env bash
#
# Cria a instância do WhatsApp na Evolution API, liga o webhook do agente
# e mostra o QR code para conectar o número do bot.
#
# Uso: bash deploy/conectar-whatsapp.sh

set -euo pipefail
cd "$(dirname "$0")/.."

ler_env() { grep -E "^$1=" .env | head -n1 | cut -d= -f2-; }

URL="https://$(ler_env DOMINIO_WHATSAPP)"
KEY="$(ler_env EVOLUTION_API_KEY)"
INSTANCIA="$(ler_env EVOLUTION_INSTANCE)"
INSTANCIA="${INSTANCIA:-financeiro}"
WEBHOOK="http://agente-whatsapp:3100/webhook?token=$(ler_env AGENTE_WEBHOOK_TOKEN)"

api() {
  curl -fsS -X "$1" "${URL}$2" -H "apikey: ${KEY}" -H 'Content-Type: application/json' ${3:+-d "$3"}
}

if ! api GET "/instance/fetchInstances?instanceName=${INSTANCIA}" | grep -q "\"${INSTANCIA}\""; then
  echo "==> Criando a instância ${INSTANCIA}"
  api POST /instance/create "{\"instanceName\":\"${INSTANCIA}\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}" >/dev/null
fi

echo "==> Ligando o webhook do agente"
api POST "/webhook/set/${INSTANCIA}" "{\"webhook\":{\"enabled\":true,\"url\":\"${WEBHOOK}\",\"byEvents\":false,\"base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}}" >/dev/null

ESTADO=$(api GET "/instance/connectionState/${INSTANCIA}" | grep -o '"state":"[a-z]*"' | cut -d'"' -f4)
if [ "${ESTADO}" = "open" ]; then
  echo "==> WhatsApp já está conectado."
  exit 0
fi

echo "==> Leia o QR code abaixo em: WhatsApp > Aparelhos conectados > Conectar aparelho"
CODIGO=$(api GET "/instance/connect/${INSTANCIA}" | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
if command -v qrencode >/dev/null 2>&1 || apt-get install -y qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "${CODIGO}"
else
  echo "Não consegui desenhar o QR aqui. Abra ${URL}/manager, entre com a API key ${KEY} e conecte por lá."
fi
echo "O QR expira em cerca de 40 segundos. Se expirar, rode o script de novo."
