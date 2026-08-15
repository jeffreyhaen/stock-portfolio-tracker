const MONEY_NAME = /(price|amount|value|cost|fee|tax|total|balance|cash|quantity|shares|rate|dividend)/i;
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);

function isMoneyish(node) {
    if (!node) return false;
    if (node.type === 'Identifier') return MONEY_NAME.test(node.name);
    if (node.type === 'MemberExpression' && node.property.type === 'Identifier')
        return MONEY_NAME.test(node.property.name);
    return false;
}

function isDecimalCall(node) {
    return node.type === 'CallExpression' && node.callee.type === 'MemberExpression';
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow number arithmetic on money- or quantity-like variables; use Decimal (decimal.js).',
        },
        schema: [],
        messages: {
            noFloatMoney:
                'Possible floating-point money arithmetic on "{{name}}" — use Decimal methods (plus/minus/times/dividedBy).',
        },
    },
    create(context) {
        return {
            BinaryExpression(node) {
                if (!ARITHMETIC.has(node.operator)) return;
                if (isDecimalCall(node.left) || isDecimalCall(node.right)) return;
                for (const side of [node.left, node.right]) {
                    if (isMoneyish(side)) {
                        const name = side.name || side.property.name;
                        context.report({ node: side, messageId: 'noFloatMoney', data: { name } });
                        return;
                    }
                }
            },
        };
    },
};
