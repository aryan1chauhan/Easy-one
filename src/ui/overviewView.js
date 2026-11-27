/**
 * Overview Hero controller (RupeeSync Home + Splitwise Group Banner):
 * renders group summary, dual spend/settled meters, member avatar strip,
 * inline quick-add member control, quick action pills, and next pending settlement teaser.
 */

import { formatRupees } from '../core/money.js';
import { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS, MIN_MEMBERS_FOR_EXPENSE } from '../core/validators.js';
import { avatarBadge, clearInlineError, el, formatActivityTimestamp, setChildren, setInlineError, svgIcon } from './domHelpers.js';

/**
 * Populates the Sample Test Case (Rahul, Priya, Aman + Dinner, Cab, Snacks).
 *
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
function loadSampleGroup(store) {
  const r = store.addMember('Rahul');
  const p = store.addMember('Priya');
  const a = store.addMember('Aman');
  if (!r.ok || !p.ok || !a.ok) {
    return;
  }
  const all = [r.member.id, p.member.id, a.member.id];
  store.addExpense({ title: 'Dinner', amount: '900', paidBy: r.member.id, splitType: 'equal', splitAmong: all, category: 'food' });
  store.addExpense({ title: 'Cab', amount: '300', paidBy: p.member.id, splitType: 'equal', splitAmong: [p.member.id, a.member.id], category: 'cab' });
  store.addExpense({ title: 'Snacks', amount: '150', paidBy: a.member.id, splitType: 'equal', splitAmong: all, category: 'food' });
}

/**
 * Mounts the interactive Overview Hero + Action Strip + Settle Teaser.
 *
 * @param {{
 *   heroEl: HTMLElement,
 *   settleEl: HTMLElement,
 *   activityEl: HTMLElement,
 *   store: ReturnType<import('../state/store.js').createStore>,
 *   onNavigate: (viewId: string) => void,
 *   onOpenAddExpense: () => void,
 * }} deps
 */
export function mountOverviewView({ heroEl, settleEl, activityEl, store, onNavigate, onOpenAddExpense }) {
  let showQuickAddInput = false;

  // Persistent quick-member form elements so validation messages & focus hold cleanly
  const quickForm = el('form', { className: 'quick-member-form', attrs: { novalidate: '', hidden: '' } });
  const quickInput = el('input', {
    className: 'quick-member-input',
    attrs: {
      id: 'quick-member-input',
      type: 'text',
      placeholder: 'Add member name (e.g. Rahul)',
      maxlength: String(MAX_MEMBER_NAME_LENGTH),
      autocomplete: 'off',
    },
  });
  const quickSubmit = el('button', {
    className: 'btn btn-primary btn-sm',
    text: 'Add',
    attrs: { type: 'submit' },
  });
  const quickError = el('p', {
    className: 'error-msg',
    attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' },
  });
  quickForm.append(quickInput, quickSubmit);

  quickInput.addEventListener('input', () => clearInlineError(quickError));
  quickForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showQuickAddInput = true;
    const res = store.addMember(quickInput.value);
    if (!res.ok) {
      setInlineError(quickError, res.error);
      quickInput.focus();
      return;
    }
    clearInlineError(quickError);
    quickInput.value = '';
    quickInput.focus();
  });

  function renderHero(snapshot) {
    const { members, balances, settlementPlan, totalSpendPaise, groupName, viewerMemberId, activeCategoryFilter } = snapshot;
    const totalPendingPaise = settlementPlan.reduce((sum, p) => sum + p.amountPaise, 0);
    const settledPaise = snapshot.settlements.reduce((sum, s) => sum + s.amountPaise, 0);
    const totalDebtScope = settledPaise + totalPendingPaise;
    const settledRatio = totalDebtScope > 0 ? Math.min(100, Math.round((settledPaise / totalDebtScope) * 100)) : 100;

    const card = el('section', { className: 'hero-card', attrs: { 'aria-label': 'Group overview' } });

    // Top row: Group pill + Member badge
    const topRow = el('div', { className: 'hero-top-row' });
    const groupPillBtn = el('button', {
      className: 'hero-group-pill',
      attrs: { type: 'button', title: 'Switch or rename group' },
    });
    groupPillBtn.append(
      svgIcon('group', { size: 15 }),
      el('span', { text: groupName }),
      el('span', { className: 'hero-pill-count', text: `${members.length} / ${MAX_MEMBERS}` })
    );
    groupPillBtn.addEventListener('click', () => onNavigate('group'));

    const viewerPill = el('div', { className: 'hero-viewer-wrap' });
    if (viewerMemberId !== 'all') {
      const resetViewBtn = el('button', {
        className: 'hero-reset-view-btn',
        text: 'Viewing filtered · Show all',
        attrs: { type: 'button' },
      });
      resetViewBtn.addEventListener('click', () => store.setViewerMember('all'));
      viewerPill.append(resetViewBtn);
    } else if (members.length === 0) {
      const sampleBtn = el('button', {
        className: 'btn btn-secondary btn-sm',
        text: 'Try sample group',
        attrs: { type: 'button' },
      });
      sampleBtn.addEventListener('click', () => loadSampleGroup(store));
      viewerPill.append(sampleBtn);
    }
    topRow.append(groupPillBtn, viewerPill);

    // Main balance hero headline
    const balanceBlock = el('div', { className: 'hero-balance-block' });
    const viewerBal = viewerMemberId !== 'all' ? balances.find((b) => b.memberId === viewerMemberId) : null;
    if (viewerBal) {
      const statusLabel =
        viewerBal.netPaise > 0
          ? `Overall, ${viewerBal.name} is owed`
          : viewerBal.netPaise < 0
            ? `Overall, ${viewerBal.name} owes`
            : `${viewerBal.name} is all settled up`;
      balanceBlock.append(
        el('p', { className: 'hero-eyebrow', text: statusLabel }),
        el('div', {
          className: `hero-amount ${viewerBal.netPaise > 0 ? 'is-positive' : viewerBal.netPaise < 0 ? 'is-negative' : ''}`,
          text: formatRupees(Math.abs(viewerBal.netPaise)),
        })
      );
    } else {
      balanceBlock.append(
        el('p', { className: 'hero-eyebrow', text: 'Total Group Spend' }),
        el('div', { className: 'hero-amount', text: formatRupees(totalSpendPaise) })
      );
    }

    // Dual RupeeSync metrics strip
    const metersCard = el('div', { className: 'hero-meters-card' });
    const spendMeter = el('div', { className: 'hero-meter-col' });
    const m1Top = el('div', { className: 'meter-head' });
    m1Top.append(
      el('span', { className: 'meter-val', text: formatRupees(totalSpendPaise) }),
      el('span', {
        className: 'meter-sub',
        text: snapshot.expenses.length === 1 ? '1 expense' : `${snapshot.expenses.length} expenses`,
      })
    );
    const m1Track = el('div', { className: 'meter-track' });
    const m1Fill = el('div', { className: 'meter-fill meter-fill-indigo' });
    m1Fill.style.width = totalSpendPaise > 0 ? '100%' : '0%';
    m1Track.append(m1Fill);
    spendMeter.append(m1Top, m1Track, el('span', { className: 'meter-caption', text: 'Group spending' }));

    const settleMeter = el('div', { className: 'hero-meter-col' });
    const m2Top = el('div', { className: 'meter-head' });
    m2Top.append(
      el('span', { className: 'meter-val', text: formatRupees(totalPendingPaise) }),
      el('span', { className: 'meter-sub', text: `${settlementPlan.length} pending` })
    );
    const m2Track = el('div', { className: 'meter-track' });
    const m2Fill = el('div', { className: 'meter-fill meter-fill-peach' });
    m2Fill.style.width = `${settledRatio}%`;
    m2Track.append(m2Fill);
    settleMeter.append(m2Top, m2Track, el('span', { className: 'meter-caption', text: `${settledRatio}% debts cleared` }));
    metersCard.append(spendMeter, settleMeter);

    // Recent Members / Payees strip (RupeeSync avatar row)
    const payeesSection = el('div', { className: 'hero-payees' });
    const payeesHead = el('div', { className: 'hero-payees-head' });
    payeesHead.append(
      el('span', { className: 'hero-payees-title', text: 'Group Members' }),
      (() => {
        const manageBtn = el('button', { className: 'link-btn', text: 'Manage all', attrs: { type: 'button' } });
        manageBtn.addEventListener('click', () => onNavigate('group'));
        return manageBtn;
      })()
    );

    const avatarRow = el('div', { className: 'payee-avatar-row' });
    members.forEach((member, idx) => {
      const isViewing = viewerMemberId === member.id;
      const chipBtn = el('button', {
        className: `payee-item ${isViewing ? 'is-selected' : ''}`,
        attrs: { type: 'button', title: `View balances as ${member.name}` },
      });
      chipBtn.append(
        avatarBadge(member.name, idx, 'avatar-md'),
        el('span', { className: 'payee-name', text: member.name })
      );
      chipBtn.addEventListener('click', () => {
        store.setViewerMember(isViewing ? 'all' : member.id);
      });
      avatarRow.append(chipBtn);
    });

    if (members.length < MAX_MEMBERS) {
      const addCircleBtn = el('button', {
        className: 'payee-item payee-add-btn',
        attrs: { type: 'button', title: 'Add group member' },
      });
      const circle = el('span', { className: 'avatar-circle avatar-md tone-add' });
      circle.append(svgIcon('plus', { size: 18 }));
      addCircleBtn.append(circle, el('span', { className: 'payee-name', text: 'Add' }));
      addCircleBtn.addEventListener('click', () => {
        showQuickAddInput = !showQuickAddInput;
        quickForm.hidden = !showQuickAddInput && members.length >= MIN_MEMBERS_FOR_EXPENSE;
        if (!quickForm.hidden) {
          quickInput.focus();
        }
      });
      avatarRow.append(addCircleBtn);
    }

    const shouldShowQuickForm = showQuickAddInput || members.length < MIN_MEMBERS_FOR_EXPENSE;
    quickForm.hidden = !shouldShowQuickForm || members.length >= MAX_MEMBERS;
    payeesSection.append(payeesHead, avatarRow, quickForm, quickError);

    // Splitwise-style action pills strip (Settle up, Charts, Friends, Add expense)
    const actionsRow = el('div', { className: 'hero-actions-strip' });
    const addExpPill = el('button', {
      className: 'btn btn-primary btn-sm',
      attrs: { type: 'button' },
    });
    addExpPill.append(svgIcon('plus', { size: 15 }), el('span', { text: 'Add expense' }));
    addExpPill.disabled = members.length < MIN_MEMBERS_FOR_EXPENSE;
    addExpPill.addEventListener('click', onOpenAddExpense);

    const settlePill = el('button', { className: 'btn btn-secondary btn-sm', text: 'Settle up', attrs: { type: 'button' } });
    settlePill.addEventListener('click', () => onNavigate('friends'));

    const chartsPill = el('button', { className: 'btn btn-secondary btn-sm', text: 'Charts', attrs: { type: 'button' } });
    chartsPill.addEventListener('click', () => onNavigate('analytics'));

    actionsRow.append(addExpPill, settlePill, chartsPill);

    if (activeCategoryFilter !== 'all') {
      const clearCat = el('button', {
        className: 'btn btn-secondary btn-sm',
        text: `Category: ${activeCategoryFilter} ×`,
        attrs: { type: 'button' },
      });
      clearCat.addEventListener('click', () => store.setCategoryFilter('all'));
      actionsRow.append(clearCat);
    }

    const heroMainGrid = el('div', { className: 'hero-main-grid' });
    const heroSummaryCol = el('div', { className: 'hero-summary-col' });
    heroSummaryCol.append(balanceBlock, actionsRow);

    const heroDetailsCol = el('div', { className: 'hero-details-col' });
    heroDetailsCol.append(metersCard, payeesSection);

    heroMainGrid.append(heroSummaryCol, heroDetailsCol);
    card.append(topRow, heroMainGrid);
    setChildren(heroEl, [card]);
  }

  function renderAsideSettle(snapshot) {
    const plan = snapshot.settlementPlan;
    const card = el('section', { className: 'card aside-card', attrs: { 'aria-label': 'Settle up snapshot' } });
    const head = el('div', { className: 'card-header' });
    head.append(
      el('h2', { className: 'card-title', text: 'Pending Settle Up' }),
      (() => {
        const allBtn = el('button', { className: 'link-btn', text: 'See all', attrs: { type: 'button' } });
        allBtn.addEventListener('click', () => onNavigate('friends'));
        return allBtn;
      })()
    );

    if (snapshot.members.length < MIN_MEMBERS_FOR_EXPENSE) {
      card.append(
        head,
        el('div', { className: 'aside-empty', text: 'Add at least 2 members to calculate minimum transfers.' })
      );
      setChildren(settleEl, [card]);
      return;
    }

    if (plan.length === 0) {
      card.append(
        head,
        el('div', {
          className: 'aside-empty',
          text: snapshot.expenses.length === 0
            ? 'No pending transfers yet. Add an expense to split balances.'
            : 'All group balances are settled (₹0 pending).',
        })
      );
      setChildren(settleEl, [card]);
      return;
    }

    const list = el('div', { className: 'aside-settle-list' });
    for (const payment of plan.slice(0, 4)) {
      const row = el('div', { className: 'aside-settle-row' });
      const info = el('div', { className: 'aside-settle-info' });
      info.append(
        el('span', { className: 'aside-settle-names', text: `${payment.fromName} → ${payment.toName}` }),
        el('span', { className: 'aside-settle-amt', text: formatRupees(payment.amountPaise) })
      );
      const settleBtn = el('button', {
        className: 'btn btn-secondary btn-sm',
        text: 'Settle',
        attrs: { type: 'button', title: `Mark ${payment.fromName} pays ${payment.toName} settled` },
      });
      settleBtn.addEventListener('click', () => {
        settleBtn.disabled = true;
        store.markAsSettled(payment);
      });
      row.append(info, settleBtn);
      list.append(row);
    }

    card.append(head, list);
    if (plan.length > 4) {
      const moreBtn = el('button', {
        className: 'btn btn-secondary btn-sm aside-more-btn',
        text: `View all ${plan.length} payments`,
        attrs: { type: 'button' },
      });
      moreBtn.addEventListener('click', () => onNavigate('friends'));
      card.append(moreBtn);
    }

    setChildren(settleEl, [card]);
  }

  function renderAsideActivity(snapshot) {
    const feed = snapshot.activityFeed ?? [];
    const card = el('section', { className: 'card aside-card', attrs: { 'aria-label': 'Recent activity preview' } });
    const head = el('div', { className: 'card-header' });
    const titleGroup = el('div', { className: 'aside-title-lock' });
    titleGroup.append(
      el('h2', { className: 'card-title', text: 'Recent Activity' }),
      el('span', { className: 'badge badge-lock', text: `Permanent (${feed.length})` })
    );
    const fullBtn = el('button', { className: 'link-btn', text: 'Full log', attrs: { type: 'button' } });
    fullBtn.addEventListener('click', () => onNavigate('activity'));
    head.append(titleGroup, fullBtn);

    if (feed.length === 0) {
      card.append(
        head,
        el('div', {
          className: 'aside-empty',
          text: 'Every member, expense, and settlement action is recorded permanently here.',
        })
      );
      setChildren(activityEl, [card]);
      return;
    }

    const list = el('div', { className: 'aside-activity-list' });
    for (const item of feed.slice(0, 6)) {
      const row = el('div', { className: 'aside-activity-row' });
      row.append(
        el('div', { className: 'aside-activity-summary', text: item.summary }),
        el('div', {
          className: 'aside-activity-meta',
          text: item.detail
            ? `${item.detail} · ${formatActivityTimestamp(item.createdAt)}`
            : formatActivityTimestamp(item.createdAt),
        })
      );
      list.append(row);
    }

    card.append(head, list);
    setChildren(activityEl, [card]);
  }

  function render(snapshot) {
    renderHero(snapshot);
    renderAsideSettle(snapshot);
    renderAsideActivity(snapshot);
  }

  return { render };
}
