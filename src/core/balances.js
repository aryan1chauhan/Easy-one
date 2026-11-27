/**
 * Pure balance calculation engine enforcing the Zero-Sum Invariant across
 * group expenses and recorded settlements.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Computes per-member totals and net balances across all expenses and settlements.
 * Zero-Sum Invariant: sum(netPaise) === 0 holds strictly for all valid inputs.
 *
 * @param {Array<{ id: string, name: string }>} members
 * @param {Array<{ id?: string, amountPaise: number, paidBy: string, shares: Array<{ memberId: string, sharePaise: number }> }>} [expenses]
 * @param {Array<{ id?: string, fromId?: string, toId?: string, fromMemberId?: string, toMemberId?: string, amountPaise: number }>} [settlements]
 * @returns {{
 *   balances: Array<{
 *     memberId: string,
 *     name: string,
 *     expensePaidPaise: number,
 *     expenseSharePaise: number,
 *     settledOutPaise: number,
 *     settledInPaise: number,
 *     paidPaise: number,
 *     sharePaise: number,
 *     netPaise: number
 *   }>,
 *   totalSpendPaise: number,
 *   hasSettlements: boolean,
 *   netSumPaise: number
 * }}
 */
export function calculateBalances(members, expenses = [], settlements = []) {
  const memberList = asArray(members);
  const expenseList = asArray(expenses);
  const settlementList = asArray(settlements);

  const ledgerMap = new Map();
  const orderedIds = [];

  for (const member of memberList) {
    if (!member || typeof member.id !== 'string' || !member.id) {
      throw new TypeError('Each member must have a valid non-empty string id.');
    }
    if (ledgerMap.has(member.id)) {
      throw new Error(`Duplicate member id in balance calculation: ${member.id}`);
    }
    orderedIds.push(member.id);
    ledgerMap.set(member.id, {
      memberId: member.id,
      name: typeof member.name === 'string' ? member.name : member.id,
      expensePaidPaise: 0,
      expenseSharePaise: 0,
      settledOutPaise: 0,
      settledInPaise: 0,
    });
  }

  let totalSpendPaise = 0;

  for (const expense of expenseList) {
    if (!expense || !Number.isSafeInteger(expense.amountPaise) || expense.amountPaise <= 0) {
      throw new TypeError('Each expense must have a positive safe-integer amountPaise.');
    }
    const payer = ledgerMap.get(expense.paidBy);
    if (!payer) {
      throw new Error(`Expense references unknown payer memberId: ${expense.paidBy}`);
    }

    payer.expensePaidPaise += expense.amountPaise;
    totalSpendPaise += expense.amountPaise;

    let sharesSum = 0;
    for (const share of asArray(expense.shares)) {
      if (!share || !Number.isSafeInteger(share.sharePaise) || share.sharePaise < 0) {
        throw new TypeError('Each expense share must have a non-negative integer sharePaise.');
      }
      const participant = ledgerMap.get(share.memberId);
      if (!participant) {
        throw new Error(`Expense share references unknown memberId: ${share.memberId}`);
      }
      participant.expenseSharePaise += share.sharePaise;
      sharesSum += share.sharePaise;
    }

    if (sharesSum !== expense.amountPaise) {
      throw new Error(
        `Share conservation violated for expense "${expense.title ?? expense.id ?? ''}": ` +
          `expected ${expense.amountPaise}, got ${sharesSum}.`
      );
    }
  }

  for (const settlement of settlementList) {
    if (!settlement || !Number.isSafeInteger(settlement.amountPaise) || settlement.amountPaise <= 0) {
      throw new TypeError('Each settlement must have a positive safe-integer amountPaise.');
    }
    const fromId = settlement.fromId ?? settlement.fromMemberId;
    const toId = settlement.toId ?? settlement.toMemberId;
    const sender = ledgerMap.get(fromId);
    const receiver = ledgerMap.get(toId);

    if (!sender || !receiver) {
      throw new Error(`Settlement references unknown memberId (${fromId} -> ${toId}).`);
    }
    if (fromId === toId) {
      throw new Error('Settlement cannot have the same sender and receiver.');
    }

    sender.settledOutPaise += settlement.amountPaise;
    receiver.settledInPaise += settlement.amountPaise;
  }

  let netSumPaise = 0;
  const balances = orderedIds.map((id) => {
    const entry = ledgerMap.get(id);
    const paidPaise = entry.expensePaidPaise + entry.settledOutPaise;
    const sharePaise = entry.expenseSharePaise + entry.settledInPaise;
    const netPaise = paidPaise - sharePaise;
    netSumPaise += netPaise;

    return {
      ...entry,
      paidPaise,
      sharePaise,
      netPaise,
    };
  });

  if (netSumPaise !== 0) {
    throw new Error(`Zero-sum invariant violated: net balance sum is ${netSumPaise}.`);
  }

  return {
    balances,
    totalSpendPaise,
    hasSettlements: settlementList.length > 0,
    netSumPaise,
  };
}
