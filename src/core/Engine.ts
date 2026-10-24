import * as THREE from 'three';
import { SplineTrack } from '../track/SplineTrack';
import { TrackChunkManager } from '../track/TrackChunkManager';
import { ObstacleManager } from '../obstacles/ObstacleManager';
import { HorseRunnerController } from '../entities/horse/HorseRunnerController';
import { RunnerCamera } from '../camera/RunnerCamera';
import { InputManager } from '../input/InputManager';
import { HUD } from '../ui/HUD';
import { DebugHUD } from '../ui/DebugHUD';

export enum GameState {
  START = 'START',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER'
}

const HIGH_SCORE_KEY = 'endless_ride_high_score';

export class Engine {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  // Subsystems
  public spline: SplineTrack;
  public trackManager: TrackChunkManager;
  public obstacleManager: ObstacleManager;
  public horseController: HorseRunnerController;
  public runnerCamera: RunnerCamera;
  public inputManager: InputManager;
  public hud: HUD;
  public debugHud: DebugHUD;

  // Environment & Lights
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  // State & Timestepping
  public state: GameState = GameState.START;
  private lastTime = 0;
  private readonly fixedDt = 1 / 60;
  private accumulator = 0;
  private rafId = 0;
  public highScore = 0;

  private horsePosTmp = new THREE.Vector3();
  private horseTangentTmp = new THREE.Vector3();
  private onResizeBound = (): void => this.onResize();
  private onVisibilityChangeBound = (): void => this.onVisibilityChange();

  constructor(canvas: HTMLCanvasElement) {
    // 1. Renderer Setup (DPR clamped to 1.5 for smooth mobile 60 FPS)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // 2. Scene & Fog Setup (fog matches stream horizon at ~250m)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec8e3);
    this.scene.fog = new THREE.FogExp2(0x7ec8e3, 0.009);

    // 3. Camera Setup (Far plane matched to 280m to avoid pop-in)
    this.camera = new THREE.PerspectiveCamera(
      66,
      window.innerWidth / window.innerHeight,
      0.1,
      280
    );

    // 4. Bright Landscape Lighting Setup
    this.hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0x628b42, 1.35);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfffaed, 2.2);
    this.sunLight.position.set(30, 60, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 120;
    this.sunLight.shadow.camera.left = -25;
    this.sunLight.shadow.camera.right = 25;
    this.sunLight.shadow.camera.top = 25;
    this.sunLight.shadow.camera.bottom = -25;
    this.sunLight.shadow.bias = -0.0002;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 5. Initialize Subsystems
    this.spline = new SplineTrack();
    this.obstacleManager = new ObstacleManager(this.scene, this.spline);
    this.trackManager = new TrackChunkManager(this.scene, this.spline, this.obstacleManager);
    this.horseController = new HorseRunnerController(this.scene, this.spline);
    this.runnerCamera = new RunnerCamera(this.camera, this.spline);
    this.inputManager = new InputManager();
    this.hud = new HUD();
    this.debugHud = new DebugHUD();

    // 6. High Score Initialization from LocalStorage
    try {
      const stored = localStorage.getItem(HIGH_SCORE_KEY);
      if (stored) {
        this.highScore = parseFloat(stored) || 0;
      }
    } catch {
      this.highScore = 0;
    }
    this.hud.updateHighScore(this.highScore);

    // 7. Attach User Actions & State Transitions
    this.hud.onStart = () => this.startRun();
    this.hud.onResume = () => this.resume();
    this.hud.onRestart = () => this.restart();

    // Guard hardware / keyboard restart actions so they never wipe a live run mid-game!
    this.inputManager.onButtonAction = (action) => {
      if (action === 'restart' || action === 'start_or_restart') {
        if (this.state === GameState.GAME_OVER) {
          this.restart();
        } else if (this.state === GameState.START) {
          this.startRun();
        } else if (this.state === GameState.PAUSED) {
          this.resume();
        }
      } else if (action === 'pause') {
        this.togglePause();
      }
    };

    // Position camera initially directly behind horse
    this.horseController.getTransform(this.horsePosTmp, this.horseTangentTmp);
    this.runnerCamera.update(this.horsePosTmp, this.horseTangentTmp, this.horseController.speed, 0.016, 0);

    // 8. Event Listeners
    window.addEventListener('resize', this.onResizeBound);
    document.addEventListener('visibilitychange', this.onVisibilityChangeBound);
  }

  public start(): void {
    // Generate initial track ahead
    this.trackManager.initTrack(5);

    this.state = GameState.START;
    this.hud.showStart();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  public startRun(): void {
    this.hud.hideStart();
    this.state = GameState.RUNNING;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  public pause(): void {
    if (this.state !== GameState.RUNNING) return;
    this.state = GameState.PAUSED;
    this.hud.showPause();
  }

  public resume(): void {
    if (this.state !== GameState.PAUSED) return;
    this.hud.hidePause();
    this.state = GameState.RUNNING;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  public togglePause(): void {
    if (this.state === GameState.RUNNING) {
      this.pause();
    } else if (this.state === GameState.PAUSED) {
      this.resume();
    }
  }

  private onVisibilityChange(): void {
    if (document.hidden && this.state === GameState.RUNNING) {
      this.pause();
    }
  }

  private tick = (): void => {
    const now = performance.now();
    let dt = this.lastTime > 0 ? (now - this.lastTime) / 1000 : this.fixedDt;
    if (isNaN(dt) || dt <= 0) {
      dt = this.fixedDt;
    }
    // Cap frame delta to 0.1s to prevent spiral of death on backgrounding or lag spikes
    dt = Math.min(dt, 0.1);
    this.lastTime = now;

    const steer = this.inputManager.getSteer();

    // Fixed-timestep physics simulation accumulator for deterministic behavior
    if (this.state === GameState.RUNNING) {
      this.accumulator += dt;
      while (this.accumulator >= this.fixedDt) {
        this.stepSimulation(this.fixedDt, steer);
        this.accumulator -= this.fixedDt;
      }
    } else {
      this.accumulator = 0;
    }

    // Always update camera and lighting before render
    this.horseController.getTransform(this.horsePosTmp, this.horseTangentTmp);
    this.runnerCamera.update(
      this.horsePosTmp,
      this.horseTangentTmp,
      this.horseController.speed,
      dt,
      steer
    );

    // Directional shadow texel snapping to eliminate shadow edge shimmer
    this.updateSunLight();

    // Update Debug Telemetry HUD (skips calculations when HUD is hidden)
    if (this.debugHud.getIsVisible()) {
      const bankDeg =
        (this.spline.getBankingAngleAtDistance(
          this.horseController.distance,
          this.horseController.speed
        ) *
          180) /
        Math.PI;

      this.debugHud.update({
        renderer: this.renderer,
        steerInput: steer,
        speed: this.horseController.speed,
        distance: this.horseController.distance,
        lateralOffset: this.horseController.lateralOffset,
        trackBankDeg: bankDeg,
        activeChunkCount: this.trackManager.getActiveCount(),
        activeObstacleCount: this.obstacleManager.getActiveCount(),
        deltaTime: dt
      });
    }

    // Render Scene
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private stepSimulation(fixedDt: number, steer: number): void {
    // 1. Advance horse locomotion and rider kinematics
    this.horseController.update(steer, fixedDt);

    // 2. Stream forward track chunks
    this.trackManager.update(this.horseController.distance);

    // 3. Check obstacle collisions (swept interval [prevDistance, distance])
    const collided = this.obstacleManager.checkPlayerCollision(
      this.horseController.prevDistance,
      this.horseController.distance,
      this.horseController.lateralOffset
    );

    if (collided) {
      this.gameOver();
      return;
    }

    // 4. Update HUD
    this.hud.update(
      this.horseController.distance,
      this.horseController.speed
    );

    // 5. Update high score if beaten
    if (this.horseController.distance > this.highScore) {
      this.highScore = this.horseController.distance;
      try {
        localStorage.setItem(HIGH_SCORE_KEY, Math.floor(this.highScore).toString());
      } catch {
        // Ignore quota/access errors
      }
      this.hud.updateHighScore(this.highScore);
    }
  }

  private updateSunLight(): void {
    const texelSnap = 50 / 1024; // ~0.0488m grid snap
    const horsePos = this.horseController.rootGroup.position;

    const snapTargetX = Math.round(horsePos.x / texelSnap) * texelSnap;
    const snapTargetY = Math.round(horsePos.y / texelSnap) * texelSnap;
    const snapTargetZ = Math.round(horsePos.z / texelSnap) * texelSnap;

    this.sunLight.target.position.set(snapTargetX, snapTargetY, snapTargetZ);
    this.sunLight.position.set(snapTargetX + 30, snapTargetY + 60, snapTargetZ + 20);
  }

  private gameOver(): void {
    this.state = GameState.GAME_OVER;
    this.horseController.setCrashed(true);
    const isNewRecord = this.horseController.distance >= this.highScore && this.horseController.distance > 0;
    this.hud.showGameOver(this.horseController.distance, this.highScore, isNewRecord);
  }

  public restart(): void {
    this.hud.hideGameOver();
    this.horseController.reset();
    this.runnerCamera.reset();
    this.obstacleManager.reset();
    this.trackManager.reset();
    this.state = GameState.RUNNING;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  public dispose(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    window.removeEventListener('resize', this.onResizeBound);
    document.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
    this.hud.dispose();
    this.debugHud.dispose();
    this.inputManager.dispose();
    this.trackManager.dispose();
    this.obstacleManager.dispose();
    this.horseController.dispose();
    this.renderer.dispose();
  }
}
