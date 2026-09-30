#!/usr/bin/env bash
#
# Aplica o plano de contas brasileiro numa organização.
# Uso: bash deploy/plano-de-contas.sh <API_KEY_DA_ORGANIZACAO> empresa|pessoal
#
# A API key é gerada no sistema em Preferências > API Keys, com a organização aberta.

set -euo pipefail
cd "$(dirname "$0")/.."
docker compose -f docker-compose.prod.yml -f docker-compose.ls.yml \
  exec -T agente-whatsapp node dist/plano-de-contas.js "$1" "$2"
