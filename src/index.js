import { startGame, stopGame } from './game/launcher.js';

import './main.scss';

const container = document.querySelector('.js-app');
if (!container) {
  throw new Error('Root container .js-app not found');
}

const canvas = document.createElement('canvas');
canvas.id = 'plot';
canvas.textContent = 'Обновите браузер';
container.appendChild(canvas);

startGame(canvas).catch((err) => {
  console.error('Game start failed:', err);
});

window.addEventListener('beforeunload', stopGame);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopGame();
  });
}
