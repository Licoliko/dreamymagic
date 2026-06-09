'use strict';
const $ = s => document.querySelector(s);
const stage=$('#stage'), canvas=$('#playfield'), ctx=canvas.getContext('2d');
const LANES=4; let LANE_KEYS=['d','f','j','k'];
const LANE_COLORS=[{a:'#ff8fd0',b:'#ff4fb0'},{a:'#ffd96e',b:'#f5a623'},{a:'#7fc8ff',b:'#3d8bff'},{a:'#c19bff',b:'#8b5cff'}];
const CHARACTERS=[
  {id:'magic', name:'Sweets', img:'assets/char.webp', ava:'assets/avatar.webp', price:0, c1:'#7a4fb0', c2:'#34205e'},
  {id:'stella', name:'Floating', img:'assets/char_stella.webp', ava:'assets/avatar_stella.webp', price:600, c1:'#b9a0e0', c2:'#4b337e'},
  {id:'marine', name:'Marine', img:'assets/char_marine.webp', ava:'assets/avatar_marine.webp', price:600, c1:'#6f9fe0', c2:'#243069'},
  {id:'citron', name:'Lemon', img:'assets/char_citron.webp', ava:'assets/avatar_citron.webp', price:600, c1:'#c9d36a', c2:'#4f6f2a'},
];
function charById(id){ return CHARACTERS.find(c=>c.id===id)||CHARACTERS[0]; }
const CharStore={ owned:new Set(['magic']), equipped:'magic',
  load(){ try{ const o=localStorage.getItem('pk_owned'); if(o) JSON.parse(o).forEach(id=>this.owned.add(id)); const e=localStorage.getItem('pk_equip'); if(e&&CHARACTERS.some(c=>c.id===e)) this.equipped=e; }catch(e){} this.owned.add('magic'); },
  save(){ try{ localStorage.setItem('pk_owned',JSON.stringify([...this.owned])); localStorage.setItem('pk_equip',this.equipped); }catch(e){} } };
let CUR_CHAR_IMG='assets/char.webp', CUR_CHAR_AVA='assets/avatar.webp';
function applyCharacter(){ const c=charById(CharStore.equipped); CUR_CHAR_IMG=c.img; CUR_CHAR_AVA=c.ava;
  const ci=$('#charImg'); if(ci)ci.src=CUR_CHAR_IMG; const av=$('#avaImg'); if(av)av.src=CUR_CHAR_AVA; const rc=$('#resChar'); if(rc)rc.src=CUR_CHAR_IMG; const pn=$('#playerName'); if(pn)pn.textContent=c.name; renderSongs(); }
let DPR=1,W=0,H=0,geo={};
let LITE=false, SHOW_CHAR=true;

function resize(){ const r=stage.getBoundingClientRect(); DPR=Math.min(window.devicePixelRatio||1, LITE?1:2); W=r.width; H=r.height;
  canvas.width=W*DPR; canvas.height=H*DPR; canvas.style.width=W+'px'; canvas.style.height=H+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); computeGeo(); }
function computeGeo(){ const cx=W/2,hitY=H*0.70,topY=H*0.13,span=W*0.92,laneW=span/LANES,topF=0.17; const botX=[],topX=[];
  for(let i=0;i<LANES;i++){ const bx=cx+(i-(LANES-1)/2)*laneW; botX.push(bx); topX.push(cx+(bx-cx)*topF); } geo={cx,hitY,topY,laneW,botX,topX,noteBaseW:laneW*0.82}; }
window.addEventListener('resize',resize);

/* ============ Wallet (coins, persisted) ============ */
const Wallet={ coins:200,
  load(){ try{ const v=localStorage.getItem('pk_coins'); if(v!==null){ const n=parseInt(v,10); if(!isNaN(n)) this.coins=n; } }catch(e){} },
  save(){ try{ localStorage.setItem('pk_coins', String(this.coins)); }catch(e){} },
  add(n){ this.coins+=n; this.save(); updateCoinUI(); } };
function updateCoinUI(){ $('#coinVal').textContent=Wallet.coins.toLocaleString(); }

/* ============ audio engine (fetch/decode + preview) ============ */
const AudioEngine={
  ctx:null,gain:null,buffers:{},buffer:null,src:null,startCtxTime:0,pausedAt:0,playing:false,offset:0,vol:0.85,
  previewSrc:null,previewing:false,
  init(){ if(!this.ctx){ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); this.gain=this.ctx.createGain(); this.gain.gain.value=this.vol; this.gain.connect(this.ctx.destination);} },
  setVolume(v){ this.vol=v; if(this.gain) this.gain.gain.value=v; },
  async ensure(song){
    this.init(); if(this.ctx.state==='suspended'){ try{await this.ctx.resume();}catch(e){} }
    if(!this.buffers[song.id]){
      let arr;
      if(song.file){ arr=await song.file.arrayBuffer(); }
      else{ const res=await fetch(song.audio); if(!res.ok) throw new Error('audio fetch '+res.status); arr=await res.arrayBuffer(); }
      this.buffers[song.id]=await this.ctx.decodeAudioData(arr);
    }
    this.buffer=this.buffers[song.id];
    if(!song.duration) song.duration=this.buffer.duration;
    return this.buffer;
  },
  play(fromSec=0){ this.stopPreview(); if(this.ctx.state==='suspended') this.ctx.resume();
    this.src=this.ctx.createBufferSource(); this.src.buffer=this.buffer; this.src.connect(this.gain);
    this.src.onended=()=>{ if(this.playing) onSrcEnded(); };
    this.src.start(0,fromSec); this.startCtxTime=this.ctx.currentTime-fromSec; this.playing=true; },
  time(){ return this.playing?(this.ctx.currentTime-this.startCtxTime):this.pausedAt; },
  pause(){ if(!this.playing)return; this.pausedAt=this.time(); this.playing=false; try{this.src.stop();}catch(e){} },
  resume(){ if(this.playing)return; this.play(this.pausedAt); },
  stop(){ this.playing=false; this.pausedAt=0; try{this.src&&this.src.stop();}catch(e){} },
  setLatencyOffset(ms){ this.offset=ms/1000; },
  async startPreview(song){ await this.ensure(song); this.stopPreview();
    const dur=this.buffer.duration; const from = (song.preview!=null)?song.preview:Math.min(Math.max(0,dur*0.32), Math.max(0,dur-15));
    const len=Math.min(15, Math.max(4, dur-from));
    const s=this.ctx.createBufferSource(); s.buffer=this.buffer; const g=this.ctx.createGain(); g.connect(this.gain); s.connect(g);
    const now=this.ctx.currentTime; g.gain.setValueAtTime(0.0001,now); g.gain.exponentialRampToValueAtTime(Math.max(0.0002,this.vol),now+0.4);
    g.gain.setValueAtTime(Math.max(0.0002,this.vol),now+len-0.6); g.gain.exponentialRampToValueAtTime(0.0001,now+len);
    s.start(now,from,len); this.previewSrc=s; this.previewing=true;
    s.onended=()=>{ if(this.previewSrc===s){ this.previewing=false; this.previewSrc=null; onPreviewEnded(); } }; },
  stopPreview(){ if(this.previewSrc){ try{this.previewSrc.stop();}catch(e){} this.previewSrc=null; } this.previewing=false; }
};

/* ============ in-browser auto chart (time-domain) ============ */
const AutoChart={
  generate(buf){
    try{
      const sr=buf.sampleRate, ch=buf.numberOfChannels, N=buf.length;
      const x=new Float32Array(N);
      for(let c=0;c<ch;c++){ const d=buf.getChannelData(c); for(let i=0;i<N;i++) x[i]+=d[i]/ch; }
      const hop=Math.max(256,Math.round(sr*0.0116)), win=hop*2;
      const frames=Math.floor((N-win)/hop); if(frames<8) return this.metronome(N/sr);
      const energy=new Float32Array(frames), zcr=new Float32Array(frames);
      for(let f=0;f<frames;f++){ let s=0,zc=0,off=f*hop,prev=x[off];
        for(let i=0;i<win;i++){ const v=x[off+i]; s+=v*v; if((v>=0)!==(prev>=0))zc++; prev=v; }
        energy[f]=Math.sqrt(s/win); zcr[f]=zc/win; }
      const dur=N/sr, secPerF=hop/sr;
      const flux=new Float32Array(frames);
      for(let f=1;f<frames;f++) flux[f]=Math.max(0,energy[f]-energy[f-1]);
      const wT=Math.max(2,Math.round(0.4/secPerF));
      const lm=(arr,f)=>{ let s=0,c=0; for(let i=Math.max(0,f-wT);i<=Math.min(arr.length-1,f+wT);i++){s+=arr[i];c++;} return c?s/c:0; };
      const onsets=[]; const minGapF=Math.max(1,Math.round(0.085/secPerF)); let last=-999;
      for(let f=2;f<frames-1;f++){ const t=f*secPerF; if(t<1.0||t>dur-1.0) continue;
        const thr=lm(flux,f)*1.5+1e-4;
        if(flux[f]>thr&&flux[f]>=flux[f-1]&&flux[f]>=flux[f+1]&&f-last>=minGapF){ onsets.push({t,s:flux[f],z:zcr[f]}); last=f; } }
      if(onsets.length<8) return this.metronome(dur);
      const zs=onsets.map(o=>o.z).slice().sort((a,b)=>a-b);
      const q=p=>zs[Math.min(zs.length-1,Math.floor(p*zs.length))];
      const q1=q(.25),q2=q(.5),q3=q(.75);
      const laneOf=z=>z<=q1?0:z<=q2?1:z<=q3?2:3;
      const ss=onsets.map(o=>o.s).slice().sort((a,b)=>a-b);
      const sp=p=>ss[Math.floor(p*ss.length)]||0;
      const build=(minGap,strThr)=>{ const notes=[]; let lt=-9; const ll=[-9,-9,-9,-9];
        for(const o of onsets){ if(o.s<strThr) continue; if(o.t-lt<minGap) continue; let lane=laneOf(o.z);
          if(o.t-ll[lane]<minGap*1.2){ let bl=0,bd=-9; for(let L=0;L<4;L++){ if(o.t-ll[L]>bd){bd=o.t-ll[L];bl=L;} } lane=bl; }
          notes.push({t:+o.t.toFixed(3),lane,hold:0}); lt=o.t; ll[lane]=o.t; } return notes; };
      const charts={ EASY:{lv:3,notes:build(0.34,sp(.6))}, NORMAL:{lv:5,notes:build(0.22,sp(.35))}, HARD:{lv:8,notes:build(0.13,sp(.12))} };
      return {bpm:this.estimateBpm(flux,secPerF)||120, duration:+dur.toFixed(3), lanes:4, charts};
    }catch(e){ console.error('autochart',e); return this.metronome(buf.duration||120); }
  },
  estimateBpm(flux,secPerF){ const minBpm=70,maxBpm=180; let best=0,bestLag=0;
    const minLag=Math.round((60/maxBpm)/secPerF), maxLag=Math.round((60/minBpm)/secPerF);
    for(let lag=minLag;lag<=maxLag;lag++){ let s=0; for(let i=0;i+lag<flux.length;i++) s+=flux[i]*flux[i+lag]; if(s>best){best=s;bestLag=lag;} }
    return bestLag? Math.round(60/(bestLag*secPerF)):0; },
  metronome(dur){ const mk=gap=>{ const n=[]; for(let t=1.5,i=0;t<dur-1;t+=gap,i++) n.push({t:+t.toFixed(3),lane:i%4,hold:0}); return n; };
    return {bpm:120,duration:+(+dur).toFixed(3),lanes:4,charts:{EASY:{lv:3,notes:mk(0.8)},NORMAL:{lv:5,notes:mk(0.5)},HARD:{lv:8,notes:mk(0.3)}}}; }
};

/* ============ game state ============ */
let G=null, selectedSong=null, diffKey='NORMAL', lengthKey='FULL', latencyMs=0, volume=0.85;
const LENGTHS={'30':{sec:30,label:'30秒'}, '60':{sec:60,label:'1分'}, 'FULL':{sec:Infinity,label:'フル'}};
function curLimit(){ return Math.min(LENGTHS[lengthKey].sec, selectedSong.duration); }
function chartOf(song){ return song._chart.charts[diffKey]; }

function newGame(){ const limit=curLimit(), src=chartOf(selectedSong).notes;
  const notes=src.filter(n=>n.t<=limit-0.3).map((n,i)=>({id:i,t:n.t,lane:n.lane,hold:(n.hold&&n.t+n.hold<=limit-0.1)?n.hold:0,state:'idle',headJudged:false}));
  G={ notes, limit, totalNotes:notes.length, score:0,displayScore:0,combo:0,maxCombo:0,life:1000,fever:0,feverActive:false,feverEnd:0,
    counts:{PERFECT:0,GREAT:0,GOOD:0,MISS:0},accWeight:0,accCount:0,offsets:[],
    travel: diffKey==='HARD'?1.35:diffKey==='NORMAL'?1.55:1.8,
    laneFlash:[0,0,0,0],lanePressed:[false,false,false,false],particles:[], started:false,paused:false,ended:false,failed:false }; }
const WIN={PERFECT:0.055,GREAT:0.11,GOOD:0.16}, PTS={PERFECT:1000,GREAT:600,GOOD:300,MISS:0};
function songTime(){ return AudioEngine.time()+AudioEngine.offset; }

function judgeTap(lane){ if(!G||!G.started||G.ended) return; const t=songTime(); let best=null,bd=999;
  for(const n of G.notes){ if(n.lane!==lane||n.state==='done'||n.state==='miss'||n.headJudged) continue; const dt=Math.abs(n.t-t); if(dt<bd){bd=dt;best=n;} }
  if(best&&bd<=WIN.GOOD){ const j=bd<=WIN.PERFECT?'PERFECT':bd<=WIN.GREAT?'GREAT':'GOOD'; best.headJudged=true; G.offsets.push(best.t-t); applyJudge(j,best.lane); best.state=(best.hold>0&&j!=='GOOD')?'holding':'done'; triggerHit(best.lane,j); } }
function applyJudge(j,lane){ G.counts[j]++; G.accCount++; G.accWeight+= j==='PERFECT'?1:j==='GREAT'?0.65:j==='GOOD'?0.3:0;
  if(j==='MISS'){ G.combo=0; G.life=Math.max(0,G.life-40); if(G.life<=0&&!G.ended){G.failed=true;endGame();} }
  else{ G.combo++; if(G.combo>G.maxCombo)G.maxCombo=G.combo; G.life=Math.min(1000,G.life+(j==='PERFECT'?7:j==='GREAT'?4:1));
    const gained=Math.round(PTS[j]*(1+Math.min(G.combo,200)*0.004)*(G.feverActive?2:1)); G.score+=gained; showScoreAdd(gained);
    if(!G.feverActive){ G.fever=Math.min(100,G.fever+(j==='PERFECT'?2.4:j==='GREAT'?1.4:0.4)); if(G.fever>=100)activateFever(); } }
  showJudge(j); updateHUD(); }
function activateFever(){ G.feverActive=true; G.feverEnd=songTime()+7; stage.classList.add('fever'); const fb=$('#feverBanner'); fb.classList.remove('show'); void fb.offsetWidth; fb.classList.add('show'); $('#feverWrap').classList.add('ready'); }
function endFever(){ G.feverActive=false; G.fever=0; stage.classList.remove('fever'); $('#feverWrap').classList.remove('ready'); }
function triggerHit(lane,j){ G.laneFlash[lane]=1; const x=geo.botX[lane],y=geo.hitY,col=LANE_COLORS[lane]; const n=LITE?(j==='PERFECT'?6:j==='GREAT'?3:2):(j==='PERFECT'?16:j==='GREAT'?10:6);
  for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2,sp=1.5+Math.random()*3.5; G.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-1.5,life:1,col:col.a,size:2+Math.random()*3}); } }

let scoreAddTimer=null;
function showScoreAdd(v){ const el=$('#scoreAdd'); el.textContent='+'+v.toLocaleString(); clearTimeout(scoreAddTimer); scoreAddTimer=setTimeout(()=>el.textContent='',650); }
function showJudge(j){ const el=$('#judge'); const colors={PERFECT:'linear-gradient(90deg,#ff8fe0,#ffd86e,#7fd0ff,#c19bff)',GREAT:'#ffd866',GOOD:'#7fd0ff',MISS:'#ff8a8a'};
  if(j==='PERFECT'){ el.style.background=colors.PERFECT; el.style.webkitBackgroundClip='text'; el.style.backgroundClip='text'; el.style.color='transparent'; } else{ el.style.background='none'; el.style.webkitBackgroundClip='initial'; el.style.color=colors[j]; }
  el.textContent=j+(j==='PERFECT'?' \u2728':''); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function updateHUD(){ $('#comboNum').textContent=G.combo; const cn=$('#comboNum'); cn.classList.remove('combo-pop'); void cn.offsetWidth; cn.classList.add('combo-pop');
  $('#lifeVal').textContent=Math.round(G.life); $('#lifeFill').style.width=(G.life/1000*100)+'%'; $('#feverFill').style.width=G.fever+'%';
  const acc=G.accCount?G.accWeight/G.accCount:0; $('#rankMarker').style.left=(Math.min(1,acc)*100)+'%'; }
function tickScore(){ if(!G)return; if(G.displayScore<G.score){ G.displayScore+=Math.ceil((G.score-G.displayScore)/6); if(G.displayScore>G.score)G.displayScore=G.score; } $('#score').textContent=String(Math.floor(G.displayScore)).padStart(8,'0'); }

let rafId=null;
function loop(){ rafId=requestAnimationFrame(loop); if(!G||G.ended) return;
  const playing=G.started&&!G.paused; const t=G.started?songTime():0; if(!playing){ draw(t); return; }
  for(const n of G.notes){ if(n.state==='idle'&&!n.headJudged&&t-n.t>WIN.GOOD){ n.headJudged=true; n.state='miss'; applyJudge('MISS',n.lane); }
    if(n.state==='holding'){ const tail=n.t+n.hold; if(t>=tail){ n.state='done'; applyJudge('PERFECT',n.lane); triggerHit(n.lane,'PERFECT'); } else if(!G.lanePressed[n.lane]&&t>n.t+0.12){ n.state='done'; } } }
  if(G.feverActive&&t>=G.feverEnd) endFever();
  const lim=G.limit; $('#progFill').style.width=Math.min(100,t/lim*100)+'%'; $('#timeLabel').textContent=fmt(Math.max(0,t))+' / '+fmt(lim);
  if(t>=lim+0.3&&!G.ended) endGame(); tickScore(); draw(t); }
function fmt(s){ s=Math.floor(s); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }

function draw(t){ ctx.clearRect(0,0,W,H); const {cx,hitY,topY,botX}=geo;
  for(let i=0;i<=LANES;i++){ const bx=cx+(i-LANES/2)*geo.laneW, tx=cx+(bx-cx)*0.17; ctx.beginPath(); ctx.moveTo(tx,topY); ctx.lineTo(bx,hitY+18); ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.lineWidth=1.2; ctx.stroke(); }
  for(let i=0;i<LANES;i++){ const flash=G.laneFlash[i]; if(flash>0.01||G.lanePressed[i]){ const a=Math.max(flash,G.lanePressed[i]?0.18:0); const lx=botX[i]-geo.laneW/2,rx=botX[i]+geo.laneW/2,ltx=cx+(lx-cx)*0.17,rtx=cx+(rx-cx)*0.17;
      const grd=ctx.createLinearGradient(0,topY,0,hitY); grd.addColorStop(0,'rgba(255,255,255,0)'); grd.addColorStop(1,hexA(LANE_COLORS[i].a,a*0.55));
      ctx.beginPath(); ctx.moveTo(ltx,topY); ctx.lineTo(rtx,topY); ctx.lineTo(rx,hitY+18); ctx.lineTo(lx,hitY+18); ctx.closePath(); ctx.fillStyle=grd; ctx.fill(); } G.laneFlash[i]*=0.86; }
  const lg=ctx.createLinearGradient(0,hitY-4,0,hitY+4); lg.addColorStop(0,'rgba(255,255,255,0)'); lg.addColorStop(.5,'rgba(255,255,255,.9)'); lg.addColorStop(1,'rgba(255,255,255,0)'); ctx.fillStyle=lg; ctx.fillRect(botX[0]-geo.laneW*0.7,hitY-3,(botX[3]-botX[0])+geo.laneW*1.4,6);
  for(let i=0;i<LANES;i++) drawCircle(botX[i],hitY,geo.laneW*0.34,LANE_COLORS[i],Math.max(G.laneFlash[i],G.lanePressed[i]?0.4:0.15));
  const travel=G.travel;
  for(const n of G.notes){ if(n.state==='done'||n.state==='miss') continue; const dt=n.t-t;
    if(n.hold>0){ const tailDt=(n.t+n.hold)-t; const pHead=clamp(1-dt/travel,0,1.15), pTail=clamp(1-tailDt/travel,0,1.15); if(pTail>0&&pHead<1.15) drawHoldBody(n.lane,Math.min(pHead,1),Math.min(pTail,1)); }
    if(n.state==='holding') continue; if(dt>travel||dt<-WIN.GOOD-0.05) continue; drawNote(n.lane,clamp(1-dt/travel,0,1)); }
  for(let i=G.particles.length-1;i>=0;i--){ const p=G.particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=0.035; if(p.life<=0){G.particles.splice(i,1);continue;} ctx.globalAlpha=p.life; ctx.fillStyle=p.col; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,7); ctx.fill(); } ctx.globalAlpha=1; }
function lanePos(lane,p){ const x=geo.topX[lane]+(geo.botX[lane]-geo.topX[lane])*p, y=geo.topY+(geo.hitY-geo.topY)*p, scale=0.32+0.68*p; return {x,y,scale}; }
function drawNote(lane,p){ const {x,y,scale}=lanePos(lane,p); const w=geo.noteBaseW*scale,h=18*scale,c=LANE_COLORS[lane];
  ctx.save(); ctx.translate(x,y); if(!LITE){ctx.shadowColor=c.a; ctx.shadowBlur=16*scale;} const g=ctx.createLinearGradient(0,-h/2,0,h/2); g.addColorStop(0,'#ffffff'); g.addColorStop(.35,c.a); g.addColorStop(1,c.b);
  roundRect(-w/2,-h/2,w,h,h/2); ctx.fillStyle=g; ctx.fill(); ctx.globalAlpha=.9; ctx.fillStyle='rgba(255,255,255,.85)'; roundRect(-w/2+w*0.12,-h/2+2*scale,w*0.76,3*scale,2); ctx.fill(); ctx.restore(); }
function drawHoldBody(lane,pHead,pTail){ const a=lanePos(lane,pTail),b=lanePos(lane,pHead),c=LANE_COLORS[lane]; ctx.save(); ctx.beginPath(); const wa=geo.noteBaseW*a.scale*0.6,wb=geo.noteBaseW*b.scale*0.6;
  ctx.moveTo(a.x-wa/2,a.y); ctx.lineTo(a.x+wa/2,a.y); ctx.lineTo(b.x+wb/2,b.y); ctx.lineTo(b.x-wb/2,b.y); ctx.closePath(); ctx.fillStyle=hexA(c.a,0.45); if(!LITE){ctx.shadowColor=c.a; ctx.shadowBlur=12;} ctx.fill(); ctx.restore(); }
function drawCircle(x,y,r,c,intensity){ ctx.save(); ctx.translate(x,y); ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.strokeStyle=hexA(c.a,0.5+intensity*0.5); ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,r*0.7,0,7); ctx.strokeStyle=hexA(c.b,0.4); ctx.lineWidth=1.4; ctx.stroke(); ctx.rotate(Math.PI/4); const s=r*0.38*(1+intensity*0.4); const g=ctx.createLinearGradient(-s,-s,s,s); g.addColorStop(0,'#fff'); g.addColorStop(1,c.a);
  ctx.shadowColor=c.a; if(!LITE)ctx.shadowBlur=14+intensity*22; ctx.fillStyle=g; ctx.fillRect(-s/2,-s/2,s,s); ctx.restore(); }
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function clamp(v,a,b){ return v<a?a:v>b?b:v; }
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

/* ============ input ============ */
function laneFromX(clientX){ const r=stage.getBoundingClientRect(),x=clientX-r.left; let best=0,bd=1e9; for(let i=0;i<LANES;i++){const d=Math.abs(x-geo.botX[i]); if(d<bd){bd=d;best=i;}} return best; }
const activeTouches={};
stage.addEventListener('touchstart',e=>{ if(!G||!G.started||G.paused||G.ended)return; for(const tch of e.changedTouches){ if(tch.target&&tch.target.closest&&tch.target.closest('#pauseBtn,.screen'))continue; const lane=laneFromX(tch.clientX); activeTouches[tch.identifier]=lane; G.lanePressed[lane]=true; judgeTap(lane); } e.preventDefault(); },{passive:false});
stage.addEventListener('touchend',e=>{ for(const tch of e.changedTouches){ const lane=activeTouches[tch.identifier]; if(lane!==undefined){ delete activeTouches[tch.identifier]; if(!Object.values(activeTouches).includes(lane)) G.lanePressed[lane]=false; } } },{passive:false});
stage.addEventListener('touchcancel',e=>{ for(const tch of e.changedTouches){ const l=activeTouches[tch.identifier]; if(l!==undefined){delete activeTouches[tch.identifier]; G.lanePressed[l]=false;} } });
stage.addEventListener('mousedown',e=>{ if(!G||!G.started||G.paused||G.ended)return; if(e.target&&e.target.closest&&e.target.closest('#pauseBtn,.screen'))return; const lane=laneFromX(e.clientX); G.lanePressed[lane]=true; judgeTap(lane); });
window.addEventListener('mouseup',()=>{ if(G)G.lanePressed=[false,false,false,false]; });
window.addEventListener('keydown',e=>{ if(e.repeat)return; const lane=LANE_KEYS.indexOf(e.key.toLowerCase()); if(lane>=0&&G&&G.started&&!G.paused&&!G.ended){ G.lanePressed[lane]=true; judgeTap(lane); } });
window.addEventListener('keyup',e=>{ const lane=LANE_KEYS.indexOf(e.key.toLowerCase()); if(lane>=0&&G) G.lanePressed[lane]=false; });

/* ============ jacket art ============ */
let _jid=0;
function jacketSVG(song){ const id='jg'+(_jid++); if(song.id==='sakura') return sakuraJacket(id); if(song.id==='seaoff') return liveJacket(id); return gradJacket(id, song.c1||'#ffb3df', song.c2||'#9b6bff', song.icon||'\uD83C\uDFB5'); }
function flower(x,y,r,col){ let s=`<g transform="translate(${x},${y})">`; for(let i=0;i<5;i++) s+=`<ellipse cx="0" cy="${-r}" rx="${r*0.52}" ry="${r}" fill="${col}" transform="rotate(${i*72})"/>`; s+=`<circle r="${r*0.4}" fill="#fff4c2"/></g>`; return s; }
function star4(x,y,r,col){ return `<path d="M${x} ${y-r} L${x+r*0.3} ${y-r*0.3} L${x+r} ${y} L${x+r*0.3} ${y+r*0.3} L${x} ${y+r} L${x-r*0.3} ${y+r*0.3} L${x-r} ${y} L${x-r*0.3} ${y-r*0.3} Z" fill="${col}"/>`; }
function sakuraJacket(id){ return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd0ec"/><stop offset="0.55" stop-color="#e7a8ff"/><stop offset="1" stop-color="#9b6bff"/></linearGradient></defs><rect width="100" height="100" fill="url(#${id})"/><circle cx="50" cy="58" r="40" fill="rgba(255,255,255,0.12)"/>${flower(26,30,11,'#ff9ed4')}${flower(72,40,14,'#ffb3df')}${flower(46,68,10,'#ff8fcf')}${flower(80,75,8,'#ffc6e8')}${star4(15,62,5,'#fff3b0')}${star4(88,22,4,'#fff3b0')}${star4(60,18,3.5,'#ffffff')}${star4(34,85,3.5,'#ffffff')}</svg>`; }
function liveJacket(id){ return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ff9ec4"/><stop offset="0.5" stop-color="#b86bd6"/><stop offset="1" stop-color="#5f7bff"/></linearGradient></defs><rect width="100" height="100" fill="url(#${id})"/><polygon points="50,0 18,100 38,100" fill="rgba(255,255,255,0.16)"/><polygon points="50,0 82,100 62,100" fill="rgba(255,255,255,0.12)"/><g transform="translate(50,40)"><rect x="-9" y="-20" width="18" height="34" rx="9" fill="#3a2150"/><circle cx="0" cy="-11" r="7.5" fill="#d9c4ff"/><line x1="-6" y1="-15" x2="6" y2="-15" stroke="#7a5ba8" stroke-width="1"/><line x1="-6" y1="-11" x2="6" y2="-11" stroke="#7a5ba8" stroke-width="1"/><line x1="-6" y1="-7" x2="6" y2="-7" stroke="#7a5ba8" stroke-width="1"/><rect x="-2" y="14" width="4" height="26" rx="2" fill="#2c1840"/></g><path d="M24 76 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 q0 6 -10 12 q-10 -6 -10 -12 Z" fill="#ff6ec0"/>${star4(82,26,5,'#fff3b0')}${star4(16,30,4,'#ffffff')}</svg>`; }
function gradJacket(id,c1,c2,icon){ return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${id})"/>${star4(78,24,5,'#fff3b0')}${star4(22,30,4,'#ffffff')}<text x="50" y="64" font-size="40" text-anchor="middle">${icon}</text></svg>`; }

/* ============ song list / data ============ */
let MANIFEST_SONGS=[], sessionSongs=[];
function allSongs(){ return MANIFEST_SONGS.concat(sessionSongs); }
const TABS=[{k:'all',label:'すべて',ic:'\u266A'},{k:'POPS',label:'POPS',ic:'\u266B'},{k:'KAWAII',label:'KAWAII',ic:'\u2665'},{k:'BPM',label:'BPM',ic:'\u3030'},{k:'オリジナル',label:'オリジナル',ic:'\u265B'}];
const NAV=[{k:'home',label:'ホーム',ic:'\uD83C\uDFF0'},{k:'music',label:'楽曲',ic:'\uD83C\uDFB5',sel:true},{k:'shop',label:'ショップ',ic:'\uD83D\uDECD\uFE0F'}];
let curTab='all', favOnly=false; const favorites=new Set();
function buildTabs(){ const wrap=$('#tabs'); wrap.innerHTML=''; TABS.forEach(t=>{ const el=document.createElement('div'); el.className='tab'+(t.k===curTab?' sel':''); el.innerHTML=`<span class="ic">${t.ic}</span>${t.label}`; el.onclick=()=>{ curTab=t.k; buildTabs(); renderSongs(); }; wrap.appendChild(el); }); }
function buildNav(){ const wrap=$('#bottomNav'); wrap.innerHTML=''; NAV.forEach(n=>{ const el=document.createElement('div'); el.className='nav-item'+(n.sel?' sel':''); el.innerHTML=`<span class="ic">${n.ic}</span>${n.label}`; el.onclick=()=>{ if(n.k==='shop') openShop(); else if(!n.sel) toast(n.label+'は準備中だよ \u2728'); }; wrap.appendChild(el); }); }
function filteredSongs(){ let arr=allSongs().slice(); if(favOnly) arr=arr.filter(s=>favorites.has(s.id)); if(curTab==='BPM') arr.sort((a,b)=>(a.bpm||999)-(b.bpm||999)); else if(curTab!=='all') arr=arr.filter(s=>(s.genres||[]).includes(curTab)); return arr; }
function renderSongs(){ const list=$('#songList'); list.innerHTML=''; const arr=filteredSongs();
  if(!arr.length){ list.innerHTML='<div class="empty-msg">'+(allSongs().length? '該当する曲がないみたい…<br>タブやお気に入りを変えてみてね' : '曲が読み込めませんでした。<br>サーバー/GitHub Pagesで開くか、<br>「MP3を追加」から端末の曲を選んでね')+'</div>'; }
  else arr.forEach(song=>{ const el=document.createElement('div'); el.className='song-item'+(song.isNew?' new':'');
    const g=(song.genres&&song.genres[0])||'ORIGINAL'; const bpm=song.bpm?('BPM '+Math.round(song.bpm)):'BPM ?'; const dur=song.duration?fmt(song.duration):'--:--';
    const chips=[`<span class="chip g">${g}</span>`,`<span class="chip">${bpm}</span>`,`<span class="chip">${dur}</span>`].join('');
    el.innerHTML=`<div class="jacket">${song.isNew?'<span class="new-badge">NEW</span>':''}${jacketSVG(song)}</div><div class="si-info"><div class="si-title">${song.title}</div><div class="si-artist">${song.artist||''}</div><div class="si-chips">${chips}</div></div><span class="fav-star${favorites.has(song.id)?' on':''}">\u2605</span>`;
    el.querySelector('.fav-star').onclick=(e)=>{ e.stopPropagation(); if(favorites.has(song.id))favorites.delete(song.id); else favorites.add(song.id); renderSongs(); };
    el.onclick=()=>openOptions(song); list.appendChild(el); });
  if(SHOW_CHAR){ const c=document.createElement('img'); c.className='menu-char-inline'; c.src=CUR_CHAR_IMG; c.alt=''; list.appendChild(c); } }

/* ============ options ============ */
async function openOptions(song){
  AudioEngine.stopPreview(); resetPreviewBtn();
  $('#optJacket').innerHTML=jacketSVG(song); $('#optTitle').textContent=song.title; $('#optSub').textContent=(song.artist||'')+(song.sub?(' ・ '+song.sub):''); $('#optBpm').textContent='読み込み中…';
  $('#diffSelect').innerHTML='<div class="opt-pill"><div class="pn">…</div></div>'; $('#lengthSelect').innerHTML='';
  $('#songSelectScreen').classList.add('hidden'); $('#startScreen').classList.remove('hidden');
  try{ await loadSongData(song); }
  catch(e){ console.error(e); $('#optBpm').textContent='読み込み失敗'; toast('曲を読み込めませんでした'); return; }
  selectedSong=song;
  $('#optBpm').textContent='BPM '+Math.round(song.bpm)+' ・ '+fmt(song.duration);
  if(song.bpm) renderSongs();
  buildDiffSelect(); buildLengthSelect();
}
async function loadSongData(song){ await AudioEngine.ensure(song);
  if(!song._chart){ if(song.chart && song.chart!=='auto'){ const res=await fetch(song.chart); if(!res.ok) throw new Error('chart fetch'); song._chart=await res.json(); }
    else { song._chart=AutoChart.generate(AudioEngine.buffer); } }
  if(!song.bpm) song.bpm=song._chart.bpm; song.duration=song._chart.duration||song.duration||AudioEngine.buffer.duration; }
function buildDiffSelect(){ const wrap=$('#diffSelect'); wrap.innerHTML=''; ['EASY','NORMAL','HARD'].forEach(key=>{ const c=selectedSong._chart.charts[key]; const d=document.createElement('div'); d.className='opt-pill'+(key===diffKey?' sel':'');
  d.innerHTML=`<div class="pn">${key}</div><div class="pd">${c.notes.length} notes</div>`; d.onclick=()=>{ diffKey=key; wrap.querySelectorAll('.opt-pill').forEach(o=>o.classList.remove('sel')); d.classList.add('sel'); }; wrap.appendChild(d); }); }
function buildLengthSelect(){ const wrap=$('#lengthSelect'); wrap.innerHTML=''; ['30','60','FULL'].forEach(key=>{ const meta=LENGTHS[key]; const dur=Math.min(meta.sec,selectedSong.duration); const d=document.createElement('div'); d.className='opt-pill'+(key===lengthKey?' sel':'');
  d.innerHTML=`<div class="pn">${meta.label}</div><div class="pd">${key==='FULL'?fmt(selectedSong.duration):fmt(dur)}</div>`; d.onclick=()=>{ lengthKey=key; wrap.querySelectorAll('.opt-pill').forEach(o=>o.classList.remove('sel')); d.classList.add('sel'); }; wrap.appendChild(d); }); }

/* preview button */
function resetPreviewBtn(){ const b=$('#previewBtn'); b.classList.remove('playing'); b.innerHTML='&#9654; 視聴'; }
function onPreviewEnded(){ resetPreviewBtn(); }
$('#previewBtn').onclick=async()=>{ const b=$('#previewBtn'); if(AudioEngine.previewing){ AudioEngine.stopPreview(); resetPreviewBtn(); return; }
  if(!selectedSong) return; b.classList.add('playing'); b.innerHTML='&#9632; 停止';
  try{ await AudioEngine.startPreview(selectedSong); }catch(e){ console.error(e); resetPreviewBtn(); toast('視聴できませんでした'); } };

/* ============ flow ============ */
function updateSongCard(){ $('#cardTitle').textContent=selectedSong.title; $('#cardSub').textContent=selectedSong.artist||''; $('#diffBadge').textContent=diffKey; $('#lenBadge').textContent=LENGTHS[lengthKey].label; $('#lvLabel').textContent=chartOf(selectedSong).notes.length+' notes'; }
async function startGame(){ AudioEngine.stopPreview(); resetPreviewBtn();
  $('#startScreen').classList.add('hidden'); $('#loadingText').textContent='よみこみちゅう…'; $('#loading').classList.remove('hidden');
  try{ await loadSongData(selectedSong); }catch(e){ console.error(e); $('#loadingText').textContent='読み込み失敗。戻ってもう一度お試しください。'; return; }
  $('#loading').classList.add('hidden'); updateSongCard(); newGame(); AudioEngine.setLatencyOffset(latencyMs); stage.classList.add('playing');
  const cd=$('#countdown'); cd.classList.remove('hidden'); let n=3; const showN=()=>cd.innerHTML=`<div class="c">${n>0?n:'GO!'}</div>`; showN();
  const iv=setInterval(()=>{ n--; if(n<0){clearInterval(iv); cd.classList.add('hidden'); reallyStart();} else showN(); },900); }
function reallyStart(){ G.started=true; G.paused=false; G.ended=false; AudioEngine.play(0); updateHUD(); }
function onSrcEnded(){ if(G&&!G.ended&&songTime()>=G.limit-0.4) endGame(); }
function clearReward(){ if(G.failed) return {total:0,parts:[]};
  const lenF=lengthKey==='30'?0.5:lengthKey==='60'?0.75:1.0; const base=Math.round({EASY:30,NORMAL:50,HARD:80}[diffKey]*lenF);
  const acc=G.accCount?G.accWeight/G.accCount:0; const rankB=acc>=0.95?200:acc>=0.90?120:acc>=0.80?70:acc>=0.68?40:acc>=0.5?20:0;
  const scoreB=Math.floor(G.score/20000)*10; const fc=(G.counts.MISS===0&&G.totalNotes>0)?50:0;
  const parts=[['クリア',base],['ランク',rankB],['スコア',scoreB]]; if(fc)parts.push(['フルコンボ',fc]);
  return {total:base+rankB+scoreB+fc, parts}; }
function rankOf(acc,failed){ return failed?'F':acc>=0.95?'SS':acc>=0.90?'S':acc>=0.80?'A':acc>=0.68?'B':acc>=0.5?'C':'D'; }
function starsForRank(r){ return ({SS:5,S:5,A:4,B:3,C:2,D:1,F:0})[r]||0; }
function hsKey(){ return 'pk_hs_'+selectedSong.id+'_'+diffKey+'_'+lengthKey; }
function getHS(){ try{ return parseInt(localStorage.getItem(hsKey()),10)||0; }catch(e){ return 0; } }
function setHS(v){ try{ localStorage.setItem(hsKey(),String(v)); }catch(e){} }
function countUp(el,to,dur,fmt){ if(!el)return; dur=dur||850; fmt=fmt||(v=>Math.round(v).toLocaleString()); const start=performance.now();
  function step(now){ const p=Math.min(1,(now-start)/dur); const e=1-Math.pow(1-p,3); el.textContent=fmt(to*e); if(p<1)requestAnimationFrame(step); else el.textContent=fmt(to); }
  requestAnimationFrame(step); }
function buildHisto(offsets){ const wrap=$('#histo'); wrap.innerHTML=''; const BINS=13,RANGE=0.16,mid=(BINS-1)/2; const bins=new Array(BINS).fill(0);
  offsets.forEach(o=>{ let idx=Math.round((o/RANGE)*mid+mid); idx=Math.max(0,Math.min(BINS-1,idx)); bins[idx]++; });
  const mx=Math.max(1,...bins);
  bins.forEach((c,i)=>{ const b=document.createElement('div'); b.className='bar'+(Math.abs(i-mid)<=1?' mid':''); b.style.height='2px'; wrap.appendChild(b); setTimeout(()=>{ b.style.height=(3+c/mx*66)+'px'; },120+i*30); }); }
function updateScrollHint(){ const b=$('#resultBody'),h=$('#scrollHint'); if(!b||!h)return; const more=(b.scrollHeight-b.clientHeight)>12; const atBottom=(b.scrollTop+b.clientHeight)>=(b.scrollHeight-16); h.classList.toggle('hide', !more||atBottom); }
function endGame(){ if(!G||G.ended) return; G.ended=true; G.started=false; AudioEngine.stop(); endFever(); stage.classList.remove('playing');
  const acc=G.accCount?G.accWeight/G.accCount:0, rank=rankOf(acc,G.failed);
  const allPerfect=!G.failed&&G.counts.GREAT===0&&G.counts.GOOD===0&&G.counts.MISS===0&&G.counts.PERFECT>0;
  const fullCombo=!G.failed&&G.counts.MISS===0&&G.totalNotes>0;
  $('#resDiff').textContent=diffKey;
  const st=starsForRank(rank); $('#resStars').innerHTML='<b>'+'\u2605'.repeat(st)+'</b>'+'\u2606'.repeat(5-st);
  $('#resJacket').innerHTML=jacketSVG(selectedSong); $('#resTitle').textContent=selectedSong.title; $('#resArtist').textContent=selectedSong.artist||'';
  $('#resultRank').textContent=rank;
  const banner=$('#resBanner'); banner.classList.toggle('fail',G.failed);
  banner.textContent=G.failed?'FAILED':allPerfect?'ALL PERFECT':fullCombo?'FULL COMBO':'CLEARED';
  $('#fcBadge').classList.toggle('hidden', !(fullCombo||allPerfect));
  $('#resBubble').textContent=G.failed?'うぅ…つぎはきっとできるよ！':allPerfect?'やった〜！完璧だよっ！すごいすごーいっ☆':fullCombo?'ノーミス！その調子だよっ♪':(rank==='S'||rank==='SS')?'すごい！とっても上手っ✨':(rank==='A')?'いい感じ！その調子♪':'クリア！おつかれさまっ☆';
  const rc=$('#resChar'); rc.src=CUR_CHAR_IMG; rc.style.display=SHOW_CHAR?'':'none';
  const prevHS=getHS(), isNew=!G.failed&&G.score>prevHS, newHS=Math.max(prevHS,G.score); if(isNew)setHS(G.score);
  $('#newRec').classList.toggle('hidden',!isNew);
  const rew=clearReward(); Wallet.add(rew.total);
  $('#coinBreakdown').textContent=rew.total?rew.parts.filter(p=>p[1]).map(p=>p[0]+' +'+p[1]).join('\u3000'):(G.failed?'クリアできなかった…コインなし':'');
  const JW=WIN.PERFECT; let late=0,just=0,early=0; G.offsets.forEach(o=>{ if(o>JW)early++; else if(o<-JW)late++; else just++; });
  const rankEl=$('#resultRank'); rankEl.classList.remove('in'); void rankEl.offsetWidth; rankEl.classList.add('in');
  $('#resultScreen').classList.remove('hidden'); $('#resultBody').scrollTop=0; setTimeout(updateScrollHint,60); setTimeout(updateScrollHint,450);
  countUp($('#resNotes'),G.totalNotes,600,v=>Math.round(v));
  countUp($('#resultScore'),G.score,1100); countUp($('#resHigh'),newHS,1100);
  countUp($('#coinReward'),rew.total,900,v=>'\uD83E\uDE99 +'+Math.round(v).toLocaleString());
  countUp($('#rCombo'),G.maxCombo,800,v=>Math.round(v));
  [['#rPerfect',G.counts.PERFECT,150],['#rGreat',G.counts.GREAT,230],['#rGood',G.counts.GOOD,310],['#rMiss',G.counts.MISS,390]].forEach(([id,v,d])=>setTimeout(()=>countUp($(id),v,500,x=>Math.round(x)),d));
  buildHisto(G.offsets);
  setTimeout(()=>{ countUp($('#tLate'),late,500,v=>Math.round(v)); countUp($('#tJust'),just,500,v=>Math.round(v)); countUp($('#tEarly'),early,500,v=>Math.round(v)); },220); }
function pauseGame(){ if(!G||!G.started||G.paused||G.ended)return; G.paused=true; AudioEngine.pause(); $('#pauseVol').value=Math.round(volume*100); $('#pauseOverlay').classList.remove('hidden'); }
function resumeGame(){ if(!G||!G.paused)return; $('#pauseOverlay').classList.add('hidden'); let n=3; const cd=$('#countdown'); cd.classList.remove('hidden'); const showN=()=>cd.innerHTML=`<div class="c">${n>0?n:'GO!'}</div>`; showN();
  const iv=setInterval(()=>{ n--; if(n<0){clearInterval(iv); cd.classList.add('hidden'); G.paused=false; AudioEngine.resume();} else showN(); },700); }
function toSongSelect(){ AudioEngine.stop(); AudioEngine.stopPreview(); resetPreviewBtn(); if(G)G.ended=true; ctx.clearRect(0,0,W,H); stage.classList.remove('playing');
  $('#pauseOverlay').classList.add('hidden'); $('#resultScreen').classList.add('hidden'); $('#startScreen').classList.add('hidden');
  $('#score').textContent='00000000'; $('#comboNum').textContent='0'; $('#scoreAdd').textContent=''; $('#feverFill').style.width='0%'; $('#lifeFill').style.width='100%'; $('#lifeVal').textContent='1000'; $('#progFill').style.width='0%'; stage.classList.remove('fever');
  renderSongs(); $('#songSelectScreen').classList.remove('hidden'); }

let toastTimer=null;
function toast(msg){ const el=$('#toast'); el.innerHTML=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),1900); }
function syncCal(){ $('#calVal').textContent=latencyMs+' ms'; }
function setVol(v){ volume=v; AudioEngine.setVolume(v); const a=$('#volRange'),b=$('#pauseVol'); if(a)a.value=Math.round(v*100); if(b)b.value=Math.round(v*100); }
/* key config */
let rebindLane=-1;
function loadKeys(){ try{ const k=localStorage.getItem('pk_keys'); if(k){ const arr=JSON.parse(k); if(Array.isArray(arr)&&arr.length===4) LANE_KEYS=arr.map(x=>String(x).toLowerCase()); } }catch(e){} }
function saveKeys(){ try{ localStorage.setItem('pk_keys',JSON.stringify(LANE_KEYS)); }catch(e){} }
function keyLabel(k){ if(k===' '||k==='spacebar'||k==='space')return 'Space'; if(k==='arrowleft')return '\u2190'; if(k==='arrowright')return '\u2192'; if(k==='arrowup')return '\u2191'; if(k==='arrowdown')return '\u2193'; return k.length===1?k.toUpperCase():k; }
function updateKeyHint(){ const h=$('#playHint'); if(h) h.textContent='タップ：4レーンを叩こう！　PC：'+LANE_KEYS.map(keyLabel).join(' / '); }
function renderKeyConfig(){ const wrap=$('#keyCfg'); if(!wrap)return; wrap.innerHTML='';
  LANE_KEYS.forEach((k,i)=>{ const b=document.createElement('div'); b.className='keycap'+(rebindLane===i?' wait':'');
    b.innerHTML='<span class="dot" style="background:'+LANE_COLORS[i].a+'"></span>'+(rebindLane===i?'押す…':keyLabel(k));
    b.onclick=()=>{ rebindLane=(rebindLane===i?-1:i); renderKeyConfig(); }; wrap.appendChild(b); });
  updateKeyHint(); }
function setLaneKey(lane,k){ const other=LANE_KEYS.indexOf(k); if(other>=0&&other!==lane) LANE_KEYS[other]=LANE_KEYS[lane]; LANE_KEYS[lane]=k; saveKeys(); }
window.addEventListener('keydown',e=>{ if(rebindLane<0)return; const k=(e.key||'').toLowerCase();
  if(['shift','control','alt','meta','capslock','tab','contextmenu','dead'].includes(k))return;
  e.preventDefault(); e.stopImmediatePropagation();
  if(k==='escape'){ rebindLane=-1; renderKeyConfig(); return; }
  setLaneKey(rebindLane,k); rebindLane=-1; renderKeyConfig(); }, true);
function openShop(){ updateShopCoins(); renderShop(); $('#songSelectScreen').classList.add('hidden'); $('#shopScreen').classList.remove('hidden'); }
function closeShop(){ $('#shopScreen').classList.add('hidden'); $('#songSelectScreen').classList.remove('hidden'); }
function updateShopCoins(){ const e=$('#shopCoinVal'); if(e)e.textContent=Wallet.coins.toLocaleString(); }
function renderShop(){ const grid=$('#shopGrid'); grid.innerHTML='';
  CHARACTERS.forEach(c=>{ const owned=CharStore.owned.has(c.id), eq=CharStore.equipped===c.id;
    const card=document.createElement('div'); card.className='shop-card'+(eq?' equipped':'');
    const btn = eq?'<button class="shop-btn equipped">選択中</button>' : owned?'<button class="shop-btn select">選択する</button>' : '<button class="shop-btn buy">\uD83E\uDE99 '+c.price+'</button>';
    card.innerHTML='<div class="shop-portrait" style="background:linear-gradient(160deg,'+c.c1+','+c.c2+')"><img src="'+c.img+'" alt=""></div><div class="shop-name">'+c.name+'</div>'+btn;
    const b=card.querySelector('.shop-btn');
    if(!eq&&owned){ b.onclick=()=>{ CharStore.equipped=c.id; CharStore.save(); applyCharacter(); renderShop(); toast(c.name+'に変更したよ \u2728'); }; }
    else if(!owned){ b.onclick=()=>{ if(Wallet.coins<c.price){ toast('コインが足りないよ…'); return; } Wallet.add(-c.price); CharStore.owned.add(c.id); CharStore.equipped=c.id; CharStore.save(); applyCharacter(); updateShopCoins(); renderShop(); toast(c.name+'を購入！ \u2728'); }; }
    grid.appendChild(card); }); }
function loadPrefs(){ try{ LITE=localStorage.getItem('pk_lite')==='1'; const c=localStorage.getItem('pk_char'); SHOW_CHAR=(c===null)?true:(c==='1'); }catch(e){} }
function applyLite(){ stage.classList.toggle('lite',LITE); const b=$('#liteToggle'); if(b){b.textContent=LITE?'ON':'OFF'; b.classList.toggle('on',LITE);} resize(); }
function applyChar(){ const b=$('#charToggle'); if(b){b.textContent=SHOW_CHAR?'ON':'OFF'; b.classList.toggle('on',SHOW_CHAR);} const ci=$('#charImg'); if(ci)ci.style.display=SHOW_CHAR?'':'none'; renderSongs(); }

/* ============ import mp3 ============ */
const PASTELS=[['#ff9ad4','#9b6bff'],['#ff8fb0','#6fb0ff'],['#ffd6a0','#ff8fc0'],['#a0f0d0','#6fb0ff'],['#c9a0ff','#ff9ad4']];
$('#importBtn').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=(e)=>{ const files=[...e.target.files]; let added=0, skipped=0;
  files.forEach((f)=>{ const isAudio=(f.type&&f.type.startsWith('audio'))||/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|3gp|webm)$/i.test(f.name);
    if(!isAudio){ skipped++; return; }
    const id='local_'+Date.now()+'_'+added; const pc=PASTELS[added%PASTELS.length];
    sessionSongs.push({ id, title:f.name.replace(/\.[^.]+$/,''), artist:'インポート', sub:'', genres:['オリジナル'], isNew:false, c1:pc[0], c2:pc[1], icon:'\uD83C\uDFB6', file:f, chart:'auto' }); added++; });
  e.target.value=''; if(added){ renderSongs(); toast(added+'曲を追加したよ（自動譜面）\u2728'); } else toast(skipped? '音声ファイルではないみたい…' : '音声ファイルを選んでね'); };

/* ============ bindings ============ */
$('#startBtn').onclick=startGame;
$('#backToSongs').onclick=()=>{ AudioEngine.stopPreview(); resetPreviewBtn(); $('#startScreen').classList.add('hidden'); $('#songSelectScreen').classList.remove('hidden'); };
$('#pauseBtn').onclick=pauseGame;
$('#resumeBtn').onclick=resumeGame;
$('#restartBtn').onclick=()=>{ $('#pauseOverlay').classList.add('hidden'); AudioEngine.stop(); startGame(); };
$('#quitBtn').onclick=toSongSelect;
$('#retryBtn').onclick=()=>{ $('#resultScreen').classList.add('hidden'); startGame(); };
$('#backBtn').onclick=toSongSelect;
$('#shareBtn').onclick=()=>{ if(!selectedSong)return; const txt='Pastel Kingdom Rhythm \uD83C\uDFB5\n'+selectedSong.title+' ['+diffKey+']\nSCORE '+(G?G.score.toLocaleString():'0')+' / '+$('#resultRank').textContent+' '+$('#resBanner').textContent;
  if(navigator.share){ navigator.share({title:'Pastel Kingdom Rhythm',text:txt}).catch(()=>{}); }
  else if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(()=>toast('結果をコピーしたよ \u2728')).catch(()=>toast('コピーできませんでした')); }
  else toast('共有に対応していません'); };
$('#favBtn').onclick=()=>{ favOnly=!favOnly; $('#favBtn').classList.toggle('on',favOnly); renderSongs(); };
$('#gearBtn').onclick=()=>{ $('#volRange').value=Math.round(volume*100); rebindLane=-1; renderKeyConfig(); $('#settingsPopup').classList.remove('hidden'); };
$('#closeSettings').onclick=()=>{ rebindLane=-1; renderKeyConfig(); $('#settingsPopup').classList.add('hidden'); };
$('#volRange').oninput=(e)=>setVol(e.target.value/100);
$('#pauseVol').oninput=(e)=>setVol(e.target.value/100);
$('#calMinus').onclick=()=>{ latencyMs-=10; syncCal(); };
$('#calPlus').onclick=()=>{ latencyMs+=10; syncCal(); };
$('#liteToggle').onclick=()=>{ LITE=!LITE; try{localStorage.setItem('pk_lite',LITE?'1':'0');}catch(e){} applyLite(); };
$('#charToggle').onclick=()=>{ SHOW_CHAR=!SHOW_CHAR; try{localStorage.setItem('pk_char',SHOW_CHAR?'1':'0');}catch(e){} applyChar(); };
$('#profileBtn').onclick=openShop;
$('#shopBack').onclick=closeShop;

function buildStars(){ const layer=$('#starsLayer'); for(let i=0;i<18;i++){ const s=document.createElement('div'); s.className='bgstar'; s.textContent=Math.random()<.5?'\u2726':'\u2727'; s.style.left=Math.random()*100+'%'; s.style.top=Math.random()*100+'%'; s.style.fontSize=(8+Math.random()*16)+'px'; s.style.animationDelay=(Math.random()*2.6)+'s'; layer.appendChild(s); }
  for(let i=0;i<4;i++){ const m=document.createElement('div'); m.className='macaron'; m.style.left=Math.random()*86+'%'; m.style.top=(Math.random()*55)+'%'; m.style.transform=`scale(${0.7+Math.random()*0.8})`; layer.appendChild(m); } }
async function loadManifest(){ try{ const res=await fetch('songs.json'); if(!res.ok) throw new Error('manifest '+res.status); const data=await res.json();
    MANIFEST_SONGS=data.songs||[]; }
  catch(e){ console.warn('manifest load failed:',e.message); MANIFEST_SONGS=[]; } }
async function boot(){ loadPrefs(); loadKeys(); CharStore.load(); resize(); buildStars();
  Wallet.load(); updateCoinUI(); buildTabs(); buildNav(); syncCal(); applyLite(); applyChar(); applyCharacter(); renderKeyConfig(); requestAnimationFrame(loop);
  const rb=$('#resultBody'); if(rb) rb.addEventListener('scroll',updateScrollHint);
  await loadManifest(); renderSongs(); }
boot();
