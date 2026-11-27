/**
 * Application bootstrap: initializes state store, mounts UI controllers,
 * storage warning banner, and Reset Group modal.
 */

import { createStore } from './state/store.js';
import { mountBalanceView } from './ui/balanceView.js';
import { mountExpenseFormView } from './ui/expenseFormView.js';
import { mountExpenseListView } from './ui/expenseListView.js';
import { mountMemberView } from './ui/memberView.js';
import { mountResetModal } from './ui/modalView.js';
import { mountSettleUpView } from './ui/settleUpView.js';

function initApp() {
  const store = createStore();

  const storageBanner = document.getElementById('storage-banner');
  const storageBannerText = document.getElementById('storage-banner-text');
  const storageDismissBtn = document.getElementById('storage-banner-dismiss');

  let dismissedWarningText = null;

  function renderStorageBanner(warning) {
    if (!warning) {
      dismissedWarningText = null;
      storageBanner.hidden = true;
      storageBannerText.textContent = '';
      return;
    }
    if (dismissedWarningText === warning) {
      storageBanner.hidden = true;
      return;
    }
    storageBannerText.textContent = warning;
    storageBanner.hidden = false;
  }

  storageDismissBtn.addEventListener('click', () => {
    dismissedWarningText = storageBannerText.textContent;
    storageBanner.hidden = true;
  });

  const memberView = mountMemberView(
    document.getElementById('members-root'),
    document.getElementById('member-count-badge'),
    store
  );

  const expenseFormView = mountExpenseFormView(
    document.getElementById('expense-form-root'),
    store
  );

  const balanceView = mountBalanceView(
    document.getElementById('balances-root'),
    document.getElementById('balances-total-badge')
  );

  const settleUpView = mountSettleUpView(
    document.getElementById('settle-up-root'),
    document.getElementById('settle-count-badge'),
    store
  );

  const expenseListView = mountExpenseListView(
    document.getElementById('expense-list-root'),
    document.getElementById('expense-filter-slot'),
    store
  );

  mountResetModal({
    dialog: document.getElementById('reset-dialog'),
    triggerBtn: document.getElementById('reset-group-btn'),
    cancelBtn: document.getElementById('reset-cancel-btn'),
    confirmBtn: document.getElementById('reset-confirm-btn'),
    onAccept: () => {
      dismissedWarningText = null;
      store.resetGroup();
      memberView.reset();
      expenseFormView.reset();
      settleUpView.reset();
    },
  });

  function renderAll(snapshot) {
    renderStorageBanner(snapshot.storageWarning);
    memberView.render(snapshot);
    expenseFormView.render(snapshot);
    balanceView.render(snapshot);
    settleUpView.render(snapshot);
    expenseListView.render(snapshot);
  }

  store.subscribe(renderAll);
  renderAll(store.getSnapshot());
}

initApp();
