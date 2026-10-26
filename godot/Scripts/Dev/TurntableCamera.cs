using System;
using Godot;

namespace EndlessRide.Dev;

/// <summary>
/// Orbit / turntable inspection camera for shader and asset testing.
/// Supports left-click drag orbit, mouse wheel zoom, and spacebar to toggle auto-rotation.
/// </summary>
public partial class TurntableCamera : Camera3D
{
    [Export] public Vector3 TargetPosition { get; set; } = new Vector3(0, 0.7f, 0);
    [Export] public float Distance { get; set; } = 3.2f;
    [Export] public float MinDistance { get; set; } = 1.0f;
    [Export] public float MaxDistance { get; set; } = 8.0f;
    [Export] public float OrbitSpeed { get; set; } = 25.0f; // degrees per second
    [Export] public bool AutoRotate { get; set; } = true;

    private float _yaw = 45.0f;
    private float _pitch = 18.0f;
    private bool _isDragging;
    private Vector2 _lastMousePos;

    public override void _Ready()
    {
        UpdateCameraTransform();
    }

    public override void _Process(double delta)
    {
        if (AutoRotate && !_isDragging)
        {
            _yaw += OrbitSpeed * (float)delta;
            if (_yaw >= 360.0f) _yaw -= 360.0f;
            UpdateCameraTransform();
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventMouseButton mb)
        {
            if (mb.ButtonIndex == MouseButton.Left)
            {
                _isDragging = mb.Pressed;
                _lastMousePos = mb.Position;
            }
            else if (mb.ButtonIndex == MouseButton.WheelUp && mb.Pressed)
            {
                Distance = Math.Clamp(Distance - 0.25f, MinDistance, MaxDistance);
                UpdateCameraTransform();
            }
            else if (mb.ButtonIndex == MouseButton.WheelDown && mb.Pressed)
            {
                Distance = Math.Clamp(Distance + 0.25f, MinDistance, MaxDistance);
                UpdateCameraTransform();
            }
            else if (mb.ButtonIndex == MouseButton.Middle && mb.Pressed)
            {
                ResetView();
            }
        }
        else if (@event is InputEventMouseMotion mm && _isDragging)
        {
            Vector2 delta = mm.Position - _lastMousePos;
            _lastMousePos = mm.Position;

            _yaw -= delta.X * 0.35f;
            _pitch = Math.Clamp(_pitch + delta.Y * 0.35f, -30.0f, 80.0f);
            UpdateCameraTransform();
        }
        else if (@event is InputEventKey key && key.Pressed && !key.Echo)
        {
            if (key.Keycode == Key.Space)
            {
                AutoRotate = !AutoRotate;
            }
            else if (key.Keycode == Key.R)
            {
                ResetView();
            }
        }
    }

    public void ResetView()
    {
        _yaw = 45.0f;
        _pitch = 18.0f;
        Distance = 3.2f;
        UpdateCameraTransform();
    }

    private void UpdateCameraTransform()
    {
        float yawRad = Mathf.DegToRad(_yaw);
        float pitchRad = Mathf.DegToRad(_pitch);

        float cosPitch = Mathf.Cos(pitchRad);
        float sinPitch = Mathf.Sin(pitchRad);

        Vector3 offset = new Vector3(
            Mathf.Sin(yawRad) * cosPitch,
            sinPitch,
            Mathf.Cos(yawRad) * cosPitch
        ) * Distance;

        GlobalPosition = TargetPosition + offset;
        LookAt(TargetPosition, Vector3.Up);
    }
}
