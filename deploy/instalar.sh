#!/usr/bin/env bash
#
# Instala o LS Financeiro (Bigcapital + WhatsApp + agente) numa VPS Ubuntu/Debian limpa.
#
# Uso, como root, dentro da pasta do repositório clonado:
#
#   DOMINIO_APP=financeiro.seudominio.com.br \
#   DOMINIO_WHATSAPP=whatsapp.seudominio.com.br \
#   EMAIL_SSL=voce@exemplo.com \
#   ANTHROPIC_API_KEY=sk-ant-... \
#   bash deploy/instalar.sh
#
# Pode ser rodado de novo com segurança: não sobrescreve senhas já geradas.

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.ls.yml"

log() { echo -e "\n\033[1;34m==> $*\033[0m"; }

gerar() { openssl rand -hex "${1:-24}"; }

# Define KEY=VALOR no .env (substitui a linha se existir, senão acrescenta).
definir() {
  local chave="$1" valor="$2"
  if grep -qE "^${chave}=" .env; then
    sed -i "s|^${chave}=.*|${chave}=${valor}|" .env
  else
    echo "${chave}=${valor}" >> .env
  fi
}

# Só define se ainda estiver vazio no .env.
definir_se_vazio() {
  local chave="$1" valor="$2"
  local atual
  atual=$(grep -E "^${chave}=" .env | head -n1 | cut -d= -f2- || true)
  if [ -z "${atual}" ]; then definir "${chave}" "${valor}"; fi
}

ler_env() { grep -E "^$1=" .env | head -n1 | cut -d= -f2-; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (sudo -i)." >&2
  exit 1
fi

log "Instalando Docker (se necessário)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null

log "Preparando o .env"
if [ ! -f .env ]; then
  cp .env.example .env
  cat deploy/env.ls.example >> .env
fi

[ -n "${DOMINIO_APP:-}" ] && definir DOMINIO_APP "${DOMINIO_APP}"
[ -n "${DOMINIO_WHATSAPP:-}" ] && definir DOMINIO_WHATSAPP "${DOMINIO_WHATSAPP}"
[ -n "${EMAIL_SSL:-}" ] && definir EMAIL_SSL "${EMAIL_SSL}"
[ -n "${ANTHROPIC_API_KEY:-}" ] && definir ANTHROPIC_API_KEY "${ANTHROPIC_API_KEY}"

if [[ "$(ler_env DOMINIO_APP)" == *seudominio* || -z "$(ler_env ANTHROPIC_API_KEY)" ]]; then
  echo "Defina DOMINIO_APP, DOMINIO_WHATSAPP, EMAIL_SSL e ANTHROPIC_API_KEY (veja o topo deste script)." >&2
  exit 1
fi

definir BASE_URL "https://$(ler_env DOMINIO_APP)"
definir GOTENBERG_URL "http://gotenberg:3000"
definir GOTENBERG_DOCS_URL "http://server:3000/public/"
definir_se_vazio APP_JWT_SECRET "$(openssl rand -base64 48 | tr -d '\n/+=')"
definir_se_vazio CLICKHOUSE_PASSWORD "$(gerar 24)"
definir_se_vazio GARAGE_RPC_SECRET "$(gerar 32)"
definir_se_vazio GARAGE_ADMIN_TOKEN "$(gerar 24)"
definir_se_vazio EVOLUTION_API_KEY "$(gerar 24)"
definir_se_vazio EVOLUTION_DB_PASSWORD "$(gerar 24)"
definir_se_vazio AGENTE_WEBHOOK_TOKEN "$(gerar 24)"
# Troca as senhas padrão do banco do Bigcapital na primeira instalação.
if [ "$(ler_env DB_PASSWORD)" = "bigcapital" ]; then definir DB_PASSWORD "$(gerar 24)"; fi
if [ "$(ler_env DB_ROOT_PASSWORD)" = "root" ]; then definir DB_ROOT_PASSWORD "$(gerar 24)"; fi
chmod 600 .env

if [ ! -f integrations/agente-whatsapp/usuarios.json ]; then
  cp integrations/agente-whatsapp/usuarios.example.json integrations/agente-whatsapp/usuarios.json
fi

log "Configurando o armazenamento de anexos (Garage)"
if [ -z "$(ler_env S3_ACCESS_KEY_ID)" ]; then
  $COMPOSE up -d garage
  GARAGE="$COMPOSE exec -T garage /garage"
  for _ in $(seq 1 30); do $GARAGE status >/dev/null 2>&1 && break; sleep 2; done
  NODE_ID=$($GARAGE node id -q | cut -d@ -f1)
  $GARAGE layout assign -z dc1 -c 10G "${NODE_ID}" >/dev/null 2>&1 || true
  $GARAGE layout apply --version 1 >/dev/null 2>&1 || true
  SAIDA=$($GARAGE key create bigcapital)
  definir S3_ACCESS_KEY_ID "$(echo "${SAIDA}" | awk '/Key ID/{print $NF}' | head -n1)"
  definir S3_SECRET_ACCESS_KEY "$(echo "${SAIDA}" | awk '/Secret key/{print $NF}' | head -n1)"
  $GARAGE bucket create bigcapital >/dev/null 2>&1 || true
  $GARAGE bucket allow --read --write --owner bigcapital --key bigcapital
fi

log "Construindo e subindo os serviços (a primeira vez demora alguns minutos)"
$COMPOSE up -d --build

log "Pronto"
cat <<EOF

Sistema:   https://$(ler_env DOMINIO_APP)
WhatsApp:  https://$(ler_env DOMINIO_WHATSAPP)/manager   (API key: $(ler_env EVOLUTION_API_KEY))

Próximos passos:
  1. Abra o sistema, crie sua conta e as organizações (empresa e pessoal) com moeda BRL.
  2. Rode:  bash deploy/conectar-whatsapp.sh   e leia o QR code com o celular do bot.
  3. Em cada organização, gere uma API key e preencha integrations/agente-whatsapp/usuarios.json.
  4. Aplique o plano de contas brasileiro:  bash deploy/plano-de-contas.sh <API_KEY> empresa|pessoal
  5. Reinicie o agente:  $COMPOSE restart agente-whatsapp
  6. Depois de criar as contas de todos, bloqueie novos cadastros: SIGNUP_DISABLED=true no .env
     e rode  $COMPOSE up -d server
EOF
