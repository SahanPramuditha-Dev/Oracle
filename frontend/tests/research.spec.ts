import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('local document evidence cites uploaded lines and admits absent evidence',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');await page.keyboard.press('c');
  await page.getByRole('button',{name:/^(Research|Research & documents)$/}).click();
  const panel=page.getByRole('region',{name:'Research tools'});
  await panel.locator('input[type=file]').setInputFiles({name:'plan.md',mimeType:'text/markdown',buffer:Buffer.from('# Plan\nLaunch date: Friday.\nBudget: zero.')});
  await panel.getByLabel('Question about this document').fill('What is the budget?');await panel.getByRole('button',{name:'Find evidence',exact:true}).click();
  await expect(panel.locator('blockquote')).toContainText('Budget: zero.');await expect(panel.locator('cite')).toContainText('line 3');
  await panel.getByLabel('Question about this document').fill('Who discovered Neptune?');await panel.getByRole('button',{name:'Find evidence',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('No matching evidence');await expect(panel.locator('blockquote')).toHaveCount(0);
});

test('PDF extraction preserves pages and local AI renders validated claim references',async({page})=>{
  const pdf=execFileSync(resolve('../backend/.venv/Scripts/python.exe'),['-c',"import sys; sys.path[:0]=['../backend','../backend/tests']; from test_research import pdf_fixture; sys.stdout.buffer.write(pdf_fixture())"]);
  await page.route('**/api/v1/research/answer',r=>r.fulfill({json:{found:true,notice:'Local AI draft. Verify interpretation.',claims:[{text:'The budget is zero dollars.',source:1,quote:'Budget zero dollars.'}],passages:[{id:1,page:2,line:1,column:1,text:'Budget zero dollars.'}]}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');await page.keyboard.press('c');
  await page.getByRole('button',{name:/^(Research|Research & documents)$/}).click();const panel=page.getByRole('region',{name:'Research tools'});
  await panel.locator('input[type=file]').setInputFiles({name:'plan.pdf',mimeType:'application/pdf',buffer:pdf});
  await expect(panel.getByRole('status')).toContainText('PDF extracted locally');
  await panel.getByLabel('Question about this document').fill('What is the budget?');await panel.getByRole('button',{name:'Find evidence',exact:true}).click();
  await expect(panel.locator('cite')).toContainText('page 2');
  await panel.getByRole('button',{name:'Answer with local AI',exact:true}).click();
  await expect(panel.locator('.record-row')).toContainText('The budget is zero dollars. [1]');
  await panel.getByRole('button',{name:'Clear document',exact:true}).click();await expect(panel.locator('cite')).toHaveCount(0);
});

test('source discovery renders citations safely and reports provider failure',async({page})=>{
  let calls=0;
  await page.route('**/api/v1/research/search',route=>++calls===1?route.fulfill({json:{notice:'Search excerpts only.',results:[{title:'Earth',url:'https://en.wikipedia.org/?curid=42',snippet:'A planet. <script>inert</script>'}]}}):route.fulfill({status:502,json:{detail:'Wikipedia search unavailable'}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');await page.keyboard.press('c');
  await page.getByRole('button',{name:/^(Research|Research & documents)$/}).click();const panel=page.getByRole('region',{name:'Research tools'});
  await panel.getByLabel('Search Wikipedia').fill('Earth');await panel.getByRole('button',{name:'Search sources',exact:true}).click();
  await expect(panel.getByRole('link',{name:'Earth',exact:true})).toHaveAttribute('href','https://en.wikipedia.org/?curid=42');
  await expect(panel.locator('script')).toHaveCount(0);
  await panel.getByRole('button',{name:'Search sources',exact:true}).click();await expect(panel.getByRole('status')).toContainText('unavailable');await expect(panel.getByRole('link')).toHaveCount(0);
});
