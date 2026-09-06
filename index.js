"use strict";

/**
 * dsh-whale-pet — 鲸港 WhaleHarbor 大白鲸娘桌面窗宠（Host 半部）。
 *
 * 通过桌面壳的 RPC 桥（float.window.*，设计见 dsh-desktop/designs/float-window.md）
 * 创建一个透明、无边框、置顶 floating 级、不抢焦点、不进任务栏的悬浮窗。
 * 形象为内置 Lottie 骨骼动画角色（蓝发女仆装鲸娘，部件级动画：呼吸浮动/眨眼/
 * 尾巴摆动/挥手/点头/抖动），实时反映 DSH 的工作状态：
 *
 *   空闲浮动（idle-a/b 随机切换）/ 忙碌摇摆+汗珠气泡（气泡里写当前工具名） /
 *   审批等待红色 "!" / 提问等待蓝色 "?" / 出错抖动+橙色 "✕"（8s）/
 *   完成蹦跳+星星爱心 / 空闲 3 分钟打瞌睡（变暗+zzz）/ 子代理小鲸鱼分身（最多 6 只）
 *
 * 事件来源（全部只读标量/计数，subagent 按 session header 过滤）：
 *   agent/status（主 agent 空闲⇄运行）、tools/execute（根调用计数 + 工具名）、
 *   approval/request、user-questions/request（瀑布计数，主 agent 限定）、
 *   subagent/start|end（分身）、workflow/start|end、agent/error（抖动）
 *
 * 反向通道（eventPort）：float.window.input（戳一戳）、float.window.menu.click
 * （右键原生菜单：大小/隐藏）、float.window.closed、tray.click（托盘显示/隐藏）。
 * 桥不可达（非桌面壳环境，如纯浏览器/CLI 启动）时整个插件安静空转，无副作用。
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.DSH_DESKTOP_NOTIFY_PORT || "";
const TOKEN = process.env.DSH_DESKTOP_NOTIFY_TOKEN || "";
const BRIDGE_URL = `http://127.0.0.1:${PORT}/`;
const PLUGIN = "dsh-whale-pet";

/** 浮窗尺寸档位（宽×高，鲸娘在右下，气泡在左上）。 */
const SIZES = {
  s: { width: 272, height: 210 },
  m: { width: 340, height: 260 },
  l: { width: 430, height: 330 },
};

/** 零件目录（parts/*.png，启动时扫入缓存，GET /parts/<file> 白名单自取）。 */

const textEncoder = new TextEncoder();

/** Fire-and-forget RPC POST（UTF-8 字节体，中文安全）。cb(resultOrNull)。 */
function rpc(method, params, cb) {
  try {
    const payload = JSON.stringify({ method, params });
    fetch(BRIDGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { "x-dsh-notify-token": TOKEN } : {}),
      },
      body: textEncoder.encode(payload),
    }).then(async (res) => {
      if (!cb) return;
      let result = null;
      try { result = await res.json(); } catch { /* non-JSON */ }
      cb(result);
    }).catch(() => { if (cb) cb(null); });
  } catch {
    if (cb) cb(null);
  }
}

/** 主 agent 判定：subagent 的 session header 带 parentSession / origin / delegationDepth。 */
function isSubagent(agent) {
  try {
    const header = (agent && agent.session && agent.session.header) || {};
    return !!(header.parentSession || header.origin === "subagent" || (header.delegationDepth ?? 0) >= 1);
  } catch {
    return true;
  }
}

/** 工具执行标签：ToolExecutionInput.name（根调用才计，rootCallId === callId）。 */
function isRootExecution(exec) {
  try {
    if (!exec || typeof exec !== "object") return false;
    if (exec.rootCallId === undefined || exec.callId === undefined) return true; // 宽容：老核心
    return exec.rootCallId === exec.callId;
  } catch {
    return false;
  }
}

/* eslint-disable */
/**
 * 浮窗页面（由本地服务器 GET /pet.html 自取；通信仅 __dshFloat.onState/send；
 * 拖拽与右键菜单由壳的 float-preload 实现，页面不写 app-region）。
 * 注意：本模板是 JS 模板字面量，页面脚本里的正则反斜杠必须双写（\\w）。
 */
function buildPetPage() {
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden;height:100%;
  font-family:"Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
.stage{position:fixed;inset:0}
/* 纸片人：px-v42 拆件拼装。统一画布 917x980（顶部 140 透明给呆毛），
   零件全部 inset:0 同位叠加，动作 = 容器 transform + 零件透明度/小变换 */
.charwrap{position:absolute;right:0;bottom:0;top:30px;aspect-ratio:917/980;
  transform-origin:60% 92%;cursor:default}
.charwrap.poked{animation:poke .5s ease}
.char{position:absolute;inset:0;animation:bob 4.5s ease-in-out infinite}
.mood-nap.char{filter:saturate(.55) brightness(.92)}
.part{position:absolute;inset:0;background-size:100% 100%;background-repeat:no-repeat;
  image-rendering:pixelated;pointer-events:none}
.p-base{background-image:url("parts/base.png")}
.p-ahoge{background-image:url("parts/ahoge.png");transform-origin:38.4% 16.3%;animation:ahs 4s ease-in-out infinite}
.p-eyes-open{background-image:url("parts/eyes-open.png")}
.p-eyes-closed{background-image:url("parts/eyes-closed.png")}
.p-eyes-happy{background-image:url("parts/eyes-happy.png")}
.p-eyes-xx{background-image:url("parts/eyes-xx.png")}
.p-mouth-open{background-image:url("parts/mouth-open.png")}
.p-mouth-smile{background-image:url("parts/mouth-smile.png")}
.p-mouth-wavy{background-image:url("parts/mouth-wavy.png")}
.p-mouth-o{background-image:url("parts/mouth-o.png")}
.p-mouth-big{background-image:url("parts/mouth-big.png")}
.p-mouth-frown{background-image:url("parts/mouth-frown.png")}
.p-sweat{background-image:url("parts/sweat.png")}
.p-eyes,.p-mouth,.p-sweat{opacity:0}
/* 容器动作（translate 百分比相对自身盒，尺寸自适应） */
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1%)}}
.mood-busy.char{animation:bobBusy 1.15s ease-in-out infinite}
@keyframes bobBusy{0%,100%{transform:translateY(0)}50%{transform:translateY(-.7%)}}
.mood-nap.char{animation:bobNap 7s ease-in-out infinite}
@keyframes bobNap{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.2%)}}
.mood-celebrate.char{animation:hop 4.5s ease-in-out infinite}
@keyframes hop{0%,6%,20%,34%,48%,62%,76%,100%{transform:translateY(0)}8%,36%,64%{transform:translateY(1.2%)}13%,41%,69%{transform:translateY(-4.6%)}}
.mood-error.char{animation:tremble .42s linear infinite}
@keyframes tremble{0%,100%{transform:translateX(0)}25%{transform:translateX(1%)}75%{transform:translateX(-1%)}}
.mood-approval.char{animation:bobCalm 5s ease-in-out infinite}
@keyframes bobCalm{0%,100%{transform:translateY(0)}50%{transform:translateY(-.6%)}}
.mood-question.char{animation:bob 5.5s ease-in-out infinite}
.mood-idle-b.char{animation:bob 5.5s ease-in-out infinite;animation-delay:-2.2s}
/* 呆毛摇摆（根部在画布 39%,22.2%） */
@keyframes ahs{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}
.mood-busy .p-ahoge{animation:ahsFast 1.5s ease-in-out infinite}
@keyframes ahsFast{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(9deg)}}
.mood-nap .p-ahoge{animation:ahsSlow 6.5s ease-in-out infinite}
@keyframes ahsSlow{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(3deg)}}
.mood-celebrate .p-ahoge{animation:ahsFast 1.2s ease-in-out infinite}
.mood-approval .p-ahoge{animation:ahsAp 5s ease-in-out infinite}
@keyframes ahsAp{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(-2deg)}}
.mood-question .p-ahoge{animation:ahsQ 2.8s ease-in-out infinite}
@keyframes ahsQ{0%,100%{transform:rotate(8deg)}50%{transform:rotate(-6deg)}}
.mood-error .p-ahoge{animation:ahsE 3s ease-in-out infinite}
@keyframes ahsE{0%,100%{transform:rotate(10deg)}50%{transform:rotate(6deg)}}
/* 眼睛：闭眼件纯透明弧线 → 眨眼帧必须睁眼隐+闭眼现同帧切换 */
.mood-nap .p-eyes-closed{opacity:1}
.mood-celebrate .p-eyes-happy{opacity:1}
.mood-error .p-eyes-xx{opacity:1}
.mood-idle-a .p-eyes-open{animation:blinkAO 6s infinite}
@keyframes blinkAO{0%,45.9%{opacity:1}46%,48.9%{opacity:0}49%,93.9%{opacity:1}94%,96.9%{opacity:0}97%,100%{opacity:1}}
.mood-idle-a .p-eyes-closed{animation:blinkAC 6s infinite}
@keyframes blinkAC{0%,45.9%{opacity:0}46%,48.9%{opacity:1}49%,93.9%{opacity:0}94%,96.9%{opacity:1}97%,100%{opacity:0}}
.mood-busy .p-eyes-open{animation:blinkBuO 4.2s infinite}
@keyframes blinkBuO{0%,59.9%{opacity:1}60%,64%{opacity:0}65%,100%{opacity:1}}
.mood-busy .p-eyes-closed{animation:blinkBuC 4.2s infinite}
@keyframes blinkBuC{0%,59.9%{opacity:0}60%,64%{opacity:1}65%,100%{opacity:0}}
.mood-approval .p-eyes-open{animation:blinkApO 5.2s infinite}
@keyframes blinkApO{0%,51.9%{opacity:1}52%,56%{opacity:0}57%,100%{opacity:1}}
.mood-approval .p-eyes-closed{animation:blinkApC 5.2s infinite}
@keyframes blinkApC{0%,51.9%{opacity:0}52%,56%{opacity:1}57%,100%{opacity:0}}
.mood-question .p-eyes-open{animation:blinkQuO 6.4s infinite;transform:translate(-1.2%,-1.5%)}
@keyframes blinkQuO{0%,51.9%{opacity:1}52%,56%{opacity:0}57%,100%{opacity:1}}
.mood-question .p-eyes-closed{animation:blinkApC 6.4s infinite}
/* idle-b：视线平移与双眨合并进同一个 8s 动画 */
.mood-idle-b .p-eyes-open{animation:lookB 8s ease-in-out infinite}
@keyframes lookB{0%,19.9%{opacity:1;transform:translate(0,0)}20%,22.9%{opacity:0;transform:translate(0,0)}23%,25.9%{opacity:1;transform:translate(0,0)}26%,28.9%{opacity:0;transform:translate(0,0)}29%,38%{opacity:1;transform:translate(0,0)}46%,68%{opacity:1;transform:translate(1.4%,-.4%)}76%,100%{opacity:1;transform:translate(0,0)}}
.mood-idle-b .p-eyes-closed{animation:blinkBC 8s infinite}
@keyframes blinkBC{0%,19.9%{opacity:0}20%,22.9%{opacity:1}23%,25.9%{opacity:0}26%,28.9%{opacity:1}29%,100%{opacity:0}}
/* 嘴 */
.mood-idle-a .p-mouth-open{opacity:1}
.mood-idle-b .p-mouth-smile{opacity:1}
.mood-busy .p-mouth-wavy{opacity:1}
.mood-nap .p-mouth-o{opacity:1}
.mood-celebrate .p-mouth-big{opacity:1}
.mood-approval .p-mouth-o{opacity:1}
.mood-question .p-mouth-wavy{opacity:1}
.mood-error .p-mouth-frown{opacity:1}
/* 汗滴（busy） */
.mood-busy .p-sweat{animation:sweatfall 2.1s ease-in infinite}
@keyframes sweatfall{0%{opacity:0;transform:translateY(0)}14%{opacity:1}68%{opacity:1;transform:translateY(9%)}86%,100%{opacity:0;transform:translateY(12%)}}
@keyframes poke{0%{transform:scale(1,1)}30%{transform:scale(1.08,.9)}60%{transform:scale(.94,1.06)}100%{transform:scale(1,1)}}
@keyframes rise{0%{transform:translateY(6px);opacity:0}25%{opacity:.9}100%{transform:translateY(-26px);opacity:0}}
@keyframes drift{0%{transform:translate(0,0);opacity:0}30%{opacity:.95}100%{transform:translate(10px,-18px);opacity:0}}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes twinkle{0%,100%{transform:scale(.4);opacity:.2}50%{transform:scale(1);opacity:1}}
@keyframes miniswim{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-5px) rotate(4deg)}}
.fx{position:absolute;inset:0;pointer-events:none;z-index:25}
.fxi{position:absolute;width:22px;height:22px;pointer-events:none}
.fxi.sweat{animation:rise 1.6s ease-in infinite}
.fxi.bub{width:16px;height:16px;animation:rise 2.8s linear infinite}
.fxi.b2{animation-delay:.9s}
.fxi.b3{animation-delay:1.7s}
.fxi.heart{animation:rise 2.4s ease-out infinite}
.fxi.h2{animation-delay:1.2s}
.fxi.spark{width:18px;height:18px;animation:twinkle 1.5s ease-in-out infinite}
.fxi.s2{animation-delay:.4s}.fxi.s3{animation-delay:.8s}.fxi.s4{animation-delay:1.2s}
/* 气泡：顶部左侧空区，绝不遮挡右下角色（角色整体下移留出顶距） */
.speech{position:absolute;top:6px;left:4px;max-width:58%;z-index:30;background:rgba(255,255,255,.97);
  border:2px solid #9cc4e8;border-radius:14px;padding:8px 11px;pointer-events:none;
  box-shadow:0 4px 12px rgba(43,94,153,.18);color:#24476b;font-size:12.5px;line-height:1.45;
  opacity:0;transition:opacity .2s ease}
.speech.on{opacity:1}
.speech::after{content:"";position:absolute;right:22%;bottom:-8px;width:12px;height:12px;
  background:rgba(255,255,255,.97);border-right:2px solid #9cc4e8;border-bottom:2px solid #9cc4e8;
  transform:rotate(45deg)}
.speech .sub{margin-top:4px;font-size:11px;color:#6d8db0;border-top:1px dashed #cfe2f4;padding-top:4px}
.badge{position:absolute;right:3%;top:5%;width:26px;height:26px;border-radius:50%;background:#ff6b8a;z-index:20;
  color:#fff;font-size:16px;font-weight:700;display:none;align-items:center;justify-content:center;
  box-shadow:0 3px 8px rgba(229,83,122,.4);animation:bounce .9s ease-in-out infinite;pointer-events:none}
.badge.on{display:flex}
.badge.q{background:#4a86c8;box-shadow:0 3px 8px rgba(74,134,200,.4)}
.badge.err{background:#ff9f43;box-shadow:0 3px 8px rgba(255,159,67,.4)}
.zzz{position:absolute;right:8%;top:8%;color:#7fa8d0;font-weight:700;font-size:14px;letter-spacing:2px;z-index:20;
  display:none;animation:drift 2.6s ease-out infinite;pointer-events:none}
.zzz.on{display:block}
.minis{position:absolute;right:2%;bottom:0;display:flex;gap:4px;justify-content:flex-end;align-items:flex-end;z-index:15}
.mini{width:34px;height:auto;opacity:.95;animation:miniswim 1.4s ease-in-out infinite}
.fallback{position:absolute;right:6%;bottom:8%;font-size:110px;display:none;filter:drop-shadow(0 8px 16px rgba(20,40,80,.30))}
</style></head><body>
<div class="stage" id="stage">
  <div class="speech" id="bubble"><div id="btext"></div><div class="sub" id="bsub"></div></div>
  <div class="badge" id="badge">!</div>
  <div class="zzz" id="zzz">Z z z</div>
  <div class="fx" id="fx"></div>
  <div class="charwrap" id="charwrap"><div class="char" id="char">
    <div class="part p-base"></div>
    <div class="part p-ahoge"></div>
    <div class="part p-eyes p-eyes-open"></div>
    <div class="part p-eyes p-eyes-closed"></div>
    <div class="part p-eyes p-eyes-happy"></div>
    <div class="part p-eyes p-eyes-xx"></div>
    <div class="part p-mouth p-mouth-open"></div>
    <div class="part p-mouth p-mouth-smile"></div>
    <div class="part p-mouth p-mouth-wavy"></div>
    <div class="part p-mouth p-mouth-o"></div>
    <div class="part p-mouth p-mouth-big"></div>
    <div class="part p-mouth p-mouth-frown"></div>
    <div class="part p-sweat"></div>
  </div></div>
  <div class="fallback" id="fallback" style="display:none">🐳</div>
  <div class="minis" id="minis"></div>
</div>
<script>
var HEART='M0 4 C -1 1, -6 0, -6 4 C -6 7, -2 9, 0 12 C 2 9, 6 7, 6 4 C 6 0, 1 1, 0 4 Z';
var SPARK='M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z';
var MINI_WHALE='<svg viewBox="0 0 40 34"><path d="M30 12 C 38 4, 44 12, 38 20 C 35 24, 30 22, 28 18 Z" fill="#5a9ad8"/>'+
  '<ellipse cx="18" cy="18" rx="14" ry="10" fill="#eef6ff" stroke="#6fa8dc" stroke-width="2"/>'+
  '<circle cx="12" cy="16" r="1.8" fill="#17324f"/>'+
  '<path d="M7 20 Q10 23 13 20" stroke="#17324f" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
var IDLE_LINES=['摸鱼中～有任务尽管说！','鲸港今日风平浪静⚓','（尾巴拍拍水）戳我一下嘛～','大白鲸娘随时待命！','要不要喂我小鱼干？'];
var POKE_LINES=['呀！尾巴不可以随便拽啦！(＞﹏＜)','咕噜噜～好痒！','在在在，我在听！','嘿嘿，再戳一下也要干活哦～'];

var charwrap=document.getElementById('charwrap'), char=document.getElementById('char'),
    bubble=document.getElementById('bubble'), btext=document.getElementById('btext'),
    bsub=document.getElementById('bsub'), badge=document.getElementById('badge'),
    zzz=document.getElementById('zzz'), minis=document.getElementById('minis'),
    fx=document.getElementById('fx'), fallback=document.getElementById('fallback');

var st=null, mood='idle', idleB=false,
    idleSince=0, idleLine=0, pokeSay=null, pokeAt=0, celebrateUntil=0, hover=false;

/* 零件底座缺失（打包漏发 parts/）时退回占位鲸鱼 */
fetch('parts/base.png').then(function(r){ if(!r.ok) throw new Error('no parts'); })
  .catch(function(){ charwrap.style.display='none'; fallback.style.display='block'; });

function fxHtml(m){
  var h='';
  if(m==='busy'){
    h+='<svg class="fxi bub" style="left:58%;top:80%" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="rgba(255,255,255,.45)" stroke="#9fd4ff" stroke-width="2"/></svg>';
    h+='<svg class="fxi bub b2" style="left:66%;top:86%" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5" fill="rgba(255,255,255,.45)" stroke="#9fd4ff" stroke-width="2"/></svg>';
    h+='<svg class="fxi bub b3" style="left:88%;top:76%" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="rgba(255,255,255,.45)" stroke="#9fd4ff" stroke-width="2"/></svg>';
  }
  if(m==='celebrate'){
    h+='<svg class="fxi heart" style="left:56%;top:8%" viewBox="-8 -8 16 22"><path d="'+HEART+'" fill="#ff8fa3"/></svg>';
    h+='<svg class="fxi heart h2" style="left:76%;top:4%" viewBox="-8 -8 16 22"><path d="'+HEART+'" fill="#ffb9cc"/></svg>';
    var at=[['8%','22%'],['90%','16%'],['12%','78%'],['84%','66%']];
    for(var i=0;i<at.length;i++){
      h+='<svg class="fxi spark s'+(i+1)+'" style="left:'+at[i][0]+';top:'+at[i][1]+'" viewBox="-8 -8 16 16"><path d="'+SPARK+'" fill="#ffd76e"/></svg>';
    }
  }
  return h;
}

function send(d){ try{ if(window.__dshFloat) __dshFloat.send(d); }catch(e){} }

/* ---- 状态 → mood class（idle-a/b 随机轮换制造随机感；表情/动作全由 CSS 按 class 切换） ---- */
function moodName(m){ return m==='idle' ? (idleB?'idle-b':'idle-a') : m; }

function render(){
  charwrap.className='charwrap'+(Date.now()-pokeAt<500?' poked':'');
  char.className='char mood-'+moodName(mood);
  fx.innerHTML=fxHtml(mood);
  if(mood==='approval'){ badge.className='badge on'; badge.textContent='!'; }
  else if(mood==='question'){ badge.className='badge on q'; badge.textContent='?'; }
  else if(mood==='error'){ badge.className='badge on err'; badge.textContent='✕'; }
  else{ badge.className='badge'; }
  zzz.className='zzz'+(mood==='nap'?' on':'');
  var n=st?Math.min(st.subagents||0,6):0, h='';
  for(var i=0;i<n;i++) h+='<span class="mini" style="animation-delay:'+(i*0.35)+'s;display:inline-block">'+MINI_WHALE+'</span>';
  minis.innerHTML=h;
  var showBubble=hover||pokeSay||mood==='busy'||mood==='approval'||mood==='question'||mood==='celebrate'||mood==='error';
  bubble.className='speech'+(showBubble?' on':'');
  var text;
  if(pokeSay) text=pokeSay;
  else if(mood==='approval') text='有一个审批等你确认哦！回会话点一下～';
  else if(mood==='question') text='鲸鲸有问题想问你！快回来回答～';
  else if(mood==='error') text='呜…刚刚出了一点点错，别担心，我还在。';
  else if(mood==='celebrate') text='任务完成啦！✨ 今天也辛苦了～';
  else if(mood==='busy') text='努力工作中：'+(st&&st.activeTool?st.activeTool:'思考/执行')+((st&&st.busyTools>1)?' ×'+st.busyTools:'')+((st&&st.subagents>0)?' · 分身 '+st.subagents:'');
  else if(mood==='nap') text='Zzz…（打瞌睡中，戳一下叫醒）';
  else text=IDLE_LINES[idleLine%IDLE_LINES.length];
  btext.textContent=text;
  bsub.textContent=st?('本次开机工具 '+st.toolCallsTotal+' 次 · 忙碌 '+Math.round((st.busyMsTotal||0)/60000)+' 分钟'+(st.pokes?' · 被戳 '+st.pokes+' 次':'')):'连接中…';
}

function tick(){
  if(window.__moodPin){ render(); return; } /* 预览钩子钉住时不再自动推导 */
  var now=Date.now();
  var m;
  if(!st) m='idle';
  else if(st.pendingApprovals>0) m='approval';
  else if(st.pendingQuestions>0) m='question';
  else if(st.lastErrorAt&&now-st.lastErrorAt<8000) m='error';
  else if(celebrateUntil>now) m='celebrate';
  else if(st.busy) m='busy';
  else if(idleSince&&now-idleSince>180000) m='nap';
  else m='idle';
  if(m!==mood){ mood=m; }
  render();
}

function onState(s){
  var prev=st;
  st=s;
  if(prev&&prev.busy&&!s.busy) celebrateUntil=Date.now()+6000;
  if(s.busy) idleSince=0; else if(!idleSince) idleSince=Date.now();
  tick();
}

if(window.__dshFloat&&__dshFloat.onState) __dshFloat.onState(onState);
window.__setMood=function(m){ window.__moodPin=true; mood=m; render(); }; /* 预览/调试钩子 */
try{ var hm=/[?&#]mood=(\\w+)/.exec(location.search+location.hash); if(hm) __setMood(hm[1]); }catch(e){}
tick();
setInterval(tick,1000);
setInterval(function(){ idleLine++; },9000);
/* 空闲时随机换一套 idle 小动作（idle-a/idle-b） */
setInterval(function(){
  if(window.__moodPin||mood!=='idle') return;
  if(Math.random()<0.5){ idleB=!idleB; render(); }
},18000);

charwrap.addEventListener('mouseenter',function(){ hover=true; tick(); });
charwrap.addEventListener('mouseleave',function(){ hover=false; tick(); });

/* 戳一戳：位移小判定为点击（拖拽由 preload 的 4px 阈值接管） */
var downPos=null;
charwrap.addEventListener('mousedown',function(e){ downPos={x:e.screenX,y:e.screenY}; });
charwrap.addEventListener('mouseup',function(e){
  if(!downPos) return;
  var dx=e.screenX-downPos.x, dy=e.screenY-downPos.y; downPos=null;
  if(Math.abs(dx)+Math.abs(dy)>6) return;
  pokeAt=Date.now();
  if(idleSince) idleSince=Date.now();
  pokeSay=POKE_LINES[Math.floor(Math.random()*POKE_LINES.length)];
  send({type:'poke'});
  tick();
  setTimeout(function(){ pokeSay=null; tick(); },3200);
});
</script></body></html>`;
  return page;
}
/* eslint-enable */

module.exports = {
  apply(ctx) {
    // 非桌面壳环境（无桥环境变量）：安静空转。
    if (!PORT) {
      try { console.log("[dsh-whale-pet] DSH_DESKTOP_NOTIFY_PORT 未设置，非桌面壳环境，插件空转"); } catch { /* ignore */ }
      return;
    }

    // Lottie 资源（状态 JSON + 渲染库）随包分发，启动时读入内存。
    const assetCache = new Map();
    try {
      for (const f of fs.readdirSync(path.join(__dirname, "parts"))) {
        if (f.endsWith(".png")) {
          try { assetCache.set(`parts/${f}`, fs.readFileSync(path.join(__dirname, "parts", f))); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    // ---- 状态聚合 --------------------------------------------------------
    const state = {
      runningMains: new Set(),
      busyTools: 0,
      activeTool: null,
      pendingApprovals: 0,
      pendingQuestions: 0,
      subagents: 0,
      workflows: 0,
      lastErrorAt: 0,
      toolCallsTotal: 0,
      busyMsTotal: 0,
      pokes: 0,
      startedAt: Date.now(),
    };
    function isBusy() {
      return state.runningMains.size > 0 || state.busyTools > 0 || state.subagents > 0 || state.workflows > 0;
    }
    function snapshot() {
      return {
        busy: isBusy(),
        busyTools: state.busyTools,
        activeTool: state.activeTool,
        pendingApprovals: state.pendingApprovals,
        pendingQuestions: state.pendingQuestions,
        subagents: state.subagents,
        workflows: state.workflows,
        lastErrorAt: state.lastErrorAt,
        toolCallsTotal: state.toolCallsTotal,
        busyMsTotal: state.busyMsTotal,
        pokes: state.pokes,
      };
    }

    // ---- 浮窗生命周期 ------------------------------------------------------
    let registered = false;
    let floatSupported = true;
    let floatId = null;
    let petVisible = true;
    let currentSize = "m";
    let lastPushText = "";

    function pushState(force) {
      if (!floatId) return;
      const text = JSON.stringify(snapshot());
      if (!force && text === lastPushText) return;
      lastPushText = text;
      rpc("float.window.state", { plugin: PLUGIN, id: floatId, state: JSON.parse(text) });
    }

    function createPet() {
      if (!registered || !floatSupported || floatId || !petVisible) return;
      const size = SIZES[currentSize] || SIZES.m;
      rpc("float.window.create", {
        plugin: PLUGIN,
        // 桥体 4KB 上限放不下内联页面；页面由我们的本地服务器自取
        url: `http://127.0.0.1:${eventServer.address().port}/pet.html`,
        width: size.width,
        height: size.height,
        transparent: true,
        clickThrough: false,
      }, (res) => {
        if (res && res.ok && res.id) {
          floatId = res.id;
          lastPushText = "";
          declarePetMenu();
          pushState(true);
          return;
        }
        if (res && res.ok === false) floatSupported = false; // 浮窗被禁用/旧壳：不再重试
      });
    }

    function closePet() {
      if (!floatId) return;
      const id = floatId;
      floatId = null;
      rpc("float.window.close", { plugin: PLUGIN, id });
    }

    /** 浮窗右键原生菜单（float.window.menu；壳 preload 捕获右键弹出，点击回投 menu.click）。 */
    function petMenuItems() {
      const mark = (s) => (currentSize === s ? "✓ " : "");
      return [
        { id: "size-s", label: mark("s") + "小号" },
        { id: "size-m", label: mark("m") + "中号" },
        { id: "size-l", label: mark("l") + "大号" },
        { type: "separator" },
        { id: "hide", label: "隐藏鲸娘（托盘菜单可唤回）" },
      ];
    }
    function declarePetMenu() {
      if (!floatId) return;
      rpc("float.window.menu", { plugin: PLUGIN, id: floatId, items: petMenuItems() });
    }

    function resizePet(size) {
      if (!SIZES[size] || size === currentSize) return;
      currentSize = size;
      closePet();
      createPet(); // 壳缓存最新 state，did-finish-load 后自动补发，新窗立即恢复状态
    }

    function hidePet() {
      petVisible = false;
      closePet();
      pushTrayMenu();
    }

    function statusLabel() {
      if (!floatSupported) return "鲸娘桌宠：浮窗被禁用（桌面版设置可开）";
      if (isBusy()) return `鲸娘桌宠：工作中（工具 ${state.busyTools} · 分身 ${state.subagents}）`;
      return "鲸娘桌宠：空闲中";
    }

    function pushTrayMenu() {
      if (!registered) return;
      rpc("tray.setMenu", {
        plugin: PLUGIN,
        items: [
          { id: "pet-status", label: statusLabel(), enabled: false },
          { id: "pet-toggle", label: floatId ? "隐藏鲸娘" : "显示鲸娘" },
        ],
      });
    }

    /** 壳 → 插件事件（反向通道）。 */
    function handleBridgeEvent(evt) {
      try {
        if (!evt || typeof evt !== "object") return;
        if (evt.event === "float.window.input") {
          const data = evt.data && evt.data.data;
          if (!data || typeof data !== "object") return;
          if (data.type === "poke") {
            state.pokes++;
            pushState(true);
          } else if (data.type === "resize") {
            resizePet(data.size);
          } else if (data.type === "hide") {
            hidePet();
          }
          return;
        }
        if (evt.event === "float.window.menu.click") {
          const itemId = evt.data && evt.data.itemId;
          if (itemId === "hide") {
            hidePet();
            return;
          }
          const m = /^size-(s|m|l)$/.exec(itemId || "");
          if (m) resizePet(m[1]);
          return;
        }
        if (evt.event === "float.window.closed") {
          if (evt.data && evt.data.id === floatId) floatId = null;
          pushTrayMenu();
          return;
        }
        if (evt.event === "tray.click" && evt.id === "pet-toggle") {
          if (floatId) {
            petVisible = false;
            closePet();
          } else {
            petVisible = true;
            createPet();
          }
          pushTrayMenu();
        }
      } catch { /* ignore */ }
    }

    // ---- 反向通道事件服务器（127.0.0.1，OS 分配端口） ----------------------
    // POST = 壳事件回投（同一 token 校验）；GET = 浮窗页面与零件 PNG 自取
    // （桥体上限 4KB，富内容按设计走 url 自建通道——页面与素材均无敏感数据，
    // __dshFloat 由壳只注入浮窗，白名单之外的路径一律 404）。
    const eventServer = http.createServer((req, res) => {
      if (req.method === "GET") {
        if (req.url === "/pet.html") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(buildPetPage());
          return;
        }
        const asset = assetCache.get(String(req.url).replace(/^\//, ""));
        if (asset) {
          res.writeHead(200, { "content-type": "image/png", "cache-control": "no-cache" });
          res.end(asset);
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (TOKEN && req.headers["x-dsh-notify-token"] !== TOKEN) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      let body = "";
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 4096) { req.destroy(); return; }
        body += c;
      });
      req.on("end", () => {
        if (!res.writableEnded) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        }
        try { handleBridgeEvent(JSON.parse(body)); } catch { /* ignore */ }
      });
    });
    eventServer.on("error", () => { /* 桥事件尽力而为 */ });

    // ---- 注册（带退避重试；被拒绝=旧壳，不重试） ---------------------------
    const RETRY_DELAYS = [1500, 3000, 6000, 12000, 20000];
    const retryTimers = [];
    function registerWithBridge(attempt) {
      rpc("bridge.register", { plugin: PLUGIN, eventPort: eventServer.address().port }, (result) => {
        if (result && result.ok) {
          registered = true;
          const caps = Array.isArray(result.capabilities) ? result.capabilities : [];
          floatSupported = caps.length === 0 || caps.indexOf("float.window") !== -1;
          createPet();
          pushTrayMenu();
          return;
        }
        if (result && result.ok === false) return;
        const delay = RETRY_DELAYS[attempt];
        if (delay !== undefined) {
          retryTimers.push(setTimeout(() => registerWithBridge(attempt + 1), delay));
        }
      });
    }
    eventServer.listen(0, "127.0.0.1", () => registerWithBridge(0));

    // ---- 事件订阅 ----------------------------------------------------------
    // 主 agent 空闲⇄运行；任何状态跳变顺带结清等待态。
    ctx.on("agent/status", (payload) => {
      try {
        const agent = payload && payload.agent;
        if (!agent) return;
        const id = String(agent.id ?? (agent.session && agent.session.id) ?? "agent");
        state.pendingApprovals = 0;
        state.pendingQuestions = 0;
        if (payload.status === "running") {
          if (!isSubagent(agent)) state.runningMains.add(id);
        } else if (payload.status === "idle") {
          state.runningMains.delete(id);
        }
        pushState();
        pushTrayMenu();
      } catch { /* ignore */ }
    });

    // 根工具调用计数 + 当前工具名（瀑布：必须调 next 并返回）。
    ctx.on("tools/execute", (exec, next) => {
      let tracked = false;
      try {
        if (isRootExecution(exec)) {
          tracked = true;
          state.busyTools++;
          state.toolCallsTotal++;
          if (typeof exec.name === "string" && exec.name) state.activeTool = exec.name;
          pushState();
        }
      } catch { /* ignore */ }
      const p = next();
      if (tracked) {
        const done = () => {
          try { state.busyTools = Math.max(0, state.busyTools - 1); pushState(); } catch { /* ignore */ }
        };
        p.then(done, done);
      }
      return p;
    });

    // 审批等待（主 agent 限定；subagent 的审批被宿主自动拒绝，属噪音）。
    ctx.on("approval/request", (req, next) => {
      try {
        if (!isSubagent(req && req.agent)) {
          state.pendingApprovals++;
          pushState(true);
        }
      } catch { /* ignore */ }
      const p = next();
      const done = () => {
        try { state.pendingApprovals = Math.max(0, state.pendingApprovals - 1); pushState(); } catch { /* ignore */ }
      };
      p.then(done, done);
      return p;
    });

    // 提问等待（主 agent 限定）。
    ctx.on("user-questions/request", (req, next) => {
      try {
        if (!isSubagent(req && req.agent)) {
          state.pendingQuestions++;
          pushState(true);
        }
      } catch { /* ignore */ }
      const p = next();
      const done = () => {
        try { state.pendingQuestions = Math.max(0, state.pendingQuestions - 1); pushState(); } catch { /* ignore */ }
      };
      p.then(done, done);
      return p;
    });

    // 子代理分身。
    ctx.on("subagent/start", () => { try { state.subagents++; pushState(); } catch { /* ignore */ } });
    ctx.on("subagent/end", () => { try { state.subagents = Math.max(0, state.subagents - 1); pushState(); } catch { /* ignore */ } });

    // 工作流。
    ctx.on("workflow/start", () => { try { state.workflows++; pushState(); } catch { /* ignore */ } });
    ctx.on("workflow/end", () => { try { state.workflows = Math.max(0, state.workflows - 1); pushState(); } catch { /* ignore */ } });

    // 出错抖动（主 agent 限定）。
    ctx.on("agent/error", (payload) => {
      try {
        if (isSubagent(payload && payload.agent)) return;
        state.lastErrorAt = Date.now();
        pushState(true);
      } catch { /* ignore */ }
    });

    // 心跳：忙碌时长累计 + 兜底刷新。
    const heartbeat = setInterval(() => {
      try {
        if (isBusy()) state.busyMsTotal += 1000;
        pushState();
      } catch { /* ignore */ }
    }, 1000);

    // ---- 卸载清理（HMR / 卸载 / 核心退出） --------------------------------
    if (typeof ctx.effect === "function") {
      ctx.effect(() => () => {
        clearInterval(heartbeat);
        for (const t of retryTimers) clearTimeout(t);
        try { rpc("float.window.closeAll", { plugin: PLUGIN }); } catch { /* ignore */ }
        try { rpc("tray.setMenu", { plugin: PLUGIN, items: [] }); } catch { /* ignore */ }
        try { eventServer.close(); } catch { /* ignore */ }
      });
    }
  },
};

// 测试钩子：本地预览浮窗页面（node -e "process.stdout.write(require('./index.js')._buildPetPage())"）。
module.exports._buildPetPage = buildPetPage;
