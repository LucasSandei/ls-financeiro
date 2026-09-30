import { config } from './config.ts';

export function transcricaoAtiva(): boolean {
  return Boolean(config.transcricao.url && config.transcricao.apiKey);
}

/**
 * Transcreve um áudio do WhatsApp usando qualquer API compatível com o endpoint
 * /audio/transcriptions (ex.: Groq em https://api.groq.com/openai/v1, que tem plano gratuito).
 */
export async function transcrever(audio: Buffer, mimeType: string): Promise<string> {
  const form = new FormData();
  const extensao = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mpeg') ? 'mp3' : 'm4a';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0] }), `audio.${extensao}`);
  form.append('model', config.transcricao.modelo);
  form.append('language', 'pt');

  const url = `${config.transcricao.url!.replace(/\/$/, '')}/audio/transcriptions`;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.transcricao.apiKey}` },
    body: form,
  });
  if (!resposta.ok) {
    throw new Error(`Transcrição falhou (${resposta.status}): ${await resposta.text()}`);
  }
  const { text } = (await resposta.json()) as { text: string };
  return text.trim();
}
