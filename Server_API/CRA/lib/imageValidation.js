const path = require("path");

let sizeOf = null;
try {
  const imageSizeModule = require("image-size");
  sizeOf =
    typeof imageSizeModule === "function"
      ? imageSizeModule
      : typeof imageSizeModule.imageSize === "function"
        ? imageSizeModule.imageSize
        : typeof imageSizeModule.default === "function"
          ? imageSizeModule.default
          : null;
} catch {
  sizeOf = null;
}

const MIME_BY_TYPE = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";

  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR" &&
    buffer.includes(Buffer.from("IEND"))
  ) {
    return "png";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    return "jpeg";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return "";
}

function normalizeAllowed(allowed) {
  return new Set(
    (Array.isArray(allowed) ? allowed : ["png", "jpeg"])
      .map((value) => String(value || "").toLowerCase().replace(/^jpg$/, "jpeg"))
      .filter(Boolean)
  );
}

function validateImageBuffer(buffer, options = {}) {
  const maxBytes = Number(options.maxBytes || 15 * 1024 * 1024);
  const allowed = normalizeAllowed(options.allowed);
  const declaredMime = String(options.declaredMime || "").trim().toLowerCase();

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("Image file is empty or invalid.");
  }
  if (buffer.length > maxBytes) {
    throw new Error(`Image is too large (maximum ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  }

  const type = detectImageType(buffer);
  if (!type || !allowed.has(type)) {
    throw new Error("Unsupported or malformed image. Use a valid PNG or JPEG image.");
  }

  const expectedMime = MIME_BY_TYPE[type];
  if (
    declaredMime &&
    declaredMime !== expectedMime &&
    !(type === "jpeg" && declaredMime === "image/jpg")
  ) {
    throw new Error("Image content does not match its declared file type.");
  }

  if (!sizeOf) throw new Error("Image validation dependency is unavailable.");

  let dimensions = null;
  try {
    dimensions = sizeOf(buffer);
  } catch {
    throw new Error("Image data could not be decoded.");
  }

  const width = Number(dimensions?.width || 0);
  const height = Number(dimensions?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("Image dimensions are invalid.");
  }
  if (width > 16000 || height > 16000 || width * height > 80_000_000) {
    throw new Error("Image dimensions are too large.");
  }

  return {
    type,
    mime: expectedMime,
    ext: type === "jpeg" ? "jpg" : type,
    width,
    height,
    bytes: buffer.length
  };
}

function decodeImageDataUrl(dataUrl, options = {}) {
  const value = String(dataUrl || "").trim();
  const match = value.match(/^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("Invalid image data.");

  const base64 = String(match[3] || "").replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new Error("Invalid base64 image data.");
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new Error("Invalid base64 image data.");
  }

  const info = validateImageBuffer(buffer, {
    ...options,
    declaredMime: match[1].toLowerCase()
  });

  return { buffer, ...info };
}

function validateSignatureDataUrl(dataUrl, options = {}) {
  const decoded = decodeImageDataUrl(dataUrl, {
    allowed: ["png"],
    maxBytes: Number(options.maxBytes || 2 * 1024 * 1024)
  });

  const minWidth = Number(options.minWidth || 120);
  const minHeight = Number(options.minHeight || 50);
  const minBytes = Number(options.minBytes || 800);

  if (decoded.width < minWidth || decoded.height < minHeight || decoded.bytes < minBytes) {
    throw new Error("Signature image is missing or too small to be valid.");
  }

  return decoded;
}

function safeGeneratedImageName(prefix, identifier, ext) {
  const safePrefix = String(prefix || "image").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "image";
  const safeId = String(identifier || "").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "file";
  const safeExt = String(ext || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  return path.basename(`${safePrefix}_${safeId}_${Date.now()}.${safeExt}`);
}

module.exports = {
  detectImageType,
  validateImageBuffer,
  decodeImageDataUrl,
  validateSignatureDataUrl,
  safeGeneratedImageName
};
