const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionLifetimeSeconds = 60 * 60 * 8;

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
  const submitted = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  const expected = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const submittedBytes = new Uint8Array(submitted);
  const expectedBytes = new Uint8Array(expected);
  let difference = submittedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < Math.min(submittedBytes.length, expectedBytes.length); index += 1) {
    difference |= submittedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function fileNameFromPath(path) {
  return path.split("/").pop().replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function safeObjectKey(path) {
  if (!path || path.includes("..") || path.startsWith("/")) return null;
  return path;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
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

    if (url.pathname === "/api/files" && request.method === "GET") {
      const objects = await env.PORTFOLIO_FILES.list({ limit: 100 });
      return json(
        {
          files: objects.objects.map((object) => ({
            name: object.key,
            size: object.size,
            uploaded: object.uploaded.toISOString(),
          })),
        },
        200,
        cors
      );
    }

    if (url.pathname.startsWith("/api/download/") && request.method === "GET") {
      const key = safeObjectKey(
        decodeURIComponent(url.pathname.slice("/api/download/".length))
      );
      if (!key) return json({ error: "Invalid file name." }, 400, cors);

      const object = await env.PORTFOLIO_FILES.get(key);
      if (!object) return json({ error: "File not found." }, 404, cors);

      return new Response(object.body, {
        headers: {
          ...cors,
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${fileNameFromPath(key)}"`,
          "Content-Length": String(object.size),
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        },
      });
    }

    return json({ error: "Not found." }, 404, cors);
  },
};
