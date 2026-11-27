/**
 * Resilient, versioned persistence adapter for Expense Splitter.
 * Defaults to globalThis.localStorage but supports dependency injection for Node tests.
 */

import { MAX_AMOUNT_PAISE, TOTAL_BPS, parsePercentToBps } from '../core/money.js';
import { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS, normalizeMemberName } from '../core/validators.js';

export const STORAGE_KEY = 'expense_splitter_state_v1';
export const SCHEMA_VERSION = 1;

const STORAGE_UNAVAILABLE_WARNING = 'Storage unavailable; changes will not persist after refresh.';
const CORRUPTED_STATE_WARNING = 'Saved data was corrupted or invalid and has been reset to a clean state.';
const VALID_SPLIT_TYPES = new Set(['equal', 'exact', 'percentage']);

/**
 * Returns a clean empty AppState matching schema v1.
 *
 * @returns {{ version: number, members: Array, expenses: Array, settlements: Array }}
 */
export function createInitialState() {
  return {
    version: SCHEMA_VERSION,
    members: [],
    expenses: [],
    settlements: [],
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function resolveStorage(storageBackend) {
  try {
    const backend = storageBackend === undefined ? globalThis.localStorage : storageBackend;
    if (
      !backend ||
      typeof backend.getItem !== 'function' ||
      typeof backend.setItem !== 'function' ||
      typeof backend.removeItem !== 'function'
    ) {
      return null;
    }
    return backend;
  } catch {
    return null;
  }
}

function validateAndSanitizeState(candidate) {
  if (!isPlainObject(candidate) || candidate.version !== SCHEMA_VERSION) {
    return null;
  }
  if (
    !Array.isArray(candidate.members) ||
    !Array.isArray(candidate.expenses) ||
    !Array.isArray(candidate.settlements)
  ) {
    return null;
  }
  if (candidate.members.length > MAX_MEMBERS) {
    return null;
  }

  const members = [];
  const memberIds = new Set();
  const memberNamesLower = new Set();

  for (const rawMember of candidate.members) {
    if (!isPlainObject(rawMember) || !isNonEmptyString(rawMember.id)) {
      return null;
    }
    const normalizedName = normalizeMemberName(rawMember.name);
    if (!normalizedName || normalizedName.length > MAX_MEMBER_NAME_LENGTH) {
      return null;
    }
    if (!isValidTimestamp(rawMember.createdAt)) {
      return null;
    }
    const lowerName = normalizedName.toLowerCase();
    if (memberIds.has(rawMember.id) || memberNamesLower.has(lowerName)) {
      return null;
    }

    memberIds.add(rawMember.id);
    memberNamesLower.add(lowerName);
    members.push({
      id: rawMember.id,
      name: normalizedName,
      createdAt: rawMember.createdAt,
    });
  }

  const expenses = [];
  const expenseIds = new Set();

  for (const rawExpense of candidate.expenses) {
    if (!isPlainObject(rawExpense) || !isNonEmptyString(rawExpense.id) || expenseIds.has(rawExpense.id)) {
      return null;
    }
    if (!isNonEmptyString(rawExpense.title)) {
      return null;
    }
    if (
      !Number.isSafeInteger(rawExpense.amountPaise) ||
      rawExpense.amountPaise <= 0 ||
      rawExpense.amountPaise > MAX_AMOUNT_PAISE
    ) {
      return null;
    }
    if (!isNonEmptyString(rawExpense.paidBy) || !memberIds.has(rawExpense.paidBy)) {
      return null;
    }
    if (!VALID_SPLIT_TYPES.has(rawExpense.splitType) || !Array.isArray(rawExpense.shares) || rawExpense.shares.length === 0) {
      return null;
    }
    if (!isValidTimestamp(rawExpense.createdAt)) {
      return null;
    }

    const shares = [];
    const seenShareMembers = new Set();
    let shareSum = 0;
    let totalBps = 0;

    for (const rawShare of rawExpense.shares) {
      if (!isPlainObject(rawShare) || !isNonEmptyString(rawShare.memberId)) {
        return null;
      }
      if (!memberIds.has(rawShare.memberId) || seenShareMembers.has(rawShare.memberId)) {
        return null;
      }
      if (!Number.isSafeInteger(rawShare.sharePaise) || rawShare.sharePaise < 0) {
        return null;
      }

      const cleanShare = {
        memberId: rawShare.memberId,
        sharePaise: rawShare.sharePaise,
      };

      if (rawExpense.splitType === 'percentage') {
        if (typeof rawShare.percent !== 'number') {
          return null;
        }
        const pctParsed = parsePercentToBps(rawShare.percent);
        if (!pctParsed.valid) {
          return null;
        }
        totalBps += pctParsed.bps;
        cleanShare.percent = rawShare.percent;
      }

      seenShareMembers.add(rawShare.memberId);
      shareSum += rawShare.sharePaise;
      shares.push(cleanShare);
    }

    if (shareSum !== rawExpense.amountPaise) {
      return null;
    }
    if (rawExpense.splitType === 'percentage' && totalBps !== TOTAL_BPS) {
      return null;
    }

    expenseIds.add(rawExpense.id);
    expenses.push({
      id: rawExpense.id,
      title: rawExpense.title.trim(),
      amountPaise: rawExpense.amountPaise,
      paidBy: rawExpense.paidBy,
      splitType: rawExpense.splitType,
      shares,
      createdAt: rawExpense.createdAt,
    });
  }

  const settlements = [];
  const settlementIds = new Set();

  for (const rawSettlement of candidate.settlements) {
    if (
      !isPlainObject(rawSettlement) ||
      !isNonEmptyString(rawSettlement.id) ||
      settlementIds.has(rawSettlement.id)
    ) {
      return null;
    }
    if (
      !isNonEmptyString(rawSettlement.fromId) ||
      !isNonEmptyString(rawSettlement.toId) ||
      rawSettlement.fromId === rawSettlement.toId ||
      !memberIds.has(rawSettlement.fromId) ||
      !memberIds.has(rawSettlement.toId)
    ) {
      return null;
    }
    if (!Number.isSafeInteger(rawSettlement.amountPaise) || rawSettlement.amountPaise <= 0) {
      return null;
    }
    if (!isValidTimestamp(rawSettlement.createdAt)) {
      return null;
    }

    settlementIds.add(rawSettlement.id);
    settlements.push({
      id: rawSettlement.id,
      fromId: rawSettlement.fromId,
      toId: rawSettlement.toId,
      amountPaise: rawSettlement.amountPaise,
      createdAt: rawSettlement.createdAt,
    });
  }

  return {
    version: SCHEMA_VERSION,
    members,
    expenses,
    settlements,
  };
}

/**
 * Loads and validates state from storage, recovering gracefully on any read, parse, or schema error.
 *
 * @param {Storage} [storageBackend]
 * @returns {{ state: Object, recovered: boolean, warning: string | null }}
 */
export function loadState(storageBackend) {
  const backend = resolveStorage(storageBackend);
  if (!backend) {
    return {
      state: createInitialState(),
      recovered: false,
      warning: STORAGE_UNAVAILABLE_WARNING,
    };
  }

  let raw;
  try {
    raw = backend.getItem(STORAGE_KEY);
  } catch {
    return {
      state: createInitialState(),
      recovered: false,
      warning: STORAGE_UNAVAILABLE_WARNING,
    };
  }

  if (raw === null || raw === undefined) {
    return {
      state: createInitialState(),
      recovered: false,
      warning: null,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const validated = validateAndSanitizeState(parsed);
    if (!validated) {
      return {
        state: createInitialState(),
        recovered: true,
        warning: CORRUPTED_STATE_WARNING,
      };
    }

    return {
      state: validated,
      recovered: false,
      warning: null,
    };
  } catch {
    return {
      state: createInitialState(),
      recovered: true,
      warning: CORRUPTED_STATE_WARNING,
    };
  }
}

/**
 * Serializes and writes canonical AppState to storage without throwing.
 *
 * @param {{ version: number, members: Array, expenses: Array, settlements: Array }} state
 * @param {Storage} [storageBackend]
 * @returns {{ ok: boolean, error: string | null }}
 */
export function saveState(state, storageBackend) {
  const backend = resolveStorage(storageBackend);
  if (!backend) {
    return { ok: false, error: STORAGE_UNAVAILABLE_WARNING };
  }

  const sanitized = validateAndSanitizeState(state);

  if (!sanitized) {
    return { ok: false, error: 'Refused to persist invalid state.' };
  }

  try {
    backend.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return { ok: true, error: null };
  } catch (err) {
    const isQuota = err?.name === 'QuotaExceededError';
    return {
      ok: false,
      error: isQuota
        ? 'Storage quota exceeded; changes will not persist after refresh.'
        : STORAGE_UNAVAILABLE_WARNING,
    };
  }
}

/**
 * Removes persisted group state from storage cleanly.
 *
 * @param {Storage} [storageBackend]
 * @returns {{ ok: boolean, error: string | null }}
 */
export function clearState(storageBackend) {
  const backend = resolveStorage(storageBackend);
  if (!backend) {
    return { ok: false, error: STORAGE_UNAVAILABLE_WARNING };
  }

  try {
    backend.removeItem(STORAGE_KEY);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: STORAGE_UNAVAILABLE_WARNING };
  }
}
