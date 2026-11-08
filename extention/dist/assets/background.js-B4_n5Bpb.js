import{C as e,E as t,S as n,T as r,_ as i,a,c as o,d as s,f as c,g as l,i as u,l as d,m as f,o as p,s as m,u as h,v as g,x as _,y as v}from"./lokkedin-CJY6Vk3y.js";var y=3e4,b=new Map,x=new Map,S=null;function C(){for(let e of b.values())clearTimeout(e);b.clear()}function w(e,n){if(typeof chrome>`u`||!chrome.scripting?.executeScript||!e?.id)return;let[r]=t(e.url||``),i=chrome.runtime.getURL(`images/LokkedIn-removebg-preview 1.png`),a=!!n?.darkMode,o=!!n?.dyslexicFont,s=n?.fontSize||`medium`,c=n?.target_topic||`Focus`;chrome.scripting.executeScript({target:{tabId:e.id},func:e=>{let t=document.getElementById(`lokkedin-break-prompt-host`);t&&t.remove();let n=document.createElement(`div`);n.id=`lokkedin-break-prompt-host`,n.style.cssText=`position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);`;let r=e.darkMode?`#27272a`:`white`,i=e.darkMode?`#f4f4f5`:`black`,a=e.darkMode?`#71717a`:`black`,o=e.dyslexicFont?`"Comic Sans MS", "Trebuchet MS", Verdana, sans-serif`:`"Times New Roman", Times, serif`,s=e.fontSize===`small`?`13px`:e.fontSize===`large`?`19px`:`16px`,c=e.darkMode?`invert(1) hue-rotate(180deg)`:`none`,l=n.attachShadow({mode:`open`});l.innerHTML=`
          <style>
            .popup-notification {
              min-height: 150px;
              width: 300px;
              display: flex;
              flex-direction: column;
              overflow: hidden;
              border-radius: 10px;
              border: 2px solid ${a};
              background: ${r};
              color: ${i};
              font-family: ${o};
              box-sizing: border-box;
              box-shadow: 0 10px 25px rgba(0,0,0,0.35);
            }
            .popup-header {
              display: flex;
              align-items: center;
              justify-content: left;
              padding: 10px 20px;
              border-bottom: 2px solid ${a};
            }
            .popup-header img {
              height: 20px;
              width: auto;
              max-width: 100%;
              object-fit: contain;
              flex-shrink: 0;
              display: block;
              filter: ${c};
            }
            .popup-title {
              justify-content: right;
              margin-left: 20px;
              font-weight: bold;
              font-size: ${s};
            }
            .content {
              flex: 1;
              padding: 10px 20px;
              font-size: ${s};
            }
            .popup-text {
              display: block;
              margin-bottom: 12px;
            }
            .actions {
              display: flex;
              gap: 8px;
              justify-content: center;
            }
            button {
              border-radius: 5px;
              border: 2px solid ${a};
              padding: 4px 10px;
              cursor: pointer;
              font-family: inherit;
              background: #f0f0f0;
              color: black;
            }
            button:hover {
              background-color: lightskyblue;
            }
          </style>
          <div class="popup-notification">
            <div class="popup-header">
              <img src="${e.logoUrl}" alt="LokkedIn" />
              <div class="popup-title">
                <header>Break Tab Detected</header>
              </div>
            </div>
            <main class="content">
              <header class="popup-text">
                Are you supposed to be on <b>${e.host}</b> for "${e.topicName}"?
              </header>
              <div class="actions">
                <button id="lokkedin-allow-btn">Yes, Safe Site</button>
                <button id="lokkedin-dismiss-btn">No, Minimize</button>
              </div>
            </main>
          </div>
        `,document.documentElement.appendChild(n),l.getElementById(`lokkedin-allow-btn`).addEventListener(`click`,()=>{chrome.runtime.sendMessage({type:`LOKKEDIN_ALLOW_BREAK_SITE`,payload:{tabId:e.tabId,windowId:e.windowId,url:e.url,title:e.title}}),n.remove()}),l.getElementById(`lokkedin-dismiss-btn`).addEventListener(`click`,()=>{chrome.runtime.sendMessage({type:`LOKKEDIN_DISMISS_BREAK_SITE`,payload:{tabId:e.tabId,windowId:e.windowId,url:e.url,title:e.title}}),n.remove()})},args:[{tabId:e.id,windowId:e.windowId,url:e.url,title:e.title||e.url,host:r||e.url,topicName:c,logoUrl:i,darkMode:a,dyslexicFont:o,fontSize:s}]}).catch(()=>{})}function T(t){if(S&&=(clearTimeout(S),null),!t.isRunning||t.isPaused||!t.targetEndTime){C();return}let r=Math.max(0,t.targetEndTime-Date.now());S=setTimeout(async()=>{let[t,r]=await Promise.all([i(),l()]);if(!t.isRunning||t.isPaused)return;let o=t.mode===`focus`,s=o?`break`:`focus`,c=(t.focusCount||0)+ +!!o,u=(t.breakCount||0)+ +!o,d=s===`focus`?t.focusDurationSec:h(r,t,c),f=await e({mode:s,remainingSec:d,bonusBreakSec:s===`break`?0:t.bonusBreakSec||0,targetEndTime:Date.now()+d*1e3,focusCount:c,breakCount:u});if(await n({auto_organize:s===`focus`}),await m(s),s===`focus`)try{await a({})}catch{}else C();T(f)},r)}async function E(){try{let e=await l();await n(e),T(await i()),await c()}catch{}}chrome.runtime.onInstalled.addListener(()=>{E()}),chrome.runtime.onStartup.addListener(()=>{E()});async function D(e){if(!e||typeof chrome>`u`||!chrome.tabs?.get)return;let n;try{n=await chrome.tabs.get(e)}catch{return}if(g(n))return;let[a,o]=await Promise.all([l(),i()]);if(!a.auto_organize||!o.isRunning||o.isPaused||o.mode!==`focus`)return;let s=`${a.target_topic}||${a.notes||``}||${n.url}`;if(x.get(e)===s)return;let c=await _(n,a);if(c){x.set(e,s),await v([{id:n.id,windowId:n.windowId,title:n.title,url:n.url,category:c.category,source:c.source}],a);return}b.has(e)&&clearTimeout(b.get(e));let u=n.url,d=setTimeout(async()=>{b.delete(e);try{let n=await chrome.tabs.get(e);if(g(n)||n.url!==u)return;let[a,o]=await Promise.all([l(),i()]);if(!a.auto_organize||!o.isRunning||o.isPaused||o.mode!==`focus`)return;let c=await p([n],a);if(c.tabs&&c.tabs.length>0){let i=c.tabs[0];if(x.set(e,s),i.category===`B`){let[e]=t(n.url);await r({tabId:n.id,windowId:n.windowId,url:n.url,title:n.title||n.url,host:e||n.url,topicName:a.target_topic}),w(n,a)}else await v(c.tabs,a)}}catch{}},y);b.set(e,d)}chrome.tabs.onUpdated.addListener((e,t,n)=>{t.status===`complete`&&(g(n)||D(e))}),chrome.tabs.onActivated.addListener(({tabId:e})=>{D(e)}),chrome.tabs.onRemoved.addListener(e=>{b.has(e)&&(clearTimeout(b.get(e)),b.delete(e)),x.delete(e)}),chrome.runtime.onMessage.addListener((t,c,h)=>!t||typeof t.type!=`string`?!1:((async()=>{switch(t.type){case`LOKKEDIN_ANALYZE_AND_GROUP`:{let e=t.payload||{};Object.keys(e).length>0&&await n(e),h({ok:!0,data:await a(e,{windowId:e.windowId??chrome.windows.WINDOW_ID_CURRENT})});break}case`LOKKEDIN_ANALYZE_ONLY`:{let e=t.payload||{},n=await s(e.windowId??chrome.windows.WINDOW_ID_CURRENT);h({ok:!0,data:await p(n,e)});break}case`LOKKEDIN_APPLY_MODE_GROUPS`:{let{mode:e,windowId:n}=t.payload||{};await m(e,n),h({ok:!0});break}case`LOKKEDIN_ALLOW_BREAK_SITE`:{let e=await u(t.payload||{});x.clear(),h({ok:!0,data:e});break}case`LOKKEDIN_DISMISS_BREAK_SITE`:{let{tabId:e,windowId:n,url:i,title:a}=t.payload||{};await r(null);let o=await l();e&&n&&await v([{id:e,windowId:n,title:a||i,url:i,category:`B`,source:`llm`}],o),h({ok:!0});break}case`LOKKEDIN_GET_SETTINGS`:h({ok:!0,data:await l()});break;case`LOKKEDIN_SAVE_SETTINGS`:{let e=await n(t.payload||{});x.clear(),h({ok:!0,data:e});break}case`LOKKEDIN_SYNC_TIMER`:{let n=await e(t.payload||{});T(n),h({ok:!0,data:n});break}case`LOKKEDIN_GET_STATUS`:{let[e,t,n,r]=await Promise.all([l(),i(),o().catch(e=>({status:`offline`,error:e.message})),f().catch(e=>({error:e.message}))]);h({ok:!0,data:{settings:e,timer:t,health:n,me:r}});break}case`LOKKEDIN_CLEAR_CACHE`:{let e=await d();x.clear(),h({ok:!0,data:e});break}default:h({ok:!1,error:`Unknown message type: ${t.type}`})}})().catch(e=>{h({ok:!1,error:e?.message||String(e)})}),!0));