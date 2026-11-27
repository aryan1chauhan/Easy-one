/**
 * XSS-safe DOM helpers. Every user-controlled string is assigned strictly via textContent.
 */

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
