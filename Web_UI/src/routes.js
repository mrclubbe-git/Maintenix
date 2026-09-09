export const Routes = {
  // root
  Presentation: { path: "/" },

  // app pages (with sidebar)
  DashboardOverview: { path: "/dashboard/overview" },
  Settings: { path: "/settings" },

  // placeholders (sidebar links - pages can be added later)
  ServerInfo: { path: "/server-info" },
  Reports: { path: "/reports" },
  Pictures: { path: "/pictures" },
  Servicing: { path: "/Servicing" },
  StockControl: { path: "/stock-control" },
  CallOut: { path: "/CallOut" },
  Standby: { path: "/standby" },


  // auth / examples (no sidebar)
  Signin: { path: "/examples/sign-in" },
  Signup: { path: "/examples/sign-up" },
  ForgotPassword: { path: "/examples/forgot-password" },
  ResetPassword: { path: "/examples/reset-password" },
  Lock: { path: "/examples/lock" },

  // error pages (no sidebar)
  NotFound: { path: "/examples/404" },
  ServerError: { path: "/examples/500" }
};