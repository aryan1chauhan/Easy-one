/**
 * Centralized reactive state store connecting pure domain logic (src/core/)
 * with resilient persistence (src/state/storage.js).
 */

import { calculateBalances, summarizeCategories } from '../core/balances.js';
import { formatRupees } from '../core/money.js';
import { computeMinimumSettlements } from '../core/settleUp.js';
import {
  normalizeMemberName,
  validateAddMember,
  validateExpenseInput,
  validateRemoveMember,
} from '../core/validators.js';
import {
  VALID_CATEGORIES,
  clearState,
  createInitialState,
  loadActivity,
  loadGroupsMeta,
  loadState,
  saveActivity,
  saveGroupsMeta,
  saveState,
} from './storage.js';

const DEFAULT_GROUP_NAME = 'Shared Group';

function inferCategory(title, explicitCategory) {
  if (explicitCategory && VALID_CATEGORIES.has(explicitCategory)) {
    return explicitCategory;
  }
  const lower = String(title ?? '').toLowerCase();
  if (/(cab|uber|ola|auto|metro|bus|petrol|fuel|ride|flight|train)/.test(lower)) return 'cab';
  if (/(grocer|rasan|rashan|milk|sabji|veg|fruit|dairy|egg|onion|mart|supermarket)/.test(lower)) return 'groceries';
  if (/(bill|rent|electric|wifi|water|gas|cylinder|utility|recharge)/.test(lower)) return 'utilities';
  if (/(shop|amazon|flipkart|clothes|order|gift)/.test(lower)) return 'shopping';
  if (/(dinner|lunch|breakfast|coffee|tea|snack|food|pizza|burger|meal|chai|dessert|treat|paratha)/.test(lower)) {
    return 'food';
  }
  return 'other';
}

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
  const loadedActivity = loadActivity(storageBackend);
  const loadedGroups = !loaded.recovered ? loadGroupsMeta(storageBackend) : null;

  let persisted = loaded.state;
  let groupsMeta = loadedGroups
    ? loadedGroups
    : {
        activeGroupId: 'grp_default',
        groups: [
          {
            id: 'grp_default',
            name: DEFAULT_GROUP_NAME,
            state: loaded.state,
            createdAt: Date.now(),
          },
        ],
      };

  // Sync active group state with primary STORAGE_KEY if multi-group meta exists cleanly
  const activeGroupRecord =
    groupsMeta.groups.find((g) => g.id === groupsMeta.activeGroupId) ?? groupsMeta.groups[0];
  if (loadedGroups && activeGroupRecord) {
    activeGroupRecord.state = loaded.state;
  }

  let hasCustomizedGroups = Boolean(loadedGroups);
  let activityLog = loadedActivity.activity;
  let activeMemberFilter = 'all';
  let activeCategoryFilter = 'all';
  let viewerMemberId = 'all';
  let searchQuery = '';
  let storageWarning = loaded.warning ?? loadedActivity.warning;
  const listeners = new Set();

  function syncActiveGroupRecord(nextState) {
    groupsMeta = {
      ...groupsMeta,
      groups: groupsMeta.groups.map((g) =>
        g.id === groupsMeta.activeGroupId ? { ...g, state: nextState } : g
      ),
    };
    if (hasCustomizedGroups) {
      saveGroupsMeta(groupsMeta, storageBackend);
    }
  }

  function recordActivity({ type, summary, detail = '', category = 'other', amountPaise = null }) {
    const entry = {
      id: createUniqueId('act'),
      type,
      summary,
      detail,
      category,
      amountPaise,
      createdAt: Date.now(),
    };
    activityLog = [...activityLog, entry];
    const savedAct = saveActivity(activityLog, storageBackend);
    if (!savedAct.ok) {
      storageWarning = savedAct.error;
    }
  }

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

    const memberNameById = new Map(persisted.members.map((m) => [m.id, m.name]));

    // Newest-first by createdAt, using insertion order (array index) descending as tie-breaker (E-15).
    const sortedExpenses = persisted.expenses
      .map((expense, index) => ({ expense, index }))
      .sort((a, b) => (b.expense.createdAt - a.expense.createdAt) || (b.index - a.index))
      .map((item) => item.expense);

    const queryLower = searchQuery.trim().toLowerCase();
    const filteredExpenses = sortedExpenses.filter((expense) => {
      const matchesMember =
        activeMemberFilter === 'all' ||
        expense.paidBy === activeMemberFilter ||
        expense.shares.some((share) => share.memberId === activeMemberFilter);
      if (!matchesMember) {
        return false;
      }
      const expCat = expense.category ?? inferCategory(expense.title);
      if (activeCategoryFilter !== 'all' && expCat !== activeCategoryFilter) {
        return false;
      }
      if (!queryLower) {
        return true;
      }
      const payerName = (memberNameById.get(expense.paidBy) ?? '').toLowerCase();
      return expense.title.toLowerCase().includes(queryLower) || payerName.includes(queryLower);
    });

    const enrichedExpenses = sortedExpenses.map((exp) => ({
      ...exp,
      category: exp.category ?? inferCategory(exp.title),
    }));
    const categorySummary = summarizeCategories(enrichedExpenses);

    const activityFeed = activityLog
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (b.entry.createdAt - a.entry.createdAt) || (b.index - a.index))
      .map((item) => item.entry);

    const activeGroup =
      groupsMeta.groups.find((g) => g.id === groupsMeta.activeGroupId) ?? groupsMeta.groups[0];

    const groups = groupsMeta.groups.map((g) => {
      const gState = g.id === groupsMeta.activeGroupId ? persisted : g.state;
      const totalGroupSpend = gState.expenses.reduce((sum, e) => sum + e.amountPaise, 0);
      return {
        id: g.id,
        name: g.name,
        memberCount: gState.members.length,
        expenseCount: gState.expenses.length,
        totalSpendPaise: totalGroupSpend,
        isActive: g.id === groupsMeta.activeGroupId,
      };
    });

    return {
      groupName: activeGroup?.name ?? DEFAULT_GROUP_NAME,
      activeGroupId: groupsMeta.activeGroupId,
      groups,
      balances,
      totalSpendPaise,
      hasSettlements,
      netSumPaise,
      settlementPlan,
      filteredExpenses,
      categorySummary,
      activityFeed,
    };
  }

  function getState() {
    const activeGroup =
      groupsMeta.groups.find((g) => g.id === groupsMeta.activeGroupId) ?? groupsMeta.groups[0];
    return cloneSnapshot({
      version: persisted.version,
      groupName: activeGroup?.name ?? DEFAULT_GROUP_NAME,
      activeGroupId: groupsMeta.activeGroupId,
      members: persisted.members,
      expenses: persisted.expenses,
      settlements: persisted.settlements,
      activityCount: activityLog.length,
      activeMemberFilter,
      activeCategoryFilter,
      viewerMemberId,
      searchQuery,
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
    syncActiveGroupRecord(persisted);
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

    recordActivity({
      type: 'member_added',
      summary: `Added member ${member.name}`,
      detail: 'Joined the group',
      category: 'other',
    });

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

    const removed = persisted.members.find((m) => m.id === memberId);

    // M-12: clear active member filter or viewer perspective if the deleted member was selected.
    if (activeMemberFilter === memberId) {
      activeMemberFilter = 'all';
    }
    if (viewerMemberId === memberId) {
      viewerMemberId = 'all';
    }

    if (removed) {
      recordActivity({
        type: 'member_removed',
        summary: `Removed member ${removed.name}`,
        detail: 'Left the group',
        category: 'other',
      });
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

    const category = inferCategory(check.parsed.title, input?.category);
    const expense = {
      id: createUniqueId('exp'),
      title: check.parsed.title,
      amountPaise: check.parsed.amountPaise,
      paidBy: check.parsed.paidBy,
      splitType: check.parsed.splitType,
      category,
      shares: check.parsed.shares,
      createdAt: Date.now(),
    };

    const payerName = persisted.members.find((m) => m.id === expense.paidBy)?.name ?? 'Member';
    recordActivity({
      type: 'expense_added',
      summary: `${payerName} added "${expense.title}"`,
      detail: `Paid ${formatRupees(expense.amountPaise)} · ${expense.splitType} split`,
      category,
      amountPaise: expense.amountPaise,
    });

    persistAndNotify({
      ...persisted,
      expenses: [...persisted.expenses, expense],
    });

    return { ok: true, error: null, expense: cloneSnapshot(expense) };
  }

  function deleteExpense(expenseId) {
    const target = persisted.expenses.find((e) => e.id === expenseId);
    if (!target) {
      // Idempotent no-op for stale/double-click deletions (T-05).
      return { ok: true, error: null };
    }

    const payerName = persisted.members.find((m) => m.id === target.paidBy)?.name ?? 'Member';
    recordActivity({
      type: 'expense_deleted',
      summary: `Deleted expense "${target.title}"`,
      detail: `Was ${formatRupees(target.amountPaise)} paid by ${payerName}`,
      category: target.category ?? 'other',
      amountPaise: target.amountPaise,
    });

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

    const fromName = persisted.members.find((m) => m.id === fromId)?.name ?? 'Member';
    const toName = persisted.members.find((m) => m.id === toId)?.name ?? 'Member';
    recordActivity({
      type: 'settlement_recorded',
      summary: `${fromName} paid ${toName}`,
      detail: `Recorded settlement of ${formatRupees(amountPaise)}`,
      category: 'other',
      amountPaise,
    });

    persistAndNotify({
      ...persisted,
      settlements: [...persisted.settlements, settlement],
    });

    return { ok: true, error: null, settlement: cloneSnapshot(settlement) };
  }

  function undoSettlement(settlementId) {
    const target = persisted.settlements.find((s) => s.id === settlementId);
    if (!target) {
      return { ok: true, error: null };
    }

    const fromName = persisted.members.find((m) => m.id === target.fromId)?.name ?? 'Member';
    const toName = persisted.members.find((m) => m.id === target.toId)?.name ?? 'Member';
    recordActivity({
      type: 'settlement_undone',
      summary: `Undid payment ${fromName} → ${toName}`,
      detail: `Reversed ${formatRupees(target.amountPaise)}`,
      category: 'other',
      amountPaise: target.amountPaise,
    });

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

  function setViewerMember(memberIdOrAll) {
    if (memberIdOrAll !== 'all') {
      const exists = persisted.members.some((m) => m.id === memberIdOrAll);
      if (!exists) {
        return { ok: false, error: 'Selected perspective member does not exist.' };
      }
    }

    viewerMemberId = memberIdOrAll;
    notify();
    return { ok: true, error: null };
  }

  function setSearchQuery(query) {
    searchQuery = typeof query === 'string' ? query : '';
    notify();
    return { ok: true, error: null };
  }

  function setCategoryFilter(categoryOrAll) {
    if (categoryOrAll !== 'all' && !VALID_CATEGORIES.has(categoryOrAll)) {
      return { ok: false, error: 'Unknown category filter.' };
    }
    activeCategoryFilter = categoryOrAll;
    notify();
    return { ok: true, error: null };
  }

  function setGroupName(rawName) {
    const clean = normalizeMemberName(rawName);
    if (!clean) {
      return { ok: false, error: 'Group name cannot be empty.' };
    }
    if (clean.length > 40) {
      return { ok: false, error: 'Group name cannot exceed 40 characters.' };
    }
    hasCustomizedGroups = true;
    groupsMeta = {
      ...groupsMeta,
      groups: groupsMeta.groups.map((g) =>
        g.id === groupsMeta.activeGroupId ? { ...g, name: clean } : g
      ),
    };
    saveGroupsMeta(groupsMeta, storageBackend);
    notify();
    return { ok: true, error: null };
  }

  function createGroup(rawName) {
    const clean = normalizeMemberName(rawName);
    if (!clean) {
      return { ok: false, error: 'Group name cannot be empty.' };
    }
    if (clean.length > 40) {
      return { ok: false, error: 'Group name cannot exceed 40 characters.' };
    }
    const duplicate = groupsMeta.groups.some((g) => g.name.toLowerCase() === clean.toLowerCase());
    if (duplicate) {
      return { ok: false, error: `Group "${clean}" already exists.` };
    }

    hasCustomizedGroups = true;
    const newGroup = {
      id: createUniqueId('grp'),
      name: clean,
      state: createInitialState(),
      createdAt: Date.now(),
    };

    groupsMeta = {
      activeGroupId: newGroup.id,
      groups: [...groupsMeta.groups.map((g) => (g.id === groupsMeta.activeGroupId ? { ...g, state: persisted } : g)), newGroup],
    };
    persisted = newGroup.state;
    activeMemberFilter = 'all';
    activeCategoryFilter = 'all';
    viewerMemberId = 'all';
    searchQuery = '';

    saveState(persisted, storageBackend);
    saveGroupsMeta(groupsMeta, storageBackend);
    recordActivity({
      type: 'group_created',
      summary: `Created group "${clean}"`,
      detail: 'Started a new shared expense group',
      category: 'other',
    });
    notify();
    return { ok: true, error: null, group: { id: newGroup.id, name: newGroup.name } };
  }

  function switchGroup(groupId) {
    const target = groupsMeta.groups.find((g) => g.id === groupId);
    if (!target) {
      return { ok: false, error: 'Selected group does not exist.' };
    }
    if (target.id === groupsMeta.activeGroupId) {
      return { ok: true, error: null };
    }

    hasCustomizedGroups = true;
    groupsMeta = {
      activeGroupId: target.id,
      groups: groupsMeta.groups.map((g) =>
        g.id === groupsMeta.activeGroupId ? { ...g, state: persisted } : g
      ),
    };
    persisted = cloneSnapshot(target.state);
    activeMemberFilter = 'all';
    activeCategoryFilter = 'all';
    viewerMemberId = 'all';
    searchQuery = '';

    const saved = saveState(persisted, storageBackend);
    saveGroupsMeta(groupsMeta, storageBackend);
    storageWarning = saved.ok ? null : saved.error;
    notify();
    return { ok: true, error: null };
  }

  function resetGroup() {
    const activeName =
      groupsMeta.groups.find((g) => g.id === groupsMeta.activeGroupId)?.name ?? DEFAULT_GROUP_NAME;
    if (persisted.members.length > 0 || persisted.expenses.length > 0 || persisted.settlements.length > 0) {
      recordActivity({
        type: 'group_reset',
        summary: `Reset "${activeName}"`,
        detail: 'Cleared active group data (audit history preserved)',
        category: 'other',
      });
    }
    persisted = createInitialState();
    syncActiveGroupRecord(persisted);
    activeMemberFilter = 'all';
    activeCategoryFilter = 'all';
    viewerMemberId = 'all';
    searchQuery = '';
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
    setCategoryFilter,
    setViewerMember,
    setSearchQuery,
    setGroupName,
    createGroup,
    switchGroup,
    resetGroup,
  };
}
