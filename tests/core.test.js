import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  MAX_AMOUNT_PAISE,
  TOTAL_BPS,
  distributeEqual,
  distributePercentage,
  formatBps,
  formatRupees,
  parsePercentToBps,
  parseRupeesToPaise,
} from '../src/core/money.js';
import {
  MAX_MEMBERS,
  normalizeMemberName,
  validateAddMember,
  validateExpenseInput,
  validateRemoveMember,
} from '../src/core/validators.js';
import { calculateBalances } from '../src/core/balances.js';
import { computeMinimumSettlements, verifySettlements } from '../src/core/settleUp.js';

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

function makeMembers(names) {
  return names.map((name, idx) => ({
    id: `m${idx + 1}`,
    name,
    createdAt: 1000 + idx,
  }));
}

// ---------------------------------------------------------------------------
// Currency Parsing & Precision Edge Cases (C-01 to C-09)
// ---------------------------------------------------------------------------

test('C-01: string-split parser avoids IEEE 754 float multiplication traps', () => {
  assert.deepEqual(parseRupeesToPaise('19.99'), { valid: true, paise: 1999, error: null });
  assert.deepEqual(parseRupeesToPaise('35.85'), { valid: true, paise: 3585, error: null });
  const p1 = parseRupeesToPaise('0.1');
  const p2 = parseRupeesToPaise('0.2');
  assert.equal(p1.paise + p2.paise, 30);
});

test('C-02: zero amounts rejected for expense, allowed when allowZero=true', () => {
  for (const zeroStr of ['0', '0.0', '0.00']) {
    const resExpense = parseRupeesToPaise(zeroStr);
    assert.equal(resExpense.valid, false);
    assert.equal(resExpense.error, 'Amount must be greater than ₹0.');

    const resShare = parseRupeesToPaise(zeroStr, { allowZero: true });
    assert.equal(resShare.valid, true);
    assert.equal(resShare.paise, 0);
  }
});

test('C-03: negative amounts are rejected everywhere', () => {
  for (const neg of ['-50', '-0.01', '-0', '-0.00']) {
    assert.equal(parseRupeesToPaise(neg).valid, false);
    assert.equal(parseRupeesToPaise(neg, { allowZero: true }).valid, false);
  }
});

test('C-04: amounts with more than 2 decimal places are rejected', () => {
  for (const bad of ['10.125', '0.001', '100.000']) {
    const res = parseRupeesToPaise(bad);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'Enter a valid positive amount with at most 2 decimal places.');
  }
});

test('C-05: non-numeric and exotic inputs are rejected cleanly', () => {
  const badInputs = ['', '   ', 'abc', '1e5', 'Infinity', 'NaN', '1,000', '+50', '100.', '.50', null, undefined, NaN, Infinity];
  for (const bad of badInputs) {
    assert.equal(parseRupeesToPaise(bad).valid, false, `Expected rejection for ${String(bad)}`);
  }
});

test('C-06: smallest valid amount 0.01 parses to 1 paisa and formats as ₹0.01', () => {
  const res = parseRupeesToPaise('0.01');
  assert.equal(res.valid, true);
  assert.equal(res.paise, 1);
  assert.equal(formatRupees(res.paise), '₹0.01');
});

test('C-07: single decimal place and leading/trailing spaces & zeros parse cleanly', () => {
  const res1 = parseRupeesToPaise('  12.5  ');
  assert.equal(res1.valid, true);
  assert.equal(res1.paise, 1250);
  assert.equal(formatRupees(res1.paise), '₹12.50');

  const res2 = parseRupeesToPaise('0050.5');
  assert.equal(res2.valid, true);
  assert.equal(res2.paise, 5050);
  assert.equal(formatRupees(res2.paise), '₹50.50');
});

test('C-08: overflow values exceeding ₹1,00,00,000 (10^9 paise) are rejected', () => {
  const maxOk = parseRupeesToPaise('10000000');
  assert.equal(maxOk.valid, true);
  assert.equal(maxOk.paise, MAX_AMOUNT_PAISE);

  for (const huge of ['10000000.01', '999999999999999']) {
    const res = parseRupeesToPaise(huge);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'Amount exceeds the maximum allowed limit.');
  }
});

test('C-09: display formatting hides .00 on whole rupees and supports signed balances', () => {
  assert.equal(formatRupees(35000), '₹350');
  assert.equal(formatRupees(3334), '₹33.34');
  assert.equal(formatRupees(1050), '₹10.50');
  assert.equal(formatRupees(0, { signed: true }), '₹0');
  assert.equal(formatRupees(-0, { signed: true }), '₹0');
  assert.equal(formatRupees(55000, { signed: true }), '+₹550');
  assert.equal(formatRupees(-20000, { signed: true }), '-₹200');
  assert.equal(formatRupees(-1050, { signed: true }), '-₹10.50');
});

// ---------------------------------------------------------------------------
// Member Management Edge Cases (M-01 to M-10, M-13, M-14)
// ---------------------------------------------------------------------------

test('M-01: empty or whitespace-only member name is rejected', () => {
  for (const empty of ['', '   ', '\t\n  ', null]) {
    const res = validateAddMember(empty, []);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'Member name cannot be empty.');
  }
});

test('M-02: whitespace normalization trims and collapses repeated internal spaces', () => {
  assert.equal(normalizeMemberName('  Rahul   Verma\t '), 'Rahul Verma');
  const existing = makeMembers(['Rahul Verma']);
  const dup = validateAddMember('  rahul    verma ', existing);
  assert.equal(dup.valid, false);
  assert.equal(dup.error, 'A member with this name already exists.');
});

test('M-03: case-insensitive duplicate member names are rejected', () => {
  const existing = makeMembers(['Rahul']);
  for (const variant of ['rahul', 'RAHUL', 'RaHuL']) {
    const res = validateAddMember(variant, existing);
    assert.equal(res.valid, false);
    assert.equal(res.error, 'A member with this name already exists.');
  }
});

test('M-04: adding expenses requires at least 2 members', () => {
  const zeroMembers = [];
  const oneMember = makeMembers(['Rahul']);
  const payload = { title: 'Snacks', amount: '100', paidBy: 'm1', splitAmong: ['m1'] };
  assert.equal(validateExpenseInput(payload, zeroMembers).valid, false);
  const res = validateExpenseInput(payload, oneMember);
  assert.equal(res.valid, false);
  assert.equal(res.error, 'Add at least 2 members to start adding expenses.');
});

test('M-05 & M-06: maximum 10 members enforced and removal re-enables addition', () => {
  const nine = makeMembers(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  const tenth = validateAddMember('J', nine);
  assert.equal(tenth.valid, true);

  const ten = makeMembers(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  const eleventh = validateAddMember('K', ten);
  assert.equal(eleventh.valid, false);
  assert.equal(eleventh.error, `Maximum ${MAX_MEMBERS} members allowed per group.`);

  const canRemoveUnused = validateRemoveMember('m10', { members: ten, expenses: [], settlements: [] });
  assert.equal(canRemoveUnused.valid, true);
  assert.equal(validateAddMember('K', ten.slice(0, 9)).valid, true);
});

test('M-07 & M-08 & M-10: member removal blocked if payer or in shares, allowed once expenses deleted', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);
  const expenses = [
    {
      id: 'e1',
      title: 'Cab',
      amountPaise: 30000,
      paidBy: 'm1', // Rahul paid but only Priya is in shares
      splitType: 'equal',
      shares: [{ memberId: 'm2', sharePaise: 30000 }],
      createdAt: 2000,
    },
  ];

  // M-07: payer not in splitAmong is still blocked
  const rmPayer = validateRemoveMember('m1', { members, expenses, settlements: [] });
  assert.equal(rmPayer.valid, false);
  assert.equal(rmPayer.error, 'Cannot remove Rahul because they have existing expenses.');

  // M-08: participant who paid ₹0 is still blocked
  const rmParticipant = validateRemoveMember('m2', { members, expenses, settlements: [] });
  assert.equal(rmParticipant.valid, false);
  assert.equal(rmParticipant.error, 'Cannot remove Priya because they have existing expenses.');

  // Unused member can be removed
  assert.equal(validateRemoveMember('m3', { members, expenses, settlements: [] }).valid, true);

  // M-10: after expenses are deleted, Rahul and Priya can both be removed
  assert.equal(validateRemoveMember('m1', { members, expenses: [], settlements: [] }).valid, true);
  assert.equal(validateRemoveMember('m2', { members, expenses: [], settlements: [] }).valid, true);
});

test('M-09: member removal blocked if referenced in a recorded settlement', () => {
  const members = makeMembers(['Rahul', 'Priya']);
  const settlements = [{ id: 's1', fromId: 'm2', toId: 'm1', amountPaise: 10000, createdAt: 3000 }];

  const rmTo = validateRemoveMember('m1', { members, expenses: [], settlements });
  assert.equal(rmTo.valid, false);
  assert.equal(
    rmTo.error,
    'Cannot remove Rahul because they are part of a recorded settlement. Undo the settlement first.'
  );

  const rmFrom = validateRemoveMember('m2', { members, expenses: [], settlements });
  assert.equal(rmFrom.valid, false);
  assert.equal(
    rmFrom.error,
    'Cannot remove Priya because they are part of a recorded settlement. Undo the settlement first.'
  );
});

test('M-13 & M-14: special characters accepted verbatim and >40 char names rejected', () => {
  const xssName = '<img src=x onerror=alert(1)>';
  const resXss = validateAddMember(xssName, []);
  assert.equal(resXss.valid, true);
  assert.equal(resXss.normalizedName, xssName);

  const long40 = 'A'.repeat(40);
  assert.equal(validateAddMember(long40, []).valid, true);

  const long41 = 'A'.repeat(41);
  const resLong = validateAddMember(long41, []);
  assert.equal(resLong.valid, false);
  assert.equal(resLong.error, 'Member name cannot exceed 40 characters.');
});

// ---------------------------------------------------------------------------
// Expense & Splitting Edge Cases (E-01 to E-14)
// ---------------------------------------------------------------------------

test('E-01 & E-02: empty title and empty splitAmong are rejected', () => {
  const members = makeMembers(['Rahul', 'Priya']);
  const badTitle = validateExpenseInput(
    { title: '   ', amount: '100', paidBy: 'm1', splitAmong: ['m1', 'm2'] },
    members
  );
  assert.equal(badTitle.valid, false);
  assert.equal(badTitle.error, 'Expense title cannot be empty.');

  const badSplit = validateExpenseInput(
    { title: 'Dinner', amount: '100', paidBy: 'm1', splitAmong: [] },
    members
  );
  assert.equal(badSplit.valid, false);
  assert.equal(badSplit.error, 'Select at least one member to split among.');
});

test('E-03 & E-04: payer excluded from splitAmong and payer-only self-expense are valid', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);

  // E-03: Rahul pays ₹300 split among Priya & Aman
  const e3 = validateExpenseInput(
    { title: 'Cab', amount: '300', paidBy: 'm1', splitType: 'equal', splitAmong: ['m2', 'm3'] },
    members
  );
  assert.equal(e3.valid, true);
  assert.deepEqual(e3.parsed.shares, [
    { memberId: 'm2', sharePaise: 15000 },
    { memberId: 'm3', sharePaise: 15000 },
  ]);

  // E-04: Rahul pays ₹200 split only for Rahul
  const e4 = validateExpenseInput(
    { title: 'Coffee', amount: '200', paidBy: 'm1', splitType: 'equal', splitAmong: ['m1'] },
    members
  );
  assert.equal(e4.valid, true);
  assert.deepEqual(e4.parsed.shares, [{ memberId: 'm1', sharePaise: 20000 }]);
});

test('E-05, E-06, E-07: equal split distributes remainder deterministically with zero penny loss', () => {
  // E-05: ₹100 among 3
  const s3 = distributeEqual(10000, ['m1', 'm2', 'm3']);
  assert.deepEqual(s3.map((s) => s.sharePaise), [3334, 3333, 3333]);
  assert.equal(s3.reduce((acc, s) => acc + s.sharePaise, 0), 10000);

  // E-06: ₹0.01 & ₹0.02 among 3
  assert.deepEqual(distributeEqual(1, ['m1', 'm2', 'm3']).map((s) => s.sharePaise), [1, 0, 0]);
  assert.deepEqual(distributeEqual(2, ['m1', 'm2', 'm3']).map((s) => s.sharePaise), [1, 1, 0]);

  // E-07: ₹10 among 7 -> six 143 + one 142
  const s7 = distributeEqual(1000, ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(s7.map((s) => s.sharePaise), [143, 143, 143, 143, 143, 143, 142]);
  assert.equal(s7.reduce((acc, s) => acc + s.sharePaise, 0), 1000);
});

test('E-08, E-09, E-11: exact split validation allows ₹0 share, ignores unselected, reports diff', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);

  // E-08: short by ₹50
  const shortRes = validateExpenseInput(
    {
      title: 'Dinner',
      amount: '900',
      paidBy: 'm1',
      splitType: 'exact',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '400', m2: '450' },
    },
    members
  );
  assert.equal(shortRes.valid, false);
  assert.equal(shortRes.error, 'Short by ₹50.');

  // E-08: exceeds total by ₹25
  const overRes = validateExpenseInput(
    {
      title: 'Dinner',
      amount: '900',
      paidBy: 'm1',
      splitType: 'exact',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '500', m2: '425' },
    },
    members
  );
  assert.equal(overRes.valid, false);
  assert.equal(overRes.error, 'Exceeds total by ₹25.');

  // E-09 & E-11: valid ₹0 share for m2, and unchecked m3 shareValue ignored
  const validExact = validateExpenseInput(
    {
      title: 'Lunch',
      amount: '500',
      paidBy: 'm1',
      splitType: 'exact',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '500', m2: '0', m3: '999' },
    },
    members
  );
  assert.equal(validExact.valid, true);
  assert.deepEqual(validExact.parsed.shares, [
    { memberId: 'm1', sharePaise: 50000 },
    { memberId: 'm2', sharePaise: 0 },
  ]);
});

test('E-12, E-13, E-14: percentage split basis points, Hamilton method, and deterministic tie-break', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);

  // parsePercentToBps checks
  assert.deepEqual(parsePercentToBps('33.33'), { valid: true, bps: 3333, error: null });
  assert.equal(parsePercentToBps('100.01').valid, false);
  assert.equal(parsePercentToBps('-5').valid, false);
  assert.equal(formatBps(TOTAL_BPS), '100%');
  assert.equal(formatBps(1), '0.01%');

  // E-12: 99.99% and 100.01% rejected
  const pct9999 = validateExpenseInput(
    {
      title: 'Bill',
      amount: '100',
      paidBy: 'm1',
      splitType: 'percentage',
      splitAmong: ['m1', 'm2', 'm3'],
      shareValues: { m1: '33.33', m2: '33.33', m3: '33.33' },
    },
    members
  );
  assert.equal(pct9999.valid, false);
  assert.match(pct9999.error, /0\.01%/);

  const pct10001 = validateExpenseInput(
    {
      title: 'Bill',
      amount: '100',
      paidBy: 'm1',
      splitType: 'percentage',
      splitAmong: ['m1', 'm2', 'm3'],
      shareValues: { m1: '33.34', m2: '33.34', m3: '33.33' },
    },
    members
  );
  assert.equal(pct10001.valid, false);
  assert.match(pct10001.error, /0\.01%/);

  // E-13: 33.33 / 33.33 / 33.34 over ₹10 (1000 paise) -> Hamilton awards extra paisa to 33.34% (largest remainder)
  const pctValid = validateExpenseInput(
    {
      title: 'Bill',
      amount: '10',
      paidBy: 'm1',
      splitType: 'percentage',
      splitAmong: ['m1', 'm2', 'm3'],
      shareValues: { m1: '33.33', m2: '33.33', m3: '33.34' },
    },
    members
  );
  assert.equal(pctValid.valid, true);
  assert.deepEqual(pctValid.parsed.shares, [
    { memberId: 'm1', sharePaise: 333, percent: 33.33 },
    { memberId: 'm2', sharePaise: 333, percent: 33.33 },
    { memberId: 'm3', sharePaise: 334, percent: 33.34 },
  ]);

  // E-14: ₹0.01 split 50% / 50% assigns extra paisa deterministically to first member
  const tie = distributePercentage(1, [
    { memberId: 'm1', bps: 5000 },
    { memberId: 'm2', bps: 5000 },
  ]);
  assert.deepEqual(tie, [
    { memberId: 'm1', sharePaise: 1, percent: 50 },
    { memberId: 'm2', sharePaise: 0, percent: 50 },
  ]);
});

// ---------------------------------------------------------------------------
// Extended Defensive, Boundary & Contract Coverage (Phase 1 Audit)
// ---------------------------------------------------------------------------

test('Money defensive edges: null options, -0, 1e21 overflow, Indian grouping & throws', () => {
  assert.deepEqual(parseRupeesToPaise('10', null), { valid: true, paise: 1000, error: null });
  assert.deepEqual(parseRupeesToPaise('10000000.00'), { valid: true, paise: MAX_AMOUNT_PAISE, error: null });
  assert.deepEqual(parseRupeesToPaise('0010000000.00'), { valid: true, paise: MAX_AMOUNT_PAISE, error: null });
  assert.equal(parseRupeesToPaise(-0, { allowZero: true }).valid, false);
  assert.equal(parseRupeesToPaise(1e21).error, 'Amount exceeds the maximum allowed limit.');

  assert.equal(formatRupees(100, null), '₹1');
  assert.equal(formatRupees(100000), '₹1,000');
  assert.equal(formatRupees(1000000000), '₹1,00,00,000');
  assert.throws(() => formatRupees(12.5), TypeError);
  assert.throws(() => formatRupees(NaN), TypeError);

  assert.deepEqual(parsePercentToBps('0'), { valid: true, bps: 0, error: null });
  assert.deepEqual(parsePercentToBps('100.00'), { valid: true, bps: 10000, error: null });
  assert.deepEqual(parsePercentToBps('0.01'), { valid: true, bps: 1, error: null });
  assert.equal(parsePercentToBps('10.125').valid, false);
  assert.equal(parsePercentToBps(-0).valid, false);

  assert.throws(() => distributeEqual(-1, ['m1']), TypeError);
  assert.throws(() => distributeEqual(10.5, ['m1']), TypeError);
  assert.throws(() => distributeEqual(100, []), TypeError);
  assert.throws(() => distributeEqual(100, ['m1', '']), TypeError);
  assert.throws(() => distributeEqual(100, ['m1', 'm1']), Error);

  assert.throws(() => distributePercentage(100, []), TypeError);
  assert.throws(() => distributePercentage(100, [{ memberId: 'm1', bps: 5000 }]), Error);
  assert.throws(() => distributePercentage(100, [{ memberId: 'm1', bps: 5000 }, { memberId: 'm1', bps: 5000 }]), Error);
  assert.throws(() => distributePercentage(100, [{ memberId: 'm1', bps: -1 }]), TypeError);
  assert.throws(
    () => distributePercentage(10000000000003, [{ memberId: 'm1', bps: 3333 }, { memberId: 'm2', bps: 6667 }]),
    RangeError
  );
});

test('Member validators defensive edges: malformed inputs, missing member, un-normalized state', () => {
  assert.equal(validateAddMember('Rahul', null).valid, true);
  assert.equal(validateAddMember('Rahul', {}).valid, true);
  assert.equal(validateAddMember('Rahul Verma', [null, { id: 'm1', name: 'rahul   verma' }]).valid, false);

  assert.deepEqual(validateRemoveMember('missing', { members: makeMembers(['Rahul']) }), {
    valid: false,
    error: 'Member not found.',
  });
  assert.equal(validateRemoveMember(undefined, { members: [{ name: 'Bad' }] }).valid, false);
  assert.equal(validateRemoveMember('m1', { members: 'bad', expenses: null, settlements: {} }).valid, false);
  assert.equal(validateRemoveMember('m1', { members: [null, { id: 'm1', name: 'Rahul' }] }).valid, true);
});

test('Expense validator defensive & split paths: parsed shape, invalid fields, prototype safety', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);

  // Default splitType & title trimming
  const okDefault = validateExpenseInput(
    { title: '  Dinner  ', amount: '300', paidBy: 'm1', splitAmong: ['m1', 'm1', 'm2'] },
    members
  );
  assert.equal(okDefault.valid, true);
  assert.deepEqual(okDefault.parsed, {
    title: 'Dinner',
    amountPaise: 30000,
    paidBy: 'm1',
    splitType: 'equal',
    shares: [
      { memberId: 'm1', sharePaise: 15000 },
      { memberId: 'm2', sharePaise: 15000 },
    ],
  });

  // Invalid paidBy, splitType, non-existent/undefined splitAmong, invalid amount, null payload
  assert.equal(validateExpenseInput(null, members).valid, false);
  assert.equal(
    validateExpenseInput({ title: 'T', amount: '10', paidBy: 'missing', splitAmong: ['m1'] }, members).error,
    'Select a valid member who paid.'
  );
  assert.equal(
    validateExpenseInput({ title: 'T', amount: '10', paidBy: 'm1', splitAmong: ['missing'] }, members).error,
    'Split includes an invalid member.'
  );
  assert.equal(
    validateExpenseInput({ title: 'T', amount: '10', paidBy: 'm1', splitAmong: ['m1'], splitType: null }, members).error,
    'Invalid split mode.'
  );
  assert.equal(
    validateExpenseInput({ title: 'T', amount: '0', paidBy: 'm1', splitAmong: ['m1'] }, members).error,
    'Amount must be greater than ₹0.'
  );

  // Exact split invalid share & prototype key collision safety & fractional paisa exact sum
  const badExact = validateExpenseInput(
    {
      title: 'T',
      amount: '100',
      paidBy: 'm1',
      splitType: 'exact',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '100', m2: '-5' },
    },
    members
  );
  assert.equal(badExact.valid, false);
  assert.match(badExact.error, /^Invalid exact share for Priya:/);

  const protoMember = [{ id: 'toString', name: 'Proto' }, { id: 'm2', name: 'Priya' }];
  assert.equal(
    validateExpenseInput(
      { title: 'T', amount: '100', paidBy: 'm2', splitType: 'exact', splitAmong: ['toString', 'm2'], shareValues: {} },
      protoMember
    ).valid,
    false
  );

  const fractionalExact = validateExpenseInput(
    {
      title: 'Split',
      amount: '100',
      paidBy: 'm1',
      splitType: 'exact',
      splitAmong: ['m1', 'm2', 'm3'],
      shareValues: { m1: '33.34', m2: '33.33', m3: '33.33' },
    },
    members
  );
  assert.equal(fractionalExact.valid, true);

  // Percentage split: 0% share allowed, invalid entry rejected
  const zeroPct = validateExpenseInput(
    {
      title: 'Treat',
      amount: '250',
      paidBy: 'm1',
      splitType: 'percentage',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '100', m2: '0' },
    },
    members
  );
  assert.equal(zeroPct.valid, true);
  assert.deepEqual(zeroPct.parsed.shares, [
    { memberId: 'm1', sharePaise: 25000, percent: 100 },
    { memberId: 'm2', sharePaise: 0, percent: 0 },
  ]);

  const badPct = validateExpenseInput(
    {
      title: 'Treat',
      amount: '250',
      paidBy: 'm1',
      splitType: 'percentage',
      splitAmong: ['m1', 'm2'],
      shareValues: { m1: '100', m2: '33.333' },
    },
    members
  );
  assert.equal(badPct.valid, false);
  assert.match(badPct.error, /^Invalid percentage for Priya:/);
});

// ---------------------------------------------------------------------------
// Phase 2: Balance Engine & Minimum-Transaction Solver (S-01 to S-11, T-01 to T-04)
// ---------------------------------------------------------------------------

test('S-01 & S-02 & T-04: zero expenses and self-settled zero-net expenses yield 0 payments', () => {
  const members = makeMembers(['Rahul', 'Priya']);

  // S-01: no expenses
  const emptyBal = calculateBalances(members, [], []);
  assert.equal(emptyBal.totalSpendPaise, 0);
  assert.equal(emptyBal.netSumPaise, 0);
  assert.deepEqual(
    emptyBal.balances.map((b) => [b.paidPaise, b.sharePaise, b.netPaise]),
    [
      [0, 0, 0],
      [0, 0, 0],
    ]
  );
  assert.deepEqual(computeMinimumSettlements(emptyBal.balances), []);

  // S-02: self-expense (E-04) + canceling equal expense -> net 0 everywhere
  const selfExpense = {
    id: 'e1',
    title: 'Coffee',
    amountPaise: 15000,
    paidBy: 'm1',
    splitType: 'equal',
    shares: [{ memberId: 'm1', sharePaise: 15000 }],
  };
  const mutualA = {
    id: 'e2',
    title: 'Lunch',
    amountPaise: 20000,
    paidBy: 'm1',
    splitType: 'equal',
    shares: [
      { memberId: 'm1', sharePaise: 10000 },
      { memberId: 'm2', sharePaise: 10000 },
    ],
  };
  const mutualB = {
    id: 'e3',
    title: 'Snacks',
    amountPaise: 20000,
    paidBy: 'm2',
    splitType: 'equal',
    shares: [
      { memberId: 'm1', sharePaise: 10000 },
      { memberId: 'm2', sharePaise: 10000 },
    ],
  };

  const settledBal = calculateBalances(members, [selfExpense, mutualA, mutualB]);
  assert.equal(settledBal.totalSpendPaise, 55000);
  assert.equal(settledBal.netSumPaise, 0);
  assert.deepEqual(computeMinimumSettlements(settledBal.balances), []);

  // T-04: clearing expenses restores zeros cleanly
  const clearedBal = calculateBalances(members, []);
  assert.equal(clearedBal.totalSpendPaise, 0);
  assert.deepEqual(computeMinimumSettlements(clearedBal.balances), []);
});

test('S-03: Official Sample Test Case (Rahul, Priya, Aman -> exact balances and 2 payments)', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);
  const expenses = [
    {
      id: 'e1',
      title: 'Dinner',
      amountPaise: 90000,
      paidBy: 'm1',
      splitType: 'equal',
      shares: distributeEqual(90000, ['m1', 'm2', 'm3']),
    },
    {
      id: 'e2',
      title: 'Cab',
      amountPaise: 30000,
      paidBy: 'm2',
      splitType: 'equal',
      shares: distributeEqual(30000, ['m2', 'm3']),
    },
    {
      id: 'e3',
      title: 'Snacks',
      amountPaise: 15000,
      paidBy: 'm3',
      splitType: 'equal',
      shares: distributeEqual(15000, ['m1', 'm2', 'm3']),
    },
  ];

  const { balances, totalSpendPaise, netSumPaise } = calculateBalances(members, expenses);
  assert.equal(totalSpendPaise, 135000);
  assert.equal(netSumPaise, 0);

  const byName = Object.fromEntries(balances.map((b) => [b.name, b]));
  assert.equal(byName.Rahul.paidPaise, 90000);
  assert.equal(byName.Rahul.sharePaise, 35000);
  assert.equal(byName.Rahul.netPaise, 55000);

  assert.equal(byName.Priya.paidPaise, 30000);
  assert.equal(byName.Priya.sharePaise, 50000);
  assert.equal(byName.Priya.netPaise, -20000);

  assert.equal(byName.Aman.paidPaise, 15000);
  assert.equal(byName.Aman.sharePaise, 50000);
  assert.equal(byName.Aman.netPaise, -35000);

  const payments = computeMinimumSettlements(balances);
  assert.equal(payments.length, 2);
  assert.equal(`${payments[0].fromName} pays ${payments[0].toName} ${formatRupees(payments[0].amountPaise)}`, 'Aman pays Rahul ₹350');
  assert.equal(`${payments[1].fromName} pays ${payments[1].toName} ${formatRupees(payments[1].amountPaise)}`, 'Priya pays Rahul ₹200');
  assert.equal(payments[0].fromMemberId, 'm3');
  assert.equal(payments[0].toMemberId, 'm1');
  assert.equal(verifySettlements(balances, payments), true);
});

test('S-04, S-05, S-06: transitive chains collapse to 1 payment and closed cycles yield 0 payments', () => {
  // S-04: A owes B ₹100, B owes C ₹100
  const m3 = makeMembers(['A', 'B', 'C']);
  const chain3 = calculateBalances(m3, [
    { id: 'e1', amountPaise: 10000, paidBy: 'm2', shares: [{ memberId: 'm1', sharePaise: 10000 }] },
    { id: 'e2', amountPaise: 10000, paidBy: 'm3', shares: [{ memberId: 'm2', sharePaise: 10000 }] },
  ]);
  const p3 = computeMinimumSettlements(chain3.balances);
  assert.equal(p3.length, 1);
  assert.equal(p3[0].fromName, 'A');
  assert.equal(p3[0].toName, 'C');
  assert.equal(p3[0].amountPaise, 10000);
  assert.equal(verifySettlements(chain3.balances, p3), true);

  // S-05: 4-member chain A -> B -> C -> D ₹100 each -> 1 payment A pays D ₹100
  const m4 = makeMembers(['A', 'B', 'C', 'D']);
  const chain4 = calculateBalances(m4, [
    { id: 'e1', amountPaise: 10000, paidBy: 'm2', shares: [{ memberId: 'm1', sharePaise: 10000 }] },
    { id: 'e2', amountPaise: 10000, paidBy: 'm3', shares: [{ memberId: 'm2', sharePaise: 10000 }] },
    { id: 'e3', amountPaise: 10000, paidBy: 'm4', shares: [{ memberId: 'm3', sharePaise: 10000 }] },
  ]);
  const p4 = computeMinimumSettlements(chain4.balances);
  assert.equal(p4.length, 1);
  assert.equal(p4[0].fromName, 'A');
  assert.equal(p4[0].toName, 'D');
  assert.equal(p4[0].amountPaise, 10000);
  assert.equal(verifySettlements(chain4.balances, p4), true);

  // S-06: closed cycle A -> B -> C -> A -> 0 payments
  const cycle = calculateBalances(m3, [
    { id: 'e1', amountPaise: 10000, paidBy: 'm2', shares: [{ memberId: 'm1', sharePaise: 10000 }] },
    { id: 'e2', amountPaise: 10000, paidBy: 'm3', shares: [{ memberId: 'm2', sharePaise: 10000 }] },
    { id: 'e3', amountPaise: 10000, paidBy: 'm1', shares: [{ memberId: 'm3', sharePaise: 10000 }] },
  ]);
  assert.deepEqual(computeMinimumSettlements(cycle.balances), []);
});

test('S-07 & S-08: greedy-failure traps and disjoint pairs achieve Bitmask DP optimum', () => {
  // User prompt greedy trap: [+70000, +60000, -60000, -40000, -30000] -> 3 transactions (not 4)
  const trap1 = [
    { memberId: 'm1', name: 'A', netPaise: 70000 },
    { memberId: 'm2', name: 'B', netPaise: 60000 },
    { memberId: 'm3', name: 'C', netPaise: -60000 },
    { memberId: 'm4', name: 'D', netPaise: -40000 },
    { memberId: 'm5', name: 'E', netPaise: -30000 },
  ];
  const res1 = computeMinimumSettlements(trap1);
  assert.equal(res1.length, 3);
  assert.equal(verifySettlements(trap1, res1), true);

  // edgecase.md S-07 trap: [+80000, +60000, -60000, -50000, -30000] -> 3 transactions
  const trap2 = [
    { memberId: 'm1', name: 'A', netPaise: 80000 },
    { memberId: 'm2', name: 'B', netPaise: 60000 },
    { memberId: 'm3', name: 'C', netPaise: -60000 },
    { memberId: 'm4', name: 'D', netPaise: -50000 },
    { memberId: 'm5', name: 'E', netPaise: -30000 },
  ];
  const res2 = computeMinimumSettlements(trap2);
  assert.equal(res2.length, 3);
  assert.equal(verifySettlements(trap2, res2), true);

  // S-08: 3 disjoint exact pairs -> 3 payments (k - p = 6 - 3 = 3)
  const pairs = [
    { memberId: 'm1', name: 'A', netPaise: 10000 },
    { memberId: 'm2', name: 'B', netPaise: -10000 },
    { memberId: 'm3', name: 'C', netPaise: 20000 },
    { memberId: 'm4', name: 'D', netPaise: -20000 },
    { memberId: 'm5', name: 'E', netPaise: 30000 },
    { memberId: 'm6', name: 'F', netPaise: -30000 },
  ];
  const resPairs = computeMinimumSettlements(pairs);
  assert.equal(resPairs.length, 3);
  assert.equal(verifySettlements(pairs, resPairs), true);
});

test('S-09: max-scale 10-member Bitmask DP settles optimally in well under 50ms', () => {
  // Multi-subset optimal case: {+1000,-1000}, {+2000,-2000}, {+3500,-1500,-2000}, {+9000,-4000,-5000} -> 10 - 4 = 6 payments
  const multiSubset10 = [
    { memberId: 'm1', name: 'M1', netPaise: 1000 },
    { memberId: 'm2', name: 'M2', netPaise: -1000 },
    { memberId: 'm3', name: 'M3', netPaise: 2000 },
    { memberId: 'm4', name: 'M4', netPaise: -2000 },
    { memberId: 'm5', name: 'M5', netPaise: 3500 },
    { memberId: 'm6', name: 'M6', netPaise: -1500 },
    { memberId: 'm7', name: 'M7', netPaise: -2000 },
    { memberId: 'm8', name: 'M8', netPaise: 9000 },
    { memberId: 'm9', name: 'M9', netPaise: -4000 },
    { memberId: 'm10', name: 'M10', netPaise: -5000 },
  ];
  const resMulti = computeMinimumSettlements(multiSubset10);
  assert.equal(resMulti.length, 6);
  assert.equal(verifySettlements(multiSubset10, resMulti), true);

  // High-density zero-sum mask stress case (many zero-sum masks, 5 disjoint pairs -> 5 payments)
  const dense10 = Array.from({ length: 10 }, (_, idx) => ({
    memberId: `u${idx + 1}`,
    name: `User${idx + 1}`,
    netPaise: idx % 2 === 0 ? 10000 : -10000,
  }));

  const t0 = performance.now();
  const resDense = computeMinimumSettlements(dense10);
  const elapsedMs = performance.now() - t0;

  assert.equal(resDense.length, 5);
  assert.equal(verifySettlements(dense10, resDense), true);
  assert.ok(elapsedMs < 50, `Expected 10-member DP < 50ms, took ${elapsedMs.toFixed(2)}ms`);
  console.log(`  [benchmark] 10-member dense Bitmask DP completed in ${elapsedMs.toFixed(3)} ms`);
});

test('S-10, S-11 & Large ₹ Cap: fractional paise and >32-bit rupee sums settle cleanly without overflow', () => {
  const members = makeMembers(['A', 'B', 'C']);
  const fracExpense = {
    id: 'e1',
    title: 'Split 100',
    amountPaise: 10000,
    paidBy: 'm1',
    splitType: 'equal',
    shares: distributeEqual(10000, ['m1', 'm2', 'm3']), // [3334, 3333, 3333]
  };
  const { balances, netSumPaise } = calculateBalances(members, [fracExpense]);
  assert.equal(netSumPaise, 0);
  assert.deepEqual(balances.map((b) => b.netPaise), [6666, -3333, -3333]);

  const payments = computeMinimumSettlements(balances);
  assert.equal(payments.length, 2);
  assert.deepEqual(payments.map((p) => p.amountPaise), [3333, 3333]);
  assert.equal(verifySettlements(balances, payments), true);

  // Guard against Int32 overflow (> 2^31 - 1 paise = ₹2,14,74,836.47) across multiple max-cap expenses
  const highValueBalances = [
    { memberId: 'm1', name: 'A', netPaise: 1_500_000_000 },
    { memberId: 'm2', name: 'B', netPaise: 1_500_000_000 },
    { memberId: 'm3', name: 'C', netPaise: -3_000_000_000 },
  ];
  const highPayments = computeMinimumSettlements(highValueBalances);
  assert.equal(highPayments.length, 2);
  assert.equal(verifySettlements(highValueBalances, highPayments), true);
});

test('T-01, T-02, T-03 & Invariants: settlements update balances cleanly and deleted expenses preserve zero-sum', () => {
  const members = makeMembers(['Rahul', 'Priya', 'Aman']);
  const dinner = {
    id: 'e1',
    title: 'Dinner',
    amountPaise: 90000,
    paidBy: 'm1',
    shares: distributeEqual(90000, ['m1', 'm2', 'm3']),
  };
  const cab = {
    id: 'e2',
    title: 'Cab',
    amountPaise: 30000,
    paidBy: 'm2',
    shares: distributeEqual(30000, ['m2', 'm3']),
  };
  const snacks = {
    id: 'e3',
    title: 'Snacks',
    amountPaise: 15000,
    paidBy: 'm3',
    shares: distributeEqual(15000, ['m1', 'm2', 'm3']),
  };

  // T-01: mark Aman pays Rahul ₹350 settled
  const settlement1 = { id: 's1', fromId: 'm3', toId: 'm1', amountPaise: 35000, createdAt: 5000 };
  const afterSettle = calculateBalances(members, [dinner, cab, snacks], [settlement1]);
  assert.equal(afterSettle.hasSettlements, true);
  assert.equal(afterSettle.netSumPaise, 0);
  const byName1 = Object.fromEntries(afterSettle.balances.map((b) => [b.name, b]));
  assert.equal(byName1.Rahul.expensePaidPaise, 90000);
  assert.equal(byName1.Rahul.settledInPaise, 35000);
  assert.equal(byName1.Rahul.netPaise, 20000);
  assert.equal(byName1.Aman.settledOutPaise, 35000);
  assert.equal(byName1.Aman.netPaise, 0);

  const remainingPayments = computeMinimumSettlements(afterSettle.balances);
  assert.equal(remainingPayments.length, 1);
  assert.equal(`${remainingPayments[0].fromName} pays ${remainingPayments[0].toName} ${formatRupees(remainingPayments[0].amountPaise)}`, 'Priya pays Rahul ₹200');
  assert.equal(verifySettlements(afterSettle.balances, remainingPayments), true);

  // T-02: undo settlement restores 2 payments cleanly
  const afterUndo = calculateBalances(members, [dinner, cab, snacks], []);
  assert.equal(afterUndo.hasSettlements, false);
  assert.equal(computeMinimumSettlements(afterUndo.balances).length, 2);

  // T-03: deleting Dinner AFTER settlement keeps zero-sum and flips net cleanly
  const afterDeleteExpense = calculateBalances(members, [cab, snacks], [settlement1]);
  assert.equal(afterDeleteExpense.netSumPaise, 0);
  assert.equal(afterDeleteExpense.totalSpendPaise, 45000);
  const postDeletePayments = computeMinimumSettlements(afterDeleteExpense.balances);
  assert.equal(verifySettlements(afterDeleteExpense.balances, postDeletePayments), true);

  // Invariant guards reject malformed / non-zero inputs loudly
  assert.throws(
    () => calculateBalances(members, [{ id: 'bad', amountPaise: 100, paidBy: 'm1', shares: [{ memberId: 'm2', sharePaise: 50 }] }]),
    /Share conservation violated/
  );
  assert.throws(
    () => calculateBalances(members, [], [{ fromId: 'm1', toId: 'm1', amountPaise: 100 }]),
    /same sender and receiver/
  );
  assert.throws(
    () => computeMinimumSettlements([{ memberId: 'm1', name: 'Rahul', netPaise: 100 }]),
    /net balances sum to 100/
  );
  assert.throws(() => computeMinimumSettlements(null), TypeError);
  assert.throws(
    () => computeMinimumSettlements([{ memberId: 'm1', netPaise: 0 }, { memberId: 'm1', netPaise: 0 }]),
    /Duplicate memberId/
  );

  // Max DP cap (k > 16) throws RangeError
  const tooMany = Array.from({ length: 18 }, (_, idx) => ({
    memberId: `x${idx}`,
    name: `X${idx}`,
    netPaise: idx % 2 === 0 ? 100 : -100,
  }));
  assert.throws(() => computeMinimumSettlements(tooMany), RangeError);

  // Single-member zero-expense & malformed verifySettlements checks
  const oneMemberBal = calculateBalances(makeMembers(['Solo']), [], []);
  assert.equal(oneMemberBal.netSumPaise, 0);
  assert.deepEqual(computeMinimumSettlements(oneMemberBal.balances), []);
  assert.equal(verifySettlements([null], []), false);
  assert.equal(verifySettlements([{ memberId: 'm1', netPaise: 100 }, { memberId: 'm2', netPaise: -100 }], [{ fromId: 'm2', toId: 'm2', amountPaise: 100 }]), false);
  assert.equal(verifySettlements([{ memberId: 'm1', netPaise: 100 }, { memberId: 'm2', netPaise: -100 }], []), false);
});

console.log(`\nPhase 1 & Phase 2 core tests complete: ${passed} passed, 0 failed.`);
