/* --- sw.js --- */
const KEY = 'ptState';
const DEFAULT_STATE = {
  status: 'idle', phase: 'work', endTime: null,
  timeLeftSec: 1500, durationSec: 1500, curCycle: 1, totalCycles: 4, workMin: 25, restMin: 5
};

let autoDecisionTimer = null;
let pendingDecision = null; 

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [KEY]: DEFAULT_STATE });
});

// 执行默认操作
async function executeDefaultAction() {
  if (!pendingDecision) return;
  const d = await chrome.storage.local.get(KEY);
  let s = d[KEY]; if (!s) return;

  if (pendingDecision.type === 'to_rest') {
    startPhase(s, 'rest'); 
  } else if (pendingDecision.type === 'to_work') {
    if (s.curCycle < s.totalCycles) {
      s.curCycle++;
      startPhase(s, 'work');
    } else {
      finishAll(s);
    }
  }
  pendingDecision = null; 
}

async function finishAll(s) {
  s.status = 'idle'; s.curCycle = 1; s.timeLeftSec = 0; s.endTime = null;
  await chrome.storage.local.set({ [KEY]: s });
  notify('done', '🎉 全部完成！', '太棒了，计划已结束。', [], 3);
}

// 核心通知函数
function notify(id, title, message, buttons = [], autoConfirmSec = 0) {
  if (autoDecisionTimer) clearTimeout(autoDecisionTimer);
  
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon.png'),
    title: title,
    message: message,
    buttons: buttons,
    priority: 2,
    // 强制停留，等待JS代码控制关闭
    requireInteraction: true 
  }, (cid) => {
    // 设定倒计时
    if (autoConfirmSec > 0) {
      autoDecisionTimer = setTimeout(() => {
        chrome.notifications.clear(cid); 
        executeDefaultAction(); // 时间到，自动执行
      }, autoConfirmSec * 1000);
    }
  });
}

chrome.notifications.onClosed.addListener((notifId, byUser) => {
  if (byUser && pendingDecision) {
    if (autoDecisionTimer) clearTimeout(autoDecisionTimer);
    executeDefaultAction(); // 用户手动关闭 -> 视为同意
  }
});

async function startPhase(state, type) {
  state.phase = type;
  state.status = 'running';
  let minutes = type === 'work' ? state.workMin : state.restMin;
  const sec = Math.round(minutes * 60);
  state.durationSec = sec;
  state.endTime = Date.now() + sec * 1000;
  await chrome.storage.local.set({ [KEY]: state });
  chrome.alarms.create('tomato', { when: state.endTime });
  chrome.runtime.sendMessage({ cmd: 'tick' }).catch(()=>{});
}

async function onTimerFinished() {
  const d = await chrome.storage.local.get(KEY);
  let s = d[KEY];
  if (!s || s.status !== 'running') return;

  if (s.phase === 'work') {
    if (s.curCycle >= s.totalCycles) {
      finishAll(s);
    } else {
      s.status = 'paused'; s.endTime = null; s.timeLeftSec = 0;
      await chrome.storage.local.set({ [KEY]: s });
      
      pendingDecision = { type: 'to_rest' };
      // 【这里改为 10 秒】
      notify('ask_rest', `第 ${s.curCycle} 轮结束`, '休息一下吗？', [{title:'✅ 休息'},{title:'⏭️ 跳过'}], 10);
    }
  } else {
    s.status = 'paused'; s.endTime = null; s.timeLeftSec = 0;
    await chrome.storage.local.set({ [KEY]: s });
    
    pendingDecision = { type: 'to_work' };
    // 【这里改为 10 秒】
    notify('ask_work', '休息结束', `准备第 ${s.curCycle+1} 轮工作`, [{title:'🚀 开始'}], 10);
  }
  chrome.runtime.sendMessage({ cmd: 'tick' }).catch(()=>{});
}

if (chrome.notifications && chrome.notifications.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener(async (nid, idx) => {
    if (autoDecisionTimer) clearTimeout(autoDecisionTimer);
    pendingDecision = null;
    
    const d = await chrome.storage.local.get(KEY);
    let s = d[KEY]; if(!s) return;
    chrome.notifications.clear(nid);

    if (nid === 'ask_rest') {
      if (idx === 0) startPhase(s, 'rest');
      else {
        if (s.curCycle < s.totalCycles) { s.curCycle++; startPhase(s, 'work'); }
        else finishAll(s);
      }
    } 
    else if (nid === 'ask_work') {
      if (s.curCycle < s.totalCycles) { s.curCycle++; startPhase(s, 'work'); }
      else finishAll(s);
    }
  });
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tomato') onTimerFinished(); });

chrome.runtime.onMessage.addListener(msg => {
  if (msg.cmd === 'start') {
    chrome.storage.local.get(KEY).then(d => {
      let s = d[KEY] || DEFAULT_STATE;
      if (s.status === 'idle') {
        s.phase = 'work'; s.curCycle = 1; startPhase(s, 'work');
        notify('start', '番茄钟启动', '加油！', [], 3);
      } else if (s.status === 'paused' && s.timeLeftSec > 0) {
        s.status = 'running'; s.endTime = Date.now() + s.timeLeftSec * 1000;
        chrome.storage.local.set({ [KEY]: s });
        chrome.alarms.create('tomato', { when: s.endTime });
      }
    });
  }
  if (msg.cmd === 'pause') {
    chrome.alarms.clear('tomato');
    chrome.storage.local.get(KEY).then(async d => {
      let s = d[KEY];
      if (s.endTime) s.timeLeftSec = Math.max(0, Math.ceil((s.endTime - Date.now())/1000));
      s.status = 'paused'; s.endTime = null;
      await chrome.storage.local.set({ [KEY]: s });
      chrome.runtime.sendMessage({ cmd: 'tick' }).catch(()=>{});
    });
  }
  if (msg.cmd === 'stop') chrome.alarms.clear('tomato');
});