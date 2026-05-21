# Smart Flood Sentinel for Residential Security

## Project Overview

Smart Flood Sentinel is an IoT-based residential flood and leak detection prototype built around an ESP32/FireBeetle ESP32 microcontroller. The device detects the presence of water, measures the distance from the ultrasonic sensor to the water surface, calculates the current water level, triggers local alerts using LEDs and a buzzer, and uploads live readings to Supabase for storage and dashboard display.

The main focus of the project is to make the physical device run correctly and reliably under flood-detection conditions. User registration can be included as a future design plan, but the current implementation is centered on embedded sensing, alerting, data upload, and live monitoring.

![Prototype hardware setup](docs/assets/prototype-hardware.jpeg)

## System Purpose

Flooding can develop quickly in low-lying areas, drains, rooms, basements, and other monitored spaces. A simple IoT flood monitor can provide early warning by detecting water contact and tracking the change in water level over time. This prototype demonstrates how a low-cost ESP32 device can combine local alarm feedback with cloud-based logging.

## Main Project Specifications

| Category | Specification |
| --- | --- |
| Controller | ESP32 / FireBeetle ESP32 development board |
| Firmware file | `thefloodmonitor.ino` |
| Water contact input | TTL water sensor on GPIO 25 |
| Distance measurement | Ultrasonic sensor using TRIG GPIO 13 and ECHO GPIO 14 |
| Visual alert | Green LED on GPIO 4, red LED on GPIO 17 |
| Audio alert | Buzzer on GPIO 19 |
| Reading interval | 3000 ms |
| Configured install height | 50.0 cm |
| Water level formula | `water_level = max(0, install_height - distance)` |
| Cloud database | Supabase |
| Supabase table | `readings` |
| Dashboard | `index.html`, polling Supabase every 5 seconds |
| Optional backend | Flask server in `app.py` with local SQLite endpoints |

## Component Overview

![Component layout diagram](docs/assets/component-layout.svg)

| Component | Role in the System | Connected Pins / Interface |
| --- | --- | --- |
| ESP32 | Main controller. Reads sensors, controls outputs, connects to Wi-Fi, and posts readings to Supabase. | Wi-Fi + GPIO pins |
| Water sensor | Detects whether water is present. It is also used as the wake-up source from deep sleep. | GPIO 25 |
| Ultrasonic sensor | Measures distance from the mounted sensor to the water surface. | TRIG GPIO 13, ECHO GPIO 14 |
| Green LED | Indicates normal/safe status and blinks during active monitoring. | GPIO 4 |
| Red LED | Indicates warning/alarm status and blinks/beeps with alarm events. | GPIO 17 |
| Buzzer | Gives local audible warning when water is detected or rising. | GPIO 19 |
| Supabase database | Stores telemetry records from the ESP32. | REST API |
| Web dashboard | Displays current state, recent readings, water-level trend, and alert events. | Supabase REST API |

## Supabase Database Design

The current Supabase database uses a `readings` table.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | `int8` | Unique row identifier |
| `water_level` | `float8` | Calculated water level in centimetres |
| `distance` | `float8` | Ultrasonic distance reading in centimetres |
| `alarm` | `bool` | Whether the device considered the reading an alarm event |
| `created_at` | `timestamptz` | Timestamp of the inserted reading |

The ESP32 sends data directly to the Supabase REST endpoint using an HTTP POST request. The dashboard reads from the same table using a REST query ordered by `created_at`.

## Firmware Process

![Logic flow diagram](docs/assets/logic-flow.svg)

The firmware follows this process:

1. The ESP32 starts and initializes serial output, GPIO pins, LEDs, buzzer, ultrasonic sensor pins, and Wi-Fi.
2. The firmware runs a short self-test using the buzzer and LED outputs.
3. If no water is detected, the ESP32 enters deep sleep to reduce power usage.
4. The water sensor is configured as a wake-up source. When water is detected, the ESP32 wakes and activates monitoring mode.
5. In monitoring mode, the device checks the water sensor every 3 seconds.
6. If the sensor is wet, the ultrasonic sensor measures distance.
7. The water level is calculated using the configured installation height of 50 cm.
8. If water is newly detected, or if the calculated water level rises compared with the previous reading, the red LED and buzzer are triggered.
9. Each valid reading is uploaded to Supabase with `water_level`, `distance`, and `alarm`.
10. If water is no longer detected, the device switches off the red LED and returns to deep sleep.

## Alarm Logic

The firmware treats the following situations as alarm events:

| Condition | Device Response |
| --- | --- |
| Water is first detected | Starts ultrasonic monitoring, uploads an initial reading, and beeps twice |
| First valid water-level measurement after detection | Sets baseline level and triggers an alarm |
| Water level rises compared with the previous level | Triggers a stronger alarm and updates the stored level |
| Water disappears | Stops warning state and enters deep sleep |
| No ultrasonic echo is received | Ignores that distance reading and waits for the next cycle |

The dashboard also classifies readings visually:

| Dashboard State | Rule Used in `index.html` |
| --- | --- |
| Safe | No leak/alarm and water level below warning range |
| Warning | Leak/alarm detected or water level at least 5 cm |
| Critical | Water level at least 10 cm |

## Data Flow

The full data path is:

```text
Water contact sensor + ultrasonic sensor
        |
        v
ESP32 firmware
        |
        v
Calculate water level and alarm status
        |
        v
HTTP POST to Supabase readings table
        |
        v
Dashboard fetches latest records
        |
        v
Live status, trend chart, distance, alarm count
```

## Dashboard and Software Files

| File | Description |
| --- | --- |
| `thefloodmonitor.ino` | Main ESP32 firmware for sensing, alarm control, sleep/wake behavior, and Supabase upload |
| `index.html` | Frontend dashboard that reads Supabase data and displays live telemetry |
| `app.py` | Flask backend with local SQLite telemetry endpoints; useful as an alternate/local server design |
| `requirements.txt` | Python dependencies for Flask backend |
| `Procfile` | Deployment process command |

The active dashboard code in `index.html` connects to Supabase directly and reads the latest 30 records from the `readings` table. It displays:

- Current water level
- Water contact or alarm state
- Last updated time
- Device freshness status
- Ultrasonic distance
- Alarm events
- Water-level trend chart

## Testing Plan

The most important limit-condition test for this project is the maximum reliable detection distance of the ultrasonic sensor. This should be tested experimentally because the reliable range depends on the sensor model, surface angle, wiring stability, power supply, and environmental noise.

| Test | Method | Expected Result | Actual Result |
| --- | --- | --- | --- |
| Water contact detection | Touch water sensor to water and observe serial monitor/LED/buzzer | ESP32 wakes or enters active monitoring mode | TBD |
| Dry condition | Remove water from sensor | Device returns to sleep after detecting dry state | TBD |
| Ultrasonic close-range reading | Place water/object close to sensor | Distance decreases and water level increases | TBD |
| Maximum reliable ultrasonic distance | Move target away in measured steps until readings fail or become unstable | Identify maximum stable distance | TBD |
| Alarm on first detection | Trigger water contact sensor | Buzzer and red LED activate | TBD |
| Alarm on rising water level | Decrease measured distance after baseline reading | Alarm triggers again when water level increases | TBD |
| Supabase upload | Watch `readings` table while device is active | New rows are inserted with level, distance, alarm, timestamp | TBD |
| Dashboard update | Open dashboard while readings are inserted | UI updates within polling interval | TBD |

### Suggested Maximum Distance Test Procedure

1. Mount the ultrasonic sensor at a fixed height.
2. Place a flat target or water surface at a known distance.
3. Record the distance shown in the serial monitor and Supabase.
4. Increase the distance in fixed steps, such as 5 cm or 10 cm.
5. Mark the point where readings become missing, noisy, or inaccurate.
6. Repeat the test at least three times and average the maximum stable distance.
7. Use the result as the device's tested operating limit.

## Comparison With Commercial Flood Monitoring Devices

| Feature | This Prototype | Typical Commercial Device |
| --- | --- | --- |
| Cost | Low-cost educational prototype | Higher cost due to enclosure, certification, app, and support |
| Connectivity | Wi-Fi through ESP32 | Wi-Fi, LoRaWAN, Zigbee, cellular, or proprietary gateway |
| Detection | Water contact plus ultrasonic distance measurement | Usually water contact, float switch, pressure sensor, or industrial ultrasonic sensing |
| Local alert | LEDs and buzzer | Buzzer, siren, mobile push alerts, SMS, or control-panel alert |
| Cloud storage | Supabase table | Vendor cloud platform |
| Dashboard | Custom HTML dashboard | Manufacturer app or web portal |
| Reliability | Prototype-level, depends on wiring and calibration | Production enclosure, waterproofing, calibration, and warranty |
| Expandability | Easy to modify code and add sensors | Often limited by vendor ecosystem |

## Current Limitations

- The prototype wiring is exposed and should be placed in an enclosure for real-world deployment.
- The Supabase API key and Wi-Fi credentials are currently stored directly in source files. For a production design, secrets should be moved to environment variables, firmware configuration, or a protected build process.
- The ultrasonic maximum reliable distance still needs to be recorded from physical testing.
- The current user-registration system is not part of the working device flow and should be described as a future enhancement.
- Long-term waterproofing, power backup, and outdoor durability are not yet implemented.

## Future Design Plans

- Add user registration and login for dashboard access.
- Add user-specific devices so each user can monitor their own flood sensor.
- Add mobile notifications or email alerts when alarm readings are inserted.
- Add a waterproof enclosure and stable mounting bracket.
- Add battery backup or low-power deployment mode.
- Add calibration settings for installation height and alarm thresholds.
- Add multiple nodes for monitoring more than one location.
- Add exportable reports for historical flood events.

## Conclusion

Smart Flood Sentinel demonstrates a working embedded flood-detection pipeline. The ESP32 detects water, measures level changes using an ultrasonic sensor, gives local warnings through LEDs and a buzzer, and uploads telemetry to Supabase. The dashboard then provides a readable view of live status, distance, water level, and alarm events.

The strongest part of the project is the end-to-end device workflow: sensor input, local decision-making, cloud logging, and dashboard visualization. The next major step is to complete limit-condition testing, especially the maximum reliable ultrasonic detection distance, and then improve the design for real deployment using enclosure protection, secure configuration, and user-based access.
