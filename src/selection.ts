import { Element, ElementType } from './element';
import { Events } from './events';
import { Model } from './model';
import { Scene } from './scene';
import { Splat } from './splat';

// the selection is a single splat layer or reference model. Splat editing
// (gaussian selection, colour, data) only applies when it is a splat.
type Selectable = Splat | Model;

const registerSelectionEvents = (events: Events, scene: Scene) => {
    let selection: Selectable = null;

    const setSelection = (element: Selectable) => {
        if (element !== selection && (!element || element.visible)) {
            const prev = selection;
            selection = element;
            events.fire('selection.changed', selection, prev);
        }
    };

    events.on('selection', (element: Selectable) => {
        setSelection(element);
    });

    events.function('selection', () => {
        return selection;
    });

    events.on('selection.next', () => {
        const elements = [
            ...scene.getElementsByType(ElementType.splat),
            ...scene.getElementsByType(ElementType.model)
        ].filter(e => (e as Selectable).visible) as Selectable[];
        if (elements.length > 1 || (elements.length === 1 && elements[0] !== selection)) {
            const idx = elements.indexOf(selection);
            setSelection(elements[(idx + 1) % elements.length]);
        }
    });

    events.on('scene.elementAdded', (element: Element) => {
        if (element.type === ElementType.splat || element.type === ElementType.model) {
            setSelection(element as Selectable);
        }
    });

    events.on('scene.elementRemoved', (element: Element) => {
        if (element === selection) {
            // the removed splat is already out of the list. the candidate must be
            // visible or setSelection ignores it and the selection is left
            // pointing at a splat that is no longer in the scene
            const splats = scene.getElementsByType(ElementType.splat) as Splat[];
            setSelection(splats.find(v => v.visible) ?? null);
        }
    });

    events.on('splat.visibility', (splat: Splat) => {
        if (splat === selection && !splat.visible) {
            setSelection(null);
        }
    });

    events.on('model.visibility', (model: Model) => {
        if (model === selection && !model.visible) {
            setSelection(null);
        }
    });

    events.on('camera.focalPointPicked', (details: { splat: Splat }) => {
        setSelection(details.splat);
    });
};

export { registerSelectionEvents, Selectable };
