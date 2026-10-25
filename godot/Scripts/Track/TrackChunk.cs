using System;
using Godot;
using EndlessRide.Core;

namespace EndlessRide.Track;

/// <summary>
/// Represents a single procedurally generated 50m track chunk in Godot 4.
/// Manages procedural ArrayMesh terrain cross-section, ground collider,
/// and MultiMeshInstance3D roadside trees and bushes.
/// </summary>
public partial class TrackChunk : Node3D
{
    public const int SceneryCount = 6;

    public int ChunkIndex { get; private set; }
    public float StartDist { get; private set; }
    public float ChunkLength { get; private set; }

    private MeshInstance3D _meshInstance = null!;
    private StaticBody3D _staticBody = null!;
    private CollisionShape3D _collisionShape = null!;

    // MultiMesh scenery instances
    private MultiMeshInstance3D _pineInstance = null!;
    private MultiMeshInstance3D _oakInstance = null!;
    private MultiMeshInstance3D _birchInstance = null!;
    private MultiMeshInstance3D _bushInstance = null!;

    private static Material? s_trackMaterial;
    private static Mesh? s_pineMesh;
    private static Mesh? s_oakMesh;
    private static Mesh? s_birchMesh;
    private static Mesh? s_bushMesh;

    public override void _Ready()
    {
        EnsureSharedResources();
        BuildNodeHierarchy();
    }

    private static Mesh? LoadMeshFromGltf(string resPath)
    {
        if (!ResourceLoader.Exists(resPath)) return null;
        var scene = GD.Load<PackedScene>(resPath);
        if (scene == null) return null;
        var inst = scene.Instantiate<Node3D>();
        if (inst == null) return null;

        MeshInstance3D? meshInst = inst as MeshInstance3D;
        meshInst ??= inst.FindChild("*", true, false) as MeshInstance3D;
        return meshInst?.Mesh;
    }

    private static void EnsureSharedResources()
    {
        if (s_trackMaterial != null) return;

        var shader = GD.Load<Shader>("res://Shaders/track_meadow.gdshader");
        var mat = new ShaderMaterial { Shader = shader };
        s_trackMaterial = mat;

        // Load stylized high-quality low-poly models generated in Blender
        s_pineMesh = LoadMeshFromGltf("res://Assets/Models/TreePine.glb");
        s_oakMesh = LoadMeshFromGltf("res://Assets/Models/TreeOak.glb");
        s_birchMesh = LoadMeshFromGltf("res://Assets/Models/TreeBirch.glb");
        s_bushMesh = LoadMeshFromGltf("res://Assets/Models/BushMeadow.glb");

        // Fallback procedural primitives if models missing
        s_pineMesh ??= new CylinderMesh { TopRadius = 0.0f, BottomRadius = 1.6f, Height = 4.5f };
        s_oakMesh ??= new SphereMesh { Radius = 1.6f, Height = 3.2f };
        s_birchMesh ??= new CylinderMesh { TopRadius = 0.8f, BottomRadius = 0.8f, Height = 4.8f };
        s_bushMesh ??= new SphereMesh { Radius = 0.9f, Height = 1.8f };
    }

    private void BuildNodeHierarchy()
    {
        _meshInstance = new MeshInstance3D
        {
            Name = "TerrainMesh",
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off
        };
        AddChild(_meshInstance);

        _staticBody = new StaticBody3D { Name = "TrackCollider" };
        _collisionShape = new CollisionShape3D { Name = "CollisionShape" };
        _staticBody.AddChild(_collisionShape);
        AddChild(_staticBody);

        _pineInstance = CreateMultiMeshInstance(s_pineMesh!);
        _oakInstance = CreateMultiMeshInstance(s_oakMesh!);
        _birchInstance = CreateMultiMeshInstance(s_birchMesh!);
        _bushInstance = CreateMultiMeshInstance(s_bushMesh!);

        AddChild(_pineInstance);
        AddChild(_oakInstance);
        AddChild(_birchInstance);
        AddChild(_bushInstance);
    }

    private static MultiMeshInstance3D CreateMultiMeshInstance(Mesh mesh)
    {
        var multiMesh = new MultiMesh
        {
            TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
            InstanceCount = SceneryCount,
            Mesh = mesh
        };

        return new MultiMeshInstance3D
        {
            Multimesh = multiMesh,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.On
        };
    }

    /// <summary>
    /// Applies geometry data and updates roadside scenery transforms.
    /// </summary>
    public void ApplyGeometry(TrackChunkGeometryData data, SplineTrack spline)
    {
        if (_meshInstance == null)
        {
            EnsureSharedResources();
            BuildNodeHierarchy();
        }

        ChunkIndex = data.ChunkIndex;
        StartDist = data.StartDist;
        ChunkLength = data.ChunkLength;

        int vertCount = data.Positions.Length / 3;
        var vertices = new Vector3[vertCount];
        var normals = new Vector3[vertCount];
        var uvs = new Vector2[vertCount];

        for (int i = 0; i < vertCount; i++)
        {
            vertices[i] = new Vector3(data.Positions[i * 3], data.Positions[i * 3 + 1], data.Positions[i * 3 + 2]);
            normals[i] = new Vector3(data.Normals[i * 3], data.Normals[i * 3 + 1], data.Normals[i * 3 + 2]);
            uvs[i] = new Vector2(data.Uvs[i * 2], data.Uvs[i * 2 + 1]);
        }

        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = vertices;
        arrays[(int)Mesh.ArrayType.Normal] = normals;
        arrays[(int)Mesh.ArrayType.TexUV] = uvs;
        arrays[(int)Mesh.ArrayType.Index] = data.Indices;

        var arrayMesh = new ArrayMesh();
        arrayMesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);

        _meshInstance!.Mesh = arrayMesh;
        _meshInstance.MaterialOverride = s_trackMaterial;

        // Ground collider
        var concaveShape = new ConcavePolygonShape3D();
        concaveShape.SetFaces(arrayMesh.GetFaces());
        _collisionShape!.Shape = concaveShape;

        PopulateScenery(spline);
    }

    private void PopulateScenery(SplineTrack spline)
    {
        for (int i = 0; i < SceneryCount; i++)
        {
            int seed = Math.Abs(ChunkIndex * 73856093) ^ (i * 19349663);
            float rand1 = (seed & 0xffff) / 65535.0f;
            float rand2 = ((seed >> 16) & 0xffff) / 65535.0f;
            float randYaw = (((seed ^ (seed >> 8)) & 0xffff) / 65535.0f) * MathF.PI * 2.0f;

            float s = StartDist + (i + 0.15f + rand1 * 0.7f) * (ChunkLength / SceneryCount);
            float side = (i + (ChunkIndex % 2)) % 2 == 0 ? 1.0f : -1.0f;
            float uOffset = side * (7.0f + rand2 * 11.0f);
            float groundH = TrackMath.GetGroundHeightAtOffset(uOffset);

            Transform3D surfaceXform = spline.GetTransformAt(s, uOffset);
            Vector3 sceneryPos = surfaceXform.Origin;

            // Align base orientation with terrain surface Up + random yaw (right-handed basis)
            Basis yawBasis = new Basis(surfaceXform.Basis.Y, randYaw);
            Basis alignBasis = yawBasis * surfaceXform.Basis;

            // Deterministic scenery variant selection:
            // 0: Bush (~25%), 1: Pine (~25%), 2: Oak (~25%), 3: Birch (~25%)
            int variant = Math.Abs((ChunkIndex * 31) ^ (i * 17)) % 4;

            // Zero transform positioned at sceneryPos so MultiMesh AABB stays tightly bounded to chunk
            Transform3D zeroTransform = new(Basis.FromScale(Vector3.Zero), sceneryPos);
            _pineInstance.Multimesh.SetInstanceTransform(i, zeroTransform);
            _oakInstance.Multimesh.SetInstanceTransform(i, zeroTransform);
            _birchInstance.Multimesh.SetInstanceTransform(i, zeroTransform);
            _bushInstance.Multimesh.SetInstanceTransform(i, zeroTransform);

            switch (variant)
            {
                case 0: // Flowering Bush
                {
                    float bScale = 0.85f + rand2 * 0.35f;
                    Basis bushBasis = alignBasis.Scaled(new Vector3(bScale * 1.15f, bScale * 0.90f, bScale * 1.15f));
                    _bushInstance.Multimesh.SetInstanceTransform(i, new Transform3D(bushBasis, sceneryPos));
                    break;
                }
                case 1: // Tall Nordic Pine
                {
                    float pScale = 0.80f + rand1 * 0.40f;
                    Basis pineBasis = alignBasis.Scaled(new Vector3(pScale, pScale, pScale));
                    _pineInstance.Multimesh.SetInstanceTransform(i, new Transform3D(pineBasis, sceneryPos));
                    break;
                }
                case 2: // Broadleaf Oak
                {
                    float oScale = 0.75f + rand2 * 0.35f;
                    Basis oakBasis = alignBasis.Scaled(new Vector3(oScale, oScale, oScale));
                    _oakInstance.Multimesh.SetInstanceTransform(i, new Transform3D(oakBasis, sceneryPos));
                    break;
                }
                case 3: // Slender Birch
                {
                    float bScale = 0.82f + rand1 * 0.38f;
                    Basis birchBasis = alignBasis.Scaled(new Vector3(bScale, bScale, bScale));
                    _birchInstance.Multimesh.SetInstanceTransform(i, new Transform3D(birchBasis, sceneryPos));
                    break;
                }
            }
        }
    }
}
