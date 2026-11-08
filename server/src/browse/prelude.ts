/**
 * 路径态文档的存储命名空间前奏（档 ③）：子域模式下所有站点共享
 * browse.ageha.cn 这一个 origin 的 localStorage/sessionStorage——不隔离
 * 就会互相踩键、甚至读到别的站点的数据。前奏以「scheme + host」为前缀
 * 包装两个 Storage 的读写（getItem/setItem/removeItem/clear/key/length），
 * 页面代码无感。
 *
 * 仅路径态（/https、/raw）的 HTML 响应注入；query 兜底模式（不透明 origin，
 * 存储本就不可用）不注入。已知边界：document.cookie 未虚拟化（子域 cookie
 * 属宿主，页面读写将命中子域自身——V1 文档化）。
 */

export const BROWSE_PRELUDE_SCRIPT = `(function(){try{
var segs=location.pathname.split('/');
var scheme=segs[1]||'';var host=segs[2]||'';
var ns='ax:'+scheme+':'+host+':';
window.__agehaBrowseSite=scheme+'://'+host;
function wrap(storage){
  var get=storage.getItem.bind(storage);
  var set=storage.setItem.bind(storage);
  var rem=storage.removeItem.bind(storage);
  function keys(){var out=[];for(var i=0;i<storage.length;i++){var k=storage.key(i);if(k!==null&&k.indexOf(ns)===0)out.push(k)}return out}
  return {
    get length(){return keys().length},
    key:function(i){var k=keys()[i];return k===undefined?null:k.slice(ns.length)},
    getItem:function(k){return get(ns+k)},
    setItem:function(k,v){return set(ns+k,String(v))},
    removeItem:function(k){return rem(ns+k)},
    clear:function(){var ks=keys();for(var i=0;i<ks.length;i++)rem(ks[i])}
  };
}
var localProxy=null;var sessionProxy=null;var realLocal=null;var realSession=null;
try{
  realLocal=window.localStorage;realSession=window.sessionStorage;
  localProxy=wrap(realLocal);sessionProxy=wrap(realSession);
}catch(e){}
/* 某一侧 wrap 抛错（部分 Storage 方法缺失等）时，该侧回退到真实 Storage，
 * 而不是 undefined——页面调用 getItem 不再直接 TypeError（A2 审查）。 */
try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return localProxy||realLocal}})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,get:function(){return sessionProxy||realSession}})}catch(e){}
}catch(e){}})();`

/** 注入用标签（head 首位；prelude 不依赖 DOM，位置只为尽早生效）。 */
export function browsePreludeTag(): string {
  return `<script>${BROWSE_PRELUDE_SCRIPT}</script>`
}

/**
 * 点击守卫（两种模式都注入，2026-10-18 B 站实证）：代理 iframe 是沙箱环境，
 * `target="_blank"` 的链接与 `_top/_parent` 导航要么被弹窗拦截器吞掉、要么
 * 被沙箱禁止——用户感知「点了没反应」。捕获阶段把这三类点击拦成**同帧
 * 导航**：落到重写后的路径态地址——能打开就打开；被风控/SPA 挡住也会看到
 * 带「在新标签页打开」的真实错误页（可见的失败优于静默失败）。
 */
export const BROWSE_CLICK_GUARD_SCRIPT = `(function(){try{
function absolute(href){
  try{return new URL(href,location.href).toString()}catch(e){return null}
}
document.addEventListener('click',function(e){
  var t=e.target;
  var a=t&&t.closest?t.closest('a[target]'):null;
  if(!a)return;
  var target=(a.getAttribute('target')||'').toLowerCase();
  if(target!=='_blank')return; // _top/_parent 交沙箱（导航被拒即静默，见下）
  var href=a.getAttribute('href');
  if(!href||href.charAt(0)==='#')return;
  var url=absolute(href);
  if(!url)return;
  // 目标若是本代理的路径态地址，先换算回真实站点 URL 再交给宿主。
  var m=new RegExp('^(https?://[^/]+)/(https?)/([^/]+)(/.*)?$').exec(url);
  if(m){url=m[2]+'://'+m[3]+(m[4]||'/')}
  e.preventDefault();
  // 沙箱里 _blank 弹窗不可靠、跨源顶层导航被禁：请求宿主「在新标签页打开」
  // （真实浏览器顶层标签，零限制）。宿主未响应时退回同帧导航（站内可渲染的
  // 目标仍能打开）。
  var responded=false;
  function onAck(ev){
    var d=ev.data;
    if(!d||d.type!=='agehaos:browse-open-external')return;
    responded=true;
    try{window.removeEventListener('message',onAck)}catch(e){}
  }
  try{window.addEventListener('message',onAck)}catch(e){}
  try{parent.postMessage({type:'agehaos:open-external',url:url},'*')}catch(e){}
  setTimeout(function(){
    if(responded)return;
    try{window.removeEventListener('message',onAck)}catch(e){}
    location.href=href; // 同帧兜底（站内目标）
  },600);
},true);
}catch(e){}})();`

/** 点击守卫注入标签。 */
export function browseClickGuardTag(): string {
  return `<script>${BROWSE_CLICK_GUARD_SCRIPT}</script>`
}

/**
 * iframe 内导航回报（D1 审查）：站内链接/SPA 跳转后宿主需要知道当前位置
 * （地址栏/书签/刷新/标题否则一直指向入栈时的旧 URL）。两种模式都注入；
 * 上报的是代理地址，宿主解码回真实 URL 并做 origin+iframe 来源校验。
 */
export const BROWSE_NAV_REPORT_SCRIPT = `(function(){try{
function report(){try{parent.postMessage({type:'agehaos:browse-location',url:location.href},'*')}catch(e){}}
function ready(){
  report();
  try{window.addEventListener('popstate',report);window.addEventListener('hashchange',report)}catch(e){}
  try{
    var push=history.pushState,replace=history.replaceState;
    history.pushState=function(){var out=push.apply(this,arguments);report();return out};
    history.replaceState=function(){var out=replace.apply(this,arguments);report();return out};
  }catch(e){}
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ready,{once:true})}else{ready()}
}catch(e){}})();`

/** 导航回报注入标签。 */
export function browseNavReportTag(): string {
  return `<script>${BROWSE_NAV_REPORT_SCRIPT}</script>`
}
