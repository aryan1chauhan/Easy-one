/**
 * Exact minimum-transaction debt settlement solver using Bitmask Dynamic Programming.
 * Maximizes the number of disjoint zero-sum subsets p among k non-zero balances so
 * that the total number of transfers is strictly minimized at k - p.
 */

const MAX_DP_MEMBERS = 16; // Supports group sizes well beyond UI cap of 10 safely (2^k, 3^k)

/**
 * Matches debtors and creditors inside a single minimal zero-sum subset S_j
 * to produce strictly |S_j| - 1 transfers.
 *
 * @param {Array<{ memberId: string, name: string, netPaise: number }>} subsetMembers
 * @returns {Array<{
 *   fromId: string,
 *   fromMemberId: string,
 *   fromName: string,
 *   toId: string,
 *   toMemberId: string,
 *   toName: string,
 *   amountPaise: number
 * }>}
 */
function settleMinimalSubset(subsetMembers) {
  const compareDescMagnitude = (a, b) => {
    if (b.remaining !== a.remaining) {
      return b.remaining - a.remaining;
    }
    const nameCmp = a.name.localeCompare(b.name);
    return nameCmp !== 0 ? nameCmp : a.memberId.localeCompare(b.memberId);
  };

  const debtors = subsetMembers
    .filter((m) => m.netPaise < 0)
    .map((m) => ({ memberId: m.memberId, name: m.name, remaining: -m.netPaise }))
    .sort(compareDescMagnitude);

  const creditors = subsetMembers
    .filter((m) => m.netPaise > 0)
    .map((m) => ({ memberId: m.memberId, name: m.name, remaining: m.netPaise }))
    .sort(compareDescMagnitude);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amountPaise = Math.min(debtor.remaining, creditor.remaining);

    if (amountPaise > 0) {
      transfers.push({
        fromId: debtor.memberId,
        fromMemberId: debtor.memberId,
        fromName: debtor.name,
        toId: creditor.memberId,
        toMemberId: creditor.memberId,
        toName: creditor.name,
        amountPaise,
      });
    }

    debtor.remaining -= amountPaise;
    creditor.remaining -= amountPaise;

    if (debtor.remaining === 0) i += 1;
    if (creditor.remaining === 0) j += 1;
  }

  return transfers;
}

/**
 * Computes the mathematically minimum list of settlement payments for member balances.
 *
 * @param {Array<{ memberId: string, name?: string, netPaise: number }>} memberBalances
 * @returns {Array<{
 *   fromId: string,
 *   fromMemberId: string,
 *   fromName: string,
 *   toId: string,
 *   toMemberId: string,
 *   toName: string,
 *   amountPaise: number
 * }>}
 */
export function computeMinimumSettlements(memberBalances) {
  if (!Array.isArray(memberBalances)) {
    throw new TypeError('memberBalances must be an array.');
  }

  let totalNet = 0;
  const nonZero = [];
  const seenIds = new Set();

  for (const item of memberBalances) {
    if (!item || typeof item.memberId !== 'string' || !item.memberId) {
      throw new TypeError('Each balance entry must have a non-empty string memberId.');
    }
    if (seenIds.has(item.memberId)) {
      throw new Error(`Duplicate memberId in balances: ${item.memberId}`);
    }
    if (!Number.isSafeInteger(item.netPaise)) {
      throw new TypeError(`netPaise must be a safe integer for member ${item.memberId}.`);
    }
    seenIds.add(item.memberId);
    totalNet += item.netPaise;

    if (item.netPaise !== 0) {
      nonZero.push({
        memberId: item.memberId,
        name: typeof item.name === 'string' && item.name ? item.name : item.memberId,
        netPaise: item.netPaise,
      });
    }
  }

  if (totalNet !== 0) {
    throw new Error(`Cannot compute settlements: net balances sum to ${totalNet}, expected 0.`);
  }

  const k = nonZero.length;
  if (k === 0) {
    return [];
  }
  if (k > MAX_DP_MEMBERS) {
    throw new RangeError(`Exact Bitmask DP supports at most ${MAX_DP_MEMBERS} non-zero members.`);
  }

  // Sort deterministically so subset tie-breaking does not depend on array arrival order.
  nonZero.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    return nameCmp !== 0 ? nameCmp : a.memberId.localeCompare(b.memberId);
  });

  const totalMasks = 1 << k;
  const fullMask = totalMasks - 1;
  // Float64Array holds exact integers up to 2^53 - 1, avoiding Int32Array overflow on large ₹ sums.
  const subsetSum = new Float64Array(totalMasks);
  const dp = new Int32Array(totalMasks).fill(-1);
  const parentSub = new Int32Array(totalMasks);

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const lsb = mask & -mask;
    const bitIndex = 31 - Math.clz32(lsb);
    subsetSum[mask] = subsetSum[mask ^ lsb] + nonZero[bitIndex].netPaise;
  }

  dp[0] = 0;
  for (let mask = 1; mask < totalMasks; mask += 1) {
    if (subsetSum[mask] !== 0) {
      continue;
    }

    let bestCount = 1;
    let bestSub = mask;

    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      if (subsetSum[sub] === 0 && dp[mask ^ sub] !== -1) {
        const candidate = dp[mask ^ sub] + 1;
        if (candidate > bestCount) {
          bestCount = candidate;
          bestSub = sub;
        }
      }
    }

    dp[mask] = bestCount;
    parentSub[mask] = bestSub;
  }

  const payments = [];
  let cursor = fullMask;

  while (cursor > 0) {
    const subMask = parentSub[cursor];
    const groupMembers = [];
    for (let bit = 0; bit < k; bit += 1) {
      if ((subMask & (1 << bit)) !== 0) {
        groupMembers.push(nonZero[bit]);
      }
    }
    payments.push(...settleMinimalSubset(groupMembers));
    cursor ^= subMask;
  }

  return payments.sort((a, b) => {
    if (b.amountPaise !== a.amountPaise) {
      return b.amountPaise - a.amountPaise;
    }
    const fromCmp = a.fromName.localeCompare(b.fromName);
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.toName.localeCompare(b.toName);
    if (toCmp !== 0) return toCmp;
    return `${a.fromId}:${a.toId}`.localeCompare(`${b.fromId}:${b.toId}`);
  });
}

/**
 * Verifies that every payment is strictly positive, non-self, and zeroes all member balances.
 *
 * @param {Array<{ memberId: string, netPaise: number }>} memberBalances
 * @param {Array<{ fromId?: string, toId?: string, fromMemberId?: string, toMemberId?: string, amountPaise: number }>} payments
 * @returns {boolean}
 */
export function verifySettlements(memberBalances, payments) {
  if (!Array.isArray(memberBalances) || !Array.isArray(payments)) {
    return false;
  }

  const remaining = new Map();
  for (const item of memberBalances) {
    if (
      !item ||
      typeof item.memberId !== 'string' ||
      !item.memberId ||
      !Number.isSafeInteger(item.netPaise) ||
      remaining.has(item.memberId)
    ) {
      return false;
    }
    remaining.set(item.memberId, item.netPaise);
  }

  for (const payment of payments) {
    if (!payment || !Number.isSafeInteger(payment.amountPaise) || payment.amountPaise <= 0) {
      return false;
    }
    const fromId = payment.fromId ?? payment.fromMemberId;
    const toId = payment.toId ?? payment.toMemberId;
    if (!fromId || !toId || fromId === toId || !remaining.has(fromId) || !remaining.has(toId)) {
      return false;
    }

    remaining.set(fromId, remaining.get(fromId) + payment.amountPaise);
    remaining.set(toId, remaining.get(toId) - payment.amountPaise);
  }

  for (const net of remaining.values()) {
    if (net !== 0) {
      return false;
    }
  }

  return true;
}
