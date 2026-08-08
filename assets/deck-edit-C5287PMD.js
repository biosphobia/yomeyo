const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./anki-import-BcqP_Wq9.js","./cloud-BrAf8IS0.js","./accounts-WTK4qg94.js","./store-Dxti2Gd4.js","./card-DloYQ9Ck.js","./index-CGRRECQs.js","./modulepreload-polyfill-B5Qt9EMX.js","./unlock-CrtL2933.js","./profile-VM8BKhqX.js","./index-B6BmWXm8.css","./library-BxlHCIkX.js"])))=>i.map(i=>d[i]);
import{_ as q}from"./cloud-BrAf8IS0.js";import{M as C,d as _,o as S,c as G,i as U,b as J,f as K,e as D,g as x,s as V,h as z}from"./index-CGRRECQs.js";import{a as N,f as Y,d as j,b as R,g as Q,e as H,x as X}from"./store-Dxti2Gd4.js";import{t as w}from"./accounts-WTK4qg94.js";import{n as Z,m as ee,c as E}from"./card-DloYQ9Ck.js";import"./modulepreload-polyfill-B5Qt9EMX.js";import"./unlock-CrtL2933.js";import"./profile-VM8BKhqX.js";const te=/^[぀-ヿー\s]+$/u;function O(e,t){const a=e.lookupExact(t);return a.length===0?null:[...a].sort((s,n)=>(s.freq??1e9)-(n.freq??1e9))[0]}async function ne(e,t){const a=await R(),s=await B(),n=[],o=new Set;for(const l of e.split(/\r?\n/)){const r=l.trim();if(!r||r.startsWith("#"))continue;const d=(/[\t|]/.test(r)?r.split(/\s*[\t|]\s*/):r.split(/\s*,\s*/)).map(i=>i.trim()),f=d[0];if(!f)continue;let v=d[1]??"",h=d.slice(2).filter(Boolean);d.length>3&&(h=[d.slice(2).join(", ")]);const m=O(a,f);v||(v=m?.reading??(te.test(f)?f:"")),h.length===0&&(h=(m?.glosses??[]).slice(0,3));const p={term:f,reading:v,glosses:h.flatMap(i=>i.split(/\s*;\s*/)).filter(Boolean),known:m!==null};o.has(E(p.term,p.reading))||(o.add(E(p.term,p.reading)),P(p,s,t),n.push(p))}return n}async function B(){const e=new Map;for(const t of await j())e.set(E(t.term,t.reading),t);return e}function P(e,t,a){const s=t.get(E(e.term,e.reading));s&&(e.have=_(s)===a?"here":"elsewhere")}let A=null;function ae(){return A??=fetch(N("grammar.php?probe=1")).then(e=>e.status===204).catch(()=>!1),A}function se(e,t){return[`Build a Japanese vocabulary deck of about ${t} cards.`,"","What it should contain:",e,"","Rules, which are not negotiable:","- Give the dictionary form of each word, written the way it is normally","  written — kanji where kanji is normal, kana where kana is normal.",'- "reading" is the whole word in kana. For a word already written in kana,',"  that is the word itself.",'- "glosses" is one to three short English meanings, no articles, no',"  explanations, no part-of-speech tags.",'- "sentence" is optional: one short natural example using the word, with','  "sentenceMeaning" its English. Include it only when it is genuinely',"  useful; a bad example is worse than none.",'- "notes" is optional and at most one line — usage, a nuance, a warning.',"- No duplicates, and no word you are not certain of. A shorter deck of","  words you are sure about is better than a long one with a wrong reading","  in it, because every card here is studied as fact."].join(`
`)}async function re(e,t,a){const s=await fetch(N("grammar.php"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"deck",prompt:se(e.trim().slice(0,2e3),t)})});if(!s.ok)throw new Error("The word list could not be written just now.");const{raw:n}=await s.json();if(!n)throw new Error("The word list came back empty.");const o=JSON.parse(n);if(!Array.isArray(o.cards))throw new Error("The word list came back in the wrong shape.");const l=await R(),r=await B(),d=[],f=new Set;for(const v of o.cards){const h=v,m=typeof h.term=="string"?h.term.trim():"";if(!m)continue;const p=O(l,m),i=p?.reading??(typeof h.reading=="string"?h.reading.trim():"")??"",c=(Array.isArray(h.glosses)?h.glosses:[]).filter(y=>typeof y=="string"&&y.trim().length>0).map(y=>y.trim()).slice(0,4);if(c.length===0)continue;const g=E(m,i);if(f.has(g))continue;f.add(g);const k={term:m,reading:i,glosses:c,known:p!==null,...typeof h.sentence=="string"&&h.sentence.trim()?{sentence:h.sentence.trim()}:{},...typeof h.sentenceMeaning=="string"&&h.sentenceMeaning.trim()?{sentenceMeaning:h.sentenceMeaning.trim()}:{},...typeof h.notes=="string"&&h.notes.trim()?{notes:h.notes.trim()}:{}};P(k,r,a),d.push(k)}return d}async function ie(e,t){const a=e.filter(r=>!r.have),s=Date.now();let n=await oe(t,s);const o=a.map((r,d)=>(n+=6e4,{id:ee(),term:r.term,reading:r.reading,glosses:r.glosses,...r.sentence?{sentence:r.sentence}:{},...r.sentenceMeaning?{sentenceMeaning:r.sentenceMeaning}:{},...r.notes?{notes:r.notes}:{},...t===C?{}:{deckId:t},order:n,createdAt:s+d,updatedAt:s+d,...Z(s)}));return{added:o.length>0?await Y(o):0,here:e.filter(r=>r.have==="here").length,elsewhere:e.filter(r=>r.have==="elsewhere").length}}async function oe(e,t){return(await j()).filter(s=>_(s)===e).reduce((s,n)=>Math.max(s,S(n)),t)}const M=300,u={filter:"",drafts:[],busy:!1};async function ce(e,t,a,s=()=>!0){const n=(await G(t.id)).sort((i,c)=>S(i)-S(c)),o=a.isAdmin&&await ae();if(!s())return;const l=t.id===C,r=U(t,a.account),d=J(t,a.account)&&n.length>0,f=u.filter?n.filter(i=>W(i,u.filter)):n;e.innerHTML=`
    <div class="row-actions" style="margin-bottom:12px">
      <button id="deck-back" class="ghost">← All decks</button>
    </div>

    <div class="card-panel">
      <b>${l?"Mined words":"Deck"}</b>
      ${l?'<div class="glosses">The words you saved yourself. This one is named by what it is.</div>':`<label>Name</label>
             <input type="text" id="deck-name" value="${$(t.name)}" />
             <label>Description</label>
             <input type="text" id="deck-desc" value="${$(t.description??"")}"
               placeholder="What is in it, in one line" />
             <div class="row-actions" style="margin-top:10px">
               <button id="deck-rename">Save name</button>
               ${d?'<button id="deck-share" class="secondary">Share with everyone</button>':""}
               ${r?'<button id="deck-republish" class="secondary">Update the shared copy now</button>':""}
             </div>
             ${r?`<div class="glosses" style="margin-top:8px">Shared. Every change you make
                      here reaches the library on its own, a few seconds later.</div>`:""}`}
      <div class="glosses" style="margin-top:8px">${n.length.toLocaleString()} word${n.length===1?"":"s"}${t.source?` · from ${b(t.source)}`:""}</div>
    </div>

    <div class="card-panel">
      <b>Add words</b>
      <div class="glosses">One per line. The dictionary fills in the reading and
        the meaning; write your own with <code>word | reading | meaning</code>.</div>
      <textarea id="deck-input" placeholder="食べる&#10;学校 | がっこう | school&#10;ねこ"></textarea>
      <div class="row-actions" style="margin-top:10px">
        <button id="deck-look-up" ${u.busy?"disabled":""}>Look these up</button>
      </div>
    </div>

    ${o?`<div class="card-panel">
             <b>Ask for a word list</b>
             <div class="glosses">Describe the deck and Claude drafts it. Every word it
               gives back is checked against the dictionary before it can become a card.</div>
             <input type="text" id="deck-ask" placeholder="e.g. 40 kitchen and cooking words, N4 level" />
             <div class="row-actions" style="margin-top:10px">
               <label class="unseen-toggle">How many
                 <input type="number" id="deck-ask-count" min="5" max="60" value="30"
                   style="width:70px;margin-left:6px" />
               </label>
               <button id="deck-generate" ${u.busy?"disabled":""}>Draft it</button>
             </div>
           </div>`:""}

    <div id="deck-drafts"></div>

    <div class="card-panel">
      <b>Words</b>
      <input type="search" id="deck-filter" placeholder="Search this deck…"
        value="${$(u.filter)}" style="margin:8px 0" />
      <div id="deck-cards" style="padding:0"></div>
      ${f.length>M?`<div class="glosses">Showing the first ${M} of ${f.length.toLocaleString()}. Search to reach the rest.</div>`:""}
    </div>
  `,e.querySelector("#deck-back").addEventListener("click",()=>{r&&K(t.id),a.onBack()});const v=()=>void ce(e,t,a,s);e.querySelector("#deck-rename")?.addEventListener("click",async()=>{const i=e.querySelector("#deck-name").value.trim();if(!i){w("A deck needs a name.","error");return}const c=e.querySelector("#deck-desc").value.trim();await D({...t,name:i,description:c,updatedAt:Date.now()}),t={...t,name:i,description:c},x(t.id),w(`Renamed to ${i}`),v()}),e.querySelector("#deck-share")?.addEventListener("click",async i=>{const c=i.currentTarget;c.disabled=!0,c.textContent="Sharing…";try{const{shareDeck:g}=await q(async()=>{const{shareDeck:y}=await import("./anki-import-BcqP_Wq9.js");return{shareDeck:y}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9]),import.meta.url),k=await g(a.account,t.id,t.name,t.source??"");w(`${t.name} is now in the shared library`),a.onReopen?a.onReopen(k):a.onBack()}catch(g){c.disabled=!1,c.textContent="Share with everyone",w(g instanceof Error?g.message:"Could not share that deck.","error")}}),e.querySelector("#deck-republish")?.addEventListener("click",async i=>{const c=i.currentTarget;c.disabled=!0,c.textContent="Updating…";try{const{publishDeck:g}=await q(async()=>{const{publishDeck:L}=await import("./library-BxlHCIkX.js");return{publishDeck:L}},__vite__mapDeps([10,1,2,5,6,7,3,4,8,9]),import.meta.url),{ensureProfile:k}=await q(async()=>{const{ensureProfile:L}=await import("./profile-VM8BKhqX.js");return{ensureProfile:L}},__vite__mapDeps([8,2,1]),import.meta.url),y=await g(a.account,n,{name:t.name,description:t.description,source:t.source,ownerName:(await k()).name,deckId:t.id});await D({...t,cardCount:n.length,publishedAt:y.publishedAt,shared:!0}),w(`The shared copy of ${t.name} is up to date`)}catch(g){w(g instanceof Error?g.message:"Could not update the shared copy.","error")}finally{c.disabled=!1,c.textContent="Update the shared copy"}});const h=async(i,c,g)=>{if(u.busy)return;u.busy=!0,i.disabled=!0;const k=i.textContent;i.textContent=c;try{await g()}catch(y){w(y instanceof Error?y.message:"That did not work.","error")}finally{u.busy=!1,i.disabled=!1,i.textContent=k}};e.querySelector("#deck-look-up").addEventListener("click",async i=>{const c=e.querySelector("#deck-input").value;await h(i.currentTarget,"Looking up…",async()=>{u.drafts=await ne(c,t.id),u.drafts.length===0&&w("Nothing to add from that.","error"),v()})}),e.querySelector("#deck-generate")?.addEventListener("click",async i=>{const c=e.querySelector("#deck-ask").value.trim();if(!c){w("Say what the deck should be about.","error");return}const g=Math.max(5,Math.min(60,Number(e.querySelector("#deck-ask-count").value)||30));await h(i.currentTarget,"Writing…",async()=>{u.drafts=await re(c,g,t.id),u.drafts.length===0&&w("Nothing usable came back.","error"),v()})}),I(e.querySelector("#deck-drafts"),t,v);const m=e.querySelector("#deck-filter");m.addEventListener("input",()=>{u.filter=m.value;const i=m.selectionStart;p();const c=e.querySelector("#deck-filter");c&&(c.focus(),c.setSelectionRange(i??c.value.length,i??c.value.length))});const p=()=>{const i=e.querySelector("#deck-cards");i&&le(i,n,t,v)};p()}function I(e,t,a){if(u.drafts.length===0){e.innerHTML="";return}const s=u.drafts.filter(l=>!l.have),n=u.drafts.filter(l=>!l.known).length;e.innerHTML=`
    <div class="card-panel">
      <b>${u.drafts.length} drafted</b>
      <div class="glosses">${s.length} to add${n>0?` · <span class="err-text">${n} not in the dictionary</span> — check those before adding`:""}</div>
      <div class="draft-list" id="draft-list"></div>
      <div class="row-actions" style="margin-top:10px">
        <button id="draft-add" ${s.length===0?"disabled":""}>Add ${s.length} to ${b(t.name)}</button>
        <button id="draft-clear" class="secondary">Discard</button>
      </div>
    </div>
  `;const o=e.querySelector("#draft-list");for(const[l,r]of u.drafts.entries()){const d=document.createElement("div");d.className=`word-row draft${r.have?" held":""}`,d.innerHTML=`
      <div class="word">
        <div><span class="term" lang="ja"><b>${b(r.term)}</b></span>
          <span class="reading" style="color:var(--accent);font-size:0.85rem">${b(r.reading)}</span>
          ${r.known?"":'<span class="draft-flag" title="The dictionary does not have this word">?</span>'}
        </div>
        <div class="glosses">${b(r.glosses.join(" · "))}</div>
        ${r.sentence?`<div class="glosses" lang="ja">${b(r.sentence)}</div>`:""}
        ${r.have?`<div class="glosses">${r.have==="here"?"already in this deck":"already in another deck — left where it is"}</div>`:""}
      </div>
      <button class="ghost draft-drop" title="Drop this one">✕</button>
    `,d.querySelector(".draft-drop").addEventListener("click",()=>{u.drafts.splice(l,1),I(e,t,a)}),o.appendChild(d)}e.querySelector("#draft-clear").addEventListener("click",()=>{u.drafts=[],a()}),e.querySelector("#draft-add").addEventListener("click",async l=>{const r=l.currentTarget;r.disabled=!0;const d=await ie(u.drafts,t.id);u.drafts=[],x(t.id),w(`Added ${d.added.toLocaleString()} word${d.added===1?"":"s"}`+(d.elsewhere>0?` · ${d.elsewhere} are in another deck already`:"")),a()})}function W(e,t){const a=t.trim().toLowerCase();return a?e.term.toLowerCase().includes(a)||e.reading.toLowerCase().includes(a)||e.glosses.some(s=>s.toLowerCase().includes(a)):!0}function le(e,t,a,s){const n=t.filter(l=>W(l,u.filter)).slice(0,M);if(e.innerHTML="",n.length===0){e.innerHTML=`<div class="empty-state"><div class="big">📇</div>${t.length===0?"No words in this deck yet.":"Nothing matches that."}</div>`;return}const o=u.filter?null:t;for(const l of n)e.appendChild(F(l,o,a,s))}function F(e,t,a,s){const n=document.createElement("div");n.className="word-row";const o=t?t.indexOf(e):-1;return n.innerHTML=`
    ${t?`<div class="card-move">
             <button class="ghost move-up" title="Move up" ${o===0?"disabled":""}>▲</button>
             <span class="card-index">${o+1}</span>
             <button class="ghost move-down" title="Move down" ${o===t.length-1?"disabled":""}>▼</button>
           </div>`:""}
    <div class="word">
      <div><span class="term" lang="ja"><b>${b(e.term)}</b></span>
        <span class="reading" style="color:var(--accent);font-size:0.85rem">${b(e.reading)}</span></div>
      <div class="glosses">${b(e.glosses.join(" · "))}</div>
      ${e.sentence?`<div class="glosses" lang="ja">${b(e.sentence)}</div>`:""}
    </div>
    <button class="ghost edit-btn" title="Edit">✎</button>
    <button class="ghost delete-btn" title="Delete">✕</button>
  `,n.querySelector(".move-up")?.addEventListener("click",async()=>{await T(t,o,-1),x(a.id),s()}),n.querySelector(".move-down")?.addEventListener("click",async()=>{await T(t,o,1),x(a.id),s()}),n.querySelector(".delete-btn").addEventListener("click",async()=>{confirm(`Delete “${e.term}” from ${a.name}?`)&&(await Q([e]),x(a.id),n.remove())}),n.querySelector(".edit-btn").addEventListener("click",()=>{ue(n,e,t,a,s)}),n.querySelector(".word").after(V(e.term,e.reading,e.audio)),n}async function T(e,t,a){const s=t+a;if(s<0||s>=e.length)return;const n=await de(e),o=n[t],[l,r]=a<0?[n[s-1],n[s]]:[n[s],n[s+1]];await H({...o,order:z(l,r),updatedAt:Date.now()})}async function de(e){let t=!1;for(let n=1;n<e.length;n++)if(S(e[n])<=S(e[n-1])){t=!0;break}if(!t)return e;const a=S(e[0]),s=e.map((n,o)=>({...n,order:a+o*6e4,updatedAt:Date.now()}));return await X(s),s}function ue(e,t,a,s,n){e.innerHTML=`
    <div class="word" style="flex:1">
      <label>Word</label>
      <input type="text" class="edit-term" lang="ja" value="${$(t.term)}" />
      <label>Reading</label>
      <input type="text" class="edit-reading" lang="ja" value="${$(t.reading)}" />
      <label>Meanings (separate with ;)</label>
      <input type="text" class="edit-glosses" value="${$(t.glosses.join("; "))}" />
      <label>Sentence</label>
      <input type="text" class="edit-sentence" lang="ja" value="${$(t.sentence??"")}" />
      <label>Sentence meaning</label>
      <input type="text" class="edit-sentence-meaning" value="${$(t.sentenceMeaning??"")}" />
      <label>Notes</label>
      <textarea class="edit-notes">${b(t.notes??"")}</textarea>
      <div class="row-actions" style="margin-top:8px">
        <button class="save-edit">Save</button>
        <button class="ghost cancel-edit">Cancel</button>
      </div>
    </div>
  `;const o=l=>e.querySelector(l).value.trim();e.querySelector(".save-edit").addEventListener("click",async()=>{const l=o(".edit-term");if(!l){w("A card needs a word on its front.","error");return}const r=o(".edit-sentence"),d=o(".edit-sentence-meaning"),f=e.querySelector(".edit-notes").value.trim(),{sentence:v,sentenceMeaning:h,notes:m,...p}=t;await H({...p,term:l,reading:o(".edit-reading"),glosses:o(".edit-glosses").split(/\s*;\s*/).filter(Boolean),...r?{sentence:r}:{},...d?{sentenceMeaning:d}:{},...f?{notes:f}:{},updatedAt:Date.now()}),x(s.id),n()}),e.querySelector(".cancel-edit").addEventListener("click",()=>{e.replaceWith(F(t,a,s,n))})}function be(){u.drafts=[],u.filter=""}function b(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function $(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}export{ce as renderDeckEditor,be as resetEditor};
