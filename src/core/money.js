/**
 * Pure monetary arithmetic, parsing, formatting, and split distribution helpers.
 * All currency math uses integer paise (1 rupee = 100 paise) and percentages use
 * integer basis points (100% = 10000 bps) to eliminate IEEE 754 drift.
 */

export const MAX_AMOUNT_PAISE = 1_000_000_000; // ₹1,00,00,000
export const TOTAL_BPS = 10_000; // 100.00%

const FIXED_TWO_DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Parses a non-negative fixed-point string (max 2 decimals) into an integer scaled by 100.
 * Uses pure string splitting so float multiplication drift cannot occur.
 *
 * @param {string|number} input
 * @param {number} maxScaled
 * @param {string} invalidError
 * @param {string} overflowError
 * @returns {{ valid: boolean, scaled: number | null, error: string | null }}
 */
function parseFixed2(input, maxScaled, invalidError, overflowError) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return { valid: false, scaled: null, error: invalidError };
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || Object.is(input, -0) || input < 0) {
      return { valid: false, scaled: null, error: invalidError };
    }
    if (Math.trunc(input) > Math.floor(maxScaled / 100)) {
      return { valid: false, scaled: null, error: overflowError };
    }
  }

  const trimmed = String(input).trim();
  if (!FIXED_TWO_DECIMAL_RE.test(trimmed)) {
    return { valid: false, scaled: null, error: invalidError };
  }

  const [rawInt, rawFrac = ''] = trimmed.split('.');
  const intDigits = rawInt.replace(/^0+/, '') || '0';
  const fracDigits = rawFrac.padEnd(2, '0');
  const maxIntDigits = String(Math.floor(maxScaled / 100)).length;

  if (intDigits.length > maxIntDigits) {
    return { valid: false, scaled: null, error: overflowError };
  }

  const scaled = parseInt(intDigits, 10) * 100 + parseInt(fracDigits, 10);
  if (scaled > maxScaled) {
    return { valid: false, scaled: null, error: overflowError };
  }

  return { valid: true, scaled, error: null };
}

/**
 * Converts a rupee string (e.g. "19.99") into integer paise.
 *
 * @param {string|number} input
 * @param {{ allowZero?: boolean }} [options]
 * @returns {{ valid: boolean, paise: number | null, error: string | null }}
 */
export function parseRupeesToPaise(input, options) {
  const allowZero = Boolean(options?.allowZero);
  const invalidMsg = allowZero
    ? 'Enter a valid amount with at most 2 decimal places.'
    : 'Enter a valid positive amount with at most 2 decimal places.';

  const result = parseFixed2(
    input,
    MAX_AMOUNT_PAISE,
    invalidMsg,
    'Amount exceeds the maximum allowed limit.'
  );

  if (!result.valid) {
    return { valid: false, paise: null, error: result.error };
  }

  if (!allowZero && result.scaled === 0) {
    return { valid: false, paise: null, error: 'Amount must be greater than ₹0.' };
  }

  return { valid: true, paise: result.scaled, error: null };
}

/**
 * Converts a percentage string (0 to 100, max 2 decimals) into integer basis points.
 *
 * @param {string|number} input
 * @returns {{ valid: boolean, bps: number | null, error: string | null }}
 */
export function parsePercentToBps(input) {
  const result = parseFixed2(
    input,
    TOTAL_BPS,
    'Enter a valid percentage with at most 2 decimal places.',
    'Percentage cannot exceed 100%.'
  );

  if (!result.valid) {
    return { valid: false, bps: null, error: result.error };
  }

  return { valid: true, bps: result.scaled, error: null };
}

/**
 * Formats integer paise for display (e.g. 35000 -> "₹350", 3334 -> "₹33.34").
 *
 * @param {number} paise
 * @param {{ signed?: boolean }} [options]
 * @returns {string}
 */
export function formatRupees(paise, options) {
  const signed = Boolean(options?.signed);
  if (!Number.isSafeInteger(paise)) {
    throw new TypeError(`Expected safe integer paise, received: ${paise}`);
  }

  if (paise === 0) {
    return '₹0';
  }

  const sign = paise < 0 ? '-' : signed ? '+' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toLocaleString('en-IN');
  const rem = abs % 100;
  const decimals = rem === 0 ? '' : `.${String(rem).padStart(2, '0')}`;

  return `${sign}₹${whole}${decimals}`;
}

/**
 * Formats integer basis points as a clean percentage string (e.g. 3334 -> "33.34%", 1000 -> "10%").
 *
 * @param {number} bps
 * @returns {string}
 */
export function formatBps(bps) {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new TypeError(`Expected non-negative integer bps, received: ${bps}`);
  }

  const whole = Math.floor(bps / 100);
  const rem = bps % 100;
  return rem === 0 ? `${whole}%` : `${whole}.${String(rem).padStart(2, '0')}%`;
}

/**
 * Splits amountPaise equally across memberIds using deterministic floor + remainder.
 * Assigns +1 paisa to the first (amountPaise % k) members so shares sum strictly to amountPaise.
 *
 * @param {number} amountPaise
 * @param {string[]} memberIds
 * @returns {Array<{ memberId: string, sharePaise: number }>}
 */
export function distributeEqual(amountPaise, memberIds) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new TypeError(`Expected non-negative integer amountPaise, received: ${amountPaise}`);
  }
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    throw new TypeError('memberIds must be a non-empty array.');
  }
  if (memberIds.some((id) => typeof id !== 'string' || !id)) {
    throw new TypeError('Each memberId must be a non-empty string.');
  }
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('memberIds must not contain duplicates.');
  }

  const count = memberIds.length;
  const base = Math.floor(amountPaise / count);
  const remainder = amountPaise % count;

  return memberIds.map((memberId, index) => ({
    memberId,
    sharePaise: base + (index < remainder ? 1 : 0),
  }));
}

/**
 * Splits amountPaise by percentage entries using Hamilton's Largest Remainder Method.
 * Deterministic tie-breaking assigns leftover paise to earlier entries in order.
 *
 * @param {number} amountPaise
 * @param {Array<{ memberId: string, bps: number }>} entries
 * @returns {Array<{ memberId: string, sharePaise: number, percent: number }>}
 */
export function distributePercentage(amountPaise, entries) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new TypeError(`Expected non-negative integer amountPaise, received: ${amountPaise}`);
  }
  if (amountPaise > Math.floor(Number.MAX_SAFE_INTEGER / TOTAL_BPS)) {
    throw new RangeError('amountPaise exceeds safe percentage scaling limit.');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('entries must be a non-empty array.');
  }

  let totalBps = 0;
  const seenIds = new Set();

  const preliminary = entries.map((entry, index) => {
    if (!entry || typeof entry.memberId !== 'string' || !entry.memberId || seenIds.has(entry.memberId)) {
      throw new Error('Invalid or duplicate memberId in percentage entries.');
    }
    if (!Number.isSafeInteger(entry.bps) || entry.bps < 0) {
      throw new TypeError(`Invalid basis points for member ${entry.memberId}: ${entry.bps}`);
    }
    seenIds.add(entry.memberId);
    totalBps += entry.bps;

    const numerator = amountPaise * entry.bps;
    const floorShare = Math.floor(numerator / TOTAL_BPS);
    const remainder = numerator % TOTAL_BPS;

    return { index, memberId: entry.memberId, bps: entry.bps, floorShare, remainder };
  });

  if (totalBps !== TOTAL_BPS) {
    throw new Error(`Percentage basis points must sum to ${TOTAL_BPS}, got ${totalBps}.`);
  }

  const allocated = preliminary.reduce((sum, item) => sum + item.floorShare, 0);
  const leftover = amountPaise - allocated;

  const ranked = [...preliminary].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder;
    }
    return a.index - b.index;
  });

  const bonusSet = new Set(ranked.slice(0, leftover).map((item) => item.index));

  return preliminary.map((item) => ({
    memberId: item.memberId,
    sharePaise: item.floorShare + (bonusSet.has(item.index) ? 1 : 0),
    percent: item.bps / 100,
  }));
}
