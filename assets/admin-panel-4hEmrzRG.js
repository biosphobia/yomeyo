import{f as B}from"./cloud-BuPD2oGo.js";import{j as _,f as ee,X as te,b as se}from"./feedback-B51RI4L2.js";import{B as k,C as I}from"./index-Dx2Zjubn.js";import{fullPrizeList as ae}from"./gacha-data-B74dNing.js";import"./accounts-WZN5CFdX.js";import"./store-N04W-om1.js";import"./card-DsqtbGFJ.js";import"./modulepreload-polyfill-B5Qt9EMX.js";import"./media-DYzEgu4n.js";import"./unlock-B9fOAItM.js";import"./profile-Y4JJx_-_.js";const b=s=>typeof s=="number"&&Number.isFinite(s)?s:0,x=s=>!!s&&typeof s=="object"&&!Array.isArray(s);function ne(s){const c=s.questLog;if(!x(c))return{};const r={};for(const[a,m]of Object.entries(c))if(x(m)){r[a]={};for(const[y,g]of Object.entries(m))r[a][y]=b(g)}return r}function oe(s){return typeof s.questStart=="string"&&s.questStart?s.questStart:k()}function X(s,c,r){const a=I(s,c);if(a.quests.length===0)return!0;const m=r[s]??{};return a.quests.every(y=>(m[y.event]??0)>=y.goal)}function re(s,c){let r=0;const a=new Date;X(k(a),s,c)||a.setDate(a.getDate()-1);let m=0;for(;k(a)>=s&&X(k(a),s,c)&&m++<3660;)r++,a.setDate(a.getDate()-1);return r}async function de(s){const{db:c,storeApi:r}=await B(),a=await r.getDoc(r.doc(c,"users",s)),m=(a.exists?.()?a.data?.():null)??{};return x(m.progress)?m.progress:{}}async function z(s,c){const{db:r,storeApi:a}=await B();await a.setDoc(a.doc(r,"users",s),{progress:c},{merge:!0})}async function ie(){const{db:s,storeApi:c}=await B(),r=new Set,a=new Map,m=new Map;(await c.getDocs(c.collection(s,"users"))).forEach(o=>{r.add(o.id);const t=o.data?.()??{};x(t.progress)&&m.set(o.id,t.progress)}),await c.getDocs(c.collection(s,"profiles")).then(o=>{o.forEach(t=>{r.add(t.id);const d=String(t.data?.()?.name??"");d&&a.set(t.id,d)})}).catch(()=>{});const g=[...r].map(o=>{const t=b(m.get(o)?.xpTotal);return{uid:o,name:a.get(o)||"(no username)",level:_(t).level,xp:t}});return g.sort((o,t)=>t.xp-o.xp||o.name.localeCompare(t.name)),g}function H(s,c,r,a){const m=a[c]??{},y=x(s.questXpAwarded)?{...s.questXpAwarded}:{},g=new Set(Array.isArray(y[c])?y[c].map(String):[]);let o=0;for(const d of r.quests)g.has(d.id)||(m[d.event]??0)<d.goal||(g.add(d.id),o+=te);return r.quests.length>0&&r.quests.every(d=>(m[d.event]??0)>=d.goal)&&!g.has("day!")&&(g.add("day!"),o+=se),o===0?{}:(y[c]=[...g].sort(),{questXpAwarded:y,xpTotal:b(s.xpTotal)+o})}async function $e(s){s.innerHTML=`
    <div class="card-panel">
      <b>👑 Admin</b>
      <div class="msg">Open an account, repair its calendar, curate its gacha. Only this account can see this.
        Every account the cloud knows is listed, highest level first; accounts that never signed in
        live only on their own devices and cannot appear here.</div>
      <div class="row-actions">
        <input type="search" id="adm-search" placeholder="Search users…" style="flex:1" />
        <button id="adm-load" class="secondary">Load users</button>
      </div>
      <div id="adm-users"></div>
      <div id="adm-user"></div>
    </div>
  `;const c=s.querySelector("#adm-search"),r=s.querySelector("#adm-users"),a=s.querySelector("#adm-user");let m=[];const y=()=>{const o=c.value.trim().toLowerCase(),t=m.filter(d=>!o||d.name.toLowerCase().includes(o)||d.uid.toLowerCase().includes(o));r.innerHTML=t.length===0?`<div class="glosses">${m.length===0?"":"No user matches."}</div>`:t.map(d=>`<button class="adm-user-row" data-uid="${L(d.uid)}">
                <b>@${p(d.name)}</b>
                <span class="level-chip">Lv ${d.level}</span>
                <span class="glosses">${p(d.uid.slice(0,10))}…</span>
              </button>`).join("");for(const d of r.querySelectorAll("[data-uid]"))d.addEventListener("click",()=>void g(d.dataset.uid))};s.querySelector("#adm-load").addEventListener("click",()=>{r.innerHTML='<div class="glosses">Reading…</div>',ie().then(o=>{m=o,y()},o=>{r.innerHTML=`<div class="msg error">${p(o instanceof Error?o.message:String(o))} — are the newest Firestore rules deployed?</div>`})}),c.addEventListener("input",y);async function g(o){a.innerHTML='<div class="glosses">Opening…</div>';let t;try{t=await de(o)}catch(f){a.innerHTML=`<div class="msg error">${p(f instanceof Error?f.message:String(f))}</div>`;return}const d=m.find(f=>f.uid===o)?.name??o;let u=k();const T=()=>{const f=ne(t),j=oe(t),C=_(b(t.xpTotal)),Y=x(t.achievements)?Object.entries(t.achievements):[],G=x(t.gachaItems)?Object.entries(t.gachaItems):[],J=Array.isArray(t.gachaOwned)?t.gachaOwned.length:0;a.innerHTML=`
        <div class="adm-head">
          <b>@${p(d)}</b>
          <span class="glosses">${p(o)}</span>
        </div>
        <div class="adm-facts">
          <span>Lv ${C.level} · ${C.total.toLocaleString()} XP</span>
          <span>${ee(b(t.yennies))}</span>
          <span>🔥 ${re(j,f)}-day streak</span>
          <span>best kana streak ${b(t.kanaBestStreak)}</span>
          <span>journey since ${p(j)}</span>
          <span>${J} gacha pulls owned</span>
          ${G.map(([e,n])=>`<span>${p(e)} ×${b(n)}</span>`).join("")}
          ${Y.map(([e,n])=>`<span>🏆 ${p(e)} · ${new Date(b(n)).toLocaleDateString()}</span>`).join("")}
        </div>

        <div class="adm-grants row-actions">
          <input type="number" id="adm-grant-n" value="100" style="width:90px" />
          <button id="adm-grant-xp" class="secondary">＋ XP</button>
          <button id="adm-grant-yen" class="secondary">＋ yennies</button>
        </div>

        <div class="adm-section"><b>Calendar</b></div>
        <div class="row-actions adm-dayrow">
          <button id="adm-prev" class="secondary">‹</button>
          <input type="date" id="adm-date" value="${L(u)}" />
          <button id="adm-next" class="secondary">›</button>
        </div>
        <div id="adm-day"></div>

        <div class="adm-section"><b>Gacha visibility</b></div>
        <div class="glosses">Unticked prizes vanish from this account's table: not shown, not drawable.</div>
        <div id="adm-prizes" class="adm-prizes"><div class="glosses">Loading prizes…</div></div>
        <div id="adm-granted-wrap" style="display:none">
          <div class="adm-section"><b>Admin-only prizes</b></div>
          <div class="glosses">Hidden from every account by default. Ticked = this account has it in its pool, on all its devices.</div>
          <div id="adm-granted" class="adm-prizes"></div>
        </div>
        <div class="msg" id="adm-msg"></div>
      `;const K=a.querySelector("#adm-msg"),E=e=>{K.textContent=e},$=async(e,n)=>{try{await z(o,e),t={...t,...e},T(),a.querySelector("#adm-msg").textContent=n}catch(i){E(i instanceof Error?i.message:String(i))}},N=()=>Math.max(0,Math.floor(Number(a.querySelector("#adm-grant-n").value)||0));a.querySelector("#adm-grant-xp").addEventListener("click",()=>{const e=N();e>0&&$({xpTotal:b(t.xpTotal)+e},`+${e} XP.`)}),a.querySelector("#adm-grant-yen").addEventListener("click",()=>{const e=N();e>0&&$({yennies:b(t.yennies)+e},`+${e} ¥.`)});const O=a.querySelector("#adm-date"),U=e=>{const[n,i,v]=u.split("-").map(Number);u=k(new Date(n,i-1,v+e)),T()};a.querySelector("#adm-prev").addEventListener("click",()=>U(-1)),a.querySelector("#adm-next").addEventListener("click",()=>U(1)),O.addEventListener("change",()=>{O.value&&(u=O.value,T())});const A=(e,n={})=>({questLog:e,questLogRev:b(t.questLogRev)+1,...n}),q=a.querySelector("#adm-day"),h=I(u,j),F=f[u]??{},Q=new Set(h.quests.map(e=>e.event)),W=Object.entries(F).filter(([e])=>!Q.has(e)),V=X(u,j,f);q.innerHTML=`
        ${h.beforeJourney?`<div class="glosses">Before this account's journey began; cleared by grace.</div>`:""}
        ${h.milestone?`<div class="glosses">🏁 ${p(h.milestone)}</div>`:""}
        ${h.quests.map((e,n)=>{const i=F[e.event]??0;return`<div class="adm-quest">
              <span class="adm-quest-name">${i>=e.goal?"✅":"⬜"} ${p(e.title)}</span>
              <input type="number" min="0" data-ev="${L(e.event)}" value="${i}" />
              <span class="glosses">/ ${e.goal}</span>
              <button class="secondary" data-doq="${n}">Done</button>
              <button class="secondary" data-clearq="${n}">0</button>
            </div>`}).join("")}
        ${W.map(([e,n])=>`<div class="adm-quest">
              <span class="adm-quest-name glosses">${p(e)}</span>
              <input type="number" min="0" data-ev="${L(e)}" value="${n}" />
              <button class="secondary" data-delev="${L(e)}">✕</button>
            </div>`).join("")}
        <div class="row-actions">
          <button id="adm-day-complete" class="secondary">${V?"Day is complete ✓":"Complete whole day"}</button>
          <button id="adm-day-save" class="secondary">Save counts</button>
          <button id="adm-day-delete" class="secondary">Delete day</button>
        </div>
      `;const D=e=>{const n={...f,[u]:{...f[u]??{}}};return e(n[u]),Object.keys(n[u]).length===0&&delete n[u],n};for(const e of q.querySelectorAll("[data-doq]"))e.addEventListener("click",()=>{const n=h.quests[Number(e.dataset.doq)],i=D(v=>{v[n.event]=Math.max(v[n.event]??0,n.goal)});$(A(i,H(t,u,h,i)),`${n.title} marked done for ${u}.`)});for(const e of q.querySelectorAll("[data-clearq]"))e.addEventListener("click",()=>{const n=h.quests[Number(e.dataset.clearq)],i=D(v=>{delete v[n.event]});$(A(i),`${n.title} reset for ${u}.`)});for(const e of q.querySelectorAll("[data-delev]"))e.addEventListener("click",()=>{const n=e.dataset.delev,i=D(v=>{delete v[n]});$(A(i),`${n} removed from ${u}.`)});q.querySelector("#adm-day-complete").addEventListener("click",()=>{const e=D(n=>{for(const i of h.quests)n[i.event]=Math.max(n[i.event]??0,i.goal)});$(A(e,H(t,u,h,e)),`${u} marked complete; the streak follows.`)}),q.querySelector("#adm-day-save").addEventListener("click",()=>{const e=D(n=>{for(const i of q.querySelectorAll("[data-ev]")){const v=Math.max(0,Math.floor(Number(i.value)||0));v>0?n[i.dataset.ev]=v:delete n[i.dataset.ev]}});$(A(e,H(t,u,h,e)),`${u} saved.`)}),q.querySelector("#adm-day-delete").addEventListener("click",()=>{const e={...f};delete e[u],$(A(e),`${u} deleted.`)}),ae().then(e=>{const n=a.querySelector("#adm-prizes"),i=a.querySelector("#adm-granted-wrap"),v=a.querySelector("#adm-granted");if(!n||!i||!v)return;const M=new Set(Array.isArray(t.hiddenPrizes)?t.hiddenPrizes.map(String):[]),P=new Set(Array.isArray(t.grantedPrizes)?t.grantedPrizes.map(String):[]),Z=e.filter(l=>!l.restricted),R=e.filter(l=>l.restricted);n.innerHTML=Z.map(l=>`<label class="adm-prize">
              <input type="checkbox" data-prize="${L(l.id)}" ${M.has(l.id)?"":"checked"} />
              <span>${p(l.name)}</span>
              <span class="glosses">${p(l.rarity)}</span>
            </label>`).join("");for(const l of n.querySelectorAll("[data-prize]"))l.addEventListener("change",()=>{const w=l.dataset.prize;l.checked?M.delete(w):M.add(w),z(o,{hiddenPrizes:[...M].sort()}).then(()=>{t={...t,hiddenPrizes:[...M].sort()},E(`${w} is now ${l.checked?"visible":"hidden"} for @${d}.`)},S=>E(S instanceof Error?S.message:String(S)))});if(R.length!==0){i.style.display="",v.innerHTML=R.map(l=>`<label class="adm-prize">
              <input type="checkbox" data-grant="${L(l.id)}" ${P.has(l.id)?"checked":""} />
              <span>🔒 ${p(l.name)}</span>
              <span class="glosses">${p(l.rarity)}</span>
            </label>`).join("");for(const l of v.querySelectorAll("[data-grant]"))l.addEventListener("change",()=>{const w=l.dataset.grant;l.checked?P.add(w):P.delete(w),z(o,{grantedPrizes:[...P].sort()}).then(()=>{t={...t,grantedPrizes:[...P].sort()},E(l.checked?`${w} is now in @${d}'s pool, on every device.`:`${w} taken back out of @${d}'s pool.`)},S=>E(S instanceof Error?S.message:String(S)))})}})};T()}}function p(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function L(s){return p(s)}export{$e as mountAdminPanel};
