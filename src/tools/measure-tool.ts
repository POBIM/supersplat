import { Container, NumericInput } from '@playcanvas/pcui';
import { Entity, Mat4, Quat, TranslateGizmo, Vec3 } from 'playcanvas';

import { EntityTransformOp } from '../edit-ops';
import { Events } from '../events';
import { Scene } from '../scene';
import { Splat } from '../splat';
import { Transform } from '../transform';

const mat = new Mat4();
const mat1 = new Mat4();
const mat2 = new Mat4();
const mat3 = new Mat4();
const p = new Vec3();
const p0 = new Vec3();
const p1 = new Vec3();
const midWorld = new Vec3();
const midScreen = new Vec3();
const r = new Quat();
const s = new Vec3();

const t = new Transform();

class MeasureTransformHandler {
    activate() {}
    deactivate() {}
}

class MeasureTool {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, scene: Scene, parent: HTMLElement, canvasContainer: Container) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden');
        svg.id = 'measure-tool-svg';
        parent.appendChild(svg);

        const htmlLengthLabel = document.createElement('div');
        htmlLengthLabel.classList.add('measure-length-label', 'hidden');
        parent.appendChild(htmlLengthLabel);

        const pointLabels = [document.createElement('div'), document.createElement('div')];
        pointLabels.forEach((label, index) => {
            label.classList.add('measure-point-label', 'hidden');
            label.textContent = index === 0 ? 'P1' : 'P2';
            parent.appendChild(label);
        });

        const ns = svg.namespaceURI;

        const measureVisuals: {
            group: SVGGElement,
            lineBottom: SVGLineElement,
            lineTop: SVGLineElement,
            start: SVGCircleElement,
            end: SVGCircleElement
        }[] = [];

        const createVisual = () => {
            const group = document.createElementNS(ns, 'g') as SVGGElement;
            group.classList.add('measure-group');

            const lineBottom = document.createElementNS(ns, 'line') as SVGLineElement;
            lineBottom.classList.add('measure-line-bottom');
            lineBottom.setAttribute('stroke-linecap', 'round');

            const lineTop = document.createElementNS(ns, 'line') as SVGLineElement;
            lineTop.classList.add('measure-line-top');
            lineTop.setAttribute('stroke-linecap', 'round');

            const start = document.createElementNS(ns, 'circle') as SVGCircleElement;
            start.classList.add('measure-line-start');
            start.setAttribute('r', '5');

            const end = document.createElementNS(ns, 'circle') as SVGCircleElement;
            end.classList.add('measure-line-end');
            end.setAttribute('r', '5');

            group.appendChild(lineBottom);
            group.appendChild(lineTop);
            group.appendChild(start);
            group.appendChild(end);

            svg.appendChild(group);

            measureVisuals.push({
                group,
                lineBottom,
                lineTop,
                start,
                end
            });
        };

        const ensureVisualCount = (count: number) => {
            while (measureVisuals.length < count) {
                createVisual();
            }
        };

        const hideVisualsFrom = (startIndex: number) => {
            for (let i = startIndex; i < measureVisuals.length; i++) {
                const visual = measureVisuals[i];
                visual.group.setAttribute('visibility', 'hidden');
            }
        };

        const lengthInput = new NumericInput({
            width: 120,
            placeholder: 'Length',
            precision: 2,
            min: 0.0001,
            value: 0
        });
        let suppressUI = 0;

        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });

        selectToolbar.append(lengthInput);
        canvasContainer.append(selectToolbar);

        const gizmo = new TranslateGizmo(scene.camera.entity.camera, scene.gizmoLayer);
        const entity = new Entity('measureGizmoPivot');
        const transformHandler = new MeasureTransformHandler();

        let active = false;
        let splat: Splat;
        let chainStartIndex: number | null = null;

        const getPoint = (index: number, result: Vec3) => {
            if (!splat || !splat.measurePoints || index < 0 || index >= splat.measurePoints.length) {
                return false;
            }
            splat.worldTransform.transformPoint(splat.measurePoints[index], result);
            return true;
        };

        const getPoint2d = (index: number, result: Vec3) => {
            if (!getPoint(index, result)) {
                return false;
            }
            scene.camera.worldToScreen(result, result);
            result.x *= canvasContainer.dom.clientWidth;
            result.y *= canvasContainer.dom.clientHeight;
            return true;
        };

        const getPairCount = () => {
            if (!splat) {
                return 0;
            }
            return Math.floor(splat.measurePoints.length / 2);
        };

        const getLastPair = () => {
            const pairCount = getPairCount();
            if (!splat || pairCount === 0) {
                return null;
            }
            const start = (pairCount - 1) * 2;
            return { a: start, b: start + 1 };
        };

        const cancelChain = () => {
            if (!splat) {
                return;
            }

            if (splat.measurePoints.length % 2 === 1 && chainStartIndex === splat.measurePoints.length - 1) {
                splat.measurePoints.pop();
            }

            chainStartIndex = null;
            splat.measureSelection = -1;
            updateVisuals();
        };

        const updateVisuals = () => {
            gizmo.detach();

            if (!splat) {
                lengthInput.enabled = false;
                return;
            }

            if (splat && active && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                if (getPoint(splat.measureSelection, p)) {
                    t.set(p, Quat.IDENTITY, Vec3.ONE);
                    events.invoke('pivot').place(t);
                    entity.setLocalPosition(p);
                    gizmo.attach(entity);
                }
            }

            const activePair = getLastPair();
            if (splat && activePair && getPoint(activePair.a, p0) && getPoint(activePair.b, p1)) {
                const len = p0.distance(p1);

                suppressUI++;
                lengthInput.value = len;
                lengthInput.enabled = true;
                suppressUI--;
            } else {
                lengthInput.enabled = false;
            }
        };

        gizmo.on('render:update', () => {
            scene.forceRender = true;
        });

        gizmo.on('transform:start', () => {
            events.invoke('pivot').start();
        });

        gizmo.on('transform:move', () => {
            events.invoke('pivot').moveTRS(entity.getLocalPosition(), entity.getLocalRotation(), entity.getLocalScale());
        });

        gizmo.on('transform:end', () => {
            events.invoke('pivot').end();
        });

        events.on('selection.changed', (selection: Splat) => {
            splat = selection;
            chainStartIndex = null;
            if (active) {
                events.fire('tool.deactivate');
            }
        });

        events.on('pivot.moved', () => {
            if (active && splat && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                const p = events.invoke('pivot').transform.position;
                mat.invert(splat.worldTransform);
                mat.transformPoint(p, splat.measurePoints[splat.measureSelection]);
            }
            scene.forceRender = true;
        });

        events.on('pivot.ended', () => {
            if (active && splat && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                updateVisuals();
            }
        });

        const origTransform = new Mat4();
        const origP = new Vec3();
        const origR = new Quat();
        const origS = new Vec3();
        const mid = new Vec3();
        let startLen = 0;

        const startScale = () => {
            const activePair = getLastPair();
            if (!splat || !activePair) {
                return;
            }

            origTransform.copy(splat.worldTransform);
            origP.copy(splat.entity.getLocalPosition());
            origR.copy(splat.entity.getLocalRotation());
            origS.copy(splat.entity.getLocalScale());

            getPoint(activePair.a, p0);
            getPoint(activePair.b, p1);
            mid.sub2(p1, p0);
            startLen = mid.length();
            mid.mulScalar(0.5).add(p0);
        };

        const applyLength = (newLength: number) => {
            const activePair = getLastPair();
            if (!splat || !activePair || newLength <= 0) {
                return;
            }

            const scale = newLength / startLen;

            p.copy(mid);

            mat1.setTranslate(-p.x, -p.y, -p.z);
            mat2.setScale(scale, scale, scale);
            mat3.setTranslate(p.x, p.y, p.z);

            mat.mul2(mat1, origTransform);
            mat.mul2(mat2, mat);
            mat.mul2(mat3, mat);

            mat.getTranslation(p);
            r.setFromMat4(mat);
            mat.getScale(s);

            splat.entity.setLocalPosition(p);
            splat.entity.setLocalRotation(r);
            splat.entity.setLocalScale(s);

            scene.forceRender = true;
        };

        const endScale = () => {
            const top = new EntityTransformOp({
                splat: splat,
                oldt: new Transform(origP, origR, origS),
                newt: new Transform(splat.entity.getLocalPosition(), splat.entity.getLocalRotation(), splat.entity.getLocalScale())
            });

            events.fire('edit.add', top);
            updateVisuals();
        };

        let dragging = false;

        lengthInput.on('slider:mousedown', () => {
            if (getLastPair()) {
                startScale();
                dragging = true;
            }
        });
        lengthInput.on('change', (value) => {
            if (!getLastPair()) {
                return;
            }

            if (dragging) {
                applyLength(value);
            } else if (!suppressUI) {
                startScale();
                applyLength(value);
                endScale();
            }
        });
        lengthInput.on('slider:mouseup', () => {
            endScale();
            dragging = false;
        });

        events.on('select.delete', () => {
            if (!active || !splat || splat.measureSelection < 0 || splat.measureSelection >= splat.measurePoints.length) {
                return;
            }

            const target = splat.measurePoints[splat.measureSelection];
            for (let i = splat.measurePoints.length - 1; i >= 0; i--) {
                if (splat.measurePoints[i] === target) {
                    splat.measurePoints.splice(i, 1);
                }
            }

            splat.measureSelection = splat.measurePoints.length - 1;
            chainStartIndex = splat.measureSelection >= 0 ? splat.measureSelection : null;
            updateVisuals();
        });

        const isPrimary = (e: PointerEvent) => {
            return e.pointerType === 'mouse' ? e.button === 0 : e.isPrimary;
        };

        let clicked = false;

        const pointerdown = (e: PointerEvent) => {
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                cancelChain();
                clicked = false;
                return;
            }

            if (!clicked && isPrimary(e)) {
                clicked = true;
            }
        };

        const pointermove = (e: PointerEvent) => {
            clicked = false;
        };

        const appendSegment = (startPoint: Vec3, endPoint: Vec3) => {
            if (!splat || !startPoint || !endPoint) {
                return;
            }

            const hasDanglingStart = splat.measurePoints.length % 2 === 1 && splat.measurePoints[splat.measurePoints.length - 1] === startPoint;
            if (hasDanglingStart) {
                splat.measurePoints.push(endPoint);
            } else {
                splat.measurePoints.push(startPoint);
                splat.measurePoints.push(endPoint);
            }
            splat.measureSelection = splat.measurePoints.length - 1;
            chainStartIndex = splat.measureSelection;
        };

        const pointerup = (e: PointerEvent) => {
            if (splat && clicked && isPrimary(e)) {
                clicked = false;

                let closestIdx = -1;

                for (let i = 0; i < splat.measurePoints.length; i++) {
                    if (!getPoint2d(i, p)) {
                        continue;
                    }

                    if (Math.abs(p.x - e.offsetX) < 8 && Math.abs(p.y - e.offsetY) < 8) {
                        closestIdx = i;
                        break;
                    }
                }

                if (closestIdx >= 0) {
                    splat.measureSelection = closestIdx;
                    chainStartIndex = closestIdx;
                    updateVisuals();
                    return;
                }

                const result = scene.camera.intersect(e.offsetX, e.offsetY);
                if (result) {
                    mat.invert(splat.worldTransform);
                    mat.transformPoint(result.position, p);
                    const newPoint = p.clone();

                    if (chainStartIndex !== null && chainStartIndex < splat.measurePoints.length) {
                        const anchor = splat.measurePoints[chainStartIndex];
                        appendSegment(anchor, newPoint);
                    } else if (splat.measurePoints.length % 2 === 1) {
                        appendSegment(splat.measurePoints[splat.measurePoints.length - 1], newPoint);
                    } else {
                        splat.measurePoints.push(newPoint);
                        splat.measureSelection = splat.measurePoints.length - 1;
                        chainStartIndex = splat.measureSelection;
                    }

                    updateVisuals();
                }

                e.preventDefault();
                e.stopPropagation();
            }
        };

        const preventContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        events.on('postrender', () => {
            if (active && splat) {
                const pairCount = getPairCount();
                ensureVisualCount(pairCount);

                for (let i = 0; i < pairCount; i++) {
                    const visual = measureVisuals[i];
                    const idxA = i * 2;
                    const idxB = idxA + 1;

                    getPoint2d(idxA, p0);
                    getPoint2d(idxB, p1);

                    const x0 = p0.x.toString();
                    const y0 = p0.y.toString();
                    const x1s = p1.x.toString();
                    const y1s = p1.y.toString();

                    visual.lineBottom.setAttribute('x1', x0);
                    visual.lineBottom.setAttribute('y1', y0);
                    visual.lineBottom.setAttribute('x2', x1s);
                    visual.lineBottom.setAttribute('y2', y1s);

                    visual.lineTop.setAttribute('x1', x0);
                    visual.lineTop.setAttribute('y1', y0);
                    visual.lineTop.setAttribute('x2', x1s);
                    visual.lineTop.setAttribute('y2', y1s);

                    visual.start.setAttribute('cx', x0);
                    visual.start.setAttribute('cy', y0);
                    visual.end.setAttribute('cx', x1s);
                    visual.end.setAttribute('cy', y1s);

                    visual.group.setAttribute('visibility', 'visible');
                    visual.group.classList.toggle('active', i === pairCount - 1);
                }

                hideVisualsFrom(pairCount);

                const activePair = getLastPair();

                if (activePair) {
                    getPoint2d(activePair.a, p0);
                    getPoint2d(activePair.b, p1);

                    pointLabels[0].style.left = `${p0.x}px`;
                    pointLabels[0].style.top = `${p0.y - 12}px`;
                    pointLabels[0].classList.remove('hidden');

                    pointLabels[1].style.left = `${p1.x}px`;
                    pointLabels[1].style.top = `${p1.y - 12}px`;
                    pointLabels[1].classList.remove('hidden');

                    getPoint(activePair.a, p0);
                    getPoint(activePair.b, p1);
                    const length = p0.distance(p1);

                    midWorld.lerp(p0, p1, 0.5);
                    midScreen.copy(midWorld);
                    scene.camera.worldToScreen(midScreen, midScreen);
                    midScreen.x *= canvasContainer.dom.clientWidth;
                    midScreen.y *= canvasContainer.dom.clientHeight;

                    const labelText = `${length.toFixed(3)} units`;
                    htmlLengthLabel.textContent = labelText;
                    htmlLengthLabel.style.left = `${midScreen.x}px`;
                    htmlLengthLabel.style.top = `${midScreen.y}px`;
                    htmlLengthLabel.classList.remove('hidden');
                } else {
                    pointLabels.forEach((label) => label.classList.add('hidden'));
                    htmlLengthLabel.classList.add('hidden');
                }
            } else {
                hideVisualsFrom(0);
                htmlLengthLabel.classList.add('hidden');
                pointLabels.forEach((label) => label.classList.add('hidden'));
            }
        });

        const updateGizmoSize = () => {
            const { camera, canvas } = scene;
            if (camera.ortho) {
                gizmo.size = 1125 / canvas.clientHeight;
            } else {
                gizmo.size = 1200 / Math.max(canvas.clientWidth, canvas.clientHeight);
            }
        };
        updateGizmoSize();
        events.on('camera.resize', updateGizmoSize);
        events.on('camera.ortho', updateGizmoSize);

        this.activate = () => {
            active = true;
            chainStartIndex = splat ? splat.measureSelection : null;
            updateVisuals();
            canvasContainer.dom.addEventListener('pointerdown', pointerdown);
            canvasContainer.dom.addEventListener('pointermove', pointermove);
            canvasContainer.dom.addEventListener('pointerup', pointerup, true);
            canvasContainer.dom.addEventListener('contextmenu', preventContextMenu);
            selectToolbar.hidden = false;
            parent.style.display = 'block';
            parent.classList.add('noevents');
            svg.classList.remove('hidden');

            events.fire('transformHandler.push', transformHandler);
        };

        this.deactivate = () => {
            active = false;
            chainStartIndex = null;
            updateVisuals();
            canvasContainer.dom.removeEventListener('pointerdown', pointerdown);
            canvasContainer.dom.removeEventListener('pointermove', pointermove);
            canvasContainer.dom.removeEventListener('pointerup', pointerup);
            canvasContainer.dom.removeEventListener('contextmenu', preventContextMenu);
            selectToolbar.hidden = true;
            parent.style.display = 'none';
            parent.classList.remove('noevents');
            svg.classList.add('hidden');

            events.fire('transformHandler.pop');
        };
    }
}

export { MeasureTool };
