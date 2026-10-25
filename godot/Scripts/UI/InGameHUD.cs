using System;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.UI;

/// <summary>
/// High-contrast CanvasLayer HUD displaying live speed, distance, score,
/// dynamic multiplier bar, and game state prompts (Countdown, Pause, Game Over).
/// Ported from src/ui/HUD.ts.
/// </summary>
public partial class InGameHUD : CanvasLayer
{
    private Label _scoreLabel = null!;
    private Label _distanceLabel = null!;
    private Label _speedLabel = null!;
    private Label _multiplierLabel = null!;
    private ProgressBar _multiplierBar = null!;
    private Label _applesLabel = null!;
    private Label _shoesLabel = null!;

    private Control _centerModal = null!;
    private Label _modalTitle = null!;
    private Label _modalSubtitle = null!;

    public override void _Ready()
    {
        BuildUI();
    }

    private void BuildUI()
    {
        var root = new Control
        {
            Name = "HUD_Root",
            AnchorRight = 1.0f,
            AnchorBottom = 1.0f
        };
        AddChild(root);

        // 1. Top Bar Container
        var topBar = new HBoxContainer
        {
            AnchorRight = 1.0f,
            OffsetLeft = 32,
            OffsetTop = 24,
            OffsetRight = -32,
            OffsetBottom = 80
        };
        root.AddChild(topBar);

        // Score
        var scoreBox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        var scoreTitle = new Label { Text = "SCORE", Modulate = new Color(0.7f, 0.7f, 0.7f) };
        _scoreLabel = new Label { Text = "0" };
        _scoreLabel.AddThemeFontSizeOverride("font_size", 32);
        scoreBox.AddChild(scoreTitle);
        scoreBox.AddChild(_scoreLabel);
        topBar.AddChild(scoreBox);

        // Multiplier
        var multBox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        _multiplierLabel = new Label { Text = "1.0x MULTIPLIER", Modulate = new Color(1.0f, 0.85f, 0.2f) };
        _multiplierLabel.AddThemeFontSizeOverride("font_size", 24);
        _multiplierBar = new ProgressBar
        {
            MinValue = 0.0f,
            MaxValue = 1.0f,
            Value = 1.0f,
            ShowPercentage = false,
            CustomMinimumSize = new Vector2(160, 10)
        };
        multBox.AddChild(_multiplierLabel);
        multBox.AddChild(_multiplierBar);
        topBar.AddChild(multBox);

        // Distance & Speed
        var statsBox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill, Alignment = BoxContainer.AlignmentMode.End };
        _distanceLabel = new Label { Text = "0 m", HorizontalAlignment = HorizontalAlignment.Right };
        _distanceLabel.AddThemeFontSizeOverride("font_size", 28);
        _speedLabel = new Label { Text = "65 km/h", HorizontalAlignment = HorizontalAlignment.Right, Modulate = new Color(0.3f, 0.8f, 1.0f) };
        statsBox.AddChild(_distanceLabel);
        statsBox.AddChild(_speedLabel);
        topBar.AddChild(statsBox);

        // 2. Pickups Bar (top-left below topBar)
        var pickupsBox = new HBoxContainer
        {
            OffsetLeft = 32,
            OffsetTop = 96,
            OffsetRight = 300,
            OffsetBottom = 130
        };
        _applesLabel = new Label { Text = "🍎 0  ", Modulate = new Color(1.0f, 0.4f, 0.4f) };
        _shoesLabel = new Label { Text = "🧲 0", Modulate = new Color(1.0f, 0.85f, 0.2f) };
        pickupsBox.AddChild(_applesLabel);
        pickupsBox.AddChild(_shoesLabel);
        root.AddChild(pickupsBox);

        // 3. Center Modal Overlay
        _centerModal = new Control
        {
            AnchorLeft = 0.5f,
            AnchorTop = 0.5f,
            AnchorRight = 0.5f,
            AnchorBottom = 0.5f,
            OffsetLeft = -300,
            OffsetTop = -140,
            OffsetRight = 300,
            OffsetBottom = 140
        };

        var modalVBox = new VBoxContainer
        {
            AnchorRight = 1.0f,
            AnchorBottom = 1.0f,
            Alignment = BoxContainer.AlignmentMode.Center
        };

        _modalTitle = new Label
        {
            Text = "ENDLESS RIDE",
            HorizontalAlignment = HorizontalAlignment.Center
        };
        _modalTitle.AddThemeFontSizeOverride("font_size", 48);

        _modalSubtitle = new Label
        {
            Text = "PRESS SPACE / TAP TO RIDE",
            HorizontalAlignment = HorizontalAlignment.Center,
            Modulate = new Color(0.85f, 0.85f, 0.85f)
        };
        _modalSubtitle.AddThemeFontSizeOverride("font_size", 24);

        modalVBox.AddChild(_modalTitle);
        modalVBox.AddChild(_modalSubtitle);
        _centerModal.AddChild(modalVBox);
        root.AddChild(_centerModal);
    }

    /// <summary>
    /// Update HUD telemetry from GameManager state.
    /// </summary>
    public void UpdateHUD(
        GameState state,
        float score,
        float distance,
        float speed,
        float multiplier,
        float multiplierTimer,
        int apples,
        int shoes,
        float countdownTimer)
    {
        _scoreLabel.Text = $"{score:F0}";
        _distanceLabel.Text = $"{distance:F0} m";
        _speedLabel.Text = $"{speed * 3.6f:F0} km/h";

        _multiplierLabel.Text = $"{multiplier:F1}x MULTIPLIER";
        _multiplierBar.Value = Math.Clamp(multiplierTimer / Config.MultiplierHoldDuration, 0.0f, 1.0f);

        _applesLabel.Text = $"🍎 {apples}  ";
        _shoesLabel.Text = $"🧲 {shoes}";

        switch (state)
        {
            case GameState.Start:
                _centerModal.Visible = true;
                _modalTitle.Text = "ENDLESS RIDE";
                _modalSubtitle.Text = "PRESS SPACE / TAP TO START";
                break;

            case GameState.Countdown:
                _centerModal.Visible = true;
                int count = (int)MathF.Ceiling(countdownTimer);
                _modalTitle.Text = count > 0 ? $"{count}" : "GO!";
                _modalSubtitle.Text = "STEER WITH A/D OR TILT REINS";
                break;

            case GameState.Running:
                _centerModal.Visible = false;
                break;

            case GameState.Paused:
                _centerModal.Visible = true;
                _modalTitle.Text = "PAUSED";
                _modalSubtitle.Text = "PRESS P / ESCAPE TO RESUME";
                break;

            case GameState.GameOver:
                _centerModal.Visible = true;
                _modalTitle.Text = "GAME OVER";
                _modalSubtitle.Text = $"DISTANCE: {distance:F0} m  •  SCORE: {score:F0}\nPRESS SPACE / TAP TO RIDE AGAIN";
                break;
        }
    }
}
