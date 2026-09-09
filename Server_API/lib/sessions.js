// /opt/maintenix-ui/server-api/lib/sessions.js
const crypto = require("crypto");

// token -> { userId, createdAt }
const sessions = new Map();

function createSession(userId) {
  const token = "t_" + crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function deleteSession(token) {
  sessions.delete(token);
}

function extractBearer(input) {
  // input can be: req object OR authorization header string
  let auth = "";

  if (typeof input === "string") {
    auth = input;
  } else {
    auth = input?.headers?.authorization || "";
  }

  if (!auth) return "";

  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}


module.exports = { createSession, getSession, deleteSession, extractBearer };
