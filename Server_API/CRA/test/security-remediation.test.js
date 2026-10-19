"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maintenix-security-"));
process.env.SESSION_DATA_FILE = path.join(tempDir, "sessions.json");
process.env.PROFILE_PICS_DIR = path.join(tempDir, "profilepics");
process.env.OFFLINE_LEASE_PRIVATE_KEY_FILE = path.join(tempDir, "offline-lease-private.pem");
process.env.OFFLINE_LEASE_PUBLIC_KEY_FILE = path.join(tempDir, "offline-lease-public.pem");
delete process.env.ALLOW_LEGACY_BEARER;

const sessions = require("../lib/sessions");
const { OFFLINE_LEASE_TTL_MS, issueOfflineLease, verifyOfflineLeaseToken } = require("../lib/offlineLease");
const { validateSignatureDataUrl } = require("../lib/imageValidation");
const {
  PROFILE_PICS_DIR,
  ensureProfilePicsDir,
  publicUrlForProfilePhoto,
  profilePhotoCandidatePaths
} = require("../lib/profilePhotoStorage");

test.after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

test("session and offline lease ceilings are 48 hours", () => {
  assert.equal(sessions.SESSION_TTL_MS, 48 * 60 * 60 * 1000);
  assert.equal(OFFLINE_LEASE_TTL_MS, 48 * 60 * 60 * 1000);

  const lease = issueOfflineLease({
    id: "user-offline",
    email: "offline@example.test",
    name: "Offline User",
    role: "L1",
    status: "APPROVED",
    organization: "CRA"
  });

  assert.ok(lease.token);
  assert.ok(lease.publicKeyJwk?.n);
  assert.ok(lease.publicKeyJwk?.e);
  assert.ok(lease.expiresAt > Date.now() + (47 * 60 * 60 * 1000));

  const payload = verifyOfflineLeaseToken(lease.token);
  assert.equal(payload?.sub, "user-offline");
  assert.equal(payload?.organization, "CRA");
  assert.equal(payload?.role, "L1");

  const tokenParts = lease.token.split(".");
  const signature = tokenParts[2];
  const tamperAt = Math.max(0, Math.floor(signature.length / 2));
  const replacement = signature[tamperAt] === "A" ? "B" : "A";
  tokenParts[2] = signature.slice(0, tamperAt) + replacement + signature.slice(tamperAt + 1);
  const tampered = tokenParts.join(".");
  assert.equal(verifyOfflineLeaseToken(tampered), null);
});

test("cookie sessions are server-managed, CSRF-bound and individually revocable", () => {
  const token = sessions.createSession("user-a", { organization: "CRA" });
  const otherToken = sessions.createSession("user-b", { organization: "CRA" });

  const session = sessions.getSession(token);
  assert.equal(session.userId, "user-a");
  assert.ok(session.csrfToken);
  assert.ok(sessions.getSessionExpiresAt(token) > Date.now());

  const cookieRequest = {
    headers: {
      cookie: `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`
    }
  };
  assert.equal(sessions.extractSessionToken(cookieRequest), token);

  const bearerRequest = {
    headers: {
      authorization: `Bearer ${token}`
    }
  };
  assert.equal(sessions.extractSessionToken(bearerRequest), "");

  assert.equal(sessions.validateCsrfToken(session, session.csrfToken), true);
  assert.equal(sessions.validateCsrfToken(session, "wrong"), false);

  assert.equal(sessions.deleteSession(token), true);
  assert.equal(sessions.getSession(token), null);
  assert.ok(sessions.getSession(otherToken));

  assert.equal(sessions.deleteSessionsForUser("user-b"), 1);
  assert.equal(sessions.getSession(otherToken), null);
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function signaturePng(width = 240, height = 90) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4, 0xff);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = 1 + x * 4;
      const ink = Math.abs(y - Math.floor(height / 2 + Math.sin(x / 11) * 18)) <= 1;
      row[pixel] = ink ? 0x11 : 0xff;
      row[pixel + 1] = ink ? 0x11 : 0xff;
      row[pixel + 2] = ink ? 0x11 : 0xff;
      row[pixel + 3] = 0xff;
    }
    rows.push(row);
  }

  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

test("signature validation rejects placeholder images and accepts a real-sized PNG", () => {
  const placeholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cZKkAAAAASUVORK5CYII=";
  assert.throws(() => validateSignatureDataUrl(placeholder), /missing or too small/i);

  const good = signaturePng();
  const dataUrl = `data:image/png;base64,${good.toString("base64")}`;
  const decoded = validateSignatureDataUrl(dataUrl);
  assert.equal(decoded.width, 240);
  assert.equal(decoded.height, 90);
  assert.equal(decoded.type, "png");
});


test("profile photo storage uses an isolated writable runtime directory with legacy cleanup compatibility", () => {
  assert.equal(PROFILE_PICS_DIR, path.join(tempDir, "profilepics"));
  const dir = ensureProfilePicsDir();
  const filename = "profile_user-a_123.png";
  const probe = path.join(dir, filename);

  fs.writeFileSync(probe, Buffer.from("avatar-probe"));
  assert.equal(fs.readFileSync(probe, "utf8"), "avatar-probe");
  assert.equal(publicUrlForProfilePhoto(filename), `/uploads/profilepics/${filename}`);

  const candidates = profilePhotoCandidatePaths(`/uploads/profilepics/${filename}`);
  assert.equal(candidates[0], probe);
  assert.match(candidates[1], /data[\\/]uploads[\\/]profilepics[\\/]profile_user-a_123\.png$/);
});
