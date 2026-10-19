import { orgLocalStorage } from "../config/organization";

const PUSH_WORKER_FILENAME = "maintenix-push-sw.js";

function publicBase() {
  const base = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
  return base;
}

function pushWorkerUrl() {
  return `${publicBase()}/${PUSH_WORKER_FILENAME}`;
}

function pushWorkerScope() {
  return `${publicBase()}/`;
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

export function isMaintenixPushWorkerScriptUrl(value) {
  const url = String(value || "");
  return url.endsWith(`/${PUSH_WORKER_FILENAME}`) || url.includes(`/${PUSH_WORKER_FILENAME}?`);
}

export function isMaintenixPushWorkerRegistration(registration) {
  const scriptUrl =
    registration?.active?.scriptURL ||
    registration?.waiting?.scriptURL ||
    registration?.installing?.scriptURL ||
    "";

  return isMaintenixPushWorkerScriptUrl(scriptUrl);
}

export function supportsDevicePush() {
  return Boolean(
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function fetchPushConfiguration(authToken) {
  if (!authToken) return { configured: false, publicKey: "" };

  const res = await fetch("/api/push/public-key", {
    headers: {}
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `Unable to load device notification configuration (HTTP ${res.status}).`);
  }

  return {
    configured: data?.configured === true,
    publicKey: String(data?.publicKey || "").trim()
  };
}

async function findPushWorkerRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.find(isMaintenixPushWorkerRegistration) || null;
}

export async function ensureMaintenixWorkerRegistration() {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  const existing = await findPushWorkerRegistration();
  if (existing) {
    try { await existing.update(); } catch {}
    return existing;
  }

  return navigator.serviceWorker.register(pushWorkerUrl(), {
    scope: pushWorkerScope()
  });
}

async function ensurePushWorkerRegistration() {
  return ensureMaintenixWorkerRegistration();
}

export async function getDevicePushState(authToken) {
  const supported = supportsDevicePush();
  const permission =
    supported && typeof Notification !== "undefined"
      ? Notification.permission
      : "unsupported";

  if (!supported) {
    return {
      supported: false,
      configured: false,
      permission,
      subscribed: false
    };
  }

  let configured = false;
  try {
    const config = await fetchPushConfiguration(authToken);
    configured = config.configured;
  } catch {
    configured = false;
  }

  let subscribed = false;
  try {
    const registration = await findPushWorkerRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    subscribed = Boolean(subscription);
  } catch {}

  return {
    supported: true,
    configured,
    permission: Notification.permission,
    subscribed
  };
}

export async function enableDevicePush(authToken) {
  if (!supportsDevicePush()) {
    throw new Error("Device notifications are not supported in this browser.");
  }

  const config = await fetchPushConfiguration(authToken);
  if (!config.configured || !config.publicKey) {
    throw new Error("Device notifications are not configured on the CRA server yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notification permission is blocked in this browser's settings."
        : "Notification permission was not granted."
    );
  }

  const registration = await ensurePushWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.publicKey)
    });
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      subscription: subscription.toJSON()
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    try { await subscription.unsubscribe(); } catch {}
    throw new Error(data?.message || `Unable to enable device notifications (HTTP ${res.status}).`);
  }

  return {
    supported: true,
    configured: true,
    permission: Notification.permission,
    subscribed: true
  };
}

export async function disableDevicePush(authToken) {
  if (!supportsDevicePush()) {
    return {
      supported: false,
      configured: false,
      permission: "unsupported",
      subscribed: false
    };
  }

  const registration = await findPushWorkerRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;

  if (subscription && authToken) {
    try {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
    } catch {
      // Still unsubscribe locally; stale server subscriptions are also removed
      // automatically when a push provider returns 404/410.
    }
  }

  if (subscription) {
    try { await subscription.unsubscribe(); } catch {}
  }

  if (registration) {
    try { await registration.unregister(); } catch {}
  }

  let configured = false;
  try {
    configured = (await fetchPushConfiguration(authToken)).configured;
  } catch {}

  return {
    supported: true,
    configured,
    permission: Notification.permission,
    subscribed: false
  };
}

export async function sendDevicePushTest(authToken) {
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: {}
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `Unable to send device notification test (HTTP ${res.status}).`);
  }

  return data;
}


const DEVICE_NOTIFICATION_ACTION_PARAM = "mtxNotificationAction";
const DEVICE_NOTIFICATION_ID_PARAM = "mtxNotificationId";
const DEVICE_NOTIFICATION_ACTIONS = new Set(["mark-read", "acknowledge"]);
let deviceNotificationActionBridgeStarted = false;
let deviceNotificationActionBusy = false;

function normalizeDeviceNotificationAction(action, notificationId) {
  const cleanAction = String(action || "").trim().toLowerCase();
  const cleanId = String(notificationId || "").trim().slice(0, 240);
  if (!DEVICE_NOTIFICATION_ACTIONS.has(cleanAction) || !cleanId) return null;
  return { action: cleanAction, notificationId: cleanId };
}

function pendingDeviceNotificationActionFromUrl() {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    return normalizeDeviceNotificationAction(
      url.searchParams.get(DEVICE_NOTIFICATION_ACTION_PARAM),
      url.searchParams.get(DEVICE_NOTIFICATION_ID_PARAM)
    );
  } catch {
    return null;
  }
}

function rememberPendingDeviceNotificationAction(action) {
  if (typeof window === "undefined" || !action) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(DEVICE_NOTIFICATION_ACTION_PARAM, action.action);
    url.searchParams.set(DEVICE_NOTIFICATION_ID_PARAM, action.notificationId);
    window.history.replaceState(window.history.state, document.title, url.href);
  } catch {}
}

function clearPendingDeviceNotificationAction() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(DEVICE_NOTIFICATION_ACTION_PARAM);
    url.searchParams.delete(DEVICE_NOTIFICATION_ID_PARAM);
    window.history.replaceState(window.history.state, document.title, url.href);
  } catch {}
}

async function performDeviceNotificationAction(action) {
  if (!action) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  // The scoped authToken key intentionally resolves to the cookie-session
  // marker. No bearer credential is exposed to the service worker.
  const authSession = orgLocalStorage.getItem("authToken") || "";
  if (!authSession) return false;

  const endpoint = action.action === "acknowledge"
    ? `/api/notifications/${encodeURIComponent(action.notificationId)}/ack`
    : `/api/notifications/${encodeURIComponent(action.notificationId)}/read`;

  const res = await fetch(endpoint, {
    method: "POST",
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));

  // Keep the pending action in the URL when authentication has expired so it
  // can be retried after the user signs in again.
  if (res.status === 401) return false;

  // A missing/already-cleared notification should not become a permanent
  // retry loop on every focus/reconnect.
  if (res.status === 404) return true;

  if (!res.ok) {
    throw new Error(data?.message || `Notification action failed (HTTP ${res.status}).`);
  }

  try {
    window.dispatchEvent(new CustomEvent("notificationsUpdated", { detail: data }));
    if (
      data?.relatedTask ||
      String(data?.notification?.relatedEntityType || "") === "daily_planner_task"
    ) {
      window.dispatchEvent(new CustomEvent("dailyPlannerUpdated", { detail: data }));
    }
  } catch {}

  return true;
}

async function tryPendingDeviceNotificationAction(actionOverride = null) {
  if (deviceNotificationActionBusy) return false;

  const action =
    normalizeDeviceNotificationAction(
      actionOverride?.action,
      actionOverride?.notificationId
    ) ||
    pendingDeviceNotificationActionFromUrl();

  if (!action) return false;

  rememberPendingDeviceNotificationAction(action);
  deviceNotificationActionBusy = true;
  try {
    const completed = await performDeviceNotificationAction(action);
    if (completed) clearPendingDeviceNotificationAction();
    return completed;
  } catch {
    return false;
  } finally {
    deviceNotificationActionBusy = false;
  }
}

/**
 * Bridges native Web Push action buttons back into the authenticated Maintenix
 * application. The service worker never receives a CSRF secret or session
 * credential; it only supplies the notification ID and requested action.
 */
export function startDeviceNotificationActionBridge() {
  if (deviceNotificationActionBridgeStarted) return () => {};
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};

  deviceNotificationActionBridgeStarted = true;

  const attemptPending = () => {
    tryPendingDeviceNotificationAction().catch(() => {});
  };

  const onWorkerMessage = (event) => {
    const message = event?.data;
    if (String(message?.type || "") !== "maintenix-notification-action") return;

    const action = normalizeDeviceNotificationAction(
      message?.action,
      message?.notificationId
    );
    if (!action) return;

    rememberPendingDeviceNotificationAction(action);
    tryPendingDeviceNotificationAction(action).catch(() => {});
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", onWorkerMessage);
  }
  window.addEventListener("authUserUpdated", attemptPending);
  window.addEventListener("online", attemptPending);
  window.addEventListener("focus", attemptPending);

  window.setTimeout(attemptPending, 0);

  return () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("message", onWorkerMessage);
    }
    window.removeEventListener("authUserUpdated", attemptPending);
    window.removeEventListener("online", attemptPending);
    window.removeEventListener("focus", attemptPending);
    deviceNotificationActionBridgeStarted = false;
  };
}
