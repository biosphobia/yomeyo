const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./anki-import-DHqW337N.js","./cloud-BuPD2oGo.js","./accounts-WZN5CFdX.js","./store-N04W-om1.js","./card-DsqtbGFJ.js","./media-DYzEgu4n.js","./index-Dx2Zjubn.js","./modulepreload-polyfill-B5Qt9EMX.js","./feedback-B51RI4L2.js","./unlock-B9fOAItM.js","./profile-Y4JJx_-_.js","./index-BU38kawt.css","./zip-BeuNSCwz.js","./library-W5jfw358.js"])))=>i.map(i=>d[i]);
import{_ as E}from"./cloud-BuPD2oGo.js";import{b as I,i as B,e as F,f as P,r as _,h as y,j as O}from"./index-Dx2Zjubn.js";import{o as $,M as T,g as D,n as W,L as M,F as V}from"./store-N04W-om1.js";import{t as g}from"./accounts-WZN5CFdX.js";import{g as G,a as U,d as z,b as K}from"./deck-build-DR4C8OKE.js";import{c as J}from"./card-DsqtbGFJ.js";import"./modulepreload-polyfill-B5Qt9EMX.js";import"./feedback-B51RI4L2.js";import"./media-DYzEgu4n.js";import"./unlock-B9fOAItM.js";import"./profile-Y4JJx_-_.js";const q=300,c={filter:"",drafts:[],busy:!1};async function Q(t,e,n,r=()=>!0){const a=(await I(e.id)).sort((s,i)=>$(s)-$(i)),d=n.isAdmin&&await G();if(!r())return;const o=e.id===T,l=B(e,n.account),v=F(e,n.account)&&a.length>0,m=c.filter?a.filter(s=>N(s,c.filter)):a;t.innerHTML=`
    <div class="row-actions" style="margin-bottom:12px">
      <button id="deck-back" class="ghost">← All decks</button>
    </div>

    <div class="card-panel">
      <b>${o?"Mined words":"Deck"}</b>
      ${o?'<div class="glosses">The words you saved yourself. This one is named by what it is.</div>':`<label>Name</label>
             <input type="text" id="deck-name" value="${p(e.name)}" />
             <label>Description</label>
             <input type="text" id="deck-desc" value="${p(e.description??"")}"
               placeholder="What is in it, in one line" />
             <div class="row-actions" style="margin-top:10px">
               <button id="deck-rename">Save name</button>
               ${v?'<button id="deck-share" class="secondary">Share with everyone</button>':""}
               ${l?'<button id="deck-republish" class="secondary">Update the shared copy now</button>':""}
             </div>
             ${l?`<div class="glosses" style="margin-top:8px">Shared. Every change you make
                      here reaches the library on its own, a few seconds later.</div>`:""}`}
      <div class="glosses" style="margin-top:8px">${a.length.toLocaleString()} word${a.length===1?"":"s"}${e.source?` · from ${f(e.source)}`:""}</div>
    </div>

    <div class="card-panel">
      <b>Add words</b>
      <div class="glosses">One per line. The dictionary fills in the reading and
        the meaning; write your own with <code>word | reading | meaning</code>.</div>
      <textarea id="deck-input" placeholder="食べる&#10;学校 | がっこう | school&#10;ねこ"></textarea>
      <div class="row-actions" style="margin-top:10px">
        <button id="deck-look-up" ${c.busy?"disabled":""}>Look these up</button>
      </div>
    </div>

    ${d?`<div class="card-panel">
             <b>Ask for a word list</b>
             <div class="glosses">Describe the deck and Claude drafts it. Every word it
               gives back is checked against the dictionary before it can become a card,
               and words this deck already has are skipped, not offered again.</div>
             <input type="text" id="deck-ask" placeholder="e.g. 40 kitchen and cooking words, N4 level" />
             <div class="row-actions" style="margin-top:10px">
               <label class="unseen-toggle">How many
                 <input type="number" id="deck-ask-count" min="5" max="60" value="30"
                   style="width:70px;margin-left:6px" />
               </label>
               <button id="deck-generate" ${c.busy?"disabled":""}>Draft it</button>
             </div>
           </div>`:""}

    <div id="deck-drafts"></div>

    <div class="card-panel">
      <div class="row-actions" style="justify-content:space-between;align-items:center">
        <b>Words</b>
        <button id="deck-new-card" class="secondary">＋ New card</button>
      </div>
      <input type="search" id="deck-filter" placeholder="Search this deck…"
        value="${p(c.filter)}" style="margin:8px 0" />
      <div id="deck-cards" style="padding:0"></div>
      ${m.length>q?`<div class="glosses">Showing the first ${q} of ${m.length.toLocaleString()}. Search to reach the rest.</div>`:""}
    </div>
  `,t.querySelector("#deck-back").addEventListener("click",()=>{l&&P(e.id),n.onBack()});const h=()=>void Q(t,e,n,r);t.querySelector("#deck-rename")?.addEventListener("click",async()=>{const s=t.querySelector("#deck-name").value.trim();if(!s){g("A deck needs a name.","error");return}const i=t.querySelector("#deck-desc").value.trim();await _({...e,name:s,description:i,updatedAt:Date.now()}),e={...e,name:s,description:i},y(e.id),g(`Renamed to ${s}`),h()}),t.querySelector("#deck-share")?.addEventListener("click",async s=>{const i=s.currentTarget;i.disabled=!0,i.textContent="Sharing…";try{const{shareDeck:u}=await E(async()=>{const{shareDeck:w}=await import("./anki-import-DHqW337N.js");return{shareDeck:w}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12]),import.meta.url),k=await u(n.account,e.id,e.name,e.source??"");g(`${e.name} is now in the shared library`),n.onReopen?n.onReopen(k):n.onBack()}catch(u){i.disabled=!1,i.textContent="Share with everyone",g(u instanceof Error?u.message:"Could not share that deck.","error")}}),t.querySelector("#deck-republish")?.addEventListener("click",async s=>{const i=s.currentTarget;i.disabled=!0,i.textContent="Updating…";try{const{publishDeck:u}=await E(async()=>{const{publishDeck:x}=await import("./library-W5jfw358.js");return{publishDeck:x}},__vite__mapDeps([13,1,2,3,4]),import.meta.url),{ensureProfile:k}=await E(async()=>{const{ensureProfile:x}=await import("./profile-Y4JJx_-_.js");return{ensureProfile:x}},__vite__mapDeps([10,2,1]),import.meta.url),w=await u(n.account,a,{name:e.name,description:e.description,source:e.source,ownerName:(await k()).name,deckId:e.id});await _({...e,cardCount:a.length,publishedAt:w.publishedAt,shared:!0}),g(`The shared copy of ${e.name} is up to date`)}catch(u){g(u instanceof Error?u.message:"Could not update the shared copy.","error")}finally{i.disabled=!1,i.textContent="Update the shared copy"}});const b=async(s,i,u)=>{if(c.busy)return;c.busy=!0,s.disabled=!0;const k=s.textContent;s.textContent=i;try{await u()}catch(w){g(w instanceof Error?w.message:"That did not work.","error")}finally{c.busy=!1,s.disabled=!1,s.textContent=k}};t.querySelector("#deck-look-up").addEventListener("click",async s=>{const i=t.querySelector("#deck-input").value;await b(s.currentTarget,"Looking up…",async()=>{c.drafts=await z(i,e.id),c.drafts.length===0&&g("Nothing to add from that.","error"),h()})}),t.querySelector("#deck-generate")?.addEventListener("click",async s=>{const i=t.querySelector("#deck-ask").value.trim();if(!i){g("Say what the deck should be about.","error");return}const u=Math.max(5,Math.min(60,Number(t.querySelector("#deck-ask-count").value)||30));await b(s.currentTarget,"Writing…",async()=>{c.drafts=await K(i,u,e.id),c.drafts.length===0&&g("Nothing new came back. Everything it offered is already in this deck.","error"),h()})}),C(t.querySelector("#deck-drafts"),e,h),t.querySelector("#deck-new-card").addEventListener("click",()=>{const s=t.querySelector("#deck-cards");if(!s||s.querySelector(".new-card-row"))return;const i={...J({term:"",reading:"",glosses:[]},Date.now()),...e.id===T?{}:{deckId:e.id}},u=document.createElement("div");u.className="word-row new-card-row",s.prepend(u),H(u,i,null,e,h,()=>u.remove()),u.querySelector(".edit-term")?.focus(),u.scrollIntoView({block:"center",behavior:"smooth"})});const S=t.querySelector("#deck-filter");S.addEventListener("input",()=>{c.filter=S.value;const s=S.selectionStart;L();const i=t.querySelector("#deck-filter");i&&(i.focus(),i.setSelectionRange(s??i.value.length,s??i.value.length))});const L=()=>{const s=t.querySelector("#deck-cards");s&&X(s,a,e,h)};L()}function C(t,e,n){if(c.drafts.length===0){t.innerHTML="";return}const r=c.drafts.filter(o=>!o.have),a=c.drafts.filter(o=>!o.known).length;t.innerHTML=`
    <div class="card-panel">
      <b>${c.drafts.length} drafted</b>
      <div class="glosses">${r.length} to add${a>0?` · <span class="err-text">${a} not in the dictionary</span> — check those before adding`:""}</div>
      <div class="draft-list" id="draft-list"></div>
      <div class="row-actions" style="margin-top:10px">
        <button id="draft-add" ${r.length===0?"disabled":""}>Add ${r.length} to ${f(e.name)}</button>
        <button id="draft-clear" class="secondary">Discard</button>
      </div>
    </div>
  `;const d=t.querySelector("#draft-list");for(const[o,l]of c.drafts.entries()){const v=document.createElement("div");v.className=`word-row draft${l.have?" held":""}`,v.innerHTML=`
      <div class="word">
        <div><span class="term" lang="ja"><b>${f(l.term)}</b></span>
          <span class="reading" style="color:var(--accent);font-size:0.85rem">${f(l.reading)}</span>
          ${l.known?"":'<span class="draft-flag" title="The dictionary does not have this word">?</span>'}
        </div>
        <div class="glosses">${f(l.glosses.join(" · "))}</div>
        ${l.sentence?`<div class="glosses" lang="ja">${f(l.sentence)}</div>`:""}
        ${l.have?'<div class="glosses">already in this deck</div>':""}
      </div>
      <button class="ghost draft-drop" title="Drop this one">✕</button>
    `,v.querySelector(".draft-drop").addEventListener("click",()=>{c.drafts.splice(o,1),C(t,e,n)}),d.appendChild(v)}t.querySelector("#draft-clear").addEventListener("click",()=>{c.drafts=[],n()}),t.querySelector("#draft-add").addEventListener("click",async o=>{const l=o.currentTarget;l.disabled=!0;const v=await U(c.drafts,e.id);c.drafts=[],y(e.id),g(`Added ${v.added.toLocaleString()} word${v.added===1?"":"s"}`+(v.here>0?` · ${v.here} already in this deck`:"")),n()})}function N(t,e){const n=e.trim().toLowerCase();return n?t.term.toLowerCase().includes(n)||t.reading.toLowerCase().includes(n)||t.glosses.some(r=>r.toLowerCase().includes(n)):!0}function X(t,e,n,r){const a=e.filter(o=>N(o,c.filter)).slice(0,q);if(t.innerHTML="",a.length===0){t.innerHTML=`<div class="empty-state"><div class="big">📇</div>${e.length===0?"No words in this deck yet.":"Nothing matches that."}</div>`;return}const d=c.filter?null:e;for(const o of a)t.appendChild(j(o,d,n,r))}function j(t,e,n,r){const a=document.createElement("div");a.className="word-row";const d=e?e.indexOf(t):-1;return a.innerHTML=`
    ${e?`<div class="card-move">
             <button class="ghost move-up" title="Move up" ${d===0?"disabled":""}>▲</button>
             <button class="ghost card-index" title="Move to a position…">${d+1}</button>
             <button class="ghost move-down" title="Move down" ${d===e.length-1?"disabled":""}>▼</button>
           </div>`:""}
    <div class="word">
      <div><span class="term" lang="ja"><b>${f(t.term)}</b></span>
        <span class="reading" style="color:var(--accent);font-size:0.85rem">${f(t.reading)}</span></div>
      <div class="glosses">${f(t.glosses.join(" · "))}</div>
      ${t.sentence?`<div class="glosses" lang="ja">${f(t.sentence)}</div>`:""}
    </div>
    <button class="ghost edit-btn" title="Edit">✎</button>
    <button class="ghost delete-btn" title="Delete">✕</button>
  `,a.querySelector(".move-up")?.addEventListener("click",async()=>{await A(e,d,-1),y(n.id),r()}),a.querySelector(".move-down")?.addEventListener("click",async()=>{await A(e,d,1),y(n.id),r()}),a.querySelector(".card-index")?.addEventListener("click",async()=>{const o=prompt(`Move “${t.term}” to position (1–${e.length}):`,String(d+1));if(o===null)return;const l=Math.round(Number(o));if(!Number.isFinite(l)||l<1||l>e.length){g(`A position between 1 and ${e.length}.`,"error");return}await Y(e,d,l-1),y(n.id),r()}),a.querySelector(".delete-btn").addEventListener("click",async()=>{confirm(`Delete “${t.term}” from ${n.name}?`)&&(await W([t]),y(n.id),a.remove())}),a.querySelector(".edit-btn").addEventListener("click",()=>{H(a,t,e,n,r)}),a.querySelector(".word").after(O(t.term,t.reading,t.audio)),a}async function A(t,e,n){const r=e+n;if(r<0||r>=t.length)return;const a=await R(t),d=a[e],[o,l]=n<0?[a[r-1],a[r]]:[a[r],a[r+1]];await D({...d,order:M(o,l),updatedAt:Date.now()})}async function Y(t,e,n){if(e===n)return;const r=await R(t),a=r[e],d=r.filter((v,m)=>m!==e),o=d[n-1],l=d[n];await D({...a,order:M(o,l),updatedAt:Date.now()})}async function R(t){let e=!1;for(let a=1;a<t.length;a++)if($(t[a])<=$(t[a-1])){e=!0;break}if(!e)return t;const n=$(t[0]),r=t.map((a,d)=>({...a,order:n+d*6e4,updatedAt:Date.now()}));return await V(r),r}function H(t,e,n,r,a,d){t.innerHTML=`
    <div class="word" style="flex:1">
      <label>Word</label>
      <input type="text" class="edit-term" lang="ja" value="${p(e.term)}" />
      <label>Reading</label>
      <input type="text" class="edit-reading" lang="ja" value="${p(e.reading)}" />
      <label>Meanings (separate with ;)</label>
      <input type="text" class="edit-glosses" value="${p(e.glosses.join("; "))}" />
      <label>Sentence</label>
      <input type="text" class="edit-sentence" lang="ja" value="${p(e.sentence??"")}" />
      <label>Sentence meaning</label>
      <input type="text" class="edit-sentence-meaning" value="${p(e.sentenceMeaning??"")}" />
      <label>Sentence furigana <span class="glosses">(Anki style: 漢字[かんじ])</span></label>
      <input type="text" class="edit-furigana" lang="ja" value="${p(e.sentenceFurigana??"")}" />
      <label>Notes</label>
      <textarea class="edit-notes">${f(e.notes??"")}</textarea>
      <div class="row-actions" style="margin-top:8px">
        <button class="save-edit">Save</button>
        <button class="ghost cancel-edit">Cancel</button>
      </div>
    </div>
  `;const o=l=>t.querySelector(l).value.trim();t.querySelector(".save-edit").addEventListener("click",async()=>{const l=o(".edit-term");if(!l){g("A card needs a word on its front.","error");return}const v=o(".edit-sentence"),m=o(".edit-sentence-meaning"),h=o(".edit-furigana"),b=t.querySelector(".edit-notes").value.trim(),{sentence:S,sentenceMeaning:L,sentenceFurigana:s,notes:i,...u}=e;await D({...u,term:l,reading:o(".edit-reading"),glosses:o(".edit-glosses").split(/\s*;\s*/).filter(Boolean),...v?{sentence:v}:{},...m?{sentenceMeaning:m}:{},...h?{sentenceFurigana:h}:{},...b?{notes:b}:{},updatedAt:Date.now()}),y(r.id),a()}),t.querySelector(".cancel-edit").addEventListener("click",()=>{d?d():t.replaceWith(j(e,n,r,a))})}function de(){c.drafts=[],c.filter=""}function f(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function p(t){return t.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}export{Q as renderDeckEditor,de as resetEditor};
