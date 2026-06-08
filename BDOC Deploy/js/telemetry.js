// ============================================================
// BDOC PHASE 2 MODULE: telemetry.js
// EventLog: in-memory ring buffer (500 entries) + UI render
// Extracted from index.html lines 1335-1344 (Turn 3, 2026-04-22)
// Depends on (defined in main inline script):
//   esc()                     — HTML escape helper
//   #elog-inner, #event-log   — DOM elements
// Exposed globally as: EventLog (const) + window.EventLog (explicit)
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══ EVENT LOG ═══
const EventLog={
  entries:[],vis:false,
  add(sev,message){
    const ts=new Date().toISOString().slice(11,19)+'Z';
    this.entries.push({ts,sev,message});
    if(this.entries.length>500)this.entries.shift();if(this.vis)this.render();
    // Phase 9B (2026-05-05): push to live tactical ticker (only crit/warn/info — skip debug/trace)
    if(typeof BDOC!=='undefined'&&BDOC.ticker&&['crit','warn','info'].includes(sev))BDOC.ticker.push(sev,message,ts);
  },
  render(){document.getElementById('elog-inner').innerHTML=this.entries.slice(-50).reverse().map(e=>`<div class="elog-row"><span class="elog-ts">${e.ts}</span><span class="elog-sev ${e.sev}">${e.sev.toUpperCase()}</span><span class="elog-msg">${esc(e.message)}</span></div>`).join('')},
  toggle(){this.vis=!this.vis;document.getElementById('event-log').classList.toggle('show',this.vis);if(this.vis)this.render()}
};
window.EventLog=EventLog;
