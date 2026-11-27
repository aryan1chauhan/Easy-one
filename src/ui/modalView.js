/**
 * Accessible custom dialog (<dialog>) for destructive actions (Reset group).
 * Zero blocking browser dialogs; supports Cancel button, Escape key, and backdrop click (P-05, U-07).
 */

/**
 * Mounts the Reset Group modal controller.
 *
 * @param {{
 *   dialog: HTMLDialogElement,
 *   triggerBtn: HTMLButtonElement,
 *   cancelBtn: HTMLButtonElement,
 *   confirmBtn: HTMLButtonElement,
 *   onAccept: () => void
 * }} elements
 */
export function mountResetModal({ dialog, triggerBtn, cancelBtn, confirmBtn, onAccept }) {
  let lastFocused = null;

  function openDialog() {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : triggerBtn;
    if (!dialog.open) {
      dialog.showModal();
    }
    cancelBtn.focus();
  }

  function closeDialog() {
    if (dialog.open) {
      dialog.close();
    }
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  triggerBtn.addEventListener('click', openDialog);
  cancelBtn.addEventListener('click', closeDialog);

  confirmBtn.addEventListener('click', () => {
    closeDialog();
    onAccept();
  });

  // Backdrop click: target is the <dialog> element itself outside .modal-content.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });

  dialog.addEventListener('cancel', () => {
    if (lastFocused && typeof lastFocused.focus === 'function') {
      queueMicrotask(() => lastFocused.focus());
    }
  });

  return {
    open: openDialog,
    close: closeDialog,
  };
}
