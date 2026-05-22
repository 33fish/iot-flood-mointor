# send-alert-email

Supabase Edge Function for Smart Flood Sentinel email alerts.

It expects either a Supabase Database Webhook payload for an `INSERT` on `readings`, or a direct reading JSON body:

```json
{
  "water_level": 7.5,
  "distance": 42.5,
  "alarm": true,
  "ultrasonic_error": false,
  "created_at": "2026-05-21T11:30:00Z"
}
```

Configuration is hardcoded near the top of `index.ts`:

- `resendApiKey`
- `alertRecipientEmail`
- `emailFrom`
- `waterLevelThresholdCm`
- `criticalWaterLevelThresholdCm`
- `highWaterDistanceThresholdCm`
- `readingsTableName`
