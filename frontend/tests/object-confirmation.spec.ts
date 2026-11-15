import { test,expect } from '@playwright/test';
import { ObjectConfirmation } from '../src/utils/objectTracking';
const pen={class:'pen',confidence:.7,box:[20,30,90,10] as [number,number,number,number]};
test('live objects reject weak guesses and require three recent matching frames',()=>{
  const tracker=new ObjectConfirmation(.5,3000,3);
  expect(tracker.update([{...pen,confidence:.3}],1000)).toEqual([]);
  expect(tracker.update([pen],1500)[0].confirmed).toBe(false);
  expect(tracker.update([pen],2000)[0].confirmed).toBe(false);
  expect(tracker.update([pen],2500)[0].confirmed).toBe(true);
  expect(tracker.update([{...pen,class:'chair'}],3000)[0].confirmed).toBe(false);
  expect(tracker.update([pen],3500)[0].confirmed).toBe(false);
  expect(tracker.update([pen],7000)[0].confirmed).toBe(false);
  expect(tracker.update([{...pen,box:[0,0,-10,20]}],7500)).toEqual([]);
});
test('requires repeated spatially consistent labels and resets on disagreement',()=>{
  const tracker=new ObjectConfirmation();
  expect(tracker.update([pen],1000)[0].confirmed).toBe(false);
  expect(tracker.update([{...pen,box:[21,30,90,10]}],4000)[0].confirmed).toBe(true);
  expect(tracker.update([{...pen,class:'pencil'}],7000)[0].confirmed).toBe(false);
  expect(tracker.update([{...pen,ambiguous:true}],10000)).toEqual([]);
  expect(tracker.update([pen],13000)[0].confirmed).toBe(false);
  expect(tracker.update([pen],30000)[0].confirmed).toBe(false);
  expect(tracker.update([{...pen,box:[400,30,90,10]}],33000)[0].confirmed).toBe(false);
});
