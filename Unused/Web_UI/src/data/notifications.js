// src/data/notifications.js
//
// Keeps the existing UI shape used in Navbar today:
// - id, read, image, sender, time, message, link
//
// Adds backend-friendly fields for later:
// - type, createdAt, actor, target

import Profile1 from "../assets/img/team/profile-picture-1.jpg";
import Profile2 from "../assets/img/team/profile-picture-2.jpg";
import Profile3 from "../assets/img/team/profile-picture-3.jpg";

export const NOTIFICATION_TYPES = {
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  LOGIN_FAILED: "LOGIN_FAILED",
  SERVER_WARNING: "SERVER_WARNING",
  BACKUP_COMPLETED: "BACKUP_COMPLETED"
};

export const NOTIFICATIONS_DATA = [
  {
    // backend-ready fields
    id: "ntf-001",
    type: NOTIFICATION_TYPES.USER_CREATED,
    createdAt: "2026-01-18T09:12:00+02:00",
    actor: { name: "System", avatarUrl: Profile3 },
    target: { kind: "user", name: "New user account" },

    // Navbar UI fields (required today)
    read: false,
    image: Profile3,
    sender: "System",
    time: "Just now",
    message: "A new user account was created.",
    link: "#/dashboard/overview"
  },
  {
    id: "ntf-002",
    type: NOTIFICATION_TYPES.PASSWORD_RESET_REQUESTED,
    createdAt: "2026-01-18T08:40:00+02:00",
    actor: { name: "User", avatarUrl: Profile1 },
    target: { kind: "user", name: "Password reset" },

    read: false,
    image: Profile1,
    sender: "User",
    time: "32 min ago",
    message: "Password reset requested.",
    link: "#/examples/reset-password"
  },
  {
    id: "ntf-003",
    type: NOTIFICATION_TYPES.LOGIN_FAILED,
    createdAt: "2026-01-18T07:05:00+02:00",
    actor: { name: "Auth Service", avatarUrl: Profile2 },
    target: { kind: "server", name: "Login" },

    read: true,
    image: Profile2,
    sender: "Auth Service",
    time: "2 hours ago",
    message: "Multiple failed login attempts detected.",
    link: "#/server-info"
  }
];

// ✅ Navbar currently imports default:
// import NOTIFICATIONS_DATA from "../data/notifications";
export default NOTIFICATIONS_DATA;