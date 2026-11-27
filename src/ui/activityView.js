/**
 * Permanent, append-only Activity Log view (Splitwise Recent Activity).
 * Intentionally provides zero delete, edit, or clear controls so audit history cannot be removed.
 */

import { el, formatActivityTimestamp, setChildren, svgIcon } from './domHelpers.js';

const TYPE_TO_ICON = {
  member_added: { icon: 'member', tone: 'food' },
  member_removed: { icon: 'member', tone: 'deleted' },
  expense_added: { icon: null, tone: null },
  expense_deleted: { icon: 'deleted', tone: 'deleted' },
  settlement_recorded: { icon: 'settlement', tone: 'settlement' },
  settlement_undone: { icon: 'reset', tone: 'utilities' },
  group_created: { icon: 'group', tone: 'groceries' },
  group_reset: { icon: 'reset', tone: 'deleted' },
};

const FILTER_GROUPS = [
  { id: 'all', label: 'All' },
  { id: 'expenses', label: 'Expenses', types: new Set(['expense_added', 'expense_deleted']) },
  { id: 'settlements', label: 'Settlements', types: new Set(['settlement_recorded', 'settlement_undone']) },
  { id: 'members', label: 'Members', types: new Set(['member_added', 'member_removed']) },
  { id: 'groups', label: 'Groups & Resets', types: new Set(['group_created', 'group_reset']) },
];

/**
 * Mounts the immutable Recent Activity view.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} badgeEl
 */
export function mountActivityView(container, badgeEl) {
  let activeTypeFilter = 'all';
  let searchText = '';
  let lastSnapshot = null;

  const lockBanner = el('div', { className: 'activity-lock-banner' });
  lockBanner.append(
    svgIcon('lock', { size: 16 }),
    el('span', {
      text: 'Immutable audit trail — every action is logged permanently and cannot be edited or deleted by anyone.',
    })
  );

  const controls = el('div', { className: 'activity-controls' });
  const searchInput = el('input', {
    className: 'activity-search-input',
    attrs: {
      id: 'activity-search-input',
      type: 'text',
      placeholder: 'Search activity history...',
      'aria-label': 'Search activity history',
      autocomplete: 'off',
    },
  });
  searchInput.addEventListener('input', () => {
    searchText = searchInput.value;
    if (lastSnapshot) {
      renderFeedOnly(lastSnapshot);
    }
  });

  const filterRow = el('div', { className: 'activity-filter-chips', attrs: { role: 'group', 'aria-label': 'Filter activity type' } });
  const filterButtons = new Map();
  for (const grp of FILTER_GROUPS) {
    const btn = el('button', {
      className: grp.id === activeTypeFilter ? 'split-tab is-active' : 'split-tab',
      text: grp.label,
      attrs: { type: 'button', 'aria-pressed': String(grp.id === activeTypeFilter) },
    });
    btn.addEventListener('click', () => {
      activeTypeFilter = grp.id;
      for (const [id, b] of filterButtons.entries()) {
        const active = id === activeTypeFilter;
        b.className = active ? 'split-tab is-active' : 'split-tab';
        b.setAttribute('aria-pressed', String(active));
      }
      if (lastSnapshot) {
        renderFeedOnly(lastSnapshot);
      }
    });
    filterButtons.set(grp.id, btn);
    filterRow.append(btn);
  }
  controls.append(searchInput, filterRow);

  const feedSlot = el('div');
  container.replaceChildren(lockBanner, controls, feedSlot);

  function renderFeedOnly(snapshot) {
    const feed = snapshot.activityFeed ?? [];
    badgeEl.replaceChildren(
      svgIcon('lock', { size: 12 }),
      el('span', { text: `Permanent (${feed.length})` })
    );

    const activeGroup = FILTER_GROUPS.find((g) => g.id === activeTypeFilter);
    const queryLower = searchText.trim().toLowerCase();
    const visible = feed.filter((item) => {
      if (activeGroup?.types && !activeGroup.types.has(item.type)) {
        return false;
      }
      if (!queryLower) {
        return true;
      }
      return (
        item.summary.toLowerCase().includes(queryLower) ||
        (item.detail ?? '').toLowerCase().includes(queryLower)
      );
    });

    if (visible.length === 0) {
      setChildren(feedSlot, [
        el('p', {
          className: 'empty-state',
          text:
            feed.length === 0
              ? 'No activity recorded yet. Every member, expense, settlement, and reset is logged permanently.'
              : 'No activity entries match your filter.',
        }),
      ]);
      return;
    }

    const list = el('div', { className: 'activity-list' });
    for (const item of visible) {
      const row = el('div', { className: 'activity-row' });

      const mapping = TYPE_TO_ICON[item.type] ?? { icon: 'other', tone: 'other' };
      const iconName = mapping.icon ?? item.category ?? 'other';
      const toneName = mapping.tone ?? item.category ?? 'other';

      const iconTile = el('div', { className: `icon-tile icon-tile-${toneName}` });
      iconTile.append(svgIcon(iconName, { size: 17 }));

      const body = el('div', { className: 'activity-body' });
      body.append(
        el('div', { className: 'activity-summary', text: item.summary }),
        el('div', {
          className: 'activity-meta',
          text: item.detail
            ? `${item.detail} · ${formatActivityTimestamp(item.createdAt)}`
            : formatActivityTimestamp(item.createdAt),
        })
      );

      row.append(iconTile, body);
      list.append(row);
    }

    setChildren(feedSlot, [list]);
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    renderFeedOnly(snapshot);
  }

  return { render };
}
