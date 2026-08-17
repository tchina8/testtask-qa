// Повторный прогон чек-листа после фикса BUG-01.
// Это НЕ автотест: скрипт печатает фактический результат каждой проверки,
// вердикт «закрылось / сломалось» ставит человек, сравнивая с reports/test-run.md.
// Автотест в проекте по-прежнему один — tests/bug-01-overflow.spec.js.
//
// Запуск (из корня проекта, стенд поднят):
//   node tests/retest-checklist.mjs

import { chromium } from '@playwright/test';

const URL = 'http://localhost:8765/';
const LONG_NAME = 'Я'.repeat(500);
const LONG_EMAIL = 'a'.repeat(300) + '@mail.ru';

let page;

async function fresh(width = 1280) {
  await page.setViewportSize({ width, height: width === 360 ? 760 : 900 });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function fill(name, email, password, confirm, agree) {
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirm"]', confirm);
  const checked = await page.isChecked('input[name="agree"]');
  if (checked !== agree) await page.click('input[name="agree"]');
}

const submit = () => page.click('button[type="submit"]');

const state = () => page.evaluate(() => {
  const notice = document.querySelector('#notice');
  const raw = localStorage.getItem('registrations');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* пусто */ }
  return {
    errors: [...document.querySelectorAll('.error')]
      .filter((e) => e.offsetParent !== null && e.textContent.trim())
      .map((e) => e.textContent.trim()),
    noticeVisible: notice ? notice.offsetParent !== null : false,
    noticeText: notice ? notice.textContent.trim() : '',
    items: [...document.querySelectorAll('li')].map((li) => li.textContent.trim()),
    emptyMsgShown: [...document.querySelectorAll('*')]
      .some((e) => e.children.length === 0 && e.textContent.includes('Пока никто') && e.offsetParent !== null),
    fields: [...document.querySelectorAll('form input')]
      .map((i) => (i.type === 'checkbox' ? `agree=${i.checked}` : `${i.name}=${JSON.stringify(i.value)}`)),
    records: Array.isArray(parsed) ? parsed : null,
    raw,
    maxlengths: [...document.querySelectorAll('form input')]
      .map((i) => `${i.name}:${i.getAttribute('maxlength') ?? 'нет'}`),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
});

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${id.padEnd(42)} ${detail}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// ── TC-01 ────────────────────────────────────────────────────────────────────
await fresh();
{
  const s = await state();
  const inputs = await page.$$eval('form input', (els) => els.map((e) => e.name));
  check('TC-01 пустое состояние и состав формы',
    inputs.length === 5 && s.emptyMsgShown && s.errors.length === 0,
    `полей: ${inputs.length} (${inputs.join(',')}), сообщение о пустом списке: ${s.emptyMsgShown}, ошибок: ${s.errors.length}`);
}

// ── TC-02 ────────────────────────────────────────────────────────────────────
await fill('Иван Петров', 'ivan@mail.ru', 'Parol123', 'Parol123', true);
await submit();
{
  const s = await state();
  const cleared = s.fields.every((f) => f.endsWith('""') || f === 'agree=false');
  check('TC-02 основной сценарий',
    s.noticeVisible && s.items.length === 1 && cleared && s.errors.length === 0,
    `подтверждение: ${s.noticeVisible}, записей: ${s.items.length}, поля очищены: ${cleared}`);
}

// ── TC-03 ────────────────────────────────────────────────────────────────────
await page.reload();
{
  const s = await state();
  const one = s.records && s.records.length === 1 ? s.records[0] : null;
  check('TC-03 перезагрузка и формат хранилища',
    Array.isArray(s.records) && s.records.length === 1 && one.email === 'ivan@mail.ru',
    `массив: ${Array.isArray(s.records)}, записей: ${s.records?.length}, ключи: ${one ? Object.keys(one).join(',') : '—'}`);
}

// ── TC-04 ────────────────────────────────────────────────────────────────────
await fresh();
await submit();
{
  const s = await state();
  check('TC-04 отправка пустой формы',
    s.errors.length === 5 && s.raw === null && s.emptyMsgShown,
    `ошибок: ${s.errors.length} ${JSON.stringify(s.errors)}, записей нет: ${s.raw === null}`);
}

// ── TC-05 ────────────────────────────────────────────────────────────────────
await fill('Иван', 'ivan.mail.ru', 'Parol123', 'Parol123', true);
await submit();
{
  const s = await state();
  const kept = s.fields.some((f) => f.includes('ivan.mail.ru')) && s.fields.includes('agree=true');
  check('TC-05 email не похож на адрес',
    s.errors.length === 1 && s.raw === null && kept,
    `ошибка: ${JSON.stringify(s.errors)}, данные в полях сохранены: ${kept}`);
}

// ── TC-06 ────────────────────────────────────────────────────────────────────
await fresh();
await fill('Иван', 'boundary@mail.ru', 'Parol12', 'Parol12', true);
await submit();
const s6a = await state();
await fill('Иван', 'boundary@mail.ru', 'Parol123', 'Parol123', true);
await submit();
const s6b = await state();
check('TC-06 граница пароля 7 / 8',
  s6a.errors.length === 1 && s6a.raw === null && s6b.errors.length === 0 && s6b.items.length === 1,
  `7 символов → ${JSON.stringify(s6a.errors)}; 8 символов → записей: ${s6b.items.length}`);

// ── TC-07 ────────────────────────────────────────────────────────────────────
await fill('Иван', 'mismatch@mail.ru', 'Parol123', 'Parol124', true);
await submit();
{
  const s = await state();
  check('TC-07 пароли не совпадают',
    s.errors.length === 1 && s.items.length === 1,
    `ошибка: ${JSON.stringify(s.errors)}, записей всё ещё: ${s.items.length}`);
}

// ── TC-08 ────────────────────────────────────────────────────────────────────
await fill('Иван', 'noconsent@mail.ru', 'Parol123', 'Parol123', false);
await submit();
{
  const s = await state();
  check('TC-08 согласие не отмечено',
    s.errors.length === 1 && s.items.length === 1,
    `ошибка: ${JSON.stringify(s.errors)}, записей всё ещё: ${s.items.length}`);
}

// ── TC-09 ────────────────────────────────────────────────────────────────────
await fresh();
await fill('Первый', 'dup@mail.ru', 'Parol123', 'Parol123', true);
await submit();
await fill('Второй', 'dup@mail.ru', 'Parol123', 'Parol123', true);
await submit();
const s9a = await state();
await fill('Третий', 'Dup@mail.ru', 'Parol123', 'Parol123', true);
await submit();
const s9b = await state();
check('TC-09 дубликат email (точный и по регистру)',
  s9a.errors.length === 1 && s9a.items.length === 1 && s9b.errors.length === 1 && s9b.items.length === 1,
  `точный → ${JSON.stringify(s9a.errors)}; другой регистр → ${JSON.stringify(s9b.errors)}`);

// ── TC-10 ────────────────────────────────────────────────────────────────────
await fresh();
await page.click('input[name="email"]');
await page.keyboard.type('abc');
await page.keyboard.press('Tab');
await page.click('input[name="password"]');
await page.keyboard.type('1');
await page.keyboard.press('Tab');
{
  const before = await state();
  await submit();
  const after = await state();
  check('TC-10 ошибки только после «Отправить»',
    before.errors.length === 0 && after.errors.length === 5,
    `до нажатия: ${before.errors.length}, после: ${after.errors.length}`);
}

// ── TC-11 ────────────────────────────────────────────────────────────────────
await fresh();
await fill('  Мария  ', '  maria@mail.ru  ', 'Parol123', 'Parol123', true);
await submit();
const s11 = await state();
await fill('Мария2', 'maria@mail.ru', 'Parol123', 'Parol123', true);
await submit();
const s11b = await state();
check('TC-11 пробелы по краям (наблюдение)',
  s11.records?.[0]?.name === 'Мария' && s11.records?.[0]?.email === 'maria@mail.ru' && s11b.errors.length === 1,
  `сохранено имя ${JSON.stringify(s11.records?.[0]?.name)}, email ${JSON.stringify(s11.records?.[0]?.email)}; дубликат без пробелов → ${JSON.stringify(s11b.errors)}`);

// ── TC-12 ── главная проверка: ради неё делался фикс ─────────────────────────
for (const width of [1280, 360]) {
  await fresh(width);
  await fill(LONG_NAME, LONG_EMAIL, 'Parol123', 'Parol123', true);
  await submit();
  const s = await state();
  const wraps = await page.evaluate(() => {
    const name = document.querySelector('li .name');
    const meta = document.querySelector('li .meta');
    return {
      nameOverflow: name.scrollWidth > name.clientWidth + 1,
      metaOverflow: meta.scrollWidth > meta.clientWidth + 1,
      nameStyles: getComputedStyle(name).overflowWrap + ' / ' + getComputedStyle(name).wordBreak,
    };
  });
  check(`TC-12 длинные значения, ширина ${width}`,
    s.scrollWidth <= s.clientWidth + 1 && !wraps.nameOverflow && !wraps.metaOverflow && s.items.length === 1,
    `scrollWidth ${s.scrollWidth} при clientWidth ${s.clientWidth}; перенос имени: ${!wraps.nameOverflow}, email: ${!wraps.metaOverflow}; overflow-wrap/word-break: ${wraps.nameStyles}`);
  if (width === 1280) {
    console.log(`      maxlength у полей: ${s.maxlengths.join(', ')}`);
    console.log(`      сохранено: имя ${s.records?.[0]?.name.length} симв., email ${s.records?.[0]?.email.length} симв.`);
  }
}

// ── S-01 ─────────────────────────────────────────────────────────────────────
await fresh();
await fill('', 'bad-email', '123', '123', false);
await submit();
const sA = await state();
await fill('', 'bad-email', 'Parol123', 'Parol123', false);
await submit();
const sB = await state();
check('S-01 застрявшие ошибки',
  sA.errors.length === 4 && sB.errors.length === 3 && !sB.errors.some((e) => e.includes('8 символов')),
  `было ${sA.errors.length} → стало ${sB.errors.length}: ${JSON.stringify(sB.errors)}`);

// ── S-03 ─────────────────────────────────────────────────────────────────────
await fresh();
{
  const accepted = [];
  for (const email of ['a+tag@mail.ru', 'a@b.co', 'иван@почта.рф', 'user.name@sub.domain.co.uk']) {
    await fill('Тест', email, 'Parol123', 'Parol123', true);
    await submit();
    const s = await state();
    accepted.push(`${email}: ${s.errors.length === 0 ? 'принят' : 'ОТКЛОНЁН'}`);
  }
  const all = accepted.every((a) => a.endsWith('принят'));
  check('S-03 валидные непривычные адреса', all, accepted.join(', '));
}

// ── S-10 ─────────────────────────────────────────────────────────────────────
await fresh();
{
  const out = [];
  let i = 0;
  for (const [label, pwd] of Object.entries({ 'Парол😀😀 (7 знаков)': 'Парол😀😀', '7 эмодзи': '😀😀😀😀😀😀😀', '6 букв': 'Паролü' })) {
    await fill('Тест', `s10-${i++}@mail.ru`, pwd, pwd, true);
    await submit();
    const s = await state();
    out.push(`${label} (length ${pwd.length}): ${s.errors.length === 0 ? 'принят' : 'отклонён'}`);
  }
  check('S-10 длина пароля в единицах UTF-16',
    out[0].endsWith('принят') && out[1].endsWith('принят') && out[2].endsWith('отклонён'),
    out.join('; '));
}

console.log('\n' + '─'.repeat(78));
const failed = results.filter((r) => !r.ok);
console.log(`Итог: ${results.length - failed.length} из ${results.length} проверок в ожидаемом состоянии.`);
if (failed.length) console.log('Не в ожидаемом состоянии: ' + failed.map((f) => f.id).join(', '));
console.log(`Необработанных исключений на странице за прогон: ${pageErrors.length}${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);

await context.close();
await browser.close();
