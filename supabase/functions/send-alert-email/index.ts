import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ReadingRecord = {
  id?: string | number;
  water_level?: number | string | null;
  distance?: number | string | null;
  alarm?: boolean | number | string | null;
  created_at?: string | null;
  ultrasonic_error?: boolean | number | string | null;
};

type AlertType = "alarm" | "critical_water_level" | "warning_water_level" | "high_water_by_distance";

type AlertDecision = {
  shouldAlert: boolean;
  alertType: AlertType | null;
  message: string;
  waterLevel: number | null;
  distance: number | null;
  alarm: boolean;
  ultrasonicError: boolean;
  timestamp: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resendApiKey = "PASTE_YOUR_RESEND_API_KEY_HERE";
const alertRecipientEmail = "devep1210@gmail.com";
const emailFrom = "Smart Flood Sentinel <onboarding@resend.dev>";
const waterLevelThresholdCm = 5;
const criticalWaterLevelThresholdCm = 10;
const highWaterDistanceThresholdCm = 15;
const readingsTableName = "readings";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json();
    const reading = extractReading(payload);

    if (!reading) {
      console.warn("No reading record found in request payload", payload);
      return jsonResponse({ error: "No reading record found in payload" }, 400);
    }

    const decision = evaluateReading(reading);

    if (!decision.shouldAlert || !decision.alertType) {
      console.info("Reading is below alert thresholds", {
        reading_id: reading.id,
        water_level: decision.waterLevel,
        distance: decision.distance,
        alarm: decision.alarm,
      });
      return jsonResponse({ status: "ignored", reason: "reading_below_threshold", decision });
    }

    const email = buildEmail(decision, reading);
    const emailResult = await sendEmail(email.subject, email.html, email.text);

    console.info("Alert email sent", {
      alert_type: decision.alertType,
      email_id: emailResult.id,
    });

    return jsonResponse({
      status: "sent",
      email_id: emailResult.id,
      alert_type: decision.alertType,
    });
  } catch (error) {
    console.error("send-alert-email failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

function extractReading(payload: unknown): ReadingRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  const webhookRecord = data.record;
  if (webhookRecord && typeof webhookRecord === "object") {
    const tableName = String(data.table ?? data.table_name ?? "");
    const eventType = String(data.type ?? data.eventType ?? data.event ?? "").toUpperCase();

    if (tableName && tableName !== readingsTableName) {
      console.warn("Ignoring webhook from unexpected table", { tableName, readingsTableName });
      return null;
    }

    if (eventType && eventType !== "INSERT") {
      console.warn("Ignoring non-insert webhook event", { eventType });
      return null;
    }

    return webhookRecord as ReadingRecord;
  }

  return data as ReadingRecord;
}

function evaluateReading(reading: ReadingRecord): AlertDecision {
  const waterLevel = firstNumber(reading.water_level);
  const distance = firstNumber(reading.distance);
  const alarm = parseBoolean(reading.alarm);
  const ultrasonicError = parseBoolean(reading.ultrasonic_error);
  const timestamp = String(reading.created_at ?? new Date().toISOString());

  if (alarm) {
    return {
      shouldAlert: true,
      alertType: "alarm",
      message: "The device alarm is active. Check the monitored area immediately.",
      waterLevel,
      distance,
      alarm,
      ultrasonicError,
      timestamp,
    };
  }

  if (waterLevel !== null && waterLevel >= criticalWaterLevelThresholdCm) {
    return {
      shouldAlert: true,
      alertType: "critical_water_level",
      message: "Critical flood risk detected because the water level is above the critical threshold.",
      waterLevel,
      distance,
      alarm,
      ultrasonicError,
      timestamp,
    };
  }

  if (waterLevel !== null && waterLevel >= waterLevelThresholdCm) {
    return {
      shouldAlert: true,
      alertType: "warning_water_level",
      message: "Warning condition detected because the water level is above the configured threshold.",
      waterLevel,
      distance,
      alarm,
      ultrasonicError,
      timestamp,
    };
  }

  if (
    highWaterDistanceThresholdCm !== null &&
    distance !== null &&
    !ultrasonicError &&
    distance <= highWaterDistanceThresholdCm
  ) {
    return {
      shouldAlert: true,
      alertType: "high_water_by_distance",
      message: "Warning condition detected because the measured distance indicates high water.",
      waterLevel,
      distance,
      alarm,
      ultrasonicError,
      timestamp,
    };
  }

  return {
    shouldAlert: false,
    alertType: null,
    message: "Reading is below alert thresholds.",
    waterLevel,
    distance,
    alarm,
    ultrasonicError,
    timestamp,
  };
}

async function sendEmail(subject: string, html: string, text: string): Promise<{ id: string }> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [alertRecipientEmail],
      subject,
      html,
      text,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("Email provider returned an error", {
      status: response.status,
      body,
    });
    throw new Error(`Email provider error: ${response.status}`);
  }

  return { id: String(body.id ?? crypto.randomUUID()) };
}

function buildEmail(decision: AlertDecision, reading: ReadingRecord) {
  const alertLabel = titleCase(decision.alertType ?? "alert");
  const subject = `Smart Flood Sentinel ${alertLabel}`;
  const timestamp = formatTimestamp(decision.timestamp);
  const waterLevel = formatCm(decision.waterLevel);
  const distance = formatCm(decision.distance);
  const alarmStatus = decision.alarm ? "Active" : "Inactive";
  const ultrasonicStatus = decision.ultrasonicError ? "Error reported" : "Normal";
  const accentColor = alertColor(decision.alertType);

  const text = [
    `Alert type: ${alertLabel}`,
    `Water level: ${waterLevel}`,
    `Distance: ${distance}`,
    `Alarm status: ${alarmStatus}`,
    `Ultrasonic status: ${ultrasonicStatus}`,
    `Timestamp: ${timestamp}`,
    `Message: ${decision.message}`,
    `Reading ID: ${reading.id ?? "not provided"}`,
  ].join("\n");

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#eef3f7;font-family:Arial,Helvetica,sans-serif;color:#102033">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#eef3f7">
          <tr>
            <td align="center" style="padding:28px 14px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border-collapse:collapse;background:#ffffff;border:1px solid #dbe5ec;border-radius:8px;overflow:hidden">
                <tr>
                  <td style="background:#102033;padding:24px 28px;color:#ffffff">
                    <div style="font-size:13px;letter-spacing:0.6px;text-transform:uppercase;color:#9ed5ff;font-weight:700">Smart Flood Sentinel</div>
                    <h1 style="margin:8px 0 0;font-size:26px;line-height:1.25;font-weight:800;color:#ffffff">Flood Alert Detected</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:26px 28px 10px">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                      <tr>
                        <td style="background:${accentColor};color:#ffffff;border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700">${escapeHtml(alertLabel)}</td>
                      </tr>
                    </table>
                    <p style="margin:18px 0 0;font-size:17px;line-height:1.6;color:#26394a">${escapeHtml(decision.message)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px 8px">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                      <tr>
                        ${metricCell("Water level", waterLevel, "#0f766e")}
                        ${metricCell("Distance", distance, "#2563eb")}
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 24px">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #dbe5ec;border-radius:8px;overflow:hidden">
                      ${detailRow("Alarm status", alarmStatus)}
                      ${detailRow("Ultrasonic status", ultrasonicStatus)}
                      ${detailRow("Timestamp", timestamp)}
                      ${detailRow("Reading ID", String(reading.id ?? "not provided"))}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px;background:#f7fafc;border-top:1px solid #dbe5ec;color:#587084;font-size:13px;line-height:1.5">
                    This message was generated automatically after a new reading was inserted into Supabase.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, html, text };
}

function metricCell(label: string, value: string, color: string) {
  return `
    <td width="50%" style="padding:0 6px 0 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f7fafc;border:1px solid #dbe5ec;border-radius:8px">
        <tr>
          <td style="padding:16px">
            <div style="font-size:12px;line-height:1.4;color:#587084;text-transform:uppercase;font-weight:700">${escapeHtml(label)}</div>
            <div style="margin-top:6px;font-size:24px;line-height:1.2;color:${color};font-weight:800">${escapeHtml(value)}</div>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid #dbe5ec;font-size:14px;color:#587084;font-weight:700;background:#fbfdff">${escapeHtml(label)}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #dbe5ec;font-size:14px;color:#102033;text-align:right">${escapeHtml(value)}</td>
    </tr>
  `;
}

function alertColor(alertType: AlertType | null): string {
  if (alertType === "critical_water_level" || alertType === "alarm") return "#dc2626";
  if (alertType === "high_water_by_distance") return "#d97706";
  return "#2563eb";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function formatCm(value: number | null): string {
  return value === null ? "Not provided" : `${value.toFixed(1)} cm`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
