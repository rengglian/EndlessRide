import * as THREE from 'three';
import { SplineTrack } from '../track/SplineTrack';
import { TrackChunkManager } from '../track/TrackChunkManager';
import { ObstacleManager } from '../obstacles/ObstacleManager';
import { CollectibleManager } from '../collectibles/CollectibleManager';
import { HorseRunnerController } from '../entities/horse/HorseRunnerController';
import { RunnerCamera } from '../camera/RunnerCamera';
import { InputManager } from '../input/InputManager';
import { HUD } from '../ui/HUD';
import { DebugHUD } from '../ui/DebugHUD';
import {
  APPLE_BONUS_SCORE,
  HORSESHOE_BONUS_SCORE,
  APPLE_MULTIPLIER_STEP,
  HORSESHOE_MULTIPLIER_STEP,
  MAX_SCORE_MULTIPLIER,
  MULTIPLIER_HOLD_DURATION,
  MULTIPLIER_DECAY_RATE
} from '../config';

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
  public collectibleManager: CollectibleManager;
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

  // Score & Dynamic Multiplier State
  public score = 0;
  public multiplier = 1.0;
  public multiplierTimer = 0;
  public applesCollected = 0;
  public horseshoesCollected = 0;

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
    this.collectibleManager = new CollectibleManager(this.scene, this.spline);
    this.trackManager = new TrackChunkManager(
      this.scene,
      this.spline,
      this.obstacleManager,
      this.collectibleManager
    );
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

    // 2. Forward distance delta and distance score weighted by multiplier
    const ds = Math.max(0, this.horseController.distance - this.horseController.prevDistance);
    this.score += ds * this.multiplier;

    // 3. Stream forward track chunks
    this.trackManager.update(this.horseController.distance);

    // 4. Update and check collectibles
    this.collectibleManager.update(fixedDt);
    this.collectibleManager.checkPlayerCollection(
      this.horseController.prevDistance,
      this.horseController.distance,
      this.horseController.lateralOffset,
      (type) => {
        if (type === 'apple') {
          this.applesCollected++;
          this.multiplier = Math.min(
            MAX_SCORE_MULTIPLIER,
            Math.round((this.multiplier + APPLE_MULTIPLIER_STEP) * 10) / 10
          );
          const bonus = Math.round(APPLE_BONUS_SCORE * this.multiplier);
          this.score += bonus;
          this.multiplierTimer = MULTIPLIER_HOLD_DURATION;
          this.hud.triggerPickupFeedback('apple', this.multiplier, bonus);
        } else {
          this.horseshoesCollected++;
          this.multiplier = Math.min(
            MAX_SCORE_MULTIPLIER,
            Math.round((this.multiplier + HORSESHOE_MULTIPLIER_STEP) * 10) / 10
          );
          const bonus = Math.round(HORSESHOE_BONUS_SCORE * this.multiplier);
          this.score += bonus;
          this.multiplierTimer = MULTIPLIER_HOLD_DURATION;
          this.hud.triggerPickupFeedback('horseshoe', this.multiplier, bonus);
        }
      }
    );

    // 5. Multiplier timer hold & decay
    if (this.multiplier > 1.0) {
      if (this.multiplierTimer > 0) {
        this.multiplierTimer = Math.max(0, this.multiplierTimer - fixedDt);
      } else {
        this.multiplier = Math.max(1.0, this.multiplier - MULTIPLIER_DECAY_RATE * fixedDt);
      }
    } else {
      this.multiplier = 1.0;
      this.multiplierTimer = 0;
    }

    // 6. Check obstacle collisions (swept interval [prevDistance, distance])
    const collided = this.obstacleManager.checkPlayerCollision(
      this.horseController.prevDistance,
      this.horseController.distance,
      this.horseController.lateralOffset
    );

    if (collided) {
      this.gameOver();
      return;
    }

    // 7. Update HUD
    const multiplierProgress =
      this.multiplier > 1.0 ? this.multiplierTimer / MULTIPLIER_HOLD_DURATION : 0;
    this.hud.update(
      this.horseController.distance,
      this.horseController.speed,
      this.score,
      this.multiplier,
      multiplierProgress,
      this.applesCollected,
      this.horseshoesCollected
    );

    // 8. Update high score if beaten (based on max(score, distance))
    const effectiveScore = Math.max(this.score, this.horseController.distance);
    if (effectiveScore > this.highScore) {
      this.highScore = effectiveScore;
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
    const effectiveScore = Math.max(this.score, this.horseController.distance);
    const isNewRecord = effectiveScore >= this.highScore && effectiveScore > 0;
    this.hud.showGameOver(
      this.horseController.distance,
      this.highScore,
      isNewRecord,
      this.score,
      this.applesCollected,
      this.horseshoesCollected
    );
  }

  public restart(): void {
    this.hud.hideGameOver();
    this.horseController.reset();
    this.runnerCamera.reset();
    this.obstacleManager.reset();
    this.collectibleManager.reset();
    this.trackManager.reset();
    this.score = 0;
    this.multiplier = 1.0;
    this.multiplierTimer = 0;
    this.applesCollected = 0;
    this.horseshoesCollected = 0;
    this.hud.update(0, this.horseController.speed, 0, 1.0, 0, 0, 0);
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
    this.collectibleManager.dispose();
    this.horseController.dispose();
    this.renderer.dispose();
  }
}
