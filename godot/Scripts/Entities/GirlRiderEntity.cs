using System;
using Godot;

namespace EndlessRide.Entities;

/// <summary>
/// Dynamic kinematic adventurer rider entity seated on the galloping horse.
/// Controls multi-joint equestrian kinematics: vertical pelvic bounce,
/// speed-scaled forward wind tuck, and reactive lateral banking into dodges.
/// Ported from src/entities/rider/GirlRiderEntity.ts.
/// </summary>
public partial class GirlRiderEntity : Node3D
{
    private Node3D _spineRoot = null!;
    private Node3D _proceduralRoot = null!;
    private Node3D _torsoNode = null!;
    private Node3D _headNode = null!;
    private Node3D _leftHandMarker = null!;
    private Node3D _rightHandMarker = null!;

    private Node3D? _customRiderModel;
    private Skeleton3D? _riderSkeleton;

    private int _boneBody = -1;
    private int _boneHips = -1;
    private int _boneTorso = -1;
    private int _boneChest = -1;
    private int _boneNeck = -1;
    private int _boneHead = -1;
    private int _boneUpperLegL = -1;
    private int _boneLowerLegL = -1;
    private int _boneFootL = -1;
    private int _boneUpperLegR = -1;
    private int _boneLowerLegR = -1;
    private int _boneFootR = -1;
    private int _boneUpperArmL = -1;
    private int _boneLowerArmL = -1;
    private int _boneWristL = -1;
    private int _boneUpperArmR = -1;
    private int _boneLowerArmR = -1;
    private int _boneWristR = -1;

    private float _smoothedLateralVel;
    private float _smoothedSpeed = 18.0f;

    public override void _Ready()
    {
        BuildProceduralRider();
        TryLoadGltfAdventurer();
    }

    private void TryLoadGltfAdventurer()
    {
        const string riderPath = "res://Assets/Models/Adventurer.gltf";
        if (!ResourceLoader.Exists(riderPath)) return;

        var scene = GD.Load<PackedScene>(riderPath);
        if (scene == null) return;

        _customRiderModel = scene.Instantiate<Node3D>();
        if (_customRiderModel == null) return;

        // Stop any standing/combat animation player from overriding procedural riding posture
        var animPlayer = _customRiderModel.FindChild("AnimationPlayer", true, false) as AnimationPlayer;
        if (animPlayer != null)
        {
            animPlayer.Stop();
            animPlayer.Autoplay = "";
            animPlayer.Active = false;
        }

        const float riderScale = 0.65f;
        _customRiderModel.Scale = new Vector3(riderScale, riderScale, riderScale);
        // Hips in unscaled model space are at Y ≈ 0.966m; offset so pelvis is at (0, 0, 0) of _spineRoot
        _customRiderModel.Position = new Vector3(0, -0.966f * riderScale, -0.02f);

        // Hide procedural fallback box rider completely
        _proceduralRoot.Visible = false;
        _spineRoot.AddChild(_customRiderModel);

        _riderSkeleton = _customRiderModel.FindChild("Skeleton3D", true, false) as Skeleton3D;
        if (_riderSkeleton == null) return;

        CacheBones(_riderSkeleton);
        ApplyEquestrianSittingPose(_riderSkeleton);

        // Bind hand markers to Adventurer wrists for dynamic reins
        var attachL = new BoneAttachment3D { BoneName = "Wrist.L" };
        var attachR = new BoneAttachment3D { BoneName = "Wrist.R" };
        _riderSkeleton.AddChild(attachL);
        _riderSkeleton.AddChild(attachR);
        _leftHandMarker = attachL;
        _rightHandMarker = attachR;

        GD.Print("[GirlRiderEntity] Loaded high-fidelity Adventurer model with equestrian sitting posture.");
    }

    private void CacheBones(Skeleton3D skel)
    {
        _boneBody = skel.FindBone("Body");
        _boneHips = skel.FindBone("Hips");
        _boneTorso = skel.FindBone("Torso");
        _boneChest = skel.FindBone("Chest");
        _boneNeck = skel.FindBone("Neck");
        _boneHead = skel.FindBone("Head");

        _boneUpperLegL = skel.FindBone("UpperLeg.L");
        _boneLowerLegL = skel.FindBone("LowerLeg.L");
        _boneFootL = skel.FindBone("Foot.L");

        _boneUpperLegR = skel.FindBone("UpperLeg.R");
        _boneLowerLegR = skel.FindBone("LowerLeg.R");
        _boneFootR = skel.FindBone("Foot.R");

        _boneUpperArmL = skel.FindBone("UpperArm.L");
        _boneLowerArmL = skel.FindBone("LowerArm.L");
        _boneWristL = skel.FindBone("Wrist.L");

        _boneUpperArmR = skel.FindBone("UpperArm.R");
        _boneLowerArmR = skel.FindBone("LowerArm.R");
        _boneWristR = skel.FindBone("Wrist.R");
    }

    private static void SetBoneRelativeRotation(Skeleton3D skel, int boneIdx, Vector3 deltaEulerRad)
    {
        if (boneIdx < 0) return;
        var restRot = skel.GetBoneRest(boneIdx).Basis.GetRotationQuaternion();
        skel.SetBonePoseRotation(boneIdx, restRot * Quaternion.FromEuler(deltaEulerRad));
    }

    private void ApplyEquestrianSittingPose(Skeleton3D skel)
    {
        // 1. Spine alignment (slight forward athletic equestrian posture)
        SetBoneRelativeRotation(skel, _boneBody, Vector3.Zero);
        SetBoneRelativeRotation(skel, _boneHips, new Vector3(-0.08f, 0, 0));
        SetBoneRelativeRotation(skel, _boneTorso, new Vector3(0.18f, 0, 0));
        SetBoneRelativeRotation(skel, _boneChest, new Vector3(0.10f, 0, 0));
        SetBoneRelativeRotation(skel, _boneNeck, new Vector3(-0.08f, 0, 0));
        SetBoneRelativeRotation(skel, _boneHead, new Vector3(-0.10f, 0, 0));

        // 2. Equestrian sitting legs:
        // Thighs: swing forward (-1.1 rad / ~63 deg on local X) and splay outward across horse flanks (±0.25 rad on local Z)
        SetBoneRelativeRotation(skel, _boneUpperLegL, new Vector3(-1.10f, 0.15f, -0.25f));
        SetBoneRelativeRotation(skel, _boneUpperLegR, new Vector3(-1.10f, -0.15f, 0.25f));

        // Knees: bend backward (+1.15 rad / ~66 deg on local X) so shins hang down along horse sides
        SetBoneRelativeRotation(skel, _boneLowerLegL, new Vector3(1.15f, 0.0f, 0.0f));
        SetBoneRelativeRotation(skel, _boneLowerLegR, new Vector3(1.15f, 0.0f, 0.0f));

        // 3. Feet in stirrups (in Root coordinate space matching the ankle position)
        if (_boneFootL >= 0)
        {
            skel.SetBonePosePosition(_boneFootL, new Vector3(0.38f, 0.44f, 0.02f));
            SetBoneRelativeRotation(skel, _boneFootL, new Vector3(-0.30f, 0.10f, 0.0f));
        }
        if (_boneFootR >= 0)
        {
            skel.SetBonePosePosition(_boneFootR, new Vector3(-0.38f, 0.44f, 0.02f));
            SetBoneRelativeRotation(skel, _boneFootR, new Vector3(-0.30f, -0.10f, 0.0f));
        }

        // 4. Arms reaching forward holding reins towards the bit
        SetBoneRelativeRotation(skel, _boneUpperArmL, new Vector3(-0.80f, 0.20f, -0.40f));
        SetBoneRelativeRotation(skel, _boneLowerArmL, new Vector3(-0.70f, 0.0f, -0.30f));
        SetBoneRelativeRotation(skel, _boneWristL, new Vector3(0.0f, 0.25f, 0.0f));

        SetBoneRelativeRotation(skel, _boneUpperArmR, new Vector3(-0.80f, -0.20f, 0.40f));
        SetBoneRelativeRotation(skel, _boneLowerArmR, new Vector3(-0.70f, 0.0f, 0.30f));
        SetBoneRelativeRotation(skel, _boneWristR, new Vector3(0.0f, -0.25f, 0.0f));
    }

    private void BuildProceduralRider()
    {
        _spineRoot = new Node3D { Name = "SpineRoot" };
        AddChild(_spineRoot);

        _proceduralRoot = new Node3D { Name = "ProceduralRoot" };
        _spineRoot.AddChild(_proceduralRoot);

        _torsoNode = new Node3D { Name = "TorsoNode" };
        _proceduralRoot.AddChild(_torsoNode);

        // Materials
        var jacketMat = new StandardMaterial3D { AlbedoColor = new Color(0.15f, 0.39f, 0.92f), Roughness = 0.7f };
        var skinMat = new StandardMaterial3D { AlbedoColor = new Color(0.99f, 0.88f, 0.85f), Roughness = 0.6f };
        var pantsMat = new StandardMaterial3D { AlbedoColor = new Color(0.95f, 0.96f, 0.98f), Roughness = 0.8f };
        var hairMat = new StandardMaterial3D { AlbedoColor = new Color(0.98f, 0.80f, 0.08f), Roughness = 0.5f };
        var bootMat = new StandardMaterial3D { AlbedoColor = new Color(0.10f, 0.10f, 0.11f), Roughness = 0.4f };

        // Torso Mesh
        var torsoMesh = new BoxMesh { Size = new Vector3(0.42f, 0.52f, 0.26f), Material = jacketMat };
        var torsoInst = new MeshInstance3D { Mesh = torsoMesh, Position = new Vector3(0, 0.35f, 0) };
        _torsoNode.AddChild(torsoInst);

        // Head Node
        _headNode = new Node3D { Name = "HeadNode", Position = new Vector3(0, 0.72f, 0) };
        var headMesh = new SphereMesh { Radius = 0.16f, Height = 0.32f, Material = skinMat };
        var headInst = new MeshInstance3D { Mesh = headMesh };
        _headNode.AddChild(headInst);

        // Hair Ponytail
        var hairMesh = new SphereMesh { Radius = 0.18f, Height = 0.35f, Material = hairMat };
        var hairInst = new MeshInstance3D { Mesh = hairMesh, Position = new Vector3(0, 0.04f, -0.08f) };
        _headNode.AddChild(hairInst);
        _torsoNode.AddChild(_headNode);

        // Legs (seated equestrian posture)
        var legMesh = new BoxMesh { Size = new Vector3(0.14f, 0.45f, 0.16f), Material = pantsMat };
        var bootMesh = new BoxMesh { Size = new Vector3(0.15f, 0.22f, 0.25f), Material = bootMat };

        // Left Leg
        var leftLeg = new Node3D { Position = new Vector3(-0.24f, 0.18f, 0.08f) };
        leftLeg.RotationDegrees = new Vector3(-35.0f, 15.0f, -12.0f);
        var leftLegInst = new MeshInstance3D { Mesh = legMesh, Position = new Vector3(0, -0.15f, 0) };
        var leftBootInst = new MeshInstance3D { Mesh = bootMesh, Position = new Vector3(0, -0.38f, 0.06f) };
        leftLeg.AddChild(leftLegInst);
        leftLeg.AddChild(leftBootInst);
        _proceduralRoot.AddChild(leftLeg);

        // Right Leg
        var rightLeg = new Node3D { Position = new Vector3(0.24f, 0.18f, 0.08f) };
        rightLeg.RotationDegrees = new Vector3(-35.0f, -15.0f, 12.0f);
        var rightLegInst = new MeshInstance3D { Mesh = legMesh, Position = new Vector3(0, -0.15f, 0) };
        var rightBootInst = new MeshInstance3D { Mesh = bootMesh, Position = new Vector3(0, -0.38f, 0.06f) };
        rightLeg.AddChild(rightLegInst);
        rightLeg.AddChild(rightBootInst);
        _proceduralRoot.AddChild(rightLeg);

        // Arms holding reins
        var armMesh = new BoxMesh { Size = new Vector3(0.12f, 0.38f, 0.12f), Material = jacketMat };
        var handMesh = new SphereMesh { Radius = 0.07f, Height = 0.14f, Material = skinMat };

        // Left Arm
        var leftArm = new Node3D { Position = new Vector3(-0.25f, 0.52f, 0.05f) };
        leftArm.RotationDegrees = new Vector3(45.0f, 18.0f, -10.0f);
        var leftArmInst = new MeshInstance3D { Mesh = armMesh, Position = new Vector3(0, -0.16f, 0.08f) };
        _leftHandMarker = new Node3D { Name = "LeftHandMarker", Position = new Vector3(0, -0.36f, 0.22f) };
        var leftHandInst = new MeshInstance3D { Mesh = handMesh };
        _leftHandMarker.AddChild(leftHandInst);
        leftArm.AddChild(leftArmInst);
        leftArm.AddChild(_leftHandMarker);
        _torsoNode.AddChild(leftArm);

        // Right Arm
        var rightArm = new Node3D { Position = new Vector3(0.25f, 0.52f, 0.05f) };
        rightArm.RotationDegrees = new Vector3(45.0f, -18.0f, 10.0f);
        var rightArmInst = new MeshInstance3D { Mesh = armMesh, Position = new Vector3(0, -0.16f, 0.08f) };
        _rightHandMarker = new Node3D { Name = "RightHandMarker", Position = new Vector3(0, -0.36f, 0.22f) };
        var rightHandInst = new MeshInstance3D { Mesh = handMesh };
        _rightHandMarker.AddChild(rightHandInst);
        rightArm.AddChild(rightArmInst);
        rightArm.AddChild(_rightHandMarker);
        _torsoNode.AddChild(rightArm);
    }

    /// <summary>
    /// Update dynamic rider kinematics: vertical bounce, forward tuck, lateral dodge roll.
    /// </summary>
    public void UpdateKinematics(
        float gallopPhase,
        float lateralVelocity,
        float forwardSpeed,
        float dt,
        float saddleElevationOffset,
        float saddlePitchDelta)
    {
        // Smooth input variables
        _smoothedLateralVel += (lateralVelocity - _smoothedLateralVel) * (1.0f - MathF.Exp(-12.0f * dt));
        _smoothedSpeed += (forwardSpeed - _smoothedSpeed) * (1.0f - MathF.Exp(-8.0f * dt));

        // 1. Pelvic vertical oscillation synchronized with horse gallop stride
        float verticalBob = MathF.Sin(gallopPhase * 2.0f) * 0.045f;
        _spineRoot.Position = new Vector3(0, verticalBob + saddleElevationOffset, 0);

        // 2. Dynamic forward speed tuck (lean forward into the wind as speed increases)
        float speedNorm = Math.Clamp((_smoothedSpeed - 14.0f) / 16.0f, 0.0f, 1.0f);
        float tuckPitch = speedNorm * 0.28f + saddlePitchDelta * 0.45f;

        // 3. Reactive lateral dodge roll (lean body into sharp steering maneuvers)
        float dodgeRoll = -(_smoothedLateralVel / 12.0f) * 0.18f;

        _torsoNode.Rotation = new Vector3(-tuckPitch, 0, dodgeRoll);
        if (_customRiderModel != null)
        {
            _customRiderModel.Rotation = new Vector3(-tuckPitch * 0.45f, 0, dodgeRoll * 0.85f);
        }

        if (_riderSkeleton != null)
        {
            float hipCounterPitch = -saddlePitchDelta * 0.5f + MathF.Sin(gallopPhase) * 0.035f;
            SetBoneRelativeRotation(_riderSkeleton, _boneHips, new Vector3(hipCounterPitch, 0, 0));
            SetBoneRelativeRotation(_riderSkeleton, _boneTorso, new Vector3(0.18f + tuckPitch * 0.25f, 0, 0));
        }

        // Head counter-stabilization (keeps gaze level down track)
        _headNode.Rotation = new Vector3(tuckPitch * 0.45f, 0, -dodgeRoll * 0.60f);
    }

    public void GetHandPositions(out Vector3 leftHand, out Vector3 rightHand)
    {
        leftHand = _leftHandMarker != null ? _leftHandMarker.GlobalPosition : GlobalPosition + new Vector3(-0.2f, 0.4f, 0.3f);
        rightHand = _rightHandMarker != null ? _rightHandMarker.GlobalPosition : GlobalPosition + new Vector3(0.2f, 0.4f, 0.3f);
    }

    public void SetCrashed(bool crashed)
    {
        if (crashed)
        {
            // Tumble naturally down to track ground beside the fallen horse
            Position = new Vector3(0.55f, -1.28f, 0.25f);
            Rotation = new Vector3(0.30f, 0.10f, 1.35f);
        }
        else
        {
            Reset();
        }
    }

    public void Reset()
    {
        Position = Vector3.Zero;
        Rotation = Vector3.Zero;
        _smoothedLateralVel = 0.0f;
        _smoothedSpeed = 18.0f;
        if (_spineRoot != null) _spineRoot.Position = Vector3.Zero;
        if (_torsoNode != null) _torsoNode.Rotation = Vector3.Zero;
        if (_headNode != null) _headNode.Rotation = Vector3.Zero;
        if (_customRiderModel != null)
        {
            _customRiderModel.Rotation = Vector3.Zero;
            _customRiderModel.Position = new Vector3(0, -0.966f * 0.65f, -0.02f);
        }
        if (_riderSkeleton != null)
        {
            ApplyEquestrianSittingPose(_riderSkeleton);
        }
    }
}
