"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OFFLINE_LEASE_TTL_MS = 48 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, "..", "data");
const PRIVATE_KEY_FILE = process.env.OFFLINE_LEASE_PRIVATE_KEY_FILE
  ? path.resolve(process.env.OFFLINE_LEASE_PRIVATE_KEY_FILE)
  : path.join(DATA_DIR, "offline-lease-private.pem");
const PUBLIC_KEY_FILE = process.env.OFFLINE_LEASE_PUBLIC_KEY_FILE
  ? path.resolve(process.env.OFFLINE_LEASE_PUBLIC_KEY_FILE)
  : path.join(DATA_DIR, "offline-lease-public.pem");

let cachedKeys = null;

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function ensureSigningKeys() {
  if (cachedKeys) return cachedKeys;

  fs.mkdirSync(path.dirname(PRIVATE_KEY_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC_KEY_FILE), { recursive: true });

  let privatePem = "";
  let publicPem = "";

  if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) {
    privatePem = fs.readFileSync(PRIVATE_KEY_FILE, "utf8");
    publicPem = fs.readFileSync(PUBLIC_KEY_FILE, "utf8");
  } else {
    const pair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });

    privatePem = pair.privateKey;
    publicPem = pair.publicKey;

    const privateTmp = `${PRIVATE_KEY_FILE}.tmp`;
    const publicTmp = `${PUBLIC_KEY_FILE}.tmp`;

    fs.writeFileSync(privateTmp, privatePem, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(publicTmp, publicPem, { encoding: "utf8", mode: 0o644 });
    fs.renameSync(privateTmp, PRIVATE_KEY_FILE);
    fs.renameSync(publicTmp, PUBLIC_KEY_FILE);
  }

  const publicKey = crypto.createPublicKey(publicPem);
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const keyId = crypto.createHash("sha256").update(publicDer).digest("hex").slice(0, 24);

  cachedKeys = {
    privatePem,
    publicPem,
    publicKeyJwk: { ...publicKeyJwk, alg: "RS256", use: "sig", ext: true },
    keyId
  };
  return cachedKeys;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeOrganization(value) {
  return String(value || process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase();
}

function issueOfflineLease(user, options = {}) {
  if (!user?.id) throw new Error("Cannot issue offline lease without a user.");

  const organization = normalizeOrganization(user.organization || options.organization);
  const role = normalizeRole(user.role);
  const status = String(user.status || "").trim().toUpperCase();
  const approved = role === "ADMIN" || status === "APPROVED";
  if (!approved) throw new Error("Cannot issue offline lease for an unauthorised account.");

  const now = Date.now();
  const expiresAt = now + OFFLINE_LEASE_TTL_MS;
  const { privatePem, publicKeyJwk, keyId } = ensureSigningKeys();

  const header = {
    alg: "RS256",
    typ: "MTX-OFFLINE",
    kid: keyId
  };
  const payload = {
    v: 1,
    iss: "maintenix",
    aud: "maintenix-offline",
    sub: String(user.id),
    organization,
    role,
    status,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000)
  };

  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privatePem);
  const token = `${signingInput}.${b64url(signature)}`;

  return {
    token,
    issuedAt: now,
    expiresAt,
    publicKeyJwk,
    keyId
  };
}

function verifyOfflineLeaseToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;

    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const { publicPem } = ensureSigningKeys();

    if (!crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicPem, signature)) return null;

    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (payload?.aud !== "maintenix-offline" || payload?.iss !== "maintenix") return null;
    if (!payload?.sub || !payload?.exp) return null;
    if (Date.now() >= Number(payload.exp) * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  OFFLINE_LEASE_TTL_MS,
  PRIVATE_KEY_FILE,
  PUBLIC_KEY_FILE,
  issueOfflineLease,
  verifyOfflineLeaseToken
};
