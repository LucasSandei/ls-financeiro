import { config } from './config.ts';

/**
 * Cliente mínimo da API do Bigcapital autenticado por API key.
 * A API key já identifica a organização, então não é preciso mandar o header organization-id.
 * O formato no fio é sempre snake_case (ver SerializeInterceptor do server).
 */

export interface Conta {
  id: number;
  name: string;
  code: string | null;
  account_type: string;
  active: boolean;
}

export interface ContasAgrupadas {
  /** Onde o dinheiro sai ou entra: caixa, banco, cartão de crédito. */
  pagamento: Conta[];
  /** Categorias de despesa. */
  despesa: Conta[];
  /** Categorias de receita. */
  receita: Conta[];
}

export class ErroBigcapital extends Error {
  readonly status: number;
  readonly corpo: string;

  constructor(status: number, corpo: string) {
    super(`Bigcapital respondeu ${status}: ${corpo}`);
    this.status = status;
    this.corpo = corpo;
  }
}

const TIPOS_PAGAMENTO = ['cash', 'bank', 'credit-card'];
const TIPOS_DESPESA = ['expense', 'other-expense', 'cost-of-goods-sold'];
const TIPOS_RECEITA = ['income', 'other-income'];

/** Cache curto das contas por API key, para não buscar o plano de contas a cada mensagem. */
const cacheContas = new Map<string, { expiraEm: number; contas: ContasAgrupadas }>();
const CACHE_MS = 10 * 60 * 1000;

export class Bigcapital {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async requisicao<T>(
    metodo: string,
    caminho: string,
    opcoes: { corpo?: unknown; formData?: FormData; accept?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: opcoes.accept ?? 'application/json',
      'Accept-Language': 'en',
    };
    let body: BodyInit | undefined;
    if (opcoes.formData) {
      body = opcoes.formData;
    } else if (opcoes.corpo !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opcoes.corpo);
    }
    const resposta = await fetch(`${config.bigcapitalUrl}${caminho}`, { method: metodo, headers, body });
    const texto = await resposta.text();
    if (!resposta.ok) {
      throw new ErroBigcapital(resposta.status, texto.slice(0, 2000));
    }
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  async contas(): Promise<ContasAgrupadas> {
    const emCache = cacheContas.get(this.apiKey);
    if (emCache && emCache.expiraEm > Date.now()) return emCache.contas;

    const { accounts } = await this.requisicao<{ accounts: Conta[] }>('GET', '/accounts?structure=flat');
    const ativas = accounts.filter((c) => c.active !== false);
    const contas: ContasAgrupadas = {
      pagamento: ativas.filter((c) => TIPOS_PAGAMENTO.includes(c.account_type)),
      despesa: ativas.filter((c) => TIPOS_DESPESA.includes(c.account_type)),
      receita: ativas.filter((c) => TIPOS_RECEITA.includes(c.account_type)),
    };
    cacheContas.set(this.apiKey, { expiraEm: Date.now() + CACHE_MS, contas });
    return contas;
  }

  /** Todas as contas, sem filtro nem cache. Usado pelo script do plano de contas. */
  async todasContas(): Promise<(Conta & { description: string | null; parent_account_id: number | null })[]> {
    const { accounts } = await this.requisicao<{ accounts: any[] }>('GET', '/accounts?structure=flat');
    return accounts;
  }

  async criarConta(dados: { nome: string; codigo?: string; tipo: string; descricao?: string; paiId?: number }): Promise<{ id: number }> {
    return this.requisicao('POST', '/accounts', {
      corpo: {
        name: dados.nome,
        code: dados.codigo,
        account_type: dados.tipo,
        description: dados.descricao,
        parent_account_id: dados.paiId,
      },
    });
  }

  async editarConta(
    id: number,
    dados: { nome: string; codigo: string | null; tipo: string; descricao: string | null; paiId: number | null },
  ): Promise<void> {
    await this.requisicao('PUT', `/accounts/${id}`, {
      corpo: {
        name: dados.nome,
        code: dados.codigo ?? undefined,
        account_type: dados.tipo,
        description: dados.descricao ?? undefined,
        parent_account_id: dados.paiId ?? undefined,
      },
    });
  }

  /** Envia um arquivo para o storage do Bigcapital e devolve a key para anexar num lançamento. */
  async enviarAnexo(arquivo: { dados: Buffer; mimeType: string; nome: string }): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(arquivo.dados)], { type: arquivo.mimeType }), arquivo.nome);
    const resposta = await this.requisicao<{ data: { key: string } }>('POST', '/attachments', { formData: form });
    return resposta.data.key;
  }

  async criarDespesa(dados: {
    data: string;
    valor: number;
    contaPagamentoId: number;
    categoriaId: number;
    descricao: string;
    referencia?: string;
    anexoKey?: string;
  }): Promise<{ id: number }> {
    const resposta = await this.requisicao<{ id: number }>('POST', '/expenses', {
      corpo: {
        payment_date: dados.data,
        payment_account_id: dados.contaPagamentoId,
        description: dados.descricao,
        reference_no: dados.referencia,
        publish: true,
        categories: [
          {
            index: 1,
            expense_account_id: dados.categoriaId,
            amount: dados.valor,
            description: dados.descricao,
          },
        ],
        attachments: dados.anexoKey ? [{ key: dados.anexoKey }] : [],
      },
    });
    return resposta;
  }

  async criarReceita(dados: {
    data: string;
    valor: number;
    contaRecebimentoId: number;
    categoriaId: number;
    descricao: string;
    referencia?: string;
  }): Promise<{ id: number }> {
    return this.requisicao<{ id: number }>('POST', '/banking/transactions', {
      corpo: {
        date: dados.data,
        transaction_type: 'other_income',
        description: dados.descricao,
        reference_no: dados.referencia,
        amount: dados.valor,
        credit_account_id: dados.categoriaId,
        cashflow_account_id: dados.contaRecebimentoId,
        publish: true,
      },
    });
  }

  async ultimasDespesas(quantidade: number): Promise<unknown> {
    const params = new URLSearchParams({
      page: '1',
      page_size: String(quantidade),
      column_sort_by: 'payment_date',
      sort_order: 'desc',
    });
    const resposta = await this.requisicao<{ data: Record<string, unknown>[] }>('GET', `/expenses?${params}`);
    return resposta.data.map((d) =>
      pick(d, ['id', 'formatted_date', 'description', 'formatted_amount', 'reference_no', 'payment_account_id', 'categories']),
    );
  }

  /** Demonstrativo de resultado (receitas x despesas) do período, no formato tabela, que é compacto. */
  async resultado(dataInicio: string, dataFim: string): Promise<unknown> {
    const params = new URLSearchParams({ from_date: dataInicio, to_date: dataFim, basis: 'cash' });
    return this.requisicao('GET', `/reports/profit-loss-sheet?${params}`, { accept: 'application/json+table' });
  }

  async saldos(): Promise<unknown> {
    const resposta = await this.requisicao<unknown>('GET', '/banking/accounts');
    const lista = Array.isArray(resposta) ? resposta : ((resposta as { accounts?: unknown[] }).accounts ?? []);
    return (lista as Record<string, unknown>[]).map((c) =>
      pick(c, ['id', 'name', 'account_type', 'amount', 'formatted_amount', 'currency_code']),
    );
  }
}

function pick(objeto: Record<string, unknown>, chaves: string[]): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const chave of chaves) {
    if (objeto[chave] !== undefined) saida[chave] = objeto[chave];
  }
  return saida;
}
