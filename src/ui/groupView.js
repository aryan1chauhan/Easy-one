/**
 * Groups & Settings view (RupeeSync Settings & Profile + Splitwise "My Groups / Start a new group"):
 * handles creating and switching groups cleanly, renaming the active group,
 * choosing "View as" profile identity, and hosting the Group Members card & Reset Group button.
 */

import { formatRupees } from '../core/money.js';
import { clearInlineError, el, setChildren, setInlineError, svgIcon } from './domHelpers.js';

/**
 * Mounts the Groups & Settings manager.
 *
 * @param {{
 *   groupsRoot: HTMLElement,
 *   settingsRoot: HTMLElement,
 *   store: ReturnType<import('../state/store.js').createStore>,
 *   onOpenReset: () => void,
 * }} deps
 */
export function mountGroupView({ groupsRoot, settingsRoot, store, onOpenReset }) {
  const newGroupForm = el('form', { className: 'input-row', attrs: { novalidate: '' } });
  const newGroupInput = el('input', {
    attrs: {
      id: 'new-group-input',
      type: 'text',
      placeholder: 'Start a new group (e.g. Goa Trip)',
      maxlength: '40',
      autocomplete: 'off',
    },
  });
  const newGroupBtn = el('button', {
    className: 'btn btn-primary',
    text: 'Create Group',
    attrs: { type: 'submit' },
  });
  const newGroupError = el('p', {
    className: 'error-msg',
    attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' },
  });
  newGroupForm.append(newGroupInput, newGroupBtn);

  newGroupInput.addEventListener('input', () => clearInlineError(newGroupError));
  newGroupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const res = store.createGroup(newGroupInput.value);
    if (!res.ok) {
      setInlineError(newGroupError, res.error);
      newGroupInput.focus();
      return;
    }
    clearInlineError(newGroupError);
    newGroupInput.value = '';
  });

  const renameForm = el('form', { className: 'input-row', attrs: { novalidate: '' } });
  const renameInput = el('input', {
    attrs: {
      id: 'group-name-input',
      type: 'text',
      placeholder: 'Group name',
      maxlength: '40',
      autocomplete: 'off',
    },
  });
  const renameBtn = el('button', {
    className: 'btn btn-secondary',
    text: 'Rename',
    attrs: { type: 'submit' },
  });
  const renameError = el('p', {
    className: 'error-msg',
    attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' },
  });
  renameForm.append(renameInput, renameBtn);

  renameInput.addEventListener('input', () => clearInlineError(renameError));
  renameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const res = store.setGroupName(renameInput.value);
    if (!res.ok) {
      setInlineError(renameError, res.error);
      return;
    }
    clearInlineError(renameError);
  });

  const identitySelect = el('select', {
    attrs: { id: 'settings-viewer-select', 'aria-label': 'Your active profile perspective' },
  });
  identitySelect.addEventListener('change', () => {
    store.setViewerMember(identitySelect.value);
  });

  function render(snapshot) {
    // 1. Groups switcher cards (Image 8 style)
    const groupCards = el('div', { className: 'groups-grid' });
    for (const grp of snapshot.groups) {
      const cardBtn = el('button', {
        className: `group-switch-card ${grp.isActive ? 'is-active' : ''}`,
        attrs: { type: 'button' },
      });
      const iconBox = el('div', { className: `icon-tile ${grp.isActive ? 'icon-tile-utilities' : 'icon-tile-groceries'}` });
      iconBox.append(svgIcon('group', { size: 18 }));

      const info = el('div', { className: 'group-switch-info' });
      info.append(
        el('div', { className: 'group-switch-name', text: grp.name }),
        el('div', {
          className: 'group-switch-meta',
          text: `${grp.memberCount} members · ${grp.expenseCount} expenses · ${formatRupees(grp.totalSpendPaise)}`,
        })
      );

      const pill = el('span', {
        className: `badge ${grp.isActive ? 'badge-positive' : 'badge-neutral'}`,
        text: grp.isActive ? 'Active' : 'Switch',
      });

      cardBtn.append(iconBox, info, pill);
      cardBtn.addEventListener('click', () => store.switchGroup(grp.id));
      groupCards.append(cardBtn);
    }

    setChildren(groupsRoot, [groupCards, newGroupForm, newGroupError]);

    // 2. Settings & Profile card (Image 1 Screen 6 style)
    if (document.activeElement !== renameInput) {
      renameInput.value = snapshot.groupName;
    }

    const viewerOpts = [el('option', { text: 'Everyone (Group summary)', attrs: { value: 'all' } })];
    for (const m of snapshot.members) {
      viewerOpts.push(el('option', { text: m.name, attrs: { value: m.id } }));
    }
    identitySelect.replaceChildren(...viewerOpts);
    identitySelect.value = snapshot.viewerMemberId;

    const resetSectionBtn = el('button', {
      className: 'btn btn-danger-outline',
      text: 'Reset current group',
      attrs: { type: 'button' },
    });
    resetSectionBtn.addEventListener('click', onOpenReset);

    const renameBlock = el('div', { className: 'field' });
    renameBlock.append(
      el('label', { className: 'field-label', text: 'Active Group Name', attrs: { for: 'group-name-input' } }),
      renameForm,
      renameError
    );

    const identityBlock = el('div', { className: 'field' });
    identityBlock.append(
      el('label', { className: 'field-label', text: 'Your Viewing Identity ("View as")', attrs: { for: 'settings-viewer-select' } }),
      identitySelect
    );

    const resetBlock = el('div', { className: 'settings-danger-row' });
    resetBlock.append(
      el('div', { className: 'settings-danger-text' }),
      resetSectionBtn
    );
    resetBlock.firstChild.append(
      el('strong', { text: 'Reset active group' }),
      el('p', {
        className: 'helper-meta',
        text: 'Clears current group members, expenses & settlements. Permanent Recent Activity log cannot be deleted.',
      })
    );

    setChildren(settingsRoot, [renameBlock, identityBlock, resetBlock]);
  }

  return { render };
}
