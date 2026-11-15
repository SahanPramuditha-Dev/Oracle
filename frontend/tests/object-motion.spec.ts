import { test,expect } from '@playwright/test';
import { predictObjectMotion } from '../src/utils/objectMotion';
const before={detection:{class:'pen',trackId:1,confidence:.8,box:[10,20,40,20] as [number,number,number,number]},at:1000};
const current={detection:{...before.detection,box:[30,20,40,20] as [number,number,number,number]},at:1200};

test('bridges recent movement but stops extrapolating after 120ms',()=>{
  expect(predictObjectMotion(current,before,1260,640,480).box[0]).toBe(36);
  expect(predictObjectMotion(current,before,1500,640,480).box[0]).toBe(42);
});
test('does not transfer movement across identity changes, gaps or large jumps',()=>{
  expect(predictObjectMotion(current,undefined,1300,640,480)).toBe(current.detection);
  expect(predictObjectMotion(current,{...before,at:-1000},1300,640,480)).toBe(current.detection);
  expect(predictObjectMotion(current,{...before,detection:{...before.detection,trackId:2}},1300,640,480)).toBe(current.detection);
  expect(predictObjectMotion(current,{...before,detection:{...before.detection,box:[400,20,40,20]}},1300,640,480)).toBe(current.detection);
});
