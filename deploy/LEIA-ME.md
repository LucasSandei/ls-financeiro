# LS Financeiro: como colocar no ar

Sistema financeiro (fork do Bigcapital) em português, com um agente de WhatsApp que lança despesas e receitas a partir de texto, foto de cupom, PDF ou áudio.

## O que você precisa ter antes

1. **VPS** com Ubuntu 22.04 ou 24.04, **4 GB de RAM** ou mais, 2 vCPUs e 40 GB de disco.
2. **Um domínio** com dois subdomínios apontando (registro A) para o IP da VPS:
   - `financeiro.seudominio.com.br` (o sistema)
   - `whatsapp.seudominio.com.br` (painel do WhatsApp)
3. **Chave da API da Anthropic** (console.anthropic.com > API Keys), com créditos.
4. **Um número de WhatsApp só para o bot** (chip novo ou WhatsApp Business num número que você não usa).
5. Opcional: **chave da Groq** (console.groq.com, gratuita) para o bot entender áudio.

## Passo a passo na VPS

```bash
# 1. Entrar como root e baixar o projeto
sudo -i
git clone https://github.com/LucasSandei/ls-financeiro.git /opt/ls-financeiro
cd /opt/ls-financeiro

# 2. Instalar e subir tudo (demora uns 10 minutos na primeira vez)
DOMINIO_APP=financeiro.seudominio.com.br \
DOMINIO_WHATSAPP=whatsapp.seudominio.com.br \
EMAIL_SSL=seu@email.com \
ANTHROPIC_API_KEY=sk-ant-... \
bash deploy/instalar.sh
```

O script instala o Docker, gera todas as senhas no `.env`, configura o armazenamento de anexos e sobe os serviços com HTTPS automático.

## Depois que subir

1. **Crie sua conta** em `https://financeiro.seudominio.com.br`. Na configuração da organização, escolha a moeda **BRL** e o fuso **America/Sao_Paulo**.
2. **Crie a segunda organização** (uma para a empresa e outra para as finanças pessoais), pelo menu de organizações.
3. **Gere uma API key em cada organização**: com a organização aberta, vá em Preferências > API Keys > Gerar. Copie na hora, porque ela só aparece uma vez.
4. **Aplique o plano de contas brasileiro** em cada uma:
   ```bash
   bash deploy/plano-de-contas.sh <API_KEY_DA_EMPRESA> empresa
   bash deploy/plano-de-contas.sh <API_KEY_PESSOAL> pessoal
   ```
5. **Cadastre quem pode usar o bot** em `integrations/agente-whatsapp/usuarios.json`:
   ```json
   [
     {
       "telefone": "5511999998888",
       "nome": "Lucas",
       "organizacoes": [
         { "apelido": "empresa", "apiKey": "API_KEY_DA_EMPRESA", "padrao": true },
         { "apelido": "pessoal", "apiKey": "API_KEY_PESSOAL" }
       ]
     }
   ]
   ```
   O telefone vai com 55 + DDD + número, só dígitos. Cada amigo entra como mais um item da lista, com as API keys das organizações dele.
6. **Reinicie o agente**:
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.ls.yml restart agente-whatsapp
   ```
7. **Conecte o WhatsApp do bot**:
   ```bash
   bash deploy/conectar-whatsapp.sh
   ```
   Leia o QR code com o celular do número do bot (WhatsApp > Aparelhos conectados).
8. **Feche o cadastro** depois que todos tiverem conta: no `.env`, `SIGNUP_DISABLED=true`, e rode
   `docker compose -f docker-compose.prod.yml -f docker-compose.ls.yml up -d server`.

## Usando o bot

Mande para o número do bot:

- `almoço 45,90 no nubank`
- `paguei 1.200 de aluguel ontem, pessoal`
- uma foto do cupom fiscal, ou o PDF de um boleto ou nota
- um áudio: "gastei cento e vinte no mercado"
- `recebi 3.500 do cliente X no itaú`
- `quanto gastei com alimentação este mês?`
- `qual o saldo das contas?`

O bot sempre mostra um resumo e só lança depois que você responde "ok".

## Custos

- VPS: o valor do plano contratado.
- Claude: centavos por lançamento. O modelo e o nível de esforço ficam no `.env` (`CLAUDE_MODEL`, `CLAUDE_EFFORT`).
- WhatsApp (Evolution API) e transcrição pela Groq: gratuitos.

## Comandos úteis

```bash
cd /opt/ls-financeiro
C="docker compose -f docker-compose.prod.yml -f docker-compose.ls.yml"

$C ps                          # status dos serviços
$C logs -f agente-whatsapp     # ver o que o bot está fazendo
$C logs -f server              # logs do sistema
git pull && $C up -d --build   # atualizar depois de mudanças no repositório
```

## Backup

Os dados ficam em volumes Docker: `mysql` (lançamentos), `garage` (anexos) e `evolution_instances` (sessão do WhatsApp). Faça pelo menos o dump diário do banco:

```bash
$C exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases' | gzip > backup-$(date +%F).sql.gz
```
