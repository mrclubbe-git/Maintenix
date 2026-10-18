import { clearOrgAuth, isOrgAuthExpired, orgLocalStorage, setOrgAuth, setOrgCsrfToken } from "../../config/organization";
import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faUnlockAlt } from "@fortawesome/free-solid-svg-icons";
import { Col, Row, Form, Card, Button, Container, InputGroup, Alert, Spinner } from "@themesberg/react-bootstrap";
import { Link } from "react-router-dom";

import { Routes } from "../../routes";
import BgImage from "../../assets/img/illustrations/signin.svg";

function clearStoredAuth() {
  clearOrgAuth();
}

export default function Signin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    const existingToken = orgLocalStorage.getItem("authToken") || "";
    if (!existingToken) return undefined;

    if (isOrgAuthExpired()) {
      clearStoredAuth();
      return undefined;
    }

    let mounted = true;
    const controller = new AbortController();

    async function verifyExistingSession() {
      try {
        const res = await fetch("/api/profile/me", {
          
          signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data?.user) {
          setOrgCsrfToken(data?.csrfToken || "");
          if (data?.expiresAt) orgLocalStorage.setItem("authExpiresAt", String(data.expiresAt));
          orgLocalStorage.setItem("authUser", JSON.stringify(data.user));
          window.dispatchEvent(new Event("authUserUpdated"));
          if (mounted) window.location.hash = Routes.DashboardOverview.path;
          return;
        }

        if (res.status === 401 || res.status === 403) {
          clearStoredAuth();
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        // Stay on Sign In if the API cannot validate the stored token.
      }
    }

    verifyExistingSession();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setSuccessMsg("");

    const cleanEmail = String(emailRef.current?.value ?? email).trim().toLowerCase();
    const currentPassword = String(passwordRef.current?.value ?? password);
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErr("Please enter a valid email address.");
      return;
    }
    if (!currentPassword) {
      setErr("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password: currentPassword })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(data?.message || `Login failed (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }

      setOrgAuth(data.user, data.expiresAt, data.csrfToken);

      setSuccessMsg(`Logged in as ${data.user.email} (${data.user.role}).`);
      setLoading(false);

      // ✅ Online login still goes to Overview
      window.location.hash = Routes.DashboardOverview.path;
    } catch {
      setErr("Login failed (API not reachable).");
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

                {err ? <Alert variant="danger">{err}</Alert> : null}

                {successMsg ? (
                  <Alert variant="success">
                    {successMsg}
                    <div className="mt-2">
                      Redirecting to{" "}
                      <Card.Link as={Link} to={Routes.DashboardOverview.path} className="fw-bold">
                        Overview
                      </Card.Link>
                      …
                    </div>
                  </Alert>
                ) : null}

                <Form className="mt-4" onSubmit={onSubmit} autoComplete="on">
                  <Form.Group controlId="signin-email" className="mb-4">
                    <Form.Label>Your Email</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faEnvelope} />
                      </InputGroup.Text>
                      <Form.Control
                        ref={emailRef}
                        autoFocus
                        required
                        type="email"
                        name="username"
                        autoComplete="username"
                        inputMode="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="example@company.com"
                        onChange={(e) => setEmail(e.target.value)}
                        onInput={(e) => setEmail(e.currentTarget.value)}
                        disabled={loading}
                      />
                    </InputGroup>
                  </Form.Group>

                  <Form.Group controlId="signin-password" className="mb-4">
                    <Form.Label>Your Password</Form.Label>
                    <InputGroup>
                      <InputGroup.Text>
                        <FontAwesomeIcon icon={faUnlockAlt} />
                      </InputGroup.Text>
                      <Form.Control
                        ref={passwordRef}
                        required
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        onChange={(e) => setPassword(e.target.value)}
                        onInput={(e) => setPassword(e.currentTarget.value)}
                        disabled={loading}
                      />
                    </InputGroup>
                  </Form.Group>

                  <div className="d-flex justify-content-end mb-4">
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
