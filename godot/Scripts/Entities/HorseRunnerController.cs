using System;
using Godot;
using EndlessRide.Core;
using EndlessRide.Track;

namespace EndlessRide.Entities;

/// <summary>
/// Forward track gallop locomotion controller, Left/Right lateral steering physics,
/// 4-point ground suspension, centrifugal banking roll, and dynamic rider kinematics.
/// Ported from src/entities/horse/HorseRunnerController.ts.
/// </summary>
public partial class HorseRunnerController : Node3D
{
    [Export] public float BaseSpeed { get; set; } = Config.BaseSpeed;
    [Export] public float MaxSpeed { get; set; } = Config.MaxSpeed;
    [Export] public float SteerMaxSpeed { get; set; } = Config.SteerMaxSpeed;
    [Export] public float MaxLateralOffset { get; set; } = Config.MaxLateralOffset;
    [Export] public float AccelRate { get; set; } = 0.20f;

    public float Distance { get; private set; }
    public float PrevDistance { get; private set; }
    public float Speed { get; private set; }
    public float LateralOffset { get; private set; }
    public float LateralVelocity { get; private set; }
    public float GallopPhase { get; private set; }
    public bool IsCrashed { get; private set; }

    public GirlRiderEntity Rider { get; private set; } = null!;
    private SplineTrack _track = null!;

    private Node3D _horseVisuals = null!;
    private Node3D _saddlePoint = null!;
    private Node3D _headBitLeft = null!;
    private Node3D _headBitRight = null!;

    private Node3D? _gltfHorseModel;
    private AnimationPlayer? _animPlayer;

    // Procedural reins mesh
    private MeshInstance3D _reinsMeshInst = null!;
    private ImmediateMesh _reinsMesh = null!;

    // 4-point suspension ground probes
    private const float WheelbaseHalf = 0.95f;  // Front/Back stride distance
    private const float TrackWidthHalf = 0.35f; // Left/Right hoof distance
    private const float GltfScale = 0.38f;

    public override void _Ready()
    {
        Speed = BaseSpeed;
        BuildProceduralHorse();
        TryLoadGltfHorse();
        BuildReins();
    }

    public void Initialize(SplineTrack track)
    {
        _track = track;
        UpdateTransform();
    }

    private void BuildProceduralHorse()
    {
        _horseVisuals = new Node3D { Name = "HorseVisuals" };
        AddChild(_horseVisuals);

        // Saddle Point and bit markers attached directly to controller root
        _saddlePoint = new Node3D { Name = "SaddlePoint", Position = new Vector3(0, 1.55f, 0.05f) };
        AddChild(_saddlePoint);

        _headBitLeft = new Node3D { Name = "BitL", Position = new Vector3(-0.16f, 1.95f, 1.35f) };
        _headBitRight = new Node3D { Name = "BitR", Position = new Vector3(0.16f, 1.95f, 1.35f) };
        AddChild(_headBitLeft);
        AddChild(_headBitRight);

        var coatMat = new StandardMaterial3D { AlbedoColor = new Color(0.38f, 0.22f, 0.12f), Roughness = 0.7f };
        var maneMat = new StandardMaterial3D { AlbedoColor = new Color(0.12f, 0.08f, 0.05f), Roughness = 0.9f };
        var hoofMat = new StandardMaterial3D { AlbedoColor = new Color(0.15f, 0.15f, 0.16f), Roughness = 0.4f };

        // Torso / Barrel
        var bodyMesh = new BoxMesh { Size = new Vector3(0.68f, 0.75f, 1.85f), Material = coatMat };
        var bodyInst = new MeshInstance3D { Mesh = bodyMesh, Position = new Vector3(0, 1.15f, 0) };
        _horseVisuals.AddChild(bodyInst);

        // Neck
        var neckMesh = new BoxMesh { Size = new Vector3(0.40f, 0.85f, 0.48f), Material = coatMat };
        var neckInst = new MeshInstance3D { Mesh = neckMesh, Position = new Vector3(0, 1.62f, 0.85f) };
        neckInst.RotationDegrees = new Vector3(35.0f, 0, 0);
        _horseVisuals.AddChild(neckInst);

        // Head
        var headMesh = new BoxMesh { Size = new Vector3(0.32f, 0.38f, 0.65f), Material = coatMat };
        var headInst = new MeshInstance3D { Mesh = headMesh, Position = new Vector3(0, 2.05f, 1.15f) };
        headInst.RotationDegrees = new Vector3(-20.0f, 0, 0);
        _horseVisuals.AddChild(headInst);

        // 4 Legs
        var legMesh = new BoxMesh { Size = new Vector3(0.16f, 0.85f, 0.18f), Material = coatMat };
        var hoofMesh = new BoxMesh { Size = new Vector3(0.17f, 0.18f, 0.20f), Material = hoofMat };

        Vector3[] legOffsets =
        {
            new(-TrackWidthHalf, 0.5f, WheelbaseHalf),   // Front Left
            new(TrackWidthHalf, 0.5f, WheelbaseHalf),    // Front Right
            new(-TrackWidthHalf, 0.5f, -WheelbaseHalf),  // Rear Left
            new(TrackWidthHalf, 0.5f, -WheelbaseHalf)    // Rear Right
        };

        foreach (var offset in legOffsets)
        {
            var leg = new Node3D { Position = offset };
            var legInst = new MeshInstance3D { Mesh = legMesh };
            var hoofInst = new MeshInstance3D { Mesh = hoofMesh, Position = new Vector3(0, -0.42f, 0.02f) };
            leg.AddChild(legInst);
            leg.AddChild(hoofInst);
            _horseVisuals.AddChild(leg);
        }

        // Attach Rider
        Rider = new GirlRiderEntity { Name = "GirlRider" };
        _saddlePoint.AddChild(Rider);
    }

    private void TryLoadGltfHorse()
    {
        const string horsePath = "res://Assets/Models/Horse.gltf";
        if (!ResourceLoader.Exists(horsePath)) return;

        var scene = GD.Load<PackedScene>(horsePath);
        if (scene == null) return;

        _gltfHorseModel = scene.Instantiate<Node3D>();
        if (_gltfHorseModel == null) return;

        // Apply scale (0.38) and center pivot along Z matching Three.js
        _gltfHorseModel.Scale = new Vector3(GltfScale, GltfScale, GltfScale);
        _gltfHorseModel.Position = new Vector3(0, 0, -0.72f * GltfScale);

        // Hide low-poly procedural fallback box meshes
        _horseVisuals.Visible = false;
        AddChild(_gltfHorseModel);

        // Refit saddle and bit markers to realistic horse anatomy
        _saddlePoint.Position = new Vector3(0, 1.25f, -0.05f);
        _headBitLeft.Position = new Vector3(-0.14f, 1.55f, 0.90f);
        _headBitRight.Position = new Vector3(0.14f, 1.55f, 0.90f);

        _animPlayer = _gltfHorseModel.FindChild("AnimationPlayer", true, false) as AnimationPlayer;
        if (_animPlayer != null && _animPlayer.HasAnimation("Gallop"))
        {
            _animPlayer.Play("Gallop");
            GD.Print("[HorseRunnerController] Loaded high-fidelity animated glTF Horse model successfully.");
        }
    }

    private void BuildReins()
    {
        _reinsMesh = new ImmediateMesh();
        var reinMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.22f, 0.12f, 0.06f),
            Roughness = 0.8f,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded
        };

        _reinsMeshInst = new MeshInstance3D
        {
            Name = "ReinsMesh",
            Mesh = _reinsMesh,
            MaterialOverride = reinMat
        };
        AddChild(_reinsMeshInst);
    }

    /// <summary>
    /// Update forward locomotion, lateral steering physics, 4-point suspension, and kinematics.
    /// </summary>
    public void UpdateController(float steerInput, float dt)
    {
        if (IsCrashed || _track == null) return;

        float clampedDt = (float.IsNaN(dt) || dt <= 0.0f) ? 0.0166f : MathF.Min(dt, 0.05f);
        float steer = Math.Clamp(steerInput, -1.0f, 1.0f);

        // 1. Arc-length compensated forward progression
        PrevDistance = Distance;
        float dPds = _track.GetArcLengthFactor(Distance);
        if (dPds <= 0.0001f) dPds = 1.0f;
        float ds = (Speed * clampedDt) / dPds;
        Distance += ds;

        // Acceleration progression
        Speed = MathF.Min(MaxSpeed, BaseSpeed + AccelRate * MathF.Sqrt(MathF.Max(0.0f, Distance)));

        // 2. Responsive lateral Left/Right steering with exponential damping
        float targetLateralVel = steer * SteerMaxSpeed;
        LateralVelocity += (targetLateralVel - LateralVelocity) * (1.0f - MathF.Exp(-18.0f * clampedDt));
        LateralOffset += LateralVelocity * clampedDt;

        // Boundary clamp
        if (LateralOffset >= MaxLateralOffset)
        {
            LateralOffset = MaxLateralOffset;
            if (LateralVelocity > 0.0f) LateralVelocity = 0.0f;
        }
        else if (LateralOffset <= -MaxLateralOffset)
        {
            LateralOffset = -MaxLateralOffset;
            if (LateralVelocity < 0.0f) LateralVelocity = 0.0f;
        }

        // 3. 4-point raycast suspension & track alignment
        UpdateTransform();

        // 4. Gallop cadence animation
        float strideFreq = 4.4f * (Speed / 18.0f);
        GallopPhase += clampedDt * strideFreq * MathF.PI * 2.0f;

        if (_animPlayer != null && _animPlayer.HasAnimation("Gallop"))
        {
            if (!_animPlayer.IsPlaying())
            {
                _animPlayer.Play("Gallop");
            }
            _animPlayer.SpeedScale = (Speed / 18.0f) * 1.6f;
        }

        float horsePitchDelta = MathF.Cos(GallopPhase) * 0.06f;
        if (_horseVisuals.Visible)
        {
            _horseVisuals.Rotation = new Vector3(-horsePitchDelta, 0, 0);
        }

        // Multi-joint rider kinematics
        Rider.UpdateKinematics(
            GallopPhase,
            LateralVelocity,
            Speed,
            clampedDt,
            0.0f,
            horsePitchDelta
        );

        UpdateReins();
    }

    private void UpdateTransform()
    {
        if (_track == null) return;

        // Sample central frame at current horse position
        var centerFrame = _track.GetBankedFrameAt(Distance, Config.GeometricBankSpeed);
        float groundH = TrackMath.GetGroundHeightAtOffset(LateralOffset);

        // 4-point suspension samples
        float distFront = Distance + WheelbaseHalf;
        float distRear = Distance - WheelbaseHalf;
        float uLeft = LateralOffset - TrackWidthHalf;
        float uRight = LateralOffset + TrackWidthHalf;

        Vector3 pFL = _track.GetPositionAt(distFront, uLeft);
        Vector3 pFR = _track.GetPositionAt(distFront, uRight);
        Vector3 pRL = _track.GetPositionAt(distRear, uLeft);
        Vector3 pRR = _track.GetPositionAt(distRear, uRight);

        // Ground plane forward vector from 4-point suspension
        Vector3 fwdVec = ((pFL + pFR) * 0.5f - (pRL + pRR) * 0.5f).Normalized();

        // Position horse on ground
        Vector3 centerGroundPos = centerFrame.Point + centerFrame.Lateral * LateralOffset + centerFrame.Up * groundH;
        GlobalPosition = centerGroundPos;

        // Banking roll: track banking + steering centrifugal roll
        float trackBank = _track.GetBankingAngleAtDistance(Distance, Speed) * 0.40f;
        float steerBank = 0.12f * (LateralVelocity / SteerMaxSpeed);
        float totalBankRoll = trackBank + steerBank;

        // Orthonormal right-handed basis with positive determinant (+1.0)
        Vector3 fwd = fwdVec.Normalized();
        Vector3 upRaw = centerFrame.Up.Normalized();
        Vector3 right = upRaw.Cross(fwd).Normalized();
        Vector3 up = fwd.Cross(right).Normalized();
        Basis groundBasis = new Basis(right, up, fwd);
        Basis rollBasis = new Basis(fwd, totalBankRoll);
        GlobalBasis = rollBasis * groundBasis;
    }

    private void UpdateReins()
    {
        if (_reinsMesh == null || Rider == null) return;

        Rider.GetHandPositions(out Vector3 handL, out Vector3 handR);
        Vector3 bitL = _headBitLeft.GlobalPosition;
        Vector3 bitR = _headBitRight.GlobalPosition;

        _reinsMesh.ClearSurfaces();
        _reinsMesh.SurfaceBegin(Mesh.PrimitiveType.Lines);

        // Left Rein: Bit -> Hand
        _reinsMesh.SurfaceAddVertex(ToLocal(bitL));
        _reinsMesh.SurfaceAddVertex(ToLocal(handL));

        // Right Rein: Bit -> Hand
        _reinsMesh.SurfaceAddVertex(ToLocal(bitR));
        _reinsMesh.SurfaceAddVertex(ToLocal(handR));

        _reinsMesh.SurfaceEnd();
    }

    public void SetCrashed(bool crashed)
    {
        IsCrashed = crashed;
        if (crashed)
        {
            if (_animPlayer != null && _animPlayer.HasAnimation("Death"))
            {
                _animPlayer.Play("Death");
            }
            _horseVisuals.Rotation = new Vector3(0, 0, 0.5f);
            _horseVisuals.Position = new Vector3(0, -0.4f, 0);
            if (_gltfHorseModel != null)
            {
                _gltfHorseModel.Rotation = new Vector3(0, 0, 0.5f);
                _gltfHorseModel.Position = new Vector3(0, -0.4f, -0.72f * GltfScale);
            }
            if (_reinsMeshInst != null)
            {
                _reinsMeshInst.Visible = false;
            }
            Rider.SetCrashed(true);
        }
        else
        {
            Reset();
        }
    }

    public void Reset()
    {
        Distance = 0.0f;
        PrevDistance = 0.0f;
        Speed = BaseSpeed;
        LateralOffset = 0.0f;
        LateralVelocity = 0.0f;
        GallopPhase = 0.0f;
        IsCrashed = false;
        _horseVisuals.Rotation = Vector3.Zero;
        _horseVisuals.Position = Vector3.Zero;
        if (_gltfHorseModel != null)
        {
            _gltfHorseModel.Rotation = Vector3.Zero;
            _gltfHorseModel.Position = new Vector3(0, 0, -0.72f * GltfScale);
            if (_animPlayer != null && _animPlayer.HasAnimation("Gallop"))
            {
                _animPlayer.Play("Gallop");
            }
        }
        if (_reinsMeshInst != null)
        {
            _reinsMeshInst.Visible = true;
        }
        Rider.Reset();
        UpdateTransform();
        UpdateReins();
    }
}
