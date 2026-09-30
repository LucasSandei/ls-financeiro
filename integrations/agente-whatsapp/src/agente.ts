import Anthropic from '@anthropic-ai/sdk';
import { Bigcapital, ErroBigcapital } from './bigcapital.ts';
import { config, type Usuario } from './config.ts';
import { novoRascunhoId, type Arquivo, type Rascunho, type Sessao } from './estado.ts';

const client = new Anthropic();

const MAX_ITERACOES = 8;

const SYSTEM = `Você é o assistente financeiro do sistema LS Financeiro, conversando pelo WhatsApp.
Seu trabalho é registrar despesas e receitas no sistema e responder perguntas sobre as finanças do usuário.

Como registrar um lançamento:
1. Descubra valor, data, descrição, categoria e conta de pagamento ou recebimento. A mensagem pode ser texto livre ("almoço 45 no nubank"), a transcrição de um áudio, a foto de um cupom fiscal ou um PDF (boleto, nota, recibo).
2. Use consultar_contas para ver as categorias e contas reais daquela organização e escolha a mais adequada pelo nome. Nunca invente ids.
3. Chame preparar_lancamento. Se a mensagem trouxe foto ou PDF de comprovante, use anexar_comprovante = true.
4. Mostre o resumo ao usuário e peça confirmação. Só chame confirmar_lancamento depois que o usuário responder confirmando (ex.: "ok", "sim", "pode lançar"). Se ele corrigir algo, prepare um novo rascunho e descarte o antigo.

Regras:
- Se a data não for dita, use a data de hoje. "Ontem", "sexta passada" etc. são relativos à data de hoje informada no contexto.
- Valores estão em reais. "45", "45,90", "R$ 45" são valores em reais.
- Se faltar informação essencial que você não consegue deduzir (por exemplo, a conta de pagamento e existem várias), pergunte de forma curta, oferecendo as opções.
- O usuário pode ter mais de uma organização (ex.: "empresa" e "pessoal"). Use a padrão, a não ser que ele diga outra ou o contexto deixe claro (ex.: "mercado de casa" vai para a pessoal, se existir).
- Uma foto pode ter vários itens; lance como um único lançamento pelo total, com uma descrição que resuma a compra.
- Responda em português do Brasil, curto e direto, no estilo de uma conversa de WhatsApp. Use *negrito* do WhatsApp com moderação e não use tabelas ou títulos em markdown.
- Formate valores como R$ 1.234,56 e datas como 24/09/2026.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'consultar_contas',
    description:
      'Lista as contas de pagamento/recebimento (caixa, bancos, cartões) e as categorias de despesa e de receita de uma organização, com seus ids.',
    input_schema: {
      type: 'object',
      properties: {
        organizacao: { type: 'string', description: 'Apelido da organização, ex.: "empresa" ou "pessoal".' },
      },
      required: ['organizacao'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'preparar_lancamento',
    description:
      'Cria um rascunho de despesa ou receita e devolve o resumo para mostrar ao usuário. Nada é gravado no sistema até confirmar_lancamento.',
    input_schema: {
      type: 'object',
      properties: {
        organizacao: { type: 'string' },
        tipo: { type: 'string', enum: ['despesa', 'receita'] },
        valor: { type: 'number', description: 'Valor em reais, positivo.' },
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD.' },
        descricao: { type: 'string', description: 'Descrição curta, ex.: "Almoço - Restaurante Sabor".' },
        categoria_id: { type: 'integer', description: 'Id da categoria de despesa ou de receita.' },
        conta_id: { type: 'integer', description: 'Id da conta de onde o dinheiro saiu ou para onde entrou.' },
        referencia: { type: ['string', 'null'], description: 'Número do documento (nota, cupom, boleto), se houver.' },
        anexar_comprovante: { type: 'boolean', description: 'Anexar a última foto ou PDF recebido.' },
      },
      required: ['organizacao', 'tipo', 'valor', 'data', 'descricao', 'categoria_id', 'conta_id', 'referencia', 'anexar_comprovante'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'confirmar_lancamento',
    description: 'Grava no sistema um rascunho que o usuário já confirmou numa mensagem posterior ao resumo.',
    input_schema: {
      type: 'object',
      properties: { rascunho_id: { type: 'integer' } },
      required: ['rascunho_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'descartar_lancamento',
    description: 'Descarta um rascunho que o usuário cancelou ou que foi substituído por outro.',
    input_schema: {
      type: 'object',
      properties: { rascunho_id: { type: 'integer' } },
      required: ['rascunho_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'ultimas_despesas',
    description: 'Lista as despesas mais recentes da organização.',
    input_schema: {
      type: 'object',
      properties: {
        organizacao: { type: 'string' },
        quantidade: { type: 'integer', description: 'Entre 1 e 30.' },
      },
      required: ['organizacao', 'quantidade'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'resumo_periodo',
    description:
      'Demonstrativo de resultado (receitas, despesas por categoria e lucro) de um período. Use para perguntas como "quanto gastei com alimentação este mês?".',
    input_schema: {
      type: 'object',
      properties: {
        organizacao: { type: 'string' },
        data_inicio: { type: 'string', description: 'AAAA-MM-DD' },
        data_fim: { type: 'string', description: 'AAAA-MM-DD' },
      },
      required: ['organizacao', 'data_inicio', 'data_fim'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'saldos',
    description: 'Saldo atual de cada conta de caixa, banco e cartão da organização.',
    input_schema: {
      type: 'object',
      properties: { organizacao: { type: 'string' } },
      required: ['organizacao'],
      additionalProperties: false,
    },
    strict: true,
  },
];

export interface EntradaUsuario {
  texto: string;
  /** Imagem ou PDF para o modelo ler. */
  arquivo?: Arquivo;
  /** Aviso extra para o modelo, ex.: "o usuário mandou um áudio, transcrição: ...". */
  observacao?: string;
}

function hojeFormatado(): string {
  const agora = new Date();
  const data = new Intl.DateTimeFormat('en-CA', { timeZone: config.fusoHorario }).format(agora); // AAAA-MM-DD
  const diaSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: config.fusoHorario, weekday: 'long' }).format(agora);
  return `${data} (${diaSemana})`;
}

const formatarReais = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function descreverRascunho(r: Rascunho): string {
  const [ano, mes, dia] = r.data.split('-');
  return [
    `Rascunho #${r.id} (${r.organizacao})`,
    `${r.tipo === 'despesa' ? 'Despesa' : 'Receita'} de ${formatarReais(r.valor)} em ${dia}/${mes}/${ano}`,
    `Descrição: ${r.descricao}`,
    `Categoria: ${r.categoriaNome}`,
    `${r.tipo === 'despesa' ? 'Pago com' : 'Recebido em'}: ${r.contaNome}`,
    r.referencia ? `Documento: ${r.referencia}` : null,
    r.anexo ? 'Comprovante anexado' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Contexto que muda a cada turno. Vai na mensagem do usuário para não quebrar o cache do system prompt. */
function contextoDoTurno(usuario: Usuario, sessao: Sessao): string {
  const organizacoes = usuario.organizacoes
    .map((o) => `"${o.apelido}"${o.padrao ? ' (padrão)' : ''}`)
    .join(', ');
  const pendentes = [...sessao.rascunhos.values()].map(descreverRascunho).join('\n\n');
  return [
    `[Contexto] Hoje: ${hojeFormatado()}. Usuário: ${usuario.nome}. Organizações: ${organizacoes}.`,
    pendentes ? `Rascunhos pendentes de confirmação:\n${pendentes}` : 'Nenhum rascunho pendente.',
  ].join('\n');
}

function blocoDoArquivo(arquivo: Arquivo): Anthropic.Beta.BetaContentBlockParam | null {
  const base64 = arquivo.dados.toString('base64');
  const tipo = arquivo.mimeType.split(';')[0];
  if (tipo === 'image/jpeg' || tipo === 'image/png' || tipo === 'image/gif' || tipo === 'image/webp') {
    return { type: 'image', source: { type: 'base64', media_type: tipo, data: base64 } };
  }
  if (tipo === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  if (tipo.startsWith('text/') || tipo.endsWith('xml') || tipo === 'application/json') {
    // XML de NF-e, CSV, etc.
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: arquivo.dados.toString('utf8') } };
  }
  return null;
}

export class Ferramentas {
  private readonly usuario: Usuario;
  private readonly sessao: Sessao;

  constructor(usuario: Usuario, sessao: Sessao) {
    this.usuario = usuario;
    this.sessao = sessao;
  }

  private cliente(apelido: string): { bigcapital: Bigcapital; apelido: string } {
    const org =
      this.usuario.organizacoes.find((o) => o.apelido.toLowerCase() === apelido.toLowerCase().trim()) ??
      null;
    if (!org) {
      const nomes = this.usuario.organizacoes.map((o) => o.apelido).join(', ');
      throw new Error(`Organização "${apelido}" não existe. Opções: ${nomes}.`);
    }
    return { bigcapital: new Bigcapital(org.apiKey), apelido: org.apelido };
  }

  async executar(nome: string, entrada: Record<string, any>): Promise<string> {
    switch (nome) {
      case 'consultar_contas': {
        const { bigcapital } = this.cliente(entrada.organizacao);
        const contas = await bigcapital.contas();
        const listar = (lista: { id: number; name: string; account_type: string }[]) =>
          lista.map((c) => ({ id: c.id, nome: c.name, tipo: c.account_type }));
        return JSON.stringify({
          contas_de_pagamento_ou_recebimento: listar(contas.pagamento),
          categorias_de_despesa: listar(contas.despesa),
          categorias_de_receita: listar(contas.receita),
        });
      }

      case 'preparar_lancamento': {
        const { bigcapital, apelido } = this.cliente(entrada.organizacao);
        const contas = await bigcapital.contas();
        const tipo = entrada.tipo as 'despesa' | 'receita';
        const categorias = tipo === 'despesa' ? contas.despesa : contas.receita;
        const categoria = categorias.find((c) => c.id === entrada.categoria_id);
        const conta = contas.pagamento.find((c) => c.id === entrada.conta_id);
        if (!categoria) return `Erro: categoria_id ${entrada.categoria_id} não é uma categoria de ${tipo} válida. Use consultar_contas.`;
        if (!conta) return `Erro: conta_id ${entrada.conta_id} não é uma conta de caixa, banco ou cartão. Use consultar_contas.`;
        if (!(entrada.valor > 0)) return 'Erro: o valor precisa ser maior que zero.';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data)) return 'Erro: data deve estar no formato AAAA-MM-DD.';
        if (entrada.anexar_comprovante && !this.sessao.ultimoArquivo) {
          return 'Erro: não há comprovante recebido nesta conversa para anexar. Use anexar_comprovante = false.';
        }

        const rascunho: Rascunho = {
          id: novoRascunhoId(),
          organizacao: apelido,
          tipo,
          valor: Math.round(entrada.valor * 100) / 100,
          data: entrada.data,
          descricao: entrada.descricao,
          categoriaId: categoria.id,
          categoriaNome: categoria.name,
          contaId: conta.id,
          contaNome: conta.name,
          referencia: entrada.referencia ?? undefined,
          anexo: entrada.anexar_comprovante ? this.sessao.ultimoArquivo : undefined,
          turno: this.sessao.turno,
        };
        this.sessao.rascunhos.set(rascunho.id, rascunho);
        return `${descreverRascunho(rascunho)}\n\nMostre este resumo e peça confirmação ao usuário.`;
      }

      case 'confirmar_lancamento': {
        const rascunho = this.sessao.rascunhos.get(entrada.rascunho_id);
        if (!rascunho) return `Erro: rascunho #${entrada.rascunho_id} não existe ou já foi lançado.`;
        // Proteção: a confirmação precisa vir de uma mensagem do usuário depois do resumo.
        if (rascunho.turno >= this.sessao.turno) {
          return 'Erro: o usuário ainda não viu este resumo. Mostre o resumo e espere ele confirmar.';
        }
        const { bigcapital } = this.cliente(rascunho.organizacao);
        const anexoKey = rascunho.anexo ? await bigcapital.enviarAnexo(rascunho.anexo) : undefined;
        const criado =
          rascunho.tipo === 'despesa'
            ? await bigcapital.criarDespesa({
                data: rascunho.data,
                valor: rascunho.valor,
                contaPagamentoId: rascunho.contaId,
                categoriaId: rascunho.categoriaId,
                descricao: rascunho.descricao,
                referencia: rascunho.referencia,
                anexoKey,
              })
            : await bigcapital.criarReceita({
                data: rascunho.data,
                valor: rascunho.valor,
                contaRecebimentoId: rascunho.contaId,
                categoriaId: rascunho.categoriaId,
                descricao: rascunho.descricao,
                referencia: rascunho.referencia,
              });
        this.sessao.rascunhos.delete(rascunho.id);
        const avisoAnexo =
          rascunho.tipo === 'receita' && rascunho.anexo ? ' (receitas ainda não recebem anexo pelo WhatsApp)' : '';
        return `Lançado com sucesso. Id no sistema: ${criado.id ?? 'ok'}${avisoAnexo}.`;
      }

      case 'descartar_lancamento': {
        const existia = this.sessao.rascunhos.delete(entrada.rascunho_id);
        return existia ? 'Rascunho descartado.' : 'Esse rascunho já não existia.';
      }

      case 'ultimas_despesas': {
        const { bigcapital } = this.cliente(entrada.organizacao);
        const quantidade = Math.min(Math.max(entrada.quantidade ?? 10, 1), 30);
        return JSON.stringify(await bigcapital.ultimasDespesas(quantidade));
      }

      case 'resumo_periodo': {
        const { bigcapital } = this.cliente(entrada.organizacao);
        return JSON.stringify(await bigcapital.resultado(entrada.data_inicio, entrada.data_fim));
      }

      case 'saldos': {
        const { bigcapital } = this.cliente(entrada.organizacao);
        return JSON.stringify(await bigcapital.saldos());
      }

      default:
        return `Erro: ferramenta ${nome} desconhecida.`;
    }
  }
}

/** Processa uma mensagem do usuário e devolve o texto da resposta. */
export async function responder(usuario: Usuario, sessao: Sessao, entrada: EntradaUsuario): Promise<string> {
  sessao.turno += 1;

  const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (entrada.arquivo) {
    sessao.ultimoArquivo = entrada.arquivo;
    const bloco = blocoDoArquivo(entrada.arquivo);
    if (bloco) conteudo.push(bloco);
  }
  const partes = [contextoDoTurno(usuario, sessao)];
  if (entrada.observacao) partes.push(entrada.observacao);
  partes.push(entrada.texto ? `Mensagem: ${entrada.texto}` : 'Mensagem: (sem texto, só o arquivo)');
  conteudo.push({ type: 'text', text: partes.join('\n\n') });
  sessao.historico.push({ role: 'user', content: conteudo });

  const ferramentas = new Ferramentas(usuario, sessao);

  for (let i = 0; i < MAX_ITERACOES; i++) {
    const resposta = await client.beta.messages.create({
      model: config.claude.modelo,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: config.claude.esforco },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM,
      tools: TOOLS,
      messages: sessao.historico,
    });

    if (resposta.stop_reason === 'refusal') {
      // Descarta o turno recusado para não contaminar a conversa.
      sessao.historico = [];
      return 'Não consegui processar essa mensagem. Pode reformular?';
    }

    sessao.historico.push({ role: 'assistant', content: resposta.content });

    const chamadas = resposta.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (resposta.stop_reason !== 'tool_use' || chamadas.length === 0) {
      const texto = resposta.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return texto || 'Certo.';
    }

    const resultados = await Promise.all(
      chamadas.map(async (chamada): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const saida = await ferramentas.executar(chamada.name, chamada.input as Record<string, any>);
          return { type: 'tool_result', tool_use_id: chamada.id, content: saida, is_error: saida.startsWith('Erro:') };
        } catch (erro) {
          const mensagem =
            erro instanceof ErroBigcapital
              ? `O sistema financeiro recusou a operação (${erro.status}): ${erro.corpo}`
              : erro instanceof Error
                ? erro.message
                : String(erro);
          console.error(`[agente] ferramenta ${chamada.name} falhou:`, mensagem);
          return { type: 'tool_result', tool_use_id: chamada.id, content: mensagem, is_error: true };
        }
      }),
    );
    sessao.historico.push({ role: 'user', content: resultados });
  }

  return 'Essa ficou complicada para mim. Pode mandar de novo, com menos coisas de uma vez?';
}
