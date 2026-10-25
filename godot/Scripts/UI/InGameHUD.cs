using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.UI;

/// <summary>
/// High-contrast CanvasLayer HUD displaying live speed, distance, score,
/// dynamic multiplier bar, state modals, and post-crash arcade leaderboard.
/// Backed by Scenes/UI/HUD.tscn for visual editing and layout.
/// </summary>
public partial class InGameHUD : CanvasLayer
{
    [Export] public Label ScoreLabel { get; set; } = null!;
    [Export] public Label DistanceLabel { get; set; } = null!;
    [Export] public Label SpeedLabel { get; set; } = null!;
    [Export] public Label MultiplierLabel { get; set; } = null!;
    [Export] public ProgressBar MultiplierBar { get; set; } = null!;
    [Export] public Label ApplesLabel { get; set; } = null!;
    [Export] public Label ShoesLabel { get; set; } = null!;

    // Simple Center Modal (Start, Countdown, Pause, GO!)
    [Export] public Control SimpleModal { get; set; } = null!;
    [Export] public Label ModalTitle { get; set; } = null!;
    [Export] public Label ModalSubtitle { get; set; } = null!;

    // Dedicated Post-Crash Game Over & Leaderboard Panel
    [Export] public PanelContainer GameOverPanel { get; set; } = null!;
    [Export] public Label GameOverTitle { get; set; } = null!;
    [Export] public Label GameOverRecordBadge { get; set; } = null!;
    [Export] public Label GameOverStatsLabel { get; set; } = null!;
    [Export] public VBoxContainer LeaderboardRowsBox { get; set; } = null!;
    [Export] public Label GameOverPrompt { get; set; } = null!;

    // Cached telemetry to eliminate per-frame string allocations
    private int _lastScore = -1;
    private int _lastDistance = -1;
    private int _lastSpeedKmh = -1;
    private int _lastMultiplierTenths = -1;
    private int _lastApples = -1;
    private int _lastShoes = -1;

    // "GO!" transient banner timer (seconds)
    private float _goBannerTimer = 0.0f;
    private GameState _previousState = GameState.Start;

    public override void _Ready()
    {
        // Fallback resolution if instantiated via code without exported node paths
        ScoreLabel ??= GetNodeOrNull<Label>("HUD_Root/TopBar/ScoreBox/ScoreLabel")!;
        DistanceLabel ??= GetNodeOrNull<Label>("HUD_Root/TopBar/StatsBox/DistanceLabel")!;
        SpeedLabel ??= GetNodeOrNull<Label>("HUD_Root/TopBar/StatsBox/SpeedLabel")!;
        MultiplierLabel ??= GetNodeOrNull<Label>("HUD_Root/TopBar/MultiplierBox/MultiplierLabel")!;
        MultiplierBar ??= GetNodeOrNull<ProgressBar>("HUD_Root/TopBar/MultiplierBox/MultiplierBar")!;
        ApplesLabel ??= GetNodeOrNull<Label>("HUD_Root/PickupsBox/ApplesLabel")!;
        ShoesLabel ??= GetNodeOrNull<Label>("HUD_Root/PickupsBox/ShoesLabel")!;

        SimpleModal ??= GetNodeOrNull<Control>("HUD_Root/CenterModal")!;
        ModalTitle ??= GetNodeOrNull<Label>("HUD_Root/CenterModal/ModalVBox/ModalTitle")!;
        ModalSubtitle ??= GetNodeOrNull<Label>("HUD_Root/CenterModal/ModalVBox/ModalSubtitle")!;

        GameOverPanel ??= GetNodeOrNull<PanelContainer>("HUD_Root/GameOverPanel")!;
        GameOverTitle ??= GetNodeOrNull<Label>("HUD_Root/GameOverPanel/ContentVBox/GameOverTitle")!;
        GameOverRecordBadge ??= GetNodeOrNull<Label>("HUD_Root/GameOverPanel/ContentVBox/RecordBadge")!;
        GameOverStatsLabel ??= GetNodeOrNull<Label>("HUD_Root/GameOverPanel/ContentVBox/SummaryStatsLabel")!;
        LeaderboardRowsBox ??= GetNodeOrNull<VBoxContainer>("HUD_Root/GameOverPanel/ContentVBox/LeaderboardRows")!;
        GameOverPrompt ??= GetNodeOrNull<Label>("HUD_Root/GameOverPanel/ContentVBox/GameOverPrompt")!;
    }

    public override void _Process(double delta)
    {
        if (_goBannerTimer > 0.0f)
        {
            _goBannerTimer -= (float)delta;
            if (_goBannerTimer <= 0.0f && SimpleModal != null)
            {
                SimpleModal.Visible = false;
            }
        }
    }

    /// <summary>
    /// Updates the leaderboard table displayed on the Game Over screen.
    /// </summary>
    public void UpdateLeaderboard(IReadOnlyList<LeaderboardEntry> entries, int highlightRank = -1, bool isNewRecord = false)
    {
        if (GameOverRecordBadge != null)
        {
            GameOverRecordBadge.Visible = isNewRecord;
        }

        if (LeaderboardRowsBox == null) return;

        // Clear existing rows
        foreach (Node child in LeaderboardRowsBox.GetChildren())
        {
            child.QueueFree();
        }

        // Display up to 5 top scores
        int count = Math.Min(5, entries.Count);
        for (int i = 0; i < count; i++)
        {
            var entry = entries[i];
            bool isCurrentRun = (i == highlightRank);

            var row = new HBoxContainer
            {
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                CustomMinimumSize = new Vector2(0, 28)
            };

            // Medal / Rank
            string medal = i switch
            {
                0 => "🥇",
                1 => "🥈",
                2 => "🥉",
                _ => $" #{i + 1}"
            };

            var rankLabel = new Label
            {
                Text = medal,
                CustomMinimumSize = new Vector2(40, 0)
            };
            rankLabel.AddThemeFontSizeOverride("font_size", 18);
            row.AddChild(rankLabel);

            // Name, Difficulty & Seed
            string diffStr = string.IsNullOrEmpty(entry.Difficulty) ? "standard" : entry.Difficulty;
            string seedStr = entry.Seed > 0 ? $" · #{entry.Seed}" : "";
            string tag = $" ({diffStr}{seedStr})";
            var nameLabel = new Label
            {
                Text = $"{entry.Name}{tag}",
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                ClipText = true
            };
            nameLabel.AddThemeFontSizeOverride("font_size", 18);
            row.AddChild(nameLabel);

            // Score (formatted consistently with integer leaderboard record)
            var scoreLabel = new Label
            {
                Text = $"{entry.Score:N0} pts",
                HorizontalAlignment = HorizontalAlignment.Right,
                CustomMinimumSize = new Vector2(120, 0)
            };
            scoreLabel.AddThemeFontSizeOverride("font_size", 18);
            row.AddChild(scoreLabel);

            // Distance
            var distLabel = new Label
            {
                Text = $"{entry.Distance:N0}m",
                HorizontalAlignment = HorizontalAlignment.Right,
                CustomMinimumSize = new Vector2(90, 0),
                Modulate = new Color(0.65f, 0.70f, 0.78f)
            };
            distLabel.AddThemeFontSizeOverride("font_size", 18);
            row.AddChild(distLabel);

            // Highlight if current player's run
            if (isCurrentRun)
            {
                nameLabel.Modulate = new Color(0.98f, 0.75f, 0.14f); // Golden glow
                scoreLabel.Modulate = new Color(0.98f, 0.75f, 0.14f);
                rankLabel.Modulate = new Color(0.98f, 0.75f, 0.14f);
            }

            LeaderboardRowsBox.AddChild(row);
        }
    }

    /// <summary>
    /// Update HUD telemetry from GameManager state with zero unnecessary heap allocations.
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
        // 1. Telemetry updates (only reallocate strings when integer values change)
        int intScore = (int)score;
        if (intScore != _lastScore && ScoreLabel != null)
        {
            _lastScore = intScore;
            ScoreLabel.Text = intScore.ToString("N0");
        }

        int intDist = (int)distance;
        if (intDist != _lastDistance && DistanceLabel != null)
        {
            _lastDistance = intDist;
            DistanceLabel.Text = $"{intDist} m";
        }

        int kmh = (int)MathF.Round(speed * 3.6f);
        if (kmh != _lastSpeedKmh && SpeedLabel != null)
        {
            _lastSpeedKmh = kmh;
            SpeedLabel.Text = $"{kmh} km/h";
        }

        int multTenths = (int)MathF.Round(multiplier * 10.0f);
        if (multTenths != _lastMultiplierTenths && MultiplierLabel != null)
        {
            _lastMultiplierTenths = multTenths;
            MultiplierLabel.Text = $"{multiplier:F1}x MULTIPLIER";
        }

        if (MultiplierBar != null)
        {
            MultiplierBar.Value = Math.Clamp(multiplierTimer / Config.MultiplierHoldDuration, 0.0f, 1.0f);
        }

        if (apples != _lastApples && ApplesLabel != null)
        {
            _lastApples = apples;
            ApplesLabel.Text = $"🍎 {apples}  ";
        }

        if (shoes != _lastShoes && ShoesLabel != null)
        {
            _lastShoes = shoes;
            ShoesLabel.Text = $"🧲 {shoes}";
        }

        // 2. Detect transition from Countdown to Running to display transient "GO!" banner
        if (_previousState == GameState.Countdown && state == GameState.Running)
        {
            _goBannerTimer = 0.55f;
            if (SimpleModal != null && ModalTitle != null && ModalSubtitle != null)
            {
                SimpleModal.Visible = true;
                ModalTitle.Text = "GO!";
                ModalTitle.Modulate = new Color(0.35f, 0.95f, 0.45f); // Vibrant energetic green
                ModalSubtitle.Text = "RIDE FOR GLORY!";
            }
        }
        _previousState = state;

        // 3. Modals and panels according to state
        switch (state)
        {
            case GameState.Start:
                _goBannerTimer = 0.0f;
                if (SimpleModal != null) SimpleModal.Visible = true;
                if (GameOverPanel != null) GameOverPanel.Visible = false;
                if (ModalTitle != null)
                {
                    ModalTitle.Text = "ENDLESS RIDE";
                    ModalTitle.Modulate = Colors.White;
                }
                if (ModalSubtitle != null) ModalSubtitle.Text = "PRESS SPACE / TAP / (A) TO START";
                break;

            case GameState.Countdown:
                _goBannerTimer = 0.0f;
                if (SimpleModal != null) SimpleModal.Visible = true;
                if (GameOverPanel != null) GameOverPanel.Visible = false;
                int count = (int)MathF.Ceiling(countdownTimer);
                if (ModalTitle != null)
                {
                    ModalTitle.Text = count > 0 ? $"{count}" : "READY!";
                    ModalTitle.Modulate = count switch
                    {
                        1 => new Color(0.98f, 0.75f, 0.14f), // Amber
                        2 => new Color(0.38f, 0.82f, 0.98f), // Cyan
                        _ => Colors.White
                    };
                }
                if (ModalSubtitle != null) ModalSubtitle.Text = "STEER WITH A/D, GAMEPAD, OR TILT REINS";
                break;

            case GameState.Running:
                if (_goBannerTimer <= 0.0f && SimpleModal != null)
                {
                    SimpleModal.Visible = false;
                }
                if (GameOverPanel != null) GameOverPanel.Visible = false;
                break;

            case GameState.Paused:
                _goBannerTimer = 0.0f;
                if (SimpleModal != null) SimpleModal.Visible = true;
                if (GameOverPanel != null) GameOverPanel.Visible = false;
                if (ModalTitle != null)
                {
                    ModalTitle.Text = "PAUSED";
                    ModalTitle.Modulate = Colors.White;
                }
                if (ModalSubtitle != null) ModalSubtitle.Text = "RESUME VIA COMPANION APP";
                break;

            case GameState.GameOver:
                _goBannerTimer = 0.0f;
                if (SimpleModal != null) SimpleModal.Visible = false;
                if (GameOverPanel != null) GameOverPanel.Visible = true;
                if (GameOverStatsLabel != null)
                {
                    GameOverStatsLabel.Text = $"Score: {intScore:N0} pts  ·  Distance: {intDist:N0} m  ·  🍎 {apples}  ·  🧲 {shoes}";
                }
                break;
        }
    }
}
