async function readJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const error = new Error(data?.message || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

function authHeaders(authToken, extra = {}) {
  return {
    ...extra,
    
  };
}

export async function fetchGlobalAreas(authToken) {
  async function getFrom(path) {
    const res = await fetch(path, {
      headers: authHeaders(authToken)
    });
    return readJsonResponse(res);
  }

  let data;
  try {
    data = await getFrom("/api/areas");
  } catch (e) {
    if (Number(e?.status || 0) !== 404) throw e;
    data = await getFrom("/api/servicing/areas");
  }

  return Array.isArray(data?.areas) ? data.areas : [];
}

export async function addGlobalArea(authToken, areaName) {
  const area = String(areaName || "").replace(/\s+/g, " ").trim();
  if (!area) throw new Error("Area name is required.");

  async function postTo(path) {
    const res = await fetch(path, {
      method: "POST",
      headers: authHeaders(authToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ area })
    });
    return readJsonResponse(res);
  }

  let data;
  try {
    data = await postTo("/api/areas");
  } catch (e) {
    if (Number(e?.status || 0) !== 404) throw e;
    try {
      data = await postTo("/api/servicing/areas");
    } catch (fallbackError) {
      if (Number(fallbackError?.status || 0) === 404) {
        throw new Error("Area saving is not deployed on the API server yet. Update and restart the Server_API, then try again.");
      }
      throw fallbackError;
    }
  }

  return {
    area: String(data?.area || area),
    areas: Array.isArray(data?.areas) ? data.areas : [],
    created: data?.created !== false
  };
}

export function hasExactAreaMatch(areas, value) {
  const wanted = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!wanted) return false;
  return (areas || []).some(
    (area) => String(area || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted
  );
}
