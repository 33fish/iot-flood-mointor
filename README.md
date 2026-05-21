# Smart Flood Sentinel

IoT flood/leak detection prototype using an ESP32, Supabase, and a live dashboard.

The device uploads sensor readings to the Supabase `readings` table with:

- `id`
- `water_level`
- `distance`
- `alarm`
- `created_at`

The dashboard in `index.html` reads those records directly from Supabase.

## Email Alert Service

This project includes a Supabase Edge Function at:

```text
supabase/functions/send-alert-email/index.ts
```

The function sends an email when a new reading indicates danger:

- `alarm` is `true`
- `water_level` is at or above the warning threshold
- `water_level` is at or above the critical threshold
- optional `distance` threshold indicates high water

## Email Provider

The Edge Function uses Resend because it works over HTTPS and is reliable in Supabase Edge Functions. Edit the configuration constants near the top of `supabase/functions/send-alert-email/index.ts`.

Do not commit email API keys, Gmail app passwords, SMTP credentials, or Wi-Fi passwords.

## Deploy The Function

```bash
supabase functions deploy send-alert-email
```

## Connect New Readings To Email Alerts

Recommended setup:

1. Open Supabase Dashboard.
2. Go to Database Webhooks.
3. Create a webhook for table `public.readings`.
4. Choose event `INSERT`.
5. Set the HTTP method to `POST`.
6. Set the URL to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-alert-email
```

7. Add the authorization header:

```text
Authorization: Bearer YOUR_SUPABASE_ANON_OR_SERVICE_TOKEN
```

The function will receive the inserted row as `record`, evaluate it, and send the email.

You can also call the function manually after inserting sensor data:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-alert-email" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_OR_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"water_level":7.5,"distance":42.5,"alarm":true,"created_at":"2026-05-21T11:30:00Z"}'
```

## Local Development

Run the function locally:

```bash
supabase functions serve send-alert-email
```

## Existing Files

- `thefloodmonitor.ino`: ESP32 firmware for sensing, buzzer/LED alarm, and Supabase upload.
- `index.html`: dashboard that reads recent Supabase readings.
- `app.py`: alternate/local Flask backend with SQLite telemetry endpoints.
- `supabase/functions/send-alert-email`: email alert Edge Function.
