# Smart Flood Sentinel for Residential Security

## PDF Presentation Content

This file is designed to be submitted or exported as a PDF presentation handout. It does not require a PowerPoint file.

### Slide 1: Title

**Smart Flood Sentinel for Residential Security**  
IoT-Based Smart Flood Monitoring and Early Warning System

Presented by:

| Name | Student ID |
| --- | --- |
| Zunhao Zhang | 24758673 |
| Yukendar Naidu | 24781111 |
| Naveen Kumar Babu | 24858187 |
| Keming Cao | 24458695 |
| Dhruvik Shah | 24574064 |

**Visual:** Prototype hardware photo  
![Prototype hardware setup](docs/assets/prototype-hardware.jpeg)

**Speaker notes:**  
Introduce the project as an IoT flood and leak detection prototype for residential safety. Mention that the current focus is the working physical device, sensor logic, Supabase data logging, and live dashboard.

---

### Slide 2: Problem Statement

**Problem:** Household leaks and small floods are often detected too late.

- Leaks can occur under sinks, near washing machines, bathrooms, laundries, or drainage areas.
- Small leaks may remain unnoticed until they cause property damage.
- Local-only alarms can be missed when residents are away.
- Remote-only systems may not provide immediate warning near the device.

**Speaker notes:**  
Explain that the project targets early warning. The system combines local alerts with remote monitoring so that users can respond faster.

---

### Slide 3: Project Aim

**Aim:** Build a low-cost IoT flood monitoring system that detects water, monitors rising water level, triggers local alerts, and uploads readings for dashboard monitoring.

**Objectives:**

- Detect water contact.
- Measure distance using an ultrasonic sensor.
- Estimate water level.
- Trigger LED and buzzer alerts.
- Store readings in Supabase.
- Display live status and trends on a web dashboard.

**Speaker notes:**  
Keep this slide focused on the working device. Mention that user registration is a future design plan, not the central current implementation.

---

### Slide 4: System Components

**Hardware used:**

- ESP32 / FireBeetle ESP32 board
- Water leak sensor
- Ultrasonic distance sensor
- Piezo buzzer
- Green and red LEDs
- Breadboard, jumper wires, resistors
- USB power
- Planned 3.7V lithium battery backup

**Visual:** Component overview diagram  
![Component layout diagram](docs/assets/component-layout.svg)

**Speaker notes:**  
Explain that the ESP32 is the main controller. The water sensor detects direct contact, while the ultrasonic sensor estimates level by measuring distance.

---

### Slide 5: Technical Stack

**Firmware and hardware control:**

- Arduino / ESP32 `.ino`
- ESP32 Wi-Fi
- Deep sleep and wake-up logic

**Cloud and dashboard:**

- Supabase database
- Supabase REST API
- HTML, CSS, JavaScript
- Chart.js for trend chart
- VS Code for development

**Speaker notes:**  
Mention that the dashboard file is `index.html` and the firmware file is `thefloodmonitor.ino`.

---

### Slide 6: Firmware Pin Configuration

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

**Key point:**  
The water level is calculated using:

```text
water_level = install_height - measured_distance
```

**Speaker notes:**  
Explain that the configured install height is 50 cm. If the measured distance decreases, the calculated water level increases.

---

### Slide 7: Device Logic Flow

**Main process:**

1. ESP32 starts or wakes.
2. If dry, it enters deep sleep.
3. Water sensor wakes the ESP32 when water is detected.
4. Ultrasonic sensor measures distance.
5. Firmware calculates water level.
6. LEDs and buzzer provide local alert.
7. Reading is uploaded to Supabase.
8. Dashboard displays live state.

**Visual:** Logic flow diagram  
![Logic flow diagram](docs/assets/logic-flow.svg)

**Speaker notes:**  
This is the core slide. Walk through the exact device flow from dry state to active alert state.

---

### Slide 8: Supabase Database

**Table:** `readings`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | `int8` | Unique reading ID |
| `water_level` | `float8` | Calculated level in cm |
| `distance` | `float8` | Ultrasonic distance in cm |
| `alarm` | `bool` | Alarm status |
| `created_at` | `timestamptz` | Reading timestamp |

**Speaker notes:**  
Explain that the ESP32 posts data directly to Supabase. The dashboard reads the latest records from this table.

---

### Slide 9: Dashboard Features

**Dashboard displays:**

- Current water level
- Leak/alarm state
- Ultrasonic distance
- Alerts today
- Water-level trend chart
- Recent alert history
- Safe, Warning, and Critical status

**Speaker notes:**  
Mention Chart.js is used for the trend chart. The dashboard polls Supabase every 5 seconds.

---

### Slide 10: Alert Logic

| Condition | Response |
| --- | --- |
| Dry sensor | Device sleeps |
| Water first detected | Wake, beep, start monitoring |
| First valid water-level reading | Store baseline and trigger alarm |
| Water level rises | Increase alarm count and beep |
| Water removed | Return to sleep |

**Dashboard states:**

- **Safe:** no leak/alarm
- **Warning:** leak/alarm or level at least 5 cm
- **Critical:** level at least 10 cm

**Speaker notes:**  
Explain the difference between firmware alarm logic and dashboard classification. The firmware reacts to detection and rising level; the dashboard gives readable safety status.

---

### Slide 11: Testing and Limit Conditions

**Testing focus:**

- Water sensor detection
- Dry-state sleep behavior
- Ultrasonic distance reading
- Water-level calculation
- Buzzer and LED alarm response
- Supabase upload
- Dashboard refresh
- Maximum reliable ultrasonic detection distance

**Limit-condition test:**  
Move the target/water surface away in fixed steps until ultrasonic readings become unstable or unavailable.

**Speaker notes:**  
Be clear that the main limit-condition test is maximum ultrasonic detection distance. Add your measured final value once testing is complete.

---

### Slide 12: Comparison With Commercial Devices

| Feature | Prototype | Commercial Devices |
| --- | --- | --- |
| Cost | Low-cost prototype | Higher cost |
| Alerts | LED + buzzer + dashboard | App, buzzer, SMS, siren |
| Connectivity | ESP32 Wi-Fi | Wi-Fi, Zigbee, LoRaWAN, cellular |
| Sensors | Leak + ultrasonic | Contact, float, pressure, ultrasonic |
| Customization | Fully editable | Vendor-limited |
| Reliability | Prototype stage | Production enclosure and certification |

**Speaker notes:**  
Explain that commercial devices are more robust, but this prototype is valuable because it is low-cost, customizable, and demonstrates the full sensing-to-dashboard workflow.

---

### Slide 13: Challenges Faced

**Main challenges:**

- Combining two sensor types in one logic flow.
- Managing sleep and wake-up behavior.
- Stabilizing ultrasonic readings.
- Handling no-echo conditions.
- Sending valid JSON data to Supabase.
- Keeping dashboard values consistent with firmware calculations.
- Wiring and prototype reliability on a breadboard.

**Speaker notes:**  
Use this slide to show engineering effort. Mention that ultrasonic sensors can be affected by distance, angle, and surface reflection.

---

### Slide 14: Limitations and Future Work

**Current limitations:**

- Breadboard prototype with exposed wiring.
- Not yet waterproofed or enclosed.
- Battery backup planned but not fully completed.
- Maximum ultrasonic distance still needs final measured result.
- Credentials are stored in source during prototype stage.

**Future work:**

- User registration and login.
- User-specific device monitoring.
- Mobile/email notifications.
- Waterproof enclosure.
- Battery backup through FireBeetle JST port.
- Multi-node monitoring.

**Speaker notes:**  
Frame user registration as a future dashboard design plan. Keep the current project focus on the working flood-monitoring device.

---

### Slide 15: Conclusion

**Smart Flood Sentinel demonstrates:**

- Water contact detection
- Ultrasonic water-level monitoring
- Local LED and buzzer alerts
- Supabase data logging
- Live web dashboard monitoring
- A clear path toward a complete residential flood-warning system

**Final message:**  
The project successfully connects physical sensing, embedded decision-making, cloud storage, and dashboard visualization into one working IoT prototype.

**Speaker notes:**  
End by emphasizing the combined sensing approach and the complete data flow from device to dashboard.
