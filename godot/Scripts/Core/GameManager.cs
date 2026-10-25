using System;
using Godot;
using EndlessRide.Camera;
using EndlessRide.Collectibles;
using EndlessRide.Entities;
using EndlessRide.Networking;
using EndlessRide.Obstacles;
using EndlessRide.Track;
using EndlessRide.UI;

namespace EndlessRide.Core;

public enum GameState
{
    Start,
    Countdown,
    Running,
    Paused,
    GameOver
}

/// <summary>
/// Master Game Orchestrator & State Machine for Endless Ride in Godot.
/// Decoupled 60 Hz physics loop, HorseRunnerController locomotion,
/// spring-damped RunnerCamera, procedural track streaming, swept collision,
/// hardware UDP motion receiver (port 8081), embedded companion web server (port 8080),
/// and CanvasLayer InGameHUD.
/// </summary>
public partial class GameManager : Node3D
{
    [Export] public Config.DifficultyPreset Difficulty { get; set; } = Config.DifficultyPreset.Standard;
    [Export] public string PlayerName { get; set; } = "Rider 1";

    public GameState State { get; private set; } = GameState.Start;
    public float DistanceTraveled => HorseController?.Distance ?? 0.0f;
    public float PlayerSpeed => HorseController?.Speed ?? Config.BaseSpeed;
    public float Score { get; private set; }
    public float Multiplier { get; private set; } = 1.0f;
    public float MultiplierTimer { get; private set; }
    public int ApplesCollected { get; private set; }
    public int HorseshoesCollected { get; private set; }
    public float CountdownTimer { get; private set; }

    public SplineTrack Track => _chunkManager?.Track ?? _fallbackTrack;
    private readonly SplineTrack _fallbackTrack = new();

    public TrackChunkManager ChunkManager => _chunkManager;
    private TrackChunkManager _chunkManager = null!;

    public ObstacleManager ObstacleManager { get; private set; } = null!;
    public CollectibleManager CollectibleManager { get; private set; } = null!;
    public HorseRunnerController HorseController { get; private set; } = null!;
    public RunnerCamera Camera { get; private set; } = null!;
    public HardwareUdpReceiver UdpReceiver { get; private set; } = null!;
    public CompanionWebServer WebServer { get; private set; } = null!;
    public InGameHUD HUD { get; private set; } = null!;

    public LeaderboardManager Leaderboard => _leaderboardManager;
    private readonly LeaderboardManager _leaderboardManager = new();

    private float _telemetryTimer;
    private float _gameOverLockoutTimer;
    private bool _prevSpacePressed;
    private bool _prevMousePressed;

    public override void _Ready()
    {
        // 1. Procedural Track Manager
        _chunkManager = new TrackChunkManager { Name = "TrackChunkManager" };
        AddChild(_chunkManager);

        // 2. Obstacle & Collectible Managers
        ObstacleManager = new ObstacleManager { Name = "ObstacleManager" };
        AddChild(ObstacleManager);
        ObstacleManager.Initialize(Track);
        _chunkManager.ObstacleMgr = ObstacleManager;

        CollectibleManager = new CollectibleManager { Name = "CollectibleManager" };
        AddChild(CollectibleManager);
        CollectibleManager.Initialize(Track);
        _chunkManager.CollectibleMgr = CollectibleManager;

        // 3. Horse Runner Controller
        HorseController = new HorseRunnerController { Name = "HorseController" };
        AddChild(HorseController);
        HorseController.Initialize(Track);

        // 4. Runner Camera
        Camera = GetNodeOrNull<RunnerCamera>("Camera3D") ?? new RunnerCamera { Name = "Camera3D" };
        if (Camera.GetParent() == null)
        {
            AddChild(Camera);
        }

        // 5. Hardware UDP Receiver & Companion Web Server
        UdpReceiver = new HardwareUdpReceiver { Name = "HardwareUdpReceiver" };
        AddChild(UdpReceiver);

        WebServer = new CompanionWebServer { Name = "CompanionWebServer" };
        AddChild(WebServer);

        // 6. In-Game HUD
        HUD = new InGameHUD { Name = "InGameHUD" };
        AddChild(HUD);

        // Connect remote commands (marshaled to main thread via CallDeferred)
        UdpReceiver.OnRestartRequested += () => Callable.From(() =>
        {
            if (State is GameState.Start or GameState.GameOver) StartGame();
        }).CallDeferred();

        WebServer.OnStartOrRestartCommand += () => Callable.From(() =>
        {
            if (State is GameState.Start or GameState.GameOver) StartGame();
        }).CallDeferred();

        WebServer.OnForceRestartCommand += () => Callable.From(() =>
        {
            StartGame();
        }).CallDeferred();

        WebServer.OnPauseCommand += () => Callable.From(() =>
        {
            if (State == GameState.Running)
            {
                State = GameState.Paused;
                WebServer?.BroadcastRoomState("PAUSED", Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
            }
        }).CallDeferred();

        WebServer.OnResumeCommand += () => Callable.From(() =>
        {
            if (State == GameState.Paused)
            {
                State = GameState.Running;
                WebServer?.BroadcastRoomState("RUNNING", Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
            }
        }).CallDeferred();

        WebServer.OnTareCommand += () => Callable.From(() =>
        {
            UdpReceiver.TareZero();
        }).CallDeferred();

        WebServer.OnResetCalibrationCommand += () => Callable.From(() =>
        {
            UdpReceiver.ResetCalibration();
        }).CallDeferred();

        WebServer.OnToggleInvertCommand += () => Callable.From(() =>
        {
            UdpReceiver.InvertX = !UdpReceiver.InvertX;
            GD.Print($"[GameManager] Hardware controller InvertX toggled: {UdpReceiver.InvertX}");
        }).CallDeferred();

        WebServer.OnDifficultyChanged += presetStr => Callable.From(() =>
        {
            if (Enum.TryParse<Config.DifficultyPreset>(presetStr, true, out var preset))
            {
                SetDifficulty(preset);
            }
        }).CallDeferred();

        WebServer.OnPlayerNameChanged += name => Callable.From(() =>
        {
            PlayerName = name;
            GD.Print($"[GameManager] Active rider profile: {PlayerName}");
            WebServer?.BroadcastRoomState(State.ToString().ToUpperInvariant(), Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
        }).CallDeferred();

        GD.Print("[GameManager] Initialized Endless Ride Engine (Full TV/Arcade Stack Active).");
        Camera.SnapToTarget(HorseController.GlobalPosition, Track.GetTangentAtDistance(0.0f));

        HUD.UpdateLeaderboard(_leaderboardManager.Entries);
        WebServer?.BroadcastLeaderboard(_leaderboardManager.Entries);
        WebServer?.BroadcastRoomState(State.ToString().ToUpperInvariant(), Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
    }

    public override void _PhysicsProcess(double delta)
    {
        float dt = (float)delta;
        float steer = SampleSteerInput();

        bool spaceJustPressed = Input.IsKeyPressed(Key.Space) && !_prevSpacePressed;
        bool mouseJustPressed = Input.IsMouseButtonPressed(MouseButton.Left) && !_prevMousePressed;
        bool startOrRestartPressed = Input.IsActionJustPressed("ui_accept") || spaceJustPressed || mouseJustPressed;
        _prevSpacePressed = Input.IsKeyPressed(Key.Space);
        _prevMousePressed = Input.IsMouseButtonPressed(MouseButton.Left);

        switch (State)
        {
            case GameState.Start:
                UpdateCameraOnly(steer, dt);
                if (startOrRestartPressed)
                {
                    StartGame();
                }
                break;

            case GameState.Countdown:
                CountdownTimer -= dt;
                UpdateCameraOnly(steer, dt);
                if (CountdownTimer <= 0.0f)
                {
                    State = GameState.Running;
                    HorseController.PlayGallopAnimation();
                    GD.Print("[GameManager] RACE STARTED!");
                    WebServer?.BroadcastRoomState("RUNNING", Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
                }
                break;

            case GameState.Running:
                UpdateRunningState(steer, dt);
                break;

            case GameState.Paused:
                break;

            case GameState.GameOver:
                UpdateCameraOnly(0.0f, dt);
                if (_gameOverLockoutTimer > 0.0f)
                {
                    _gameOverLockoutTimer -= dt;
                }
                else if (startOrRestartPressed)
                {
                    StartGame();
                }
                break;
        }

        // Update HUD
        HUD.UpdateHUD(
            State,
            Score,
            DistanceTraveled,
            PlayerSpeed,
            Multiplier,
            MultiplierTimer,
            ApplesCollected,
            HorseshoesCollected,
            CountdownTimer
        );

        // Broadcast telemetry to companion remotes at 20 Hz (every 50ms)
        _telemetryTimer += dt;
        if (_telemetryTimer >= 0.05f)
        {
            _telemetryTimer -= 0.05f;
            var udp = UdpReceiver;
            bool isHw = udp != null && udp.IsActive;
            string source = isHw ? "atoms3" : "godot";
            float rawSteer = isHw && udp != null ? udp.RawSteer : steer;
            float calOffset = isHw && udp != null ? udp.CalOffset : 0.0f;
            string deviceIp = isHw && udp != null ? udp.DeviceIp : (WebServer?.LastDeviceIp ?? string.Empty);
            int hz = isHw && udp != null ? udp.Hz : 50;
            int seq = isHw && udp != null ? udp.Seq : 0;
            int button = isHw && udp != null ? udp.Button : 0;

            WebServer?.BroadcastTelemetry(
                State.ToString().ToUpperInvariant(),
                DistanceTraveled,
                PlayerSpeed,
                Score,
                Multiplier,
                steer,
                Difficulty.ToString().ToLowerInvariant(),
                source,
                rawSteer,
                calOffset,
                deviceIp,
                hz,
                seq,
                button
            );
        }
    }

    private float SampleSteerInput()
    {
        float steer = 0.0f;
        if (Input.IsActionPressed("ui_left") || Input.IsKeyPressed(Key.A)) steer -= 1.0f;
        if (Input.IsActionPressed("ui_right") || Input.IsKeyPressed(Key.D)) steer += 1.0f;

        // Gamepad Left Stick / D-Pad
        float stickX = Input.GetJoyAxis(0, JoyAxis.LeftX);
        if (MathF.Abs(stickX) > 0.15f)
        {
            steer = stickX;
        }

        // Physical AtomS3 tilt controller fallback if active within 350ms
        if (MathF.Abs(steer) < 0.01f && UdpReceiver != null && UdpReceiver.IsActive)
        {
            steer = UdpReceiver.CalibratedSteer;
        }

        return Math.Clamp(steer, -1.0f, 1.0f);
    }

    private void UpdateRunningState(float steer, float dt)
    {
        // Advance horse controller physics and rider kinematics
        HorseController.UpdateController(steer, dt);

        float dist = HorseController.Distance;
        float ds = dist - HorseController.PrevDistance;

        // 1. Swept longitudinal obstacle collision check
        if (ObstacleManager.CheckPlayerCollision(HorseController.PrevDistance, dist, HorseController.LateralOffset))
        {
            TriggerGameOver();
            return;
        }

        // 2. Animate and check collectible pickups
        CollectibleManager.UpdateAnimation(dt);
        CollectibleManager.CheckPlayerCollection(
            HorseController.PrevDistance,
            dist,
            HorseController.LateralOffset,
            type =>
            {
                if (type == CollectibleType.Apple)
                {
                    CollectApple();
                }
                else if (type == CollectibleType.Horseshoe)
                {
                    CollectHorseshoe();
                }
            }
        );

        // 3. Stream procedural track chunks ahead
        _chunkManager.UpdatePlayerDistance(dist);

        // 4. Multiplier decay after hold timer
        if (MultiplierTimer > 0.0f)
        {
            MultiplierTimer -= dt;
        }
        else if (Multiplier > 1.0f)
        {
            Multiplier = MathF.Max(1.0f, Multiplier - Config.MultiplierDecayRate * dt);
        }

        // 5. Distance score accumulation
        Score += ds * Multiplier;

        int prevMilestone = (int)((dist - ds) / 50.0f);
        int currMilestone = (int)(dist / 50.0f);
        if (currMilestone > prevMilestone)
        {
            GD.Print($"[GameManager] Milestone: {dist:F0}m | Speed: {PlayerSpeed:F1} m/s | Multiplier: {Multiplier:F1}x | Score: {Score:F0}");
        }

        // 6. Camera follow update
        Vector3 tangent = Track.GetTangentAtDistance(dist);
        Camera.UpdateCamera(HorseController.GlobalPosition, tangent, HorseController.Speed, dt, steer);
    }

    private void UpdateCameraOnly(float steer, float dt)
    {
        Vector3 tangent = Track.GetTangentAtDistance(HorseController.Distance);
        Camera.UpdateCamera(HorseController.GlobalPosition, tangent, HorseController.Speed, dt, steer);
    }

    public void SetDifficulty(Config.DifficultyPreset preset)
    {
        Difficulty = preset;
        var config = Config.DifficultyPresets[Difficulty];
        if (HorseController != null)
        {
            HorseController.BaseSpeed = config.BaseSpeed;
            HorseController.MaxSpeed = config.MaxSpeed;
            HorseController.AccelRate = config.AccelRate;
            if (State == GameState.Running)
            {
                HorseController.Speed = Math.Clamp(HorseController.Speed, config.BaseSpeed, config.MaxSpeed);
            }
        }
        GD.Print($"[GameManager] Difficulty updated to: {Difficulty} ({config.Label}: {config.BaseSpeed}-{config.MaxSpeed} m/s)");
        WebServer?.BroadcastRoomState(State.ToString().ToUpperInvariant(), Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
    }

    public void StartGame()
    {
        Score = 0.0f;
        Multiplier = 1.0f;
        MultiplierTimer = 0.0f;
        ApplesCollected = 0;
        HorseshoesCollected = 0;
        CountdownTimer = Config.CountdownSeconds;

        var config = Config.DifficultyPresets[Difficulty];
        HorseController.BaseSpeed = config.BaseSpeed;
        HorseController.MaxSpeed = config.MaxSpeed;
        HorseController.AccelRate = config.AccelRate;
        HorseController.Reset();

        ObstacleManager.Reset();
        CollectibleManager.Reset();
        _chunkManager.InitTrack();
        Camera.ResetCamera();

        State = GameState.Countdown;
        GD.Print("[GameManager] Countdown initiated (3-2-1).");
        WebServer?.BroadcastRoomState("COUNTDOWN", Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);
    }

    public void CollectApple()
    {
        ApplesCollected++;
        Score += Config.AppleBonusScore * Multiplier;
        Multiplier = MathF.Min(Config.MaxScoreMultiplier, Multiplier + Config.AppleMultiplierStep);
        MultiplierTimer = Config.MultiplierHoldDuration;
        GD.Print($"[GameManager] Picked up APPLE! (+{Config.AppleBonusScore} pts, Multiplier: {Multiplier:F1}x, Apples: {ApplesCollected})");
    }

    public void CollectHorseshoe()
    {
        HorseshoesCollected++;
        Score += Config.HorseshoeBonusScore * Multiplier;
        Multiplier = MathF.Min(Config.MaxScoreMultiplier, Multiplier + Config.HorseshoeMultiplierStep);
        MultiplierTimer = Config.MultiplierHoldDuration;
        GD.Print($"[GameManager] Picked up GOLDEN HORSESHOE! (+{Config.HorseshoeBonusScore} pts, Multiplier: {Multiplier:F1}x, Shoes: {HorseshoesCollected})");
    }

    public void TriggerGameOver()
    {
        if (State == GameState.GameOver) return;
        State = GameState.GameOver;
        _gameOverLockoutTimer = 0.6f;
        HorseController.SetCrashed(true);

        int finalScore = (int)MathF.Max(Score, DistanceTraveled);
        _leaderboardManager.RecordScore(
            PlayerName,
            finalScore,
            (int)DistanceTraveled,
            Difficulty.ToString().ToLowerInvariant(),
            ApplesCollected,
            HorseshoesCollected,
            out bool isNewRecord,
            out int rankIndex
        );

        HUD.UpdateLeaderboard(_leaderboardManager.Entries, rankIndex, isNewRecord);
        HUD.UpdateHUD(State, finalScore, DistanceTraveled, PlayerSpeed, Multiplier, MultiplierTimer, ApplesCollected, HorseshoesCollected, CountdownTimer);
        WebServer?.BroadcastLeaderboard(_leaderboardManager.Entries);
        WebServer?.BroadcastRoomState("GAMEOVER", Difficulty.ToString().ToLowerInvariant(), PlayerName, _leaderboardManager.Entries);

        GD.Print($"[GameManager] CRASH! GAME OVER at {DistanceTraveled:F1}m! Final Score: {finalScore} (Rank: {(rankIndex >= 0 ? $"#{rankIndex + 1}" : "unranked")}, NewRecord: {isNewRecord})");
    }
}
