// Window actions affect the layout only; simulator settings are left untouched.
function setupSpektrWindows(root, onLayout = () => {}) {
  const style = document.createElement('style');
  style.textContent = `
    #optics-xp-sketch .xp-title > span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}
    #optics-xp-sketch .xp-window-actions{display:flex;flex:none;gap:3px;margin-left:auto}
    #optics-xp-sketch .xp-window-actions button{display:grid;place-items:center;width:28px;min-width:28px;min-height:28px;padding:0;border:1px solid #e4edfa;border-radius:3px;background:linear-gradient(#91b6e9,#4d78b7);box-shadow:inset 1px 1px #cbdcf3;color:#fff;font:bold 21px/1 Tahoma,sans-serif;text-shadow:1px 1px #355684}
    #optics-xp-sketch .xp-window-actions button:hover{background:linear-gradient(#b0caf0,#628dca)}
    #optics-xp-sketch .xp-window-actions button:focus-visible{outline:2px solid #fff3b2;outline-offset:1px}
    #optics-xp-sketch .xp-window-actions [data-window-action="close"]{background:linear-gradient(#e7a594,#b86051)}
    #optics-xp-sketch .xp-window-actions [data-window-action="close"]:hover{background:linear-gradient(#f0b9a8,#c77969)}
    #optics-xp-sketch .xp-window.is-minimized{min-height:0}
    #optics-xp-sketch .xp-window.is-minimized > :not(.xp-title){display:none}
    #optics-xp-sketch.xp-scene-minimized{height:auto;grid-template-rows:auto auto;align-content:start}
    #optics-xp-sketch.xp-window-expanded{height:auto;grid-template-rows:auto auto;align-content:start}
    #optics-xp-sketch .xp-window.is-expanded:not(.is-minimized){min-height:calc(100vh - 2 * var(--page-padding,12px));min-height:calc(100dvh - 2 * var(--page-padding,12px))}
    #optics-xp-sketch .xp-control-window.is-expanded:not(.is-minimized){display:flex;flex-direction:column}
    #optics-xp-sketch .xp-control-window.is-expanded:not(.is-minimized) .xp-controls{flex:1;align-content:center}
    #optics-xp-sketch .xp-window-toast{position:fixed;right:12px;bottom:12px;z-index:10;max-width:calc(100vw - 24px);padding:9px 12px;border:1px solid #9c967f;border-radius:3px;background:#fff9dd;box-shadow:0 2px 7px #26384d25;color:#24323c;pointer-events:none}
    #optics-xp-sketch .xp-window-toast[hidden]{display:none}
    @media(pointer:coarse){#optics-xp-sketch .xp-window-actions button{width:44px;min-width:44px;min-height:44px}}
  `;
  root.append(style);

  const toast = document.createElement('div');
  toast.className = 'xp-window-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  root.append(toast);

  let toastTimer = 0;
  let layoutFrame = 0;
  const windows = [];
  const listeners = [];

  function refreshLayout() {
    const scene = root.querySelector('.xp-scene-window');
    root.classList.toggle('xp-scene-minimized', scene.classList.contains('is-minimized'));
    root.classList.toggle('xp-window-expanded', windows.some(item =>
      item.element.classList.contains('is-expanded') && !item.element.classList.contains('is-minimized')));
    for (const item of windows) {
      const minimized = item.element.classList.contains('is-minimized');
      const expanded = item.element.classList.contains('is-expanded');
      item.minimize.setAttribute('aria-expanded', String(!minimized));
      item.minimize.setAttribute('aria-label', `${minimized ? 'Восстановить' : 'Свернуть'} ${item.name}`);
      item.minimize.title = item.minimize.getAttribute('aria-label');
      item.maximize.setAttribute('aria-pressed', String(expanded && !minimized));
      item.maximize.setAttribute('aria-label', `${expanded && !minimized ? 'Вернуть обычный размер:' : 'Развернуть'} ${item.name}`);
      item.maximize.title = item.maximize.getAttribute('aria-label');
      item.maximize.firstChild.textContent = expanded && !minimized ? '❐' : '□';
    }
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; onLayout(); });
  }

  for (const element of root.querySelectorAll('.xp-scene-window, .xp-control-window')) {
    const title = element.querySelector('.xp-title');
    const name = element.classList.contains('xp-scene-window') ? 'окно установки' : 'окно управления';
    const actions = document.createElement('div');
    actions.className = 'xp-window-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', `Кнопки окна: ${name}`);

    function addButton(action, icon, label, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.windowAction = action;
      button.setAttribute('aria-label', label);
      button.title = label;
      const symbol = document.createElement('span');
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = icon;
      button.append(symbol);
      button.addEventListener('click', handler);
      listeners.push(() => button.removeEventListener('click', handler));
      actions.append(button);
      return button;
    }

    const minimize = addButton('minimize', '−', `Свернуть ${name}`, () => {
      element.classList.toggle('is-minimized');
      refreshLayout();
    });
    const maximize = addButton('maximize', '□', `Развернуть ${name}`, () => {
      const shouldExpand = element.classList.contains('is-minimized') || !element.classList.contains('is-expanded');
      for (const item of windows) item.element.classList.remove('is-expanded');
      element.classList.remove('is-minimized');
      element.classList.toggle('is-expanded', shouldExpand);
      refreshLayout();
    });
    addButton('close', '×', 'Закрыть лабораторию (в шутку)', () => {
      clearTimeout(toastTimer);
      toast.hidden = false;
      toast.textContent = 'Лаборатория остаётся открытой.';
      toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = ''; toastTimer = 0; }, 2600);
    });
    title.append(actions);
    windows.push({element, name, actions, minimize, maximize});
  }
  refreshLayout();

  return function cleanup() {
    clearTimeout(toastTimer);
    cancelAnimationFrame(layoutFrame);
    listeners.forEach(remove => remove());
    for (const item of windows) {
      item.element.classList.remove('is-minimized', 'is-expanded');
      item.actions.remove();
    }
    root.classList.remove('xp-scene-minimized', 'xp-window-expanded');
    toast.remove();
    style.remove();
    onLayout();
  };
}
