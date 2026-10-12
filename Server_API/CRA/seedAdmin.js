const { getUsers, saveUsers, findByEmail } = require("./lib/userStore");
const { hashPassword } = require("./lib/passwords");

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";

if (!adminEmail || !adminEmail.includes("@")) {
  console.error("ADMIN_EMAIL not set (or invalid).");
  process.exit(1);
}
if (adminPassword.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const existing = findByEmail(adminEmail);
if (existing) {
  // Ensure it is admin + approved
  existing.role = "ADMIN";
  existing.status = "APPROVED";
  existing.approvedAt = existing.approvedAt || new Date().toISOString();
  existing.approvedBy = existing.approvedBy || "seed";
  const users = getUsers().map((u) => (u.id === existing.id ? existing : u));
  saveUsers(users);
  console.log("✅ Admin updated:", adminEmail);
  process.exit(0);
}

const users = getUsers();
users.push({
  id: "admin",
  email: adminEmail,
  name: "Admin",
  role: "ADMIN",
  status: "APPROVED",
  password: hashPassword(adminPassword),
  createdAt: new Date().toISOString(),
  approvedAt: new Date().toISOString(),
  approvedBy: "seed",
});

saveUsers(users);
console.log("✅ Admin created:", adminEmail);
