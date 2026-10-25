using System;
using Godot;

namespace EndlessRide.Camera;

/// <summary>
/// Smoothly spring-damped rear-follow camera behind the galloping horse.
/// Features dynamic speed-scaled FOV warp and subtle horizon counter-roll into turns.
/// Ported from src/camera/RunnerCamera.ts.
/// </summary>
public partial class RunnerCamera : Camera3D
{
    [Export] public float FollowDistance { get; set; } = 4.6f;
    [Export] public float CameraHeight { get; set; } = 2.15f;
    [Export] public float LookAheadDistance { get; set; } = 8.5f;
    [Export] public float BaseFov { get; set; } = 66.0f;

    private Vector3 _currentCamPos;
    private Vector3 _currentLookTarget;
    private float _currentRoll;
    private bool _isInitialized;

    public override void _Ready()
    {
        Fov = BaseFov;
    }

    /// <summary>
    /// Updates camera position, orientation, and FOV relative to horse.
    /// </summary>
    public void UpdateCamera(
        Vector3 horsePos,
        Vector3 horseTangent,
        float horseSpeed,
        float deltaTime,
        float steerInput = 0.0f)
    {
        float dt = (float.IsNaN(deltaTime) || deltaTime <= 0.0f) ? 0.0166f : MathF.Min(deltaTime, 0.05f);
        float speed = float.IsNaN(horseSpeed) ? 9.0f : horseSpeed;
        float steer = Math.Clamp(steerInput, -1.0f, 1.0f);

        // 1. Dynamic speed-based Field of View (FOV warp effect)
        float targetFov = BaseFov + Math.Clamp((speed - 9.0f) * 0.8f, 0.0f, 14.0f);
        if (MathF.Abs(Fov - targetFov) > 0.05f)
        {
            Fov += (targetFov - Fov) * (1.0f - MathF.Exp(-5.0f * dt));
        }

        // 2. Target camera position behind horse along tangent
        Vector3 targetCamPos = horsePos - horseTangent * FollowDistance;
        targetCamPos.Y += CameraHeight;

        // 3. Look target down the track
        Vector3 targetLookPos = horsePos + horseTangent * LookAheadDistance;
        targetLookPos.Y += 1.15f;

        // 4. Smooth exponential spring damping
        if (!_isInitialized)
        {
            _currentCamPos = targetCamPos;
            _currentLookTarget = targetLookPos;
            _isInitialized = true;
        }
        else
        {
            float posAlpha = 1.0f - MathF.Exp(-14.0f * dt);
            float lookAlpha = 1.0f - MathF.Exp(-12.0f * dt);
            _currentCamPos = _currentCamPos.Lerp(targetCamPos, posAlpha);
            _currentLookTarget = _currentLookTarget.Lerp(targetLookPos, lookAlpha);
        }

        // 5. Subtle camera horizon counter-roll (±1.2° into steering/turns)
        float targetRoll = -steer * (1.2f * (MathF.PI / 180.0f));
        float rollAlpha = 1.0f - MathF.Exp(-8.0f * dt);
        _currentRoll += (targetRoll - _currentRoll) * rollAlpha;

        // 6. Apply position and look-at
        GlobalPosition = _currentCamPos;
        LookAt(_currentLookTarget, Vector3.Up);

        if (MathF.Abs(_currentRoll) > 0.0001f)
        {
            RotateZ(_currentRoll);
        }
    }

    public void ResetCamera()
    {
        _isInitialized = false;
        _currentRoll = 0.0f;
        Fov = BaseFov;
    }

    /// <summary>
    /// Snaps camera immediately to target behind horse without spring lag (for frame 0 / restart).
    /// </summary>
    public void SnapToTarget(Vector3 horsePos, Vector3 horseTangent)
    {
        Vector3 targetCamPos = horsePos - horseTangent * FollowDistance;
        targetCamPos.Y += CameraHeight;

        Vector3 targetLookPos = horsePos + horseTangent * LookAheadDistance;
        targetLookPos.Y += 1.15f;

        _currentCamPos = targetCamPos;
        _currentLookTarget = targetLookPos;
        _currentRoll = 0.0f;
        _isInitialized = true;
        GlobalPosition = _currentCamPos;
        LookAt(_currentLookTarget, Vector3.Up);
    }
}
