import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const payload = await req.json();
    const row = payload.record || payload;

    const state = String(row.state || "").toLowerCase();
    const alarm = row.alarm === true || row.alarm === 1 || String(row.alarm).toLowerCase() === "true";
    const ultrasonicError =
      row.ultrasonic_error === true ||
      row.ultrasonic_error === 1 ||
      String(row.ultrasonic_error).toLowerCase() === "true";

    const shouldNotify =
      state === "critical" ||
      state === "warning" ||
      state === "sensor_error" ||
      alarm ||
      ultrasonicError;

    if (!shouldNotify) {
      return json({ ok: true, skipped: true, reason: "Safe reading" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment secrets.");
    }

    const tokensRes = await fetch(
      `${supabaseUrl}/rest/v1/notification_tokens?select=token`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!tokensRes.ok) {
      throw new Error("Could not fetch notification tokens. HTTP " + tokensRes.status);
    }

    const tokens = await tokensRes.json();

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return json({ ok: true, message: "No notification tokens saved" });
    }

    const accessToken = await getFirebaseAccessToken();
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID");

    if (!projectId) {
      throw new Error("Missing FIREBASE_PROJECT_ID secret.");
    }

    const level = row.water_level ?? row.water_level_cm ?? "--";
    const distance = row.distance ?? row.distance_cm ?? "--";

    const title =
      state === "sensor_error" || ultrasonicError
        ? "⚠️ Smart Flood Sentinel Sensor Error"
        : state === "critical"
          ? "🚨 Critical Flood Alert"
          : "⚠️ Flood Warning";

    const body =
      state === "sensor_error" || ultrasonicError
        ? `Ultrasonic sensor error detected. Distance: ${distance} cm.`
        : `Water level: ${level} cm | State: ${state || "alert"}`;

    const results = [];

    for (const item of tokens) {
      const fcmRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: item.token,
              notification: {
                title,
                body,
              },
              data: {
                state: String(state || ""),
                water_level: String(level),
                distance: String(distance),
              },
            },
          }),
        }
      );

      results.push({
        status: fcmRes.status,
        response: await fcmRes.text(),
      });
    }

    return json({ ok: true, sent: results.length, results });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getFirebaseAccessToken() {
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Firebase service account secrets.");
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const jwt = await createJwt(header, claimSet, privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("Could not get Firebase access token: " + JSON.stringify(data));
  }

  return data.access_token;
}

async function createJwt(header: object, payload: object, privateKeyPem: string) {
  const enc = new TextEncoder();

  const base64url = (input: ArrayBuffer | string) => {
    const bytes =
      typeof input === "string" ? enc.encode(input) : new Uint8Array(input);

    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));

    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    enc.encode(data)
  );

  return `${data}.${base64url(signature)}`;
}