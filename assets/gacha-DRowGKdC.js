const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./gacha-scene-DFBz1RYy.js","./cloud-BuPD2oGo.js","./accounts-WZN5CFdX.js","./store-N04W-om1.js","./card-DsqtbGFJ.js","./gacha-audio-fG1ZURVx.js","./door-keys-D0_KGJ7H.js","./gacha-roll-DKLw5n5G.js","./gacha-data-B74dNing.js","./unlock-B9fOAItM.js","./index-Dx2Zjubn.js","./modulepreload-polyfill-B5Qt9EMX.js","./feedback-B51RI4L2.js","./media-DYzEgu4n.js","./profile-Y4JJx_-_.js","./index-BU38kawt.css"])))=>i.map(i=>d[i]);
import{_ as k}from"./cloud-BuPD2oGo.js";import{y as N,l as F,s as Y,f as W,h as B,i as L,g as G,e as R}from"./feedback-B51RI4L2.js";import{t as T}from"./accounts-WZN5CFdX.js";import{owned as U,equippedSkin as z,equipSkin as H,itemCounts as J,ITEM_LIMIT as M,addOwned as Q,addItem as X}from"./gacha-collection-7pa3EGv8.js";import{prizeTable as Z,rarityOdds as ee,cutsceneTitle as I,cutsceneLines as D,prizeImageUrl as te,publishAvailable as ne,setPrizeOverride as A,publishPrizeOverride as C,drawPrize as se}from"./gacha-data-B74dNing.js";import{applySkin as j}from"./skins-D-9h-pRe.js";import{a as ae,u as _}from"./unlock-B9fOAItM.js";import"./store-N04W-om1.js";import"./card-DsqtbGFJ.js";async function K(a,i=()=>!0){const[t,p,e,c,n]=await Promise.all([N(),F(),Z(),U(),z(),ae()]);if(!i())return;const s=_(),u=s||t>=e.cost;a.innerHTML=`
    ${Y("Gacha")}

    <div class="card-panel purse-panel">
      <div class="purse-amount">${W(t)}</div>
      <div class="glosses">Yennies</div>
      <div class="row-actions" style="justify-content:center;margin-top:14px">
        <button id="gacha-open" ${u&&e.prizes.length>0?"":"disabled"}>
          Open a crate · ${s?"free":`${e.cost.toLocaleString()} ¥`}
        </button>
        <button id="gacha-open3" class="secondary" ${(s||t>=e.cost*3)&&e.prizes.length>0?"":"disabled"}>
          ×3${s?"":` · ${(e.cost*3).toLocaleString()} ¥`}
        </button>
        <button id="gacha-open5" class="secondary" ${(s||t>=e.cost*5)&&e.prizes.length>0?"":"disabled"}>
          ×5${s?"":` · ${(e.cost*5).toLocaleString()} ¥`}
        </button>
      </div>
      ${e.prizes.length===0?'<div class="msg">No prizes are configured.</div>':s?'<div class="msg">Admin: pulls are free and cost you nothing.</div>':u?"":`<div class="msg">${(e.cost-t).toLocaleString()} ¥ to go.</div>`}
    </div>

    <div id="gacha-stage"></div>

    <div class="card-panel">
      <b>Collection</b>
      <div class="glosses">${c.size} of ${e.prizes.length}</div>
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
             </div>`:ee(e).map(({info:o,chance:l})=>`<div class="purse-source">
                  <span style="color:${f(o.color)}">${y(o.label)}</span>
                  <span class="purse-rate">${(l*100).toFixed(1)}%</span>
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
        <span>Reaching level ${p.level+1}</span>
        <span class="purse-rate">${B(p.level+1).toLocaleString()} ¥</span>
      </div>
    </div>

    ${s?'<div class="card-panel" id="cutscene-list"></div>':""}
  `,k(()=>import("./gacha-scene-DFBz1RYy.js").then(o=>o.g),__vite__mapDeps([0,1,2,3,4,5]),import.meta.url).then(o=>o.warmUpCutscene()).catch(()=>{}),s&&ie(a,e,i),le(a,e,c,n,()=>void K(a,i)),await ce(a,e,c);for(const[o,l]of[["gacha-open",1],["gacha-open3",3],["gacha-open5",5]]){const g=a.querySelector(`#${o}`);g&&(g.disabled=g.disabled||w,g.addEventListener("click",()=>{w||V(a,e,i,l)}))}}let w=!1;async function ie(a,i,t){const p=a.querySelector("#cutscene-list");if(!p)return;const{SCENARIOS:e}=await k(async()=>{const{SCENARIOS:c}=await import("./gacha-scene-DFBz1RYy.js").then(n=>n.g);return{SCENARIOS:c}},__vite__mapDeps([0,1,2,3,4,5]),import.meta.url);if(!(!t()||!p.isConnected)){p.innerHTML=`
    <b>Cutscenes</b>
    <div class="glosses">Admin: play any of them, without a crate.</div>
    <div class="gram-levels" id="cutscene-chips">
      ${e.map(c=>`<button class="gram-level-chip" data-id="${f(c.id)}">
          ${y(I(i,c.id))}
          <span class="gram-level-count">${y(c.id)} · ${c.seconds}s</span>
        </button>`).join("")}
    </div>
  `;for(const c of p.querySelectorAll("#cutscene-chips button"))c.addEventListener("click",()=>void oe(a,i,c.dataset.id,t))}}async function oe(a,i,t,p){if(w)return;w=!0;const e=a.querySelector("#gacha-stage");e.innerHTML=`
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div class="row-actions" style="justify-content:center;margin-top:10px">
        <button id="preview-stop" class="secondary">Stop</button>
      </div>
    </div>
  `;const c=e.querySelector("#gacha-scene");c.scrollIntoView({behavior:"smooth",block:"center"});const{playCutscene:n}=await k(async()=>{const{playCutscene:u}=await import("./gacha-scene-DFBz1RYy.js").then(o=>o.g);return{playCutscene:u}},__vite__mapDeps([0,1,2,3,4,5]),import.meta.url),s=n(c,{lines:D(i),scenario:t});s.id.then(u=>{const o=e.querySelector("#scene-caption");o&&u&&(o.textContent=I(i,u))}),e.querySelector("#preview-stop").addEventListener("click",()=>s.stop());try{await s.done}finally{s.stop(),w=!1}!p()||!e.isConnected||(e.innerHTML="")}const re={hiragana:{name:"Hiragana key",note:"Won at the hiragana exam. It fits something, somewhere."},katakana:{name:"Katakana key",note:"Won at the katakana exam. It fits something, somewhere."},grammar:{name:"Grammar key",note:"Earned from the grammar course. It fits something, somewhere."}};async function ce(a,i,t){const p=a.querySelector("#gacha-inventory");if(!p)return;const e=await J(),{heldDoorKeys:c,insertedDoorKeys:n}=await k(async()=>{const{heldDoorKeys:r,insertedDoorKeys:m}=await import("./door-keys-D0_KGJ7H.js");return{heldDoorKeys:r,insertedDoorKeys:m}},__vite__mapDeps([6,2]),import.meta.url),[s,u]=await Promise.all([c(),n()]),o=i.prizes.filter(r=>r.type==="item"?(e[r.id]??0)>0:t.has(r.id));if(o.length===0&&s.length===0){p.innerHTML='<div class="glosses">Nothing yet. Open a crate.</div>';return}const l=r=>{const m=re[r]??{name:"A strange key",note:"It fits something, somewhere."},h=u.includes(r);return`<div class="inv-row" style="--rarity:#e8b24c">
      <span class="inv-face">🗝️</span>
      <span class="inv-body">
        <span class="inv-name">${y(m.name)}</span>
        <span class="glosses">${y(h?"Turned in its lock. It stays turned.":m.note)}</span>
      </span>
      <span class="inv-rarity">key item</span>
    </div>`},g=r=>{const m=i.rarities[r.rarity],h=r.type==="item"?e[r.id]??0:1,S=r.type==="item"||r.type==="gif"?r.text:"a look for the whole app",q=r.type==="item"?` <b class="inv-count">×${h}<span class="inv-cap"> / ${M}</span></b>`:"";return`<div class="inv-row" style="--rarity:${f(m?.color??"#94a3b8")}">
      <span class="inv-face">${E(r)}</span>
      <span class="inv-body">
        <span class="inv-name">${y(r.name)}${q}</span>
        <span class="glosses">${y(S)}</span>
      </span>
      <span class="inv-rarity">${y(m?.label??"")}</span>
    </div>`},b=[["🎞","Reactions",o.filter(r=>r.type==="gif").map(g)],["🎨","Skins",o.filter(r=>r.type==="skin").map(g)],["🗝","Key items",[...s.map(l),...o.filter(r=>r.type==="item").map(g)]]];p.innerHTML=b.filter(([,,r])=>r.length>0).map(([r,m,h])=>`<div class="inv-section">
        <div class="inv-section-head">${r} <b>${m}</b> <span class="glosses">${h.length}</span></div>
        ${h.join("")}
      </div>`).join("")}function le(a,i,t,p,e){const c=a.querySelector("#prize-grid");if(i.prizes.length===0){c.innerHTML='<div class="glosses">Nothing to collect yet.</div>';return}const n=_();c.innerHTML=i.prizes.map(s=>{const u=t.has(s.id),o=i.rarities[s.rarity],l=s.type==="skin"&&p===s.id;return`<button class="prize${u?"":" locked"}${l?" worn":""}"
          data-id="${f(s.id)}" style="--rarity:${f(o?.color??"#94a3b8")}"
          ${n||u&&s.type==="skin"?"":"disabled"}>
        ${u||n?E(s):'<span class="prize-locked">?</span>'}
        <span class="prize-name">${u||n?y(s.name):"&nbsp;"}</span>
        <span class="prize-rarity">${n||i.draw==="rarity"?y(o?.label??""):u?"&nbsp;":"locked"}</span>
        ${l?'<span class="prize-worn">worn</span>':""}
        ${n?'<span class="prize-edit">✎</span>':""}
      </button>`}).join("");for(const s of c.querySelectorAll(".prize[data-id]"))s.addEventListener("click",async()=>{const u=s.dataset.id,o=i.prizes.find(l=>l.id===u);if(n&&o){de(a,i,o,p,e);return}await H(p===u?null:u),await j(),e()})}async function de(a,i,t,p,e){const c=await ne();a.querySelector(".rc-scrim")?.remove();const n=document.createElement("div");n.className="rc-scrim",n.innerHTML=`
    <div class="rc-pop card-panel" role="dialog" aria-modal="true">
      <div class="rc-pop-head">
        <b>Edit: ${y(t.id)}</b>
        <button class="rc-close ghost" aria-label="Close">✕</button>
      </div>
      <label class="pe-field">Name
        <input id="pe-name" value="${f(t.name)}" autocomplete="off" />
      </label>
      ${t.type==="gif"||t.type==="item"?`<label class="pe-field">${t.type==="gif"?"Caption":"Text"}
              <textarea id="pe-text" rows="2">${y(t.text)}</textarea>
            </label>`:""}
      ${t.type==="gif"?`<label class="pe-field">Shows on
              <select id="pe-on">
                <option value="correct" ${t.on==="correct"?"selected":""}>right answers</option>
                <option value="wrong" ${t.on==="wrong"?"selected":""}>wrong answers</option>
              </select>
            </label>`:""}
      <label class="pe-field pe-check">
        <input type="checkbox" id="pe-restricted" ${t.restricted?"checked":""} />
        Admin only: hidden from everyone until an account is granted it in the admin panel
      </label>
      <label class="pe-field">Rarity
        <select id="pe-rarity">
          ${Object.entries(i.rarities).map(([o,l])=>`<option value="${f(o)}" ${o===t.rarity?"selected":""}>${y(l.label)}</option>`).join("")}
        </select>
      </label>
      <div class="row-actions" style="margin-top:10px">
        ${c?'<button id="pe-publish">Publish to everyone</button>':""}
        <button id="pe-save" class="${c?"secondary":""}">Save on this device</button>
        <button id="pe-clear" class="secondary">Clear</button>
        ${t.type==="skin"?`<button id="pe-wear" class="secondary">${p===t.id?"Take off":"Wear"}</button>`:""}
      </div>
      <div class="glosses" id="pe-msg" style="margin-top:8px">${c?"Publish applies it for every device, as your signed-in account. Save keeps it here only.":"Saved on this device. prizes.json on GitHub is the source for everyone else."}</div>
    </div>`,a.appendChild(n);const s=()=>n.remove();n.addEventListener("click",o=>{o.target===n&&s()}),n.querySelector(".rc-close").addEventListener("click",s);const u=()=>{const o=n.querySelector("#pe-name")?.value.trim(),l=n.querySelector("#pe-text")?.value.trim(),g=n.querySelector("#pe-rarity")?.value,b=n.querySelector("#pe-on")?.value,r=n.querySelector("#pe-restricted")?.checked;return{...o?{name:o}:{},...l&&(t.type==="gif"||t.type==="item")?{text:l}:{},...g?{rarity:g}:{},...t.type==="gif"&&(b==="correct"||b==="wrong")?{on:b}:{},...r?{restricted:!0}:{}}};n.querySelector("#pe-save").addEventListener("click",async()=>{await A(t.id,u()),t.type==="gif"&&L(),s(),e()}),n.querySelector("#pe-publish")?.addEventListener("click",async()=>{const o=n.querySelector("#pe-msg");o.textContent="Publishing…";const l=await C(t.id,u());if(l==="ok"){await A(t.id,null),t.type==="gif"&&L(),s(),e();return}o.textContent=l==="signedout"?"Sign in first (Settings → Account); publishing rides your account.":l==="denied"?"A different account holds the publisher seat.":"Couldn't reach the server."}),n.querySelector("#pe-clear").addEventListener("click",async()=>{await A(t.id,null),c&&C(t.id,null),t.type==="gif"&&L(),s(),e()}),n.querySelector("#pe-wear")?.addEventListener("click",async()=>{await H(p===t.id?null:t.id),await j(),s(),e()})}function E(a){return a.type==="item"?`<span class="prize-item">${y(a.icon)}</span>`:a.type==="skin"?`<span class="prize-swatch" style="background:${f(a.vars["--bg"]??"#000")};
      border-color:${f(a.vars["--accent"]??"#fff")}">
      <i style="background:${f(a.vars["--accent"]??"#fff")}"></i>
      <i style="background:${f(a.vars["--panel-2"]??"#333")}"></i>
    </span>`:`<img class="prize-gif" src="${f(te(a.image))}" alt="" loading="lazy" />`}async function V(a,i,t,p=1){if(w)return;w=!0;const e=a.querySelector("#gacha-open");e&&(e.disabled=!0);try{await pe(a,i,t,p)}finally{w=!1}}async function pe(a,i,t,p=1){const e=_(),c=i.cost*p;if(!e&&!await G(c)){T("Not enough yennies.","error");return}const n=[];for(let d=0;d<p;d++){const v=se(i);if(!v)break;let $=await Q(v.id);v.type==="item"&&($=await X(v.id)!==null),$&&v.type==="gif"&&L();const x=$||e?0:Math.round(i.cost*i.duplicateRefund);x>0&&await R(x),n.push({prize:v,isNew:$,refund:x})}if(n.length===0){e||await R(c),T("No prizes are configured.","error");return}const{prize:s,isNew:u,refund:o}=n[0],l=a.querySelector("#gacha-stage");l.innerHTML=`
    <div class="card-panel gacha-stage">
      <div class="scene" id="gacha-scene">
        <div class="scene-caption" id="scene-caption"></div>
      </div>
      <div id="gacha-roll"></div>
    </div>
  `;const g=l.querySelector("#gacha-scene");g.scrollIntoView({behavior:"smooth",block:"center"});const{playCutscene:b}=await k(async()=>{const{playCutscene:d}=await import("./gacha-scene-DFBz1RYy.js").then(v=>v.g);return{playCutscene:d}},__vite__mapDeps([0,1,2,3,4,5]),import.meta.url),{runRoll:r}=await k(async()=>{const{runRoll:d}=await import("./gacha-roll-DKLw5n5G.js");return{runRoll:d}},__vite__mapDeps([7,8,1,2,3,4,9]),import.meta.url);k(()=>import("./index-Dx2Zjubn.js").then(d=>d.E),__vite__mapDeps([10,11,1,2,12,3,4,13,9,14,15]),import.meta.url).then(d=>d.unlockAchievement("first-pull"));const m=l.querySelector("#gacha-roll");let h=Promise.resolve();const S=b(g,{lines:D(i),onOpen:d=>{m.style.setProperty("--from-x",`${(d.x*100).toFixed(1)}%`),m.style.setProperty("--from-y",`${(d.y*100).toFixed(1)}%`),m.classList.add(n.length===1?"over-scene":"under-scene"),h=r(m,n.map(v=>v.prize),i)}});if(S.id.then(d=>{const v=l.querySelector("#scene-caption");v&&d&&(v.textContent=I(i,d))}),await S.done,await h,S.stop(),!t()||!l.isConnected)return;const q=d=>d.isNew?d.prize.type==="skin"?"A new skin. Tap it in your collection to wear it.":d.prize.type==="item"?"Into the inventory.":"A new reaction. It will turn up in the drills from now on.":d.prize.type==="item"?`You can only carry ${M} — ${d.refund.toLocaleString()} ¥ back.`:`Already yours — ${d.refund.toLocaleString()} ¥ back.`,O=i.rarities[s.rarity];if(n.length===1)l.innerHTML=`
      <div class="card-panel gacha-won" style="--rarity:${f(O?.color??"#94a3b8")}">
        <div class="won-rarity">${i.draw==="uniform"?"New reaction":y(O?.label??"")}</div>
        <div class="won-face">${E(s)}</div>
        <div class="won-name">${y(s.name)}</div>
        ${s.note?`<div class="glosses">${y(s.note)}</div>`:""}
        <div class="msg">${q(n[0])}</div>
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="gacha-again">Open another</button>
          <button id="gacha-done" class="secondary">Done</button>
        </div>
      </div>
    `;else{const d=n.reduce((v,$)=>v+$.refund,0);l.innerHTML=`
      <div class="card-panel gacha-won gacha-won-multi">
        <div class="won-rarity">${n.length} crates</div>
        <div class="won-multi-grid">
          ${n.map(v=>{const $=i.rarities[v.prize.rarity];return`<div class="won-multi-cell" style="--rarity:${f($?.color??"#94a3b8")}">
                <div class="won-face">${E(v.prize)}</div>
                <div class="won-name">${y(v.prize.name)}</div>
                <div class="glosses">${v.isNew?"new":v.prize.type==="item"&&v.refund===0?"another one":`dupe · +${v.refund.toLocaleString()} ¥`}</div>
              </div>`}).join("")}
        </div>
        ${d>0?`<div class="msg">${d.toLocaleString()} ¥ back for duplicates.</div>`:""}
        <div class="row-actions" style="justify-content:center;margin-top:12px">
          <button id="gacha-again">Open ×${n.length} again</button>
          <button id="gacha-done" class="secondary">Done</button>
        </div>
      </div>
    `}const P=l.querySelector("#gacha-again");P.addEventListener("click",async()=>{if(w)return;const d=await N();if(!_()&&d<i.cost*n.length){T("Not enough yennies.","error");return}P.disabled=!0,V(a,i,t,n.length)}),l.querySelector("#gacha-done").addEventListener("click",()=>void K(a,t))}function y(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function f(a){return y(a).replace(/'/g,"&#39;")}export{K as renderGacha};
