import { AUTH_SESSION_TTL_MS, clearOrgAuth, ORGANIZATION, orgLocalStorage } from "../config/organization";
import React, { useEffect, useRef, useState } from "react";
import { Col, Row, Card, Form, Button, Image, Alert, Spinner } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../routes";
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


  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

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

  const sessionHours = Math.round(AUTH_SESSION_TTL_MS / (60 * 60 * 1000));

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
              <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3 mb-4">
                <div>
                  <div className="fw-bold">Session duration</div>
                  <div className="text-muted small">
                    You will be signed out {sessionHours} hours after signing in and will need to authenticate again.
                  </div>
                </div>
                <div className="fw-bold text-nowrap">{sessionHours} hours</div>
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
        </Col>
      </Row>
    </>
  );
}
