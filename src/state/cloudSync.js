/**
 * Firebase Authentication (Google / Gmail and Email/Password)
 * and Cloud Firestore sync adapter for RupeeSync.
 *
 * Keeps core/store 100% functional offline in localStorage while syncing across
 * devices when signed in, and enforces append-only activity log writes matching
 * Firestore Security Rules (`allow update, delete: if false`).
 */

const FIREBASE_SDK_BASE = 'https://www.gstatic.com/firebasejs/11.6.0';
const VERCEL_PROXY_HOST = 'easy-one-coral.vercel.app';

const FIREBASE_CONFIG = {
  projectId: 'rupeesync-split-2026',
  appId: '1:1027025841290:web:074224b108849e49119173',
  storageBucket: 'rupeesync-split-2026.firebasestorage.app',
  apiKey: 'AIzaSyASxXXqh-Yq5NwO25tayRIiYWr9j7sEsM4',
  authDomain: 'rupeesync-split-2026.firebaseapp.com',
  messagingSenderId: '1027025841290',
};

export function resolveAuthDomain(host = typeof window !== 'undefined' ? window.location?.host ?? '' : '') {
  return host === VERCEL_PROXY_HOST ? VERCEL_PROXY_HOST : FIREBASE_CONFIG.authDomain;
}

let sdkCache = null;
let sdkPromise = null;

function loadFirebaseSdk() {
  if (sdkCache) {
    return Promise.resolve(sdkCache);
  }
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import(`${FIREBASE_SDK_BASE}/firebase-app.js`),
      import(`${FIREBASE_SDK_BASE}/firebase-auth.js`),
      import(`${FIREBASE_SDK_BASE}/firebase-firestore.js`),
    ])
      .then(([appMod, authMod, fsMod]) => {
        const config = { ...FIREBASE_CONFIG, authDomain: resolveAuthDomain() };
        const app = appMod.getApps().length > 0 ? appMod.getApp() : appMod.initializeApp(config);
        const auth = authMod.getAuth(app);
        const db = fsMod.getFirestore(app);
        sdkCache = { app, auth, db, authMod, fsMod };
        return sdkCache;
      })
      .catch((err) => {
        sdkPromise = null;
        throw err;
      });
  }
  return sdkPromise;
}

function formatAuthError(err) {
  const code = err?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before finishing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Allow popups for this site in your address bar and try again, or use Email & Password sign-in.';
    case 'auth/unauthorized-domain':
      return 'This domain must be added under Firebase Console → Authentication → Settings → Authorized domains.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is currently unavailable. Please try another option.';
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
    case 'auth/too-many-requests':
      return 'Too many attempts right now. Wait a moment and try again.';
    default:
      return err?.message ? String(err.message) : 'Authentication request failed.';
  }
}

const REDIRECT_PENDING_KEY = 'rupeesync_google_redirect_pending';

function readRedirectPendingFlag() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage?.getItem(REDIRECT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRedirectPendingFlag(active) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    if (active) {
      window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    } else {
      window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    }
  } catch {
    // Ignore storage restrictions cleanly
  }
}

export function isSameOriginAuthHost(
  host = typeof window !== 'undefined' ? window.location?.hostname ?? '' : ''
) {
  return (
    host === FIREBASE_CONFIG.authDomain ||
    host === `${FIREBASE_CONFIG.projectId}.web.app` ||
    host === VERCEL_PROXY_HOST
  );
}

/**
 * Creates the cloud authentication & Firestore synchronization controller.
 *
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   onStatusChange: (status: {
 *     ready: boolean,
 *     user: { uid: string, displayName: string, email: string } | null,
 *     syncState: 'local' | 'syncing' | 'synced' | 'error',
 *     syncMessage: string,
 *   }) => void,
 *   sdkLoader?: () => Promise<any>,
 *   allowRedirectFallback?: () => boolean,
 * }} deps
 */
export function createCloudSync({
  store,
  onStatusChange,
  sdkLoader = loadFirebaseSdk,
  allowRedirectFallback = isSameOriginAuthHost,
}) {
  let currentUser = null;
  let syncState = 'local';
  let syncMessage = 'Saved locally in this browser';
  let ready = false;
  let isHydrating = false;
  let saveTimer = null;
  let resolvedSdk = null;
  const syncedActivityIds = new Set();

  function getSdk() {
    if (resolvedSdk) {
      return Promise.resolve(resolvedSdk);
    }
    return Promise.resolve(sdkLoader()).then((sdk) => {
      resolvedSdk = sdk;
      return sdk;
    });
  }

  function preload() {
    return getSdk().catch(() => null);
  }

  function emitStatus() {
    onStatusChange({
      ready,
      user: currentUser
        ? {
            uid: currentUser.uid,
            displayName: currentUser.displayName ?? '',
            email: currentUser.email ?? '',
          }
        : null,
      syncState,
      syncMessage,
    });
  }

  async function pushWorkspaceToCloud(uid) {
    if (!uid) return;
    const { db, fsMod } = await getSdk();
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
    const { db, fsMod } = await getSdk();
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
      const { auth, authMod } = await getSdk();
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

      if (typeof authMod.getRedirectResult === 'function') {
        const hadPendingRedirect = readRedirectPendingFlag();
        writeRedirectPendingFlag(false);
        authMod.getRedirectResult(auth).then(
          (result) => {
            if (hadPendingRedirect && !result?.user && !auth.currentUser) {
              syncState = 'error';
              syncMessage =
                'Google redirect sign-in could not complete in this browser. Allow popups for Google sign-in or use Email & Password.';
              emitStatus();
            }
          },
          (err) => {
            syncState = 'error';
            syncMessage = formatAuthError(err);
            emitStatus();
          }
        );
      }
    } catch {
      ready = false;
      syncState = 'local';
      syncMessage = 'Offline mode (saved locally)';
      emitStatus();
    }
  }

  function startGoogleAuth({ auth, authMod }) {
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return authMod.signInWithPopup(auth, provider).then(
      () => ({ ok: true, error: null, redirected: false }),
      (err) => {
        // Cross-origin signInWithRedirect silently drops credentials under browser storage partitioning;
        // only fall back to redirect when authDomain matches the current origin.
        if (
          err?.code === 'auth/popup-blocked' &&
          allowRedirectFallback() &&
          typeof authMod.signInWithRedirect === 'function'
        ) {
          writeRedirectPendingFlag(true);
          return authMod.signInWithRedirect(auth, provider).then(
            () => ({ ok: true, error: null, redirected: true }),
            (redirectErr) => {
              writeRedirectPendingFlag(false);
              return { ok: false, error: formatAuthError(redirectErr), redirected: false };
            }
          );
        }
        return { ok: false, error: formatAuthError(err), redirected: false };
      }
    );
  }

  function signInWithGoogle() {
    // Only invoke signInWithPopup synchronously while user-activation is live;
    // calling it after an async network fetch causes browsers to block the popup.
    if (resolvedSdk) {
      return startGoogleAuth(resolvedSdk);
    }
    return getSdk().then(
      () => ({
        ok: false,
        error: 'Google Sign-In is ready now — click Continue with Google once more.',
        redirected: false,
      }),
      (err) => ({
        ok: false,
        error: formatAuthError(err),
        redirected: false,
      })
    );
  }

  async function signInWithEmail(email, password) {
    try {
      const { auth, authMod } = await getSdk();
      await authMod.signInWithEmailAndPassword(auth, String(email).trim(), String(password));
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function registerWithEmail(email, password) {
    try {
      const { auth, authMod } = await getSdk();
      await authMod.createUserWithEmailAndPassword(auth, String(email).trim(), String(password));
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  async function sendPasswordReset(email) {
    try {
      const { auth, authMod } = await getSdk();
      await authMod.sendPasswordResetEmail(auth, String(email).trim());
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
      const { auth, authMod } = await getSdk();
      await authMod.signOut(auth);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: formatAuthError(err) };
    }
  }

  return {
    init,
    preload,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    signOutUser,
  };
}
