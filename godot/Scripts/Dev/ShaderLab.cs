using System;
using Godot;

namespace EndlessRide.Dev;

/// <summary>
/// Controller for the ShaderLab scene.
/// Provides interactive toggles for shader features, lighting presets, and live feedback.
/// </summary>
public partial class ShaderLab : Node3D
{
    [Export] public ShaderMaterial? GoldMaterial { get; set; }
    [Export] public ShaderMaterial? AppleMaterial { get; set; }
    [Export] public WorldEnvironment? WorldEnv { get; set; }
    [Export] public DirectionalLight3D? SunLight { get; set; }
    [Export] public Label? StatusLabel { get; set; }

    private bool _appleSheen = true;
    private bool _bothRim = true;
    private bool _goldSparkles = true;
    private bool _hoverEnabled = true;
    private float _goldSparkleIntensity = 30.0f;
    private float _sparkleSize = 0.28f;
    private int _skyMode = 0; // 0 = Day, 1 = Sunset, 2 = Night

    public override void _Ready()
    {
        ApplyMaterials();
        InitGamePresets();
        UpdateStatusDisplay();
    }

    private void ApplyMaterials()
    {
        if (GoldMaterial != null)
        {
            var horseshoe = GetNodeOrNull("HorseshoeAnchor/HorseshoeModel");
            if (horseshoe is GeometryInstance3D geom)
            {
                geom.MaterialOverride = GoldMaterial;
            }
            else if (horseshoe != null)
            {
                var meshChild = horseshoe.FindChild("*", true, false) as GeometryInstance3D;
                if (meshChild != null)
                {
                    meshChild.MaterialOverride = GoldMaterial;
                }
            }
        }
    }

    private void InitGamePresets()
    {
        // Apple: Rim Glow + Sheen (No sparkles)
        AppleMaterial?.SetShaderParameter("enable_rim", _bothRim);
        AppleMaterial?.SetShaderParameter("enable_sheen", _appleSheen);
        AppleMaterial?.SetShaderParameter("enable_sparkles", false);
        AppleMaterial?.SetShaderParameter("enable_hover", _hoverEnabled);

        // Horseshoe: Rim Glow + Sparkles @ 30 (No sheen)
        GoldMaterial?.SetShaderParameter("enable_rim", _bothRim);
        GoldMaterial?.SetShaderParameter("enable_sheen", false);
        GoldMaterial?.SetShaderParameter("enable_sparkles", _goldSparkles);
        GoldMaterial?.SetShaderParameter("sparkle_intensity", _goldSparkleIntensity);
        GoldMaterial?.SetShaderParameter("sparkle_size", _sparkleSize);
        GoldMaterial?.SetShaderParameter("enable_hover", _hoverEnabled);
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey keyEvent && keyEvent.Pressed && !keyEvent.Echo)
        {
            switch (keyEvent.Keycode)
            {
                case Key.Key1:
                    _appleSheen = !_appleSheen;
                    AppleMaterial?.SetShaderParameter("enable_sheen", _appleSheen);
                    UpdateStatusDisplay();
                    break;

                case Key.Key2:
                    _bothRim = !_bothRim;
                    AppleMaterial?.SetShaderParameter("enable_rim", _bothRim);
                    GoldMaterial?.SetShaderParameter("enable_rim", _bothRim);
                    UpdateStatusDisplay();
                    break;

                case Key.Key3:
                    _goldSparkles = !_goldSparkles;
                    GoldMaterial?.SetShaderParameter("enable_sparkles", _goldSparkles);
                    UpdateStatusDisplay();
                    break;

                case Key.Key4:
                    _hoverEnabled = !_hoverEnabled;
                    AppleMaterial?.SetShaderParameter("enable_hover", _hoverEnabled);
                    GoldMaterial?.SetShaderParameter("enable_hover", _hoverEnabled);
                    UpdateStatusDisplay();
                    break;

                case Key.Up:
                    _goldSparkleIntensity = Math.Min(60.0f, _goldSparkleIntensity + 5.0f);
                    GoldMaterial?.SetShaderParameter("sparkle_intensity", _goldSparkleIntensity);
                    UpdateStatusDisplay();
                    break;

                case Key.Down:
                    _goldSparkleIntensity = Math.Max(0.0f, _goldSparkleIntensity - 5.0f);
                    GoldMaterial?.SetShaderParameter("sparkle_intensity", _goldSparkleIntensity);
                    UpdateStatusDisplay();
                    break;

                case Key.Bracketright: // ']'
                    _sparkleSize = Math.Min(0.45f, _sparkleSize + 0.04f);
                    GoldMaterial?.SetShaderParameter("sparkle_size", _sparkleSize);
                    UpdateStatusDisplay();
                    break;

                case Key.Bracketleft: // '['
                    _sparkleSize = Math.Max(0.08f, _sparkleSize - 0.04f);
                    GoldMaterial?.SetShaderParameter("sparkle_size", _sparkleSize);
                    UpdateStatusDisplay();
                    break;

                case Key.C:
                    CycleLightingMode();
                    UpdateStatusDisplay();
                    break;
            }
        }
    }

    private void CycleLightingMode()
    {
        _skyMode = (_skyMode + 1) % 3;
        if (WorldEnv?.Environment?.Sky?.SkyMaterial is ProceduralSkyMaterial skyMat)
        {
            if (_skyMode == 0) // Day
            {
                skyMat.SkyTopColor = new Color(0.49f, 0.78f, 0.89f);
                skyMat.SkyHorizonColor = new Color(0.76f, 0.89f, 0.94f);
                if (SunLight != null)
                {
                    SunLight.LightColor = new Color(1.0f, 0.97f, 0.90f);
                    SunLight.LightEnergy = 1.15f;
                }
            }
            else if (_skyMode == 1) // Sunset
            {
                skyMat.SkyTopColor = new Color(0.24f, 0.22f, 0.45f);
                skyMat.SkyHorizonColor = new Color(0.95f, 0.45f, 0.25f);
                if (SunLight != null)
                {
                    SunLight.LightColor = new Color(1.0f, 0.65f, 0.40f);
                    SunLight.LightEnergy = 1.35f;
                }
            }
            else // Night
            {
                skyMat.SkyTopColor = new Color(0.04f, 0.05f, 0.12f);
                skyMat.SkyHorizonColor = new Color(0.12f, 0.14f, 0.25f);
                if (SunLight != null)
                {
                    SunLight.LightColor = new Color(0.45f, 0.55f, 0.85f);
                    SunLight.LightEnergy = 0.40f;
                }
            }
        }
    }

    private void UpdateStatusDisplay()
    {
        if (StatusLabel == null) return;

        string skyName = _skyMode switch
        {
            0 => "Day (Crisp)",
            1 => "Sunset (Warm)",
            _ => "Night (Cool)"
        };

        StatusLabel.Text =
            $"[1] Apple Sheen: {(_appleSheen ? "ON" : "OFF")}\n" +
            $"[2] Rim Glow (Both): {(_bothRim ? "ON" : "OFF")}\n" +
            $"[3] Horseshoe Sparkles: {(_goldSparkles ? "ON" : "OFF")}\n" +
            $"    • Intensity [Up/Down]: {_goldSparkleIntensity:F0}\n" +
            $"    • Size [[ / ]]: {_sparkleSize:F2}\n" +
            $"[4] Bob / Hover: {(_hoverEnabled ? "ON" : "OFF")}\n" +
            $"[C] Lighting: {skyName}\n\n" +
            $"[LMB Drag] Orbit  |  [Wheel] Zoom\n" +
            $"[Space] Pause Orbit  |  [R] Reset View";
    }
}
