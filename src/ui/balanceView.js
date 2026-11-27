/**
 * Member Balances table view showing Total Paid, Total Share, color-coded Net Balance,
 * and total spend + ₹0 zero-sum footer verification.
 */

import { formatRupees } from '../core/money.js';
import { el, setChildren } from './domHelpers.js';

function getStatusBadge(netPaise) {
  if (netPaise > 0) {
    return el('span', {
      className: 'badge badge-positive',
      text: `${formatRupees(netPaise, { signed: true })} gets back`,
    });
  }
  if (netPaise < 0) {
    return el('span', {
      className: 'badge badge-negative',
      text: `${formatRupees(netPaise, { signed: true })} owes`,
    });
  }
  return el('span', {
    className: 'badge badge-neutral',
    text: '₹0 settled',
  });
}

/**
 * Mounts the Balances summary view.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} totalBadgeEl
 */
export function mountBalanceView(container, totalBadgeEl) {
  function render(snapshot) {
    totalBadgeEl.textContent = `Total: ${formatRupees(snapshot.totalSpendPaise)}`;

    if (snapshot.balances.length === 0) {
      setChildren(container, [
        el('p', {
          className: 'empty-state',
          text: 'Add group members to view balances.',
        }),
      ]);
      return;
    }

    const wrap = el('div', { className: 'table-wrap' });
    const table = el('table', { className: 'balance-table' });

    const thead = el('thead');
    const headRow = el('tr');
    headRow.append(
      el('th', { text: 'Member', attrs: { scope: 'col' } }),
      el('th', { className: 'num', text: 'Paid', attrs: { scope: 'col' } }),
      el('th', { className: 'num', text: 'Share', attrs: { scope: 'col' } }),
      el('th', { className: 'num', text: 'Net Balance', attrs: { scope: 'col' } })
    );
    thead.append(headRow);

    const tbody = el('tbody');
    const rows = snapshot.balances.map((entry) => {
      const tr = el('tr');
      const netCell = el('td', { className: 'num' });
      netCell.append(getStatusBadge(entry.netPaise));

      tr.append(
        el('td', { className: 'member-col', text: entry.name }),
        el('td', { className: 'num', text: formatRupees(entry.expensePaidPaise) }),
        el('td', { className: 'num', text: formatRupees(entry.expenseSharePaise) }),
        netCell
      );
      return tr;
    });
    tbody.append(...rows);

    const tfoot = el('tfoot');
    const footRow = el('tr');
    footRow.append(
      el('td', { text: 'Group Total' }),
      el('td', { className: 'num', text: formatRupees(snapshot.totalSpendPaise) }),
      el('td', { className: 'num', text: formatRupees(snapshot.totalSpendPaise) }),
      el('td', { className: 'num', text: formatRupees(snapshot.netSumPaise) })
    );
    tfoot.append(footRow);

    table.append(thead, tbody, tfoot);
    wrap.append(table);

    const nodes = [wrap];
    if (snapshot.hasSettlements) {
      nodes.push(
        el('p', {
          className: 'settlement-note',
          text: 'Net balances include recorded settlement payments.',
        })
      );
    }

    setChildren(container, nodes);
  }

  return { render };
}
