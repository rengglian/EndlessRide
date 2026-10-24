export class InputManager {
  private leftPressed = false;
  private rightPressed = false;
  public activeTouchId: number | null = null;
  private touchSteer: number | null = null;

  // Accelerometer / IMU Sensor WebSocket Bridge (Raspberry Pi or Wireless ESP32)
  private ws: WebSocket | null = null;
  public isSensorConnected = false;
  private sensorSteer = 0;
  private lastSensorPacketTime = 0;
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

    // Only connect if '?sensor' query parameter is explicitly provided
    // e.g. http://localhost:3000/?sensor or http://localhost:3000/?sensor=192.168.1.50
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('sensor')) {
      return;
    }

    const sensorParam = urlParams.get('sensor');
    const sensorHost = (sensorParam && sensorParam.trim().length > 0)
      ? sensorParam.trim()
      : (window.location.hostname || 'localhost');
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
            this.lastSensorPacketTime = performance.now();
          } else if (data && data.type === 'button' && this.onButtonAction) {
            this.onButtonAction(data.action || 'restart');
          }
        } catch {
          // Ignore parse errors
        }
      };
      this.ws.onclose = () => {
        this.isSensorConnected = false;
        if (!this.isDisposed) {
          // Retry connection every 4 seconds only if ?sensor was explicitly requested
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

    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onButtonAction?.('pause');
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      this.onButtonAction?.('start_or_restart');
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.leftPressed = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') this.rightPressed = false;
  };

  private isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean(
      (target as HTMLElement | null)?.closest?.(
        'button, #gameover-modal, #start-modal, #pause-modal, #dbg-toggle-btn'
      )
    );
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (this.isInteractiveTarget(e.target)) {
      return;
    }
    e.preventDefault();
    this.updateMultiTouch(e.touches, e.changedTouches);
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.isInteractiveTarget(e.target)) {
      return;
    }
    e.preventDefault();
    this.updateMultiTouch(e.touches);
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (this.isInteractiveTarget(e.target)) {
      return;
    }
    e.preventDefault();
    this.updateMultiTouch(e.touches);
  };

  private updateMultiTouch(touches: TouchList, changedTouches?: TouchList): void {
    if (touches.length === 0) {
      this.activeTouchId = null;
      this.touchSteer = null;
      return;
    }

    const midX = window.innerWidth * 0.5;
    let hasLeft = false;
    let hasRight = false;

    for (let i = 0; i < touches.length; i++) {
      if (touches[i].clientX < midX) {
        hasLeft = true;
      } else {
        hasRight = true;
      }
    }

    if (hasLeft && hasRight) {
      this.touchSteer = 0.0;
    } else if (hasLeft) {
      this.touchSteer = -1.0;
      if (changedTouches && changedTouches.length > 0) {
        this.activeTouchId = changedTouches[0].identifier;
      }
    } else if (hasRight) {
      this.touchSteer = 1.0;
      if (changedTouches && changedTouches.length > 0) {
        this.activeTouchId = changedTouches[0].identifier;
      }
    }
  }

  private getGamepadSteer(): number | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      return null;
    }

    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp) continue;

      // Left analog stick X-axis (deadzone 0.12)
      if (gp.axes && gp.axes.length > 0) {
        const axisX = gp.axes[0];
        if (Math.abs(axisX) > 0.12) {
          return Math.max(-1.0, Math.min(1.0, axisX));
        }
      }

      // D-pad Left (14) / Right (15)
      if (gp.buttons && gp.buttons.length > 15) {
        const dpadLeft = gp.buttons[14]?.pressed;
        const dpadRight = gp.buttons[15]?.pressed;
        if (dpadLeft && !dpadRight) return -1.0;
        if (dpadRight && !dpadLeft) return 1.0;
        if (dpadLeft && dpadRight) return 0.0;
      }
    }

    return null;
  }

  public getSteer(): number {
    // 1. Touch priority (when active fingers on screen)
    if (this.touchSteer !== null) {
      return this.touchSteer;
    }

    // 2. Keyboard priority
    if (this.leftPressed && !this.rightPressed) {
      return -1.0;
    }
    if (this.rightPressed && !this.leftPressed) {
      return 1.0;
    }
    if (this.leftPressed && this.rightPressed) {
      return 0.0;
    }

    // 3. Sensor priority (if connected and received packet within last 350ms)
    if (this.isSensorConnected && (performance.now() - this.lastSensorPacketTime <= 350)) {
      return this.sensorSteer;
    }

    // 4. Gamepad priority (analog left stick or D-pad)
    const gpSteer = this.getGamepadSteer();
    if (gpSteer !== null) {
      return gpSteer;
    }

    return 0.0;
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
