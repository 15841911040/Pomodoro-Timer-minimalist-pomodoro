/* --- popup.js (V9.1) --- */
const KEY = 'ptState';
const THEME_KEY = 'ptTheme';

const el = {
  box: document.getElementById('visual-container'),
  fill: document.getElementById('fill-wave'),
  phase: document.getElementById('phase'),
  timer: document.getElementById('timer'),
  round: document.getElementById('round'),
  start: document.getElementById('start'),
  reset: document.getElementById('reset'),
  themeBtn: document.getElementById('theme-btn'),
  sun: document.getElementById('icon-sun'),
  moon: document.getElementById('icon-moon'),
  wm: document.getElementById('wm'), ws: document.getElementById('ws'),
  rm: document.getElementById('rm'), rs: document.getElementById('rs'),
  cycles: document.getElementById('cycles')
};

let timerInterval;

// 主题初始化
function initTheme() {
  const t = localStorage.getItem(THEME_KEY) || 'dark';
  document.body.setAttribute('data-theme', t);
  el.sun.style.display = t === 'dark' ? 'block' : 'none';
  el.moon.style.display = t === 'light' ? 'block' : 'none';
}

el.themeBtn.onclick = () => {
  const current = document.body.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  el.sun.style.display = next === 'dark' ? 'block' : 'none';
  el.moon.style.display = next === 'light' ? 'block' : 'none';
};

function fmt(s) {
  if (s < 0) s = 0;
  const m = String(Math.floor(s / 60)).padStart(2, 0);
  const ss = String(s % 60).padStart(2, 0);
  return `${m}:${ss}`;
}

async function render() {
  const d = await chrome.storage.local.get(KEY);
  const s = d[KEY] || {
    status: 'idle', phase: 'work', timeLeftSec: 1500, durationSec: 1500,
    curCycle: 1, totalCycles: 4, workMin: 25, restMin: 5
  };
  
  let displaySeconds = 0;
  if (s.status === 'running' && s.endTime) {
    displaySeconds = Math.max(0, Math.ceil((s.endTime - Date.now()) / 1000));
  } else {
    displaySeconds = s.timeLeftSec;
  }

  el.timer.textContent = fmt(displaySeconds);
  el.round.textContent = `${s.curCycle} / ${s.totalCycles}`;
  
  if (s.status === 'idle') el.phase.textContent = '准备就绪';
  else if (s.status === 'paused' && displaySeconds === 0) el.phase.textContent = '等待确认';
  else el.phase.textContent = s.phase === 'work' ? '专注中' : '休息中';

  const total = s.durationSec || 1;
  const percentFilled = (1 - (displaySeconds / total)) * 100;
  el.fill.style.height = s.status === 'idle' ? '0%' : `${Math.min(100, Math.max(0, percentFilled))}%`;
  el.box.setAttribute('data-phase', s.phase);

  el.start.textContent = s.status === 'running' ? '暂停' : '开始';
  
  // 防抖回填：仅当不是用户正在操作的那个输入框时才更新值
  // 这样保证用户打字时，输入框不会被 render 强行重置
  if (document.activeElement.tagName !== 'INPUT') {
      const setTime = (mInp, sInp, minVal) => {
         const t = Math.round(minVal * 60);
         mInp.value = Math.floor(t / 60);
         sInp.value = t % 60;
      };
      setTime(el.wm, el.ws, s.workMin);
      setTime(el.rm, el.rs, s.restMin);
      el.cycles.value = s.totalCycles;
  }
}

function loop() {
  render();
  timerInterval = setInterval(render, 1000);
}

el.start.onclick = async () => {
  const d = await chrome.storage.local.get(KEY);
  if (d[KEY]?.status === 'running') chrome.runtime.sendMessage({cmd:'pause'});
  else chrome.runtime.sendMessage({cmd:'start'});
  setTimeout(render, 50);
};

el.reset.onclick = async () => {
  const d = await chrome.storage.local.get(KEY);
  const s = d[KEY] || {};
  // 重置时，保留用户当前的 workMin 设定，而不是强制变回 25
  const resetS = { 
    ...s, status:'idle', phase:'work', endTime:null, curCycle:1,
    durationSec: Math.round(s.workMin*60), timeLeftSec: Math.round(s.workMin*60)
  };
  await chrome.storage.local.set({[KEY]: resetS});
  chrome.runtime.sendMessage({cmd:'stop'});
  render();
};

const inputs = [el.wm, el.ws, el.rm, el.rs, el.cycles];
// 【核心修改】这里改成了 'input'，实时保存！
inputs.forEach(i => i.addEventListener('input', async () => {
   const d = await chrome.storage.local.get(KEY);
   const s = d[KEY] || {};
   
   let wm = Math.max(0, +el.wm.value||0), ws = Math.max(0, +el.ws.value||0);
   let totalWork = wm*60 + ws;
   if(totalWork < 1) { /* 不要在这里强行改 value，会让用户无法删除数字 */ }
   // 我们只保存有效值
   s.workMin = Math.max(1, totalWork) / 60;
   
   let rm = Math.max(0, +el.rm.value||0), rs = Math.max(0, +el.rs.value||0);
   let totalRest = rm*60 + rs;
   s.restMin = Math.max(1, totalRest) / 60;
   
   s.totalCycles = Math.max(1, +el.cycles.value||1);
   
   if(s.status === 'idle') {
     s.durationSec = Math.round((s.phase==='work'?s.workMin:s.restMin)*60);
     s.timeLeftSec = s.durationSec;
   }
   await chrome.storage.local.set({[KEY]: s});
   render(); // 立即渲染一遍
}));

initTheme();
chrome.runtime.onMessage.addListener(m => {if(m.cmd==='tick') render()});
loop();