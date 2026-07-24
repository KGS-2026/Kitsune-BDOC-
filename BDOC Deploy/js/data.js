// ============================================================
// BDOC PHASE 2 MODULE: data.js
// Request cache + Health monitor + safeFetch wrapper
// Extracted from index.html lines 1174-1295 (Turn 5, 2026-04-22)
// Depends on (defined in main inline script):
//   CFG.version                     — used in dashboard footer + heartbeat payload
//   DOM IDs: liveDot, health-inner, health-dash
//   CSS classes: .hd-feed, .hd-nm, .hd-st, .hd-row
//   /.netlify/functions/proxy-supabase — heartbeat endpoint
// Exposed globally as: Cache, Health, safeFetch (const/function decls auto-share
//   the global lexical environment across classic <script>s) + explicit window.* mirrors.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ SECTION 2: REQUEST CACHE ═══
const Cache={
  _c:new Map(),_p:new Map(),
  maxEntries:200, // LRU cap — evict oldest when exceeded to stop unbounded growth on long sessions
  ttl:{earthquake:120000,aircraft:20000,fires:600000,cables:86400000,satellites:300000,default:60000},
  stats:{hits:0,misses:0,errors:0,evictions:0},
  backoff:{},
  _touch(key){const v=this._c.get(key);if(v){this._c.delete(key);this._c.set(key,v)}}, // move to end = most-recently-used
  _evictIfFull(){while(this._c.size>=this.maxEntries){const oldest=this._c.keys().next().value;if(oldest===undefined)break;this._c.delete(oldest);this.stats.evictions++}},
  async get(key,url,opts={}){
    const ft=opts.feedType||'default';
    const bo=this.backoff[ft];
    if(bo&&Date.now()<bo.until){this.stats.hits++;const c=this._c.get(key);if(c){this._touch(key);return{data:c.data,fromCache:true,backoff:true}}/* No stale data — allow fetch even during backoff instead of death spiral */}
    const max=this.ttl[ft]||this.ttl.default;
    const cached=this._c.get(key);
    if(cached&&(Date.now()-cached.ts)<max){this.stats.hits++;this._touch(key);return{data:cached.data,fromCache:true}}
    if(this._p.has(key))return this._p.get(key);
    const p=this._fetch(key,url,opts,cached);
    this._p.set(key,p);
    try{return await p}finally{this._p.delete(key)}
  },
  async _fetch(key,url,opts,stale){
    this.stats.misses++;
    const ft=opts.feedType||'default';
    try{
      const ctrl=new AbortController();
      const tm=setTimeout(()=>ctrl.abort(),opts.timeout||12000);
      const r=await fetch(url,{signal:ctrl.signal,...(opts.fetchOpts||{})});
      clearTimeout(tm);
      // Phase 7C (2026-05-05): respect 429 Retry-After header so we don't hammer rate-limited APIs
      if(r.status===429){
        const ra=parseInt(r.headers.get('Retry-After'))||60;
        const wait=Math.min(Math.max(ra*1000,30000),900000); // clamp 30s - 15min
        const bo=this.backoff[ft]={delay:wait,until:Date.now()+wait,reason:'429_rate_limit'};
        const err=new Error(`HTTP 429 (rate-limited, retry in ${Math.round(wait/1000)}s)`);
        err.status=429;err.retryAfter=wait;
        if(stale&&opts.staleOk!==false)return{data:stale.data,fromCache:true,stale:true,rateLimited:true};
        throw err;
      }
      if(!r.ok){const err=new Error(`HTTP ${r.status}`);err.status=r.status;throw err;}
      const data=opts.text?await r.text():await r.json();
      this._evictIfFull();
      this._c.set(key,{data,ts:Date.now()});
      delete this.backoff[ft];
      return{data,fromCache:false};
    }catch(e){
      this.stats.errors++;
      // p98: one automatic retry on transient NETWORK errors (Failed to fetch /
      // aborted) — connection-pool saturation when many layers arm at once kills
      // individual fetches that would succeed 2s later. HTTP errors (4xx/5xx) are
      // NOT retried here; they're real answers from the server.
      if(!e.status&&!opts._retried){
        await new Promise(res=>setTimeout(res,2500));
        return this._fetch(key,url,{...opts,_retried:true},stale);
      }
      // Don't override 429 backoff (already set with Retry-After)
      if(e.status!==429){
        const bo=this.backoff[ft]||{delay:15000};
        bo.delay=Math.min(bo.delay*2,300000);
        bo.until=Date.now()+bo.delay;
        bo.reason=e.status?'http_'+e.status:'network';
        this.backoff[ft]=bo;
      }
      if(stale&&opts.staleOk!==false)return{data:stale.data,fromCache:true,stale:true};
      throw e;
    }
  }
};
// ═══ SECTION 3: HEALTH MONITOR + HEARTBEAT ═══
const Health={
  feeds:{},bootTime:Date.now(),dashVis:false,
  reg(name){this.feeds[name]={name,status:'unknown',lastOk:null,lastErr:null,errCount:0,totalFetches:0,dataCount:0,responseMs:null}},
  start(name){const f=this.feeds[name];if(f){f.totalFetches++;f._t0=performance.now()}},
  ok(name,count=0){const f=this.feeds[name];if(!f)return;f.status='healthy';f.lastOk=Date.now();f.errCount=0;f.dataCount=count;f.responseMs=Math.round(performance.now()-(f._t0||0));this.updateLive()},
  err(name,e){const f=this.feeds[name];if(!f)return;f.errCount++;f.lastErr=e?.message||String(e);f.status=f.errCount>=3?'down':'degraded';f.responseMs=Math.round(performance.now()-(f._t0||0));console.warn(`[Health] ${name} err#${f.errCount}:`,f.lastErr);this.updateLive()},
  sysHealth(){
    const ff=Object.values(this.feeds);if(!ff.length)return'unknown';
    const down=ff.filter(f=>f.status==='down').length;
    const deg=ff.filter(f=>f.status==='degraded').length;
    if(down>ff.length/2)return'critical';if(down>0||deg>ff.length/2)return'degraded';
    if(deg>0)return'nominal';return'optimal';
  },
  updateLive(){
    const h=this.sysHealth();const dot=document.getElementById('liveDot');if(!dot)return;
    if(h==='critical'){dot.style.background='var(--rd)';dot.style.boxShadow='0 0 6px var(--rd)'}
    else if(h==='degraded'||h==='nominal'){dot.style.background='var(--yl)';dot.style.boxShadow='0 0 6px var(--yl)'}
    else{dot.style.background='var(--gn)';dot.style.boxShadow='0 0 6px var(--gn)'}
  },
  tAgo(ts){if(!ts)return'never';const s=Math.floor((Date.now()-ts)/1000);if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m';return Math.floor(s/3600)+'h'},
  renderDash(){
    const el=document.getElementById('health-inner');if(!el)return;const h=this.sysHealth();
    const hc={optimal:'color:var(--gn)',nominal:'color:var(--yl)',degraded:'color:var(--yl)',critical:'color:var(--rd)'};
    let html=`<div style="font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:8px;display:flex;gap:6px;align-items:center"><span style="font-family:var(--m);color:var(--kf);font-weight:800">BDOC</span>SYSTEM HEALTH<span style="margin-left:auto;font-size:8px;color:#555">Ctrl+Shift+H</span></div>`;
    html+=`<div style="text-align:center;padding:8px;margin-bottom:8px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:1px;${hc[h]||''}">${h.toUpperCase()} — ${Object.values(this.feeds).filter(f=>f.status==='healthy').length}/${Object.keys(this.feeds).length} FEEDS</div>`;
    for(const[k,f]of Object.entries(this.feeds)){
      html+=`<div class="hd-feed ${f.status}"><div class="hd-nm">${f.name}<span class="hd-st ${f.status}">${f.status.toUpperCase()}</span></div>`;
      html+=`<div class="hd-row"><span>Last OK:</span><span>${this.tAgo(f.lastOk)}</span></div>`;
      html+=`<div class="hd-row"><span>Response:</span><span>${f.responseMs?f.responseMs+'ms':'—'}</span></div>`;
      html+=`<div class="hd-row"><span>Data:</span><span>${f.dataCount}</span></div>`;
      if(f.errCount>0)html+=`<div class="hd-row" style="color:var(--rd)"><span>Errors:</span><span>${f.errCount}</span></div>`;
      html+=`</div>`;
    }
    html+=`<div style="text-align:center;margin-top:8px;font-size:7px;color:#333">BDOC v${CFG.version} · Up: ${this.tAgo(this.bootTime)} · Cache: ${Cache.stats.hits}H/${Cache.stats.misses}M</div>`;
    el.innerHTML=html;
  },
  togDash(){this.dashVis=!this.dashVis;document.getElementById('health-dash').classList.toggle('show',this.dashVis);if(this.dashVis){this.renderDash();if(!this._dashTimer)this._dashTimer=setInterval(()=>{if(this.dashVis)this.renderDash();else{clearInterval(this._dashTimer);this._dashTimer=null}},3000)}},
  async heartbeat(){
    try{
      const payload={feeds:Object.fromEntries(Object.entries(this.feeds).map(([k,v])=>[k,{status:v.status,lastOk:v.lastOk,errCount:v.errCount,dataCount:v.dataCount}])),system:this.sysHealth(),timestamp:new Date().toISOString(),version:CFG.version};
      await fetch('/.netlify/functions/proxy-supabase?table=heartbeats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    }catch(e){console.debug('[Heartbeat] Error:',e.message)}
  },
  init(){
    this.reg('usgs');this.reg('nasa_firms');this.reg('opensky');this.reg('adsb_lol');this.reg('telegeography');this.reg('conflicts');this.reg('celestrak');this.reg('nifc_perimeters');this.reg('power_outages');this.reg('svc_status');this.reg('radio_sigint');this.reg('cell_towers');this.reg('deflock');this.reg('weather');this.reg('maritime');this.reg('air_quality');this.reg('gdelt');this.reg('newsapi');this.reg('space_weather');
    document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key==='H')this.togDash()});
    // PERF FIX: Health dashboard timer now only runs when dashboard is open (see togDash)
    setInterval(()=>this.heartbeat(),300000);
    console.log('[Health] Monitor online — Ctrl+Shift+H for dashboard');
  }
};
// ═══ SECTION 4: SAFE FETCH (wraps Cache + Health) ═══
async function safeFetch(feedName,cacheKey,url,opts={}){
  Health.start(feedName);
  try{
    const result=await Cache.get(cacheKey,url,opts);
    let count=0;
    const d=result.data;
    if(Array.isArray(d))count=d.length;
    else if(d?.features)count=d.features.length;
    else if(d?.states)count=d.states.length;
    else if(d?.ac)count=d.ac.length;
    else if(typeof d==='string')count=d.split('\n').length-1;
    Health.ok(feedName,count);
    // Phase 7C (2026-05-05): surface rate-limit + stale-data conditions to UI
    if(result.rateLimited&&typeof af==='function'){af('var(--yl)',`${feedName}: rate-limited, using cached data`)}
    else if(result.stale&&typeof af==='function'){af('var(--t3)',`${feedName}: API failed, showing stale cache`)}
    return result;
  }catch(e){
    Health.err(feedName,e);
    // Phase 7C: clearer surfaced error so user knows what's wrong, not silent failure
    if(typeof af==='function'){
      const hint=e.status===429?'rate-limited (try again in a few minutes)':e.status?`HTTP ${e.status}`:'network/CORS error';
      af('var(--rd)',`${feedName} unavailable — ${hint}`);
    }
    return{data:null,fromCache:false,error:e};
  }
}
// Explicit window mirrors — defensive for any caller that does window.Cache / window.Health
window.Cache=Cache;
window.Health=Health;
window.safeFetch=safeFetch;
