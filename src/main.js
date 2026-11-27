/**
 * Application bootstrap & client-side multi-view router:
 * coordinates desktop workspace rail, mobile bottom dock, Overview workspace,
 * Friends & Settle Up, Budget Analytics Charts, Immutable Activity Log, Groups, and Add Expense sheet.
 */

import { formatRupees } from './core/money.js';
import { MAX_MEMBERS, MIN_MEMBERS_FOR_EXPENSE } from './core/validators.js';
import { createStore } from './state/store.js';
import { mountActivityView } from './ui/activityView.js';
import { mountAnalyticsView } from './ui/analyticsView.js';
import { mountBalanceView } from './ui/balanceView.js';
import { svgIcon } from './ui/domHelpers.js';
import { mountExpenseFormView } from './ui/expenseFormView.js';
import { mountExpenseListView } from './ui/expenseListView.js';
import { mountFriendsView } from './ui/friendsView.js';
import { mountGroupView } from './ui/groupView.js';
import { mountMemberView } from './ui/memberView.js';
import { mountResetModal } from './ui/modalView.js';
import { mountOverviewView } from './ui/overviewView.js';
import { mountSettleUpView } from './ui/settleUpView.js';

const VALID_VIEWS = new Set(['overview', 'friends', 'analytics', 'activity', 'group']);

function initApp() {
  const store = createStore();
  let activeView = 'overview';

  const storageBanner = document.getElementById('storage-banner');
  const storageBannerText = document.getElementById('storage-banner-text');
  const storageDismissBtn = document.getElementById('storage-banner-dismiss');
  const headerGroupSubtitle = document.getElementById('header-group-subtitle');
  const sidebarGroupName = document.getElementById('sidebar-group-name');
  const sidebarSpendVal = document.getElementById('sidebar-spend-val');
  const sidebarPendingVal = document.getElementById('sidebar-pending-val');
  const navFriendsBadge = document.getElementById('nav-friends-badge');
  const navActivityBadge = document.getElementById('nav-activity-badge');

  const openAddExpenseBtn = document.getElementById('open-add-expense-btn');
  const sidebarAddExpenseBtn = document.getElementById('sidebar-add-expense-btn');
  const mobileAddExpenseBtn = document.getElementById('mobile-add-expense-btn');
  const expenseDialog = document.getElementById('expense-dialog');
  const expenseDialogClose = document.getElementById('expense-dialog-close');

  // Populate crisp SVG icons inside mobile dock and desktop sidebar
  for (const iconSlot of document.querySelectorAll('.mobile-nav-icon[data-icon], .sidebar-nav-icon[data-icon]')) {
    const iconName = iconSlot.getAttribute('data-icon');
    const isFab = iconSlot.closest('#mobile-add-expense-btn') !== null;
    iconSlot.replaceChildren(svgIcon(iconName, { size: isFab ? 22 : 18 }));
  }

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

  function navigateTo(nextView) {
    const targetView = VALID_VIEWS.has(nextView) ? nextView : 'overview';
    activeView = targetView;

    for (const viewId of VALID_VIEWS) {
      const panel = document.getElementById(`view-${viewId}`);
      if (panel) {
        panel.hidden = viewId !== targetView;
      }
    }

    for (const navItem of document.querySelectorAll('[data-nav]')) {
      const isMatch = navItem.getAttribute('data-nav') === targetView;
      if (
        navItem.classList.contains('nav-tab') ||
        navItem.classList.contains('mobile-nav-btn') ||
        navItem.classList.contains('sidebar-nav-btn')
      ) {
        navItem.classList.toggle('is-active', isMatch);
        if (isMatch) {
          navItem.setAttribute('aria-current', 'page');
        } else {
          navItem.removeAttribute('aria-current');
        }
      }
    }

    if (window.location.hash !== `#${targetView}`) {
      try {
        history.replaceState(null, '', `#${targetView}`);
      } catch {
        // Ignore restricted history contexts cleanly
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  for (const navEl of document.querySelectorAll('[data-nav]')) {
    navEl.addEventListener('click', (event) => {
      event.preventDefault();
      navigateTo(navEl.getAttribute('data-nav'));
    });
  }

  function openAddExpenseDialog() {
    if (store.getState().members.length < MIN_MEMBERS_FOR_EXPENSE) {
      navigateTo('group');
      const memberInput = document.getElementById('member-name-input');
      if (memberInput) memberInput.focus();
      return;
    }
    if (typeof expenseDialog.showModal === 'function') {
      if (!expenseDialog.open) expenseDialog.showModal();
    } else {
      expenseDialog.setAttribute('open', '');
    }
    const amtInput = document.getElementById('expense-amount-input');
    if (amtInput) amtInput.focus();
  }

  function closeAddExpenseDialog() {
    if (typeof expenseDialog.close === 'function') {
      if (expenseDialog.open) expenseDialog.close();
    } else {
      expenseDialog.removeAttribute('open');
    }
  }

  openAddExpenseBtn.addEventListener('click', openAddExpenseDialog);
  sidebarAddExpenseBtn.addEventListener('click', openAddExpenseDialog);
  mobileAddExpenseBtn.addEventListener('click', openAddExpenseDialog);
  expenseDialogClose.addEventListener('click', closeAddExpenseDialog);
  expenseDialog.addEventListener('click', (event) => {
    if (event.target === expenseDialog) {
      closeAddExpenseDialog();
    }
  });

  const memberView = mountMemberView(
    document.getElementById('members-root'),
    document.getElementById('member-count-badge'),
    store
  );

  const expenseFormView = mountExpenseFormView(
    document.getElementById('expense-form-root'),
    store,
    { onSuccess: closeAddExpenseDialog }
  );

  const overviewView = mountOverviewView({
    heroEl: document.getElementById('overview-hero-root'),
    settleEl: document.getElementById('overview-settle-root'),
    activityEl: document.getElementById('overview-activity-root'),
    store,
    onNavigate: navigateTo,
    onOpenAddExpense: openAddExpenseDialog,
  });

  const friendsView = mountFriendsView(
    document.getElementById('friends-root'),
    document.getElementById('friends-summary-badge')
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
    document.getElementById('expense-toolbar-slot'),
    store,
    { onOpenAddExpense: openAddExpenseDialog }
  );

  const analyticsView = mountAnalyticsView({
    container: document.getElementById('analytics-root'),
    store,
    onSelectCategory: (category) => {
      store.setCategoryFilter(category);
      navigateTo('overview');
    },
    onOpenAddExpense: openAddExpenseDialog,
  });

  const activityView = mountActivityView(
    document.getElementById('activity-root'),
    document.getElementById('activity-lock-badge')
  );

  const resetDialog = document.getElementById('reset-dialog');
  const resetTriggerBtn = document.getElementById('reset-group-btn');
  const sidebarResetBtn = document.getElementById('sidebar-reset-btn');

  mountResetModal({
    dialog: resetDialog,
    triggerBtn: resetTriggerBtn,
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

  sidebarResetBtn.addEventListener('click', () => resetTriggerBtn.click());

  const groupView = mountGroupView({
    groupsRoot: document.getElementById('groups-root'),
    settingsRoot: document.getElementById('settings-root'),
    store,
    onOpenReset: () => resetTriggerBtn.click(),
  });

  function renderAll(snapshot) {
    renderStorageBanner(snapshot.storageWarning);
    const subtitle = `${snapshot.groupName} · ${snapshot.members.length} / ${MAX_MEMBERS}`;
    headerGroupSubtitle.textContent = subtitle;
    sidebarGroupName.textContent = subtitle;

    const pendingTotalPaise = snapshot.settlementPlan.reduce((sum, p) => sum + p.amountPaise, 0);
    sidebarSpendVal.textContent = formatRupees(snapshot.totalSpendPaise);
    sidebarPendingVal.textContent = formatRupees(pendingTotalPaise);
    navFriendsBadge.textContent = String(snapshot.settlementPlan.length);
    navActivityBadge.textContent = String(snapshot.activityFeed?.length ?? 0);

    const lockAdd = snapshot.members.length < MIN_MEMBERS_FOR_EXPENSE;
    const tip = lockAdd ? 'Add at least 2 members first' : 'Add a new expense';
    openAddExpenseBtn.title = tip;
    sidebarAddExpenseBtn.title = tip;

    overviewView.render(snapshot);
    memberView.render(snapshot);
    expenseFormView.render(snapshot);
    friendsView.render(snapshot);
    balanceView.render(snapshot);
    settleUpView.render(snapshot);
    expenseListView.render(snapshot);
    analyticsView.render(snapshot);
    activityView.render(snapshot);
    groupView.render(snapshot);
  }

  const initialHash = window.location.hash.replace(/^#/, '');
  navigateTo(VALID_VIEWS.has(initialHash) ? initialHash : activeView);

  window.addEventListener('hashchange', () => {
    const hashView = window.location.hash.replace(/^#/, '');
    if (VALID_VIEWS.has(hashView)) {
      navigateTo(hashView);
    }
  });

  store.subscribe(renderAll);
  renderAll(store.getSnapshot());
}

initApp();
