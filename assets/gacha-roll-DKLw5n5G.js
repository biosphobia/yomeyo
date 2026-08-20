import{prizeImageUrl as k}from"./gacha-data-B74dNing.js";import"./cloud-BuPD2oGo.js";import"./accounts-WZN5CFdX.js";import"./store-N04W-om1.js";import"./card-DsqtbGFJ.js";import"./unlock-B9fOAItM.js";const q=56,f=48,y={single:{cardW:116,gap:10},multi:{cardW:72,gap:8}};function E(t,o,e){const n=o.rarities[t.rarity],s=t.type==="item"?`<span class="roll-item">${m(t.icon)}</span>`:t.type==="skin"?`<span class="roll-swatch" style="background:${a(t.vars["--bg"]??"#000")};
           border-color:${a(t.vars["--accent"]??"#fff")}">
           <i style="background:${a(t.vars["--accent"]??"#fff")}"></i>
         </span>`:`<img class="roll-gif" src="${a(k(t.image))}" alt="" loading="lazy" />`;return`<div class="roll-card" style="--rarity:${a(n?.color??"#94a3b8")}">
    ${s}
    ${e?"":`<span class="roll-name">${m(t.name)}</span>`}
  </div>`}function F(t,o,e){const n=Array.isArray(o)?o:[o];if(n.length===0)return Promise.resolve();const s=n.length>1,{cardW:c,gap:v}=s?y.multi:y.single,h=c+v,d=e.prizes.length>0?e.prizes:n,$=r=>`<div class="roll-strip">${Array.from({length:q},(l,i)=>i===f?r:d[Math.floor(Math.random()*d.length)]).map(l=>E(l,e,s)).join("")}</div>`;t.innerHTML=`
    <div class="roll${s?" roll-multi":""}">
      <div class="roll-window">
        <div class="roll-marker"></div>
        ${n.map($).join("")}
      </div>
    </div>
  `;const A=t.querySelector(".roll-window"),w=[...t.querySelectorAll(".roll-strip")].map((r,p)=>new Promise(l=>{let i=!1;const g=()=>{i||(i=!0,l())},M=A.clientWidth/2,S=(Math.random()-.5)*(c*.5),W=-(f*h+c/2-M)+S,u=(s?5.2:6.4)+p*.45+Math.random()*.25;r.style.transition="none",r.style.transform="translate3d(0,0,0)",requestAnimationFrame(()=>{r.style.transition=`transform ${u.toFixed(2)}s cubic-bezier(0.12, 0.72, 0.06, 1)`,r.style.transform=`translate3d(${W}px,0,0)`}),r.addEventListener("transitionend",g,{once:!0}),setTimeout(g,u*1e3+800)}));return Promise.all(w).then(()=>{})}function m(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function a(t){return m(t).replace(/'/g,"&#39;")}export{F as runRoll};
