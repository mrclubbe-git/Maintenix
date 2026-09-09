const crypto = require("crypto");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");

  return { salt, hash, algo: "scrypt", keylen: KEYLEN };
}

function verifyPassword(password, stored) {
  if (!stored || stored.algo !== "scrypt" || !stored.salt || !stored.hash) return false;

  const computed = crypto
    .scryptSync(password, stored.salt, stored.keylen || KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");

  // timing-safe compare
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(stored.hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };
