import assert from 'node:assert/strict';
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

console.log(`\nPhase 1 core tests complete: ${passed} passed, 0 failed.`);
