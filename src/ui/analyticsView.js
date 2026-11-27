/**
 * RupeeSync Budget Analytics & Charts view:
 * renders a pure SVG Category Donut Chart (stroke-dasharray), interactive category filter cards,
 * and a Member Paid vs Fair Share comparison bar chart. Zero external chart libraries or innerHTML.
 */

import { formatRupees } from '../core/money.js';
import { CATEGORY_META, el, setChildren, svgIcon } from './domHelpers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildDonutSvg(categories, totalPaise, selectedCategory) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 180 180');
  svg.setAttribute('class', 'donut-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Expense spending by category chart');

  const cx = 90;
  const cy = 90;
  const radius = 64;
  const circumference = 2 * Math.PI * radius;

  // Base background ring
  const bgRing = document.createElementNS(SVG_NS, 'circle');
  bgRing.setAttribute('cx', String(cx));
  bgRing.setAttribute('cy', String(cy));
  bgRing.setAttribute('r', String(radius));
  bgRing.setAttribute('fill', 'none');
  bgRing.setAttribute('stroke', '#EFE3D6');
  bgRing.setAttribute('stroke-width', '22');
  svg.appendChild(bgRing);

  let offset = 0;
  for (const item of categories) {
    if (item.amountPaise <= 0 || totalPaise <= 0) continue;
    const ratio = item.amountPaise / totalPaise;
    const dashLen = Math.max(2, ratio * circumference);
    const meta = CATEGORY_META[item.category] ?? CATEGORY_META.other;

    const seg = document.createElementNS(SVG_NS, 'circle');
    seg.setAttribute('cx', String(cx));
    seg.setAttribute('cy', String(cy));
    seg.setAttribute('r', String(radius));
    seg.setAttribute('fill', 'none');
    seg.setAttribute('stroke', meta.color);
    seg.setAttribute('stroke-width', selectedCategory === item.category ? '26' : '22');
    seg.setAttribute('stroke-dasharray', `${dashLen} ${circumference - dashLen}`);
    seg.setAttribute('stroke-dashoffset', String(-offset));
    seg.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(seg);

    offset += dashLen;
  }

  return svg;
}

/**
 * Mounts the Budget Analytics view.
 *
 * @param {{
 *   container: HTMLElement,
 *   store: ReturnType<import('../state/store.js').createStore>,
 *   onSelectCategory: (category: string) => void,
 *   onOpenAddExpense?: () => void,
 * }} deps
 */
export function mountAnalyticsView({ container, onSelectCategory, onOpenAddExpense }) {
  let activeCategory = null;

  function render(snapshot) {
    const { categorySummary, balances, totalSpendPaise } = snapshot;

    if (snapshot.expenses.length === 0) {
      const emptyCard = el('div', { className: 'card analytics-full-card' });
      const head = el('div', { className: 'card-header' });
      head.append(el('h2', { className: 'card-title', text: 'Budget Analytics' }));

      const emptyBox = el('div', { className: 'empty-state empty-state-actionable' });
      emptyBox.append(
        el('p', { className: 'empty-state-title', text: 'No spending data to chart yet.' }),
        el('p', {
          className: 'empty-state-sub',
          text: 'Once you log expenses, interactive category donut charts and member comparison bars appear here.',
        })
      );
      if (typeof onOpenAddExpense === 'function') {
        const cta = el('button', {
          className: 'btn btn-primary btn-sm',
          text: '+ Add first expense',
          attrs: { type: 'button' },
        });
        cta.addEventListener('click', onOpenAddExpense);
        emptyBox.append(cta);
      }

      emptyCard.append(head, emptyBox);
      setChildren(container, [emptyCard]);
      return;
    }

    const categories = categorySummary?.categories ?? [];
    const focused = categories.find((c) => c.category === activeCategory) ?? null;

    // 1. Donut Chart Card
    const donutCard = el('section', { className: 'card analytics-card' });
    const donutHead = el('div', { className: 'card-header' });
    donutHead.append(
      el('h2', { className: 'card-title', text: 'Spending by Category' }),
      el('span', { className: 'badge badge-neutral', text: `${categories.length} categories` })
    );

    const donutLayout = el('div', { className: 'donut-layout' });
    const chartWrap = el('div', { className: 'donut-wrap' });
    const centerOverlay = el('div', { className: 'donut-center' });
    centerOverlay.append(
      el('span', {
        className: 'donut-center-label',
        text: focused ? (CATEGORY_META[focused.category]?.short ?? 'Category') : 'Total Spend',
      }),
      el('strong', {
        className: 'donut-center-value',
        text: formatRupees(focused ? focused.amountPaise : totalSpendPaise),
      }),
      el('span', {
        className: 'donut-center-sub',
        text: focused ? `${focused.percent}%` : `${snapshot.expenses.length} expenses`,
      })
    );
    chartWrap.append(buildDonutSvg(categories, totalSpendPaise, activeCategory), centerOverlay);

    const legend = el('div', { className: 'donut-legend' });
    for (const item of categories) {
      const meta = CATEGORY_META[item.category] ?? CATEGORY_META.other;
      const row = el('button', {
        className: `legend-row ${activeCategory === item.category ? 'is-active' : ''}`,
        attrs: { type: 'button' },
      });
      const swatch = el('span', { className: 'legend-dot' });
      swatch.style.backgroundColor = meta.color;

      const info = el('span', { className: 'legend-label', text: meta.short });
      const val = el('span', {
        className: 'legend-value',
        text: `${formatRupees(item.amountPaise)} (${item.percent}%)`,
      });
      row.append(swatch, info, val);

      row.addEventListener('click', () => {
        activeCategory = activeCategory === item.category ? null : item.category;
        render(snapshot);
      });
      legend.append(row);
    }

    donutLayout.append(chartWrap, legend);
    donutCard.append(donutHead, donutLayout);

    // 2. Member Contribution Comparison Card
    const memberCard = el('section', { className: 'card analytics-card' });
    const memberHead = el('div', { className: 'card-header' });
    memberHead.append(
      el('h2', { className: 'card-title', text: 'Paid vs. Fair Share by Member' }),
      el('span', { className: 'badge badge-neutral', text: 'Rupee breakdown' })
    );

    const maxBarPaise = Math.max(
      1,
      ...balances.map((b) => Math.max(b.expensePaidPaise, b.expenseSharePaise))
    );

    const barsWrap = el('div', { className: 'comparison-bars' });
    for (const entry of balances) {
      const row = el('div', { className: 'comp-row' });
      const rowHead = el('div', { className: 'comp-head' });
      rowHead.append(
        el('span', { className: 'comp-name', text: entry.name }),
        el('span', {
          className: 'comp-figures',
          text: `Paid ${formatRupees(entry.expensePaidPaise)} · Share ${formatRupees(entry.expenseSharePaise)}`,
        })
      );

      const trackGroup = el('div', { className: 'comp-tracks' });
      const paidTrack = el('div', { className: 'comp-track' });
      const paidFill = el('div', { className: 'comp-fill is-paid' });
      paidFill.style.width = `${Math.round((entry.expensePaidPaise / maxBarPaise) * 100)}%`;
      paidTrack.append(paidFill);

      const shareTrack = el('div', { className: 'comp-track' });
      const shareFill = el('div', { className: 'comp-fill is-share' });
      shareFill.style.width = `${Math.round((entry.expenseSharePaise / maxBarPaise) * 100)}%`;
      shareTrack.append(shareFill);

      trackGroup.append(paidTrack, shareTrack);
      row.append(rowHead, trackGroup);
      barsWrap.append(row);
    }

    const barLegend = el('div', { className: 'bar-legend' });
    barLegend.append(
      el('span', { className: 'bar-legend-item is-paid-dot', text: 'Amount Paid' }),
      el('span', { className: 'bar-legend-item is-share-dot', text: 'Fair Share' })
    );
    memberCard.append(memberHead, barLegend, barsWrap);

    // 3. Clickable Category Cards (jump to filtered Expense Ledger)
    const catsCard = el('section', { className: 'card analytics-card analytics-full-card' });
    const catsHead = el('div', { className: 'card-header' });
    catsHead.append(
      el('h2', { className: 'card-title', text: 'Category Breakdown' }),
      el('span', { className: 'helper-meta', text: 'Click a category to filter ledger' })
    );

    const catGrid = el('div', { className: 'category-cards-grid' });
    for (const item of categories) {
      const meta = CATEGORY_META[item.category] ?? CATEGORY_META.other;
      const btn = el('button', {
        className: 'category-stat-card',
        attrs: { type: 'button' },
      });
      const iconBox = el('div', { className: `icon-tile icon-tile-${item.category}` });
      iconBox.append(svgIcon(item.category, { size: 18 }));

      const body = el('div', { className: 'category-stat-body' });
      body.append(
        el('div', { className: 'category-stat-title', text: meta.label }),
        el('div', { className: 'category-stat-meta', text: `${item.count} ${item.count === 1 ? 'expense' : 'expenses'} · ${item.percent}%` })
      );
      const amt = el('div', { className: 'category-stat-amt', text: formatRupees(item.amountPaise) });

      btn.append(iconBox, body, amt);
      btn.addEventListener('click', () => onSelectCategory(item.category));
      catGrid.append(btn);
    }
    catsCard.append(catsHead, catGrid);

    setChildren(container, [donutCard, memberCard, catsCard]);
  }

  return { render };
}
