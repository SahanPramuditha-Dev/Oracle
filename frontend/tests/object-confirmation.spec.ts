import { test,expect } from '@playwright/test';
import { ObjectConfirmation } from '../src/utils/objectTracking';
const pen={class:'pen',confidence:.7,box:[20,30,90,10] as [number,number,number,number]};
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
