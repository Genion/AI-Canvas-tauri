import { describe, expect, it } from 'vitest';
import { createDefaultPrevisScene } from '../../src/services/directorPrevisSchema';
import { previsAspectRatio, samplePrevisCamera, samplePrevisObject } from '../../src/services/directorPrevisRenderer';

describe('previs camera and blocking interpolation', () => {
  it('preserves exact endpoints and holds outside the timeline', () => {
    const scene = createDefaultPrevisScene();
    expect(samplePrevisCamera(scene, -1)).toEqual(scene.camera.keyframes[0]);
    expect(samplePrevisCamera(scene, 20)).toEqual(scene.camera.keyframes.at(-1));
    for (const frame of scene.camera.keyframes) expect(samplePrevisCamera(scene, frame.time)).toEqual(frame);
  });

  it('moves actor and camera on the same timeline and interpolates lens and roll', () => {
    const scene = createDefaultPrevisScene();
    scene.camera.keyframes = [
      { time: 0, position: [0, 2, 6], target: [0, 1, 0], focalLength: 35, roll: -10 },
      { time: 8, position: [8, 4, 6], target: [8, 1, 0], focalLength: 85, roll: 10 },
    ];
    expect(samplePrevisCamera(scene, 4)).toEqual({ time: 4, position: [4, 3, 6], target: [4, 1, 0], focalLength: 60, roll: 0 });
    expect(samplePrevisObject(scene.objects[2], 4, false).position).toEqual([0, 0, 0]);
    expect(samplePrevisObject(scene.objects[0], 4, false).position).toEqual(scene.objects[0].position);
  });

  it('uses segment easing without changing endpoint poses', () => {
    const scene = createDefaultPrevisScene();
    const actor = scene.objects[2];
    expect(samplePrevisObject(actor, 2, false).position[2]).toBe(2);
    expect(samplePrevisObject(actor, 2, true).position[2]).toBe(2.75);
    expect(samplePrevisObject(actor, 8, true)).toEqual(actor.keyframes.at(-1));
  });

  it('keeps wide, portrait and cinema output ratios explicit', () => {
    const scene = createDefaultPrevisScene();
    expect(previsAspectRatio(scene)).toBeCloseTo(16 / 9);
    expect(previsAspectRatio({ ...scene, aspectRatio: '9:16' })).toBeCloseTo(9 / 16);
    expect(previsAspectRatio({ ...scene, aspectRatio: '2.39:1' })).toBe(2.39);
  });
});
