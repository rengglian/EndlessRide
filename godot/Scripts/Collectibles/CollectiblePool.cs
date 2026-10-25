using System;
using System.Collections.Generic;
using Godot;
using EndlessRide.Track;

namespace EndlessRide.Collectibles;

/// <summary>
/// Pre-allocated object pool for collectibles (Apples and Golden Horseshoes).
/// Ported from src/collectibles/CollectiblePool.ts.
/// </summary>
public class CollectiblePool
{
    private readonly Node3D _parent;
    private readonly Dictionary<CollectibleType, Stack<CollectibleEntity>> _pools = new();
    private int _nextId;

    private readonly StandardMaterial3D _appleMat;
    private readonly StandardMaterial3D _stemMat;
    private readonly StandardMaterial3D _horseshoeMat;

    // Shared pre-allocated collectible geometries
    private readonly SphereMesh _appleMesh;
    private readonly CylinderMesh _stemMesh;
    private readonly TorusMesh _horseshoeMesh;

    public CollectiblePool(Node3D parent, int initialPoolSize = 16)
    {
        _parent = parent;

        _appleMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.93f, 0.20f, 0.20f),
            Roughness = 0.25f,
            Metallic = 0.08f,
            EmissionEnabled = true,
            Emission = new Color(0.20f, 0.02f, 0.02f)
        };

        _stemMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.36f, 0.23f, 0.13f),
            Roughness = 0.8f
        };

        _horseshoeMat = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.98f, 0.80f, 0.08f),
            Roughness = 0.20f,
            Metallic = 0.85f,
            EmissionEnabled = true,
            Emission = new Color(0.25f, 0.15f, 0.02f)
        };

        // Initialize shared collectible meshes once
        _appleMesh = new SphereMesh { Radius = 0.32f, Height = 0.60f, RadialSegments = 10, Rings = 8, Material = _appleMat };
        _stemMesh = new CylinderMesh { TopRadius = 0.025f, BottomRadius = 0.035f, Height = 0.16f, RadialSegments = 5, Material = _stemMat };
        _horseshoeMesh = new TorusMesh
        {
            InnerRadius = 0.22f,
            OuterRadius = 0.34f,
            Rings = 12,
            RingSegments = 8,
            Material = _horseshoeMat
        };

        CollectibleType[] types = { CollectibleType.Apple, CollectibleType.Horseshoe };
        foreach (var type in types)
        {
            _pools[type] = new Stack<CollectibleEntity>();
            for (int i = 0; i < initialPoolSize; i++)
            {
                var entity = CreateEntity(type);
                entity.Active = false;
                entity.Node.Visible = false;
                _parent.AddChild(entity.Node);
                _pools[type].Push(entity);
            }
        }
    }

    public CollectibleEntity Acquire(CollectibleType type)
    {
        if (_pools[type].Count > 0)
        {
            var entity = _pools[type].Pop();
            entity.Active = true;
            entity.Node.Visible = true;
            return entity;
        }

        var newEntity = CreateEntity(type);
        newEntity.Active = true;
        newEntity.Node.Visible = true;
        _parent.AddChild(newEntity.Node);
        return newEntity;
    }

    public void Release(CollectibleEntity entity)
    {
        entity.Active = false;
        entity.Node.Visible = false;
        _pools[entity.Type].Push(entity);
    }

    private CollectibleEntity CreateEntity(CollectibleType type)
    {
        int id = _nextId++;
        var outerNode = new Node3D { Name = $"Collectible_{type}_{id}" };
        var visualGroup = new Node3D { Name = "VisualGroup" };
        outerNode.AddChild(visualGroup);

        if (type == CollectibleType.Apple)
        {
            // Apple body
            var appleInst = new MeshInstance3D { Mesh = _appleMesh, Position = new Vector3(0, 0.65f, 0) };
            visualGroup.AddChild(appleInst);

            // Stem
            var stemInst = new MeshInstance3D { Mesh = _stemMesh, Position = new Vector3(0, 0.98f, 0) };
            stemInst.RotationDegrees = new Vector3(0, 0, -15.0f);
            visualGroup.AddChild(stemInst);
        }
        else // Horseshoe
        {
            var horseshoeInst = new MeshInstance3D { Mesh = _horseshoeMesh, Position = new Vector3(0, 0.65f, 0) };
            horseshoeInst.RotationDegrees = new Vector3(80.0f, 0, 0);
            visualGroup.AddChild(horseshoeInst);
        }

        return new CollectibleEntity
        {
            Id = id,
            Type = type,
            Node = outerNode,
            VisualGroup = visualGroup
        };
    }
}
