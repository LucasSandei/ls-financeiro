import { createServer } from 'node:http';
import { responder, type EntradaUsuario } from './agente.ts';
import { carregarUsuarios, config } from './config.ts';
import { enfileirar, obterSessao } from './estado.ts';
import { baixarMidia, enviarTexto, interpretarWebhook, type MensagemRecebida } from './evolution.ts';
import { transcrever, transcricaoAtiva } from './transcricao.ts';

const usuarios = carregarUsuarios();
/** Ids de mensagens já processadas, porque a Evolution API pode reenviar o mesmo evento. */
const processadas = new Set<string>();

async function tratarMensagem(mensagem: MensagemRecebida): Promise<void> {
  const usuario = usuarios.get(mensagem.telefone);
  if (!usuario) {
    console.warn(`[webhook] mensagem de número não cadastrado: ${mensagem.telefone}`);
    return;
  }
  const sessao = obterSessao(mensagem.telefone);

  await enfileirar(sessao, async () => {
    try {
      const entrada: EntradaUsuario = { texto: mensagem.texto };

      if (mensagem.midia) {
        const dados = await baixarMidia(mensagem);
        if (mensagem.midia.tipo === 'audio') {
          if (!transcricaoAtiva()) {
            await enviarTexto(mensagem.telefone, 'Ainda não entendo áudio. Pode mandar por texto?');
            return;
          }
          const transcricao = await transcrever(dados, mensagem.midia.mimeType);
          entrada.texto = transcricao;
          entrada.observacao = 'O usuário mandou um áudio; o texto abaixo é a transcrição automática.';
        } else {
          const extensao = mensagem.midia.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
          entrada.arquivo = {
            dados,
            mimeType: mensagem.midia.mimeType,
            nome: mensagem.midia.nomeArquivo ?? `comprovante-${mensagem.id}.${extensao}`,
          };
        }
      }

      const resposta = await responder(usuario, sessao, entrada);
      await enviarTexto(mensagem.telefone, resposta);
    } catch (erro) {
      console.error('[agente] erro ao processar mensagem:', erro);
      await enviarTexto(mensagem.telefone, 'Tive um problema para processar isso agora. Tenta de novo em instantes?').catch(
        () => {},
      );
    }
  });
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/saude') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, usuarios: usuarios.size }));
    return;
  }

  // A Evolution API pode acrescentar o nome do evento ao caminho (webhook_by_events), por isso startsWith.
  if (req.method === 'POST' && url.pathname.startsWith('/webhook')) {
    if (url.searchParams.get('token') !== config.evolution.webhookToken) {
      res.writeHead(401).end();
      return;
    }
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      // Responde logo para a Evolution API não reenviar o evento enquanto o agente pensa.
      res.writeHead(200).end();
      try {
        const mensagem = interpretarWebhook(JSON.parse(Buffer.concat(partes).toString('utf8')));
        if (!mensagem || processadas.has(mensagem.id)) return;
        processadas.add(mensagem.id);
        if (processadas.size > 5000) processadas.clear();
        void tratarMensagem(mensagem);
      } catch (erro) {
        console.error('[webhook] corpo inválido:', erro);
      }
    });
    return;
  }

  res.writeHead(404).end();
});

servidor.listen(config.porta, () => {
  console.log(`Agente de WhatsApp ouvindo na porta ${config.porta} com ${usuarios.size} usuário(s).`);
});
