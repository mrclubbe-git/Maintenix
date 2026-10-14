const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maintenix-notifications-"));
process.env.MAINTENIX_NOTIFICATIONS_FILE = path.join(tmp, "notifications.json");
process.env.MAINTENIX_NOTIFICATION_DELIVERY_FILE = path.join(tmp, "notification-delivery.json");

const {
  createNotification,
  listForUser,
  markRead,
  acknowledge,
  clearVisible
} = require("../lib/notifications");
const { notify } = require("../lib/notificationService");

test("notification architecture: visibility, idempotency, acknowledgement and delivery queue", () => {
  const admin = { id: "admin-1", email: "admin@example.test", name: "Admin", role: "ADMIN" };
  const userA = { id: "user-a", email: "a@example.test", name: "User A", role: "L1" };
  const userB = { id: "user-b", email: "b@example.test", name: "User B", role: "L1" };

  const broadcast = notify("ADMIN_BROADCAST", {
    actor: admin, title: "Test", message: "Broadcast", requiresAck: false,
    idempotencyKey: "test:broadcast"
  });
  assert.equal(listForUser(userA).some((item) => item.id === broadcast.id), true);
  assert.equal(listForUser(userB).some((item) => item.id === broadcast.id), true);

  const task = { id: "task-1", title: "Inspect", date: "2026-10-14", startDate: "2026-10-14" };
  const assigned = notify("PLANNER_ASSIGNED", {
    actor: admin, assignee: userA, task, idempotencyKey: "test:planner:1"
  });
  const duplicate = notify("PLANNER_ASSIGNED", {
    actor: admin, assignee: userA, task, idempotencyKey: "test:planner:1"
  });
  assert.equal(assigned.id, duplicate.id);
  assert.equal(listForUser(userA).some((item) => item.id === assigned.id), true);
  assert.equal(listForUser(userB).some((item) => item.id === assigned.id), false);

  const read = markRead(assigned.id, userA);
  assert.equal(read.read, true);
  assert.equal(read.acknowledged, false);

  clearVisible(userA);
  assert.equal(listForUser(userA).some((item) => item.id === assigned.id), true);

  const acked = acknowledge(assigned.id, userA);
  assert.equal(acked.acknowledged, true);
  assert.equal(acked.read, true);
  clearVisible(userA);
  assert.equal(listForUser(userA).some((item) => item.id === assigned.id), false);

  createNotification({
    eventType: "ROLE_TEST", scope: "GLOBAL", targetRoles: ["ADMIN"],
    title: "Admin only", idempotencyKey: "test:role"
  });
  assert.equal(listForUser(admin).some((item) => item.eventType === "ROLE_TEST"), true);
  assert.equal(listForUser(userA).some((item) => item.eventType === "ROLE_TEST"), false);

  const areaRequired = notify("AREA_METADATA_REQUIRED", {
    actor: userA,
    area: "New Compressor Substation F895-G1234",
    idempotencyKey: "test:area:metadata"
  });
  assert.equal(areaRequired.requiresAck, false);
  assert.equal(areaRequired.severity, "warning");
  assert.equal(areaRequired.actionUrl, "#/administration?tab=areas&status=pending");
  assert.equal(listForUser(admin).some((item) => item.id === areaRequired.id), true);
  assert.equal(listForUser(userA).some((item) => item.id === areaRequired.id), false);

  const selfApproved = notify("REPORT_APPROVED", {
    actor: admin,
    targetUserId: admin.id,
    targetUserEmail: admin.email,
    fileName: "self-approved.docx",
    idempotencyKey: "test:report:self-approved"
  });
  assert.equal(listForUser(admin).some((item) => item.id === selfApproved.id), true);

  const rejected = notify("REPORT_REJECTED", {
    actor: admin,
    targetUserId: userA.id,
    targetUserEmail: userA.email,
    fileName: "rejected.docx",
    reason: "Correction required.",
    idempotencyKey: "test:report:rejected"
  });
  assert.equal(listForUser(userA).some((item) => item.id === rejected.id), true);

  const delivery = JSON.parse(fs.readFileSync(process.env.MAINTENIX_NOTIFICATION_DELIVERY_FILE, "utf8"));
  assert.equal(delivery.jobs.filter((job) => job.notificationId === assigned.id).length, 1);
  assert.equal(delivery.jobs.filter((job) => job.notificationId === selfApproved.id).length, 1);
  assert.equal(delivery.jobs.filter((job) => job.notificationId === rejected.id).length, 1);
});
