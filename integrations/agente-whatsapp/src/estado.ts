import type Anthropic from '@anthropic-ai/sdk';

/**
 * Estado em memória de cada conversa. Reiniciar o serviço zera as conversas e os
 * rascunhos pendentes, o que é aceitável: nada é lançado sem confirmação.
 */

export interface Arquivo {
  dados: Buffer;
  mimeType: string;
  nome: string;
}

export interface Rascunho {
  id: number;
  organizacao: string;
  tipo: 'despesa' | 'receita';
  valor: number;
  data: string;
  descricao: string;
  categoriaId: number;
  categoriaNome: string;
  contaId: number;
  contaNome: string;
  referencia?: string;
  anexo?: Arquivo;
  /** Turno em que o rascunho foi criado. Só pode ser confirmado num turno posterior. */
  turno: number;
}

export interface Sessao {
  historico: Anthropic.Beta.BetaMessageParam[];
  ultimaAtividade: number;
  turno: number;
  rascunhos: Map<number, Rascunho>;
  /** Último comprovante recebido, para anexar ao próximo lançamento. */
  ultimoArquivo?: Arquivo;
  /** Fila para processar uma mensagem por vez por usuário. */
  fila: Promise<void>;
}

const INATIVIDADE_MS = 30 * 60 * 1000;
const MAX_MENSAGENS_HISTORICO = 40;

const sessoes = new Map<string, Sessao>();
let proximoRascunhoId = 1;

export function obterSessao(telefone: string): Sessao {
  let sessao = sessoes.get(telefone);
  const agora = Date.now();
  if (!sessao) {
    sessao = { historico: [], ultimaAtividade: agora, turno: 0, rascunhos: new Map(), fila: Promise.resolve() };
    sessoes.set(telefone, sessao);
  }
  // Conversa parada ou longa demais recomeça do zero. Os rascunhos continuam
  // e são mostrados ao modelo no contexto de cada turno.
  if (agora - sessao.ultimaAtividade > INATIVIDADE_MS || sessao.historico.length > MAX_MENSAGENS_HISTORICO) {
    sessao.historico = [];
    sessao.ultimoArquivo = undefined;
  }
  sessao.ultimaAtividade = agora;
  return sessao;
}

export function novoRascunhoId(): number {
  return proximoRascunhoId++;
}

/** Enfileira o processamento para que duas mensagens do mesmo usuário não rodem em paralelo. */
export function enfileirar(sessao: Sessao, tarefa: () => Promise<void>): Promise<void> {
  const proxima = sessao.fila.then(tarefa, tarefa);
  sessao.fila = proxima.catch(() => {});
  return proxima;
}
