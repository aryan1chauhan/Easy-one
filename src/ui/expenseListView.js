/**
 * Splitwise-style Expense History view:
 * search bar, member filter, "View as" perspective (lent/borrowed/not involved),
 * month grouping headers, date badges, category SVG icons, and Delete action.
 */

import { MIN_MEMBERS_FOR_EXPENSE } from '../core/validators.js';
import { formatRupees } from '../core/money.js';
import { el, formatDateParts, setChildren, svgIcon } from './domHelpers.js';

const SPLIT_LABELS = {
  equal: 'Equal',
  exact: 'Exact',
  percentage: 'Percentage',
};

function computeViewerInvolvement(expense, viewerId, viewerName) {
  const shareEntry = expense.shares.find((s) => s.memberId === viewerId);
  const viewerShare = shareEntry ? shareEntry.sharePaise : 0;
  const viewerPaid = expense.paidBy === viewerId ? expense.amountPaise : 0;

  if (viewerPaid === 0 && !shareEntry) {
    return { text: 'Not involved', className: 'involvement-muted' };
  }

  const net = viewerPaid - viewerShare;
  if (net > 0) {
    return { text: `${viewerName} lent ${formatRupees(net)}`, className: 'involvement-positive' };
  }
  if (net < 0) {
    return { text: `${viewerName} borrowed ${formatRupees(Math.abs(net))}`, className: 'involvement-negative' };
  }
  return { text: 'Settled (₹0)', className: 'involvement-muted' };
}

/**
 * Mounts the Expense History view with search, member filter, and perspective selector.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} filterSlotEl
 * @param {HTMLElement} toolbarSlotEl
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {{ onOpenAddExpense?: () => void }} [options]
 */
export function mountExpenseListView(container, filterSlotEl, toolbarSlotEl, store, options = {}) {
  const filterSelect = el('select', {
    attrs: {
      id: 'expense-member-filter',
      'aria-label': 'Filter expenses by member',
    },
  });
  filterSlotEl.replaceChildren(filterSelect);

  const toolbar = el('div', { className: 'expense-toolbar' });
  const searchInput = el('input', {
    className: 'expense-search-input',
    attrs: {
      id: 'expense-search-input',
      type: 'text',
      placeholder: 'Search title or payer...',
      'aria-label': 'Search expenses by title or payer',
      autocomplete: 'off',
    },
  });
  const viewerSelect = el('select', {
    className: 'expense-viewer-select',
    attrs: {
      id: 'expense-viewer-select',
      'aria-label': 'View expenses as member',
    },
  });
  toolbar.append(searchInput, viewerSelect);

  const overallBanner = el('div', { className: 'overall-banner', attrs: { hidden: '' } });
  toolbarSlotEl.replaceChildren(toolbar, overallBanner);

  filterSelect.addEventListener('change', () => {
    store.setMemberFilter(filterSelect.value);
  });
  viewerSelect.addEventListener('change', () => {
    store.setViewerMember(viewerSelect.value);
  });
  searchInput.addEventListener('input', () => {
    store.setSearchQuery(searchInput.value);
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

  function renderOverallBanner(snapshot, nameById) {
    if (snapshot.viewerMemberId === 'all') {
      overallBanner.hidden = true;
      overallBanner.textContent = '';
      return;
    }

    const bal = snapshot.balances.find((b) => b.memberId === snapshot.viewerMemberId);
    if (!bal) {
      overallBanner.hidden = true;
      return;
    }

    const name = nameById.get(snapshot.viewerMemberId) ?? bal.name;
    overallBanner.className = 'overall-banner';
    if (bal.netPaise > 0) {
      overallBanner.textContent = `Overall, ${name} is owed ${formatRupees(bal.netPaise)}`;
      overallBanner.classList.add('is-positive');
    } else if (bal.netPaise < 0) {
      overallBanner.textContent = `Overall, ${name} owes ${formatRupees(Math.abs(bal.netPaise))}`;
      overallBanner.classList.add('is-negative');
    } else {
      overallBanner.textContent = `Overall, ${name} is all settled (₹0)`;
    }
    overallBanner.hidden = false;
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

    const viewerOptions = [
      el('option', { text: 'View: Group Totals', attrs: { value: 'all' } }),
      ...snapshot.members.map((m) => el('option', { text: `View as ${m.name}`, attrs: { value: m.id } })),
    ];
    setChildren(viewerSelect, viewerOptions);
    viewerSelect.value = snapshot.viewerMemberId;
    viewerSelect.disabled = snapshot.members.length === 0;

    if (searchInput.value !== snapshot.searchQuery) {
      searchInput.value = snapshot.searchQuery;
    }
    searchInput.disabled = snapshot.expenses.length === 0;

    renderOverallBanner(snapshot, nameById);

    const visibleExpenses = snapshot.filteredExpenses;
    if (visibleExpenses.length === 0) {
      let emptyMessage = 'No expenses added yet.';
      if (snapshot.expenses.length > 0 && snapshot.searchQuery.trim()) {
        emptyMessage = `No expenses matching "${snapshot.searchQuery.trim()}".`;
      } else if (snapshot.activeMemberFilter !== 'all' && snapshot.expenses.length > 0) {
        const selectedName = nameById.get(snapshot.activeMemberFilter) ?? 'member';
        emptyMessage = `No expenses involving ${selectedName}.`;
      } else if (snapshot.activeCategoryFilter !== 'all' && snapshot.expenses.length > 0) {
        emptyMessage = `No expenses in ${snapshot.activeCategoryFilter}.`;
      }

      const emptyWrap = el('div', { className: 'empty-state empty-state-actionable' });
      emptyWrap.append(
        el('p', {
          className: 'empty-state-title',
          text: emptyMessage,
        })
      );
      if (snapshot.expenses.length === 0) {
        emptyWrap.append(
          el('p', {
            className: 'empty-state-sub',
            text: snapshot.members.length >= MIN_MEMBERS_FOR_EXPENSE
              ? 'Record shared bills with Equal, Exact, or Percentage splits to update balances instantly.'
              : 'Add at least 2 members above to start logging shared expenses.',
          })
        );
        if (snapshot.members.length >= MIN_MEMBERS_FOR_EXPENSE && typeof options.onOpenAddExpense === 'function') {
          const cta = el('button', {
            className: 'btn btn-primary btn-sm',
            text: '+ Add first expense',
            attrs: { type: 'button' },
          });
          cta.addEventListener('click', options.onOpenAddExpense);
          emptyWrap.append(cta);
        }
      }
      setChildren(container, [emptyWrap]);
      return;
    }

    const list = el('div', { className: 'expense-list' });
    let lastMonthYear = null;
    const viewerName =
      snapshot.viewerMemberId === 'all' ? '' : (nameById.get(snapshot.viewerMemberId) ?? 'Member');

    for (const expense of visibleExpenses) {
      const { month, day, monthYear } = formatDateParts(expense.createdAt);
      if (monthYear !== lastMonthYear) {
        lastMonthYear = monthYear;
        list.append(el('div', { className: 'month-divider', text: monthYear }));
      }

      const card = el('article', { className: 'expense-card' });
      const rowMain = el('div', { className: 'expense-ledger-row' });

      const dateCol = el('div', { className: 'ledger-date' });
      dateCol.append(
        el('span', { className: 'ledger-month', text: month }),
        el('span', { className: 'ledger-day', text: day })
      );

      const category = expense.category ?? 'other';
      const iconTile = el('div', { className: `icon-tile icon-tile-${category}` });
      iconTile.append(svgIcon(category, { size: 18 }));

      const bodyCol = el('div', { className: 'ledger-body' });
      const titleLine = el('div', { className: 'ledger-title-line' });
      const titleEl = el('h3', { className: 'expense-card-title', text: expense.title });
      const splitLabel = SPLIT_LABELS[expense.splitType] ?? 'Equal';
      const modeBadge = el('span', { className: 'badge badge-neutral', text: splitLabel });
      titleLine.append(titleEl, modeBadge);

      const payerName = nameById.get(expense.paidBy) ?? 'Member';
      const metaText = el('div', {
        className: 'expense-meta-text',
        text: `Paid by ${payerName} · ${formatSplitSummary(expense, nameById)}`,
      });
      bodyCol.append(titleLine, metaText);

      const rightCol = el('div', { className: 'ledger-right' });
      rightCol.append(
        el('span', { className: 'expense-card-amount', text: formatRupees(expense.amountPaise) })
      );

      if (snapshot.viewerMemberId !== 'all') {
        const inv = computeViewerInvolvement(expense, snapshot.viewerMemberId, viewerName);
        rightCol.append(el('span', { className: `ledger-involvement ${inv.className}`, text: inv.text }));
      }

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
      rightCol.append(deleteBtn);

      rowMain.append(dateCol, iconTile, bodyCol, rightCol);
      card.append(rowMain);
      list.append(card);
    }

    setChildren(container, [list]);
  }

  return { render };
}
