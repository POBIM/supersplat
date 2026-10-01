import { Asset, BoundingBox, Color, ContainerResource, Entity, Mat4, Mesh, MeshInstance, PRIMITIVE_TRIANGLES, Quat, Ray, Vec3 } from 'playcanvas';

import { Element, ElementType } from './element';
import { Scene } from './scene';
import { Serializer } from './serializer';
import { Transform } from './transform';


// selected models are shown in a flat highlight colour
const highlightColor = new Color(1, 0, 0);

// a model's own copy of a material, with the values the highlight overrides
type MaterialState = { material: any, diffuse: Color, emissive: Color, opacity: number };

// CPU copies of mesh geometry for ray picking, built on first pick and shared
// by every model placement using the mesh
type MeshGeometry = { positions: Float32Array, indices: Uint32Array };
const geometryCache = new WeakMap<Mesh, MeshGeometry | null>();

const getGeometry = (mesh: Mesh) => {
    let geometry = geometryCache.get(mesh);
    if (geometry === undefined) {
        geometry = null;
        const primitive = mesh.primitive[0];
        const positions: number[] = [];
        if (primitive?.type === PRIMITIVE_TRIANGLES && mesh.getPositions(positions)) {
            const indices: number[] = [];
            const indexed = mesh.getIndices(indices) > 0;
            const base = primitive.base ?? 0;
            const count = primitive.count ?? (indexed ? indices.length : positions.length / 3);
            const tri = new Uint32Array(count);
            for (let i = 0; i < count; i++) {
                tri[i] = indexed ? indices[base + i] : base + i;
            }
            geometry = { positions: new Float32Array(positions), indices: tri };
        }
        geometryCache.set(mesh, geometry);
    }
    return geometry;
};

const invMat = new Mat4();
const localRay = new Ray();
const edge1 = new Vec3();
const edge2 = new Vec3();
const pvec = new Vec3();
const tvec = new Vec3();
const qvec = new Vec3();
const v0 = new Vec3();
const v1 = new Vec3();
const v2 = new Vec3();
const hitPoint = new Vec3();

// Möller-Trumbore: distance along the (unnormalized) ray to the closest
// triangle hit, or Infinity
const intersectTriangles = (ray: Ray, { positions, indices }: MeshGeometry) => {
    let closest = Infinity;
    for (let i = 0; i + 2 < indices.length; i += 3) {
        v0.set(positions[indices[i] * 3], positions[indices[i] * 3 + 1], positions[indices[i] * 3 + 2]);
        v1.set(positions[indices[i + 1] * 3], positions[indices[i + 1] * 3 + 1], positions[indices[i + 1] * 3 + 2]);
        v2.set(positions[indices[i + 2] * 3], positions[indices[i + 2] * 3 + 1], positions[indices[i + 2] * 3 + 2]);
        edge1.sub2(v1, v0);
        edge2.sub2(v2, v0);
        pvec.cross(ray.direction, edge2);
        const det = edge1.dot(pvec);
        if (Math.abs(det) < 1e-12) continue;
        const invDet = 1 / det;
        tvec.sub2(ray.origin, v0);
        const u = tvec.dot(pvec) * invDet;
        if (u < 0 || u > 1) continue;
        qvec.cross(tvec, edge1);
        const v = ray.direction.dot(qvec) * invDet;
        if (v < 0 || u + v > 1) continue;
        const t = edge2.dot(qvec) * invDet;
        if (t > 0 && t < closest) closest = t;
    }
    return closest;
};

// Models are lit by one directional key light plus ambient. Splats are unlit, so
// the light only exists while the scene holds at least one model.
const lightUsers = new WeakMap<Scene, { entity: Entity, ambient: Color, count: number }>();

const retainLight = (scene: Scene) => {
    let entry = lightUsers.get(scene);
    if (!entry) {
        const entity = new Entity('modelLight');
        entity.addComponent('light', {
            type: 'directional',
            color: new Color(1, 1, 1),
            intensity: 1,
            castShadows: false,
            layers: [scene.worldLayer.id]
        });
        entity.setEulerAngles(45, 35, 0);
        scene.app.root.addChild(entity);
        const ambient = scene.app.scene.ambientLight.clone();
        scene.app.scene.ambientLight = new Color(0.45, 0.45, 0.45);
        entry = { entity, ambient, count: 0 };
        lightUsers.set(scene, entry);
    }
    entry.count++;
};

const releaseLight = (scene: Scene) => {
    const entry = lightUsers.get(scene);
    if (entry && --entry.count === 0) {
        entry.entity.destroy();
        scene.app.scene.ambientLight = entry.ambient;
        lightUsers.delete(scene);
    }
};

// A glTF/GLB model shown alongside the splats as a reference, for example a
// design model to compare against a scan. The original file bytes are kept so
// the model can be written to the project file unchanged.
class Model extends Element {
    asset: Asset;
    entity: Entity;
    contents: ArrayBuffer;
    filename: string;
    _name: string;
    _visible = true;
    worldBoundStorage = new BoundingBox();
    materials: MaterialState[] = [];
    highlighted = false;

    constructor(asset: Asset, contents: ArrayBuffer, filename: string) {
        super(ElementType.model);
        this.asset = asset;
        this.contents = contents;
        this.filename = filename;
        this._name = filename.split('/').pop();

        const resource = asset.resource as ContainerResource;
        this.entity = resource.instantiateRenderEntity();
        this.entity.name = this._name;

        // give the model its own materials, so highlighting it can't touch
        // anything else using the container's materials. The original values
        // are captured here, before any highlight is applied.
        const clones = new Map<any, any>();
        this.entity.findComponents('render').forEach((render: any) => {
            render.meshInstances.forEach((mi: MeshInstance) => {
                if (!mi.material) return;
                let clone = clones.get(mi.material);
                if (!clone) {
                    clone = mi.material.clone();
                    clones.set(mi.material, clone);
                    this.materials.push({
                        material: clone,
                        diffuse: clone.diffuse?.clone(),
                        emissive: clone.emissive?.clone(),
                        opacity: clone.opacity
                    });
                }
                mi.material = clone;
            });
        });
    }

    private setHighlighted(value: boolean) {
        this.highlighted = value;
        this.materials.forEach(({ material, diffuse, emissive, opacity }) => {
            if (diffuse) material.diffuse.copy(value ? highlightColor : diffuse);
            if (emissive) material.emissive.copy(value ? highlightColor : emissive);
            if (opacity !== undefined) material.opacity = value ? 1 : opacity;
            material.update();
        });
    }

    add() {
        this.scene.contentRoot.addChild(this.entity);
        this.entity.enabled = this._visible;
        retainLight(this.scene);
        this.scene.boundDirty = true;
    }

    remove() {
        this.entity.parent?.removeChild(this.entity);
        releaseLight(this.scene);
        this.scene.boundDirty = true;
    }

    destroy() {
        super.destroy();
        this.entity.destroy();
        this.materials.forEach(({ material }) => material.destroy());
        this.materials.length = 0;
        this.asset.registry?.remove(this.asset);
        this.asset.unload();
    }

    serialize(serializer: Serializer) {
        serializer.packa(this.entity.getWorldTransform().data);
        serializer.pack(this._visible);
    }

    onPreRender() {
        // highlight the selected model. Following renderOverlays keeps the
        // highlight out of image and video renders.
        const events = this.scene.events;
        const selected = this.scene.camera.renderOverlays && this.visible && events.invoke('selection') === this;
        if (selected !== this.highlighted) {
            this.setHighlighted(selected);
        }
    }

    // world-space distance along the ray to the model's closest surface, or
    // null when the ray misses
    intersectRay(ray: Ray): { distance: number, position: Vec3 } | null {
        if (!this.visible) {
            return null;
        }
        let best: { distance: number, position: Vec3 } = null;
        this.entity.findComponents('render').forEach((render: any) => {
            render.meshInstances.forEach((mi: MeshInstance) => {
                if (!mi.visible || !mi.aabb.intersectsRay(ray)) return;
                const geometry = getGeometry(mi.mesh);
                if (!geometry) return;
                // intersect in mesh space; the direction stays unnormalized so
                // t maps straight back to a world-space point
                const world = mi.node.getWorldTransform();
                invMat.copy(world).invert();
                invMat.transformPoint(ray.origin, localRay.origin);
                invMat.transformVector(ray.direction, localRay.direction);
                const t = intersectTriangles(localRay, geometry);
                if (t === Infinity) return;
                hitPoint.copy(localRay.direction).mulScalar(t).add(localRay.origin);
                const position = world.transformPoint(hitPoint, new Vec3());
                const distance = position.distance(ray.origin);
                if (!best || distance < best.distance) {
                    best = { distance, position };
                }
            });
        });
        return best;
    }

    // the transform pivot is the model's own frame
    getPivot(result: Transform) {
        const { entity } = this;
        result.set(entity.getLocalPosition(), entity.getLocalRotation(), entity.getLocalScale());
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) {
            this.entity.setLocalPosition(position);
        }
        if (rotation) {
            this.entity.setLocalRotation(rotation);
        }
        if (scale) {
            this.entity.setLocalScale(scale);
        }
        if (this.scene) {
            this.scene.boundDirty = true;
        }
    }

    get worldBound() {
        let valid = false;
        this.entity.findComponents('render').forEach((render: any) => {
            render.meshInstances.forEach((mi: MeshInstance) => {
                if (!valid) {
                    valid = true;
                    this.worldBoundStorage.copy(mi.aabb);
                } else {
                    this.worldBoundStorage.add(mi.aabb);
                }
            });
        });
        return valid ? this.worldBoundStorage : null;
    }

    set name(value: string) {
        if (value !== this._name) {
            this._name = value;
            this.entity.name = value;
            this.scene?.events.fire('model.name', this);
        }
    }

    get name() {
        return this._name;
    }

    set visible(value: boolean) {
        if (value !== this._visible) {
            this._visible = value;
            this.entity.enabled = value;
            this.scene?.events.fire('model.visibility', this);
        }
    }

    get visible() {
        return this._visible;
    }

    docSerialize() {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];
        const pack4 = (q: Quat) => [q.x, q.y, q.z, q.w];
        return {
            name: this.name,
            position: pack3(this.entity.getLocalPosition()),
            rotation: pack4(this.entity.getLocalRotation()),
            scale: pack3(this.entity.getLocalScale()),
            visible: this.visible
        };
    }

    docDeserialize(doc: any) {
        const { name, position, rotation, scale, visible } = doc;
        this.name = name;
        this.move(new Vec3(position), new Quat(rotation), new Vec3(scale));
        this.visible = visible;
    }
}

export { Model };
