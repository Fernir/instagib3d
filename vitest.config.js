import { defineConfig } from 'vitest/config';

// Тесты покрывают чистую игровую логику (вектора, физика, утилиты, генерация
// уровня, сериализация). WebGL/DOM/сеть-зависимые модули сюда не входят —
// они требуют браузерного окружения и проверяются вручную.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
