/**
 * Centralized reactive state store connecting pure domain logic (src/core/)
 * with resilient persistence (src/state/storage.js).
 */

import { calculateBalances } from '../core/balances.js';
import { computeMinimumSettlements } from '../core/settleUp.js';
import {
  validateAddMember,
  validateExpenseInput,
  validateRemoveMember,
} from '../core/validators.js';
import { clearState, createInitialState, loadState, saveState } from './storage.js';

function createUniqueId(prefix) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneSnapshot(value) {
  return structuredClone(value);
}

/**
 * Creates an observable store instance backed by an injected or browser storage adapter.
 *
 * @param {{ storage?: Storage }} [options]
 */
export function createStore(options = {}) {
  const storageBackend = options?.storage;
  const loaded = loadState(storageBackend);

  let persisted = loaded.state;
  let activeMemberFilter = 'all';
  let storageWarning = loaded.warning;
  const listeners = new Set();

  function computeDerived() {
    const { balances, totalSpendPaise, hasSettlements, netSumPaise } = calculateBalances(
      persisted.members,
      persisted.expenses,
      persisted.settlements
    );

    const settlementPlan = computeMinimumSettlements(balances).map(
      ({ fromId, fromName, toId, toName, amountPaise }) => ({
        fromId,
        fromName,
        toId,
        toName,
        amountPaise,
      })
    );

    // Newest-first by createdAt, using insertion order (array index) descending as tie-breaker (E-15).
    const sortedExpenses = persisted.expenses
      .map((expense, index) => ({ expense, index }))
      .sort((a, b) => (b.expense.createdAt - a.expense.createdAt) || (b.index - a.index))
      .map((item) => item.expense);

    const filteredExpenses =
      activeMemberFilter === 'all'
        ? sortedExpenses
        : sortedExpenses.filter(
            (expense) =>
              expense.paidBy === activeMemberFilter ||
              expense.shares.some((share) => share.memberId === activeMemberFilter)
          );

    return {
      balances,
      totalSpendPaise,
      hasSettlements,
      netSumPaise,
      settlementPlan,
      filteredExpenses,
    };
  }

  function getState() {
    return cloneSnapshot({
      version: persisted.version,
      members: persisted.members,
      expenses: persisted.expenses,
      settlements: persisted.settlements,
      activeMemberFilter,
      storageWarning,
    });
  }

  function getDerivedState() {
    return cloneSnapshot(computeDerived());
  }

  function getSnapshot() {
    return {
      ...getState(),
      ...getDerivedState(),
    };
  }

  function notify() {
    for (const listener of [...listeners]) {
      listener(getSnapshot());
    }
  }

  function persistAndNotify(nextPersisted) {
    persisted = nextPersisted;
    const saved = saveState(persisted, storageBackend);
    storageWarning = saved.ok ? null : saved.error;
    notify();
  }

  /**
   * Subscribes a listener to state changes and returns an unsubscribe callback.
   *
   * @param {(snapshot: Object) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Subscriber listener must be a function.');
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function addMember(rawName) {
    const check = validateAddMember(rawName, persisted.members);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }

    const member = {
      id: createUniqueId('mem'),
      name: check.normalizedName,
      createdAt: Date.now(),
    };

    persistAndNotify({
      ...persisted,
      members: [...persisted.members, member],
    });

    return { ok: true, error: null, member: cloneSnapshot(member) };
  }

  function removeMember(memberId) {
    const check = validateRemoveMember(memberId, persisted);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }

    // M-12: clear active member filter if the deleted member was selected.
    if (activeMemberFilter === memberId) {
      activeMemberFilter = 'all';
    }

    persistAndNotify({
      ...persisted,
      members: persisted.members.filter((m) => m.id !== memberId),
    });

    return { ok: true, error: null };
  }

  function addExpense(input) {
    const check = validateExpenseInput(input, persisted.members);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }

    const expense = {
      id: createUniqueId('exp'),
      title: check.parsed.title,
      amountPaise: check.parsed.amountPaise,
      paidBy: check.parsed.paidBy,
      splitType: check.parsed.splitType,
      shares: check.parsed.shares,
      createdAt: Date.now(),
    };

    persistAndNotify({
      ...persisted,
      expenses: [...persisted.expenses, expense],
    });

    return { ok: true, error: null, expense: cloneSnapshot(expense) };
  }

  function deleteExpense(expenseId) {
    const exists = persisted.expenses.some((e) => e.id === expenseId);
    if (!exists) {
      // Idempotent no-op for stale/double-click deletions (T-05).
      return { ok: true, error: null };
    }

    persistAndNotify({
      ...persisted,
      expenses: persisted.expenses.filter((e) => e.id !== expenseId),
    });

    return { ok: true, error: null };
  }

  function markAsSettled(payment) {
    const fromId = payment?.fromId;
    const toId = payment?.toId;
    const amountPaise = payment?.amountPaise;

    if (
      typeof fromId !== 'string' ||
      !fromId ||
      typeof toId !== 'string' ||
      !toId ||
      fromId === toId ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise <= 0
    ) {
      return { ok: false, error: 'Invalid settlement payment details.' };
    }

    const { settlementPlan } = computeDerived();
    const matchesPending = settlementPlan.some(
      (item) => item.fromId === fromId && item.toId === toId && item.amountPaise === amountPaise
    );

    if (!matchesPending) {
      return { ok: false, error: 'This settlement payment is no longer pending.' };
    }

    const settlement = {
      id: createUniqueId('stl'),
      fromId,
      toId,
      amountPaise,
      createdAt: Date.now(),
    };

    persistAndNotify({
      ...persisted,
      settlements: [...persisted.settlements, settlement],
    });

    return { ok: true, error: null, settlement: cloneSnapshot(settlement) };
  }

  function undoSettlement(settlementId) {
    const exists = persisted.settlements.some((s) => s.id === settlementId);
    if (!exists) {
      return { ok: true, error: null };
    }

    persistAndNotify({
      ...persisted,
      settlements: persisted.settlements.filter((s) => s.id !== settlementId),
    });

    return { ok: true, error: null };
  }

  function setMemberFilter(memberIdOrAll) {
    if (memberIdOrAll !== 'all') {
      const exists = persisted.members.some((m) => m.id === memberIdOrAll);
      if (!exists) {
        return { ok: false, error: 'Selected filter member does not exist.' };
      }
    }

    activeMemberFilter = memberIdOrAll;
    notify();
    return { ok: true, error: null };
  }

  function resetGroup() {
    persisted = createInitialState();
    activeMemberFilter = 'all';
    const cleared = clearState(storageBackend);
    storageWarning = cleared.ok ? null : cleared.error;
    notify();
    return { ok: cleared.ok, error: cleared.error };
  }

  return {
    getState,
    getDerivedState,
    getSnapshot,
    subscribe,
    addMember,
    removeMember,
    addExpense,
    deleteExpense,
    markAsSettled,
    undoSettlement,
    setMemberFilter,
    resetGroup,
  };
}
