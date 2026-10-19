import { clearOrgAuth, ensureOrgAuthExpiresAt, isOrgAuthExpired, orgLocalStorage, setOrgCsrfToken } from "../config/organization";
import { storeOfflineLeaseFromResponse, verifyStoredOfflineLease } from "../lib/offlineSession";
import React, { useState, useEffect } from "react";
import { Route, Switch, Redirect } from "react-router-dom";
import { Routes } from "../routes";

// pages (KEEP)
import DashboardOverview from "./dashboard/DashboardOverview";
import Settings from "./Settings";
import Administration from "./Administration";

// examples (KEEP)
import Signin from "./examples/Signin";
import Signup from "./examples/Signup";
import ForgotPassword from "./examples/ForgotPassword";
import ResetPassword from "./examples/ResetPassword";
import Lock from "./examples/Lock";
import NotFoundPage from "./examples/NotFound";
import ServerError from "./examples/ServerError";
import Reports from "./Reports";
import SectionReports from "./SectionReports";
import Servicing from "./Servicing";
import StockControl from "./StockControl";
import Pictures from "./Pictures";
import CallOut from "./CallOut";
import Standby from "./Standby";
import DailyPlanner from "./DailyPlanner";


// layout components (KEEP)
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import Preloader from "../components/Preloader";

const RouteWithLoader = ({ component: Component, ...rest }) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Route
      {...rest}
      render={(props) => (
        <>
          <Preloader show={loaded ? false : true} />
          <Component {...props} />
        </>
      )}
    />
  );
};

const RouteWithSidebar = ({ component: Component, adminOnly = false, ...rest }) => {
  const [loaded, setLoaded] = useState(false);

  // ✅ NEW: auth verification state
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState(null);

  // read token each render (good enough for routing)
  const authToken = orgLocalStorage.getItem("authToken") || "";

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleInvalidSession = () => {
      clearOrgAuth();
      setVerifiedUser(null);
      setAuthOk(false);
      setAuthChecked(true);
    };
    window.addEventListener("maintenixSessionInvalid", handleInvalidSession);
    return () => window.removeEventListener("maintenixSessionInvalid", handleInvalidSession);
  }, []);

  // ✅ NEW: verify token against backend (handles server restarts)
  // ✅ UPDATED: if OFFLINE, do NOT call API or clear token (allow offline mode)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function verify() {
      // no token => not logged in
      if (!authToken) {
        orgLocalStorage.removeItem("authUser");
        orgLocalStorage.removeItem("authExpiresAt");
        if (!mounted) return;
        setVerifiedUser(null);
        setAuthOk(false);
        setAuthChecked(true);
        return;
      }

      const acceptValidOfflineLease = async () => {
        const offline = await verifyStoredOfflineLease();
        if (!offline?.valid || !offline?.user) return false;
        if (!mounted) return true;

        orgLocalStorage.setItem("authExpiresAt", String(offline.expiresAt));
        orgLocalStorage.setItem("authUser", JSON.stringify(offline.user));
        setVerifiedUser(offline.user);
        setAuthOk(true);
        setAuthChecked(true);
        return true;
      };

      if (isOrgAuthExpired()) {
        if (await acceptValidOfflineLease()) return;
        clearOrgAuth();
        if (!mounted) return;
        setVerifiedUser(null);
        setAuthOk(false);
        setAuthChecked(true);
        return;
      }

      // Legacy CRA sessions may predate the client-side expiry key.
      // Give them a client-side ceiling while the backend remains authoritative.
      ensureOrgAuthExpiresAt();

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (await acceptValidOfflineLease()) return;
        if (!mounted) return;
        setVerifiedUser(null);
        setAuthOk(false);
        setAuthChecked(true);
        return;
      }

      try {
        const res = await fetch("/api/profile/me", {
          signal: controller.signal
        });

        if (res.status === 401 || res.status === 403) {
          clearOrgAuth();
          if (!mounted) return;
          setVerifiedUser(null);
          setAuthOk(false);
          setAuthChecked(true);
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json().catch(() => ({}));
        setOrgCsrfToken(data?.csrfToken || "");
        storeOfflineLeaseFromResponse(data);
        const leaseExpiry = Number(data?.offlineLease?.expiresAt || 0);
        if (leaseExpiry > Date.now()) orgLocalStorage.setItem("authExpiresAt", String(leaseExpiry));
        else if (data?.expiresAt) orgLocalStorage.setItem("authExpiresAt", String(data.expiresAt));
        const user = data?.user && typeof data.user === "object" ? data.user : null;
        if (!user) throw new Error("Profile response did not include a user.");

        // Backend profile is authoritative for route-level role checks.
        if (!mounted) return;

        // Keep the cached public user in sync with the backend-verified role so
        // role-gated navigation (including Administration) cannot remain visible
        // because of stale local browser data.
        try {
          const cached = JSON.parse(orgLocalStorage.getItem("authUser") || "{}");
          orgLocalStorage.setItem("authUser", JSON.stringify({ ...(cached || {}), ...user }));
          window.dispatchEvent(new Event("authUserUpdated"));
        } catch {
          orgLocalStorage.setItem("authUser", JSON.stringify(user));
          window.dispatchEvent(new Event("authUserUpdated"));
        }

        setVerifiedUser(user);
        setAuthOk(true);
        setAuthChecked(true);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!mounted) return;

        // A transient network/API failure may use a cryptographically verified
        // local lease until its 48-hour expiry. Server 401/403 responses above
        // remain authoritative and are never bypassed.
        if (await acceptValidOfflineLease()) return;

        setVerifiedUser(null);
        setAuthOk(false);
        setAuthChecked(true);
      }
    }

    setAuthChecked(false);
    setAuthOk(false);
    setVerifiedUser(null);
    verify();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [authToken]);

  // Enforce the 48-hour local access ceiling even if a page stays open.
  // Automatic online synchronization may refresh the signed lease, so re-read
  // the current expiry instead of holding a stale timeout from initial mount.
  useEffect(() => {
    if (!authToken) return undefined;

    let active = true;
    const checkExpiry = async () => {
      if (!active || !isOrgAuthExpired()) return;

      const offline = await verifyStoredOfflineLease();
      if (offline?.valid && offline?.user) {
        orgLocalStorage.setItem("authExpiresAt", String(offline.expiresAt));
        setVerifiedUser(offline.user);
        setAuthOk(true);
        setAuthChecked(true);
        return;
      }

      clearOrgAuth();
      setVerifiedUser(null);
      setAuthOk(false);
      setAuthChecked(true);
    };

    checkExpiry();
    const timer = window.setInterval(checkExpiry, 30 * 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [authToken]);

  const localStorageIsSettingsVisible = () => {
    return orgLocalStorage.getItem("settingsVisible") === "false" ? false : true;
  };

  const [showSettings, setShowSettings] = useState(localStorageIsSettingsVisible);

  const toggleSettings = () => {
    setShowSettings(!showSettings);
    orgLocalStorage.setItem("settingsVisible", String(!showSettings));
  };

  return (
    <Route
      {...rest}
      render={(props) => {
        // ✅ Not logged in or invalid token => go to Sign In
        if (authChecked && !authOk) {
          return <Redirect to={Routes.Signin.path} />;
        }

        // ✅ While verifying, show loader only (prevents flashing protected content)
        if (!authChecked) {
          return <Preloader show={true} />;
        }

        // Administration is route-protected using the backend-verified profile,
        // not the locally cached role. Manually typing the URL as a non-Admin
        // redirects away before the Administration component is rendered.
        const verifiedRole = String(verifiedUser?.role || "").trim().toUpperCase();
        if (adminOnly && verifiedRole !== "ADMIN") {
          return <Redirect to={Routes.DashboardOverview.path} />;
        }

        return (
          <>
            <Preloader show={loaded ? false : true} />
            <Sidebar />

            <main className="content">
              <Navbar />
              <Component {...props} />
              <Footer toggleSettings={toggleSettings} showSettings={showSettings} />
            </main>
          </>
        );
      }}
    />
  );
};

export default function HomePage() {
  return (
    <Switch>
      {/* Root -> Overview */}
      <Route
        exact
        path={Routes.Presentation.path}
        render={() => (
          <Redirect to={Routes.DashboardOverview.path} />
        )}
      />

      {/* Auth / error pages (no sidebar) */}
      <RouteWithLoader exact path={Routes.Signin.path} component={Signin} />
      <RouteWithLoader exact path={Routes.Signup.path} component={Signup} />
      <RouteWithLoader exact path={Routes.ForgotPassword.path} component={ForgotPassword} />
      <RouteWithLoader exact path={Routes.ResetPassword.path} component={ResetPassword} />
      <RouteWithLoader exact path={Routes.Lock.path} component={Lock} />
      <RouteWithLoader exact path={Routes.ServerError.path} component={ServerError} />
      <RouteWithLoader exact path={Routes.NotFound.path} component={NotFoundPage} />

      {/* App pages (with sidebar) */}
      <RouteWithSidebar exact path={Routes.DashboardOverview.path} component={DashboardOverview} />
      <RouteWithSidebar exact path={Routes.Settings.path} component={Settings} />
      <RouteWithSidebar exact path={Routes.Administration.path} component={Administration} adminOnly />
      <RouteWithSidebar exact path={Routes.Reports.path} component={Reports} />
      <RouteWithSidebar exact path={Routes.SectionReports.path} component={SectionReports} />
      <RouteWithSidebar exact path={Routes.Servicing.path} component={Servicing} />
      <RouteWithSidebar exact path={Routes.StockControl.path} component={StockControl} />
      <RouteWithSidebar exact path={Routes.Pictures.path} component={Pictures} />
      <RouteWithSidebar exact path={Routes.CallOut.path} component={CallOut} />
      <RouteWithSidebar exact path={Routes.Standby.path} component={Standby} />
      <RouteWithSidebar exact path={Routes.DailyPlanner.path} component={DailyPlanner} />


      {/* Fallback */}
      <Redirect to={Routes.NotFound.path} />
    </Switch>
  );
}
