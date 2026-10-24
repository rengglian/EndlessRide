export class InputManager {
  private steerValue = 0; // [-1.0 (Left) to 1.0 (Right)]
  private leftPressed = false;
  private rightPressed = false;
  private activeTouchId: number | null = null;

  // Accelerometer / IMU Sensor WebSocket Bridge (Raspberry Pi or Wireless ESP32)
  private ws: WebSocket | null = null;
  public isSensorConnected = false;
  private sensorSteer = 0;
  public onButtonAction?: (action: string) => void;

  private reconnectTimeoutId: number | null = null;
  private isDisposed = false;

  constructor() {
    this.bindEvents();
    this.initSensorWebSocket();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  private initSensorWebSocket(): void {
    if (this.isDisposed) return;

    // Support custom ESP32 IP via URL query (e.g. http://localhost:3000/?sensor=192.168.1.50)
    const urlParams = new URLSearchParams(window.location.search);
    const sensorHost = urlParams.get('sensor') || window.location.hostname || 'localhost';
    const wsUrl = `ws://${sensorHost}:8080`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.isSensorConnected = true;
        console.info(`[Sensor] Connected to Sensor Bridge at ${wsUrl}`);
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && typeof data.steer === 'number') {
            this.sensorSteer = data.steer;
            this.updateSteer();
          } else if (data && data.type === 'button' && this.onButtonAction) {
            this.onButtonAction(data.action || 'click');
          }
        } catch {
          // Ignore parse errors
        }
      };
      this.ws.onclose = () => {
        this.isSensorConnected = false;
        if (!this.isDisposed) {
          // Retry connection every 4 seconds
          this.reconnectTimeoutId = window.setTimeout(() => this.initSensorWebSocket(), 4000);
        }
      };
      this.ws.onerror = () => {
        this.isSensorConnected = false;
      };
    } catch {
      this.isSensorConnected = false;
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.leftPressed = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.rightPressed = true;
    this.updateSteer();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.leftPressed = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.rightPressed = false;
    this.updateSteer();
  };

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    this.activeTouchId = touch.identifier;

    // Left half: -1.0, Right half: +1.0
    const midX = window.innerWidth * 0.5;
    this.steerValue = touch.clientX < midX ? -1.0 : 1.0;
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === this.activeTouchId) {
        const touch = e.touches[i];
        const midX = window.innerWidth * 0.5;
        this.steerValue = touch.clientX < midX ? -1.0 : 1.0;
        break;
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 0) {
      this.activeTouchId = null;
      this.updateSteer();
    }
  };

  private updateSteer(): void {
    if (this.activeTouchId !== null) {
      return; // Touch takes priority when active
    }

    if (this.isSensorConnected) {
      // Physical sensor tilt (Raspberry Pi GPIO or wireless ESP32)
      this.steerValue = this.sensorSteer;
      return;
    }

    // Keyboard fallback: Left = -1.0, Right = +1.0
    if (this.leftPressed && !this.rightPressed) {
      this.steerValue = -1.0;
    } else if (this.rightPressed && !this.leftPressed) {
      this.steerValue = 1.0;
    } else {
      this.steerValue = 0.0;
    }
  }

  public getSteer(): number {
    return this.steerValue;
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.reconnectTimeoutId !== null) {
      window.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
  }
}
