/**
 * Splitwise-style Friends & Debt Breakdown view:
 * displays per-member summary cards, nested pairwise payment arrows,
 * and a "Show / Hide settled-up members" toggle.
 */

import { formatRupees } from '../core/money.js';
import { avatarBadge, el, setChildren } from './domHelpers.js';

/**
 * Mounts the Friends balance breakdown cards controller.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} summaryBadgeEl
 */
export function mountFriendsView(container, summaryBadgeEl) {
  let showSettled = false;

  function render(snapshot) {
    const { balances, settlementPlan, viewerMemberId, members } = snapshot;

    const viewerBal = viewerMemberId !== 'all' ? balances.find((b) => b.memberId === viewerMemberId) : null;
    if (viewerBal) {
      summaryBadgeEl.textContent =
        viewerBal.netPaise > 0
          ? `${viewerBal.name} is owed ${formatRupees(viewerBal.netPaise)}`
          : viewerBal.netPaise < 0
            ? `${viewerBal.name} owes ${formatRupees(Math.abs(viewerBal.netPaise))}`
            : `${viewerBal.name} settled`;
    } else {
      const activeDebts = balances.filter((b) => b.netPaise !== 0).length;
      summaryBadgeEl.textContent = activeDebts === 0 ? 'All settled' : `${activeDebts} active`;
    }

    if (members.length === 0) {
      setChildren(container, [
        el('p', { className: 'empty-state', text: 'Add group members to see per-friend balances.' }),
      ]);
      return;
    }

    const unsettled = balances.filter((b) => b.netPaise !== 0);
    const settled = balances.filter((b) => b.netPaise === 0);
    const visible = showSettled ? balances : (unsettled.length > 0 ? unsettled : balances);

    const list = el('div', { className: 'friends-list' });
    visible.forEach((entry) => {
      const idx = members.findIndex((m) => m.id === entry.memberId);
      const card = el('div', { className: 'friend-card' });

      const topRow = el('div', { className: 'friend-card-top' });
      const identity = el('div', { className: 'friend-identity' });
      identity.append(
        avatarBadge(entry.name, idx >= 0 ? idx : 0, 'avatar-md'),
        (() => {
          const textWrap = el('div', { className: 'friend-name-wrap' });
          textWrap.append(
            el('div', { className: 'friend-name', text: entry.name }),
            el('div', {
              className: 'friend-sub',
              text: `Paid ${formatRupees(entry.expensePaidPaise)} · Share ${formatRupees(entry.expenseSharePaise)}`,
            })
          );
          return textWrap;
        })()
      );

      const statusWrap = el('div', { className: 'friend-status' });
      if (entry.netPaise > 0) {
        statusWrap.append(
          el('div', { className: 'friend-status-label is-positive', text: 'gets back' }),
          el('div', { className: 'friend-status-amt is-positive', text: formatRupees(entry.netPaise) })
        );
      } else if (entry.netPaise < 0) {
        statusWrap.append(
          el('div', { className: 'friend-status-label is-negative', text: 'owes' }),
          el('div', { className: 'friend-status-amt is-negative', text: formatRupees(Math.abs(entry.netPaise)) })
        );
      } else {
        statusWrap.append(
          el('div', { className: 'friend-status-label', text: 'settled up' }),
          el('div', { className: 'friend-status-amt', text: '₹0' })
        );
      }

      topRow.append(identity, statusWrap);
      card.append(topRow);

      // Pairwise breakdown sub-lines from the minimum-transaction settlement plan
      const relatedPayments = settlementPlan.filter(
        (p) => p.fromId === entry.memberId || p.toId === entry.memberId
      );
      if (relatedPayments.length > 0) {
        const subLines = el('div', { className: 'friend-breakdown' });
        for (const p of relatedPayments) {
          const lineText =
            p.toId === entry.memberId
              ? `${p.fromName} owes ${entry.name} ${formatRupees(p.amountPaise)}`
              : `${entry.name} owes ${p.toName} ${formatRupees(p.amountPaise)}`;
          subLines.append(el('div', { className: 'friend-breakdown-line', text: lineText }));
        }
        card.append(subLines);
      }

      list.append(card);
    });

    const nodes = [list];
    if (settled.length > 0 && unsettled.length > 0) {
      const toggleBtn = el('button', {
        className: 'btn btn-secondary btn-sm settled-toggle-btn',
        text: showSettled
          ? `Hide ${settled.length} settled-up ${settled.length === 1 ? 'member' : 'members'}`
          : `Show ${settled.length} settled-up ${settled.length === 1 ? 'member' : 'members'}`,
        attrs: { type: 'button' },
      });
      toggleBtn.addEventListener('click', () => {
        showSettled = !showSettled;
        render(snapshot);
      });
      nodes.push(toggleBtn);
    }

    setChildren(container, nodes);
  }

  return { render };
}
