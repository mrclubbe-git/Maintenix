import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faUnlockAlt } from "@fortawesome/free-solid-svg-icons";
import { Col, Row, Form, Card, Button, FormCheck, Container, InputGroup, Alert, Spinner } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../../routes";
import BgImage from "../../assets/img/illustrations/signin.svg";
import {
  clearOfflineSession,
  getOfflineSession,
  isExpired,
  notifyOfflineTokenLoaded,
  safeJsonParse,
  storeOfflineSession,
  warmOfflineMode
} from "../../offlineMode";

function readOfflineSession() {
  const sess = getOfflineSession();
  if (!sess.token || !sess.user?.email || isExpired(sess.expiresAt)) return null;
  return sess;
}

export default function Signin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [offlineInfo, setOfflineInfo] = useState({ email: "", role: "", expiresAt: "" });

  const isOnline = useMemo(() => (typeof navigator !== "undefined" ? navigator.onLine : true), []);

  useEffect(() => {
    const existingToken = localStorage.getItem("authToken") || "";
    const existingUser = safeJsonParse(localStorage.getItem("authUser") || "null", null);

    // If already logged in:
    // - Online: go Overview
    // - Offline: go Servicing (avoid Overview API calls)
    if (existingToken && existingUser?.email) {
      window.location.hash = navigator.onLine ? Routes.DashboardOverview.path : Routes.Servicing.path;
      return;
    }

    const sess = readOfflineSession();
    if (sess) {
      setOfflineAvailable(true);
      setOfflineInfo({ email: sess.user.email || "", role: sess.user.role || "", expiresAt: sess.expiresAt || "" });
    } else {
      setOfflineAvailable(false);
      setOfflineInfo({ email: "", role: "", expiresAt: "" });
      clearOfflineSession();
    }
  }, []);

  function continueOffline() {
    setErr("");
    setSuccessMsg("");

    const sess = readOfflineSession();
    if (!sess) {
      setOfflineAvailable(false);
      setErr("Offline sign-in is not available on this device (no saved session, or it expired).");
      return;
    }

    localStorage.setItem("authToken", sess.token);
    localStorage.setItem("authUser", JSON.stringify(sess.user));
    window.dispatchEvent(new Event("authUserUpdated"));

    setSuccessMsg(`Continuing offline as ${sess.user.email} (${sess.user.role}).`);

    // ✅ Offline should land on Servicing (works offline)
    window.location.hash = Routes.Servicing.path;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setSuccessMsg("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErr("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setErr("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(data?.message || `Login failed (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }

      localStorage.setItem("authToken", data.token);
      localStorage.setItem("authUser", JSON.stringify(data.user));
      window.dispatchEvent(new Event("authUserUpdated"));

      const ttlMs = remember ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const expiresAt = storeOfflineSession(data.token, data.user, ttlMs);
      notifyOfflineTokenLoaded(data.user);

      setOfflineAvailable(true);
      setOfflineInfo({ email: data.user?.email || "", role: data.user?.role || "", expiresAt });

      await warmOfflineMode(data.token).catch(() => null);

      setSuccessMsg(`Logged in as ${data.user.email} (${data.user.role}).`);
      setLoading(false);

      // ✅ Online login still goes to Overview
      window.location.hash = Routes.DashboardOverview.path;
    } catch {
      const sess = readOfflineSession();
      if (sess) {
        setOfflineAvailable(true);
        setOfflineInfo({ email: sess.user.email || "", role: sess.user.role || "", expiresAt: sess.expiresAt || "" });
        setErr("API not reachable. You can continue offline using the last saved session on this device.");
      } else {
        setOfflineAvailable(false);
        setErr("Login failed (API not reachable).");
      }
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="d-flex align-items-center my-5 mt-lg-6 mb-lg-5">
        <Container>
          <Row className="justify-content-center form-bg-image" style={{ backgroundImage: `url(${BgImage})` }}>
            <Col xs={12} className="d-flex align-items-center justify-content-center">
              <div className="bg-white shadow-soft border rounded border-light p-4 p-lg-5 w-100 fmxw-500">
                <div className="text-center text-md-center mb-4 mt-md-0">
                  <h3 className="mb-0">Sign in to our platform</h3>
                </div>

                {!isOnline ? (
                  <Alert variant="warning">
                    You are offline. Online sign-in will fail until the API is reachable.
                    {offlineAvailable ? (
                      <div className="mt-2 small">
                        Offline session available for: <strong>{offlineInfo.email}</strong> ({offlineInfo.role})
                        {offlineInfo.expiresAt ? (
                          <>
                            <br />
                            Expires: <strong>{new Date(offlineInfo.expiresAt).toLocaleString()}</strong>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 small">
                        Offline sign-in is not available yet on this device. Sign in once online to enable offline mode.
                      </div>
                    )}
                  </Alert>
                ) : null}

                {err ? (
                  <Alert variant="danger">
                    {err}
                    {offlineAvailable ? (
                      <div className="mt-3">
                        <Button variant="warning" onClick={continueOffline} disabled={loading}>
                          Continue Offline
                        </Button>
                      </div>
                    ) : null}
                  </Alert>
                ) : null}

                {successMsg ? (
                  <Alert variant="success">
                    {successMsg}
                    <div className="mt-2">
                      Redirecting to{" "}
                      <Card.Link as={Link} to={Routes.Servicing.path} className="fw-bold">
                        Servicing
                      </Card.Link>
                      …
                    </div>
                  </Alert>
                ) : null}

                <Form className="mt-4" onSubmit={onSubmit}>
                  <Form.Group id="email" className="mb-4">
                    <Form.Label>Your Email</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faEnvelope} />
                      </InputGroup.Text>
                      <Form.Control
                        autoFocus
                        required
                        type="email"
                        autoComplete="email"
                        placeholder="example@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={loading}
                      />
                    </InputGroup>
                  </Form.Group>

                  <Form.Group id="password" className="mb-4">
                    <Form.Label>Your Password</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faUnlockAlt} />
                      </InputGroup.Text>
                      <Form.Control
                        required
                        type="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading}
                      />
                    </InputGroup>
                  </Form.Group>

                  <div className="d-flex justify-content-between align-items-center mb-4">
                    <Form.Check type="checkbox">
                      <FormCheck.Input
                        id="rememberMe"
                        className="me-2"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        disabled={loading}
                      />
                      <FormCheck.Label htmlFor="rememberMe" className="mb-0">
                        Remember me
                      </FormCheck.Label>
                    </Form.Check>

                    <Card.Link className="small text-end">Lost password?</Card.Link>
                  </div>

                  <Button variant="primary" type="submit" className="w-100" disabled={loading}>
                    {loading ? (
                      <>
                        <Spinner size="sm" className="me-2" /> Signing in…
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>

                  {!isOnline && offlineAvailable ? (
                    <Button variant="warning" className="w-100 mt-2" type="button" onClick={continueOffline} disabled={loading}>
                      Continue Offline
                    </Button>
                  ) : null}
                </Form>

                <div className="d-flex justify-content-center align-items-center mt-4">
                  <span className="fw-normal">
                    Not registered?
                    <Card.Link as={Link} to={Routes.Signup.path} className="fw-bold">
                      {` Create account `}
                    </Card.Link>
                  </span>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </section>
    </main>
  );
}
