# Smart Flood Sentinel for Residential Security

## Project Report

**Alternative title:** IoT-Based Smart Flood Monitoring and Early Warning System  
**Project type:** IoT embedded system with cloud database and web dashboard  
**Development environment:** VS Code, Arduino/ESP32 firmware, HTML/CSS/JavaScript dashboard, Supabase  
**Submission format:** PDF generated from this Markdown report

## Group Members

| Name | Student ID |
| --- | --- |
| Zunhao Zhang | 24758673 |
| Yukendar Naidu | 24781111 |
| Naveen Kumar Babu | 24858187 |
| Keming Cao | 24458695 |
| Dhruvik Shah | 24574064 |

![Prototype hardware setup](docs/assets/prototype-hardware.jpeg)

## Abstract

Smart Flood Sentinel is an IoT-based residential flood and leak detection system designed to provide early warning of water leaks and rising water levels. The system uses an ESP32/FireBeetle ESP32 board, a digital water leak sensor, and an ultrasonic distance sensor. When water is detected, the device activates local LED and buzzer alerts, measures the water level, and uploads readings to a Supabase database. A web dashboard then displays live system status, water-level trends, sensor distance, and recent alert history.

The project focuses on the practical operation of the physical monitoring device. It combines direct water-contact detection with ultrasonic level estimation, giving better flood-risk awareness than a single-sensor design. The current prototype demonstrates the complete flow from sensing to alerting and cloud monitoring. User registration and user-specific dashboard access are planned as future design improvements rather than part of the current working device scope.

## 1. Introduction

Household water leaks and local flooding are often detected too late. Leaks under sinks, around washing machines, in bathrooms, laundries, or near drainage areas can remain unnoticed until they cause property damage, electrical hazards, mould growth, or costly repairs. Traditional local-only alarms can be missed when residents are away, while remote-only systems may fail to provide immediate local awareness.

Smart Flood Sentinel addresses this problem by combining local alerts with remote monitoring. The device can warn nearby users through LEDs and a buzzer while also sending readings to a cloud database for dashboard viewing. The project is intended as a low-cost residential security and safety prototype that can detect water presence, estimate water-level change, and display recent conditions clearly.

## 2. Aim and Objectives

The aim of this project is to design and implement an IoT-based flood monitoring prototype that can detect water leaks, estimate rising water level, and provide early warnings through both local and cloud-connected feedback.

The main objectives are:

- Detect direct water contact using a digital water leak sensor.
- Measure distance to the water surface using an ultrasonic sensor.
- Calculate estimated water level using the installation height and measured distance.
- Trigger local warning indicators using green/red LEDs and a piezo buzzer.
- Reduce unnecessary power use by entering deep sleep when no water is detected.
- Wake the ESP32 when water is detected.
- Upload water-level, distance, and alarm data to Supabase.
- Display live monitoring data through a web dashboard.
- Prepare the system for future improvements such as user registration, battery backup, notifications, and enclosure design.

## 3. System Overview

The system contains three main layers:

1. **Sensing and embedded control:** The ESP32 reads the water leak sensor and ultrasonic sensor, makes alarm decisions, and controls LEDs and the buzzer.
2. **Cloud data storage:** Sensor readings are uploaded to a Supabase `readings` table through the Supabase REST API.
3. **Dashboard monitoring:** A web dashboard reads recent Supabase records and displays current status, water level, ultrasonic distance, alarm count, and a trend chart.

![Component layout diagram](docs/assets/component-layout.svg)

## 4. Hardware Components

| Component | Purpose |
| --- | --- |
| ESP32 / FireBeetle ESP32 board | Main microcontroller with Wi-Fi support |
| Water leak sensor | Detects direct water contact |
| Ultrasonic distance sensor | Measures the distance between the sensor and water surface |
| Piezo buzzer | Produces local audible alerts |
| Green LED | Indicates normal or active status |
| Red LED | Indicates alarm or warning status |
| Breadboard and jumper wires | Used for prototype wiring |
| Resistors | Used with LED/output circuits |
| USB power | Main power during development and testing |
| 3.7V lithium battery backup | Planned through the FireBeetle onboard JST port |

## 5. Software and Technology Stack

| Area | Technology |
| --- | --- |
| Firmware | Arduino/ESP32 `.ino` program |
| Microcontroller networking | ESP32 Wi-Fi |
| Cloud database | Supabase |
| Cloud interface | Supabase REST API |
| Dashboard frontend | HTML, CSS, JavaScript |
| Charting | Chart.js |
| Development environment | VS Code |
| Optional backend | Flask with SQLite, included in `app.py` |

The active dashboard is implemented in `index.html`. It is titled **Smart Flood Sentinel Dashboard** and uses Supabase plus Chart.js to display live readings and alerts.

## 6. Firmware Pin Configuration

The firmware file is `thefloodmonitor.ino`. The important pin and configuration values are:

```cpp
#define PIN_WATER_TTL  25
#define PIN_TRIG       13
#define PIN_ECHO       14
#define PIN_LED_GREEN   4
#define PIN_LED_RED    17
#define PIN_BUZZER     19
#define CHECK_INTERVAL  3000
#define INSTALL_HEIGHT  50.0f
```

| Firmware Item | Meaning |
| --- | --- |
| `PIN_WATER_TTL` | Digital water sensor input |
| `PIN_TRIG` | Ultrasonic trigger pin |
| `PIN_ECHO` | Ultrasonic echo pin |
| `PIN_LED_GREEN` | Green LED output |
| `PIN_LED_RED` | Red LED output |
| `PIN_BUZZER` | Buzzer output |
| `CHECK_INTERVAL` | Sensor check interval, 3000 ms |
| `INSTALL_HEIGHT` | Sensor mounting height, 50.0 cm |

## 7. Database Design

The project uses Supabase as the cloud database. The main table is `readings`.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `int8` | Unique reading identifier |
| `water_level` | `float8` | Calculated water level in centimetres |
| `distance` | `float8` | Ultrasonic distance reading in centimetres |
| `alarm` | `bool` | Indicates whether the firmware treated the reading as an alarm |
| `created_at` | `timestamptz` | Timestamp of the inserted reading |

The ESP32 uploads records directly to the Supabase REST endpoint. The dashboard fetches the latest records from the same table, ordered by `created_at`.

## 8. Device Operation

![Logic flow diagram](docs/assets/logic-flow.svg)

The device operation is:

1. The ESP32 powers on or wakes from deep sleep.
2. GPIO pins, serial logging, Wi-Fi, LEDs, buzzer, and ultrasonic pins are initialized.
3. The firmware performs a short self-test.
4. If the water sensor is dry, the device enters deep sleep.
5. The water sensor acts as the wake-up trigger.
6. When water is detected, the ESP32 wakes and enters active monitoring.
7. Every 3 seconds, the device checks the water sensor.
8. If water is present, the ultrasonic sensor measures distance.
9. Water level is calculated using:

```text
water_level = max(0, install_height - measured_distance)
```

10. If water is newly detected or the water level rises, the buzzer and red LED are activated.
11. The reading is sent to Supabase with water level, distance, and alarm status.
12. If water is no longer detected, the red LED is switched off and the device returns to deep sleep.

## 9. Alarm and Status Logic

The firmware uses local alarm logic based on water contact and water-level changes.

| Situation | Firmware Response |
| --- | --- |
| No water detected | Green LED remains on and device enters deep sleep |
| Water first detected | Ultrasonic monitoring starts and the buzzer beeps twice |
| First valid level reading | Baseline water level is stored and alarm is triggered |
| Water level rises | Stronger alarm is triggered and alarm count increases |
| Water removed | Red LED turns off and device returns to deep sleep |
| No ultrasonic echo | Invalid distance is ignored for that cycle |

The dashboard classifies readings as:

| Dashboard State | Rule |
| --- | --- |
| Safe | No alarm/leak and water level below warning threshold |
| Warning | Leak/alarm detected or water level at least 5 cm |
| Critical | Water level at least 10 cm |

## 10. Dashboard Features

The dashboard provides a visual interface for monitoring the system remotely. It reads from Supabase every 5 seconds and shows:

- Current water level
- Leak sensor or alarm state
- Ultrasonic distance
- Latest update time
- Device freshness/online state
- Alerts today
- Water-level trend chart
- Recent alert history
- Safe, Warning, and Critical status classification

This makes the system easier to demonstrate because users can see both the live sensor state and recent historical readings.

## 11. Testing and Validation

Testing should verify both normal operation and limit conditions. The most important limit-condition test is the maximum reliable detection distance of the ultrasonic sensor.

| Test Case | Method | Expected Result | Actual Result |
| --- | --- | --- | --- |
| Water contact detection | Touch water sensor to water | ESP32 wakes or enters active monitoring | TBD |
| Dry condition | Remove water from water sensor | Device returns to sleep | TBD |
| Ultrasonic reading | Place target/water surface at known distance | Serial monitor and Supabase show distance | TBD |
| Water-level calculation | Compare measured distance with `50 cm - distance` formula | Dashboard shows calculated water level | TBD |
| First alarm event | Trigger water detection from dry state | Red LED/buzzer activate and alarm upload occurs | TBD |
| Rising level alarm | Reduce measured distance after baseline | Alarm count increases and buzzer activates | TBD |
| Supabase upload | Check `readings` table while device runs | New rows are inserted | TBD |
| Dashboard refresh | Open dashboard while records are inserted | Dashboard updates automatically | TBD |
| Maximum ultrasonic distance | Increase target distance step by step | Maximum stable detection distance is identified | TBD |

### Maximum Distance Test Procedure

1. Mount the ultrasonic sensor at a fixed height and angle.
2. Place a flat target or water surface at a measured distance.
3. Record the distance shown in the serial monitor.
4. Confirm the same reading is uploaded to Supabase.
5. Move the target away in fixed steps such as 5 cm or 10 cm.
6. Repeat readings at each distance.
7. Stop when readings become unstable, missing, or inaccurate.
8. Record the maximum reliable distance as the tested limit condition.

## 12. Comparison With Commercial Devices

| Criteria | Smart Flood Sentinel Prototype | Existing Commercial Flood Devices |
| --- | --- | --- |
| Cost | Low-cost educational prototype | Usually higher due to enclosure, certification, support, and app ecosystem |
| Connectivity | ESP32 Wi-Fi | Wi-Fi, Zigbee, LoRaWAN, cellular, or proprietary hub |
| Sensors | Water leak sensor plus ultrasonic level sensing | Often contact probes, float switches, pressure sensors, or industrial ultrasonic sensors |
| Local alerts | LED indicators and piezo buzzer | Buzzer, siren, mobile push notification, SMS, or smart-home alerts |
| Remote monitoring | Supabase dashboard | Vendor mobile app or cloud portal |
| Customization | Highly customizable source code and database | Usually limited to vendor features |
| Reliability | Prototype stage; needs enclosure and calibration | Production-grade casing, sealing, calibration, and warranty |
| Expandability | Can add multiple nodes and custom alerts | Depends on vendor ecosystem |

The prototype is not intended to replace a certified commercial device yet. Its value is in demonstrating how a low-cost IoT system can combine local alerts, cloud storage, and live dashboard monitoring.

## 13. Limitations

- The current hardware is a breadboard prototype with exposed wiring.
- The device is not yet waterproofed or enclosed.
- Wi-Fi credentials and Supabase API values are currently stored in source files.
- The maximum reliable ultrasonic detection distance still needs to be recorded from testing.
- Battery backup is planned but not fully documented as implemented.
- User registration is planned for future dashboard design rather than part of the current device workflow.

## 14. Future Work

Future improvements include:

- User registration and login for dashboard access.
- User-specific device ownership and monitoring.
- Mobile or email notifications for warning and critical alerts.
- Waterproof enclosure and stable sensor mounting.
- FireBeetle 3.7V lithium battery backup implementation.
- Calibration settings for install height and alert thresholds.
- Multi-node monitoring for multiple rooms or locations.
- Exportable flood event history reports.
- Stronger secret management for Wi-Fi and Supabase keys.

## 15. Conclusion

Smart Flood Sentinel for Residential Security successfully demonstrates an IoT flood monitoring workflow. The ESP32 detects water contact, measures water-level changes using an ultrasonic sensor, activates local alerts, and uploads readings to Supabase. The web dashboard provides live visibility of water level, leak state, distance, alert history, and trends.

The project's key strength is the combined sensing approach. Direct water detection provides immediate leak awareness, while ultrasonic monitoring gives additional information about rising water level. With further testing, waterproofing, battery support, secure configuration, and user-based dashboard access, the prototype can be developed into a more complete residential flood early-warning system.
