// Автотест на BUG-01 — длинное значение без пробелов ломает вёрстку списка.
// Тест написан так, чтобы падать на текущей сборке и позеленеть после фикса:
// проверяется не текст сообщения и не вёрстка «на глаз», а факт горизонтального
// переполнения страницы. Стенд должен быть поднят заранее:
//   npx --yes http-server ./app -p 8765 -c-1
const { test, expect } = require('@playwright/test');

const LONG_NAME = 'Я'.repeat(500);
const LONG_EMAIL = 'a'.repeat(300) + '@mail.ru';

async function register(page, name, email) {
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'Parol123');
  await page.fill('input[name="confirm"]', 'Parol123');
  await page.check('input[name="agree"]');
  await page.click('button[type="submit"]');
}

for (const width of [1280, 360]) {
  test(`BUG-01: длинные имя и email не должны ломать вёрстку (ширина ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 760 : 900 });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await register(page, LONG_NAME, LONG_EMAIL);

    // Предусловие теста: запись действительно создана, иначе проверять нечего.
    await expect(page.locator('li')).toHaveCount(1);

    const metrics = await page.evaluate(() => {
      const el = document.documentElement;
      const li = document.querySelector('li');
      const name = li.querySelector('.name');
      const meta = li.querySelector('.meta');
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        cardRight: Math.round(document.querySelector('.card').getBoundingClientRect().right),
        nameScrollWidth: name.scrollWidth,
        nameClientWidth: name.clientWidth,
        metaScrollWidth: meta.scrollWidth,
        metaClientWidth: meta.clientWidth,
      };
    });

    console.log(`ширина ${width}: ` + JSON.stringify(metrics));

    // 1. Страница не должна прокручиваться вбок (допуск 1 px на округление).
    expect(
      metrics.scrollWidth,
      `страница шире окна на ${metrics.scrollWidth - metrics.clientWidth} px`
    ).toBeLessThanOrEqual(metrics.clientWidth + 1);

    // 2. Имя и email должны переноситься внутри карточки, а не уезжать вправо.
    expect(metrics.nameScrollWidth, 'имя не переносится').toBeLessThanOrEqual(metrics.nameClientWidth + 1);
    expect(metrics.metaScrollWidth, 'email не переносится').toBeLessThanOrEqual(metrics.metaClientWidth + 1);
  });
}
