import { newContext } from '../lib/playwright.ts';

async function main() {
  const ctx = await newContext();
  const page = await ctx.newPage();

  console.log('Loading Legislation.aspx...');
  await page.goto('https://sfgov.legistar.com/Legislation.aspx', { waitUntil: 'networkidle', timeout: 45_000 });

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, button, a[href*="Search"]')).map((el) => ({
      tag: el.tagName,
      id: el.id || null,
      name: (el as HTMLInputElement).name || null,
      type: (el as HTMLInputElement).type || null,
      value: (el as HTMLInputElement).value?.slice(0, 60) || null,
      placeholder: (el as HTMLInputElement).placeholder || null,
      visible: (el as HTMLElement).offsetParent !== null,
    }))
  );

  console.log('\n=== ALL INPUTS / SELECTS / BUTTONS ===');
  for (const el of inputs) {
    console.log(JSON.stringify(el));
  }

  await ctx.close();
}

main().catch(console.error);
