import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const payload = await req.json();
    const row = payload.record || payload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment secrets.");
    }

    const deviceId = String(row.node_id || row.device_id || "node-01");

    const state = String(row.state || row.status || "").toLowerCase().trim();

    const waterLevelRaw =
      row.water_level ??
      row.water_level_cm ??
      row.level_cm ??
      null;

    const waterLevel = Number(waterLevelRaw);

    const distance =
      row.distance ??
      row.distance_cm ??
      row.ultrasonic_distance_cm ??
      "--";

    const moistureDetected =
      isTrue(row.alarm) ||
      isTrue(row.leak_detected) ||
      isTrue(row.leak) ||
      isTrue(row.water_leak);

    const ultrasonicError =
      state === "sensor_error" ||
      state === "sensor-error" ||
      isTrue(row.ultrasonic_error);

    const safeOrDry =
      !moistureDetected &&
      !ultrasonicError &&
      Number.isFinite(waterLevel) &&
      waterLevel < 1;

    // Get existing notification state for this device
    const stateRes = await fetch(
      `${supabaseUrl}/rest/v1/notification_state?device_id=eq.${encodeURIComponent(deviceId)}&select=*`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!stateRes.ok) {
      throw new Error("Could not fetch notification state. HTTP " + stateRes.status);
    }

    const stateRows = await stateRes.json();

    let moistureAlreadyNotified = false;
    let lastBucket = 0;

    if (Array.isArray(stateRows) && stateRows.length > 0) {
      moistureAlreadyNotified = stateRows[0].moisture_notified === true;
      lastBucket = Number(stateRows[0].last_water_level_bucket || 0);
    }

    // Reset when system is dry/safe again
    if (safeOrDry) {
      await saveNotificationState(
        supabaseUrl,
        serviceRoleKey,
        deviceId,
        false,
        0
      );

      return json({
        ok: true,
        skipped: true,
        reset: true,
        reason: "Safe/dry reading, notification state reset",
        waterLevel,
      });
    }

    const notifications: Array<{ title: string; body: string }> = [];

    let newMoistureNotified = moistureAlreadyNotified;
    let newBucket = lastBucket;

    // 1. First notification when moisture is detected
    if (moistureDetected && !moistureAlreadyNotified) {
      notifications.push({
        title: "💧 Moisture Detected",
        body: `Moisture has been detected by ${deviceId}. Monitor the area for possible flooding.`,
      });

      newMoistureNotified = true;
    }

    // 2. Water-level notifications every 3 cm: 3, 6, 9, 12...
    if (Number.isFinite(waterLevel) && waterLevel >= 3) {
      const currentBucket = Math.floor(waterLevel / 3) * 3;

      if (currentBucket > lastBucket) {
        notifications.push({
          title:
            currentBucket >= 9
              ? "🚨 Critical Water Level Alert"
              : "⚠️ Water Level Rising",
          body: `Water level has reached ${currentBucket} cm. Current reading: ${waterLevel.toFixed(1)} cm.`,
        });

        newBucket = currentBucket;
      }
    }

    // 3. Sensor error notification
    if (ultrasonicError) {
      notifications.push({
        title: "⚠️ Smart Flood Sentinel Sensor Error",
        body: `Ultrasonic sensor error detected on ${deviceId}. Distance: ${distance} cm. Please inspect or power-cycle the device.`,
      });
    }

    if (notifications.length === 0) {
      return json({
        ok: true,
        skipped: true,
        reason: "No new notification threshold reached",
        deviceId,
        waterLevel: Number.isFinite(waterLevel) ? waterLevel : null,
        moistureDetected,
        moistureAlreadyNotified,
        lastBucket,
      });
    }

    // Save updated notification state before sending,
    // so repeated webhook calls do not spam the same alert.
    await saveNotificationState(
      supabaseUrl,
      serviceRoleKey,
      deviceId,
      newMoistureNotified,
      newBucket
    );

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
      return json({
        ok: true,
        message: "No notification tokens saved",
        notificationsPrepared: notifications.length,
      });
    }

    const accessToken = await getFirebaseAccessToken();
    const projectId = Deno.env.get("FIREBASE_PROJECT_ID");

    if (!projectId) {
      throw new Error("Missing FIREBASE_PROJECT_ID secret.");
    }

    const results = [];

    for (const notification of notifications) {
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
                  title: notification.title,
                  body: notification.body,
                },
                data: {
                  device_id: deviceId,
                  state: String(state || ""),
                  water_level: Number.isFinite(waterLevel) ? String(waterLevel) : "",
                  distance: String(distance),
                  moisture_detected: String(moistureDetected),
                  last_bucket: String(newBucket),
                },
              },
            }),
          }
        );

        results.push({
          title: notification.title,
          status: fcmRes.status,
          response: await fcmRes.text(),
        });
      }
    }

    return json({
      ok: true,
      deviceId,
      sent: results.length,
      notifications: notifications.length,
      waterLevel: Number.isFinite(waterLevel) ? waterLevel : null,
      moistureDetected,
      previousBucket: lastBucket,
      newBucket,
      results,
    });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});

function isTrue(value: unknown) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  );
}

async function saveNotificationState(
  supabaseUrl: string,
  serviceRoleKey: string,
  deviceId: string,
  moistureNotified: boolean,
  lastWaterLevelBucket: number
) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/notification_state?on_conflict=device_id`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        device_id: deviceId,
        moisture_notified: moistureNotified,
        last_water_level_bucket: lastWaterLevelBucket,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    throw new Error("Could not save notification state. HTTP " + res.status);
  }
}

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