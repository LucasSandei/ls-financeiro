import { readFileSync } from 'node:fs';

/** Uma organização do Bigcapital que o usuário pode usar pelo WhatsApp. */
export interface OrganizacaoUsuario {
  /** Nome curto usado na conversa, ex.: "empresa" ou "pessoal". */
  apelido: string;
  /** API key gerada no Bigcapital (Preferências > API Keys) dessa organização. */
  apiKey: string;
  /** Organização usada quando a mensagem não diz qual é. */
  padrao?: boolean;
}

export interface Usuario {
  /** Número com DDI e DDD, só dígitos. Ex.: 5511999998888 */
  telefone: string;
  nome: string;
  organizacoes: OrganizacaoUsuario[];
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} não definida.`);
  }
  return valor;
}

export const config = {
  porta: Number(process.env.PORT ?? 3100),

  /** URL interna da API do Bigcapital, ex.: http://server:3000/api */
  bigcapitalUrl: (process.env.BIGCAPITAL_API_URL ?? 'http://server:3000/api').replace(/\/$/, ''),

  evolution: {
    url: (process.env.EVOLUTION_API_URL ?? 'http://evolution:8080').replace(/\/$/, ''),
    apiKey: obrigatoria('EVOLUTION_API_KEY'),
    instancia: process.env.EVOLUTION_INSTANCE ?? 'financeiro',
    /** Segredo que o webhook precisa mandar na query (?token=...). */
    webhookToken: obrigatoria('WEBHOOK_TOKEN'),
  },

  claude: {
    modelo: process.env.CLAUDE_MODEL ?? 'claude-opus-5',
    esforco: (process.env.CLAUDE_EFFORT ?? 'low') as 'low' | 'medium' | 'high',
  },

  /** Transcrição de áudio opcional, em qualquer API compatível com /audio/transcriptions (Groq, OpenAI...). */
  transcricao: {
    url: process.env.TRANSCRIPTION_API_URL,
    apiKey: process.env.TRANSCRIPTION_API_KEY,
    modelo: process.env.TRANSCRIPTION_MODEL ?? 'whisper-large-v3',
  },

  fusoHorario: process.env.TZ ?? 'America/Sao_Paulo',
  arquivoUsuarios: process.env.USUARIOS_FILE ?? './usuarios.json',
};

export function carregarUsuarios(): Map<string, Usuario> {
  const lista = JSON.parse(readFileSync(config.arquivoUsuarios, 'utf8')) as Usuario[];
  const mapa = new Map<string, Usuario>();
  for (const usuario of lista) {
    if (!usuario.organizacoes?.length) {
      throw new Error(`Usuário ${usuario.nome} não tem nenhuma organização configurada.`);
    }
    mapa.set(usuario.telefone.replace(/\D/g, ''), usuario);
  }
  return mapa;
}
