// Проверка утверждений наивного прогона на нормальном стенде.
// Наивный прогон шёл в песочнице (data:-URL, origin null, localStorage заменён
// in-memory заглушкой), поэтому его находки нужно перепроверить там, где
// хранилище настоящее: http://localhost:8765/.
// Это НЕ автотест: проверок нет, скрипт печатает факты.
//
// Запуск (из корня проекта, стенд поднят):
//   node tests/probe-naive-claims.mjs

import { chromium } from '@playwright/test';

const URL = 'http://localhost:8765/';

async function fill(page, name, email) {
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'Parol123');
  await page.fill('input[name="confirm"]', 'Parol123');
  await page.check('input[name="agree"]');
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// ── Утверждение 1: «Сбой записи в хранилище проглатывается молча» ─────────────
console.log('=== Наивный, дефект 1: сбой записи в localStorage проглатывается молча ===');
{
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Ломаем запись так же, как её ломает переполненное хранилище.
  await page.evaluate(() => {
    localStorage.setItem = function () {
      const err = new Error('Failed to set the value of "registrations": storage is full.');
      err.name = 'QuotaExceededError';
      throw err;
    };
  });

  await fill(page, 'Квота', 'quota@mail.ru');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => ({
    noticeVisible: document.querySelector('#notice')?.offsetParent !== null,
    noticeText: document.querySelector('#notice')?.textContent.trim() || '',
    visibleErrors: [...document.querySelectorAll('.error')]
      .filter((e) => e.offsetParent !== null && e.textContent.trim()).map((e) => e.textContent.trim()),
    listItems: document.querySelectorAll('li').length,
    fieldsAfter: [...document.querySelectorAll('form input')]
      .map((i) => (i.type === 'checkbox' ? `agree=${i.checked}` : `${i.name}=${JSON.stringify(i.value)}`)),
  }));

  console.log('подтверждение видно:', state.noticeVisible, '| текст:', JSON.stringify(state.noticeText));
  console.log('видимые ошибки:     ', JSON.stringify(state.visibleErrors));
  console.log('записей в списке:   ', state.listItems);
  console.log('поля после отправки:', JSON.stringify(state.fieldsAfter));
  console.log('в консоли:          ', errors.length ? errors.join(' | ') : 'чисто');
  await page.close();
}

// ── Утверждение 3: битые данные тихо затираются + рендер undefined ────────────
console.log('\n=== Наивный, дефект 3: битые данные затираются, undefined в списке ===');
{
  for (const [label, value] of Object.entries({
    'объект вместо массива': '{"старые":"данные","которые":"жалко"}',
    'массив без поля email': '[{"name":"Без почты"}]',
  })) {
    const page = await context.newPage();
    await page.goto(URL);
    await page.evaluate((v) => localStorage.setItem('registrations', v), value);
    await page.reload();

    const before = await page.evaluate(() => localStorage.getItem('registrations'));
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll('li')].map((li) => li.textContent.trim()));

    await fill(page, 'Новый', 'new@mail.ru');
    await page.click('button[type="submit"]');
    const after = await page.evaluate(() => localStorage.getItem('registrations'));

    console.log(`\n${label}:`);
    console.log('  было в хранилище:  ', before);
    console.log('  отрисовано в списке:', JSON.stringify(rendered));
    console.log('  стало после регистрации:', after);
    console.log('  прежнее значение уцелело:', after.includes(before.slice(1, 20)) ? 'да' : 'НЕТ — затёрто');
    await page.close();
  }
}

// ── Утверждение: «отправка по Enter не срабатывает» (наивный списал на песочницу)
console.log('\n=== Наивный: «неявная отправка по Enter не срабатывает» ===');
{
  const page = await context.newPage();
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fill(page, 'Ентер', 'enter@mail.ru');
  await page.press('input[name="email"]', 'Enter');
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    records: JSON.parse(localStorage.getItem('registrations') || '[]').length,
    noticeVisible: document.querySelector('#notice')?.offsetParent !== null,
  }));
  console.log('после Enter в поле email → записей:', st.records, '| подтверждение видно:', st.noticeVisible);
  await page.close();
}

await context.close();
await browser.close();
