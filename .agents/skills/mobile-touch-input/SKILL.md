---
name: mobile-touch-input
description: >-
  Provides end-to-end guidance for mobile Left/Right touch controls, keyboard fallback, WebSocket IMU sensor streaming (Raspberry Pi & ESP32/M5Stack AtomS3), and third-person follow camera framing. Use when implementing or debugging touch, hardware controllers, or camera controls.
---

# Mobile Touch Input & Hardware Controller Skill

This skill details the architecture and implementation of responsive Left/Right touch controls, keyboard fallback, hardware motion controller integration (Raspberry Pi I2C & ESP32 Wi-Fi), and the third-person follow camera system.

---

## 1. Multi-Modal Input Abstraction Layer

The game accepts lateral steering intent $u_{\text{in}} \in [-1.0, 1.0]$ across four seamlessly blended input channels:

### 1. Split-Screen Dual-Zone Touch (Mobile & Tablets)
*   **Left Half Screen**: Steers the horse left ($u_{\text{in}} = 1.0$ under swapped mapping).
*   **Right Half Screen**: Steers the horse right ($u_{\text{in}} = -1.0$ under swapped mapping).
*   **No Active Touches**: $u_{\text{in}} = 0.0$ (springs back to center).

### 2. Desktop Keyboard Fallback
*   `KeyA` / `ArrowLeft` and `KeyD` / `ArrowRight`.

### 3. Raspberry Pi GPIO I2C Accelerometer
*   Local WebSocket client connects to `ws://localhost:8080` served by `scripts/sensor_bridge.py`.
*   Reads MPU-6050 / ADXL345 tilt angles at $50\text{ Hz}$ with low-pass exponential smoothing.

### 4. Wireless ESP32 / M5Stack AtomS3 (C126) Controller
*   Onboard Bosch BMI270 IMU samples roll angle at $50\text{ Hz}$ and transmits 8-byte packed binary UDP datagrams (`[0x4552, seq, rst, steer]`) to port `8080`.
*   Configured easily via captive portal (`AtomS3-Setup` AP at `192.168.4.1`) or runtime HTTP dashboard (`http://<atom_ip>/set_target`).
*   The host bridge (`scripts/sensor_bridge.py`) relays incoming UDP datagrams to browser clients connected via WebSocket (`ws://<host>:8080`).
*   Physical screen push-button triggers instant game restart events (`{"type": "button", "action": "restart"}`).

```typescript
export class InputManager {
  private steerValue = 0;
  private ws: WebSocket | null = null;
  public isSensorConnected = false;
  public onButtonAction?: (action: string) => void;

  private initSensorWebSocket(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const sensorHost = urlParams.get('sensor') || window.location.hostname || 'localhost';
    const wsUrl = `ws://${sensorHost}:8080`;

    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.steer !== undefined) {
        this.steerValue = data.steer;
      } else if (data.type === 'button' && this.onButtonAction) {
        this.onButtonAction(data.action);
      }
    };
  }
}
```

---

## 2. Follow Camera Specifications

*   **Rigid Saddle Anchor**: Follows $4.6\text{m}$ behind horse girth at height $2.15\text{m}$.
*   **Level Horizon**: `camera.up.set(0, 1, 0)` eliminates disorienting camera roll.
*   **Dynamic FOV Warp**: Dynamically expands from $66^\circ$ at base speed ($18\text{ m/s}$) up to $78^\circ$ at top speed ($30\text{ m/s}$).
