/**
 * Minimum-transaction Settle Up view with "Mark as settled" and Recorded Settlements undo list.
 */

import { formatRupees } from '../core/money.js';
import { clearInlineError, el, setChildren, setInlineError } from './domHelpers.js';

/**
 * Mounts the Settle Up view.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} countBadgeEl
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function mountSettleUpView(container, countBadgeEl, store) {
  const errorEl = el('p', {
    className: 'error-msg',
    attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' },
  });
  const listSlot = el('div');

  container.replaceChildren(errorEl, listSlot);

  function render(snapshot) {
    const plan = snapshot.settlementPlan;
    const count = plan.length;
    countBadgeEl.textContent = count === 1 ? '1 payment' : `${count} payments`;

    const nodes = [];

    if (count === 0) {
      nodes.push(
        el('p', {
          className: 'empty-state',
          text: 'All settled! No payments needed.',
        })
      );
    } else {
      const list = el('div', { className: 'settle-list' });
      for (const payment of plan) {
        const row = el('div', { className: 'settle-row' });
        const statement = el('span', {
          className: 'settle-text',
          text: `${payment.fromName} pays ${payment.toName} ${formatRupees(payment.amountPaise)}`,
        });

        const settleBtn = el('button', {
          className: 'btn btn-secondary btn-sm',
          text: 'Mark as settled',
          attrs: { type: 'button' },
        });

        settleBtn.addEventListener('click', () => {
          settleBtn.disabled = true;
          const res = store.markAsSettled(payment);
          if (!res.ok) {
            settleBtn.disabled = false;
            setInlineError(errorEl, res.error);
            return;
          }
          clearInlineError(errorEl);
        });

        row.append(statement, settleBtn);
        list.append(row);
      }
      nodes.push(list);
    }

    if (snapshot.settlements.length > 0) {
      const nameById = new Map(snapshot.members.map((m) => [m.id, m.name]));
      const recordedBlock = el('div', { className: 'recorded-block' });
      recordedBlock.append(el('h3', { className: 'recorded-title', text: 'Recorded Settlements' }));

      const recordedList = el('div', { className: 'recorded-list' });
      for (const stl of [...snapshot.settlements].reverse()) {
        const fromName = nameById.get(stl.fromId) ?? 'Member';
        const toName = nameById.get(stl.toId) ?? 'Member';
        const row = el('div', { className: 'recorded-row' });
        const summary = el('span', {
          className: 'recorded-text',
          text: `${fromName} paid ${toName} ${formatRupees(stl.amountPaise)}`,
        });

        const undoBtn = el('button', {
          className: 'btn btn-secondary btn-sm',
          text: 'Undo',
          attrs: { type: 'button' },
        });
        undoBtn.addEventListener('click', () => {
          undoBtn.disabled = true;
          store.undoSettlement(stl.id);
          clearInlineError(errorEl);
        });

        row.append(summary, undoBtn);
        recordedList.append(row);
      }

      recordedBlock.append(recordedList);
      nodes.push(recordedBlock);
    }

    setChildren(listSlot, nodes);
  }

  function reset() {
    clearInlineError(errorEl);
  }

  return { render, reset };
}
