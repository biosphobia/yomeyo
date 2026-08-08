import{prizeImageUrl as v}from"./gacha-data-CaT_Zqip.js";import"./cloud-BrAf8IS0.js";import"./accounts-WTK4qg94.js";import"./store-Dxti2Gd4.js";import"./card-DloYQ9Ck.js";const $=56,m=48,i=116,h=10,w=i+h;function A(t,e){const r=e.rarities[t.rarity],o=t.type==="item"?`<span class="roll-item">${c(t.icon)}</span>`:t.type==="skin"?`<span class="roll-swatch" style="background:${n(t.vars["--bg"]??"#000")};
           border-color:${n(t.vars["--accent"]??"#fff")}">
           <i style="background:${n(t.vars["--accent"]??"#fff")}"></i>
         </span>`:`<img class="roll-gif" src="${n(v(t.image))}" alt="" loading="lazy" />`;return`<div class="roll-card" style="--rarity:${n(r?.color??"#94a3b8")}">
    ${o}
    <span class="roll-name">${c(t.name)}</span>
  </div>`}function E(t,e,r){const o=r.prizes.length>0?r.prizes:[e],p=Array.from({length:$},(l,a)=>a===m?e:o[Math.floor(Math.random()*o.length)]);t.innerHTML=`
    <div class="roll">
      <div class="roll-window">
        <div class="roll-marker"></div>
        <div class="roll-strip" id="roll-strip">${p.map(l=>A(l,r)).join("")}</div>
      </div>
    </div>
  `;const s=t.querySelector("#roll-strip"),f=t.querySelector(".roll-window");return new Promise(l=>{let a=!1;const d=()=>{a||(a=!0,l())};(()=>{const u=f.clientWidth/2,g=(Math.random()-.5)*(i*.5),y=-(m*w+i/2-u)+g;s.style.transition="none",s.style.transform="translate3d(0,0,0)",requestAnimationFrame(()=>{s.style.transition="transform 6.4s cubic-bezier(0.12, 0.72, 0.06, 1)",s.style.transform=`translate3d(${y}px,0,0)`}),s.addEventListener("transitionend",d,{once:!0}),setTimeout(d,7200)})()})}function c(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function n(t){return c(t).replace(/'/g,"&#39;")}export{E as runRoll};
