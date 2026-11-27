/**
 * Expense History view: newest-first cards, member filter dropdown, split breakdown, and delete action.
 */

import { formatRupees } from '../core/money.js';
import { el, setChildren } from './domHelpers.js';

const SPLIT_LABELS = {
  equal: 'Equal',
  exact: 'Exact',
  percentage: 'Percentage',
};

/**
 * Mounts the Expense History view and member filter selector.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} filterSlotEl
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function mountExpenseListView(container, filterSlotEl, store) {
  const filterSelect = el('select', {
    attrs: {
      id: 'expense-member-filter',
      'aria-label': 'Filter expenses by member',
    },
  });
  filterSlotEl.replaceChildren(filterSelect);

  filterSelect.addEventListener('change', () => {
    store.setMemberFilter(filterSelect.value);
  });

  function formatSplitSummary(expense, nameById) {
    if (expense.splitType === 'equal') {
      const names = expense.shares.map((s) => nameById.get(s.memberId) ?? 'Member').join(', ');
      return `Split equally among ${names}`;
    }

    return expense.shares
      .map((s) => {
        const name = nameById.get(s.memberId) ?? 'Member';
        const amountText = formatRupees(s.sharePaise);
        if (expense.splitType === 'percentage' && s.percent !== undefined) {
          return `${name}: ${s.percent}% (${amountText})`;
        }
        return `${name}: ${amountText}`;
      })
      .join(', ');
  }

  function render(snapshot) {
    const nameById = new Map(snapshot.members.map((m) => [m.id, m.name]));

    const filterOptions = [
      el('option', { text: 'All Members', attrs: { value: 'all' } }),
      ...snapshot.members.map((m) => el('option', { text: m.name, attrs: { value: m.id } })),
    ];
    setChildren(filterSelect, filterOptions);
    filterSelect.value = snapshot.activeMemberFilter;
    filterSelect.disabled = snapshot.members.length === 0;

    const visibleExpenses = snapshot.filteredExpenses;
    if (visibleExpenses.length === 0) {
      let emptyMessage = 'No expenses added yet.';
      if (snapshot.activeMemberFilter !== 'all' && snapshot.expenses.length > 0) {
        const selectedName = nameById.get(snapshot.activeMemberFilter) ?? 'member';
        emptyMessage = `No expenses involving ${selectedName}.`;
      }
      setChildren(container, [el('p', { className: 'empty-state', text: emptyMessage })]);
      return;
    }

    const list = el('div', { className: 'expense-list' });
    for (const expense of visibleExpenses) {
      const card = el('article', { className: 'expense-card' });

      const topRow = el('div', { className: 'expense-card-top' });
      const titleEl = el('h3', { className: 'expense-card-title', text: expense.title });
      const amountEl = el('span', {
        className: 'expense-card-amount',
        text: formatRupees(expense.amountPaise),
      });
      topRow.append(titleEl, amountEl);

      const metaRow = el('div', { className: 'expense-card-meta' });
      const payerName = nameById.get(expense.paidBy) ?? 'Member';
      const splitLabel = SPLIT_LABELS[expense.splitType] ?? 'Equal';
      const metaText = el('span', {
        className: 'expense-meta-text',
        text: `Paid by ${payerName} · ${splitLabel}: ${formatSplitSummary(expense, nameById)}`,
      });

      const deleteBtn = el('button', {
        className: 'btn btn-danger-outline btn-sm',
        text: 'Delete',
        attrs: {
          type: 'button',
          'aria-label': `Delete ${expense.title}`,
        },
      });
      deleteBtn.addEventListener('click', () => {
        deleteBtn.disabled = true;
        store.deleteExpense(expense.id);
      });

      metaRow.append(metaText, deleteBtn);
      card.append(topRow, metaRow);
      list.append(card);
    }

    setChildren(container, [list]);
  }

  return { render };
}
