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
    private MultiMeshInstance3D _trunkInstance = null!;
    private MultiMeshInstance3D _folBottomInstance = null!;
    private MultiMeshInstance3D _folTopInstance = null!;
    private MultiMeshInstance3D _bushInstance = null!;

    private static Material? s_trackMaterial;
    private static StandardMaterial3D? s_trunkMaterial;
    private static StandardMaterial3D? s_folBottomMaterial;
    private static StandardMaterial3D? s_folTopMaterial;
    private static StandardMaterial3D? s_bushMaterial;

    private static CylinderMesh? s_trunkMesh;
    private static CylinderMesh? s_folBottomMesh;
    private static CylinderMesh? s_folTopMesh;
    private static SphereMesh? s_bushMesh;

    public override void _Ready()
    {
        EnsureSharedResources();
        BuildNodeHierarchy();
    }

    private static void EnsureSharedResources()
    {
        if (s_trackMaterial != null) return;

        var shader = GD.Load<Shader>("res://Shaders/track_meadow.gdshader");
        var mat = new ShaderMaterial { Shader = shader };
        s_trackMaterial = mat;

        s_trunkMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.29f, 0.18f, 0.09f),
            Roughness = 0.9f,
            Metallic = 0.05f
        };

        s_folBottomMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.13f, 0.41f, 0.16f), // Lush evergreen / oak
            Roughness = 0.8f,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.PerPixel
        };

        s_folTopMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.22f, 0.51f, 0.21f), // Sunlit meadow green
            Roughness = 0.8f
        };

        s_bushMaterial = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.18f, 0.46f, 0.20f),
            Roughness = 0.85f
        };

        // Scenery meshes
        s_trunkMesh = new CylinderMesh
        {
            TopRadius = 0.22f,
            BottomRadius = 0.42f,
            Height = 2.6f,
            RadialSegments = 6,
            Material = s_trunkMaterial
        };

        s_folBottomMesh = new CylinderMesh
        {
            TopRadius = 0.0f,
            BottomRadius = 1.7f,
            Height = 2.4f,
            RadialSegments = 6,
            Material = s_folBottomMaterial
        };

        s_folTopMesh = new CylinderMesh
        {
            TopRadius = 0.0f,
            BottomRadius = 1.25f,
            Height = 1.9f,
            RadialSegments = 6,
            Material = s_folTopMaterial
        };

        s_bushMesh = new SphereMesh
        {
            Radius = 0.9f,
            Height = 1.8f,
            RadialSegments = 6,
            Rings = 4,
            Material = s_bushMaterial
        };
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

        _trunkInstance = CreateMultiMeshInstance(s_trunkMesh!);
        _folBottomInstance = CreateMultiMeshInstance(s_folBottomMesh!);
        _folTopInstance = CreateMultiMeshInstance(s_folTopMesh!);
        _bushInstance = CreateMultiMeshInstance(s_bushMesh!);

        AddChild(_trunkInstance);
        AddChild(_folBottomInstance);
        AddChild(_folTopInstance);
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
        Transform3D zeroTransform = new(Basis.FromScale(Vector3.Zero), Vector3.Zero);

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

            var frame = spline.GetBankedFrameAt(s, Config.GeometricBankSpeed);
            Vector3 treePos = frame.Point + frame.Lateral * uOffset + frame.Up * groundH;

            // Align base orientation with terrain surface Up + random yaw
            Basis yawBasis = new Basis(frame.Up, randYaw);
            Basis alignBasis = new Basis(frame.Lateral, frame.Up, frame.Tangent) * yawBasis;

            bool isBush = (i + ChunkIndex) % 3 == 0;

            if (isBush)
            {
                _trunkInstance.Multimesh.SetInstanceTransform(i, zeroTransform);
                _folBottomInstance.Multimesh.SetInstanceTransform(i, zeroTransform);
                _folTopInstance.Multimesh.SetInstanceTransform(i, zeroTransform);

                float bScale = 0.95f + rand2 * 0.45f;
                Vector3 bushPos = treePos + frame.Up * 0.32f;
                Basis bushBasis = alignBasis.Scaled(new Vector3(bScale * 1.2f, bScale * 0.85f, bScale * 1.2f));
                _bushInstance.Multimesh.SetInstanceTransform(i, new Transform3D(bushBasis, bushPos));
            }
            else
            {
                _bushInstance.Multimesh.SetInstanceTransform(i, zeroTransform);

                float tScale = 0.85f + rand1 * 0.45f;
                Basis treeBasis = alignBasis.Scaled(new Vector3(tScale, tScale, tScale));

                // Trunk
                Vector3 trunkPos = treePos + frame.Up * (1.0f * tScale);
                _trunkInstance.Multimesh.SetInstanceTransform(i, new Transform3D(treeBasis, trunkPos));

                // Foliage lower tier
                Vector3 folBottomPos = treePos + frame.Up * (2.6f * tScale);
                _folBottomInstance.Multimesh.SetInstanceTransform(i, new Transform3D(treeBasis, folBottomPos));

                // Foliage top tier
                Vector3 folTopPos = treePos + frame.Up * (4.2f * tScale);
                _folTopInstance.Multimesh.SetInstanceTransform(i, new Transform3D(treeBasis, folTopPos));
            }
        }
    }
}
