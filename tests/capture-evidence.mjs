// Снятие скриншотов-доказательств. Это НЕ автотест: проверок здесь нет,
// скрипт только открывает страницу в нужных состояниях и сохраняет картинки
// в reports/screenshots/. Автотест ровно один — tests/bug-01-overflow.spec.js.
//
// Запуск (из корня проекта, стенд должен быть уже поднят):
//   node tests/capture-evidence.mjs

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:8765/';
const OUT = 'reports/screenshots';
mkdirSync(OUT, { recursive: true });

const LONG_NAME = 'Я'.repeat(500);
const LONG_EMAIL = 'a'.repeat(300) + '@mail.ru';

async function fill(page, { name, email, password, confirm, agree }) {
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirm"]', confirm);
  if (agree) await page.check('input[name="agree"]');
}

const shots = [];

async function shot(page, file, note) {
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push(`${file} — ${note}`);
}

const browser = await chromium.launch();

for (const width of [1280, 360]) {
  const context = await browser.newContext({ viewport: { width, height: width === 360 ? 760 : 900 } });
  const page = await context.newPage();

  // 1. Пустое состояние
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shot(page, `empty-${width}.png`, `пустое состояние, ширина ${width}`);

  // 2. Состояние «Ошибка»: отправка полностью пустой формы
  await page.click('button[type="submit"]');
  await shot(page, `errors-${width}.png`, `ошибки после отправки пустой формы, ширина ${width}`);

  // 3. Состояние «Успех»: корректная регистрация
  await page.reload();
  await fill(page, { name: 'Иван Петров', email: 'ivan@mail.ru', password: 'Parol123', confirm: 'Parol123', agree: true });
  await page.click('button[type="submit"]');
  await shot(page, `success-${width}.png`, `подтверждение и список, ширина ${width}`);

  // 4. BUG-01: длинные значения без пробелов
  await fill(page, { name: LONG_NAME, email: LONG_EMAIL, password: 'Parol123', confirm: 'Parol123', agree: true });
  await page.click('button[type="submit"]');
  await shot(page, `bug-01-long-values-${width}.png`, `длинное имя и email, видимая область, ширина ${width}`);
  await page.screenshot({ path: `${OUT}/bug-01-long-values-${width}-fullpage.png`, fullPage: true });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  shots.push(`bug-01-long-values-${width}-fullpage.png — вся страница целиком; scrollWidth=${metrics.scrollWidth} при clientWidth=${metrics.clientWidth}`);

  // 5. BUG-02: двойной клик при уже показанном подтверждении.
  // Регистрируем первого обычным кликом (подтверждение появляется и остаётся),
  // затем второго — двойным кликом. Вёрстка при этом не прыгает, поэтому
  // второй клик попадает в кнопку и отправляет уже очищенную форму.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fill(page, { name: 'Первый', email: 'first@mail.ru', password: 'Parol123', confirm: 'Parol123', agree: true });
  await page.click('button[type="submit"]');
  await fill(page, { name: 'Второй', email: 'second@mail.ru', password: 'Parol123', confirm: 'Parol123', agree: true });
  await page.dblclick('button[type="submit"]');
  await shot(page, `bug-02-double-submit-${width}.png`, `двойной клик: запись создана, но показаны ошибки, ширина ${width}`);

  await context.close();
}

await browser.close();
console.log('Сохранено в ' + OUT + ':');
for (const s of shots) console.log('  ' + s);
