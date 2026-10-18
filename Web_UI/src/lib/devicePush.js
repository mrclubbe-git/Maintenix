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
  if (!supportsDevicePush()) return null;

  const registrations = await navigator.serviceWorker.getRegistrations();
  return registrations.find(isMaintenixPushWorkerRegistration) || null;
}

async function ensurePushWorkerRegistration() {
  const existing = await findPushWorkerRegistration();
  if (existing) return existing;

  return navigator.serviceWorker.register(pushWorkerUrl(), {
    scope: pushWorkerScope()
  });
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
