import { test, expect } from '@playwright/test';
import { FaceIdentityGate } from '../src/utils/faceIdentityGate';

const face = {id:'owner', matched:true, permission:'administrator', cosine_score:0.7, recognition_state:'recognized'};
const observation = (f = face) => ({faces_detected:1, identified:[f]});

test('requires repeated identity and immediately clears a replaced or missing face', () => {
  const gate = new FaceIdentityGate();
  expect(gate.observe(observation())).toBe(false);
  expect(gate.observe(observation())).toBe(false);
  expect(gate.observe(observation())).toBe(true);
  expect(gate.observe(observation({...face, matched:false}))).toBe(false);
  expect(gate.observe(observation())).toBe(false);
  expect(gate.observe({faces_detected:0, identified:[]})).toBe(false);
  expect(gate.observe(observation())).toBe(false);
  expect(gate.observe(observation({...face,id:'other'}))).toBe(false);
});

test('rejects multiple faces, missing scores and weak matches', () => {
  const gate = new FaceIdentityGate();
  for (let i=0;i<4;i++) {
    expect(gate.observe({faces_detected:2, identified:[face,face]})).toBe(false);
    expect(gate.observe(observation({...face,cosine_score:0.4}))).toBe(false);
    expect(gate.observe(observation({...face,cosine_score:NaN}))).toBe(false);
  }
});
