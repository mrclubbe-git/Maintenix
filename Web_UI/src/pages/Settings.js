import { clearOrgAuth, ensureOrgAuthExpiresAt, getNotificationPreferences, ORGANIZATION, orgLocalStorage, setNotificationPreferences as persistNotificationPreferences } from "../config/organization";
import React, { useEffect, useRef, useState } from "react";
import { Col, Row, Card, Form, Button, Image, Alert, Spinner } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../routes";
import { disableDevicePush, enableDevicePush, getDevicePushState, sendDevicePushTest } from "../lib/devicePush";
import Profile3 from "../assets/img/team/profile-picture-3.jpg";

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export default function Settings() {
  const authToken = orgLocalStorage.getItem("authToken") || "";
  const storedUser = safeJsonParse(orgLocalStorage.getItem("authUser") || "null", null);
  const storedUserId = String(storedUser?.id || "");

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [savingNotificationPreferences, setSavingNotificationPreferences] = useState(false);
  const [notificationPreferences, setNotificationPreferencesState] = useState(() =>
    getNotificationPreferences(storedUserId)
  );
  const [devicePushState, setDevicePushState] = useState({
    loading: true,
    supported: false,
    configured: false,
    permission: "default",
    subscribed: false
  });
  const [savingDevicePush, setSavingDevicePush] = useState(false);
  const [testingDevicePush, setTestingDevicePush] = useState(false);

  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

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
      orgLocalStorage.setItem("authUser", JSON.stringify(merged));
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

  useEffect(() => {
    let mounted = true;

    const localPreferences = getNotificationPreferences(storedUserId);
    setNotificationPreferencesState(localPreferences);

    async function loadRemotePreferences() {
      if (!authToken) return;

      try {
        const res = await fetch("/api/profile/preferences", {
          headers: { Authorization: `Bearer ${authToken}` }
        });

        // Until the server-side preference endpoint is installed, keep using
        // the organization-scoped per-user browser preference without error.
        if (res.status === 404) return;

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !mounted) return;

        const remote = data?.preferences?.notifications;
        if (!remote || typeof remote !== "object") return;

        const next = persistNotificationPreferences(storedUserId, remote);
        if (mounted) setNotificationPreferencesState(next);
      } catch {
        // Browser-cached preferences remain available when the API is offline.
      }
    }

    loadRemotePreferences();

    return () => {
      mounted = false;
    };
  }, [authToken, storedUserId]);

  async function updateNotificationPreferences(patch) {
    const next = persistNotificationPreferences(storedUserId, patch);
    setNotificationPreferencesState(next);

    if (!authToken) return;

    setSavingNotificationPreferences(true);
    try {
      const res = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ notifications: next })
      });

      if (res.status === 404) return;

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const remote = data?.preferences?.notifications;
      if (remote && typeof remote === "object") {
        const confirmed = persistNotificationPreferences(storedUserId, remote);
        setNotificationPreferencesState(confirmed);
      }
    } catch {
      // Keep the locally saved preference if the API cannot be reached.
    } finally {
      setSavingNotificationPreferences(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function refreshDevicePushState() {
      try {
        const state = await getDevicePushState(authToken);
        if (mounted) setDevicePushState({ ...state, loading: false });
      } catch {
        if (mounted) {
          setDevicePushState((current) => ({ ...current, loading: false }));
        }
      }
    }

    refreshDevicePushState();

    return () => {
      mounted = false;
    };
  }, [authToken]);

  async function updateDevicePush(enabled) {
    if (!authToken || savingDevicePush) return;

    setSavingDevicePush(true);
    setErr("");
    setOkMsg("");

    try {
      const state = enabled
        ? await enableDevicePush(authToken)
        : await disableDevicePush(authToken);

      setDevicePushState({ ...state, loading: false });
      setOkMsg(
        enabled
          ? "Device notifications enabled on this device."
          : "Device notifications disabled on this device."
      );
    } catch (error) {
      setErr(String(error?.message || "Unable to update device notifications."));
      try {
        const state = await getDevicePushState(authToken);
        setDevicePushState({ ...state, loading: false });
      } catch {}
    } finally {
      setSavingDevicePush(false);
    }
  }

  async function testDevicePush() {
    if (!authToken || testingDevicePush) return;

    setTestingDevicePush(true);
    setErr("");
    setOkMsg("");

    try {
      const result = await sendDevicePushTest(authToken);
      setOkMsg(
        result?.sent > 1
          ? `Test notification sent to ${result.sent} registered devices.`
          : "Test device notification sent."
      );
    } catch (error) {
      setErr(String(error?.message || "Unable to send the test device notification."));
    } finally {
      setTestingDevicePush(false);
    }
  }

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
    if (file.size > 2 * 1024 * 1024) {
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
      const current = safeJsonParse(orgLocalStorage.getItem("authUser") || "null", {});
      orgLocalStorage.setItem("authUser", JSON.stringify({ ...(current || {}), photoUrl: newUrl }));
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
      const current = safeJsonParse(orgLocalStorage.getItem("authUser") || "null", {});
      orgLocalStorage.setItem("authUser", JSON.stringify({ ...(current || {}), ...u }));
      window.dispatchEvent(new Event("authUserUpdated"));

      setOkMsg("Name updated.");
      setSavingName(false);
    } catch {
      setErr("Save failed (API not reachable).");
      setSavingName(false);
    }
  }

  function handleSignOut() {
    clearOrgAuth();
    window.location.hash = Routes.Signin.path;
  }

  const [sessionRemainingMs, setSessionRemainingMs] = useState(() => {
    const expiresAt = ensureOrgAuthExpiresAt();
    return Math.max(0, expiresAt - Date.now());
  });

  useEffect(() => {
    function updateSessionCountdown() {
      const expiresAt = ensureOrgAuthExpiresAt();
      setSessionRemainingMs(Math.max(0, expiresAt - Date.now()));
    }

    updateSessionCountdown();
    const timer = window.setInterval(updateSessionCountdown, 1000);

    return () => window.clearInterval(timer);
  }, []);

  function formatSessionCountdown(ms) {
    const totalMinutes = Math.ceil(Math.max(0, Number(ms) || 0) / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const sessionCountdown = formatSessionCountdown(sessionRemainingMs);

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center py-4">
        <div>
          <h4 className="mb-1">My Settings</h4>
          <div className="text-muted">Manage your CRA profile and account security.</div>
        </div>
      </div>

      {err ? <Alert variant="danger">{err}</Alert> : null}
      {okMsg ? <Alert variant="success">{okMsg}</Alert> : null}

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

              <div className="text-muted small text-break">{safeProfile.email || ""}</div>
              <div className="text-muted small text-break mt-1">
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
        </Col>

        <Col xs={12} xl={8}>
          <Card border="light" className="shadow-sm mb-4">
            <Card.Header>
              <h5 className="mb-0">Profile</h5>
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
                          const value = e.target.value;
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
                      <Form.Label>Organization</Form.Label>
                      <Form.Control value={`${ORGANIZATION.name} (${ORGANIZATION.code})`} disabled />
                    </Form.Group>
                  </Col>

                  <Col md={3}>
                    <Form.Group>
                      <Form.Label>Role</Form.Label>
                      <Form.Control value={String(safeProfile.role || "").toUpperCase()} disabled />
                    </Form.Group>
                  </Col>

                  <Col md={3}>
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
                    "Save changes"
                  )}
                </Button>
              </Form>
            </Card.Body>
          </Card>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header>
              <h5 className="mb-0">Security</h5>
            </Card.Header>

            <Card.Body>
              <div className="mb-4">
                <div className="fw-bold">Session expiry</div>
                <div className="text-muted small">
                  Your session will expire in{" "}
                  <span className="fw-bold text-dark" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {sessionCountdown} hours
                  </span>.
                </div>
              </div>

              <div className="d-flex flex-wrap gap-2">
                <Button as={Link} to={Routes.ResetPassword.path} variant="outline-primary">
                  Change password
                </Button>
                <Button type="button" variant="outline-danger" onClick={handleSignOut}>
                  Sign out now
                </Button>
              </div>
            </Card.Body>
          </Card>

          <Card border="light" className="shadow-sm mb-4">
            <Card.Header>
              <h5 className="mb-0">Notifications</h5>
            </Card.Header>

            <Card.Body>
              <div className="d-flex justify-content-between align-items-start gap-3 mb-4">
                <div>
                  <div className="fw-bold">Notification alerts</div>
                  <div className="text-muted small">
                    Show unread notification alerts in the navigation bar. Notifications that require acknowledgement remain visible.
                  </div>
                </div>
                <Form.Check
                  type="switch"
                  id="notification-alerts-enabled"
                  checked={notificationPreferences.enabled}
                  onChange={(e) => updateNotificationPreferences({ enabled: e.target.checked })}
                  disabled={savingNotificationPreferences}
                  aria-label="Enable notification alerts"
                />
              </div>

              <div className="d-flex justify-content-between align-items-start gap-3 mb-4">
                <div>
                  <div className="fw-bold">Notification sound</div>
                  <div className="text-muted small">
                    Play a short sound when a new unread notification arrives.
                  </div>
                </div>
                <Form.Check
                  type="switch"
                  id="notification-sound-enabled"
                  checked={notificationPreferences.sound}
                  onChange={(e) => updateNotificationPreferences({ sound: e.target.checked })}
                  disabled={savingNotificationPreferences || !notificationPreferences.enabled}
                  aria-label="Enable notification sound"
                />
              </div>

              <div className="border-top pt-4">
                <div className="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <div className="fw-bold">Device notifications</div>
                    <div className="text-muted small">
                      Receive Maintenix notifications through this device even when the app is not open in the foreground.
                    </div>
                    {!devicePushState.supported ? (
                      <div className="text-muted small mt-1">
                        This browser does not currently support Web Push. On iPhone or iPad, open Maintenix from a Home Screen installation.
                      </div>
                    ) : !devicePushState.configured ? (
                      <div className="text-muted small mt-1">
                        Device notification delivery is waiting for CRA server configuration.
                      </div>
                    ) : devicePushState.permission === "denied" ? (
                      <div className="text-danger small mt-1">
                        Notification permission is blocked in this browser. Allow notifications in the browser or device settings, then reload Maintenix.
                      </div>
                    ) : devicePushState.subscribed ? (
                      <div className="text-success small mt-1">Enabled on this device.</div>
                    ) : null}
                  </div>
                  <Form.Check
                    type="switch"
                    id="device-notifications-enabled"
                    checked={devicePushState.subscribed}
                    onChange={(e) => updateDevicePush(e.target.checked)}
                    disabled={
                      devicePushState.loading ||
                      savingDevicePush ||
                      !devicePushState.supported ||
                      !devicePushState.configured ||
                      devicePushState.permission === "denied"
                    }
                    aria-label="Enable device notifications"
                  />
                </div>

                {devicePushState.subscribed ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline-primary"
                      size="sm"
                      onClick={testDevicePush}
                      disabled={testingDevicePush}
                    >
                      {testingDevicePush ? (
                        <>
                          <Spinner size="sm" className="me-2" /> Sending…
                        </>
                      ) : (
                        "Send test device notification"
                      )}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
}
