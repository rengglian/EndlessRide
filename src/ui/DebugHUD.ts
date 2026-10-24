import * as THREE from 'three';

export interface DebugTelemetryData {
  renderer: THREE.WebGLRenderer;
  steerInput: number;
  speed: number;
  distance: number;
  lateralOffset: number;
  trackBankDeg: number;
  activeChunkCount: number;
  activeObstacleCount: number;
  deltaTime: number;
}

export class DebugHUD {
  private container: HTMLElement;
  private isVisible = true;

  // FPS calculation accumulators
  private frameCount = 0;
  private timeAccumulator = 0;
  private currentFps = 60.0;
  private currentFrameTimeMs = 16.6;

  // UI elements
  private fpsValEl!: HTMLElement;
  private callsValEl!: HTMLElement;
  private memValEl!: HTMLElement;

  private inputBarEl!: HTMLElement;
  private inputValEl!: HTMLElement;

  private speedValEl!: HTMLElement;
  private distValEl!: HTMLElement;
  private bankValEl!: HTMLElement;

  private chunksValEl!: HTMLElement;
  private obsValEl!: HTMLElement;

  private onKeyDownBound = (e: KeyboardEvent): void => {
    if (e.code === 'F3' || e.code === 'KeyH' || e.code === 'Backquote') {
      this.toggle();
    }
  };

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'debug-hud';
    this.applyStyles();
    this.buildDOM();
    document.body.appendChild(this.container);

    // Toggle shortcut (F3, H, or ` key)
    window.addEventListener('keydown', this.onKeyDownBound);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #debug-hud {
        position: absolute;
        top: 14px;
        left: 14px;
        z-index: 9999;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        line-height: 1.4;
        color: #f1f5f9;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        padding: 10px 14px;
        min-width: 240px;
        max-width: 290px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        pointer-events: auto;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      #debug-hud.hidden {
        opacity: 0;
        transform: translateY(-8px);
        pointer-events: none;
      }
      .dbg-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        padding-bottom: 5px;
        margin-bottom: 6px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: #38bdf8;
      }
      .dbg-badge-toggle {
        font-size: 9px;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.2);
        color: #7dd3fc;
        cursor: pointer;
      }
      .dbg-section {
        margin-bottom: 6px;
      }
      .dbg-sec-title {
        font-size: 9.5px;
        text-transform: uppercase;
        color: #94a3b8;
        font-weight: 700;
        margin-bottom: 2px;
        letter-spacing: 0.8px;
      }
      .dbg-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .dbg-label {
        color: #94a3b8;
      }
      .dbg-val {
        font-weight: 600;
        color: #f8fafc;
      }
      .dbg-val-green { color: #4ade80; }
      .dbg-val-yellow { color: #facc15; }
      .dbg-val-red { color: #f87171; }
      .dbg-val-cyan { color: #38bdf8; }
      
      .dbg-input-meter {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        margin: 4px 0;
        position: relative;
        overflow: hidden;
      }
      .dbg-input-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 0%;
        background: #38bdf8;
        border-radius: 3px;
        transition: width 0.05s linear, left 0.05s linear, background 0.1s ease;
      }
    `;
    document.head.appendChild(style);
  }

  private buildDOM(): void {
    this.container.innerHTML = `
      <div class="dbg-header">
        <span>ENGINE TELEMETRY</span>
        <span class="dbg-badge-toggle" id="dbg-toggle-btn">[F3 / H]</span>
      </div>

      <!-- Performance -->
      <div class="dbg-section">
        <div class="dbg-sec-title">Performance</div>
        <div class="dbg-row">
          <span class="dbg-label">FPS / Frame:</span>
          <span class="dbg-val" id="dbg-fps">60.0 fps (16.6ms)</span>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">Draw Calls / Tris:</span>
          <span class="dbg-val" id="dbg-calls-tris">0 calls | 0k tris</span>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">Geometries / Tex:</span>
          <span class="dbg-val" id="dbg-mem">0 geom | 0 tex</span>
        </div>
      </div>

      <!-- Controls & Input -->
      <div class="dbg-section">
        <div class="dbg-sec-title">Steering Input</div>
        <div class="dbg-row">
          <span class="dbg-label">Input / Lane:</span>
          <span class="dbg-val dbg-val-cyan" id="dbg-input-val">CENTER (0.00)</span>
        </div>
        <div class="dbg-input-meter">
          <div class="dbg-input-bar" id="dbg-input-bar"></div>
        </div>
      </div>

      <!-- Horse Kinematics -->
      <div class="dbg-section">
        <div class="dbg-sec-title">Horse Kinematics</div>
        <div class="dbg-row">
          <span class="dbg-label">Speed:</span>
          <span class="dbg-val dbg-val-green" id="dbg-speed">18.0 m/s (64.8 km/h)</span>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">Dist / Offset:</span>
          <span class="dbg-val" id="dbg-dist">0 m | u: 0.00m</span>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">Bank / Cadence:</span>
          <span class="dbg-val" id="dbg-bank-cadence">0.0° | 4.4 Hz</span>
        </div>
      </div>

      <!-- World Streaming -->
      <div class="dbg-section" style="margin-bottom: 0;">
        <div class="dbg-sec-title">World Streaming</div>
        <div class="dbg-row">
          <span class="dbg-label">Active Chunks:</span>
          <span class="dbg-val" id="dbg-chunks">5 chunks (250m)</span>
        </div>
        <div class="dbg-row">
          <span class="dbg-label">Active Obstacles:</span>
          <span class="dbg-val dbg-val-yellow" id="dbg-obs">0 in pool</span>
        </div>
      </div>
    `;

    this.fpsValEl = this.container.querySelector('#dbg-fps')!;
    this.callsValEl = this.container.querySelector('#dbg-calls-tris')!;
    this.memValEl = this.container.querySelector('#dbg-mem')!;

    this.inputBarEl = this.container.querySelector('#dbg-input-bar')!;
    this.inputValEl = this.container.querySelector('#dbg-input-val')!;

    this.speedValEl = this.container.querySelector('#dbg-speed')!;
    this.distValEl = this.container.querySelector('#dbg-dist')!;
    this.bankValEl = this.container.querySelector('#dbg-bank-cadence')!;

    this.chunksValEl = this.container.querySelector('#dbg-chunks')!;
    this.obsValEl = this.container.querySelector('#dbg-obs')!;

    const toggleBtn = this.container.querySelector('#dbg-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }
  }

  public update(data: DebugTelemetryData): void {
    if (!this.isVisible) return;

    // 1. Calculate FPS & Frame Time
    this.frameCount++;
    this.timeAccumulator += data.deltaTime;

    if (this.timeAccumulator >= 0.2) {
      this.currentFps = this.frameCount / this.timeAccumulator;
      this.currentFrameTimeMs = (this.timeAccumulator / this.frameCount) * 1000;
      this.frameCount = 0;
      this.timeAccumulator = 0;
    }

    // 2. Render Telemetry Values
    const fpsClass =
      this.currentFps >= 55
        ? 'dbg-val-green'
        : this.currentFps >= 30
        ? 'dbg-val-yellow'
        : 'dbg-val-red';

    this.fpsValEl.innerHTML = `<span class="${fpsClass}">${this.currentFps.toFixed(1)} fps</span> (${this.currentFrameTimeMs.toFixed(1)}ms)`;

    const renderInfo = data.renderer.info.render;
    const memInfo = data.renderer.info.memory;
    const trisK = (renderInfo.triangles / 1000).toFixed(1);

    this.callsValEl.innerText = `${renderInfo.calls} calls | ${trisK}k tris`;
    this.memValEl.innerText = `${memInfo.geometries} geom | ${memInfo.textures} tex`;

    // 3. Input & Lane Status
    const steer = data.steerInput;
    let laneName = 'CENTER';
    if (data.lateralOffset > 1.2) laneName = 'RIGHT';
    else if (data.lateralOffset < -1.2) laneName = 'LEFT';

    let steerStr = 'CENTER (0.00)';
    if (steer < -0.1) steerStr = `LEFT (${steer.toFixed(2)})`;
    else if (steer > 0.1) steerStr = `RIGHT (+${steer.toFixed(2)})`;

    this.inputValEl.innerText = `${steerStr} [${laneName}]`;

    // Input Meter Bar
    if (steer < 0) {
      const widthPct = Math.abs(steer) * 50;
      this.inputBarEl.style.left = `${50 - widthPct}%`;
      this.inputBarEl.style.width = `${widthPct}%`;
      this.inputBarEl.style.background = '#38bdf8';
    } else {
      const widthPct = steer * 50;
      this.inputBarEl.style.left = '50%';
      this.inputBarEl.style.width = `${widthPct}%`;
      this.inputBarEl.style.background = '#38bdf8';
    }

    // 4. Horse Kinematics
    const kmh = (data.speed * 3.6).toFixed(1);
    this.speedValEl.innerText = `${data.speed.toFixed(1)} m/s (${kmh} km/h)`;
    this.distValEl.innerText = `${Math.floor(data.distance)} m | u: ${data.lateralOffset >= 0 ? '+' : ''}${data.lateralOffset.toFixed(2)}m`;

    const strideFreq = (4.4 * (data.speed / 18.0)).toFixed(1);
    this.bankValEl.innerText = `${data.trackBankDeg >= 0 ? '+' : ''}${data.trackBankDeg.toFixed(1)}° | ${strideFreq} Hz`;

    // 5. World Streaming
    this.chunksValEl.innerText = `${data.activeChunkCount} chunks (${data.activeChunkCount * 50}m)`;
    this.obsValEl.innerText = `${data.activeObstacleCount} active`;
  }

  public toggle(): void {
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.container.classList.remove('hidden');
    } else {
      this.container.classList.add('hidden');
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
