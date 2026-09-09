import React, { useEffect, useMemo, useRef, useState } from "react";
import { Nav, Navbar, Dropdown, Container, Badge } from "@themesberg/react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCog, faSignOutAlt, faBell, faCheck } from "@fortawesome/free-solid-svg-icons";
import { faUserCircle } from "@fortawesome/free-regular-svg-icons";
import { Link } from "react-router-dom";

import { Routes } from "../routes";

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
  const raw = safeJsonParse(localStorage.getItem("appNotifications") || "[]", []);
  return Array.isArray(raw) ? raw : [];
}

function writeNotifications(items) {
  localStorage.setItem("appNotifications", JSON.stringify(Array.isArray(items) ? items : []));
  window.dispatchEvent(new Event("notificationsUpdated"));
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

function isNotificationVisibleToUser(notification, authUser) {
  if (!notification || typeof notification !== "object") return false;

  if (notification.global === true) return true;

  const currentEmail = String(authUser?.email || "").trim().toLowerCase();
  const targetEmail = String(notification.userEmail || "").trim().toLowerCase();

  return !!currentEmail && !!targetEmail && currentEmail === targetEmail;
}

function isNotificationReadByUser(notification, authUser) {
  const currentEmail = String(authUser?.email || "").trim().toLowerCase();
  const readBy = Array.isArray(notification?.readBy) ? notification.readBy : [];
  return readBy.map((x) => String(x || "").trim().toLowerCase()).includes(currentEmail);
}

function markNotificationRead(notificationId, authUser) {
  const currentEmail = String(authUser?.email || "").trim().toLowerCase();
  if (!currentEmail) return;

  const items = readNotifications();
  const next = items.map((n) => {
    if (String(n?.id || "") !== String(notificationId || "")) return n;

    const readBy = Array.isArray(n?.readBy) ? [...n.readBy] : [];
    const hasAlready = readBy.map((x) => String(x || "").trim().toLowerCase()).includes(currentEmail);

    if (!hasAlready) readBy.push(currentEmail);

    return { ...n, readBy };
  });

  writeNotifications(next);
}

function markAllNotificationsRead(authUser) {
  const currentEmail = String(authUser?.email || "").trim().toLowerCase();
  if (!currentEmail) return;

  const items = readNotifications();
  const next = items.map((n) => {
    if (!isNotificationVisibleToUser(n, authUser)) return n;

    const readBy = Array.isArray(n?.readBy) ? [...n.readBy] : [];
    const hasAlready = readBy.map((x) => String(x || "").trim().toLowerCase()).includes(currentEmail);

    if (!hasAlready) readBy.push(currentEmail);

    return { ...n, readBy };
  });

  writeNotifications(next);
}

function clearAllReadNotifications(authUser) {
  const currentEmail = String(authUser?.email || "").trim().toLowerCase();
  if (!currentEmail) return;

  const items = readNotifications();
  const next = items.filter((n) => {
    if (!isNotificationVisibleToUser(n, authUser)) return true;
    return !isNotificationReadByUser(n, authUser);
  });

  writeNotifications(next);
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
  const [notificationMenuStyle, setNotificationMenuStyle] = useState({
    position: "fixed",
    top: 56,
    left: 12,
    width: 320,
    maxWidth: "calc(100vw - 24px)",
    zIndex: 2000
  });

  const notifWrapperRef = useRef(null);

  useEffect(() => {
    const syncAuth = () => setAuthUser(readAuthUser());
    const syncNotifications = () => setNotifications(readNotifications());

    window.addEventListener("authUserUpdated", syncAuth);
    window.addEventListener("notificationsUpdated", syncNotifications);

    const onStorage = (e) => {
      if (e.key === "authUser" || e.key === "authToken") syncAuth();
      if (e.key === "appNotifications") syncNotifications();
    };
    window.addEventListener("storage", onStorage);

    refreshAuthUserFromApi();
    syncNotifications();

    return () => {
      window.removeEventListener("authUserUpdated", syncAuth);
      window.removeEventListener("notificationsUpdated", syncNotifications);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const displayName = authUser?.name || authUser?.email || "User";
  const role = String(authUser?.role || "").toUpperCase() || "USER";
  const photoUrl = String(authUser?.photoUrl || "").trim();

  useEffect(() => {
    setAvatarFailed(false);
  }, [photoUrl]);

  const initials = getInitials(displayName);
  const showImage = !!photoUrl && !avatarFailed;
  const size = 36;

  const visibleNotifications = useMemo(() => {
    return [...notifications]
      .filter((n) => isNotificationVisibleToUser(n, authUser))
      .sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
  }, [notifications, authUser]);

  const unreadCount = useMemo(() => {
    return visibleNotifications.filter((n) => !isNotificationReadByUser(n, authUser)).length;
  }, [visibleNotifications, authUser]);

  const hasReadNotifications = useMemo(() => {
    return visibleNotifications.some((n) => isNotificationReadByUser(n, authUser));
  }, [visibleNotifications, authUser]);

  function updateNotificationMenuPosition() {
    const el = notifWrapperRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const horizontalMargin = 12;
    const verticalGap = 8;
    const desiredWidth = 380;
    const minWidth = 280;

    const availableWidth = Math.max(minWidth, viewportWidth - horizontalMargin * 2);
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
      minWidth: Math.min(minWidth, availableWidth),
      maxWidth: viewportWidth - horizontalMargin * 2,
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
                  style={notificationMenuStyle}
                >
                  <div className="p-3 border-bottom d-flex justify-content-between align-items-center" style={{ gap: 12 }}>
                    <span className="fw-bold mb-0">Notifications</span>
                    {visibleNotifications.length ? (
                      <div className="d-flex align-items-center flex-wrap justify-content-end" style={{ gap: 10 }}>
                        <ButtonLikeLink onClick={() => markAllNotificationsRead(authUser)}>
                          Mark all read
                        </ButtonLikeLink>
                        {hasReadNotifications ? (
                          <ButtonLikeLink onClick={() => clearAllReadNotifications(authUser)}>
                            Clear all read
                          </ButtonLikeLink>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ maxHeight: notificationMenuStyle.maxHeight ? notificationMenuStyle.maxHeight - 64 : 360, overflowY: "auto" }}>
                    {!visibleNotifications.length ? (
                      <div className="p-3 text-muted small">No notifications.</div>
                    ) : (
                      visibleNotifications.map((n) => {
                        const isRead = isNotificationReadByUser(n, authUser);

                        return (
                          <div
                            key={n.id}
                            className="px-3 py-2 border-bottom"
                            style={{
                              background: isRead ? "#fff" : "rgba(13, 110, 253, 0.06)"
                            }}
                          >
                            <div className="d-flex justify-content-between align-items-start" style={{ gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  className="fw-bold text-dark"
                                  style={{ fontSize: 14, wordBreak: "break-word", overflowWrap: "anywhere" }}
                                >
                                  {n.message || "Notification"}
                                </div>
                                <div className="text-muted small">
                                  {formatNotificationTime(n.createdAt)}
                                </div>
                              </div>

                              {!isRead ? (
                                <ButtonLikeLink onClick={() => markNotificationRead(n.id, authUser)} title="Mark as read">
                                  <FontAwesomeIcon icon={faCheck} />
                                </ButtonLikeLink>
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