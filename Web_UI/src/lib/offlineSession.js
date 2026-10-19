import { ORGANIZATION, orgLocalStorage } from "../config/organization";

const OFFLINE_LEASE_KEY = "offlineLease";
const OFFLINE_SYNC_AT_KEY = "lastSuccessfulSyncAt";

function decodeBase64Url(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  const bytes = decodeBase64Url(value);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function cleanStoredLease(value) {
  if (!value || typeof value !== "object") return null;
  const token = String(value.token || "").trim();
  const publicKeyJwk = value.publicKeyJwk && typeof value.publicKeyJwk === "object"
    ? value.publicKeyJwk
    : null;
  if (!token || !publicKeyJwk) return null;
  return {
    token,
    publicKeyJwk,
    issuedAt: Number(value.issuedAt || 0),
    expiresAt: Number(value.expiresAt || 0),
    user: value.user && typeof value.user === "object" ? value.user : null
  };
}

export function clearOfflineLease() {
  try { orgLocalStorage.removeItem(OFFLINE_LEASE_KEY); } catch {}
}

export function storeOfflineLease(offlineLease, user) {
  const lease = cleanStoredLease({ ...(offlineLease || {}), user });
  if (!lease) return false;

  try {
    orgLocalStorage.setItem(OFFLINE_LEASE_KEY, JSON.stringify(lease));
    if (lease.expiresAt > Date.now()) {
      orgLocalStorage.setItem("authExpiresAt", String(lease.expiresAt));
    }
    return true;
  } catch {
    return false;
  }
}

export function storeOfflineLeaseFromResponse(data) {
  if (!data?.offlineLease || !data?.user) return false;
  return storeOfflineLease(data.offlineLease, data.user);
}

export function getStoredOfflineLease() {
  try {
    return cleanStoredLease(JSON.parse(orgLocalStorage.getItem(OFFLINE_LEASE_KEY) || "null"));
  } catch {
    return null;
  }
}

export async function verifyStoredOfflineLease(now = Date.now()) {
  const stored = getStoredOfflineLease();
  if (!stored) return { valid: false, reason: "missing" };

  try {
    if (!window.crypto?.subtle) return { valid: false, reason: "crypto-unavailable" };

    const parts = stored.token.split(".");
    if (parts.length !== 3) return { valid: false, reason: "format" };

    const header = decodeJsonPart(parts[0]);
    const payload = decodeJsonPart(parts[1]);

    if (header?.alg !== "RS256" || header?.typ !== "MTX-OFFLINE") {
      return { valid: false, reason: "algorithm" };
    }

    if (
      payload?.iss !== "maintenix" ||
      payload?.aud !== "maintenix-offline" ||
      String(payload?.organization || "").toUpperCase() !== ORGANIZATION.code
    ) {
      return { valid: false, reason: "scope" };
    }

    const expiresAt = Number(payload?.exp || 0) * 1000;
    if (!expiresAt || Number(now) >= expiresAt) {
      return { valid: false, reason: "expired", expiresAt };
    }

    const user = stored.user || {};
    if (!user?.id || String(user.id) !== String(payload?.sub || "")) {
      return { valid: false, reason: "user" };
    }

    const leaseRole = normalizeRole(payload?.role);
    const userRole = normalizeRole(user?.role);
    const status = String(payload?.status || user?.status || "").trim().toUpperCase();
    if (!leaseRole || leaseRole !== userRole) return { valid: false, reason: "role" };
    if (leaseRole !== "ADMIN" && status !== "APPROVED") {
      return { valid: false, reason: "status" };
    }

    const key = await window.crypto.subtle.importKey(
      "jwk",
      stored.publicKeyJwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = decodeBase64Url(parts[2]);
    const valid = await window.crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signingInput
    );

    if (!valid) return { valid: false, reason: "signature" };

    return {
      valid: true,
      user,
      payload,
      expiresAt,
      issuedAt: Number(payload?.iat || 0) * 1000
    };
  } catch {
    return { valid: false, reason: "verification" };
  }
}

export function setLastSuccessfulSyncAt(value = Date.now()) {
  try { orgLocalStorage.setItem(OFFLINE_SYNC_AT_KEY, String(Number(value || Date.now()))); } catch {}
}

export function getLastSuccessfulSyncAt() {
  try {
    const value = Number(orgLocalStorage.getItem(OFFLINE_SYNC_AT_KEY) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
