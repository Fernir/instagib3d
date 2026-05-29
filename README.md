# instagib.io (Vite)

Локальный клиент [instagib.io](https://github.com/schibir/instagib.io): оригинальная логика в ESM-модулях, сборка через Vite.

## Запуск

```bash
npm install
npm run dev
```

Откроется [http://localhost:3000](http://localhost:3000) (порт в `vite.config.js`).

Сборка: `npm run build`, предпросмотр: `npm run preview`.

## Локальная игра

По умолчанию — одиночный режим с ботами.

Параметры URL (необязательно):

- `nick` — имя игрока (по умолчанию `player`)
- `seed` — seed карты (по умолчанию `42`)
- `size_class` — размер карты `0`…`2`
- `addr` — адрес сервера; `local` или без параметра = локальный режим

## Структура

```
src/
  index.js                  точка входа, canvas
  main.scss
  instagib/
    launcher.js             startGame / stopGame
    runtime.js              WebGL, ввод, звук, цикл
    api.js                  публичный API игровых модулей
    bootstrap.js            порядок side-effect загрузки
    polyfill.js             Console, config, assert
    runtime-state.js        gl, canvas, input, синглтоны клиента
    mat4.js                 шим mat4 поверх gl-matrix
    client/                 рендер, HUD, боты, частицы, звук
    engine/                 WebGL: шейдеры, текстуры, FBO, текст, консоль
    server/                 локальный «сервер» (комната, AI, физика)
      room.js
      game/  level/  libs/  objects/
public/game/textures/, public/game/sounds/   ассеты
```

Звук включается после клика по странице и отключается, пока вкладка браузера неактивна.

Модули связаны через обычные ESM `import` / `export`. Общие синглтоны рантайма
(WebGL, canvas, звук, ссылки на загруженные клиентские классы) лежат в
`runtime-state.js` и заполняются из `runtime.js` при старте игры.
