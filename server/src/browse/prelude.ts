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
var localProxy=null;var sessionProxy=null;
try{
  var realLocal=window.localStorage;var realSession=window.sessionStorage;
  localProxy=wrap(realLocal);sessionProxy=wrap(realSession);
}catch(e){}
try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return localProxy||window.__agehaRealLocal}})}catch(e){}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,get:function(){return sessionProxy||window.__agehaRealSession}})}catch(e){}
}catch(e){}})();`

/** 注入用标签（head 首位；prelude 不依赖 DOM，位置只为尽早生效）。 */
export function browsePreludeTag(): string {
  return `<script>${BROWSE_PRELUDE_SCRIPT}</script>`
}
