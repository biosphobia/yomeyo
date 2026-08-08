const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./gacha-scene-DtWv1Tj3.js","./cloud-BrAf8IS0.js","./accounts-WTK4qg94.js","./store-Dxti2Gd4.js","./card-DloYQ9Ck.js","./gacha-roll-PtFkHMTq.js","./gacha-data-CaT_Zqip.js","./index-CGRRECQs.js","./modulepreload-polyfill-B5Qt9EMX.js","./unlock-CrtL2933.js","./profile-VM8BKhqX.js","./index-B6BmWXm8.css"])))=>i.map(i=>d[i]);
import{_ as m}from"./cloud-BrAf8IS0.js";import{y as A,l as H,u as N,s as j,g as V,j as D,c as b,k as w,h as F,f as x}from"./unlock-CrtL2933.js";import{t as S}from"./accounts-WTK4qg94.js";import{owned as Y,equippedSkin as B,equipSkin as C,itemCounts as G,ITEM_LIMIT as I,addOwned as U,addItem as W}from"./gacha-collection-CB8hFBPg.js";import{prizeTable as J,rarityOdds as K,cutsceneTitle as L,cutsceneLines as P,prizeImageUrl as Q,publishAvailable as X,setPrizeOverride as k,publishPrizeOverride as T,drawPrize as Z}from"./gacha-data-CaT_Zqip.js";import{applySkin as O}from"./skins-D9f5ijRb.js";import"./store-Dxti2Gd4.js";import"./card-DloYQ9Ck.js";async function R(a,i=()=>!0){const[s,r,e,o,t]=await Promise.all([A(),H(),J(),Y(),B(),N()]);if(!i())return;const n=b(),l=n||s>=e.cost;a.innerHTML=`
    ${j("Gacha")}

    <div class="card-panel purse-panel">
      <div class="purse-amount">${V(s)}</div>
      <div class="glosses">Yennies</div>
      <div class="row-actions" style="justify-content:center;margin-top:14px">
        <button id="gacha-open" ${l&&e.prizes.length>0?"":"disabled"}>
          Open a crate · ${n?"free":`${e.cost.toLocaleString()} ¥`}
        </button>
      </div>
      ${e.prizes.length===0?'<div class="msg">No prizes are configured.</div>':n?'<div class="msg">Admin: pulls are free and cost you nothing.</div>':l?"":`<div class="msg">${(e.cost-s).toLocaleString()} ¥ to go.</div>`}
    </div>

    <div id="gacha-stage"></div>

    <div class="card-panel">
      <b>Collection</b>
      <div class="glosses">${o.size} of ${e.prizes.length}</div>
      <div class="prize-grid" id="prize-grid"></div>
    </div>

    <div class="card-panel">
      <b>Inventory</b>
      <div id="gacha-inventory"></div>
    </div>

    <div class="card-panel">
      <b>Odds</b>
      ${e.draw==="uniform"?`<div class="purse-source">
               <span>Every prize, equally likely</span>
               <span class="purse-rate">${e.prizes.length>0?`1 in ${e.prizes.length}`:"—"}</span>
             </div>`:K(e).map(({info:d,chance:y})=>`<div class="purse-source">
                  <span style="color:${v(d.color)}">${p(d.label)}</span>
                  <span class="purse-rate">${(y*100).toFixed(1)}%</span>
                </div>`).join("")}
      <div class="purse-source">
        <span>A pull you already own</span>
        <span class="purse-rate">${Math.round(e.cost*e.duplicateRefund).toLocaleString()} ¥ back</span>
      </div>
    </div>

    <div class="card-panel">
      <b>Where yennies come from</b>
      <div class="purse-source">
        <span>Every right answer</span>
        <span class="purse-rate">1 ¥</span>
      </div>
      <div class="purse-source">
        <span>Reaching level ${r.level+1}</span>
        <span class="purse-rate">${D(r.level+1).toLocaleString()} ¥</span>
      </div>
    </div>

    ${n?'<div class="card-panel" id="cutscene-list"></div>':""}
  `,m(()=>import("./gacha-scene-DtWv1Tj3.js").then(d=>d.g),__vite__mapDeps([0,1,2,3,4]),import.meta.url).then(d=>d.warmUpCutscene()).catch(()=>{}),n&&z(a,e,i),se(a,e,o,t,()=>void R(a,i)),await te(a,e,o);const c=a.querySelector("#gacha-open");c&&(c.disabled=c.disabled||g,c.addEventListener("click",()=>{g||M(a,e,i)}))}let g=!1;async function z(a,i,s){const r=a.querySelector("#cutscene-list");if(!r)return;const{SCENARIOS:e}=await m(async()=>{const{SCENARIOS:o}=await import("./gacha-scene-DtWv1Tj3.js").then(t=>t.g);return{SCENARIOS:o}},__vite__mapDeps([0,1,2,3,4]),import.meta.url);if(!(!s()||!r.isConnected)){r.innerHTML=`
    <b>Cutscenes</b>
    <div class="glosses">Admin: play any of them, without a crate.</div>
    <div class="gram-levels" id="cutscene-chips">
      ${e.map(o=>`<button class="gram-level-chip" data-id="${v(o.id)}">
          ${p(L(i,o.id))}
          <span class="gram-level-count">${p(o.id)} · ${o.seconds}s</span>
        </button>`).join("")}
    </div>
  `;for(const o of r.querySelectorAll("#cutscene-chips button"))o.addEventListener("click",()=>void ee(a,i,o.dataset.id,s))}}async function ee(a,i,s,r){if(g)return;g=!0;const e=a.querySelector("#gacha-stage");e.innerHTML=`
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div class="row-actions" style="justify-content:center;margin-top:10px">
        <button id="preview-stop" class="secondary">Stop</button>
      </div>
    </div>
  `;const o=e.querySelector("#gacha-scene");o.scrollIntoView({behavior:"smooth",block:"center"});const{playCutscene:t}=await m(async()=>{const{playCutscene:l}=await import("./gacha-scene-DtWv1Tj3.js").then(c=>c.g);return{playCutscene:l}},__vite__mapDeps([0,1,2,3,4]),import.meta.url),n=t(o,{lines:P(i),scenario:s});n.id.then(l=>{const c=e.querySelector("#scene-caption");c&&l&&(c.textContent=L(i,l))}),e.querySelector("#preview-stop").addEventListener("click",()=>n.stop());try{await n.done}finally{n.stop(),g=!1}!r()||!e.isConnected||(e.innerHTML="")}async function te(a,i,s){const r=a.querySelector("#gacha-inventory");if(!r)return;const e=await G(),o=i.prizes.filter(t=>t.type==="item"?(e[t.id]??0)>0:s.has(t.id));if(o.length===0){r.innerHTML='<div class="glosses">Nothing yet. Open a crate.</div>';return}r.innerHTML=o.map(t=>{const n=i.rarities[t.rarity],l=t.type==="item"?e[t.id]??0:1,c=t.type==="item"||t.type==="gif"?t.text:"a look for the whole app",d=t.type==="item"?` <b class="inv-count">×${l}<span class="inv-cap"> / ${I}</span></b>`:"";return`<div class="inv-row" style="--rarity:${v(n?.color??"#94a3b8")}">
        <span class="inv-face">${_(t)}</span>
        <span class="inv-body">
          <span class="inv-name">${p(t.name)}${d}</span>
          <span class="glosses">${p(c)}</span>
        </span>
        <span class="inv-rarity">${p(n?.label??"")}</span>
      </div>`}).join("")}function se(a,i,s,r,e){const o=a.querySelector("#prize-grid");if(i.prizes.length===0){o.innerHTML='<div class="glosses">Nothing to collect yet.</div>';return}const t=b();o.innerHTML=i.prizes.map(n=>{const l=s.has(n.id),c=i.rarities[n.rarity],d=n.type==="skin"&&r===n.id;return`<button class="prize${l?"":" locked"}${d?" worn":""}"
          data-id="${v(n.id)}" style="--rarity:${v(c?.color??"#94a3b8")}"
          ${t||l&&n.type==="skin"?"":"disabled"}>
        ${l||t?_(n):'<span class="prize-locked">?</span>'}
        <span class="prize-name">${l||t?p(n.name):"&nbsp;"}</span>
        <span class="prize-rarity">${t||i.draw==="rarity"?p(c?.label??""):l?"&nbsp;":"locked"}</span>
        ${d?'<span class="prize-worn">worn</span>':""}
        ${t?'<span class="prize-edit">✎</span>':""}
      </button>`}).join("");for(const n of o.querySelectorAll(".prize[data-id]"))n.addEventListener("click",async()=>{const l=n.dataset.id,c=i.prizes.find(d=>d.id===l);if(t&&c){ne(a,i,c,r,e);return}await C(r===l?null:l),await O(),e()})}async function ne(a,i,s,r,e){const o=await X();a.querySelector(".rc-scrim")?.remove();const t=document.createElement("div");t.className="rc-scrim",t.innerHTML=`
    <div class="rc-pop card-panel" role="dialog" aria-modal="true">
      <div class="rc-pop-head">
        <b>Edit: ${p(s.id)}</b>
        <button class="rc-close ghost" aria-label="Close">✕</button>
      </div>
      <label class="pe-field">Name
        <input id="pe-name" value="${v(s.name)}" autocomplete="off" />
      </label>
      ${s.type==="gif"||s.type==="item"?`<label class="pe-field">${s.type==="gif"?"Caption":"Text"}
              <textarea id="pe-text" rows="2">${p(s.text)}</textarea>
            </label>`:""}
      ${s.type==="gif"?`<label class="pe-field">Shows on
              <select id="pe-on">
                <option value="correct" ${s.on==="correct"?"selected":""}>right answers</option>
                <option value="wrong" ${s.on==="wrong"?"selected":""}>wrong answers</option>
              </select>
            </label>`:""}
      <label class="pe-field">Rarity
        <select id="pe-rarity">
          ${Object.entries(i.rarities).map(([c,d])=>`<option value="${v(c)}" ${c===s.rarity?"selected":""}>${p(d.label)}</option>`).join("")}
        </select>
      </label>
      <div class="row-actions" style="margin-top:10px">
        ${o?'<button id="pe-publish">Publish to everyone</button>':""}
        <button id="pe-save" class="${o?"secondary":""}">Save on this device</button>
        <button id="pe-clear" class="secondary">Clear</button>
        ${s.type==="skin"?`<button id="pe-wear" class="secondary">${r===s.id?"Take off":"Wear"}</button>`:""}
      </div>
      <div class="glosses" id="pe-msg" style="margin-top:8px">${o?"Publish applies it for every device, as your signed-in account. Save keeps it here only.":"Saved on this device. prizes.json on GitHub is the source for everyone else."}</div>
    </div>`,a.appendChild(t);const n=()=>t.remove();t.addEventListener("click",c=>{c.target===t&&n()}),t.querySelector(".rc-close").addEventListener("click",n);const l=()=>{const c=t.querySelector("#pe-name")?.value.trim(),d=t.querySelector("#pe-text")?.value.trim(),y=t.querySelector("#pe-rarity")?.value,f=t.querySelector("#pe-on")?.value;return{...c?{name:c}:{},...d&&(s.type==="gif"||s.type==="item")?{text:d}:{},...y?{rarity:y}:{},...s.type==="gif"&&(f==="correct"||f==="wrong")?{on:f}:{}}};t.querySelector("#pe-save").addEventListener("click",async()=>{await k(s.id,l()),s.type==="gif"&&w(),n(),e()}),t.querySelector("#pe-publish")?.addEventListener("click",async()=>{const c=t.querySelector("#pe-msg");c.textContent="Publishing…";const d=await T(s.id,l());if(d==="ok"){await k(s.id,null),s.type==="gif"&&w(),n(),e();return}c.textContent=d==="signedout"?"Sign in first (Settings → Account); publishing rides your account.":d==="denied"?"A different account holds the publisher seat.":"Couldn't reach the server."}),t.querySelector("#pe-clear").addEventListener("click",async()=>{await k(s.id,null),o&&T(s.id,null),s.type==="gif"&&w(),n(),e()}),t.querySelector("#pe-wear")?.addEventListener("click",async()=>{await C(r===s.id?null:s.id),await O(),n(),e()})}function _(a){return a.type==="item"?`<span class="prize-item">${p(a.icon)}</span>`:a.type==="skin"?`<span class="prize-swatch" style="background:${v(a.vars["--bg"]??"#000")};
      border-color:${v(a.vars["--accent"]??"#fff")}">
      <i style="background:${v(a.vars["--accent"]??"#fff")}"></i>
      <i style="background:${v(a.vars["--panel-2"]??"#333")}"></i>
    </span>`:`<img class="prize-gif" src="${v(Q(a.image))}" alt="" loading="lazy" />`}async function M(a,i,s){if(g)return;g=!0;const r=a.querySelector("#gacha-open");r&&(r.disabled=!0);try{await ae(a,i,s)}finally{g=!1}}async function ae(a,i,s){const r=b();if(!r&&!await F(i.cost)){S("Not enough yennies.","error");return}const e=Z(i);if(!e){r||await x(i.cost),S("No prizes are configured.","error");return}let o=await U(e.id);e.type==="item"&&(o=await W(e.id)!==null),o&&e.type==="gif"&&w();const t=o||r?0:Math.round(i.cost*i.duplicateRefund);t>0&&await x(t);const n=a.querySelector("#gacha-stage");n.innerHTML=`
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div id="gacha-roll"></div>
    </div>
  `;const l=n.querySelector("#gacha-scene");l.scrollIntoView({behavior:"smooth",block:"center"});const{playCutscene:c}=await m(async()=>{const{playCutscene:u}=await import("./gacha-scene-DtWv1Tj3.js").then(h=>h.g);return{playCutscene:u}},__vite__mapDeps([0,1,2,3,4]),import.meta.url),{runRoll:d}=await m(async()=>{const{runRoll:u}=await import("./gacha-roll-PtFkHMTq.js");return{runRoll:u}},__vite__mapDeps([5,6,1,2,3,4]),import.meta.url);m(()=>import("./index-CGRRECQs.js").then(u=>u.C),__vite__mapDeps([7,8,1,2,9,3,4,10,11]),import.meta.url).then(u=>u.unlockAchievement("first-pull"));const y=n.querySelector("#gacha-roll");let f=Promise.resolve();const $=c(l,{lines:P(i),onOpen:u=>{y.style.setProperty("--from-x",`${(u.x*100).toFixed(1)}%`),y.style.setProperty("--from-y",`${(u.y*100).toFixed(1)}%`),y.classList.add("over-scene"),f=d(y,e,i)}});if($.id.then(u=>{const h=n.querySelector("#scene-caption");h&&u&&(h.textContent=L(i,u))}),await $.done,await f,$.stop(),!s()||!n.isConnected)return;const q=i.rarities[e.rarity];n.innerHTML=`
    <div class="card-panel gacha-won" style="--rarity:${v(q?.color??"#94a3b8")}">
      <div class="won-rarity">${i.draw==="uniform"?"New reaction":p(q?.label??"")}</div>
      <div class="won-face">${_(e)}</div>
      <div class="won-name">${p(e.name)}</div>
      ${e.note?`<div class="glosses">${p(e.note)}</div>`:""}
      <div class="msg">${o?e.type==="skin"?"A new skin. Tap it in your collection to wear it.":e.type==="item"?"Into the inventory.":"A new reaction. It will turn up in the drills from now on.":e.type==="item"?`You can only carry ${I} — ${t.toLocaleString()} ¥ back.`:`Already yours — ${t.toLocaleString()} ¥ back.`}</div>
      <div class="row-actions" style="justify-content:center;margin-top:12px">
        <button id="gacha-again">Open another</button>
        <button id="gacha-done" class="secondary">Done</button>
      </div>
    </div>
  `;const E=n.querySelector("#gacha-again");E.addEventListener("click",async()=>{if(g)return;const u=await A();if(!b()&&u<i.cost){S("Not enough yennies.","error");return}E.disabled=!0,M(a,i,s)}),n.querySelector("#gacha-done").addEventListener("click",()=>void R(a,s))}function p(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function v(a){return p(a).replace(/'/g,"&#39;")}export{R as renderGacha};
