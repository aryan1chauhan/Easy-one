/**
 * Accessible Authentication & Cloud Account Modal (<dialog id="auth-dialog">):
 * supports Google (Gmail) Sign-In, Phone Number (SMS OTP), and Email/Password auth.
 */

import { clearInlineError, el, setChildren, setInlineError, svgIcon } from './domHelpers.js';

/**
 * Mounts the Auth & Account modal + status sync buttons.
 *
 * @param {{
 *   dialog: HTMLDialogElement,
 *   closeBtn: HTMLElement,
 *   bodyEl: HTMLElement,
 *   triggerBtns: HTMLElement[],
 *   cloudSync: ReturnType<import('../state/cloudSync.js').createCloudSync>,
 * }} deps
 */
export function mountAuthModalView({ dialog, closeBtn, bodyEl, triggerBtns, cloudSync }) {
  let activeMethod = 'phone'; // 'phone' | 'email'
  let emailMode = 'signin'; // 'signin' | 'signup'
  let otpStep = 'request'; // 'request' | 'verify'
  let pendingPhoneDisplay = '';
  let currentStatus = {
    ready: false,
    user: null,
    syncState: 'local',
    syncMessage: 'Saved locally in this browser',
  };

  function openDialog() {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    renderDialogBody();
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  closeBtn.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });

  for (const btn of triggerBtns) {
    if (btn) {
      btn.addEventListener('click', openDialog);
    }
  }

  function updateTriggerButtons() {
    for (const btn of triggerBtns) {
      if (!btn) continue;
      if (currentStatus.user) {
        const label =
          currentStatus.user.email ||
          currentStatus.user.phoneNumber ||
          currentStatus.user.displayName ||
          'Signed in';
        const dotClass =
          currentStatus.syncState === 'synced'
            ? 'sync-dot is-synced'
            : currentStatus.syncState === 'error'
              ? 'sync-dot is-error'
              : 'sync-dot is-syncing';
        btn.replaceChildren(
          el('span', { className: dotClass, attrs: { 'aria-hidden': 'true' } }),
          el('span', { className: 'auth-trigger-label', text: label })
        );
      } else {
        btn.replaceChildren(
          svgIcon('cloud', { size: 15 }),
          el('span', { className: 'auth-trigger-label', text: 'Sign in · Save' })
        );
      }
    }
  }

  function renderDialogBody() {
    const errorEl = el('p', {
      className: 'error-msg',
      attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' },
    });
    const infoEl = el('p', {
      className: 'notice-box',
      attrs: { hidden: '' },
    });

    if (currentStatus.user) {
      const label =
        currentStatus.user.displayName ||
        currentStatus.user.email ||
        currentStatus.user.phoneNumber ||
        'Account';
      const subLabel =
        currentStatus.user.email && currentStatus.user.phoneNumber
          ? `${currentStatus.user.email} · ${currentStatus.user.phoneNumber}`
          : currentStatus.user.email || currentStatus.user.phoneNumber || currentStatus.user.uid;

      const card = el('div', { className: 'auth-account-panel' });
      const profileBox = el('div', { className: 'auth-profile-box' });
      profileBox.append(
        el('div', { className: 'auth-profile-name', text: label }),
        el('div', { className: 'auth-profile-sub', text: subLabel }),
        el('div', { className: 'auth-sync-badge', text: currentStatus.syncMessage })
      );

      const signOutBtn = el('button', {
        className: 'btn btn-danger-outline',
        text: 'Sign out',
        attrs: { type: 'button' },
      });
      signOutBtn.addEventListener('click', async () => {
        signOutBtn.disabled = true;
        const res = await cloudSync.signOutUser();
        if (!res.ok) {
          signOutBtn.disabled = false;
          setInlineError(errorEl, res.error);
          return;
        }
        closeDialog();
      });

      card.append(profileBox, errorEl, signOutBtn);
      setChildren(bodyEl, [card]);
      return;
    }

    const stack = el('div', { className: 'auth-stack' });
    stack.append(
      el('p', {
        className: 'auth-lead',
        text: 'Sign in with Gmail or your phone number to save your groups, balances, and permanent audit history across devices.',
      })
    );

    // 1. Google (Gmail) Button
    const googleBtn = el('button', {
      className: 'btn btn-primary auth-google-btn',
      attrs: { type: 'button', id: 'auth-google-btn' },
    });
    googleBtn.append(
      svgIcon('google', { size: 17 }),
      el('span', { text: 'Continue with Google (Gmail)' })
    );
    googleBtn.addEventListener('click', async () => {
      clearInlineError(errorEl);
      googleBtn.disabled = true;
      const res = await cloudSync.signInWithGoogle();
      googleBtn.disabled = false;
      if (!res.ok) {
        setInlineError(errorEl, res.error);
        return;
      }
      closeDialog();
    });

    const divider = el('div', { className: 'auth-divider' });
    divider.append(el('span', { text: 'or continue with' }));

    // 2. Tabs: Phone OTP | Email & Password
    const methodTabs = el('div', { className: 'split-tabs auth-method-tabs' });
    const phoneTab = el('button', {
      className: activeMethod === 'phone' ? 'split-tab is-active' : 'split-tab',
      text: 'Phone (OTP)',
      attrs: { type: 'button', 'aria-pressed': String(activeMethod === 'phone') },
    });
    const emailTab = el('button', {
      className: activeMethod === 'email' ? 'split-tab is-active' : 'split-tab',
      text: 'Email & Password',
      attrs: { type: 'button', 'aria-pressed': String(activeMethod === 'email') },
    });
    phoneTab.addEventListener('click', () => {
      activeMethod = 'phone';
      renderDialogBody();
    });
    emailTab.addEventListener('click', () => {
      activeMethod = 'email';
      renderDialogBody();
    });
    methodTabs.append(phoneTab, emailTab);

    stack.append(googleBtn, divider, methodTabs);

    // invisible reCAPTCHA anchor
    const recaptchaHost = el('div', { attrs: { id: 'auth-recaptcha-container' } });

    if (activeMethod === 'phone') {
      const phoneForm = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
      if (otpStep === 'request') {
        const phoneInput = el('input', {
          attrs: {
            id: 'auth-phone-input',
            type: 'tel',
            inputmode: 'tel',
            placeholder: 'e.g. 9876543210 or +91 9876543210',
            autocomplete: 'tel',
          },
        });
        const sendBtn = el('button', {
          className: 'btn btn-secondary',
          text: 'Send OTP',
          attrs: { type: 'submit', id: 'auth-send-otp-btn' },
        });
        phoneForm.append(
          el('label', { className: 'field-label', text: 'Mobile Number', attrs: { for: 'auth-phone-input' } }),
          phoneInput,
          recaptchaHost,
          errorEl,
          sendBtn
        );
        phoneInput.addEventListener('input', () => clearInlineError(errorEl));
        phoneForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          clearInlineError(errorEl);
          sendBtn.disabled = true;
          sendBtn.textContent = 'Sending...';
          const res = await cloudSync.sendPhoneOtp(phoneInput.value, 'auth-recaptcha-container');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send OTP';
          if (!res.ok) {
            setInlineError(errorEl, res.error);
            return;
          }
          pendingPhoneDisplay = res.phone;
          otpStep = 'verify';
          renderDialogBody();
        });
      } else {
        const otpInput = el('input', {
          attrs: {
            id: 'auth-otp-input',
            type: 'text',
            inputmode: 'numeric',
            maxlength: '6',
            placeholder: '6-digit code',
            autocomplete: 'one-time-code',
          },
        });
        const verifyBtn = el('button', {
          className: 'btn btn-primary',
          text: 'Verify OTP & Sign In',
          attrs: { type: 'submit', id: 'auth-verify-otp-btn' },
        });
        const backBtn = el('button', {
          className: 'link-btn',
          text: `Change number (${pendingPhoneDisplay})`,
          attrs: { type: 'button' },
        });
        backBtn.addEventListener('click', () => {
          otpStep = 'request';
          renderDialogBody();
        });

        phoneForm.append(
          el('label', {
            className: 'field-label',
            text: `Enter OTP sent to ${pendingPhoneDisplay}`,
            attrs: { for: 'auth-otp-input' },
          }),
          otpInput,
          errorEl,
          verifyBtn,
          backBtn
        );
        otpInput.addEventListener('input', () => clearInlineError(errorEl));
        phoneForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          clearInlineError(errorEl);
          verifyBtn.disabled = true;
          const res = await cloudSync.confirmPhoneOtp(otpInput.value);
          verifyBtn.disabled = false;
          if (!res.ok) {
            setInlineError(errorEl, res.error);
            return;
          }
          otpStep = 'request';
          closeDialog();
        });
      }
      stack.append(phoneForm);
    } else {
      const emailForm = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
      const emailInput = el('input', {
        attrs: {
          id: 'auth-email-input',
          type: 'email',
          placeholder: 'you@gmail.com',
          autocomplete: 'email',
        },
      });
      const passInput = el('input', {
        attrs: {
          id: 'auth-password-input',
          type: 'password',
          placeholder: 'Minimum 6 characters',
          autocomplete: emailMode === 'signin' ? 'current-password' : 'new-password',
        },
      });
      const submitBtn = el('button', {
        className: 'btn btn-secondary',
        text: emailMode === 'signin' ? 'Sign In with Email' : 'Create Account',
        attrs: { type: 'submit', id: 'auth-email-submit-btn' },
      });

      const footLinks = el('div', { className: 'auth-foot-links' });
      const toggleModeBtn = el('button', {
        className: 'link-btn',
        text: emailMode === 'signin' ? 'New user? Create account' : 'Already have an account? Sign in',
        attrs: { type: 'button' },
      });
      toggleModeBtn.addEventListener('click', () => {
        emailMode = emailMode === 'signin' ? 'signup' : 'signin';
        renderDialogBody();
      });

      const resetBtn = el('button', {
        className: 'link-btn',
        text: 'Forgot password?',
        attrs: { type: 'button' },
      });
      resetBtn.addEventListener('click', async () => {
        clearInlineError(errorEl);
        infoEl.hidden = true;
        const emailVal = emailInput.value.trim();
        if (!emailVal) {
          setInlineError(errorEl, 'Enter your email address above first to receive a reset link.');
          return;
        }
        const res = await cloudSync.sendPasswordReset(emailVal);
        if (!res.ok) {
          setInlineError(errorEl, res.error);
          return;
        }
        infoEl.textContent = `Password reset email sent to ${emailVal}.`;
        infoEl.hidden = false;
      });

      footLinks.append(toggleModeBtn, resetBtn);
      emailForm.append(
        el('label', { className: 'field-label', text: 'Email / Gmail', attrs: { for: 'auth-email-input' } }),
        emailInput,
        el('label', { className: 'field-label', text: 'Password', attrs: { for: 'auth-password-input' } }),
        passInput,
        errorEl,
        infoEl,
        submitBtn,
        footLinks
      );

      emailInput.addEventListener('input', () => clearInlineError(errorEl));
      passInput.addEventListener('input', () => clearInlineError(errorEl));
      emailForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearInlineError(errorEl);
        submitBtn.disabled = true;
        const fn = emailMode === 'signin' ? cloudSync.signInWithEmail : cloudSync.registerWithEmail;
        const res = await fn(emailInput.value, passInput.value);
        submitBtn.disabled = false;
        if (!res.ok) {
          setInlineError(errorEl, res.error);
          return;
        }
        closeDialog();
      });
      stack.append(emailForm);
    }

    setChildren(bodyEl, [stack]);
  }

  function updateStatus(nextStatus) {
    currentStatus = nextStatus;
    updateTriggerButtons();
    if (dialog.open) {
      renderDialogBody();
    }
  }

  return { openDialog, updateStatus };
}
