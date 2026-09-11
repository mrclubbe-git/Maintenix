(function () {
  "use strict";

  var configured = String(window.__MAINTENIX_API_BASE_URL__ || "").trim();

  // CRA leaves unknown %REACT_APP_*% placeholders untouched during local dev.
  if (/^%REACT_APP_[A-Z0-9_]+%$/.test(configured)) configured = "";

  var apiBase = configured.replace(/\/+$/, "");

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
        // Current browsers can request permission to reach a loopback HTTP API
        // from an HTTPS GitHub Pages origin.
        next.targetAddressSpace = "loopback";
        if (!next.mode) next.mode = "cors";
      }
    } catch (e) {}

    return next;
  }

  window.__maintenixResolveApiUrl = resolveApiUrl;

  if (apiBase && typeof window.fetch === "function") {
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      if (typeof input === "string" && isServerRelative(input)) {
        var url = resolveApiUrl(input);
        return nativeFetch(url, withLoopbackOptions(url, init));
      }

      return nativeFetch(input, init);
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
