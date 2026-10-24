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
  GAME_OVER = 'GAME_OVER'
}

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

  // State
  public state: GameState = GameState.RUNNING;
  private lastTime = 0;
  private horsePosTmp = new THREE.Vector3();
  private horseTangentTmp = new THREE.Vector3();
  private onResizeBound = (): void => this.onResize();

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

    // 2. Scene & Fog Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec8e3); // Clear sky blue
    this.scene.fog = new THREE.FogExp2(0x7ec8e3, 0.005);

    // 3. Camera Setup (Fixed 3rd person runner follow camera)
    this.camera = new THREE.PerspectiveCamera(
      66,
      window.innerWidth / window.innerHeight,
      0.1,
      500
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

    // Attach restart listener
    this.hud.onRestart = () => this.restart();
    this.inputManager.onButtonAction = (action) => {
      if (action === 'restart') this.restart();
    };

    // Position camera initially directly behind horse
    this.horseController.getTransform(this.horsePosTmp, this.horseTangentTmp);
    this.runnerCamera.update(this.horsePosTmp, this.horseTangentTmp, this.horseController.speed, 0.016);

    // 6. Viewport Resize Binding
    window.addEventListener('resize', this.onResizeBound);
  }

  public start(): void {
    // Generate initial track ahead
    this.trackManager.initTrack(5);

    this.lastTime = performance.now();
    this.tick();
  }

  private tick = (): void => {
    const now = performance.now();
    let dt = this.lastTime > 0 ? (now - this.lastTime) / 1000 : 0.0166;
    if (isNaN(dt) || dt <= 0 || dt > 0.1) {
      dt = 0.0166;
    }
    this.lastTime = now;

    const steer = this.inputManager.getSteer();

    if (this.state === GameState.RUNNING) {
      // 1. Update horse locomotion and girl rider kinematics
      this.horseController.update(steer, dt);

      // 2. Update dynamic runner follow camera (locked directly behind the horse)
      this.horseController.getTransform(this.horsePosTmp, this.horseTangentTmp);
      this.runnerCamera.update(
        this.horsePosTmp,
        this.horseTangentTmp,
        this.horseController.speed,
        dt
      );

      // 3. Update directional sunlight target to follow horse
      this.sunLight.position.set(
        this.horseController.rootGroup.position.x + 30,
        this.horseController.rootGroup.position.y + 60,
        this.horseController.rootGroup.position.z + 20
      );
      this.sunLight.target.position.copy(this.horseController.rootGroup.position);

      // 4. Stream forward track chunks
      this.trackManager.update(this.horseController.distance);

      // 5. Check obstacle collisions
      const collided = this.obstacleManager.checkPlayerCollision(
        this.horseController.distance,
        this.horseController.lateralOffset
      );

      if (collided) {
        this.gameOver();
      }

      // 6. Update HUD
      this.hud.update(
        this.horseController.distance,
        this.horseController.speed
      );
    }

    // 7. Update Debug Telemetry HUD
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

    // Render Scene
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  private gameOver(): void {
    this.state = GameState.GAME_OVER;
    this.horseController.setCrashed(true);
    this.hud.showGameOver(this.horseController.distance);
  }

  public restart(): void {
    this.hud.hideGameOver();
    this.horseController.reset();
    this.runnerCamera.reset();
    this.obstacleManager.reset();
    this.trackManager.reset();
    this.state = GameState.RUNNING;
    this.lastTime = performance.now();
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
    window.removeEventListener('resize', this.onResizeBound);
    this.hud.dispose();
    this.debugHud.dispose();
    this.inputManager.dispose();
    this.trackManager.dispose();
    this.obstacleManager.dispose();
    this.horseController.dispose();
    this.renderer.dispose();
  }
}
