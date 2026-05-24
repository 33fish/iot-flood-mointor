import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ReadingRecord = {
  id?: string | number;
  water_level?: number | string | null;
  distance?: number | string | null;
  alarm?: boolean | number | string | null;
  created_at?: string | null;
  ultrasonic_error?: boolean | number | string | null;
};

type AlertType = "water_detected" | "critical_water_level" | "warning_water_level";

type AlertDecision = {
  shouldAlert: boolean;
  alertType: AlertType | null;
  message: string;
  waterLevel: number | null;
  distance: number | null;
  alarm: boolean;
  timestamp: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const resendApiKey = "re_6turgRoW_PkdmkA5dwcqgRRbkgGR3EwMJ";
const alertRecipientEmail = "zzhfisher@outlook.com";
const emailFrom = "Smart Flood Sentinel <onboarding@resend.dev>";
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
      return jsonResponse({ error: "No reading record found in payload" }, 400);
    }

    const decision = evaluateReading(reading);

    if (!decision.shouldAlert || !decision.alertType) {
      return jsonResponse({ status: "ignored", reason: "no_water_detected" });
    }

    const email = buildEmail(decision, reading);
    const emailResult = await sendEmail(email.subject, email.html, email.text);

    return jsonResponse({ status: "sent", email_id: emailResult.id, alert_type: decision.alertType });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});

function extractReading(payload: unknown): ReadingRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  const webhookRecord = data.record;
  if (webhookRecord && typeof webhookRecord === "object") {
    const tableName = String(data.table ?? "");
    const eventType = String(data.type ?? "").toUpperCase();

    if (tableName && tableName !== readingsTableName) return null;
    if (eventType && eventType !== "INSERT") return null;

    return webhookRecord as ReadingRecord;
  }

  return data as ReadingRecord;
}

function evaluateReading(reading: ReadingRecord): AlertDecision {
  const waterLevel = firstNumber(reading.water_level);
  const distance = firstNumber(reading.distance);
  const alarm = parseBoolean(reading.alarm);
  const timestamp = String(reading.created_at ?? new Date().toISOString());

  // Alarm flag or any water detected
  if (alarm || (waterLevel !== null && waterLevel > 0)) {
    let alertType: AlertType = "water_detected";
    let message = "Water has been detected. Please check the monitored area.";

    if (waterLevel !== null && waterLevel >= 10) {
      alertType = "critical_water_level";
      message = "Critical water level detected. Immediate action required.";
    } else if (waterLevel !== null && waterLevel >= 5) {
      alertType = "warning_water_level";
      message = "Warning: water level is rising. Please monitor the situation.";
    }

    return { shouldAlert: true, alertType, message, waterLevel, distance, alarm, timestamp };
  }

  return { shouldAlert: false, alertType: null, message: "No water detected.", waterLevel, distance, alarm, timestamp };
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
  if (!response.ok) throw new Error(`Email provider error: ${response.status}`);
  return { id: String(body.id ?? crypto.randomUUID()) };
}

function buildEmail(decision: AlertDecision, reading: ReadingRecord) {
  const alertLabel = titleCase(decision.alertType ?? "alert");
  const subject = `Smart Flood Sentinel — ${alertLabel}`;
  const waterLevel = formatCm(decision.waterLevel);
  const distance = formatCm(decision.distance);
  const timestamp = formatTimestamp(decision.timestamp);
  const accentColor = decision.alertType === "critical_water_level" ? "#dc2626"
    : decision.alertType === "warning_water_level" ? "#d97706"
    : "#2563eb";

  const text = [
    `Alert: ${alertLabel}`,
    `Message: ${decision.message}`,
    `Water level: ${waterLevel}`,
    `Distance: ${distance}`,
    `Alarm active: ${decision.alarm}`,
    `Timestamp: ${timestamp}`,
    `Reading ID: ${reading.id ?? "n/a"}`,
  ].join("\n");

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#eef3f7;font-family:Arial,sans-serif;color:#102033">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:28px 14px">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dbe5ec;border-radius:8px;overflow:hidden">
              <tr><td style="background:#102033;padding:24px 28px">
                <div style="font-size:12px;text-transform:uppercase;color:#9ed5ff;font-weight:700">Smart Flood Sentinel</div>
                <h1 style="margin:8px 0 0;font-size:24px;color:#fff">Flood Alert</h1>
              </td></tr>
              <tr><td style="padding:24px 28px">
                <span style="background:${accentColor};color:#fff;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700">${escapeHtml(alertLabel)}</span>
                <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#26394a">${escapeHtml(decision.message)}</p>
              </td></tr>
              <tr><td style="padding:0 28px 24px">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe5ec;border-radius:8px;overflow:hidden">
                  ${detailRow("Water level", waterLevel)}
                  ${detailRow("Distance", distance)}
                  ${detailRow("Alarm active", decision.alarm ? "Yes" : "No")}
                  ${detailRow("Timestamp", timestamp)}
                  ${detailRow("Reading ID", String(reading.id ?? "n/a"))}
                </table>
              </td></tr>
              <tr><td style="padding:16px 28px;background:#f7fafc;border-top:1px solid #dbe5ec;font-size:12px;color:#587084">
                This alert was triggered automatically when a new reading was inserted into Supabase.
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;

  return { subject, html, text };
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #dbe5ec;font-size:13px;color:#587084;font-weight:700">${escapeHtml(label)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #dbe5ec;font-size:13px;color:#102033;text-align:right">${escapeHtml(value)}</td>
    </tr>
  `;
}

function firstNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

function formatCm(value: number | null) {
  return value === null ? "Not provided" : `${value.toFixed(1)} cm`;
}

function formatTimestamp(value: string) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toISOString();
}

function titleCase(value: string) {
  return value.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function escapeHtml(value: string) {
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
