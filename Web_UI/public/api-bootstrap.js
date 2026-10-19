(function () {
  "use strict";

  var meta = document.querySelector('meta[name="maintenix-api-base"]');
  var configured = String(meta ? meta.getAttribute("content") || "" : "").trim();

  if (/^%REACT_APP_[A-Z0-9_]+%$/.test(configured)) configured = "";

  var apiBase = configured.replace(/\/+$/, "");
  var csrfToken = "";

  function currentAppBuild() {
    try {
      var scripts = Array.prototype.slice.call(document.scripts || []);
      var src = scripts
        .map(function (script) { return script.getAttribute("src") || ""; })
        .find(function (value) { return /\/static\/js\/main\.[^/]+\.js(?:\?|$)/.test(value); });
      var match = src && /main\.([^.]+)\.js/.exec(src);
      return match ? match[1] : "";
    } catch (e) {
      return "";
    }
  }

  // GitHub Pages cannot emit custom frame-control response headers. Keep a
  // client-side deny fallback so a framed copy never renders interactive UI.
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; } catch (e) {}
    document.documentElement.style.display = "none";
  }

  function isServerRelative(value) {
    return (
      value === "/api" ||
      value.indexOf("/api/") === 0 ||
      value === "/uploads" ||
      value.indexOf("/uploads/") === 0
    );
  }

  function resolveApiUrl(value) {
    var raw = String(value || "").trim();
    if (!raw || !apiBase || !isServerRelative(raw)) return raw;
    return apiBase + raw;
  }

  function isApiUrl(value) {
    try {
      var resolved = new URL(String(value || ""), window.location.href);
      if (resolved.pathname === "/api" || resolved.pathname.indexOf("/api/") === 0) {
        return resolved.origin === window.location.origin;
      }
      if (!apiBase) return false;
      var base = new URL(apiBase, window.location.href);
      return resolved.origin === base.origin && resolved.pathname.indexOf(base.pathname.replace(/\/$/, "") + "/api") === 0;
    } catch (e) {
      return false;
    }
  }

  function withLoopbackOptions(url, init) {
    var next = Object.assign({}, init || {});

    try {
      var target = new URL(url, window.location.href);
      var loopback =
        target.hostname === "localhost" ||
        target.hostname === "127.0.0.1" ||
        target.hostname === "::1";

      if (
        window.location.protocol === "https:" &&
        target.protocol === "http:" &&
        loopback
      ) {
        next.targetAddressSpace = "loopback";
        if (!next.mode) next.mode = "cors";
      }
    } catch (e) {}

    return next;
  }

  function secureApiOptions(url, init) {
    var next = withLoopbackOptions(url, init);
    next.credentials = "include";

    var headers = new Headers(next.headers || {});
    headers.delete("Authorization");

    var method = String(next.method || "GET").toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].indexOf(method) >= 0 && csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
    var build = currentAppBuild();
    if (build) headers.set("X-Maintenix-App-Build", build);
    next.headers = headers;
    return next;
  }

  window.__maintenixResolveApiUrl = resolveApiUrl;
  window.__maintenixSetCsrfToken = function (value) {
    csrfToken = String(value || "").trim();
  };
  window.__maintenixClearCsrfToken = function () {
    csrfToken = "";
  };

  if (typeof window.fetch === "function") {
    var nativeFetch = window.fetch.bind(window);
    var csrfRefreshPromise = null;

    function requestPath(url) {
      try { return new URL(url, window.location.href).pathname; }
      catch (e) { return ""; }
    }

    function stateChanging(init) {
      var method = String((init && init.method) || "GET").toUpperCase();
      return ["POST", "PUT", "PATCH", "DELETE"].indexOf(method) >= 0;
    }

    function refreshCsrfToken() {
      if (csrfRefreshPromise) return csrfRefreshPromise;

      var csrfUrl = resolveApiUrl("/api/auth/csrf");
      csrfRefreshPromise = nativeFetch(csrfUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "include"
      })
        .then(function (response) {
          if (!response.ok) return null;
          return response.json().catch(function () { return null; });
        })
        .then(function (body) {
          var next = String((body && body.csrfToken) || "").trim();
          if (next) csrfToken = next;
          return next;
        })
        .finally(function () {
          csrfRefreshPromise = null;
        });

      return csrfRefreshPromise;
    }

    function dispatchApiError(detail) {
      try {
        if (String(detail && detail.path || "").indexOf("/api/site-logs/") >= 0) return;
        window.dispatchEvent(new CustomEvent("maintenix:api-error", { detail: detail || {} }));
      } catch (e) {}
    }

    function finishResponse(response, path, method) {
      if (
        response.status === 401 &&
        path.indexOf("/api/auth/login") < 0 &&
        path.indexOf("/api/auth/register") < 0
      ) {
        try { window.dispatchEvent(new Event("maintenixSessionInvalid")); } catch (e) {}
      }

      if (response.status >= 500) {
        dispatchApiError({
          path: path,
          method: method || "GET",
          status: response.status,
          requestId: response.headers.get("X-Request-Id") || "",
          networkError: false
        });
      }
      return response;
    }

    window.fetch = function (input, init) {
      var source = typeof input === "string" ? input : input && input.url ? input.url : "";
      var serverRelative = typeof source === "string" && isServerRelative(source);
      var url = serverRelative ? resolveApiUrl(source) : source;
      var apiRequest = serverRelative || isApiUrl(url);

      if (!apiRequest) return nativeFetch(input, init);

      var path = requestPath(url);
      var options = secureApiOptions(url, init);

      var method = String(options.method || "GET").toUpperCase();

      return nativeFetch(url || input, options).then(function (response) {
        var csrfEligible =
          response.status === 403 &&
          stateChanging(options) &&
          path.indexOf("/api/auth/login") < 0 &&
          path.indexOf("/api/auth/register") < 0;

        if (!csrfEligible) return finishResponse(response, path, method);

        return refreshCsrfToken().then(function (nextToken) {
          if (!nextToken) return finishResponse(response, path, method);
          var retryOptions = secureApiOptions(url, init);
          retryOptions.headers.set("X-CSRF-Token", nextToken);
          return nativeFetch(url || input, retryOptions).then(function (retryResponse) {
            return finishResponse(retryResponse, path, method);
          });
        });
      }).catch(function (error) {
        dispatchApiError({
          path: path,
          method: method,
          status: 0,
          requestId: "",
          networkError: true,
          error: String(error && error.message || error || "Network error")
        });
        throw error;
      });
    };
  }

  if (apiBase && window.Element && Element.prototype.setAttribute) {
    var nativeSetAttribute = Element.prototype.setAttribute;

    Element.prototype.setAttribute = function (name, value) {
      if (
        String(name || "").toLowerCase() === "src" &&
        this.tagName === "IMG" &&
        typeof value === "string" &&
        isServerRelative(value)
      ) {
        value = resolveApiUrl(value);
      }

      return nativeSetAttribute.call(this, name, value);
    };
  }

  if (apiBase && window.HTMLImageElement) {
    try {
      var srcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "src"
      );

      if (srcDescriptor && srcDescriptor.set && srcDescriptor.get) {
        Object.defineProperty(HTMLImageElement.prototype, "src", {
          configurable: srcDescriptor.configurable,
          enumerable: srcDescriptor.enumerable,
          get: srcDescriptor.get,
          set: function (value) {
            if (typeof value === "string" && isServerRelative(value)) {
              value = resolveApiUrl(value);
            }
            return srcDescriptor.set.call(this, value);
          }
        });
      }
    } catch (e) {}
  }

  if (apiBase && window.console && console.info) {
    console.info("Maintenix API base:", apiBase);
  }
})();
