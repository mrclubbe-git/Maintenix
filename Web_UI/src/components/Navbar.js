import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Nav, Navbar, Dropdown, Container, Badge } from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCog, faSignOutAlt, faBell, faCheck } from "@fortawesome/free-solid-svg-icons";
import { faUserCircle } from "@fortawesome/free-regular-svg-icons";
import { Link } from "react-router-dom";

import { Routes } from "../routes";
import {
  checkOfflineTokenNotifications,
  clearVisibleLocalNotifications,
  readVisibleLocalNotifications,
  updateLocalNotification
} from "../offlineMode";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function readAuthUser() {
  return safeJsonParse(localStorage.getItem("authUser") || "null", null);
}

function readNotifications() {
  return readVisibleLocalNotifications(readAuthUser());
}

// Reuse the same initials logic as DashboardOverview.js
function getInitials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function formatNotificationTime(iso) {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

async function refreshAuthUserFromApi() {
  const token = localStorage.getItem("authToken") || "";
  if (!token) return;

  try {
    const res = await fetch("/api/profile/me", {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    const u = data.user || {};
    if (!u || typeof u !== "object") return;

    const current = readAuthUser() || {};
    const merged = { ...(current || {}), ...u };
    localStorage.setItem("authUser", JSON.stringify(merged));
    window.dispatchEvent(new Event("authUserUpdated"));
  } catch {
    // ignore (offline or API not reachable)
  }
}

export default function NavbarTop() {
  const [authUser, setAuthUser] = useState(readAuthUser);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [notifications, setNotifications] = useState(readNotifications);
  const [notifOpen, setNotifOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastAck, setBroadcastAck] = useState(true);
  const [broadcastErr, setBroadcastErr] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [notificationMenuStyle, setNotificationMenuStyle] = useState({
    position: "fixed",
    top: 56,
    left: 12,
    width: 320,
    maxWidth: "calc(100vw - 24px)",
    zIndex: 2000
  });

  const notifWrapperRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    const token = localStorage.getItem("authToken") || "";
    if (!token) {
      setNotifications([]);
      return;
    }

    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const local = readVisibleLocalNotifications(readAuthUser());
      const remote = Array.isArray(data.notifications) ? data.notifications : [];
      setNotifications([...local, ...remote]);
    } catch {
      setNotifications(readVisibleLocalNotifications(readAuthUser()));
    }
  }, []);

  useEffect(() => {
    const syncAuth = () => {
      const user = readAuthUser();
      setAuthUser(user);
      checkOfflineTokenNotifications(user);
      setNotifications(readVisibleLocalNotifications(user));
    };

    window.addEventListener("authUserUpdated", syncAuth);
    window.addEventListener("notificationsUpdated", loadNotifications);

    const onStorage = (e) => {
      if (e.key === "authUser" || e.key === "authToken") syncAuth();
    };
    window.addEventListener("storage", onStorage);

    refreshAuthUserFromApi();
    checkOfflineTokenNotifications(readAuthUser());
    loadNotifications();
    const timer = window.setInterval(() => {
      checkOfflineTokenNotifications(readAuthUser());
      loadNotifications();
    }, 30000);

    return () => {
      window.removeEventListener("authUserUpdated", syncAuth);
      window.removeEventListener("notificationsUpdated", loadNotifications);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, [loadNotifications]);

  const displayName = authUser?.name || authUser?.email || "User";
  const role = String(authUser?.role || "").toUpperCase() || "USER";
  const photoUrl = String(authUser?.photoUrl || "").trim();

  useEffect(() => {
    setAvatarFailed(false);
  }, [photoUrl]);

  const initials = getInitials(displayName);
  const showImage = !!photoUrl && !avatarFailed;
  const size = 36;

  const canSendBroadcast = role === "ADMIN" || role === "L3";

  const visibleNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
  }, [notifications]);

  const unreadCount = useMemo(() => {
    return visibleNotifications.filter((n) => !n.read).length;
  }, [visibleNotifications]);

  const hasClearableNotifications = useMemo(() => {
    return visibleNotifications.some((n) => !(n.requiresAck && !n.acknowledged));
  }, [visibleNotifications]);

  async function notificationPost(path) {
    const token = localStorage.getItem("authToken") || "";
    if (!token) return;
    try {
      const res = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      await loadNotifications();
      window.dispatchEvent(new CustomEvent("notificationsUpdated", { detail: data }));
      if (data?.relatedTask || String(data?.notification?.relatedEntityType || "") === "daily_planner_task") {
        window.dispatchEvent(new CustomEvent("dailyPlannerUpdated", { detail: data }));
      }
    } catch {
      // ignore transient notification errors
    }
  }

  async function markNotificationRead(notificationId) {
    if (String(notificationId || "").startsWith("offline_token_")) {
      updateLocalNotification(notificationId, { read: true });
      setNotifications(readVisibleLocalNotifications(readAuthUser()));
      return;
    }
    await notificationPost(`/api/notifications/${encodeURIComponent(notificationId)}/read`);
  }

  async function markAllNotificationsRead() {
    visibleNotifications.forEach((n) => {
      if (n?.local) updateLocalNotification(n.id, { read: true });
    });
    await notificationPost("/api/notifications/read-all");
  }

  async function acknowledgeNotification(notificationId) {
    if (String(notificationId || "").startsWith("offline_token_")) {
      updateLocalNotification(notificationId, { read: true, acknowledged: true, acknowledgementCount: 1 });
      setNotifications(readVisibleLocalNotifications(readAuthUser()));
      return;
    }
    await notificationPost(`/api/notifications/${encodeURIComponent(notificationId)}/ack`);
  }

  async function clearAllNotifications() {
    clearVisibleLocalNotifications();
    await notificationPost("/api/notifications/clear-visible");
  }

  async function sendBroadcastNotification(e) {
    e.preventDefault();
    const token = localStorage.getItem("authToken") || "";
    if (!token || broadcastSending) return;
    setBroadcastErr("");
    setBroadcastSending(true);
    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: broadcastTitle, message: broadcastMessage, requiresAck: broadcastAck })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBroadcastErr(data?.message || "Notification could not be sent.");
        return;
      }
      setBroadcastTitle("");
      setBroadcastMessage("");
      setBroadcastAck(true);
      setBroadcastOpen(false);
      await loadNotifications();
    } catch {
      setBroadcastErr("Notification could not be sent (API not reachable).");
    } finally {
      setBroadcastSending(false);
    }
  }

  function updateNotificationMenuPosition() {
    const el = notifWrapperRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const horizontalMargin = 8;
    const verticalGap = 8;
    const desiredWidth = 380;

    const availableWidth = Math.max(220, viewportWidth - horizontalMargin * 2);
    const width = Math.min(desiredWidth, availableWidth);

    const idealLeft = rect.right - width;
    const clampedLeft = Math.max(
      horizontalMargin,
      Math.min(idealLeft, viewportWidth - width - horizontalMargin)
    );

    const top = Math.max(horizontalMargin, rect.bottom + verticalGap);
    const maxHeight = Math.max(180, viewportHeight - top - horizontalMargin);

    setNotificationMenuStyle({
      position: "fixed",
      top,
      left: clampedLeft,
      width,
      minWidth: 0,
      maxWidth: `calc(100vw - ${horizontalMargin * 2}px)`,
      boxSizing: "border-box",
      overflowX: "hidden",
      zIndex: 2000,
      maxHeight
    });
  }

  useEffect(() => {
    if (!notifOpen) return;

    updateNotificationMenuPosition();

    const handleViewportChange = () => updateNotificationMenuPosition();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [notifOpen]);

  function handleLogout() {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    window.dispatchEvent(new Event("authUserUpdated"));
    window.location.hash = Routes.Signin.path;
  }

  function handleNotificationToggle(isOpen) {
    setNotifOpen(!!isOpen);
    if (isOpen) {
      loadNotifications();
      window.setTimeout(() => {
        updateNotificationMenuPosition();
      }, 0);
    }
  }

  return (
    <Navbar expand="lg" className="navbar-top navbar-expand navbar-dashboard navbar-dark ps-0 pe-2 pb-0">
      <Container fluid className="px-0">
        <div className="d-flex justify-content-between w-100">
          <Nav className="align-items-center ms-auto">
            {/* Notifications */}
            <div ref={notifWrapperRef}>
              <Dropdown as={Nav.Item} className="me-3" onToggle={handleNotificationToggle}>
                <Dropdown.Toggle
                  as={Nav.Link}
                  className="pt-1 px-0 position-relative text-dark"
                  style={{ minWidth: 36 }}
                >
                  <FontAwesomeIcon icon={faBell} size="lg" />
                  {unreadCount > 0 ? (
                    <Badge
                      bg="danger"
                      pill
                      className="position-absolute"
                      style={{
                        top: -2,
                        right: -10,
                        fontSize: 10,
                        minWidth: 18
                      }}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  ) : null}
                </Dropdown.Toggle>

                <Dropdown.Menu
                  className="dropdown-menu-lg mt-2 py-0"
                  align={false}
                  style={{ ...notificationMenuStyle, transform: "none" }}
                >
                  <div className="p-3 border-bottom">
                    <div className="d-flex justify-content-between align-items-start" style={{ gap: 12 }}>
                      <span className="fw-bold mb-0">Notifications</span>
                      {visibleNotifications.length ? (
                        <div className="d-flex align-items-center flex-wrap justify-content-end" style={{ gap: 10 }}>
                          <ButtonLikeLink onClick={markAllNotificationsRead}>Mark all read</ButtonLikeLink>
                          {hasClearableNotifications ? (
                            <ButtonLikeLink onClick={clearAllNotifications}>Clear all</ButtonLikeLink>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {canSendBroadcast ? (
                      <div className="mt-2">
                        <ButtonLikeLink onClick={() => { setBroadcastOpen(!broadcastOpen); setBroadcastErr(""); }}>
                          {broadcastOpen ? "Close message form" : "Send message to all users"}
                        </ButtonLikeLink>

                        {broadcastOpen ? (
                          <form onSubmit={sendBroadcastNotification} className="mt-2">
                            {broadcastErr ? <div className="text-danger small mb-2">{broadcastErr}</div> : null}
                            <input
                              className="form-control form-control-sm mb-2"
                              placeholder="Notification title"
                              value={broadcastTitle}
                              onChange={(e) => setBroadcastTitle(e.target.value)}
                              maxLength={120}
                              disabled={broadcastSending}
                            />
                            <textarea
                              className="form-control form-control-sm mb-2"
                              placeholder="Message to all users"
                              rows={3}
                              value={broadcastMessage}
                              onChange={(e) => setBroadcastMessage(e.target.value)}
                              maxLength={1000}
                              disabled={broadcastSending}
                            />
                            <label className="small d-flex align-items-center mb-2" style={{ gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={broadcastAck}
                                onChange={(e) => setBroadcastAck(e.target.checked)}
                                disabled={broadcastSending}
                              />
                              Require acknowledgement
                            </label>
                            <button type="submit" className="btn btn-sm btn-primary" disabled={broadcastSending || !broadcastTitle.trim() || !broadcastMessage.trim()}>
                              {broadcastSending ? "Sending…" : "Send notification"}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ maxHeight: notificationMenuStyle.maxHeight ? notificationMenuStyle.maxHeight - 64 : 360, overflowY: "auto", overflowX: "hidden", maxWidth: "100%" }}>
                    {!visibleNotifications.length ? (
                      <div className="p-3 text-muted small">No notifications.</div>
                    ) : (
                      visibleNotifications.map((n) => {
                        const isRead = !!n.read;
                        const needsAck = !!n.requiresAck && !n.acknowledged;
                        const severity = String(n.severity || "info").toLowerCase();
                        const accent = severity === "danger" ? "#dc3545" : severity === "warning" ? "#ffc107" : severity === "success" ? "#198754" : "#0d6efd";

                        return (
                          <div
                            key={n.id}
                            className="px-3 py-2 border-bottom"
                            style={{
                              background: isRead && !needsAck ? "#fff" : "rgba(13, 110, 253, 0.06)",
                              borderLeft: `4px solid ${accent}`,
                              maxWidth: "100%",
                              minWidth: 0,
                              boxSizing: "border-box",
                              overflow: "hidden"
                            }}
                          >
                            <div className="d-flex justify-content-between align-items-start" style={{ gap: 10, minWidth: 0, maxWidth: "100%" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="fw-bold text-dark" style={{ fontSize: 14, wordBreak: "break-word", overflowWrap: "anywhere" }}>
                                  {n.title || "Notification"}
                                </div>
                                {n.message ? (
                                  <div className="small text-dark" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>{n.message}</div>
                                ) : null}
                                <div className="text-muted small mt-1">
                                  {formatNotificationTime(n.createdAt)}
                                  {n.requiresAck ? ` · ${n.acknowledgementCount || 0} acknowledged` : ""}
                                </div>
                              </div>

                              {!isRead ? (
                                <ButtonLikeLink onClick={() => markNotificationRead(n.id)} title="Mark as read">
                                  <FontAwesomeIcon icon={faCheck} />
                                </ButtonLikeLink>
                              ) : null}
                            </div>

                            <div className="d-flex flex-wrap align-items-center mt-2" style={{ gap: 8, maxWidth: "100%" }}>
                              {needsAck ? (
                                <button type="button" className="btn btn-sm btn-outline-success py-0" onClick={() => acknowledgeNotification(n.id)}>
                                  <FontAwesomeIcon icon={faCheck} className="me-1" /> Acknowledge
                                </button>
                              ) : null}
                              {n.actionUrl ? (
                                <a className="small fw-bold" href={n.actionUrl} onClick={() => markNotificationRead(n.id)}>
                                  Open
                                </a>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Dropdown.Menu>
              </Dropdown>
            </div>

            {/* User menu */}
            <Dropdown as={Nav.Item}>
              <Dropdown.Toggle as={Nav.Link} className="pt-1 px-0">
                <div className="media d-flex align-items-center">
                  {showImage ? (
                    <img
                      src={photoUrl}
                      alt="Profile"
                      className="user-avatar md-avatar rounded-circle"
                      style={{
                        width: size,
                        height: size,
                        objectFit: "cover",
                        border: "1px solid rgba(0,0,0,0.08)"
                      }}
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    <div
                      className="user-avatar md-avatar rounded-circle d-flex align-items-center justify-content-center"
                      style={{
                        width: size,
                        height: size,
                        fontSize: 12,
                        fontWeight: 700,
                        background: "rgba(0,0,0,0.06)",
                        border: "1px solid rgba(0,0,0,0.08)",
                        color: "rgba(0,0,0,0.75)",
                        userSelect: "none"
                      }}
                      title={displayName}
                      aria-label={`Avatar ${initials}`}
                    >
                      {initials}
                    </div>
                  )}

                  <div className="media-body ms-2 text-dark align-items-center d-none d-lg-block">
                    <span className="mb-0 font-small fw-bold">
                      {displayName}{" "}
                      <span className="text-muted" style={{ fontWeight: 600 }}>
                        ({role})
                      </span>
                    </span>
                  </div>
                </div>
              </Dropdown.Toggle>

              <Dropdown.Menu className="user-dropdown dropdown-menu-right mt-2">
                <Dropdown.Item as={Link} to={Routes.Settings.path} className="fw-bold">
                  <FontAwesomeIcon icon={faUserCircle} className="me-2" />
                  My Profile
                </Dropdown.Item>

                <Dropdown.Item as={Link} to={Routes.Settings.path} className="fw-bold">
                  <FontAwesomeIcon icon={faCog} className="me-2" />
                  Settings
                </Dropdown.Item>

                <Dropdown.Divider />

                <Dropdown.Item className="fw-bold" onClick={handleLogout}>
                  <FontAwesomeIcon icon={faSignOutAlt} className="me-2" />
                  Logout
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </Nav>
        </div>
      </Container>
    </Navbar>
  );
}

function ButtonLikeLink({ children, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        color: "#0d6efd",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}
