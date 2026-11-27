/**
 * Group Members controller: add members (2-10), display chips, and remove unused members.
 */

import { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS, MIN_MEMBERS_FOR_EXPENSE } from '../core/validators.js';
import { clearInlineError, el, setChildren, setInlineError } from './domHelpers.js';

/**
 * Mounts the Member management view.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} countBadgeEl
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function mountMemberView(container, countBadgeEl, store) {
  const form = el('form', {
    className: 'form-stack',
    attrs: { novalidate: '' },
  });

  const label = el('label', {
    className: 'field-label',
    text: 'Member name',
    attrs: { for: 'member-name-input' },
  });

  const inputRow = el('div', { className: 'input-row' });
  const nameInput = el('input', {
    attrs: {
      id: 'member-name-input',
      type: 'text',
      placeholder: 'e.g. Rahul',
      maxlength: String(MAX_MEMBER_NAME_LENGTH),
      autocomplete: 'off',
    },
  });

  const addBtn = el('button', {
    className: 'btn btn-primary',
    text: 'Add Member',
    attrs: { type: 'submit' },
  });

  inputRow.append(nameInput, addBtn);

  const errorEl = el('p', {
    className: 'error-msg',
    attrs: { id: 'member-error', role: 'alert', 'aria-live': 'polite', hidden: '' },
  });

  const minNotice = el('p', {
    className: 'notice-box',
    text: `Add at least ${MIN_MEMBERS_FOR_EXPENSE} members to start adding expenses.`,
  });

  const chipList = el('div', {
    className: 'member-list',
    attrs: { 'aria-label': 'Group members list' },
  });

  form.append(label, inputRow, errorEl);
  container.replaceChildren(form, minNotice, chipList);

  nameInput.addEventListener('input', () => {
    clearInlineError(errorEl);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const res = store.addMember(nameInput.value);
    if (!res.ok) {
      setInlineError(errorEl, res.error);
      nameInput.focus();
      return;
    }
    clearInlineError(errorEl);
    nameInput.value = '';
    nameInput.focus();
  });

  function render(snapshot) {
    const members = snapshot.members;
    countBadgeEl.textContent = `${members.length} / ${MAX_MEMBERS} members`;
    minNotice.hidden = members.length >= MIN_MEMBERS_FOR_EXPENSE;

    const lockedIds = new Set();
    for (const exp of snapshot.expenses) {
      lockedIds.add(exp.paidBy);
      for (const s of exp.shares) {
        lockedIds.add(s.memberId);
      }
    }
    for (const stl of snapshot.settlements) {
      lockedIds.add(stl.fromId);
      lockedIds.add(stl.toId);
    }

    const chips = members.map((member) => {
      const chip = el('div', { className: 'member-chip' });
      const nameSpan = el('span', { className: 'member-chip-name', text: member.name });
      const isLocked = lockedIds.has(member.id);

      const removeBtn = el('button', {
        className: isLocked ? 'member-remove-btn is-locked' : 'member-remove-btn',
        text: '×',
        attrs: {
          type: 'button',
          'aria-label': `Remove ${member.name}`,
          title: isLocked ? `${member.name} has expenses or settlements` : `Remove ${member.name}`,
        },
      });

      removeBtn.addEventListener('click', () => {
        const res = store.removeMember(member.id);
        if (!res.ok) {
          setInlineError(errorEl, res.error);
          return;
        }
        clearInlineError(errorEl);
      });

      chip.append(nameSpan, removeBtn);
      return chip;
    });

    setChildren(chipList, chips);
  }

  function reset() {
    nameInput.value = '';
    clearInlineError(errorEl);
  }

  return { render, reset };
}
