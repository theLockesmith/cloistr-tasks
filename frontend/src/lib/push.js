// frontend/src/lib/push.js
//
// Browser push notification subscription management. Talks to the
// /api/push/* endpoints (backend/server.js) and the service worker at
// public/sw.js. Kept framework-free so it's easy to unit test and reuse
// from both the Settings UI and the app-load bootstrap.

const SW_URL = '/sw.js';

/** True when this browser can do Web Push at all. */
export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Current Notification permission ('default' | 'granted' | 'denied'), or null if unsupported. */
export function getPermissionState() {
  if (typeof Notification === 'undefined') return null;
  return Notification.permission;
}

// A VAPID public key arrives as a URL-safe base64 string; PushManager.subscribe
// needs it as a Uint8Array. Standard conversion for the Web Push API.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Register the service worker (idempotent — the browser reuses an existing registration). */
export async function registerServiceWorker() {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register(SW_URL);
}

/**
 * Register the service worker if notification permission is already
 * granted — called on app load so a returning user with push already
 * enabled keeps receiving notifications without re-opening Settings.
 * Does nothing (and never prompts) if permission hasn't been granted yet.
 */
export async function registerServiceWorkerIfGranted() {
  if (!isPushSupported()) return null;
  if (Notification.permission !== 'granted') return null;
  try {
    return await registerServiceWorker();
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}

/**
 * Full opt-in flow: request permission, register the service worker,
 * subscribe to push, and save the subscription on the backend.
 *
 * @param {(url: string, options?: object) => Promise<Response>} apiCall - from useAuth()
 * @returns {Promise<PushSubscription>}
 * @throws if the browser doesn't support push, permission is denied, or
 *   the backend has no VAPID key configured (push notifications disabled).
 */
export async function subscribeToPush(apiCall) {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }

  const registration = await registerServiceWorker();
  await navigator.serviceWorker.ready;

  const keyRes = await apiCall('/push/vapid-key');
  if (!keyRes.ok) {
    throw new Error('Push notifications are not configured on this server');
  }
  const { publicKey } = await keyRes.json();

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const subJson = subscription.toJSON();
  const saveRes = await apiCall('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });
  if (!saveRes.ok) {
    throw new Error('Failed to save push subscription');
  }

  return subscription;
}

/**
 * Full opt-out flow: unsubscribe locally and remove the subscription from
 * the backend. Safe to call even if there is no active subscription.
 *
 * @param {(url: string, options?: object) => Promise<Response>} apiCall - from useAuth()
 */
export async function unsubscribeFromPush(apiCall) {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!registration) return;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;

  try {
    await subscription.unsubscribe();
  } finally {
    // Always try to remove the backend record, even if the browser-side
    // unsubscribe failed — an orphaned subscription just wastes a push send
    // (cleaned up automatically on the next 404/410), but a leftover backend
    // row a user explicitly asked to delete should never be left behind.
    await apiCall('/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }).catch((err) => console.error('Failed to remove push subscription from server:', err));
  }
}

/** Whether the browser currently has an active push subscription. */
export async function getActiveSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}
