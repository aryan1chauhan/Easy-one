/**
 * Add Expense form view with Equal, Exact (₹), and Percentage (%) split modes,
 * live preview bars, and state preservation across validation errors (U-01) and member additions (U-05).
 */

import {
  TOTAL_BPS,
  distributeEqual,
  formatBps,
  formatRupees,
  parsePercentToBps,
  parseRupeesToPaise,
} from '../core/money.js';
import { MIN_MEMBERS_FOR_EXPENSE } from '../core/validators.js';
import { clearInlineError, el, setChildren, setInlineError, svgIcon } from './domHelpers.js';

const SPLIT_MODES = [
  { id: 'equal', label: 'Equal' },
  { id: 'exact', label: 'Exact (₹)' },
  { id: 'percentage', label: 'Percentage (%)' },
];

const CATEGORY_OPTIONS = [
  { id: 'auto', label: 'Auto-detect', icon: 'other' },
  { id: 'food', label: 'Food', icon: 'food' },
  { id: 'cab', label: 'Auto/Cab', icon: 'cab' },
  { id: 'groceries', label: 'Groceries', icon: 'groceries' },
  { id: 'utilities', label: 'Utilities', icon: 'utilities' },
  { id: 'shopping', label: 'Shopping', icon: 'shopping' },
  { id: 'other', label: 'Other', icon: 'other' },
];

const QUICK_AMOUNT_CHIPS = [50, 100, 500];

/**
 * Mounts the Add Expense form controller.
 *
 * @param {HTMLElement} container
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {{ onSuccess?: () => void }} [options]
 */
export function mountExpenseFormView(container, store, options = {}) {
  let currentSplitType = 'equal';
  let currentMembers = [];
  const knownMemberIds = new Set();
  const checkedMemberIds = new Set();
  const shareInputsByMember = new Map();

  const noticeBox = el('p', {
    className: 'notice-box',
    text: `Add at least ${MIN_MEMBERS_FOR_EXPENSE} members before adding an expense.`,
  });

  const form = el('form', {
    className: 'form-stack',
    attrs: { novalidate: '' },
  });

  const titleField = el('div', { className: 'field' });
  const titleLabel = el('label', {
    className: 'field-label',
    text: 'Title',
    attrs: { for: 'expense-title-input' },
  });
  const titleInput = el('input', {
    attrs: {
      id: 'expense-title-input',
      type: 'text',
      placeholder: 'e.g. Dinner',
      maxlength: '80',
      autocomplete: 'off',
    },
  });
  titleField.append(titleLabel, titleInput);

  const amountField = el('div', { className: 'field' });
  const heroAmountBox = el('div', { className: 'composer-amount-hero' });
  const heroAmountLabel = el('span', { className: 'composer-amount-eyebrow', text: 'Amount' });
  const heroAmountReadout = el('div', { className: 'composer-amount-display', text: '₹0' });
  heroAmountBox.append(heroAmountLabel, heroAmountReadout);

  const amountLabel = el('label', {
    className: 'field-label',
    text: 'Amount (₹)',
    attrs: { for: 'expense-amount-input' },
  });
  const amountInput = el('input', {
    attrs: {
      id: 'expense-amount-input',
      type: 'text',
      inputmode: 'decimal',
      placeholder: '0.00',
      autocomplete: 'off',
    },
  });

  const quickChipsRow = el('div', { className: 'amount-quick-chips' });
  const quickChipButtons = [];
  for (const delta of QUICK_AMOUNT_CHIPS) {
    const chip = el('button', {
      className: 'amount-chip-btn',
      text: `+₹${delta}`,
      attrs: { type: 'button' },
    });
    chip.addEventListener('click', () => {
      const parsed = parseRupeesToPaise(amountInput.value, { allowZero: true });
      const currentPaise = parsed.valid ? parsed.paise : 0;
      const nextPaise = currentPaise + delta * 100;
      const whole = Math.floor(nextPaise / 100);
      const frac = nextPaise % 100;
      amountInput.value = frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
      clearInlineError(errorEl);
      syncAmountReadout();
      updateLivePreview();
    });
    quickChipButtons.push(chip);
    quickChipsRow.append(chip);
  }
  amountField.append(heroAmountBox, amountLabel, amountInput, quickChipsRow);

  const paidByField = el('div', { className: 'field' });
  const paidByLabel = el('label', {
    className: 'field-label',
    text: 'Paid by',
    attrs: { for: 'expense-paid-by' },
  });
  const paidBySelect = el('select', { attrs: { id: 'expense-paid-by' } });
  paidByField.append(paidByLabel, paidBySelect);

  const categoryField = el('div', { className: 'field' });
  const categoryLabel = el('label', {
    className: 'field-label',
    text: 'Category',
    attrs: { for: 'expense-category-select' },
  });
  const categorySelect = el('select', { className: 'sr-only-select', attrs: { id: 'expense-category-select' } });
  const categoryGrid = el('div', { className: 'composer-category-grid', attrs: { role: 'group', 'aria-label': 'Expense category' } });
  const categoryButtons = new Map();

  function syncCategoryPills() {
    for (const [catId, btn] of categoryButtons.entries()) {
      const isSelected = categorySelect.value === catId;
      btn.className = isSelected ? 'cat-pill-btn is-selected' : 'cat-pill-btn';
      btn.setAttribute('aria-pressed', String(isSelected));
    }
  }

  for (const cat of CATEGORY_OPTIONS) {
    categorySelect.append(el('option', { text: cat.label, attrs: { value: cat.id } }));
    const pillBtn = el('button', {
      className: cat.id === 'auto' ? 'cat-pill-btn is-selected' : 'cat-pill-btn',
      attrs: { type: 'button', 'aria-pressed': String(cat.id === 'auto') },
    });
    const iconSpan = el('span', { className: `icon-tile icon-tile-xs icon-tile-${cat.id === 'auto' ? 'utilities' : cat.id}` });
    iconSpan.append(svgIcon(cat.icon, { size: 14 }));
    pillBtn.append(iconSpan, el('span', { text: cat.label }));
    pillBtn.addEventListener('click', () => {
      categorySelect.value = cat.id;
      syncCategoryPills();
    });
    categoryButtons.set(cat.id, pillBtn);
    categoryGrid.append(pillBtn);
  }
  categorySelect.addEventListener('change', syncCategoryPills);
  categoryField.append(categoryLabel, categorySelect, categoryGrid);

  const metaPair = el('div', { className: 'field-pair' });
  metaPair.append(paidByField);

  const modeField = el('div', { className: 'field' });
  const modeLabel = el('span', { className: 'field-label', text: 'Split mode' });
  const modeTabs = el('div', {
    className: 'split-tabs',
    attrs: { role: 'group', 'aria-label': 'Split mode' },
  });

  const tabButtons = new Map();
  for (const mode of SPLIT_MODES) {
    const btn = el('button', {
      className: mode.id === currentSplitType ? 'split-tab is-active' : 'split-tab',
      text: mode.label,
      attrs: {
        type: 'button',
        'aria-pressed': String(mode.id === currentSplitType),
        'data-mode': mode.id,
      },
    });
    btn.addEventListener('click', () => {
      if (currentSplitType === mode.id) return;
      currentSplitType = mode.id;
      syncTabButtons();
      clearInlineError(errorEl);
      renderSplitRows();
      updateLivePreview();
    });
    tabButtons.set(mode.id, btn);
    modeTabs.append(btn);
  }
  modeField.append(modeLabel, modeTabs);

  const splitField = el('div', { className: 'field' });
  const splitLabel = el('span', { className: 'field-label', text: 'Split among' });
  const splitRowsContainer = el('div', { className: 'split-members-list' });
  const previewBar = el('div', {
    className: 'split-preview-bar',
    attrs: { 'aria-live': 'polite' },
  });
  splitField.append(splitLabel, splitRowsContainer, previewBar);

  const errorEl = el('p', {
    className: 'error-msg',
    attrs: { id: 'expense-error', role: 'alert', 'aria-live': 'polite', hidden: '' },
  });

  const submitBtn = el('button', {
    className: 'btn btn-primary',
    text: 'Add Expense',
    attrs: { type: 'submit' },
  });

  form.append(amountField, titleField, categoryField, metaPair, modeField, splitField, errorEl, submitBtn);
  container.replaceChildren(noticeBox, form);

  function syncAmountReadout() {
    const parsed = parseRupeesToPaise(amountInput.value, { allowZero: true });
    heroAmountReadout.textContent = parsed.valid ? formatRupees(parsed.paise) : '₹0';
  }

  function syncTabButtons() {
    for (const [modeId, btn] of tabButtons.entries()) {
      const isActive = modeId === currentSplitType;
      btn.className = isActive ? 'split-tab is-active' : 'split-tab';
      btn.setAttribute('aria-pressed', String(isActive));
    }
  }

  function getSelectedIds() {
    return currentMembers.filter((m) => checkedMemberIds.has(m.id)).map((m) => m.id);
  }

  function updateLivePreview() {
    if (currentMembers.length < MIN_MEMBERS_FOR_EXPENSE) {
      previewBar.hidden = true;
      return;
    }
    previewBar.hidden = false;

    const selectedIds = getSelectedIds();
    previewBar.className = 'split-preview-bar';

    if (selectedIds.length === 0) {
      previewBar.textContent = 'Select at least 1 member';
      previewBar.classList.add('is-bad');
      return;
    }

    const totalRes = parseRupeesToPaise(amountInput.value, { allowZero: false });

    if (currentSplitType === 'equal') {
      if (!totalRes.valid) {
        previewBar.textContent = `Equal across ${selectedIds.length} selected`;
        return;
      }
      const shares = distributeEqual(totalRes.paise, selectedIds);
      const firstShare = formatRupees(shares[0].sharePaise);
      const hasRemainder = totalRes.paise % selectedIds.length !== 0;
      previewBar.textContent = hasRemainder
        ? `${firstShare} / person (rounded to exact total)`
        : `${firstShare} / person`;
      previewBar.classList.add('is-ok');
      return;
    }

    if (currentSplitType === 'exact') {
      let sumPaise = 0;
      for (const id of selectedIds) {
        const res = parseRupeesToPaise(shareInputsByMember.get(id) ?? '', { allowZero: true });
        if (!res.valid) {
          previewBar.textContent = 'Enter valid ₹ amounts for selected members';
          return;
        }
        sumPaise += res.paise;
      }

      if (!totalRes.valid) {
        previewBar.textContent = `Entered shares: ${formatRupees(sumPaise)}`;
        return;
      }

      if (sumPaise === totalRes.paise) {
        previewBar.textContent = `Balanced (${formatRupees(sumPaise)})`;
        previewBar.classList.add('is-ok');
      } else if (sumPaise < totalRes.paise) {
        previewBar.textContent = `Short by ${formatRupees(totalRes.paise - sumPaise)}`;
        previewBar.classList.add('is-bad');
      } else {
        previewBar.textContent = `Exceeds total by ${formatRupees(sumPaise - totalRes.paise)}`;
        previewBar.classList.add('is-bad');
      }
      return;
    }

    // Percentage mode
    let sumBps = 0;
    for (const id of selectedIds) {
      const res = parsePercentToBps(shareInputsByMember.get(id) ?? '');
      if (!res.valid) {
        previewBar.textContent = 'Enter valid % shares (sum = 100%)';
        return;
      }
      sumBps += res.bps;
    }

    if (sumBps === TOTAL_BPS) {
      previewBar.textContent = '100% allocated';
      previewBar.classList.add('is-ok');
    } else if (sumBps < TOTAL_BPS) {
      previewBar.textContent = `Remaining: ${formatBps(TOTAL_BPS - sumBps)}`;
      previewBar.classList.add('is-bad');
    } else {
      previewBar.textContent = `Exceeds 100% by ${formatBps(sumBps - TOTAL_BPS)}`;
      previewBar.classList.add('is-bad');
    }
  }

  function renderSplitRows() {
    const disabled = currentMembers.length < MIN_MEMBERS_FOR_EXPENSE;
    const rows = currentMembers.map((member) => {
      const row = el('div', { className: 'split-member-row' });
      const label = el('label', { className: 'split-check-label' });
      const checkbox = el('input', {
        attrs: {
          type: 'checkbox',
          value: member.id,
        },
      });
      checkbox.checked = checkedMemberIds.has(member.id);
      checkbox.disabled = disabled;

      let shareInput = null;
      if (currentSplitType !== 'equal') {
        const isChecked = checkbox.checked;
        shareInput = el('input', {
          className: 'split-share-input',
          attrs: {
            type: 'text',
            inputmode: 'decimal',
            placeholder: currentSplitType === 'exact' ? '0.00' : '0%',
            'aria-label': `${member.name} share`,
          },
        });
        shareInput.value = shareInputsByMember.get(member.id) ?? '';
        shareInput.disabled = disabled || !isChecked;
        shareInput.hidden = !isChecked;

        shareInput.addEventListener('input', () => {
          shareInputsByMember.set(member.id, shareInput.value);
          clearInlineError(errorEl);
          updateLivePreview();
        });
      }

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          checkedMemberIds.add(member.id);
        } else {
          checkedMemberIds.delete(member.id);
        }
        clearInlineError(errorEl);
        if (shareInput) {
          shareInput.disabled = disabled || !checkbox.checked;
          shareInput.hidden = !checkbox.checked;
        }
        updateLivePreview();
      });

      const nameSpan = el('span', { className: 'split-member-name', text: member.name });
      label.append(checkbox, nameSpan);
      row.append(label);
      if (shareInput) {
        row.append(shareInput);
      }

      return row;
    });

    setChildren(splitRowsContainer, rows);
  }

  function resetFieldsOnly() {
    titleInput.value = '';
    amountInput.value = '';
    categorySelect.value = 'auto';
    syncCategoryPills();
    syncAmountReadout();
    shareInputsByMember.clear();
    checkedMemberIds.clear();
    for (const member of currentMembers) {
      checkedMemberIds.add(member.id);
    }
    currentSplitType = 'equal';
    syncTabButtons();
    clearInlineError(errorEl);
    renderSplitRows();
    updateLivePreview();
  }

  titleInput.addEventListener('input', () => clearInlineError(errorEl));
  amountInput.addEventListener('input', () => {
    clearInlineError(errorEl);
    syncAmountReadout();
    updateLivePreview();
  });
  paidBySelect.addEventListener('change', () => clearInlineError(errorEl));

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const shareValues = {};
    for (const memberId of getSelectedIds()) {
      shareValues[memberId] = shareInputsByMember.get(memberId) ?? '';
    }

    const res = store.addExpense({
      title: titleInput.value,
      amount: amountInput.value,
      paidBy: paidBySelect.value,
      category: categorySelect.value === 'auto' ? undefined : categorySelect.value,
      splitType: currentSplitType,
      splitAmong: getSelectedIds(),
      shareValues,
    });

    if (!res.ok) {
      setInlineError(errorEl, res.error);
      return;
    }

    resetFieldsOnly();
    if (typeof options.onSuccess === 'function') {
      options.onSuccess();
    } else {
      titleInput.focus();
    }
  });

  function render(snapshot) {
    currentMembers = snapshot.members;
    const activeIds = new Set(currentMembers.map((m) => m.id));

    for (const id of [...knownMemberIds]) {
      if (!activeIds.has(id)) {
        knownMemberIds.delete(id);
        checkedMemberIds.delete(id);
        shareInputsByMember.delete(id);
      }
    }
    for (const member of currentMembers) {
      if (!knownMemberIds.has(member.id)) {
        knownMemberIds.add(member.id);
        checkedMemberIds.add(member.id);
      }
    }

    const isLocked = currentMembers.length < MIN_MEMBERS_FOR_EXPENSE;
    noticeBox.hidden = !isLocked;

    titleInput.disabled = isLocked;
    amountInput.disabled = isLocked;
    paidBySelect.disabled = isLocked;
    categorySelect.disabled = isLocked;
    submitBtn.disabled = isLocked;
    for (const chip of quickChipButtons) {
      chip.disabled = isLocked;
    }
    for (const pillBtn of categoryButtons.values()) {
      pillBtn.disabled = isLocked;
    }
    for (const btn of tabButtons.values()) {
      btn.disabled = isLocked;
    }

    const prevPaidBy = paidBySelect.value;
    const options = currentMembers.map((member) =>
      el('option', {
        text: member.name,
        attrs: { value: member.id },
      })
    );
    setChildren(paidBySelect, options);

    if (prevPaidBy && activeIds.has(prevPaidBy)) {
      paidBySelect.value = prevPaidBy;
    } else if (currentMembers.length > 0) {
      paidBySelect.value = currentMembers[0].id;
    }

    renderSplitRows();
    updateLivePreview();
  }

  function reset() {
    knownMemberIds.clear();
    resetFieldsOnly();
  }

  return { render, reset };
}
