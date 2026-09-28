const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionLifetimeSeconds = 60 * 60 * 8;
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const driveApiBase = "https://www.googleapis.com/drive/v3";
const driveScope = "https://www.googleapis.com/auth/drive.readonly";

const googleWorkspaceExports = {
  "application/vnd.google-apps.document": {
    extension: ".pdf",
    mimeType: "application/pdf",
  },
  "application/vnd.google-apps.presentation": {
    extension: ".pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  "application/vnd.google-apps.spreadsheet": {
    extension: ".xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

let googleTokenCache;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  return origin && origin === env.ALLOWED_ORIGIN
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      }
    : {};
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlBytes(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function configurationReady(env) {
  return [
    env.PORTFOLIO_USERNAME,
    env.PORTFOLIO_PASSWORD,
    env.PORTFOLIO_SESSION_SECRET,
    env.ALLOWED_ORIGIN,
    env.DRIVE_FOLDER_ID,
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  ].every((value) => typeof value === "string" && value.length > 0);
}

function validDriveId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function privateKeyBytes(value) {
  const encodedKey = value
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(encodedKey), (character) => character.charCodeAt(0));
}

function safeFileName(value) {
  const name = value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return name || "download";
}

function fileNameForExport(name, extension) {
  const safeName = safeFileName(name);
  return safeName.toLowerCase().endsWith(extension) ? safeName : `${safeName}${extension}`;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSession(env) {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        sub: "portfolio-owner",
        exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds,
      })
    )
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(env.PORTFOLIO_SESSION_SECRET),
    encoder.encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifySession(request, env) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;

  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;

  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(env.PORTFOLIO_SESSION_SECRET),
    base64UrlBytes(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!validSignature) return false;

  try {
    const claims = JSON.parse(decoder.decode(base64UrlBytes(payload)));
    return claims.sub === "portfolio-owner" && claims.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

async function matchesSecret(value, secret) {
  if (typeof secret !== "string") return false;

  const submitted = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  const expected = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const submittedBytes = new Uint8Array(submitted);
  const expectedBytes = new Uint8Array(expected);
  let difference = submittedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < submittedBytes.length; index += 1) {
    difference |= submittedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function googleAccessToken(env) {
  if (
    googleTokenCache?.email === env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    googleTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return googleTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(
    encoder.encode(
      JSON.stringify({
        iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: driveScope,
        aud: googleTokenUrl,
        iat: now,
        exp: now + 60 * 60,
      })
    )
  );
  const signedContent = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signedContent)
  );
  const assertion = `${signedContent}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.access_token !== "string") {
    throw new Error("Google token request failed.");
  }

  googleTokenCache = {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000,
  };
  return googleTokenCache.token;
}

async function driveFetch(env, url) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${await googleAccessToken(env)}` },
  });
}

async function listFiles(env) {
  const url = new URL(`${driveApiBase}/files`);
  url.searchParams.set(
    "q",
    `'${env.DRIVE_FOLDER_ID}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`
  );
  url.searchParams.set("fields", "files(id,name,size,createdTime,modifiedTime,mimeType)");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await driveFetch(env, url);
  if (!response.ok) throw new Error("Google Drive list request failed.");

  const payload = await response.json();
  return Array.isArray(payload.files)
    ? payload.files.map((file) => ({
        id: file.id,
        name: file.name,
        size: Number(file.size) || 0,
        uploaded: file.modifiedTime || file.createdTime,
        mimeType: file.mimeType,
      }))
    : [];
}

async function fileMetadata(env, fileId) {
  const url = new URL(`${driveApiBase}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,size,mimeType,parents");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await driveFetch(env, url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Google Drive metadata request failed.");

  const metadata = await response.json();
  return metadata.parents?.includes(env.DRIVE_FOLDER_ID) ? metadata : null;
}

async function downloadFile(env, metadata) {
  const exportFormat = googleWorkspaceExports[metadata.mimeType];
  if (metadata.mimeType?.startsWith("application/vnd.google-apps.") && !exportFormat) {
    return { unsupported: true };
  }

  const url = new URL(
    exportFormat
      ? `${driveApiBase}/files/${encodeURIComponent(metadata.id)}/export`
      : `${driveApiBase}/files/${encodeURIComponent(metadata.id)}`
  );
  if (exportFormat) {
    url.searchParams.set("mimeType", exportFormat.mimeType);
  } else {
    url.searchParams.set("alt", "media");
  }
  url.searchParams.set("supportsAllDrives", "true");

  const response = await driveFetch(env, url);
  if (!response.ok || !response.body) throw new Error("Google Drive download request failed.");

  return {
    body: response.body,
    contentType: exportFormat?.mimeType || metadata.mimeType || "application/octet-stream",
    name: exportFormat
      ? fileNameForExport(metadata.name, exportFormat.extension)
      : safeFileName(metadata.name),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (!configurationReady(env) || !validDriveId(env.DRIVE_FOLDER_ID)) {
      return json({ error: "Private access is not configured yet." }, 503, cors);
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      let credentials;
      try {
        credentials = await request.json();
      } catch {
        return json({ error: "Invalid sign-in request." }, 400, cors);
      }

      if (
        typeof credentials?.username !== "string" ||
        typeof credentials?.password !== "string" ||
        credentials.username.length > 256 ||
        credentials.password.length > 1024
      ) {
        return json({ error: "Invalid sign-in request." }, 400, cors);
      }

      const [usernameMatches, passwordMatches] = await Promise.all([
        matchesSecret(credentials.username, env.PORTFOLIO_USERNAME),
        matchesSecret(credentials.password, env.PORTFOLIO_PASSWORD),
      ]);
      if (!usernameMatches || !passwordMatches) {
        return json({ error: "Sign-in was not accepted." }, 401, cors);
      }

      return json(
        {
          token: await createSession(env),
          expiresAt: new Date(
            Date.now() + sessionLifetimeSeconds * 1000
          ).toISOString(),
        },
        200,
        cors
      );
    }

    if (!(await verifySession(request, env))) {
      return json({ error: "Sign-in required." }, 401, cors);
    }

    try {
      if (url.pathname === "/api/files" && request.method === "GET") {
        return json({ files: await listFiles(env) }, 200, cors);
      }

      if (url.pathname.startsWith("/api/download/") && request.method === "GET") {
        const fileId = decodeURIComponent(url.pathname.slice("/api/download/".length));
        if (!validDriveId(fileId)) return json({ error: "Invalid file." }, 400, cors);

        const metadata = await fileMetadata(env, fileId);
        if (!metadata) return json({ error: "File not found." }, 404, cors);

        const file = await downloadFile(env, metadata);
        if (file.unsupported) {
          return json({ error: "This Google Workspace file type cannot be downloaded." }, 415, cors);
        }

        return new Response(file.body, {
          headers: {
            ...cors,
            "Cache-Control": "private, no-store",
            "Content-Disposition": `attachment; filename="${file.name}"`,
            "Content-Type": file.contentType,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    } catch (error) {
      console.error(error);
      return json({ error: "Private files are temporarily unavailable." }, 502, cors);
    }

    return json({ error: "Not found." }, 404, cors);
  },
};
