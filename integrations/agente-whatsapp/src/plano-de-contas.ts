/**
 * Aplica o plano de contas brasileiro numa organização do Bigcapital:
 * traduz as contas padrão (que o Bigcapital cria em inglês) e cria as
 * categorias de despesa e receita mais comuns para empresa ou pessoa física.
 *
 * Pode rodar mais de uma vez: só renomeia o que ainda está em inglês e só cria o que não existe.
 *
 * Uso (dentro do container do agente):
 *   node dist/plano-de-contas.js <API_KEY> empresa|pessoal
 */
import { Bigcapital } from './bigcapital.ts';

type Perfil = 'empresa' | 'pessoal';

/** Nome original em inglês -> nome em português. Vale para os dois perfis, exceto onde o perfil sobrescreve. */
const TRADUCOES: Record<string, string> = {
  'Other Expenses': 'Outras despesas',
  'Tax Payable': 'Impostos a recolher',
  'Unearned Revenue': 'Receita diferida',
  'Prepaid Expenses': 'Despesas antecipadas',
  'Stripe Clearing': 'Stripe (compensação)',
  Discount: 'Descontos concedidos',
  'Purchase Discount': 'Descontos obtidos',
  'Other Charges': 'Outras cobranças',
  'Bank Account': 'Conta bancária',
  'Saving Bank Account': 'Poupança',
  'Undeposited Funds': 'Valores a depositar',
  'Petty Cash': 'Caixa',
  'Computer Equipment': 'Equipamentos de informática',
  'Office Equipment': 'Móveis e equipamentos',
  'Accounts Receivable (A/R)': 'Contas a receber',
  'Inventory Asset': 'Estoque',
  'Accounts Payable (A/P)': 'Contas a pagar',
  'Owner A Drawings': 'Retiradas dos sócios',
  Loan: 'Empréstimos',
  'Opening Balance Liabilities': 'Saldo inicial de passivos',
  'Revenue Received in Advance': 'Receitas recebidas antecipadamente',
  'Retained Earnings': 'Lucros acumulados',
  'Opening Balance Equity': 'Saldo inicial do patrimônio',
  'Cost of Goods Sold': 'Custo das mercadorias vendidas',
  'Office expenses': 'Despesas de escritório',
  Rent: 'Aluguel',
  'Exchange Gain or Loss': 'Variação cambial',
  'Bank Fees and Charges': 'Tarifas bancárias',
  'Depreciation Expense': 'Depreciação',
  'Sales of Product Income': 'Venda de produtos',
  'Sales of Service Income': 'Prestação de serviços',
  'Uncategorized Income': 'Receitas não categorizadas',
  'Other Income': 'Outras receitas',
};

const TRADUCOES_PESSOAL: Record<string, string> = {
  'Bank Account': 'Conta corrente',
  'Petty Cash': 'Dinheiro (carteira)',
  Rent: 'Aluguel e condomínio',
  'Sales of Service Income': 'Freelas e serviços',
  'Owner A Drawings': 'Retiradas',
};

interface NovaConta {
  nome: string;
  codigo: string;
  tipo: string;
  descricao?: string;
}

const EMPRESA: NovaConta[] = [
  { nome: 'Cartão de crédito PJ', codigo: '2101', tipo: 'credit-card' },
  { nome: 'Pró-labore', codigo: '4101', tipo: 'expense' },
  { nome: 'Salários e encargos', codigo: '4102', tipo: 'expense', descricao: 'Salários, FGTS, INSS patronal, férias, 13º' },
  { nome: 'Benefícios de funcionários', codigo: '4103', tipo: 'expense', descricao: 'VR, VT, plano de saúde' },
  { nome: 'Energia elétrica', codigo: '4111', tipo: 'expense' },
  { nome: 'Água e esgoto', codigo: '4112', tipo: 'expense' },
  { nome: 'Internet e telefone', codigo: '4113', tipo: 'expense' },
  { nome: 'Software e assinaturas', codigo: '4114', tipo: 'expense', descricao: 'SaaS, hospedagem, domínios, licenças' },
  { nome: 'Material de consumo', codigo: '4115', tipo: 'expense' },
  { nome: 'Manutenção e reparos', codigo: '4116', tipo: 'expense' },
  { nome: 'Marketing e publicidade', codigo: '4121', tipo: 'expense' },
  { nome: 'Tráfego pago', codigo: '4122', tipo: 'expense', descricao: 'Meta Ads, Google Ads, TikTok Ads' },
  { nome: 'Contabilidade', codigo: '4131', tipo: 'expense' },
  { nome: 'Serviços de terceiros', codigo: '4132', tipo: 'expense', descricao: 'Freelancers, consultorias, prestadores PJ' },
  { nome: 'Jurídico', codigo: '4133', tipo: 'expense' },
  { nome: 'Impostos sobre faturamento', codigo: '4141', tipo: 'expense', descricao: 'DAS/Simples Nacional, ISS, PIS, COFINS' },
  { nome: 'Taxas e licenças', codigo: '4142', tipo: 'expense', descricao: 'Alvarás, taxas de órgãos, certificados digitais' },
  { nome: 'Taxas de meios de pagamento', codigo: '4143', tipo: 'expense', descricao: 'Maquininha, gateway, Pix cobrado' },
  { nome: 'Combustível e deslocamento', codigo: '4151', tipo: 'expense', descricao: 'Combustível, Uber, estacionamento, pedágio' },
  { nome: 'Alimentação', codigo: '4152', tipo: 'expense' },
  { nome: 'Viagens e hospedagem', codigo: '4153', tipo: 'expense' },
  { nome: 'Fretes e entregas', codigo: '4154', tipo: 'expense' },
  { nome: 'Cursos e treinamentos', codigo: '4161', tipo: 'expense' },
  { nome: 'Juros e multas', codigo: '4171', tipo: 'other-expense' },
  { nome: 'Rendimentos de aplicações', codigo: '3201', tipo: 'other-income' },
];

const PESSOAL: NovaConta[] = [
  { nome: 'Cartão de crédito', codigo: '2101', tipo: 'credit-card' },
  { nome: 'Contas da casa', codigo: '6102', tipo: 'expense', descricao: 'Luz, água, gás, internet, telefone' },
  { nome: 'Mercado', codigo: '6103', tipo: 'expense' },
  { nome: 'Alimentação fora de casa', codigo: '6104', tipo: 'expense', descricao: 'Restaurantes, delivery, lanches' },
  { nome: 'Transporte', codigo: '6105', tipo: 'expense', descricao: 'Combustível, Uber, ônibus, estacionamento, manutenção do carro' },
  { nome: 'Saúde', codigo: '6106', tipo: 'expense', descricao: 'Plano de saúde, consultas, exames, farmácia' },
  { nome: 'Educação', codigo: '6107', tipo: 'expense', descricao: 'Escola, faculdade, cursos, livros' },
  { nome: 'Lazer', codigo: '6108', tipo: 'expense', descricao: 'Passeios, cinema, shows, hobbies' },
  { nome: 'Viagens', codigo: '6109', tipo: 'expense' },
  { nome: 'Vestuário', codigo: '6110', tipo: 'expense' },
  { nome: 'Cuidados pessoais', codigo: '6111', tipo: 'expense', descricao: 'Salão, barbeiro, academia, cosméticos' },
  { nome: 'Assinaturas e streaming', codigo: '6112', tipo: 'expense' },
  { nome: 'Pets', codigo: '6113', tipo: 'expense' },
  { nome: 'Presentes e doações', codigo: '6114', tipo: 'expense' },
  { nome: 'Impostos pessoais', codigo: '6115', tipo: 'expense', descricao: 'IPVA, IPTU, IR a pagar' },
  { nome: 'Seguros', codigo: '6116', tipo: 'expense' },
  { nome: 'Filhos', codigo: '6117', tipo: 'expense' },
  { nome: 'Juros e multas', codigo: '6171', tipo: 'other-expense' },
  { nome: 'Salário', codigo: '5101', tipo: 'income' },
  { nome: 'Pró-labore e distribuição de lucros', codigo: '5102', tipo: 'income' },
  { nome: 'Rendimentos de investimentos', codigo: '5201', tipo: 'other-income' },
  { nome: 'Reembolsos', codigo: '5202', tipo: 'other-income' },
];

async function aplicar(apiKey: string, perfil: Perfil): Promise<void> {
  const bigcapital = new Bigcapital(apiKey);
  const traducoes = perfil === 'pessoal' ? { ...TRADUCOES, ...TRADUCOES_PESSOAL } : TRADUCOES;

  const existentes = await bigcapital.todasContas();
  let renomeadas = 0;
  for (const conta of existentes) {
    const novoNome = traducoes[conta.name];
    if (!novoNome) continue;
    await bigcapital.editarConta(conta.id, {
      nome: novoNome,
      codigo: conta.code,
      tipo: conta.account_type,
      descricao: conta.description,
      paiId: conta.parent_account_id,
    });
    renomeadas++;
  }

  const nomes = new Set((await bigcapital.todasContas()).map((c) => c.name.toLowerCase()));
  const codigos = new Set(existentes.map((c) => c.code).filter(Boolean));
  let criadas = 0;
  for (const nova of perfil === 'empresa' ? EMPRESA : PESSOAL) {
    if (nomes.has(nova.nome.toLowerCase())) continue;
    await bigcapital.criarConta({
      nome: nova.nome,
      codigo: codigos.has(nova.codigo) ? undefined : nova.codigo,
      tipo: nova.tipo,
      descricao: nova.descricao,
    });
    criadas++;
  }

  console.log(`Plano de contas "${perfil}" aplicado: ${renomeadas} conta(s) traduzida(s), ${criadas} criada(s).`);
}

const [apiKey, perfil] = process.argv.slice(2);
if (!apiKey || (perfil !== 'empresa' && perfil !== 'pessoal')) {
  console.error('Uso: node dist/plano-de-contas.js <API_KEY> empresa|pessoal');
  process.exit(1);
}
aplicar(apiKey, perfil).catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
