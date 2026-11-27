import assert from 'node:assert/strict';
import {
  ACTIVITY_STORAGE_KEY,
  GROUPS_STORAGE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  clearState,
  createInitialState,
  loadActivity,
  loadGroupsMeta,
  loadState,
  saveActivity,
  saveGroupsMeta,
  saveState,
} from '../src/state/storage.js';
import {
  createCloudSync,
  isSameOriginAuthHost,
  resolveAuthDomain,
} from '../src/state/cloudSync.js';
import { createStore } from '../src/state/store.js';

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

function createMemoryStorage(initialEntries = {}) {
  const map = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

// ---------------------------------------------------------------------------
// Storage Resilience & Schema Validation (P-01 to P-04, P-06)
// ---------------------------------------------------------------------------

test('P-02 & P-03: corrupted JSON and malformed state shapes recover cleanly with warning', () => {
  // P-02: invalid JSON syntax
  const badJsonStorage = createMemoryStorage({ [STORAGE_KEY]: '{invalid_json' });
  const r1 = loadState(badJsonStorage);
  assert.deepEqual(r1.state, createInitialState());
  assert.equal(r1.recovered, true);
  assert.ok(r1.warning);

  // P-03: malformed shapes (null, array, wrong version, float paise, orphan memberId, negative amount)
  const malformedPayloads = [
    null,
    [],
    { version: 99, members: [], expenses: [], settlements: [] },
    { version: SCHEMA_VERSION, members: 'bad', expenses: [], settlements: [] },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [
        {
          id: 'e1',
          title: 'Dinner',
          amountPaise: 100.5, // tampered float paise
          paidBy: 'm1',
          splitType: 'equal',
          shares: [{ memberId: 'm1', sharePaise: 100 }],
          createdAt: 200,
        },
      ],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [
        {
          id: 'e1',
          title: 'Dinner',
          amountPaise: 100,
          paidBy: 'orphan_id',
          splitType: 'equal',
          shares: [{ memberId: 'm1', sharePaise: 100 }],
          createdAt: 200,
        },
      ],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [],
      settlements: [{ id: 's1', fromId: 'm1', toId: 'ghost', amountPaise: 100, createdAt: 300 }],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [
        {
          id: 'e1',
          title: 'Share mismatch',
          amountPaise: 100,
          paidBy: 'm1',
          splitType: 'equal',
          shares: [{ memberId: 'm1', sharePaise: 90 }],
          createdAt: 200,
        },
      ],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [
        {
          id: 'e1',
          title: 'Missing percent',
          amountPaise: 100,
          paidBy: 'm1',
          splitType: 'percentage',
          shares: [{ memberId: 'm1', sharePaise: 100 }],
          createdAt: 200,
        },
      ],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [
        {
          id: 'e1',
          title: 'Bad percent sum',
          amountPaise: 100,
          paidBy: 'm1',
          splitType: 'percentage',
          shares: [{ memberId: 'm1', sharePaise: 100, percent: 90 }],
          createdAt: 200,
        },
      ],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [
        { id: 'm1', name: 'Rahul', createdAt: 100 },
        { id: 'm2', name: 'rahul', createdAt: 101 },
      ],
      expenses: [],
      settlements: [],
    },
    {
      version: SCHEMA_VERSION,
      members: [{ id: 'm1', name: 'Rahul', createdAt: 100 }],
      expenses: [],
      settlements: [{ id: 's1', fromId: 'm1', toId: 'm1', amountPaise: 100, createdAt: 300 }],
    },
  ];

  for (const badPayload of malformedPayloads) {
    const s = createMemoryStorage({ [STORAGE_KEY]: JSON.stringify(badPayload) });
    const res = loadState(s);
    assert.deepEqual(res.state, createInitialState());
    assert.equal(res.recovered, true);
    assert.ok(res.warning);
  }

  assert.equal(saveState(null, createMemoryStorage()).ok, false);
});

test('P-04: SecurityError and QuotaExceededError are handled without crashing', () => {
  const securityErrorStorage = {
    getItem() {
      const err = new Error('Blocked');
      err.name = 'SecurityError';
      throw err;
    },
    setItem() {
      const err = new Error('Blocked');
      err.name = 'SecurityError';
      throw err;
    },
    removeItem() {
      const err = new Error('Blocked');
      err.name = 'SecurityError';
      throw err;
    },
  };

  const loadBlocked = loadState(securityErrorStorage);
  assert.deepEqual(loadBlocked.state, createInitialState());
  assert.equal(loadBlocked.recovered, false);
  assert.match(loadBlocked.warning, /Storage unavailable/);

  const quotaStorage = {
    ...createMemoryStorage(),
    setItem() {
      const err = new Error('Quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    },
  };

  const store = createStore({ storage: quotaStorage });
  const addedA = store.addMember('Rahul');
  assert.equal(addedA.ok, true);
  assert.match(store.getState().storageWarning, /quota exceeded/i);
  assert.equal(saveState(createInitialState(), securityErrorStorage).ok, false);
  assert.equal(clearState(securityErrorStorage).ok, false);
});

// ---------------------------------------------------------------------------
// Store Full Lifecycle, Canonical Fields & Edge Cases (P-01, E-15, M-11, M-12, T-01..T-05)
// ---------------------------------------------------------------------------

test('Full lifecycle round-trip: Equal/Exact/Percentage splits, newest-first order, and reload persistence (P-01, E-15)', () => {
  const storage = createMemoryStorage();
  const store1 = createStore({ storage });

  const notifications = [];
  const unsubscribe = store1.subscribe((snap) => notifications.push(snap.expenses.length));

  const m1 = store1.addMember('Rahul').member;
  const m2 = store1.addMember('Priya').member;
  const m3 = store1.addMember('Aman').member;

  // Add equal, exact, and percentage expenses cleanly
  const eEqual = store1.addExpense({
    title: 'Breakfast',
    amount: '300',
    paidBy: m1.id,
    splitType: 'equal',
    splitAmong: [m1.id, m2.id, m3.id],
  });
  const eExact = store1.addExpense({
    title: 'Snacks',
    amount: '250',
    paidBy: m2.id,
    splitType: 'exact',
    splitAmong: [m1.id, m2.id],
    shareValues: { [m1.id]: '150', [m2.id]: '100' },
  });
  const ePct = store1.addExpense({
    title: 'Coffee',
    amount: '10',
    paidBy: m3.id,
    splitType: 'percentage',
    splitAmong: [m1.id, m2.id, m3.id],
    shareValues: { [m1.id]: '33.33', [m2.id]: '33.33', [m3.id]: '33.34' },
  });

  assert.equal(eEqual.ok && eExact.ok && ePct.ok, true);
  unsubscribe();
  assert.equal(notifications.length, 6); // 3 members + 3 expenses

  // Verify newest-first sorting even on same-millisecond timestamps (E-15)
  const derived1 = store1.getDerivedState();
  assert.deepEqual(
    derived1.filteredExpenses.map((e) => e.title),
    ['Coffee', 'Snacks', 'Breakfast']
  );

  // Reload fresh store from same mock storage (simulating F5 refresh P-01)
  const store2 = createStore({ storage });
  assert.deepEqual(store2.getState(), store1.getState());
  assert.deepEqual(store2.getDerivedState(), store1.getDerivedState());
  assert.equal(store2.getDerivedState().netSumPaise, 0);
});

test('Official Sample Test Case end-to-end through store: balances, canonical settlementPlan, settle + undo (S-03, T-01..T-05)', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });

  const rahul = store.addMember('Rahul').member;
  const priya = store.addMember('Priya').member;
  const aman = store.addMember('Aman').member;

  assert.equal(
    store.addExpense({
      title: 'Dinner',
      amount: '900',
      paidBy: rahul.id,
      splitType: 'equal',
      splitAmong: [rahul.id, priya.id, aman.id],
    }).ok,
    true
  );
  assert.equal(
    store.addExpense({
      title: 'Cab',
      amount: '300',
      paidBy: priya.id,
      splitType: 'equal',
      splitAmong: [priya.id, aman.id],
    }).ok,
    true
  );
  assert.equal(
    store.addExpense({
      title: 'Snacks',
      amount: '150',
      paidBy: aman.id,
      splitType: 'equal',
      splitAmong: [rahul.id, priya.id, aman.id],
    }).ok,
    true
  );

  const initial = store.getDerivedState();
  assert.equal(initial.totalSpendPaise, 135000);
  assert.equal(initial.netSumPaise, 0);
  assert.equal(initial.settlementPlan.length, 2);

  // Check canonical fields only (no fromMemberId/toMemberId alias leak in store.js)
  assert.deepEqual(initial.settlementPlan, [
    { fromId: aman.id, fromName: 'Aman', toId: rahul.id, toName: 'Rahul', amountPaise: 35000 },
    { fromId: priya.id, fromName: 'Priya', toId: rahul.id, toName: 'Rahul', amountPaise: 20000 },
  ]);

  // T-01: settle first payment (Aman -> Rahul ₹350)
  const s1 = store.markAsSettled(initial.settlementPlan[0]);
  assert.equal(s1.ok, true);

  // T-05: duplicate/stale click on same payment is rejected cleanly without mutating state
  const stale = store.markAsSettled(initial.settlementPlan[0]);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /no longer pending/i);

  // Settle remaining payment (Priya -> Rahul ₹200) -> all balances 0, plan empty
  const s2 = store.markAsSettled(store.getDerivedState().settlementPlan[0]);
  assert.equal(s2.ok, true);

  const settled = store.getDerivedState();
  assert.equal(settled.settlementPlan.length, 0);
  assert.equal(settled.netSumPaise, 0);
  for (const b of settled.balances) {
    assert.equal(b.netPaise, 0);
  }

  // T-02 & T-03 & T-05: undo second settlement (plus idempotent repeat), then delete Cab expense keeping zero-sum
  assert.equal(store.undoSettlement(s2.settlement.id).ok, true);
  assert.equal(store.undoSettlement('nonexistent_stl').ok, true);
  assert.equal(store.getDerivedState().settlementPlan.length, 1);

  const cabId = store.getState().expenses.find((e) => e.title === 'Cab').id;
  assert.equal(store.deleteExpense(cabId).ok, true);
  // Idempotent second delete (T-05)
  assert.equal(store.deleteExpense(cabId).ok, true);
  assert.equal(store.getDerivedState().netSumPaise, 0);
});

test('M-11, M-12, U-03, P-06 & Snapshot Immutability: member deletion, filter reset, group reset, defensive copies', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });

  const rahul = store.addMember('Rahul').member;
  const priya = store.addMember('Priya').member;
  const aman = store.addMember('Aman').member;

  const dinner = store.addExpense({
    title: 'Dinner',
    amount: '300',
    paidBy: rahul.id,
    splitType: 'equal',
    splitAmong: [rahul.id, priya.id],
  }).expense;

  // Member with expenses cannot be removed (M-07/M-08)
  const blocked = store.removeMember(rahul.id);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /existing expenses/);

  // Filter by unused member Aman (M-12 + U-03): balances still reflect entire group
  assert.equal(store.setMemberFilter(aman.id).ok, true);
  const filteredSnap = store.getSnapshot();
  assert.equal(filteredSnap.filteredExpenses.length, 0);
  assert.equal(filteredSnap.totalSpendPaise, 30000);

  // Removing Aman resets activeMemberFilter back to 'all' (M-12)
  assert.equal(store.removeMember(aman.id).ok, true);
  assert.equal(store.getState().activeMemberFilter, 'all');
  assert.equal(store.getDerivedState().filteredExpenses.length, 1);

  // T-04: removing final expense resets all balances to 0 and clears settlement plan
  store.deleteExpense(dinner.id);
  const afterAllDeleted = store.getDerivedState();
  assert.equal(afterAllDeleted.totalSpendPaise, 0);
  assert.deepEqual(afterAllDeleted.settlementPlan, []);
  for (const bal of afterAllDeleted.balances) {
    assert.equal(bal.netPaise, 0);
  }

  assert.equal(store.removeMember(priya.id).ok, true);
  assert.equal(store.getState().members.length, 1);
  // M-11: adding expense now fails until >= 2 members
  const minCheck = store.addExpense({
    title: 'Coffee',
    amount: '50',
    paidBy: rahul.id,
    splitAmong: [rahul.id],
  });
  assert.equal(minCheck.ok, false);
  assert.match(minCheck.error, /at least 2 members/);

  // External & cross-subscriber snapshot mutation cannot mutate store or sibling listeners
  const snapCopy = store.getSnapshot();
  snapCopy.members.push({ id: 'hack', name: 'Hacker', createdAt: 0 });
  assert.equal(store.getState().members.length, 1);

  let siblingSawClean = false;
  const unsub1 = store.subscribe((snap) => {
    snap.members[0].name = 'Tampered';
  });
  const unsub2 = store.subscribe((snap) => {
    siblingSawClean = snap.members[0].name === 'Rahul';
  });
  store.setMemberFilter('all');
  unsub1();
  unsub2();
  assert.equal(siblingSawClean, true);
  assert.equal(store.getState().members[0].name, 'Rahul');

  // P-06: resetGroup clears state, filter, and persisted storage key
  store.addMember('Priya');
  store.setMemberFilter(rahul.id);
  const resetRes = store.resetGroup();
  assert.equal(resetRes.ok, true);
  assert.equal(store.getState().members.length, 0);
  assert.equal(store.getState().activeMemberFilter, 'all');
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('Immutable Activity Log, Search, Viewer Perspective & Non-Deletability Guarantees', () => {
  const storage = createMemoryStorage();
  const store = createStore({ storage });

  // Store intentionally exposes zero activity-deletion or clear-activity APIs
  assert.equal(store.clearActivity, undefined);
  assert.equal(store.deleteActivity, undefined);

  const rahul = store.addMember('Rahul').member;
  const priya = store.addMember('Priya').member;
  const exp = store.addExpense({
    title: 'Airport Cab',
    amount: '300',
    paidBy: rahul.id,
    splitType: 'equal',
    splitAmong: [rahul.id, priya.id],
  }).expense;
  assert.equal(exp.category, 'cab');

  const stl = store.markAsSettled(store.getDerivedState().settlementPlan[0]).settlement;
  store.undoSettlement(stl.id);
  store.deleteExpense(exp.id);

  // Search query and viewer perspective work and reset on member removal / group reset
  store.addExpense({
    title: 'Dinner',
    amount: '200',
    paidBy: rahul.id,
    splitType: 'equal',
    splitAmong: [rahul.id, priya.id],
  });
  store.setSearchQuery('din');
  assert.equal(store.getDerivedState().filteredExpenses.length, 1);
  store.setSearchQuery('nomatch');
  assert.equal(store.getDerivedState().filteredExpenses.length, 0);
  store.setSearchQuery('');

  store.setViewerMember(priya.id);
  assert.equal(store.getState().viewerMemberId, priya.id);

  const countBeforeReset = store.getDerivedState().activityFeed.length;
  assert.ok(countBeforeReset >= 6);

  // Resetting group appends a group_reset entry and NEVER deletes activity history
  store.resetGroup();
  const afterResetFeed = store.getDerivedState().activityFeed;
  assert.equal(afterResetFeed.length, countBeforeReset + 1);
  assert.equal(afterResetFeed[0].type, 'group_reset');
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.ok(storage.getItem(ACTIVITY_STORAGE_KEY));

  // Storage adapter refuses attempts to shrink or wipe existing activity entries
  assert.equal(saveActivity([], storage).ok, false);
  assert.equal(loadActivity(storage).activity.length, countBeforeReset + 1);
});

test('Multi-Group Switching, Group Naming, Category Filter & Reload Persistence', () => {
  const storage = createMemoryStorage();
  const s1 = createStore({ storage });

  assert.equal(s1.setGroupName('Goa Trip').ok, true);
  assert.equal(s1.getState().groupName, 'Goa Trip');

  const rahul = s1.addMember('Rahul').member;
  const priya = s1.addMember('Priya').member;
  s1.addExpense({
    title: 'Cab',
    amount: '400',
    paidBy: rahul.id,
    splitType: 'equal',
    splitAmong: [rahul.id, priya.id],
    category: 'cab',
  });

  // Create second group and confirm clean isolation
  const created = s1.createGroup('Flatmates');
  assert.equal(created.ok, true);
  assert.equal(s1.getState().groupName, 'Flatmates');
  assert.equal(s1.getState().members.length, 0);

  // Switch back to Goa Trip across fresh store reload
  const s2 = createStore({ storage });
  assert.equal(s2.getState().groupName, 'Flatmates');
  const goaId = s2.getDerivedState().groups.find((g) => g.name === 'Goa Trip').id;
  assert.equal(s2.switchGroup(goaId).ok, true);
  assert.equal(s2.getState().members.length, 2);
  assert.equal(s2.setCategoryFilter('groceries').ok, true);
  assert.equal(s2.getDerivedState().filteredExpenses.length, 0);
  assert.equal(s2.setCategoryFilter('cab').ok, true);
  assert.equal(s2.getDerivedState().filteredExpenses.length, 1);

  // Activity log holds group_created alongside Goa Trip actions
  assert.ok(s2.getDerivedState().activityFeed.some((e) => e.type === 'group_created'));
});

test('Cloud Sync Helpers: Non-Destructive Activity Hydration', () => {
  const storage = createMemoryStorage();
  const s = createStore({ storage });
  const r = s.addMember('Rahul').member;
  const p = s.addMember('Priya').member;
  s.addExpense({
    title: 'Tea',
    amount: '100',
    paidBy: r.id,
    splitType: 'equal',
    splitAmong: [r.id, p.id],
  });
  const localActCount = s.getDerivedState().activityFeed.length;

  // Hydrate cloud entries + cloud group without wiping local activity log entries
  s.hydrateCloudWorkspace({
    activeGroupId: 'grp_cloud',
    groups: [
      {
        id: 'grp_cloud',
        name: 'Cloud Group',
        createdAt: 100,
        state: createInitialState(),
      },
    ],
    activityEntries: [
      {
        id: 'act_remote_1',
        type: 'group_created',
        summary: 'Created group "Cloud Group"',
        detail: 'Synced from mobile',
        category: 'other',
        amountPaise: null,
        createdAt: 50,
      },
    ],
  });

  assert.equal(s.getState().groupName, 'Cloud Group');
  assert.equal(s.getDerivedState().activityFeed.length, localActCount + 1);
  assert.ok(s.getCloudPayload().groups.some((g) => g.id === 'grp_cloud'));
});

async function runAsyncCloudSyncTests() {
  const storage = createMemoryStorage();
  const store = createStore({ storage });
  const events = [];

  class MockGoogleAuthProvider {
    setCustomParameters(params) {
      events.push(['params', params]);
    }
  }

  let popupMode = 'sync-ok';
  const mockSdk = {
    app: {},
    auth: { name: 'mock-auth' },
    db: {},
    fsMod: {},
    authMod: {
      GoogleAuthProvider: MockGoogleAuthProvider,
      onAuthStateChanged(_auth, cb) {
        cb(null);
      },
      getRedirectResult() {
        events.push(['getRedirectResult']);
        return Promise.resolve(null);
      },
      signInWithPopup() {
        events.push(['signInWithPopup']);
        if (popupMode === 'blocked') {
          const err = new Error('Blocked');
          err.code = 'auth/popup-blocked';
          return Promise.reject(err);
        }
        if (popupMode === 'closed') {
          const err = new Error('Closed');
          err.code = 'auth/popup-closed-by-user';
          return Promise.reject(err);
        }
        return Promise.resolve({ user: { uid: 'u1' } });
      },
      signInWithRedirect() {
        events.push(['signInWithRedirect']);
        return Promise.resolve();
      },
    },
  };

  // 0. Vercel same-origin authDomain & host detection
  assert.equal(resolveAuthDomain('easy-one-coral.vercel.app'), 'easy-one-coral.vercel.app');
  assert.equal(resolveAuthDomain('localhost:4173'), 'rupeesync-split-2026.firebaseapp.com');
  assert.equal(resolveAuthDomain(''), 'rupeesync-split-2026.firebaseapp.com');
  assert.equal(isSameOriginAuthHost('easy-one-coral.vercel.app'), true);
  assert.equal(isSameOriginAuthHost('rupeesync-split-2026.web.app'), true);
  assert.equal(isSameOriginAuthHost('rupeesync-split-2026.firebaseapp.com'), true);
  assert.equal(isSameOriginAuthHost('localhost'), false);

  // 1. Cold-click before SDK loads warms SDK without calling async popup
  const coldSync = createCloudSync({
    store,
    onStatusChange() {},
    sdkLoader: async () => mockSdk,
    allowRedirectFallback: () => false,
  });
  const resCold = await coldSync.signInWithGoogle();
  assert.equal(resCold.ok, false);
  assert.match(resCold.error, /ready now/i);
  assert.equal(
    events.some(([name]) => name === 'signInWithPopup'),
    false,
    'signInWithPopup must not run asynchronously after network SDK load'
  );

  const sync = createCloudSync({
    store,
    onStatusChange() {},
    sdkLoader: async () => mockSdk,
    allowRedirectFallback: () => false,
  });
  await sync.init();

  // 2. Synchronous invocation of signInWithPopup once SDK is cached
  const beforeLen = events.length;
  const pSync = sync.signInWithGoogle();
  assert.equal(
    events.slice(beforeLen).some(([name]) => name === 'signInWithPopup'),
    true,
    'signInWithPopup must be invoked synchronously before returning Promise'
  );
  const resOk = await pSync;
  assert.deepEqual(resOk, { ok: true, error: null, redirected: false });

  // 3. Cross-origin auth/popup-blocked shows clear popup guidance instead of broken redirect
  popupMode = 'blocked';
  const resCrossBlocked = await sync.signInWithGoogle();
  assert.equal(resCrossBlocked.ok, false);
  assert.equal(resCrossBlocked.redirected, false);
  assert.match(resCrossBlocked.error, /Allow popups/i);
  assert.equal(
    events.some(([name]) => name === 'signInWithRedirect'),
    false,
    'cross-origin host must not silently fall back to signInWithRedirect'
  );

  // 4. Same-origin host (Vercel proxy) falls back to signInWithRedirect on auth/popup-blocked
  const sameOriginSync = createCloudSync({
    store,
    onStatusChange() {},
    sdkLoader: async () => mockSdk,
    allowRedirectFallback: () => isSameOriginAuthHost('easy-one-coral.vercel.app'),
  });
  await sameOriginSync.init();
  const resRedirect = await sameOriginSync.signInWithGoogle();
  assert.deepEqual(resRedirect, { ok: true, error: null, redirected: true });
  assert.equal(
    events.some(([name]) => name === 'signInWithRedirect'),
    true,
    'same-origin signInWithRedirect fallback should trigger on auth/popup-blocked'
  );

  // 5. User-cancelled popup surfaces error cleanly without redirect
  const redirectCountBefore = events.filter(([name]) => name === 'signInWithRedirect').length;
  popupMode = 'closed';
  const resClosed = await sameOriginSync.signInWithGoogle();
  assert.equal(resClosed.ok, false);
  assert.match(resClosed.error, /closed before finishing/i);
  assert.equal(
    events.filter(([name]) => name === 'signInWithRedirect').length,
    redirectCountBefore
  );

  // 6. Malformed remote cloud hydration (negative/float paise, >10 members, bad activity) is rejected/sanitized
  const cloudStore = createStore({ storage: createMemoryStorage() });
  const localMember = cloudStore.addMember('LocalUser').member;
  const localCountBefore = cloudStore.getDerivedState().activityFeed.length;
  const tooManyMembers = Array.from({ length: 11 }, (_, idx) => ({
    id: `m_${idx}`,
    name: `User ${idx}`,
    createdAt: 100 + idx,
  }));
  cloudStore.hydrateCloudWorkspace({
    activeGroupId: 'grp_bad',
    groups: [
      {
        id: 'grp_bad',
        name: 'Tampered Float',
        createdAt: 100,
        state: {
          version: SCHEMA_VERSION,
          members: [
            { id: 'm1', name: 'Evil', createdAt: 100 },
            { id: 'm2', name: 'Victim', createdAt: 101 },
          ],
          expenses: [
            {
              id: 'e1',
              title: 'Bad',
              amountPaise: -999,
              paidBy: 'm1',
              splitType: 'equal',
              shares: [
                { memberId: 'm1', sharePaise: -500 },
                { memberId: 'm2', sharePaise: -499 },
              ],
              createdAt: 200,
            },
          ],
          settlements: [],
        },
      },
      {
        id: 'grp_overflow',
        name: 'Too Many Members',
        createdAt: 101,
        state: {
          version: SCHEMA_VERSION,
          members: tooManyMembers,
          expenses: [],
          settlements: [],
        },
      },
    ],
    activityEntries: [
      { id: 'bad_neg', type: 'expense_added', summary: 'Neg', amountPaise: -10, createdAt: 10 },
      { id: 'bad_missing_summary', type: 'expense_added', createdAt: 11 },
      { id: 'good_act', type: 'group_created', summary: 'Valid cloud act', createdAt: 12 },
    ],
  });
  assert.equal(cloudStore.getState().members.length, 1);
  assert.equal(cloudStore.getState().members[0].id, localMember.id);
  assert.match(cloudStore.getState().storageWarning ?? '', /invalid cloud workspace/i);
  assert.equal(cloudStore.getDerivedState().activityFeed.length, localCountBefore + 1);
  assert.equal(cloudStore.getDerivedState().activityFeed.some((e) => e.id === 'bad_neg'), false);
  assert.equal(cloudStore.getDerivedState().activityFeed.some((e) => e.id === 'good_act'), true);

  // 7. Corrupted GROUPS_STORAGE_KEY is purged cleanly on recovery and rejected by saveGroupsMeta
  const corruptGroupsStorage = createMemoryStorage({
    [STORAGE_KEY]: '{broken',
    [GROUPS_STORAGE_KEY]: '{"activeGroupId":"g1","groups":[{"id":"g1","name":"Tampered"}]}',
  });
  const recoveredStore = createStore({ storage: corruptGroupsStorage });
  assert.equal(corruptGroupsStorage.getItem(GROUPS_STORAGE_KEY), null);
  assert.equal(recoveredStore.getState().members.length, 0);
  assert.equal(saveGroupsMeta({ activeGroupId: 'g1', groups: [] }, corruptGroupsStorage).ok, false);
  assert.equal(loadGroupsMeta(corruptGroupsStorage), null);

  // 8. Explicit signOutUser clears all synced local workspace keys for shared-device hygiene
  const signOutStorage = createMemoryStorage();
  const signOutStore = createStore({ storage: signOutStorage });
  const rA = signOutStore.addMember('Alice').member;
  const rB = signOutStore.addMember('Bob').member;
  signOutStore.addExpense({
    title: 'Lunch',
    amount: '200',
    paidBy: rA.id,
    splitType: 'equal',
    splitAmong: [rA.id, rB.id],
  });
  signOutStore.createGroup('Office');
  assert.ok(signOutStorage.getItem(STORAGE_KEY));
  assert.ok(signOutStorage.getItem(GROUPS_STORAGE_KEY));
  assert.ok(signOutStorage.getItem(ACTIVITY_STORAGE_KEY));

  const signOutSync = createCloudSync({
    store: signOutStore,
    onStatusChange() {},
    sdkLoader: async () => ({
      ...mockSdk,
      authMod: {
        ...mockSdk.authMod,
        signOut() {
          events.push(['signOut']);
          return Promise.resolve();
        },
      },
    }),
  });
  const signOutRes = await signOutSync.signOutUser();
  assert.equal(signOutRes.ok, true);
  assert.equal(signOutStorage.getItem(STORAGE_KEY), null);
  assert.equal(signOutStorage.getItem(GROUPS_STORAGE_KEY), null);
  assert.equal(signOutStorage.getItem(ACTIVITY_STORAGE_KEY), null);
  assert.equal(signOutStore.getState().members.length, 0);
  assert.equal(signOutStore.getState().expenses.length, 0);
  assert.equal(signOutStore.getDerivedState().activityFeed.length, 0);

  passed += 1;
  console.log('PASS: Cloud Sync: Google popup/redirect, malformed cloud rejection, group purge & sign-out wipe');
}

await runAsyncCloudSyncTests();

console.log(`\nPhase 3 state & persistence tests complete: ${passed} passed, 0 failed.`);
