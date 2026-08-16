// Исследовательские пробы S-02, S-04, S-08. Это НЕ автотесты: проверок нет,
// скрипт печатает фактическое поведение, решение о дефекте принимает человек.
// Причина отдельного скрипта: синтетические клики встроенного браузера сессии
// в этом окружении до страницы не доходят (submit не срабатывает), поэтому
// сценарии с настоящими кликами и двумя вкладками выполняются Playwright'ом.
//
// Запуск (из корня проекта, стенд должен быть поднят):
//   node tests/probe-s02-s04-s08.mjs

import { chromium } from '@playwright/test';

const URL = 'http://localhost:8765/';

async function fill(page, { name, email }) {
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'Parol123');
  await page.fill('input[name="confirm"]', 'Parol123');
  await page.check('input[name="agree"]');
}

const read = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('registrations');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* оставляем null */ }
  return {
    rawLength: raw === null ? null : raw.length,
    records: Array.isArray(parsed) ? parsed.length : `не массив: ${typeof parsed}`,
    emails: Array.isArray(parsed) ? parsed.map((r) => (r == null ? String(r) : r.email)) : null,
    listItems: document.querySelectorAll('li').length,
    listText: [...document.querySelectorAll('li')].map((li) => li.textContent.trim().slice(0, 60)),
    noticeVisible: document.querySelector('#notice')?.offsetParent !== null,
    noticeText: document.querySelector('#notice')?.textContent.trim() || '',
    formVisible: !!document.querySelector('form') && document.querySelector('form').offsetParent !== null,
    emptyMsgShown: [...document.querySelectorAll('*')]
      .some((e) => e.children.length === 0 && e.textContent.includes('Пока никто') && e.offsetParent !== null),
    visibleErrors: [...document.querySelectorAll('.error')]
      .filter((e) => e.offsetParent !== null && e.textContent.trim())
      .map((e) => e.textContent.trim()),
  };
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// ─────────────────────────────────────────── S-02 — двойная отправка
console.log('\n=== S-02 — двойная отправка ===');
{
  const page = await context.newPage();
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // A. Настоящий двойной клик мышью
  await fill(page, { name: 'Гонка A', email: 'race-a@mail.ru' });
  await page.dblclick('button[type="submit"]');
  console.log('A. настоящий dblclick:      ', JSON.stringify(await read(page)));

  // B. Два клика в одном такте — самая жёсткая версия гонки
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fill(page, { name: 'Гонка B', email: 'race-b@mail.ru' });
  await page.evaluate(() => {
    const b = document.querySelector('button[type="submit"]');
    b.click(); b.click(); b.click();
  });
  console.log('B. три click() в одном такте:', JSON.stringify(await read(page)));

  // C. Enter в поле + немедленный клик по кнопке
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fill(page, { name: 'Гонка C', email: 'race-c@mail.ru' });
  await Promise.all([
    page.press('input[name="email"]', 'Enter'),
    page.click('button[type="submit"]'),
  ]);
  console.log('C. Enter + клик одновременно:', JSON.stringify(await read(page)));

  // D. Двойной клик при УЖЕ показанном подтверждении.
  // В варианте A второй клик промахнулся: подтверждение появилось и сдвинуло
  // кнопку вниз на свою высоту. Если же подтверждение уже на экране (регистрируем
  // второго человека подряд), вёрстка не прыгает и второй клик попадает в кнопку.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fill(page, { name: 'Первый', email: 'race-d1@mail.ru' });
  await page.click('button[type="submit"]');
  const btnBefore = await page.evaluate(() => document.querySelector('button[type="submit"]').getBoundingClientRect().top);
  await fill(page, { name: 'Второй', email: 'race-d2@mail.ru' });
  const btnAfterFill = await page.evaluate(() => document.querySelector('button[type="submit"]').getBoundingClientRect().top);
  await page.dblclick('button[type="submit"]');
  console.log(`D. dblclick вторым подряд:   ${JSON.stringify(await read(page))}`);
  console.log(`   позиция кнопки: до ${Math.round(btnBefore)} px, после заполнения ${Math.round(btnAfterFill)} px`);

  await page.close();
}

// ─────────────────────────────────────────── S-04 — повреждённое хранилище
console.log('\n=== S-04 — повреждённое содержимое localStorage ===');
{
  const broken = {
    'строка не-JSON': 'это не json',
    'объект вместо массива': '{"a":1}',
    'массив без поля email': '[{"name":"Без почты"}]',
    'массив с null внутри': '[null]',
    'обрезанный JSON': '[{"name":"Обрыв","email":"x@y.ru"',
  };
  for (const [label, value] of Object.entries(broken)) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

    await page.goto(URL);
    await page.evaluate((v) => localStorage.setItem('registrations', v), value);
    await page.reload();
    await page.waitForTimeout(200);

    const state = await read(page);
    console.log(`${label.padEnd(24)} → форма видна: ${state.formVisible}, записей в списке: ${state.listItems}, сообщение о пустом списке: ${state.emptyMsgShown}`);
    console.log(`${' '.repeat(26)}ошибки в консоли: ${consoleErrors.length ? consoleErrors.join(' | ') : 'нет'}`);
    await page.close();
  }
}

// ─────────────────────────────────────────── S-08 — две вкладки
console.log('\n=== S-08 — две вкладки на одном localStorage ===');
{
  const tab1 = await context.newPage();
  await tab1.goto(URL);
  await tab1.evaluate(() => localStorage.clear());
  await tab1.reload();

  // Вторая вкладка открывается ДО регистрации — держит снимок пустого массива.
  const tab2 = await context.newPage();
  await tab2.goto(URL);

  await fill(tab1, { name: 'Вкладка 1', email: 'tabs@mail.ru' });
  await tab1.click('button[type="submit"]');
  console.log('после регистрации во вкладке 1:', JSON.stringify(await read(tab1)));

  await fill(tab2, { name: 'Вкладка 2', email: 'tabs@mail.ru' });
  await tab2.click('button[type="submit"]');
  const afterTab2 = await read(tab2);
  console.log('тот же email во вкладке 2:     ', JSON.stringify(afterTab2));
  console.log('  дубликат пойман:', afterTab2.visibleErrors.length > 0 ? 'да — ' + afterTab2.visibleErrors.join(', ') : 'НЕТ');

  // Запись другого пользователя из «устаревшей» вкладки 2
  await fill(tab2, { name: 'Вкладка 2 другой', email: 'tabs-other@mail.ru' });
  await tab2.click('button[type="submit"]');
  const final = await read(tab2);
  console.log('другой email из вкладки 2:     ', JSON.stringify(final));
  console.log('  запись вкладки 1 уцелела:', final.emails && final.emails.includes('tabs@mail.ru') ? 'да' : 'НЕТ — затёрта');

  await tab1.close();
  await tab2.close();
}

await context.close();
await browser.close();
