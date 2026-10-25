using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.UI;

/// <summary>
/// High-contrast CanvasLayer HUD displaying live speed, distance, score,
/// dynamic multiplier bar, state modals, and post-crash arcade leaderboard.
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

    // Simple Center Modal (Start, Countdown, Pause)
    private Control _simpleModal = null!;
    private Label _modalTitle = null!;
    private Label _modalSubtitle = null!;

    // Dedicated Post-Crash Game Over & Leaderboard Panel
    private PanelContainer _gameOverPanel = null!;
    private Label _gameOverTitle = null!;
    private Label _gameOverRecordBadge = null!;
    private Label _gameOverStatsLabel = null!;
    private VBoxContainer _leaderboardRowsBox = null!;
    private Label _gameOverPrompt = null!;

    private int _highlightRank = -1;
    private bool _isNewRecord = false;
    private IReadOnlyList<LeaderboardEntry>? _cachedLeaderboard;

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

        // 3. Simple Center Modal Overlay (Start, Countdown, Pause)
        _simpleModal = new Control
        {
            AnchorLeft = 0.5f,
            AnchorTop = 0.5f,
            AnchorRight = 0.5f,
            AnchorBottom = 0.5f,
            OffsetLeft = -320,
            OffsetTop = -140,
            OffsetRight = 320,
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
        _simpleModal.AddChild(modalVBox);
        root.AddChild(_simpleModal);

        // 4. Post-Crash Game Over & Leaderboard Card
        BuildGameOverPanel(root);
    }

    private void BuildGameOverPanel(Control root)
    {
        _gameOverPanel = new PanelContainer
        {
            Name = "GameOverPanel",
            AnchorLeft = 0.5f,
            AnchorTop = 0.5f,
            AnchorRight = 0.5f,
            AnchorBottom = 0.5f,
            OffsetLeft = -340,
            OffsetTop = -250,
            OffsetRight = 340,
            OffsetBottom = 250,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Visible = false
        };

        var panelStyle = new StyleBoxFlat
        {
            BgColor = new Color(0.06f, 0.09f, 0.16f, 0.94f),
            CornerRadiusTopLeft = 16,
            CornerRadiusTopRight = 16,
            CornerRadiusBottomLeft = 16,
            CornerRadiusBottomRight = 16,
            BorderWidthLeft = 2,
            BorderWidthTop = 2,
            BorderWidthRight = 2,
            BorderWidthBottom = 2,
            BorderColor = new Color(1.0f, 1.0f, 1.0f, 0.12f),
            ContentMarginLeft = 28,
            ContentMarginRight = 28,
            ContentMarginTop = 20,
            ContentMarginBottom = 20
        };
        _gameOverPanel.AddThemeStyleboxOverride("panel", panelStyle);

        var contentVBox = new VBoxContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill
        };
        _gameOverPanel.AddChild(contentVBox);

        // Header: GAME OVER
        _gameOverTitle = new Label
        {
            Text = "GAME OVER",
            HorizontalAlignment = HorizontalAlignment.Center,
            Modulate = new Color(0.94f, 0.27f, 0.27f) // #EF4444
        };
        _gameOverTitle.AddThemeFontSizeOverride("font_size", 34);
        contentVBox.AddChild(_gameOverTitle);

        // New Record Badge
        _gameOverRecordBadge = new Label
        {
            Text = "★ NEW ALL-TIME RECORD! ★",
            HorizontalAlignment = HorizontalAlignment.Center,
            Modulate = new Color(0.98f, 0.75f, 0.14f), // #FBBF24
            Visible = false
        };
        _gameOverRecordBadge.AddThemeFontSizeOverride("font_size", 16);
        contentVBox.AddChild(_gameOverRecordBadge);

        // Run summary stats
        _gameOverStatsLabel = new Label
        {
            Text = "Score: 0 pts  ·  Distance: 0 m  ·  🍎 0  ·  🧲 0",
            HorizontalAlignment = HorizontalAlignment.Center,
            Modulate = new Color(0.70f, 0.75f, 0.82f) // #94A3B8
        };
        _gameOverStatsLabel.AddThemeFontSizeOverride("font_size", 16);
        contentVBox.AddChild(_gameOverStatsLabel);

        contentVBox.AddChild(new HSeparator { Modulate = new Color(1, 1, 1, 0.2f) });

        // Leaderboard Title
        var lbHeaderBox = new HBoxContainer();
        var lbTitle = new Label
        {
            Text = "🏆 TOP RIDERS",
            Modulate = new Color(0.22f, 0.74f, 0.97f) // #38BDF8
        };
        lbTitle.AddThemeFontSizeOverride("font_size", 17);
        lbHeaderBox.AddChild(lbTitle);
        contentVBox.AddChild(lbHeaderBox);

        // Leaderboard Rows Container
        _leaderboardRowsBox = new VBoxContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill
        };
        contentVBox.AddChild(_leaderboardRowsBox);

        contentVBox.AddChild(new HSeparator { Modulate = new Color(1, 1, 1, 0.2f) });

        // Action Prompt
        _gameOverPrompt = new Label
        {
            Text = "PRESS SPACE OR TAP TO RIDE AGAIN",
            HorizontalAlignment = HorizontalAlignment.Center,
            Modulate = new Color(0.90f, 0.93f, 0.96f)
        };
        _gameOverPrompt.AddThemeFontSizeOverride("font_size", 18);
        contentVBox.AddChild(_gameOverPrompt);

        root.AddChild(_gameOverPanel);
    }

    /// <summary>
    /// Updates the leaderboard table displayed on the Game Over screen.
    /// </summary>
    public void UpdateLeaderboard(IReadOnlyList<LeaderboardEntry> entries, int highlightRank = -1, bool isNewRecord = false)
    {
        _cachedLeaderboard = entries;
        _highlightRank = highlightRank;
        _isNewRecord = isNewRecord;

        _gameOverRecordBadge.Visible = isNewRecord;

        // Clear existing rows
        foreach (Node child in _leaderboardRowsBox.GetChildren())
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
                CustomMinimumSize = new Vector2(0, 24)
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
                CustomMinimumSize = new Vector2(36, 0)
            };
            rankLabel.AddThemeFontSizeOverride("font_size", 15);
            row.AddChild(rankLabel);

            // Name & Difficulty
            string diffTag = string.IsNullOrEmpty(entry.Difficulty) ? "" : $" ({entry.Difficulty})";
            var nameLabel = new Label
            {
                Text = $"{entry.Name}{diffTag}",
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                ClipText = true
            };
            nameLabel.AddThemeFontSizeOverride("font_size", 15);
            row.AddChild(nameLabel);

            // Score
            var scoreLabel = new Label
            {
                Text = $"{entry.Score:N0} pts",
                HorizontalAlignment = HorizontalAlignment.Right,
                CustomMinimumSize = new Vector2(110, 0)
            };
            scoreLabel.AddThemeFontSizeOverride("font_size", 15);
            row.AddChild(scoreLabel);

            // Distance
            var distLabel = new Label
            {
                Text = $"{entry.Distance:N0}m",
                HorizontalAlignment = HorizontalAlignment.Right,
                CustomMinimumSize = new Vector2(80, 0),
                Modulate = new Color(0.65f, 0.70f, 0.78f)
            };
            distLabel.AddThemeFontSizeOverride("font_size", 15);
            row.AddChild(distLabel);

            // Highlight if current player's run
            if (isCurrentRun)
            {
                nameLabel.Modulate = new Color(0.98f, 0.75f, 0.14f); // Golden glow
                scoreLabel.Modulate = new Color(0.98f, 0.75f, 0.14f);
            }

            _leaderboardRowsBox.AddChild(row);
        }
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
                _simpleModal.Visible = true;
                _gameOverPanel.Visible = false;
                _modalTitle.Text = "ENDLESS RIDE";
                _modalSubtitle.Text = "PRESS SPACE / TAP TO START";
                break;

            case GameState.Countdown:
                _simpleModal.Visible = true;
                _gameOverPanel.Visible = false;
                int count = (int)MathF.Ceiling(countdownTimer);
                _modalTitle.Text = count > 0 ? $"{count}" : "GO!";
                _modalSubtitle.Text = "STEER WITH A/D OR TILT REINS";
                break;

            case GameState.Running:
                _simpleModal.Visible = false;
                _gameOverPanel.Visible = false;
                break;

            case GameState.Paused:
                _simpleModal.Visible = true;
                _gameOverPanel.Visible = false;
                _modalTitle.Text = "PAUSED";
                _modalSubtitle.Text = "PRESS P / ESCAPE TO RESUME";
                break;

            case GameState.GameOver:
                _simpleModal.Visible = false;
                _gameOverPanel.Visible = true;
                _gameOverStatsLabel.Text = $"Score: {score:N0} pts  ·  Distance: {distance:N0} m  ·  🍎 {apples}  ·  🧲 {shoes}";
                break;
        }
    }
}
