/**
 * Firebase Authentication (Google / Gmail, Phone OTP, Email/Password)
 * and Cloud Firestore sync adapter for RupeeSync.
 *
 * Keeps core/store 100% functional offline in localStorage while syncing across
 * devices when signed in, and enforces append-only activity log writes matching
 * Firestore Security Rules (`allow update, delete: if false`).
 */

const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/11.6.0';

const FIREBASE_CONFIG = {
  projectId: 'rupeesync-split-2026',
  appId: '1:1027025841290:web:074224b108849e49119173',
  storageBucket: 'rupeesync-split-2026.firebasestorage.app',
  apiKey: 'AIzaSyASxXXqh-Yq5NwO25tayRIiYWr9j7sEsM4',
  authDomain: 'rupeesync-split-2026.firebaseapp.com',
  messagingSenderId: '1027025841290',
};

let sdkCache = null;

async function loadFirebaseSdk() {
  if (sdkCache) {
    return sdkCache;
  }
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${FIREBASE_SDK_BASE}/firebase-app.js`),
    import(`${FIREBASE_SDK_BASE}/firebase-auth.js`),
    import(`${FIREBASE_SDK_BASE}/firebase-firestore.js`),
  ]);

  const app = appMod.getApps().length > 0 ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);

  sdkCache = { app, auth, db, authMod, fsMod };
  return sdkCache;
}

/**
 * Normalizes a phone number input into E.164 format.
 * Defaults 10-digit Indian mobile numbers cleanly to `+91...`.
 *
 * @param {string} rawPhone
 * @returns {string}
 */
export function normalizePhoneE164(rawPhone) {
  const trimmed = String(rawPhone ?? '').replace(/[\s()-]+/g, '');
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('+')) {
    return trimmed;
  }
  if (/^\d{10}$/.test(trimmed)) {
    return `+91${trimmed}`;
  }
  if (/^0\d{10}$/.test(trimmed)) {
    return `+91${trimmed.slice(1)}`;
  }
  return `+${trimmed}`;
}

function formatAuthError(err) {
  const code = err?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before finishing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Allow popups or use Phone/Email sign-in.';
    case 'auth/unauthorized-domain':
      return 'This domain must be added under Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not enabled yet in Firebase Authentication Console.';
    case 'auth/invalid-email':
      return 'Enter a valid email / Gmail address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Try again or reset your password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Switch to Sign In instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/invalid-phone-number':
      return 'Enter a valid phone number with country code (e.g. +91 9876543210).';
    case 'auth/invalid-verification-code':
      return 'Incorrect 6-digit OTP code. Double-check the SMS and try again.';
    case 'auth/code-expired':
      return 'This OTP has expired. Request a new code.';
    case 'auth/too-many-requests':
      return 'Too many attempts right now. Wait a moment and try again.';
    default:
      return err?.message ? String(err.message) : 'Authentication request failed.';
  }
}

/**
 * Creates the cloud authentication & Firestore synchronization controller.
 *
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   onStatusChange: (status: {
 *     ready: boolean,
 *     user: { uid: string, displayName: string, email: string, phoneNumber: string } | null,
 *     syncState: 'local' | 'syncing' | 'synced' | 'error',
 *     syncMessage: string,
 *   }) => void,
 * }} deps
 */
export function createCloudSync({ store, onStatusChange }) {
  let currentUser = null;
  let syncState = 'local';
  let syncMessage = 'Saved locally in this browser';
  let ready = false;
  let isHydrating = false;
  let saveTimer = null;
  let confirmationResult = null;
  let recaptchaVerifier = null;
  const syncedActivityIds = new Set();

  function emitStatus() {
    onStatusChange({
      ready,
      user: currentUser
        ? {
            uid: currentUser.uid,
            displayName: currentUser.displayName ?? '',
            email: currentUser.email ?? '',
            phoneNumber: currentUser.phoneNumber ?? '',
          }
        : null,
      syncState,
      syncMessage,
    });
  }

  async function pushWorkspaceToCloud(uid) {
    if (!uid) return;
    const { db, fsMod } = await loadFirebaseSdk();
    const { doc, setDoc } = fsMod;
    const payload = store.getCloudPayload();

    syncState = 'syncing';
    syncMessage = 'Syncing to cloud...';
    emitStatus();

    try {
      await setDoc(doc(db, 'users', uid), {
        activeGroupId: payload.activeGroupId,
        groups: payload.groups,
        updatedAt: Date.now(),
      });

      // Only create NEW immutable activity documents (never update/delete existing ones)
      const unsynced = payload.activityLog.filter((entry) => !syncedActivityIds.has(entry.id));
      for (const entry of unsynced) {
        await setDoc(doc(db, 'users', uid, 'activity', entry.id), entry);
        syncedActivityIds.add(entry.id);
      }

      syncState = 'synced';
      syncMessage = 'Synced across devices';
      emitStatus();
    } catch (err) {
      syncState = 'error';
      syncMessage = err?.message ? `Cloud sync issue: ${err.message}` : 'Cloud sync paused (offline/permissions).';
      emitStatus();
    }
  }

  async function loadCloudWorkspace(user) {
    const { db, fsMod } = await loadFirebaseSdk();
    const { collection, doc, getDoc, getDocs } = fsMod;

    syncState = 'syncing';
    syncMessage = 'Loading your cloud workspace...';
    emitStatus();

    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const actSnap = await getDocs(collection(db, 'users', user.uid, 'activity'));

      const cloudActivity = [];
      actSnap.forEach((docItem) => {
        const data = docItem.data();
        if (data && data.id) {
          cloudActivity.push(data);
          syncedActivityIds.add(data.id);
        }
      });

      const localPayload = store.getCloudPayload();
      const cloudData = userSnap.exists() ? userSnap.data() : null;
      const cloudHasGroups = Array.isArray(cloudData?.groups) && cloudData.groups.length > 0;
      const cloudHasContent =
        cloudHasGroups &&
        cloudData.groups.some(
          (g) => (g.state?.members?.length ?? 0) > 0 || (g.state?.expenses?.length ?? 0) > 0
        );
      const localHasContent = localPayload.groups.some(
        (g) => (g.state?.members?.length ?? 0) > 0 || (g.state?.expenses?.length ?? 0) > 0
      );

      isHydrating = true;
      try {
        if (cloudHasContent || (!localHasContent && cloudHasGroups)) {
          store.hydrateCloudWorkspace({
            activeGroupId: cloudData.activeGroupId,
            groups: cloudData.groups,
            activityEntries: cloudActivity,
          });
        } else if (cloudActivity.length > 0) {
          store.hydrateCloudWorkspace({ activityEntries: cloudActivity });
        }
      } finally {
        isHydrating = false;
      }

      // Upload local unsaved workspace / merged activity back to Firestore
      await pushWorkspaceToCloud(user.uid);
    } catch (err) {
      isHydrating = false;
      syncState = 'error';
      syncMessage = err?.message ? `Could not load cloud data: ${err.message}` : 'Cloud load failed.';
      emitStatus();
    }
  }

  function scheduleSync() {
    if (!currentUser || isHydrating) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (currentUser) {
        pushWorkspaceToCloud(currentUser.uid);
      }
    }, 350);
  }

  async function init() {
    emitStatus();
    try {
      const { auth, authMod } = await loadFirebaseSdk();
      ready = true;
      store.subscribe(scheduleSync);

      authMod.onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        syncedActivityIds.clear();
        if (!user) {
          syncState = 'local';
          syncMessage = 'Saved locally in this browser';
          emitStatus();
          return;
        }
        await loadCloudWorkspace(user);
      });
    } catch {
      ready = false;
      syncState = 'local';
      syncMessage = 'Offline mode (saved locally)';
      emitStatus();
    }
  }

  async function signInWithGoogle() {
    try {
      const { auth, authMod } = await loadFirebaseSdk();
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await authMod.signInWithPopup(auth, provider);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function signInWithEmail(email, password) {
    try {
      const { auth, authMod } = await loadFirebaseSdk();
      await authMod.signInWithEmailAndPassword(auth, String(email).trim(), String(password));
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function registerWithEmail(email, password) {
    try {
      const { auth, authMod } = await loadFirebaseSdk();
      await authMod.createUserWithEmailAndPassword(auth, String(email).trim(), String(password));
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function sendPasswordReset(email) {
    try {
      const { auth, authMod } = await loadFirebaseSdk();
      await authMod.sendPasswordResetEmail(auth, String(email).trim());
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function sendPhoneOtp(rawPhone, recaptchaContainerId) {
    const phone = normalizePhoneE164(rawPhone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return {
        ok: false,
        error: 'Enter a valid 10-digit mobile number or full international format (e.g. +919876543210).',
      };
    }

    try {
      const { auth, authMod } = await loadFirebaseSdk();
      if (recaptchaVerifier) {
        try {
          recaptchaVerifier.clear();
        } catch {
          // Ignore already-cleared verifier
        }
        recaptchaVerifier = null;
      }
      recaptchaVerifier = new authMod.RecaptchaVerifier(auth, recaptchaContainerId, {
        size: 'invisible',
      });
      confirmationResult = await authMod.signInWithPhoneNumber(auth, phone, recaptchaVerifier);
      return { ok: true, phone, error: null };
    } catch (err) {
      if (recaptchaVerifier) {
        try {
          recaptchaVerifier.clear();
        } catch {
          // Ignore cleanup errors
        }
        recaptchaVerifier = null;
      }
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function confirmPhoneOtp(rawCode) {
    const code = String(rawCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return { ok: false, error: 'Enter the 6-digit OTP sent to your phone.' };
    }
    if (!confirmationResult) {
      return { ok: false, error: 'Request an OTP code first.' };
    }
    try {
      await confirmationResult.confirm(code);
      confirmationResult = null;
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function signOutUser() {
    try {
      if (saveTimer && currentUser) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await pushWorkspaceToCloud(currentUser.uid);
      }
      const { auth, authMod } = await loadFirebaseSdk();
      await authMod.signOut(auth);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  return {
    init,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    sendPhoneOtp,
    confirmPhoneOtp,
    signOutUser,
  };
}
