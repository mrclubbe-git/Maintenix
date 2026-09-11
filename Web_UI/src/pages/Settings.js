import React, { useEffect, useMemo, useRef, useState } from "react";
import { Col, Row, Card, Form, Button, Image, Alert, Spinner, Table, InputGroup } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../routes";
import Profile3 from "../assets/img/team/profile-picture-3.jpg";
import { clearOfflineModeCache, notifyOfflineTokenLoaded, storeOfflineSession, warmOfflineMode } from "../offlineMode";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function safeRole(x) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export default function Settings() {
  const authToken = localStorage.getItem("authToken") || "";
  const storedUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);

  const storedUserId = storedUser?.id || ""; // optional, depends on your auth payload

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [warmingOffline, setWarmingOffline] = useState(false);
  const [clearingOfflineCache, setClearingOfflineCache] = useState(false);

  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [offlineMsg, setOfflineMsg] = useState("");

  const [profile, setProfile] = useState({
    name: storedUser?.name || "",
    email: storedUser?.email || "",
    role: storedUser?.role || "",
    status: storedUser?.status || "",
    photoUrl: storedUser?.photoUrl || ""
  });

  // Guard all reads to avoid “blank screen” if state gets corrupted
  const safeProfile =
    profile && typeof profile === "object"
      ? profile
      : { name: "", email: "", role: "", status: "", photoUrl: "" };

  const isAdmin = useMemo(() => safeRole(safeProfile.role) === "ADMIN", [safeProfile.role]);

  const fileInputRef = useRef(null);
  const avatarSrc = safeProfile.photoUrl ? safeProfile.photoUrl : Profile3;

  async function loadProfile() {
    if (!authToken) return;

    setLoadingProfile(true);
    setErr("");
    try {
      const res = await fetch("/api/profile/me", {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Failed to load profile (HTTP ${res.status}).`);
        setLoadingProfile(false);
        return;
      }

      const u = data.user || {};
      setProfile((p) => ({
        ...(p && typeof p === "object" ? p : {}),
        name: u.name || "",
        email: u.email || "",
        role: u.role || "",
        status: u.status || "",
        photoUrl: u.photoUrl || ""
      }));

      // Keep localStorage authUser in sync
      const merged = { ...(storedUser || {}), ...u };
      localStorage.setItem("authUser", JSON.stringify(merged));
      window.dispatchEvent(new Event("authUserUpdated"));

      setLoadingProfile(false);
    } catch {
      setErr("Failed to load profile (API not reachable).");
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openFilePicker() {
    setOkMsg("");
    setErr("");
    if (fileInputRef.current) fileInputRef.current.click();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function onPickFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
      setErr("Please select an image file.");
      return;
    }

    // NOTE: If you increased backend upload size, update this too.
    // For now, keep at 2MB as per your current UI copy.
    if (file.size > 4 * 1024 * 1024) {
      setErr("Image too large (max 2MB). Please choose a smaller image.");
      return;
    }

    setSavingPhoto(true);
    setErr("");
    setOkMsg("");

    try {
      const dataUrl = await fileToDataUrl(file);

      const res = await fetch("/api/profile/photo", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ dataUrl })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Upload failed (HTTP ${res.status}).`);
        setSavingPhoto(false);
        return;
      }

      const newUrl = data.photoUrl || "";
      setProfile((p) => ({ ...(p && typeof p === "object" ? p : {}), photoUrl: newUrl }));

      // Update localStorage authUser
      const current = safeJsonParse(localStorage.getItem("authUser") || "null", {});
      localStorage.setItem("authUser", JSON.stringify({ ...(current || {}), photoUrl: newUrl }));
      window.dispatchEvent(new Event("authUserUpdated"));

      setOkMsg("Profile photo updated.");
      setSavingPhoto(false);
    } catch {
      setErr("Upload failed (API not reachable).");
      setSavingPhoto(false);
    } finally {
      // allow re-picking the same file
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveName() {
    const name = String(safeProfile.name || "").trim();
    if (!name) {
      setErr("Name cannot be empty.");
      return;
    }

    setSavingName(true);
    setErr("");
    setOkMsg("");

    try {
      const res = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ name })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.message || `Save failed (HTTP ${res.status}).`);
        setSavingName(false);
        return;
      }

      const u = data.user || {};
      setProfile((p) => ({ ...(p && typeof p === "object" ? p : {}), name: u.name || name }));

      // Update localStorage authUser
      const current = safeJsonParse(localStorage.getItem("authUser") || "null", {});
      localStorage.setItem("authUser", JSON.stringify({ ...(current || {}), ...u }));
      window.dispatchEvent(new Event("authUserUpdated"));

      setOkMsg("Name updated.");
      setSavingName(false);
    } catch {
      setErr("Save failed (API not reachable).");
      setSavingName(false);
    }
  }

  async function prepareOfflineMode() {
    if (!authToken) {
      setErr("Not logged in.");
      return;
    }

    setWarmingOffline(true);
    setErr("");
    setOkMsg("");
    setOfflineMsg("");

    try {
      const summary = await warmOfflineMode(authToken);
      const currentUser = safeJsonParse(localStorage.getItem("authUser") || "null", storedUser || {});
      const ttlMs = 7 * 24 * 60 * 60 * 1000;
      storeOfflineSession(authToken, currentUser, ttlMs);
      notifyOfflineTokenLoaded(currentUser);

      const cached = summary.cached.length ? summary.cached.join(", ") : "offline data";
      const failed = summary.failed.length ? ` Some items could not be refreshed: ${summary.failed.join(", ")}.` : "";
      setOfflineMsg(`Offline mode prepared. Cached: ${cached}.${failed}`);
    } catch (e) {
      setErr(String(e?.message || "Failed to prepare offline mode."));
    } finally {
      setWarmingOffline(false);
    }
  }

  async function clearOfflineCache() {
    const confirmed = window.confirm(
      "Clear offline cache on this device?\n\nThis removes prepared offline data and the 7 day offline token, but keeps queued jobs."
    );
    if (!confirmed) return;

    setClearingOfflineCache(true);
    setErr("");
    setOkMsg("");
    setOfflineMsg("");

    try {
      const cleared = await clearOfflineModeCache();
      setOfflineMsg(`Offline cache cleared: ${cleared.join(", ")}.`);
    } catch (e) {
      setErr(String(e?.message || "Failed to clear offline cache."));
    } finally {
      setClearingOfflineCache(false);
    }
  }

  // ------------------------------------------------------------
  // Admin widget: user management
  // ------------------------------------------------------------
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminErr, setAdminErr] = useState("");
  const [adminOk, setAdminOk] = useState("");
  const [adminQuery, setAdminQuery] = useState("");
  const [adminBusyId, setAdminBusyId] = useState(""); // per-row busy lock

  async function loadAdminUsers() {
    if (!isAdmin) return;
    if (!authToken) return;

    setAdminLoading(true);
    setAdminErr("");
    setAdminOk("");
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminErr(data?.message || `Failed to load users (HTTP ${res.status}).`);
        setAdminUsers([]);
        setAdminLoading(false);
        return;
      }

      setAdminUsers(Array.isArray(data.users) ? data.users : []);
      setAdminLoading(false);
    } catch {
      setAdminErr("Failed to load users (API not reachable).");
      setAdminUsers([]);
      setAdminLoading(false);
    }
  }

  async function setUserRole(userId, role) {
    if (!authToken) return;
    if (!isAdmin) return;

    const nextRole = safeRole(role);
    if (!["ADMIN", "L1", "L2", "L3"].includes(nextRole)) return;

    setAdminBusyId(userId);
    setAdminErr("");
    setAdminOk("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ role: nextRole })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminErr(data?.message || `Role update failed (HTTP ${res.status}).`);
        setAdminBusyId("");
        return;
      }

      setAdminOk("Role updated.");
      // Update list in-place
      setAdminUsers((prev) =>
        prev.map((u) => (String(u.id) === String(userId) ? { ...u, role: data?.user?.role || nextRole } : u))
      );
      setAdminBusyId("");
    } catch {
      setAdminErr("Role update failed (API not reachable).");
      setAdminBusyId("");
    }
  }

  async function removeUser(userId) {
    if (!authToken) return;
    if (!isAdmin) return;

    const u = adminUsers.find((x) => String(x.id) === String(userId));
    const label = u?.email || u?.name || userId;

    // confirm
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Remove user: ${label} ?\n\nThis will delete the user from users.json.`);
    if (!ok) return;

    setAdminBusyId(userId);
    setAdminErr("");
    setAdminOk("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminErr(data?.message || `Remove failed (HTTP ${res.status}).`);
        setAdminBusyId("");
        return;
      }

      setAdminOk("User removed.");
      setAdminUsers((prev) => prev.filter((x) => String(x.id) !== String(userId)));
      setAdminBusyId("");
    } catch {
      setAdminErr("Remove failed (API not reachable).");
      setAdminBusyId("");
    }
  }

  useEffect(() => {
    // Load only when admin + token available
    if (!isAdmin) return;
    if (!authToken) return;
    loadAdminUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, authToken]);

  const filteredAdminUsers = useMemo(() => {
    const q = String(adminQuery || "").trim().toLowerCase();
    if (!q) return adminUsers;

    return adminUsers.filter((u) => {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.name || "").toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  }, [adminUsers, adminQuery]);

  // ------------------------------------------------------------

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <h4 className="mb-0">Settings</h4>
      </div>

      {err ? <Alert variant="danger">{err}</Alert> : null}
      {okMsg ? <Alert variant="success">{okMsg}</Alert> : null}
      {offlineMsg ? <Alert variant="success">{offlineMsg}</Alert> : null}

      <Row className="g-4">
        <Col xs={12} xl={4}>
          <Card border="light" className="shadow-sm mb-4">
            <Card.Body className="text-center">
              <Image
                src={avatarSrc}
                onError={(ev) => {
                  ev.currentTarget.src = Profile3;
                }}
                className="user-avatar xl-avatar mb-3 rounded-circle"
              />

              <h5 className="mb-1 text-break">{safeProfile.name || safeProfile.email || "User"}</h5>

              <div className="text-muted small text-break">
                {safeProfile.role ? String(safeProfile.role).toUpperCase() : "USER"}
                {safeProfile.status ? ` • ${safeProfile.status}` : ""}
              </div>

              <div className="mt-3">
                <Button variant="primary" size="sm" onClick={openFilePicker} disabled={savingPhoto || loadingProfile}>
                  {savingPhoto ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Uploading…
                    </>
                  ) : (
                    "Change photo"
                  )}
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={onPickFile}
                />
              </div>

              <div className="text-muted small mt-2">PNG / JPG / WEBP • Max 2MB</div>
            </Card.Body>
          </Card>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header>
              <h5 className="mb-0">Offline Mode</h5>
            </Card.Header>
            <Card.Body>
              <p className="text-muted small mb-3">
                Cache servicing areas, services, and checklists on this device before going onsite.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Button variant="outline-primary" size="sm" onClick={prepareOfflineMode} disabled={warmingOffline || loadingProfile}>
                  {warmingOffline ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Preparing…
                    </>
                  ) : (
                    "Prepare Offline Mode"
                  )}
                </Button>
                <Button variant="outline-danger" size="sm" onClick={clearOfflineCache} disabled={clearingOfflineCache || warmingOffline}>
                  {clearingOfflineCache ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Clearing…
                    </>
                  ) : (
                    "Clear Offline Cache"
                  )}
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col xs={12} xl={8}>
          <Card border="light" className="shadow-sm mb-4">
            <Card.Header className="d-flex flex-wrap justify-content-between align-items-center gap-2">
              <h5 className="mb-0">Profile</h5>

              <Button as={Link} to={Routes.ResetPassword.path} variant="outline-primary" size="sm">
                Reset password
              </Button>
            </Card.Header>

            <Card.Body>
              <Form>
                <Row className="mb-3">
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Name</Form.Label>
                      <Form.Control
                        type="text"
                        value={safeProfile.name}
                        onChange={(e) => {
                          const value = e.target.value; // capture before event pooling clears it
                          setProfile((p) => ({
                            ...(p && typeof p === "object" ? p : {}),
                            name: value
                          }));
                        }}
                        disabled={loadingProfile}
                      />
                    </Form.Group>
                  </Col>

                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Email</Form.Label>
                      <Form.Control type="email" value={safeProfile.email} disabled />
                    </Form.Group>
                  </Col>
                </Row>

                <Row className="mb-3">
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Role</Form.Label>
                      <Form.Control value={String(safeProfile.role || "").toUpperCase()} disabled />
                    </Form.Group>
                  </Col>

                  <Col md={6}>
                    <Form.Group>
                      <Form.Label>Status</Form.Label>
                      <Form.Control value={safeProfile.status || ""} disabled />
                    </Form.Group>
                  </Col>
                </Row>

                <Button variant="primary" type="button" onClick={saveName} disabled={savingName || loadingProfile}>
                  {savingName ? (
                    <>
                      <Spinner size="sm" className="me-2" /> Saving…
                    </>
                  ) : (
                    "Save name"
                  )}
                </Button>
              </Form>
            </Card.Body>
          </Card>

          {/* ✅ Admin-only User Management widget */}
          {isAdmin ? (
            <Card border="light" className="shadow-sm mb-4">
              <Card.Header className="d-flex flex-wrap justify-content-between align-items-center gap-3">
                <div className="min-w-0">
                  <h5 className="mb-0">User Management</h5>
                  <small className="text-muted">Admins can change roles and remove users</small>
                </div>

                <div className="d-flex flex-wrap align-items-center justify-content-end gap-2" style={{ minWidth: 0 }}>
                  <InputGroup size="sm" style={{ width: "min(260px, 100%)" }}>
                    <Form.Control
                      placeholder="Search name or email…"
                      value={adminQuery}
                      onChange={(e) => setAdminQuery(e.target.value)}
                      disabled={adminLoading}
                    />
                  </InputGroup>

                  <Button variant="outline-primary" size="sm" onClick={loadAdminUsers} disabled={adminLoading}>
                    {adminLoading ? (
                      <>
                        <Spinner size="sm" className="me-2" /> Loading…
                      </>
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>
              </Card.Header>

              <Card.Body className="p-0">
                {adminErr ? <Alert variant="warning" className="m-3 mb-0">{adminErr}</Alert> : null}
                {adminOk ? <Alert variant="success" className="m-3 mb-0">{adminOk}</Alert> : null}

                <Table responsive className="table-centered mb-0 rounded">
                  <thead className="thead-light">
                    <tr>
                      <th className="border-0">Name</th>
                      <th className="border-0">Email</th>
                      <th className="border-0">Status</th>
                      <th className="border-0">Role</th>
                      <th className="border-0 text-end">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredAdminUsers.length === 0 ? (
                      <tr>
                        <td className="p-3 text-muted" colSpan={5}>
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      filteredAdminUsers.map((u) => {
                        const busy = adminBusyId === u.id;
                        const isSelf = storedUserId && String(u.id) === String(storedUserId);

                        return (
                          <tr key={u.id}>
                            <td className="fw-bold text-break">{u.name || "-"}</td>
                            <td className="text-break">{u.email || "-"}</td>
                            <td>{String(u.status || "").toUpperCase()}</td>
                            <td style={{ minWidth: 140 }}>
                              <Form.Select
                                size="sm"
                                value={safeRole(u.role)}
                                disabled={busy || isSelf}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setUserRole(u.id, value);
                                }}
                                title={isSelf ? "You cannot change your own role here." : "Change role"}
                              >
                                <option value="L1">L1</option>
                                <option value="L2">L2</option>
                                <option value="L3">L3</option>
                                <option value="ADMIN">ADMIN</option>
                              </Form.Select>
                            </td>
                            <td className="text-end">
                              <Button
                                size="sm"
                                variant="outline-danger"
                                disabled={busy || isSelf}
                                onClick={() => removeUser(u.id)}
                                title={isSelf ? "You cannot remove your own admin account." : "Remove user"}
                              >
                                {busy ? (
                                  <>
                                    <Spinner size="sm" className="me-2" /> Working…
                                  </>
                                ) : (
                                  "Remove"
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </Table>

                <div className="p-3 text-muted small">
                  Tip: Newly approved users default to <span className="fw-bold">L1</span>, then you can promote to{" "}
                  <span className="fw-bold">L2</span>.
                </div>
              </Card.Body>
            </Card>
          ) : null}
        </Col>
      </Row>
    </>
  );
}
