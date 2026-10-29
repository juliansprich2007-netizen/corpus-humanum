/* 3D-Anatomie-Viewer auf Basis von BodyParts3D (© DBCLS, CC BY 4.0).
   Koordinaten im Modell: Millimeter, +X = linke Körperseite des Patienten, +Y = oben, +Z = vorne. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { MAP } from './map.js?v=6';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const LAYERS = [['bone','Knochen'],['muscle','Muskeln'],['lig','Bänder & Knorpel'],['skin','Haut']];
const LAYER_OF = { bone:'bone', teeth:'bone', cart:'lig', lig:'lig', muscle:'muscle', skin:'skin' };
const ORD = ['','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];
const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const FINGER = { thumb:'Daumen', 'index finger':'Zeigefinger', 'middle finger':'Mittelfinger', 'ring finger':'Ringfinger', 'little finger':'Kleinfinger',
  'big toe':'Großzehe', 'second toe':'2. Zehe', 'third toe':'3. Zehe', 'fourth toe':'4. Zehe', 'little toe':'Kleinzehe' };

/* Englischer FMA-Name einer Einzelstruktur → lateinische/deutsche Bezeichnung (für Hover und Einzelansicht) */
export function partLabel(name){
  let side='', n=name;
  const s=n.match(/^(left|right) (.*)$/); if(s){ side=s[1]==='left'?' (links)':' (rechts)'; n=s[2]; }
  n=n.replace(/ of (left|right) /,(m,a)=>{ side=a==='left'?' (links)':' (rechts)'; return ' of '; });
  let m;
  if((m=n.match(/^(\w+) (cervical|thoracic|lumbar) vertebra$/))){ const k=ORD.indexOf(m[1]); const t={cervical:['cervicalis','C'],thoracic:['thoracica','Th'],lumbar:['lumbalis','L']}[m[2]]; return `Vertebra ${t[0]} ${ROMAN[k]} (${t[1]}${k})`; }
  if((m=n.match(/^intervertebral disk of (.*)$/))) return 'Discus intervertebralis unter '+partLabel(m[1]).replace(/^Vertebra \w+ \w+ /,'');
  if((m=n.match(/^(\w+) rib$/))) return `Costa ${ROMAN[ORD.indexOf(m[1])]}`+side;
  if((m=n.match(/^(\w+) costal cartilage$/))) return `Cartilago costalis ${ROMAN[ORD.indexOf(m[1])]}`+side;
  if((m=n.match(/^(\w+) metacarpal bone$/))) return `Os metacarpi ${ROMAN[ORD.indexOf(m[1])]}`+side;
  if((m=n.match(/^(\w+) metatarsal bone$/))) return `Os metatarsi ${ROMAN[ORD.indexOf(m[1])]}`+side;
  if((m=n.match(/^(proximal|middle|distal) phalanx of (.*)$/))){ const f=FINGER[m[2]]||m[2]; const l={proximal:'proximalis',middle:'media',distal:'distalis'}[m[1]]; return `Phalanx ${l} (${f})`+side; }
  if(/tooth$/.test(n)) return (/incisor/.test(n)?'Dens incisivus':/canine/.test(n)?'Dens caninus':/premolar/.test(n)?'Dens premolaris':'Dens molaris')+(/upper/.test(n)?' (Oberkiefer)':' (Unterkiefer)');
  return null;
}

function easeInOut(k){ return k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2; }
function cssColor(v){ return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#d0a040'); }

export class Viewer {
  constructor({ base='models/', catColor }){
    this.base=base; this.catColor=catColor; this.items=[]; this.itemById={};
    this.sel=null; this.target=null; this.expect=null; this.hideMarkers=false; this.hideLabel=false; this.quiz=false; this.onPick=null;
    this.view='a'; this.layers={bone:true,muscle:false,lig:true,skin:true}; this.isolated=null; this.ready=false;
    this.el=document.createElement('div'); this.el.className='viewer';
    this.el.innerHTML=`
      <div class="v-bar">
        <div class="seg v-views"><button data-v="a" aria-pressed="true">Vorne</button><button data-v="l" aria-pressed="false">Seite</button><button data-v="p" aria-pressed="false">Hinten</button></div>
        <div class="seg v-zoom"><button data-z="in" aria-label="Vergrößern">+</button><button data-z="out" aria-label="Verkleinern">−</button><button data-z="reset">Ganz</button></div>
      </div>
      <div class="v-layers">${LAYERS.map(([k,l])=>`<button data-l="${k}" aria-pressed="${this.layers[k]}">${l}</button>`).join('')}</div>
      <div class="v-stage">
        <div class="v-label" hidden></div><div class="v-tip" hidden></div>
        <div class="v-load"><div class="v-load-t">3D-Modell wird geladen …</div><div class="v-load-b"><i></i></div></div>
        <div class="v-iso" hidden><span class="v-iso-t"></span><button class="v-iso-x">Zurück zum ganzen Körper</button></div>
      </div>
      <div class="v-foot"><button class="v-iso-btn" hidden>Einzeln ansehen</button><span class="v-hint">Ziehen = drehen · Mausrad = zoomen (zur Mausposition) · Rechte Maustaste = verschieben · Doppelklick = dorthin zentrieren</span></div>
      <p class="v-credit">3D-Daten: BodyParts3D, © The Database Center for Life Science, CC BY 4.0</p>`;
    this.stage=this.el.querySelector('.v-stage'); this.lbl=this.el.querySelector('.v-label'); this.tip=this.el.querySelector('.v-tip');
    this.isoBtn=this.el.querySelector('.v-iso-btn'); this.isoBar=this.el.querySelector('.v-iso');
    this.el.querySelectorAll('.v-views button').forEach(b=>b.onclick=()=>this.setView(b.dataset.v));
    this.el.querySelectorAll('.v-zoom button').forEach(b=>b.onclick=()=>{ const z=b.dataset.z; if(z==='reset') this.resetZoom(true); else this.zoomBy(z==='in'?1.5:1/1.5); });
    this.el.querySelectorAll('.v-layers button').forEach(b=>b.onclick=()=>{ this.layers[b.dataset.l]=!this.layers[b.dataset.l]; b.setAttribute('aria-pressed',this.layers[b.dataset.l]); this.applyVisibility(); });
    this.isoBtn.onclick=()=>this.isolate(true);
    this.el.querySelector('.v-iso-x').onclick=()=>this.isolate(false);
    this.initGL();
    this.load().catch(e=>{ console.error(e); this.el.querySelector('.v-load-t').textContent='Das 3D-Modell konnte nicht geladen werden. Bitte Seite neu laden.'; });
  }

  /* ---------- Grundgerüst ---------- */
  initGL(){
    const R=this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    R.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); R.toneMapping=THREE.ACESFilmicToneMapping; R.toneMappingExposure=1.0;
    this.stage.prepend(R.domElement);
    const S=this.scene=new THREE.Scene();
    const pm=new THREE.PMREMGenerator(R); S.environment=pm.fromScene(new RoomEnvironment(R),.04).texture; S.environmentIntensity=.55;
    const cam=this.camera=new THREE.PerspectiveCamera(30,1,5,30000); S.add(cam);
    const key=new THREE.DirectionalLight(0xfff4e6,2.2); key.position.set(-1,1.1,1.4); cam.add(key);
    const tgt=new THREE.Object3D(); tgt.position.set(0,0,-1); cam.add(tgt); key.target=tgt;
    const rim=new THREE.DirectionalLight(0xdbe6ff,1.1); rim.position.set(1.2,.6,-1.5); rim.target=tgt; cam.add(rim);
    S.add(new THREE.HemisphereLight(0xfff6ec,0x3a332c,.35));
    const C=this.controls=new OrbitControls(cam,R.domElement);
    C.enableDamping=true; C.dampingFactor=.09; C.rotateSpeed=.75; C.zoomSpeed=1.1; C.screenSpacePanning=true; C.zoomToCursor=true;
    C.minDistance=60; C.maxDistance=9000;
    C.addEventListener('change',()=>{ this.dirty=true; this.syncView(); });
    C.addEventListener('start',()=>{ this.anim=null; this.tip.hidden=true; });
    this.root=new THREE.Group(); S.add(this.root);
    this.mkGroup=new THREE.Group(); S.add(this.mkGroup);
    this.sph=new THREE.SphereGeometry(1,24,16);
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.8,1,48),new THREE.MeshBasicMaterial({transparent:true,depthTest:false,side:THREE.DoubleSide}));
    this.ring.renderOrder=20; this.ring.visible=false; S.add(this.ring);
    this.mats=this.makeMaterials();
    let down=null;
    R.domElement.addEventListener('pointerdown',e=>{ down={x:e.clientX,y:e.clientY,b:e.button}; });
    R.domElement.addEventListener('pointerup',e=>{ const d=down; down=null; if(d&&d.b===0&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6) this.click(e); });
    R.domElement.addEventListener('dblclick',e=>this.focusAt(e));
    R.domElement.addEventListener('pointermove',e=>{ if(e.buttons) return; this.hoverEv=e; });
    R.domElement.addEventListener('pointerleave',()=>{ this.hoverEv=null; this.setHover(null); });
    new ResizeObserver(()=>this.resize()).observe(this.stage);
    const loop=now=>{ this.tick(now); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  makeMaterials(){
    const phys=o=>new THREE.MeshPhysicalMaterial(Object.assign({metalness:0},o));
    const m={
      bone:phys({color:0xe6d7bb,roughness:.6,clearcoat:.12,clearcoatRoughness:.65,sheen:.35,sheenRoughness:.7,sheenColor:new THREE.Color(0xfff0d6)}),
      teeth:phys({color:0xf4eee0,roughness:.22,clearcoat:.7,clearcoatRoughness:.2}),
      cart:phys({color:0xbfd9df,roughness:.3,clearcoat:.5,clearcoatRoughness:.3,transparent:true,opacity:.95}),
      lig:phys({color:0xe6e1d2,roughness:.34,clearcoat:.55,clearcoatRoughness:.35,sheen:.5,sheenColor:new THREE.Color(0xffffff)}),
      muscle:phys({color:0xa3392f,roughness:.46,clearcoat:.3,clearcoatRoughness:.35,sheen:.8,sheenRoughness:.45,sheenColor:new THREE.Color(0xff8f7a)}),
      skin:new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.FrontSide,
        uniforms:{col:{value:new THREE.Color(0xf0dcc8)},op:{value:.42}},
        vertexShader:'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
        fragmentShader:'uniform vec3 col;uniform float op;varying vec3 vN;varying vec3 vV;void main(){float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.6);gl_FragColor=vec4(col,f*op+.015);}'})
    };
    m.muscleGhost=m.muscle.clone(); m.muscleGhost.transparent=true; m.muscleGhost.opacity=.14; m.muscleGhost.depthWrite=false;
    m.hover={}; m.hl={};
    for(const g of ['bone','teeth','cart','lig','muscle']){ const h=m[g].clone(); h.emissive=new THREE.Color(0xffffff); h.emissiveIntensity=.12; m.hover[g]=h; }
    return m;
  }
  hlMat(g,cat){ const k=g+'|'+cat; if(this.mats.hl[k]) return this.mats.hl[k];
    const c=cssColor(this.catColor(cat)); const base=this.mats[g==='skin'?'bone':g]; const h=base.clone();
    if(g==='muscle'){ h.color=new THREE.Color(0xd8301c); h.emissive=new THREE.Color(0xff2a10); h.emissiveIntensity=.32; h.sheenColor=new THREE.Color(0xffb09c); }
    else { h.color=base.color.clone().lerp(c,.7); h.emissive=c; h.emissiveIntensity=.45; }
    h.transparent=false; h.opacity=1; h.depthWrite=true; return this.mats.hl[k]=h; }

  /* ---------- Modell laden ---------- */
  async load(){
    const bar=this.el.querySelector('.v-load-b i');
    const idx=await (await fetch(this.base+'index.json?v=6')).json();
    this.idx=idx; this.parts=idx.parts.map((p,i)=>({i,id:p[0],name:p[1],g:p[2],file:p[3],vo:p[4],vc:p[5],no:p[6],io:p[7],ic:p[8],it:p[9],c:new THREE.Vector3(...p[10])}));
    this.concepts=idx.concepts;
    // Muskeln sind der größte Teil der Daten und werden erst geladen, wenn sie gebraucht werden (ensureMuscles)
    const order=['bone','teeth','cart','lig','skin'];
    const total=order.reduce((s,f)=>s+(idx.sizes[f]||0),0); let done=0;
    for(const f of order){
      if(!idx.files[f]) continue;
      const buf=await this.fetchProgress(this.base+idx.files[f],n=>{ bar.style.width=((done+n)/total*100).toFixed(1)+'%'; });
      done+=idx.sizes[f];
      this.buildGroup(f,buf);
      if(f==='bone'){ this.frameHome(true); this.el.querySelector('.v-load-t').textContent='Weitere Strukturen werden geladen …'; }
      this.dirty=true; await new Promise(r=>setTimeout(r,0));
    }
    this.el.querySelector('.v-load').hidden=true; this.ready=true;
    this.buildItemIndex(); this.applyVisibility(); this.renderMarkers();
    this.buildBVH();
    this.onReady&&this.onReady();
  }
  buildBVH(){ // Raycast-Beschleunigung im Leerlauf aufbauen
    const meshes=this.parts.filter(p=>p.mesh&&!p.mesh.geometry.boundsTree).map(p=>p.mesh); let k=0;
    const step=()=>{ const t=performance.now(); while(k<meshes.length&&performance.now()-t<12){ meshes[k++].geometry.computeBoundsTree(); } if(k<meshes.length) setTimeout(step,0); };
    step();
  }
  needsMuscles(){ if(this.musclesLoaded||!this.parts) return false;
    if(this.layers.muscle) return true;
    return [...this.activeParts().keys()].some(i=>this.parts[i].g==='muscle'); }
  ensureMuscles(){
    if(this.musclesLoaded) return Promise.resolve(); if(this.musclePromise) return this.musclePromise;
    const box=this.el.querySelector('.v-load'), bar=box.querySelector('.v-load-b i'), size=this.idx.sizes.muscle||1;
    box.hidden=false; box.querySelector('.v-load-t').textContent='Muskeln werden geladen …'; bar.style.width='0%';
    this.musclePromise=this.fetchProgress(this.base+this.idx.files.muscle,n=>{ bar.style.width=(n/size*100).toFixed(1)+'%'; }).then(buf=>{
      this.buildGroup('muscle',buf); this.musclesLoaded=true; box.hidden=true;
      for(const inf of Object.values(this.info||{})) inf.pt=null; // Punkte auf Muskeln neu berechnen
      this.applyVisibility(); this.renderMarkers(); this.buildBVH();
      const pz=this.pendingZoom; this.pendingZoom=null; if(pz&&(pz===this.sel||pz===this.target)) this.zoomToItem(this.itemById[pz]);
    }).catch(e=>{ console.error(e); box.querySelector('.v-load-t').textContent='Die Muskeln konnten nicht geladen werden. Bitte Seite neu laden.'; this.musclePromise=null; });
    return this.musclePromise;
  }
  async fetchProgress(url,cb){
    const r=await fetch(url); if(!r.ok) throw new Error(url+' '+r.status);
    let out;
    if(!r.body||!r.body.getReader) out=new Uint8Array(await r.arrayBuffer());
    else { const rd=r.body.getReader(), chunks=[]; let n=0;
      for(;;){ const {done,value}=await rd.read(); if(done) break; chunks.push(value); n+=value.length; cb(n); }
      out=new Uint8Array(n); let o=0; for(const c of chunks){ out.set(c,o); o+=c.length; } }
    // Dateien liegen gzip-gepackt auf dem Server; falls der Server sie schon entpackt hat, fehlt die gzip-Kennung
    if(out[0]===0x1f&&out[1]===0x8b){
      if(typeof DecompressionStream!=='undefined') return await new Response(new Blob([out]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const pako=await import('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.esm.mjs'); return pako.ungzip(out).buffer;
    }
    return out.buffer;
  }
  buildGroup(file,buf){
    const q=this.idx.q;
    for(const p of this.parts){ if(p.file!==file) continue;
      const qa=new Uint16Array(buf,p.vo,p.vc*3), pos=new Float32Array(p.vc*3);
      for(let i=0;i<p.vc;i++){ pos[i*3]=q.min[0]+qa[i*3]*q.step[0]; pos[i*3+1]=q.min[1]+qa[i*3+1]*q.step[1]; pos[i*3+2]=q.min[2]+qa[i*3+2]*q.step[2]; }
      const ind=p.it===2?new Uint16Array(buf,p.io,p.ic):new Uint32Array(buf,p.io,p.ic);
      const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('normal',new THREE.BufferAttribute(new Int8Array(buf,p.no,p.vc*3),3,true)); g.setIndex(new THREE.BufferAttribute(ind,1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,this.baseMat(p)); mesh.userData.part=p.i; p.mesh=mesh;
      if(p.g==='skin') mesh.renderOrder=5;
      this.root.add(mesh);
    }
  }
  baseMat(p){ if(p.g==='muscle') return this.layers.bone?this.mats.muscle:this.mats.muscle; return this.mats[p.g]||this.mats.bone; }

  /* ---------- Begriffe ↔ Strukturen ---------- */
  conceptParts(name){ return this.concepts[name]||[]; }
  leftOnly(list){ const l=list.filter(i=>this.parts[i].c.x>-3); return l.length?l:list; }
  buildItemIndex(){
    this.partItems={}; this.info={};
    for(const it of this.allItems||[]){
      const f=MAP[it.lat]; if(!f) continue;
      const all=new Set(), focus=new Set();
      (f.m||[]).forEach(n=>this.conceptParts(n).forEach(i=>all.add(i)));
      (f.j||[]).forEach(n=>this.leftOnly(this.conceptParts(n)).forEach(i=>{ all.add(i); focus.add(i); }));
      (f.m||[]).forEach(n=>this.leftOnly(this.conceptParts(n)).forEach(i=>focus.add(i)));
      this.info[it.id]={f,all:[...all],focus:[...focus],pt:null};
      for(const i of all) (this.partItems[i]??=[]).push(it.id);
    }
  }
  hasFig(it){ return !!MAP[it.lat]; }
  itemPoint(it){
    const inf=this.info[it.id]; if(!inf) return null; if(inf.pt!==null) return inf.pt;
    const f=inf.f; let p=null;
    if(f.j) p=this.jointPoint(f.j,f.near);
    else if(f.pt) p=this.surfacePoint(it,f);
    if(p&&f.off){ const sgn=p.x>=-3?1:-1; p.add(new THREE.Vector3(f.off[0]*sgn,f.off[1],f.off[2])); }
    return inf.pt=p;
  }
  bbox(list){ const b=new THREE.Box3(); list.forEach(i=>{ const m=this.parts[i].mesh; if(m) b.union(m.geometry.boundingBox); }); return b; }
  jointPoint(names,near){
    const A=this.leftOnly(this.conceptParts(names[0])), B=this.leftOnly(this.conceptParts(names[1]));
    const va=this.samplePts(A,near,2500), vb=this.samplePts(B,null,2500);
    if(!va.length||!vb.length) return this.bbox(A).getCenter(new THREE.Vector3());
    let best=1e18,bi=0,bj=0;
    for(let i=0;i<va.length;i+=3) for(let j=0;j<vb.length;j+=3){ const dx=va[i]-vb[j],dy=va[i+1]-vb[j+1],dz=va[i+2]-vb[j+2],d=dx*dx+dy*dy+dz*dz; if(d<best){best=d;bi=i;bj=j;} }
    return new THREE.Vector3((va[bi]+vb[bj])/2,(va[bi+1]+vb[bj+1])/2,(va[bi+2]+vb[bj+2])/2);
  }
  samplePts(list,near,max){
    const box=this.bbox(list), out=[]; let tot=0; list.forEach(i=>{ if(this.parts[i].mesh) tot+=this.parts[i].vc; });
    const step=Math.max(1,Math.floor(tot/max)); const h=box.max.y-box.min.y, w=box.max.x-box.min.x;
    for(const i of list){ const m=this.parts[i].mesh; if(!m) continue; const a=m.geometry.attributes.position.array;
      for(let k=0;k<a.length;k+=3*step){ const x=a[k],y=a[k+1];
        if(near==='top'&&y<box.max.y-h*.25) continue; if(near==='bottom'&&y>box.min.y+h*.25) continue;
        if(near==='lateral'&&Math.abs(x)<Math.max(Math.abs(box.min.x),Math.abs(box.max.x))-w*.3) continue;
        out.push(a[k],a[k+1],a[k+2]); } }
    return out;
  }
  surfacePoint(it,f){
    const [ref,u,v]=f.pt; const L=this.leftOnly(this.conceptParts(ref)); if(!L.length) return null;
    const b=this.bbox(L); const left=(b.min.x+b.max.x)/2>3;
    const right=(b.min.x+b.max.x)/2<-3; const x=right?b.max.x-u*(b.max.x-b.min.x):b.min.x+u*(b.max.x-b.min.x);
    const y=b.min.y+v*(b.max.y-b.min.y); const front=it.view!=='p';
    const targets=f.on==='skin'?this.parts.filter(p=>p.g==='skin'&&p.mesh).map(p=>p.mesh):L.map(i=>this.parts[i].mesh).filter(Boolean);
    const rc=new THREE.Raycaster(); const dir=new THREE.Vector3(0,0,front?-1:1);
    for(let r=0;r<=24;r+=3) for(let k=0;k<(r?8:1);k++){ const a=k/8*Math.PI*2;
      rc.set(new THREE.Vector3(x+Math.cos(a)*r,y+Math.sin(a)*r,front?3000:-3000),dir);
      const h=rc.intersectObjects(targets,false)[0]; if(h) return h.point.add(dir.clone().multiplyScalar(-1.5)); }
    return new THREE.Vector3(x,y,(b.min.z+b.max.z)/2);
  }

  /* ---------- Darstellung ---------- */
  setAllItems(items){ this.allItems=items; this.itemById=Object.fromEntries(items.map(i=>[i.id,i])); if(this.ready) this.buildItemIndex(); }
  setItems(items){ this.items=items.filter(i=>this.hasFig(i)); this.renderMarkers(); }
  setLayer(k,on){ this.layers[k]=on; const b=this.el.querySelector(`.v-layers [data-l="${k}"]`); b&&b.setAttribute('aria-pressed',on); this.applyVisibility(); }
  activeParts(){ // Teile, die gerade hervorgehoben sind → {partIndex: Kategorie}
    const out=new Map();
    const add=(id,strong)=>{ const inf=this.info?.[id], it=this.itemById[id]; if(!inf) return; (strong?inf.all:inf.all).forEach(i=>out.set(i,it.cat)); };
    if(this.target) add(this.target,true);
    if(this.sel) add(this.sel,true);
    return out;
  }
  applyVisibility(){
    if(!this.parts) return;
    if(this.ready&&this.needsMuscles()) this.ensureMuscles();
    const act=this.activeParts(); const iso=this.isolated; this.hovered=null;
    const muscleSel=act.size>0; // bei einer Auswahl werden die übrigen Muskeln durchsichtig
    for(const p of this.parts){ const m=p.mesh; if(!m) continue;
      const a=act.get(p.i);
      if(iso){ m.visible=iso.has(p.i); m.material=this.baseMat(p); continue; }
      const lay=this.layers[LAYER_OF[p.g]];
      if(a){ m.visible=true; m.material=this.hlMat(p.g,a); }
      else if(p.g==='muscle'){ m.visible=lay; m.material=muscleSel?this.mats.muscleGhost:this.mats.muscle; }
      else { m.visible=lay; m.material=this.baseMat(p); }
    }
    if(this.floor) this.floor.visible=!iso;
    this.dirty=true;
  }
  renderMarkers(){
    this.mkGroup.clear(); this.mkList=[];
    if(!this.ready){ this.dirty=true; return; }
    const mat={};
    const M=(cat,dim)=>mat[cat+dim]??=new THREE.MeshBasicMaterial({color:cssColor(this.catColor(cat)),transparent:true,opacity:dim?.45:1,depthTest:true});
    const show=new Set();
    if(!this.hideMarkers) for(const it of this.items){ const f=MAP[it.lat]; if(f&&(f.pt||f.j)&&!(f.m&&!f.pt&&!f.j)) show.add(it.id); }
    if(this.sel) show.add(this.sel);
    for(const id of show){ const it=this.itemById[id]; const p=this.itemPoint(it); if(!p) continue;
      if(this.isolated&&!this.isolated.has(-1)&&!(this.info[id].all.some(i=>this.isolated.has(i)))) continue;
      const on=id===this.sel; const m=new THREE.Mesh(this.sph,M(it.cat,!!this.sel&&!on)); m.position.copy(p); m.userData={id,base:on?1.5:1};
      m.renderOrder=on?30:10; if(on){ m.material=m.material.clone(); m.material.depthTest=false; }
      this.mkGroup.add(m); this.mkList.push(m); }
    const t=this.target&&this.itemById[this.target]; const tp=t&&this.itemPoint(t);
    this.ring.visible=!!(tp&&(MAP[t.lat].pt||MAP[t.lat].j)); if(this.ring.visible){ this.ring.position.copy(tp); this.ring.material.color=cssColor(this.catColor(t.cat)); }
    this.applyVisibility();
  }
  select(id,{zoom=false}={}){
    this.sel=id; const it=id&&this.itemById[id];
    if(it&&zoom) this.zoomToItem(it);
    this.isoBtn.hidden=!(it&&this.info?.[id]&&(this.info[id].focus.length||this.info[id].all.length));
    if(this.isolated&&it) this.isolate(true,true); else this.renderMarkers();
  }

  /* ---------- Einzelansicht ---------- */
  isolate(on,keepCam=false){
    if(!on){ this.isolated=null; this.isoBar.hidden=true; this.el.classList.remove('iso'); this.renderMarkers(); if(this.savedGoal){ this.goal=this.savedGoal; this.animate(); } return; }
    const inf=this.sel&&this.info[this.sel]; if(!inf) return;
    const list=inf.focus.length?inf.focus:inf.all; if(!list.length) return;
    if(!this.isolated) this.savedGoal=this.current();
    this.isolated=new Set(list); this.isoBar.hidden=false; this.el.classList.add('iso');
    this.isoBar.querySelector('.v-iso-t').textContent='Einzelansicht: '+this.itemById[this.sel].lat;
    this.renderMarkers();
    const b=this.bbox(list), s=b.getBoundingSphere(new THREE.Sphere());
    this.goal={...this.current(),target:s.center.clone(),dist:Math.max(120,s.radius/Math.tan(THREE.MathUtils.degToRad(15))*1.25)};
    this.animate();
  }

  /* ---------- Kamera ---------- */
  mount(host){ host.appendChild(this.el); this.resize(); this.dirty=true; }
  resize(){ const w=this.stage.clientWidth,h=this.stage.clientHeight; if(!w||!h) return;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.computeHome(); this.dirty=true; }
  computeHome(){ if(!this.body) return; const tf=Math.tan(THREE.MathUtils.degToRad(15));
    this.home=Math.max(this.body.h*.55/tf,this.body.w*.6/(tf*this.camera.aspect)); }
  frameHome(jump){
    const b=this.bbox(this.parts.filter(p=>p.g==='bone'&&p.mesh).map(p=>p.i));
    this.body={center:b.getCenter(new THREE.Vector3()),h:b.max.y-b.min.y,w:b.max.x-b.min.x,minY:b.min.y};
    this.computeHome(); this.addFloor();
    this.goal={az:0,el:.05,dist:this.home,target:this.body.center.clone()};
    if(jump) this.jump(); else this.animate();
  }
  addFloor(){ if(this.floor) return; const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d');
    const gr=g.createRadialGradient(128,128,0,128,128,128); gr.addColorStop(0,'rgba(0,0,0,.55)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr; g.fillRect(0,0,256,256);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(700,420),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.position.set(this.body.center.x,this.body.minY-2,this.body.center.z+10); this.floor=m; this.scene.add(m); }
  camFromGoal(g){ const t=g.target; return new THREE.Vector3(t.x+g.dist*Math.sin(g.az)*Math.cos(g.el),t.y+g.dist*Math.sin(g.el),t.z+g.dist*Math.cos(g.az)*Math.cos(g.el)); }
  current(){ const t=this.controls.target.clone(),o=this.camera.position.clone().sub(t),r=o.length(); return {az:Math.atan2(o.x,o.z),el:Math.asin(THREE.MathUtils.clamp(o.y/r,-1,1)),dist:r,target:t}; }
  jump(){ this.controls.target.copy(this.goal.target); this.camera.position.copy(this.camFromGoal(this.goal)); this.controls.update(); this.dirty=true; }
  animate(){ this.anim={t0:performance.now(),from:this.current(),to:{...this.goal,target:this.goal.target.clone()}}; this.dirty=true; }
  gb(){ if(!this.anim) this.goal=this.current(); return this.goal; }
  syncView(){ const az=this.current().az; this.view=Math.cos(az)>=0?'a':'p'; const near=Math.abs(Math.sin(az))>.75?'l':this.view;
    this.el.querySelectorAll('.v-views button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===near)); }
  setView(v){ if(!this.body) return; const g=this.gb(); g.az={a:0,l:Math.PI/2,p:Math.PI}[v]??0; g.el=.05; this.view=v==='p'?'p':'a'; this.animate(); }
  zoomBy(f){ if(!this.body) return; const g=this.gb(); g.dist=THREE.MathUtils.clamp(g.dist/f,60,9000); this.animate(); }
  resetZoom(front=false){ if(!this.body) return; if(this.isolated) this.isolate(false); const g=this.gb(); g.target=this.body.center.clone(); g.dist=this.home; if(front){ g.az=0; g.el=.05; } this.animate(); }
  zoomToItem(it,f){
    if(!this.body||!this.info?.[it.id]) return; const inf=this.info[it.id], g=this.gb();
    if(!this.musclesLoaded&&this.info[it.id].all.some(i=>this.parts[i].g==='muscle')){ this.pendingZoom=it.id; this.ensureMuscles(); return; }
    const p=this.itemPoint(it); let c,r;
    if(p&&(inf.f.pt||inf.f.j)){ c=p; r=110; } else { const s=this.bbox(inf.focus.length?inf.focus:inf.all).getBoundingSphere(new THREE.Sphere()); c=s.center; r=Math.max(60,s.radius); }
    g.target=c.clone(); g.dist=THREE.MathUtils.clamp(r/Math.tan(THREE.MathUtils.degToRad(15))*1.35,180,this.home);
    g.az=it.view==='p'?Math.PI:0; g.el=.05; this.view=it.view==='p'?'p':'a'; this.animate();
  }
  focusAt(e){ const h=this.raycast(e); if(!h) return; const g=this.gb(); g.target=h.point.clone(); g.dist=Math.min(g.dist,Math.max(250,g.dist*.6)); this.animate(); }

  /* ---------- Auswahl mit der Maus ---------- */
  ndc(e){ const r=this.renderer.domElement.getBoundingClientRect(); return {v:new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),x:e.clientX-r.left,y:e.clientY-r.top,w:r.width,h:r.height}; }
  raycast(e){ if(!this.parts) return null; const n=this.ndc(e); const rc=new THREE.Raycaster(); rc.firstHitOnly=true; rc.setFromCamera(n.v,this.camera);
    const objs=this.parts.filter(p=>p.mesh&&p.mesh.visible&&p.g!=='skin'&&!(p.mesh.material.transparent&&p.mesh.material.opacity<.6)).map(p=>p.mesh);
    return rc.intersectObjects(objs,false)[0]||null; }
  markerAt(e){ if(!this.mkList) return null; const n=this.ndc(e); let best=null,bd=16;
    for(const m of this.mkList){ const p=m.position.clone().project(this.camera); if(p.z>1) continue; const d=Math.hypot((p.x+1)/2*n.w-n.x,(1-p.y)/2*n.h-n.y); if(d<bd){bd=d;best=m;} }
    return best&&this.itemById[best.userData.id]; }
  resolve(e){
    const mk=this.markerAt(e); if(mk) return {item:mk};
    const h=this.raycast(e); if(!h) return {item:null};
    const pi=h.object.userData.part; const cands=(this.partItems?.[pi]||[]).filter(id=>this.items.some(i=>i.id===id));
    if(this.expect&&this.info[this.expect]?.all.includes(pi)){
      const ex=this.itemById[this.expect], f=MAP[ex.lat];
      if(!(f.pt||f.j)) return {item:ex,part:pi};
      const p=this.itemPoint(ex), n=this.ndc(e); if(p){ const v=p.clone().project(this.camera); if(Math.hypot((v.x+1)/2*n.w-n.x,(1-v.y)/2*n.h-n.y)<45) return {item:ex,part:pi}; }
    }
    let best=null,bs=1e9; for(const id of cands){ const s=this.info[id].all.length; if(s<bs){bs=s;best=id;} }
    return {item:best?this.itemById[best]:null,part:pi};
  }
  click(e){ if(!this.onPick) return; const r=this.resolve(e); this.onPick(r.item,r.part!=null?this.parts[r.part]:null); }
  setHover(pi){
    if(this.hovered===pi) return; const old=this.hovered!=null&&this.parts[this.hovered];
    if(old&&old.mesh&&old.mesh.material===this.mats.hover[old.g]) old.mesh.material=this.baseMat(old);
    this.hovered=pi; const p=pi!=null&&this.parts[pi];
    if(p&&p.mesh&&p.mesh.material===this.baseMat(p)&&this.mats.hover[p.g]) p.mesh.material=this.mats.hover[p.g];
    this.dirty=true;
  }
  partName(pi){ const p=this.parts[pi]; const ids=this.partItems?.[pi]||[]; let best=null,bs=1e9;
    for(const id of ids){ const s=this.info[id].all.length+(this.itemById[id].cat==='joints'?1e5:0); if(s<bs){bs=s;best=id;} }
    const lab=partLabel(p.name); const it=best&&this.itemById[best];
    if(lab) return {lat:lab,de:it&&it.cat!=='joints'?it.de:''};
    if(it&&it.cat!=='joints') return {lat:it.lat,de:it.de};
    return {lat:p.name,de:it?'Teil von: '+it.lat:''}; }
  doHover(){
    const e=this.hoverEv; this.hoverEv=null; if(!e||!this.ready) return;
    const h=this.raycast(e); const pi=h?h.object.userData.part:null; this.setHover(pi);
    if(pi==null||this.quiz){ this.tip.hidden=true; this.renderer.domElement.style.cursor=''; return; }
    this.renderer.domElement.style.cursor='pointer';
    const n=this.ndc(e), nm=this.partName(pi);
    this.tip.innerHTML=`<b>${nm.lat}</b>${nm.de?`<span>${nm.de}</span>`:''}`; this.tip.hidden=false;
    this.tip.style.transform=`translate(${Math.min(n.x+14,n.w-this.tip.offsetWidth-6)}px,${n.y+16}px)`;
  }

  /* ---------- Bildaufbau ---------- */
  tick(now){
    if(this.el.offsetParent===null) return;
    if(this.anim){ const a=this.anim,k0=Math.min(1,(now-a.t0)/700),k=easeInOut(k0); let d=a.to.az-a.from.az; d=Math.atan2(Math.sin(d),Math.cos(d));
      const g={az:a.from.az+d*k,el:a.from.el+(a.to.el-a.from.el)*k,dist:a.from.dist+(a.to.dist-a.from.dist)*k,target:a.from.target.clone().lerp(a.to.target,k)};
      this.controls.target.copy(g.target); this.camera.position.copy(this.camFromGoal(g)); if(k0>=1) this.anim=null; this.dirty=true; }
    this.controls.update(); this.doHover();
    const dist=this.camera.position.distanceTo(this.controls.target), sc=Math.max(.9,dist*.0026);
    if(this.ring.visible){ const ph=(now%1400)/1400; this.ring.scale.setScalar(sc*(1.8+ph*3)); this.ring.material.opacity=1-ph; this.ring.quaternion.copy(this.camera.quaternion); this.dirty=true; }
    if(!this.dirty) return; this.dirty=false;
    for(const m of this.mkGroup.children) m.scale.setScalar(sc*m.userData.base);
    this.renderer.render(this.scene,this.camera);
    const it=this.sel&&this.itemById[this.sel];
    if(it&&!this.hideLabel&&!this.isolated&&this.info?.[it.id]){
      let p=this.itemPoint(it); if(!p||!(MAP[it.lat].pt||MAP[it.lat].j)){ const L=this.info[it.id].focus.length?this.info[it.id].focus:this.info[it.id].all; p=L.length?this.bbox(L).getCenter(new THREE.Vector3()):null; }
      if(p){ const v=p.clone().project(this.camera),w=this.stage.clientWidth,h=this.stage.clientHeight;
        if(v.z<1&&Math.abs(v.x)<1.2&&Math.abs(v.y)<1.2){ const x=(v.x+1)/2*w,y=(1-v.y)/2*h,left=x>w*.6; this.lbl.hidden=false; this.lbl.textContent=it.lat;
          this.lbl.style.transform=`translate(${left?x-16:x+16}px,${y}px) translate(${left?'-100%':'0'},-50%)`; } else this.lbl.hidden=true; }
      else this.lbl.hidden=true;
    } else this.lbl.hidden=true;
  }
}
