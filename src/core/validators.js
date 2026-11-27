/**
 * Pure validation rules for group members and expenses.
 * Every validator returns { valid: boolean, error: string | null, ... }.
 */

import {
  TOTAL_BPS,
  distributeEqual,
  distributePercentage,
  formatBps,
  formatRupees,
  parsePercentToBps,
  parseRupeesToPaise,
} from './money.js';

export const MAX_MEMBERS = 10;
export const MIN_MEMBERS_FOR_EXPENSE = 2;
export const MAX_MEMBER_NAME_LENGTH = 40;

const VALID_SPLIT_TYPES = new Set(['equal', 'exact', 'percentage']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getOwnShareValue(shareValues, memberId) {
  if (!shareValues || typeof shareValues !== 'object' || Array.isArray(shareValues)) {
    return undefined;
  }
  return Object.hasOwn(shareValues, memberId) ? shareValues[memberId] : undefined;
}

/**
 * Trims surrounding whitespace and collapses repeated internal whitespace.
 *
 * @param {string} rawName
 * @returns {string}
 */
export function normalizeMemberName(rawName) {
  if (typeof rawName !== 'string') {
    return '';
  }
  return rawName.trim().replace(/\s+/g, ' ');
}

/**
 * Validates adding a new member to the group.
 *
 * @param {string} rawName
 * @param {Array<{ id: string, name: string }>} [existingMembers]
 * @returns {{ valid: boolean, error: string | null, normalizedName: string }}
 */
export function validateAddMember(rawName, existingMembers = []) {
  const members = asArray(existingMembers);
  const normalizedName = normalizeMemberName(rawName);

  if (!normalizedName) {
    return { valid: false, error: 'Member name cannot be empty.', normalizedName: '' };
  }

  if (normalizedName.length > MAX_MEMBER_NAME_LENGTH) {
    return {
      valid: false,
      error: `Member name cannot exceed ${MAX_MEMBER_NAME_LENGTH} characters.`,
      normalizedName,
    };
  }

  if (members.length >= MAX_MEMBERS) {
    return {
      valid: false,
      error: `Maximum ${MAX_MEMBERS} members allowed per group.`,
      normalizedName,
    };
  }

  const lower = normalizedName.toLowerCase();
  const isDuplicate = members.some(
    (member) =>
      typeof member?.name === 'string' &&
      normalizeMemberName(member.name).toLowerCase() === lower
  );
  if (isDuplicate) {
    return {
      valid: false,
      error: 'A member with this name already exists.',
      normalizedName,
    };
  }

  return { valid: true, error: null, normalizedName };
}

/**
 * Validates removing a member by checking referential integrity across expenses and settlements.
 *
 * @param {string} memberId
 * @param {{ members?: Array, expenses?: Array, settlements?: Array }} state
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateRemoveMember(memberId, state) {
  if (typeof memberId !== 'string' || !memberId) {
    return { valid: false, error: 'Member not found.' };
  }

  const members = asArray(state?.members);
  const expenses = asArray(state?.expenses);
  const settlements = asArray(state?.settlements);

  const member = members.find((m) => m?.id === memberId);
  if (!member) {
    return { valid: false, error: 'Member not found.' };
  }

  const hasExpenses = expenses.some(
    (expense) =>
      expense?.paidBy === memberId ||
      asArray(expense?.shares).some((share) => share?.memberId === memberId)
  );
  if (hasExpenses) {
    return {
      valid: false,
      error: `Cannot remove ${member.name} because they have existing expenses.`,
    };
  }

  const hasSettlements = settlements.some(
    (settlement) => settlement?.fromId === memberId || settlement?.toId === memberId
  );
  if (hasSettlements) {
    return {
      valid: false,
      error: `Cannot remove ${member.name} because they are part of a recorded settlement. Undo the settlement first.`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates exact rupee shares for selected participants against amountPaise.
 *
 * @param {number} amountPaise
 * @param {string[]} splitAmong
 * @param {Record<string, string|number>} shareValues
 * @param {Map<string, { id: string, name: string }>} memberMap
 * @returns {{ valid: boolean, error: string | null, shares?: Array<{ memberId: string, sharePaise: number }> }}
 */
function validateExactShares(amountPaise, splitAmong, shareValues, memberMap) {
  const shares = [];
  let sumPaise = 0;

  for (const memberId of splitAmong) {
    const raw = getOwnShareValue(shareValues, memberId);
    const parsed = parseRupeesToPaise(raw, { allowZero: true });
    if (!parsed.valid) {
      const name = memberMap.get(memberId)?.name ?? memberId;
      return { valid: false, error: `Invalid exact share for ${name}: ${parsed.error}` };
    }
    sumPaise += parsed.paise;
    shares.push({ memberId, sharePaise: parsed.paise });
  }

  if (sumPaise < amountPaise) {
    return { valid: false, error: `Short by ${formatRupees(amountPaise - sumPaise)}.` };
  }

  if (sumPaise > amountPaise) {
    return { valid: false, error: `Exceeds total by ${formatRupees(sumPaise - amountPaise)}.` };
  }

  return { valid: true, error: null, shares };
}

/**
 * Validates percentage shares for selected participants and resolves integer paise via Hamilton's method.
 *
 * @param {number} amountPaise
 * @param {string[]} splitAmong
 * @param {Record<string, string|number>} shareValues
 * @param {Map<string, { id: string, name: string }>} memberMap
 * @returns {{ valid: boolean, error: string | null, shares?: Array<{ memberId: string, sharePaise: number, percent: number }> }}
 */
function validatePercentageShares(amountPaise, splitAmong, shareValues, memberMap) {
  const entries = [];
  let totalBps = 0;

  for (const memberId of splitAmong) {
    const raw = getOwnShareValue(shareValues, memberId);
    const parsed = parsePercentToBps(raw);
    if (!parsed.valid) {
      const name = memberMap.get(memberId)?.name ?? memberId;
      return { valid: false, error: `Invalid percentage for ${name}: ${parsed.error}` };
    }
    totalBps += parsed.bps;
    entries.push({ memberId, bps: parsed.bps });
  }

  if (totalBps < TOTAL_BPS) {
    return {
      valid: false,
      error: `Percentages must sum to 100% (remaining: ${formatBps(TOTAL_BPS - totalBps)}).`,
    };
  }

  if (totalBps > TOTAL_BPS) {
    return {
      valid: false,
      error: `Percentages must sum to 100% (exceeds by ${formatBps(totalBps - TOTAL_BPS)}).`,
    };
  }

  return {
    valid: true,
    error: null,
    shares: distributePercentage(amountPaise, entries),
  };
}

/**
 * Validates and resolves an expense submission across Equal, Exact, and Percentage split modes.
 *
 * @param {{
 *   title: string,
 *   amount: string | number,
 *   paidBy: string,
 *   splitType?: 'equal' | 'exact' | 'percentage',
 *   splitAmong: string[],
 *   shareValues?: Record<string, string | number>
 * }} payload
 * @param {Array<{ id: string, name: string }>} [members]
 * @returns {{
 *   valid: boolean,
 *   error: string | null,
 *   parsed?: { title: string, amountPaise: number, paidBy: string, splitType: string, shares: Array }
 * }}
 */
export function validateExpenseInput(payload, members = []) {
  const memberMap = new Map();
  for (const member of asArray(members)) {
    if (member && typeof member.id === 'string' && member.id) {
      memberMap.set(member.id, member);
    }
  }

  if (memberMap.size < MIN_MEMBERS_FOR_EXPENSE) {
    return {
      valid: false,
      error: `Add at least ${MIN_MEMBERS_FOR_EXPENSE} members to start adding expenses.`,
    };
  }

  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  if (!title) {
    return { valid: false, error: 'Expense title cannot be empty.' };
  }

  const amountResult = parseRupeesToPaise(payload?.amount, { allowZero: false });
  if (!amountResult.valid) {
    return { valid: false, error: amountResult.error };
  }

  if (typeof payload?.paidBy !== 'string' || !memberMap.has(payload.paidBy)) {
    return { valid: false, error: 'Select a valid member who paid.' };
  }

  const splitAmong = Array.isArray(payload?.splitAmong) ? [...new Set(payload.splitAmong)] : [];
  if (splitAmong.length === 0) {
    return { valid: false, error: 'Select at least one member to split among.' };
  }
  if (splitAmong.some((id) => typeof id !== 'string' || !memberMap.has(id))) {
    return { valid: false, error: 'Split includes an invalid member.' };
  }

  const splitType = payload?.splitType === undefined ? 'equal' : payload.splitType;
  if (!VALID_SPLIT_TYPES.has(splitType)) {
    return { valid: false, error: 'Invalid split mode.' };
  }

  let shares;
  if (splitType === 'equal') {
    shares = distributeEqual(amountResult.paise, splitAmong);
  } else if (splitType === 'exact') {
    const exactResult = validateExactShares(
      amountResult.paise,
      splitAmong,
      payload?.shareValues ?? {},
      memberMap
    );
    if (!exactResult.valid) {
      return { valid: false, error: exactResult.error };
    }
    shares = exactResult.shares;
  } else {
    const pctResult = validatePercentageShares(
      amountResult.paise,
      splitAmong,
      payload?.shareValues ?? {},
      memberMap
    );
    if (!pctResult.valid) {
      return { valid: false, error: pctResult.error };
    }
    shares = pctResult.shares;
  }

  return {
    valid: true,
    error: null,
    parsed: {
      title,
      amountPaise: amountResult.paise,
      paidBy: payload.paidBy,
      splitType,
      shares,
    },
  };
}
