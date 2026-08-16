// Конфигурация Playwright. Стенд не поднимается отсюда намеренно:
// по правилам проекта сервер запускается отдельной командой
// `npx --yes http-server ./app -p 8765 -c-1`, адрес фиксирован.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:8765/',
    viewport: { width: 1280, height: 900 },
  },
  reporter: 'list',
});
