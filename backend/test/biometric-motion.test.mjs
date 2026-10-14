import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassiveFaceObservation } from '../public/assets/js/biometric-motion.js';

const open = {
  faces: 1,
  blinkLeft: 0.05,
  blinkRight: 0.04,
  box: { x: 0.5, y: 0.5, width: 0.35, height: 0.45 },
};

test('una fotografía fija no activa la comparación facial', () => {
  const observation = new PassiveFaceObservation();
  for (let now = 100; now <= 20_000; now += 100) {
    assert.equal(observation.update(open, now).ready, false);
  }
});

test('un movimiento rígido de una foto no equivale a una señal facial', () => {
  const observation = new PassiveFaceObservation();
  observation.update(open, 100);
  observation.update(open, 800);
  const moved = {
    ...open,
    blinkLeft: 0.85,
    blinkRight: 0.82,
    box: { ...open.box, x: 0.68 },
  };
  assert.equal(observation.update(moved, 900).ready, false);
  assert.equal(observation.update(open, 1_000).ready, false);
});

test('un parpadeo natural observado sin indicaciones activa la comparación', () => {
  const observation = new PassiveFaceObservation();
  observation.update(open, 100);
  observation.update(open, 800);
  observation.update({ ...open, blinkLeft: 0.85, blinkRight: 0.82 }, 900);
  assert.equal(observation.update(open, 1_000).ready, false);
  assert.equal(observation.update(open, 1_100).ready, true);
});

test('dos rostros reinician la observación', () => {
  const observation = new PassiveFaceObservation();
  observation.update(open, 100);
  observation.update(open, 800);
  assert.equal(observation.update({ faces: 2 }, 900).ready, false);
  assert.equal(observation.phase, 'settling');
});
