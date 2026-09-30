// @ts-nocheck
import printValue from '../printValue';

export const locale = {
  mixed: {
    default: '${path} é inválido',
    required: '${path} é obrigatório',
    oneOf: '${path} deve ser um dos seguintes valores: ${values}',
    notOneOf: '${path} não pode ser um dos seguintes valores: ${values}',
    notType: ({ path, type, value, originalValue }) => {
      let isCast = originalValue != null && originalValue !== value;
      let msg =
        `${path} deve ser do tipo \`${type}\`, ` +
        `mas o valor final foi: \`${printValue(value, true)}\`` +
        (isCast
          ? ` (convertido do valor \`${printValue(originalValue, true)}\`).`
          : '.');

      if (value === null) {
        msg += `\n Se "null" deve ser tratado como vazio, marque o schema como \`.nullable()\``;
      }

      return msg;
    },
    defined: '${path} precisa estar definido',
  },
  string: {
    length: '${path} deve ter exatamente ${length} caracteres',
    min: '${path} deve ter pelo menos ${min} caracteres',
    max: '${path} deve ter no máximo ${max} caracteres',
    matches: '${path} deve seguir o formato: "${regex}"',
    email: '${path} deve ser um e-mail válido',
    url: '${path} deve ser uma URL válida',
    trim: '${path} não pode ter espaços no início ou no fim',
    lowercase: '${path} deve estar em minúsculas',
    uppercase: '${path} deve estar em maiúsculas',
  },
  number: {
    min: '${path} deve ser maior ou igual a ${min}',
    max: '${path} deve ser menor ou igual a ${max}',
    lessThan: '${path} deve ser menor que ${less}',
    moreThan: '${path} deve ser maior que ${more}',
    notEqual: '${path} não pode ser igual a ${notEqual}',
    positive: '${path} deve ser um número positivo',
    negative: '${path} deve ser um número negativo',
    integer: '${path} deve ser um número inteiro',
  },
  date: {
    min: '${path} deve ser posterior a ${min}',
    max: '${path} deve ser anterior a ${max}',
  },
  boolean: {},
  object: {
    noUnknown: '${path} não pode ter campos não especificados',
  },
  array: {
    min: '${path} deve ter pelo menos ${min} itens',
    max: '${path} deve ter no máximo ${max} itens',
  },
};
