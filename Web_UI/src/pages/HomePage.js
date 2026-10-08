import React, { useState, useEffect } from "react";
import { Route, Switch, Redirect } from "react-router-dom";
import { Routes } from "../routes";

// pages (KEEP)
import DashboardOverview from "./dashboard/DashboardOverview";
import Settings from "./Settings";

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

const RouteWithSidebar = ({ component: Component, ...rest }) => {
  const [loaded, setLoaded] = useState(false);

  // ✅ NEW: auth verification state
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);

  // read token each render (good enough for routing)
  const authToken = localStorage.getItem("authToken") || "";

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  // ✅ NEW: verify token against backend (handles server restarts)
  // ✅ UPDATED: if OFFLINE, do NOT call API or clear token (allow offline mode)
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function verify() {
      // no token => not logged in
      if (!authToken) {
        if (!mounted) return;
        setAuthOk(false);
        setAuthChecked(true);
        return;
      }

      try {
        const res = await fetch("/api/profile/me", {
          headers: { Authorization: `Bearer ${authToken}` },
          signal: controller.signal
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // if backend returns ok, session is valid
        if (!mounted) return;
        setAuthOk(true);
        setAuthChecked(true);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!mounted) return;
        // Offline access is intentionally disabled for now.
        setAuthOk(false);
        setAuthChecked(true);
      }
    }

    setAuthChecked(false);
    setAuthOk(false);
    verify();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [authToken]);

  const localStorageIsSettingsVisible = () => {
    return localStorage.getItem("settingsVisible") === "false" ? false : true;
  };

  const [showSettings, setShowSettings] = useState(localStorageIsSettingsVisible);

  const toggleSettings = () => {
    setShowSettings(!showSettings);
    localStorage.setItem("settingsVisible", String(!showSettings));
  };

  return (
    <Route
      {...rest}
      render={(props) => {
        // ✅ Not logged in or invalid token => go to Sign In
        if (authChecked && !authOk) {
          return <Redirect to={Routes.Signin.path} />;
        }

        // ✅ While verifying, show loader only (prevents flashing Overview)
        if (!authChecked) {
          return <Preloader show={true} />;
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
