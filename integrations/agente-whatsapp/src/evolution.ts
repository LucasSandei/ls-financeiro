import { config } from './config.ts';

/**
 * Integração com a Evolution API v2 (WhatsApp).
 * Docs: https://doc.evolution-api.com
 */

export type TipoMidia = 'imagem' | 'documento' | 'audio';

export interface MensagemRecebida {
  id: string;
  /** Telefone do remetente, só dígitos (ex.: 5511999998888). */
  telefone: string;
  nome?: string;
  texto: string;
  midia?: {
    tipo: TipoMidia;
    mimeType: string;
    nomeArquivo?: string;
    /** Conteúdo já em base64 quando o webhook está com "base64" ligado. */
    base64?: string;
  };
}

interface WebhookEvolution {
  event?: string;
  data?: {
    key?: {
      id?: string;
      remoteJid?: string;
      remoteJidAlt?: string;
      senderPn?: string;
      fromMe?: boolean;
    };
    pushName?: string;
    messageType?: string;
    message?: Record<string, any> & { base64?: string };
  };
}

function soDigitos(jid: string | undefined): string | undefined {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return undefined;
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Converte o corpo do webhook numa mensagem que o agente entende, ou null se for para ignorar. */
export function interpretarWebhook(corpo: WebhookEvolution): MensagemRecebida | null {
  const evento = corpo.event?.toLowerCase().replace('_', '.');
  if (evento !== 'messages.upsert' || !corpo.data?.key || !corpo.data.message) return null;

  const { key, message } = corpo.data;
  if (key.fromMe) return null;
  if (key.remoteJid?.endsWith('@g.us')) return null; // ignora grupos

  // Contas novas do WhatsApp podem chegar com remoteJid em formato @lid; o número real vem em senderPn/remoteJidAlt.
  const telefone = soDigitos(key.remoteJid) ?? soDigitos(key.senderPn) ?? soDigitos(key.remoteJidAlt);
  if (!telefone || !key.id) return null;

  // Documento com legenda vem embrulhado.
  const conteudo = message.documentWithCaptionMessage?.message ?? message;

  const texto: string =
    conteudo.conversation ??
    conteudo.extendedTextMessage?.text ??
    conteudo.imageMessage?.caption ??
    conteudo.documentMessage?.caption ??
    '';

  let midia: MensagemRecebida['midia'];
  if (conteudo.imageMessage) {
    midia = { tipo: 'imagem', mimeType: conteudo.imageMessage.mimetype ?? 'image/jpeg' };
  } else if (conteudo.documentMessage) {
    midia = {
      tipo: 'documento',
      mimeType: conteudo.documentMessage.mimetype ?? 'application/pdf',
      nomeArquivo: conteudo.documentMessage.fileName,
    };
  } else if (conteudo.audioMessage) {
    midia = { tipo: 'audio', mimeType: conteudo.audioMessage.mimetype ?? 'audio/ogg' };
  }
  if (midia && message.base64) midia.base64 = message.base64;

  if (!texto && !midia) return null; // figurinhas, reações, etc.

  return { id: key.id, telefone, nome: corpo.data.pushName, texto, midia };
}

async function chamar<T>(caminho: string, corpo: unknown): Promise<T> {
  const resposta = await fetch(`${config.evolution.url}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.evolution.apiKey },
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) {
    throw new Error(`Evolution API ${caminho} respondeu ${resposta.status}: ${await resposta.text()}`);
  }
  return (await resposta.json()) as T;
}

export async function baixarMidia(mensagem: MensagemRecebida): Promise<Buffer> {
  if (mensagem.midia?.base64) return Buffer.from(mensagem.midia.base64, 'base64');
  const resposta = await chamar<{ base64: string }>(
    `/chat/getBase64FromMediaMessage/${config.evolution.instancia}`,
    { message: { key: { id: mensagem.id } }, convertToMp4: false },
  );
  return Buffer.from(resposta.base64, 'base64');
}

export async function enviarTexto(telefone: string, texto: string): Promise<void> {
  await chamar(`/message/sendText/${config.evolution.instancia}`, { number: telefone, text: texto });
}
