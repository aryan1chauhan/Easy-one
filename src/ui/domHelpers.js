/**
 * XSS-safe DOM and SVG icon helpers.
 * Every user-controlled string is assigned strictly via textContent.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  food: [
    'M6 3v7a3 3 0 0 0 6 0V3',
    'M9 3v18',
    'M16 3v18',
    'M16 3c2.2 0 3 2 3 5s-.8 4-3 4',
  ],
  cab: [
    'M5 17h14v-5l-2-5H7l-2 5v5Z',
    'M5 13h14',
    'M7.5 17v1.5',
    'M16.5 17v1.5',
  ],
  groceries: [
    'M4 5h2l2.2 9.5h9.6L20 8H7.2',
    'M9.5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M16.5 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  ],
  utilities: [
    'M13 2 5 14h6l-1 8 9-12h-6l0-8Z',
  ],
  shopping: [
    'M6 8h12l1 12H5L6 8Z',
    'M9 8V6a3 3 0 0 1 6 0v2',
  ],
  other: [
    'M6 3h12v18l-3-2-3 2-3-2-3 2V3Z',
    'M9 8h6',
    'M9 12h6',
  ],
  settlement: [
    'M3 7h18v10H3V7Z',
    'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  ],
  deleted: [
    'M5 7h14',
    'M9 7V5h6v2',
    'M8 7l1 12h6l1-12',
  ],
  reset: [
    'M4 12a8 8 0 1 1 2.3 5.6',
    'M4 17v-5h5',
  ],
  member: [
    'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M5 20a7 7 0 0 1 14 0',
  ],
  lock: [
    'M6 11h12v9H6v-9Z',
    'M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  ],
  home: [
    'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  ],
  friends: [
    'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M2 20a6 6 0 0 1 12 0',
    'M14 20a5 5 0 0 1 8 0',
  ],
  charts: [
    'M4 20V10',
    'M10 20V4',
    'M16 20v-7',
    'M21 20V8',
  ],
  activity: [
    'M3 12h4l3-7 4 14 3-7h4',
  ],
  group: [
    'M4 6h16',
    'M4 12h16',
    'M4 18h10',
  ],
  plus: [
    'M12 5v14',
    'M5 12h14',
  ],
  close: [
    'M6 6l12 12',
    'M18 6 6 18',
  ],
};

export const CATEGORY_META = {
  food: { label: 'Food & Dining', short: 'Food', color: '#E8924C' },
  cab: { label: 'Cab & Travel', short: 'Cab', color: '#C66A56' },
  groceries: { label: 'Groceries', short: 'Groceries', color: '#4B8E6D' },
  utilities: { label: 'Utilities & Rent', short: 'Utilities', color: '#4B458C' },
  shopping: { label: 'Shopping', short: 'Shopping', color: '#9D6599' },
  other: { label: 'Other', short: 'Other', color: '#7D768E' },
};

const AVATAR_TONES = ['tone-indigo', 'tone-peach', 'tone-sage', 'tone-rose', 'tone-teal', 'tone-amber'];

/**
 * Creates a circular initials avatar element safe from XSS.
 *
 * @param {string} name
 * @param {number} [index]
 * @param {string} [sizeClass]
 * @returns {HTMLElement}
 */
export function avatarBadge(name, index = 0, sizeClass = '') {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
  const tone = AVATAR_TONES[Math.abs(index) % AVATAR_TONES.length];
  return el('span', {
    className: ['avatar-circle', tone, sizeClass].filter(Boolean).join(' '),
    text: initials,
    attrs: { 'aria-hidden': 'true' },
  });
}

/**
 * Creates a crisp 1.5px-stroke SVG icon element without innerHTML.
 *
 * @param {string} name
 * @param {{ size?: number, className?: string }} [options]
 * @returns {SVGSVGElement}
 */
export function svgIcon(name, options = {}) {
  const size = options.size ?? 18;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (options.className) {
    svg.setAttribute('class', options.className);
  }

  const paths = ICON_PATHS[name] ?? ICON_PATHS.other;
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Creates an element with optional className, attributes, and plain textContent.
 *
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [options]
 * @returns {HTMLElement}
 */
export function el(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined && options.text !== null) {
    node.textContent = String(options.text);
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) {
        node.setAttribute(key, String(value));
      }
    }
  }
  return node;
}

/**
 * Replaces all children of container with provided nodes safely.
 *
 * @param {HTMLElement} container
 * @param {Array<Node>} nodes
 */
export function setChildren(container, nodes) {
  container.replaceChildren(...nodes);
}

/**
 * Displays a validation error inside an inline alert container.
 *
 * @param {HTMLElement} errorEl
 * @param {string} message
 */
export function setInlineError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/**
 * Clears and hides an inline validation error container.
 *
 * @param {HTMLElement} errorEl
 */
export function clearInlineError(errorEl) {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Formats a Unix ms timestamp into { month, day } for ledger date badges.
 *
 * @param {number} ts
 * @returns {{ month: string, day: string, monthYear: string }}
 */
export function formatDateParts(ts) {
  const d = new Date(ts);
  return {
    month: MONTH_SHORT[d.getMonth()],
    day: String(d.getDate()).padStart(2, '0'),
    monthYear: `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`,
  };
}

/**
 * Formats a Unix ms timestamp into a compact readable timestamp for activity rows.
 *
 * @param {number} ts
 * @returns {string}
 */
export function formatActivityTimestamp(ts) {
  const d = new Date(ts);
  const { month, day } = formatDateParts(ts);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hours}:${mins}`;
}
