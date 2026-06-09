// ============================================================
// BDOC PHASE 2 MODULE: auth.js
// Authentication & Tier Gating — BDOC_Auth singleton
// Extracted from index.html lines 982-1180 (Turn 11, 2026-04-22)
// Depends on (resolved lazily at call time):
//   CFG (read for Supabase URL/key), document, window, localStorage
//   showMo (mobile/locked layer modal — kept in shell)
//   layers (toggle state — kept in shell)
// CRITICAL: BDOC_Auth is referenced from inline onclick attributes
//   (index.html lines 332, 637, 639, 641, 643).
//   Inline handlers resolve identifiers via window, NOT the Script lexical env.
//   So we mirror to window explicitly at the bottom of this file.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
// ═══════════════════════════════════════════
// SECTION 1.5: AUTHENTICATION & TIER GATING
// ═══════════════════════════════════════════
const BDOC_Auth={
  client:null,user:null,profile:null,tier:'recon',mode:'login',_cfg:null,_devMode:false, // PRODUCTION: default tier is recon (free)
  // ── DEV KEY SYSTEM ──────────────────────────
  // Bookmark: https://yoursite.com/?dev=KGSBDOC-ADMIN-7X
  // Once activated, persists in localStorage until you clear it.
  // Console: BDOC_Auth.devLogout() to revoke dev access
  _DEV_KEYS:['KGSBDOC-ADMIN-7X'],
  checkDevKey(){
    const params=new URLSearchParams(window.location.search);
    const key=params.get('dev');
    // Activate via URL param
    if(key&&this._DEV_KEYS.includes(key)){
      localStorage.setItem('bdoc_dev_key',key);
      window.history.replaceState({},'',window.location.pathname); // clean URL
      console.log('%c[BDOC] DEV MODE ACTIVATED — all features unlocked','color:#3FB950;font-weight:bold;font-size:14px');
    }
    // Check persisted dev key
    const saved=localStorage.getItem('bdoc_dev_key');
    if(saved&&this._DEV_KEYS.includes(saved)){
      this.tier='enterprise';this._devMode=true;
      return true;
    }
    return false;
  },
  devLogout(){localStorage.removeItem('bdoc_dev_key');this._devMode=false;this.tier='recon';this.markLockedLayers();this.updateUI();console.log('[BDOC] Dev mode deactivated')},
  // ────────────────────────────────────────────
  async init(){
    // Check dev key FIRST — skip everything if dev
    if(this.checkDevKey()){this._initialized=true;this.updateUI();this.markLockedLayers();return}
    try{
      const cfgRes=await fetch('/.netlify/functions/config',{signal:AbortSignal.timeout(5000)});
      if(cfgRes.ok)this._cfg=await cfgRes.json();
    }catch(e){console.warn('[Auth] Config fetch failed:',e.message)}
    if(this._cfg&&this._cfg.prices)this._prices=this._cfg.prices;
    if(this._cfg&&this._cfg.supabase_url&&this._cfg.supabase_anon_key&&window.supabase){
      this.client=window.supabase.createClient(this._cfg.supabase_url,this._cfg.supabase_anon_key);
      // Stripe success return — clear the query, force a profile re-sync so tier reflects the new subscription.
      const params=new URLSearchParams(window.location.search);
      const returningFromStripe=params.get('session_id')||params.get('stripe_success');
      if(returningFromStripe){window.history.replaceState({},'',window.location.pathname)}
      // Keep client state in sync with auth changes across tabs / after session refresh.
      try{
        this.client.auth.onAuthStateChange(async(evt,sess)=>{
          // Password recovery: user arrived via reset-email link → prompt for new password
          if(evt==='PASSWORD_RECOVERY'){
            this.user=sess?.user||null;
            this._showView('reset');
            const bg=document.getElementById('authBg');if(bg)bg.style.display='flex';
            return;
          }
          this.user=sess?.user||null;
          if(this.user){await this.loadProfile()}
          else{this.profile=null;this.tier='recon'}
          this.updateUI();this.markLockedLayers();
        });
      }catch(e){console.warn('[Auth] onAuthStateChange wire failed:',e.message)}
      // Check existing session
      try{
        const{data}=await this.client.auth.getSession();
        if(data&&data.session){
          this.user=data.session.user;
          await this.loadProfile();
          if(returningFromStripe){setTimeout(()=>this.loadProfile(),4000)} // webhook may land a beat after redirect
          this._initialized=true;
          return;
        }
      }catch(e){console.warn('[Auth] Session check failed:',e.message)}
    }else{console.warn('[Auth] Supabase not configured — running in guest mode')}
    this._initialized=true;
    this.updateUI();
  },
  async loadProfile(){
    if(!this.client||!this.user)return;
    try{
      const{data}=await this.client.from('profiles').select('*').eq('id',this.user.id).single();
      if(data){this.profile=data;this.tier=data.tier||'recon'}
    }catch(e){console.warn('[Auth] Profile load failed:',e.message)}
    this.updateUI();
  },
  async doAuth(){
    const email=document.getElementById('authEmail').value.trim();
    const pass=document.getElementById('authPass').value;
    const errEl=document.getElementById('authErr');
    const btn=document.getElementById('authBtn');
    const origLabel=btn?btn.textContent:'';
    errEl.style.display='none';
    if(!email||!pass){errEl.textContent='Email and password required';errEl.style.display='block';return}
    if(!this.client){errEl.textContent='Authentication service unavailable';errEl.style.display='block';return}
    if(btn){btn.disabled=true;btn.textContent=(this.mode==='login'?'SIGNING IN…':'CREATING ACCOUNT…')}
    try{
      let result;
      if(this.mode==='login'){result=await this.client.auth.signInWithPassword({email,password:pass})}
      else{
        // Capture phone + marketing consent at signup. Stored as user_metadata;
        // the DB trigger (migration 003) copies it into the profile row.
        const phone=(document.getElementById('authPhone')||{}).value||'';
        const consent=!!(document.getElementById('authConsent')||{}).checked;
        result=await this.client.auth.signUp({
          email,password:pass,
          options:{data:{
            phone:phone.trim(),
            marketing_consent:consent,
            consent_version:consent?this._CONSENT_VERSION:''
          }}
        });
      }
      if(result.error)throw result.error;
      this.user=result.data.user;
      if(this.mode==='signup'){
        errEl.textContent='Account created! Check email for verification link.';
        errEl.style.display='block';errEl.style.color='var(--ok)';return;
      }
      // Login: check if this account requires a second factor (authenticator app)
      const needsMfa=await this._checkMfaRequired();
      if(needsMfa){this._showView('mfa');if(btn){btn.disabled=false;btn.textContent=origLabel||'SIGN IN'}return;}
      await this.loadProfile();
      this.closeModal();
    }catch(e){
      const msg=(e&&e.message)||'Sign-in failed. Try again.';
      errEl.textContent=msg;errEl.style.display='block';errEl.style.color='var(--crit)';
    }finally{
      if(btn){btn.disabled=false;btn.textContent=origLabel||(this.mode==='login'?'SIGN IN':'CREATE ACCOUNT')}
    }
  },
  // Current disclosure version — bump when the consent text changes so you can
  // prove exactly which agreement each user accepted.
  _CONSENT_VERSION:'2026-06-02-v1',
  toggleMode(){
    this.mode=this.mode==='login'?'signup':'login';
    document.getElementById('authTitle').textContent=this.mode==='login'?'SIGN IN':'CREATE ACCOUNT';
    document.getElementById('authBtn').textContent=this.mode==='login'?'SIGN IN':'CREATE ACCOUNT';
    document.getElementById('authToggle').textContent=this.mode==='login'?'Need an account? Sign up':'Already have an account? Sign in';
    // Show phone + consent only when creating an account
    const extra=document.getElementById('authSignupExtra');
    if(extra)extra.style.display=this.mode==='signup'?'block':'none';
  },
  showModal(){this._showView('main');document.getElementById('authBg').style.display='flex'},
  closeModal(){document.getElementById('authBg').style.display='none'},
  // ── View switcher: main / mfa / reset / enroll ──────────────
  _showView(view){
    const views={main:'authMainView',mfa:'authMfaView',reset:'authResetView',enroll:'authEnrollView'};
    Object.values(views).forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    const target=document.getElementById(views[view]||'authMainView');
    if(target)target.style.display='block';
    const titles={main:'SIGN IN',mfa:'TWO-FACTOR AUTH',reset:'RESET PASSWORD',enroll:'ENABLE 2FA'};
    const t=document.getElementById('authTitle');if(t)t.textContent=titles[view]||'SIGN IN';
    const err=document.getElementById('authErr');if(err)err.style.display='none';
  },
  _err(msg,ok){
    const el=document.getElementById('authErr');
    if(!el)return;
    el.textContent=msg;el.style.display='block';
    el.style.color=ok?'var(--ok,#3FB950)':'var(--crit,#DA3633)';
    el.style.borderColor=ok?'var(--ok,#3FB950)':'var(--crit,#DA3633)';
  },
  // ── GOOGLE SSO ──────────────────────────────────────────────
  async signInGoogle(){
    if(!this.client){this._err('Authentication service unavailable');return;}
    try{
      const{error}=await this.client.auth.signInWithOAuth({
        provider:'google',
        options:{redirectTo:window.location.origin+'/'}
      });
      if(error)throw error;
      // Browser redirects to Google — nothing else to do here.
    }catch(e){this._err((e&&e.message)||'Google sign-in failed');}
  },
  // ── PASSWORD RECOVERY ───────────────────────────────────────
  async forgotPassword(){
    const email=(document.getElementById('authEmail')||{}).value;
    const em=(email||'').trim();
    if(!em){this._err('Enter your email above first, then click Forgot password.');return;}
    if(!this.client){this._err('Authentication service unavailable');return;}
    try{
      const{error}=await this.client.auth.resetPasswordForEmail(em,{
        redirectTo:window.location.origin+'/?type=recovery'
      });
      if(error)throw error;
      this._err('Password reset link sent — check your email.',true);
    }catch(e){this._err((e&&e.message)||'Could not send reset email');}
  },
  async setNewPassword(){
    const np=(document.getElementById('authNewPass')||{}).value||'';
    if(np.length<6){this._err('Password must be at least 6 characters');return;}
    if(!this.client){this._err('Authentication service unavailable');return;}
    try{
      const{error}=await this.client.auth.updateUser({password:np});
      if(error)throw error;
      this._err('Password updated. You are now signed in.',true);
      await this.loadProfile();
      setTimeout(()=>this.closeModal(),1200);
    }catch(e){this._err((e&&e.message)||'Could not update password');}
  },
  // ── MFA / AUTHENTICATOR APP (TOTP) ──────────────────────────
  async _checkMfaRequired(){
    try{
      const{data,error}=await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
      if(error||!data)return false;
      // nextLevel aal2 + currentLevel aal1 ⇒ a verified factor exists and must be satisfied
      return data.nextLevel==='aal2'&&data.nextLevel!==data.currentLevel;
    }catch(e){return false;}
  },
  async verifyMfaLogin(){
    const code=(document.getElementById('authMfaCode')||{}).value||'';
    if(code.length!==6){this._err('Enter the 6-digit code');return;}
    if(!this.client)return;
    try{
      const{data:factors}=await this.client.auth.mfa.listFactors();
      const totp=factors&&factors.totp&&factors.totp[0];
      if(!totp)throw new Error('No authenticator enrolled');
      const{data:ch,error:chErr}=await this.client.auth.mfa.challenge({factorId:totp.id});
      if(chErr)throw chErr;
      const{error}=await this.client.auth.mfa.verify({factorId:totp.id,challengeId:ch.id,code});
      if(error)throw error;
      await this.loadProfile();
      this.closeModal();
      if(typeof af==='function')af('var(--gn)','Two-factor verified — signed in');
    }catch(e){this._err((e&&e.message)||'Invalid code — try again');}
  },
  async enrollMFA(){
    if(!this.client||!this.user){this._err('Sign in first to enable 2FA');return;}
    this._showView('enroll');
    document.getElementById('authBg').style.display='flex';
    try{
      const{data,error}=await this.client.auth.mfa.enroll({factorType:'totp',friendlyName:'BDOC-'+Date.now()});
      if(error)throw error;
      this._mfaEnrollId=data.id;
      const qrBox=document.getElementById('authQrBox');
      const secBox=document.getElementById('authSecretBox');
      const qr=data.totp&&data.totp.qr_code;
      if(qrBox&&qr){
        // Supabase returns either a raw <svg> string or a data: URI depending on version
        if(typeof qr==='string'&&qr.trim().indexOf('<svg')===0){qrBox.innerHTML=qr;}
        else{qrBox.innerHTML='<img src="'+qr+'" alt="2FA QR" style="width:160px;height:160px">';}
      }
      if(secBox&&data.totp&&data.totp.secret){secBox.textContent='Manual entry key: '+data.totp.secret;}
    }catch(e){this._err((e&&e.message)||'Could not start 2FA enrollment');}
  },
  async verifyMfaEnroll(){
    const code=(document.getElementById('authEnrollCode')||{}).value||'';
    if(code.length!==6){this._err('Enter the 6-digit code from your app');return;}
    if(!this.client||!this._mfaEnrollId)return;
    try{
      const{data:ch,error:chErr}=await this.client.auth.mfa.challenge({factorId:this._mfaEnrollId});
      if(chErr)throw chErr;
      const{error}=await this.client.auth.mfa.verify({factorId:this._mfaEnrollId,challengeId:ch.id,code});
      if(error)throw error;
      this._err('Two-factor authentication enabled.',true);
      if(typeof af==='function')af('var(--gn)','2FA enabled — authenticator app required at next login');
      setTimeout(()=>{this._showView('main');this.closeModal();},1400);
    }catch(e){this._err((e&&e.message)||'Invalid code — try again');}
  },
  showAccountMenu(){
    // Logged-in users: offer billing portal (if subscribed) or 2FA setup + pricing
    if(this.profile&&this.profile.stripe_customer_id){this.openPortal();return;}
    // Show modal with a 2FA option for signed-in users
    if(this.user){
      this.showModal();
      const err=document.getElementById('authErr');
      if(err){
        err.style.display='block';err.style.color='var(--t2)';err.style.borderColor='var(--bdr2)';
        err.innerHTML='Signed in as '+esc(this.profile&&this.profile.email||'')+'. <span onclick="BDOC_Auth.enrollMFA()" style="cursor:pointer;color:var(--kf);text-decoration:underline">Enable 2FA</span> · <span onclick="showMo()" style="cursor:pointer;color:var(--kf);text-decoration:underline">View plans</span>';
      }
      return;
    }
    showMo();
  },
  updateUI(){
    const el=document.getElementById('userBadge');
    // Phase 15e (2026-05-13): always-visible LOGIN button — text reflects auth state but element is never hidden.
    const loginBtn=document.getElementById('loginBtn');
    if(loginBtn){
      if(this.user&&this.profile){
        loginBtn.textContent='PROFILE';
        loginBtn.title='View account · '+(this.profile.email||'');
        loginBtn.classList.add('logged-in');
      }else{
        loginBtn.textContent='LOGIN';
        loginBtn.title='Sign in or create an account';
        loginBtn.classList.remove('logged-in');
      }
    }
    if(!el)return;
    // Dev mode badge — always visible when dev key active
    if(this._devMode){
      el.innerHTML='<span style="color:#3FB950;border:1px solid #3FB950;padding:1px 6px;border-radius:2px;font-size:9px;text-shadow:0 0 8px rgba(0,255,136,0.4);box-shadow:0 0 8px rgba(0,255,136,0.1)">⚡ DEV</span>';
      return;
    }
    if(this.user&&this.profile){
      const name=this.profile.display_name||this.profile.email?.split('@')[0]||'User';
      const tierColors={recon:'#6e7681',operator:'#3FB950',analyst:'#4a9eff',enterprise:'#E8B339'};
      const c=tierColors[this.tier]||'#6e7681';
      el.innerHTML='<span style="color:'+c+';border:1px solid '+c+';padding:1px 6px;border-radius:2px;font-size:9px">'+this.tier.toUpperCase()+'</span> <span style="color:var(--t2)">'+esc(name)+'</span>';
      document.getElementById('authLogout').style.display='inline';
    }else{
      // Phase 15c (2026-05-13): bigger, more visible SIGN IN pill — was too small to find
      el.innerHTML='<span class="userBadge-signin" style="color:var(--cyan,#00d4ff);background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.45);padding:5px 14px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1.2px;cursor:pointer;transition:all 0.18s ease;text-transform:uppercase">SIGN IN</span>';
    }
  },
  canAccess(feature){
    const map={
      recon:['eq','conf','cable','news','spaceweather','community','borders'],
      // 2026-05-05 (Phase 5 audit): added 12 layers that existed in the UI but were
      // silently locked for paying operator-tier users:
      //   cyber, floods, tsunamis, volcanoes, nucranges, hillshade, popdensity,
      //   borders, embassies, wireshark, econintel, darkships
      operator:['eq','conf','cable','news','spaceweather','community','headlines','mesh','milbases','nukes','milairfields','air','fire','sat','weather','clouds','temp','hurricanes','alerts','wind','forecastradar','lightning','airquality','vessels','outages','downdetect','forcetrack','territory','landings','chokepoints','celltowers','deflock','internet','radio','webcams','deforest','sentinel','imint','alliances','powerplants','oilgas','sanctions','vegetation','cyber','floods','tsunamis','volcanoes','nucranges','hillshade','popdensity','borders','embassies','wireshark','econintel','darkships','ioc','google3d','fallout'],
      analyst:['*'],
      enterprise:['*']
    };
    const allowed=map[this.tier]||map.recon;
    return allowed[0]==='*'||allowed.includes(feature);
  },
  async subscribe(tierName,annual){
    // hermes/overnight-2026-06-09: route through stripe-checkout function so the user's
    // Supabase id rides along as Checkout Session metadata. The stripe-webhook then upgrades
    // profiles.tier on checkout.session.completed. Bare Payment Links (below) could not do this.
    try{if(typeof plausible==='function')plausible('Subscribe Click',{props:{tier:tierName,billing:annual?'annual':'monthly',from_tier:this.tier||'recon'}});}catch(_){}
    // Must be signed in — we need a real userId to tie the subscription to the account.
    if(!this.user||!this.user.id){
      this._err&&this._err('Please sign in (or create an account) before subscribing, so we can link your plan to your account.');
      try{showLg&&showLg()}catch(_){}
      return;
    }
    const email=(this.profile&&this.profile.email)||this.user.email||'';
    try{
      const res=await fetch('/.netlify/functions/stripe-checkout',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tier:tierName,annual:!!annual,userId:this.user.id,email})
      });
      const data=await res.json();
      if(data&&data.url){window.location.href=data.url;return}
      this._err&&this._err('Could not start checkout: '+((data&&data.error)||'unknown error'));
    }catch(e){
      console.error('[BDOC] subscribe error:',e);
      this._err&&this._err('Checkout failed: '+e.message);
    }
  },
  async openPortal(){
    if(!this.profile||!this.profile.stripe_customer_id){
      if(typeof af==='function')af('var(--yl)','No subscription found on this account');
      return;
    }
    try{
      const res=await fetch('/.netlify/functions/stripe-portal',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({customerId:this.profile.stripe_customer_id}),
        signal:AbortSignal.timeout(10000)
      });
      const data=await res.json();
      if(data.url){window.location.href=data.url;return}
      throw new Error(data.error||'portal returned no url');
    }catch(e){
      console.error('[Stripe] Portal error:',e.message);
      if(typeof af==='function')af('var(--rd)','Couldn\'t open billing portal — try again in a moment');
      if(typeof EventLog!=='undefined')EventLog.add('warn','Stripe portal failed: '+e.message);
    }
  },
  async logout(){
    if(this.client)await this.client.auth.signOut();
    this.user=null;this.profile=null;this.tier='recon';
    localStorage.removeItem('bdoc_user_tier');
    this.updateUI();this.markLockedLayers();
    const lb=document.getElementById('authLogout');if(lb)lb.style.display='none';
  },
  // Tier is always sourced from profiles.tier via Supabase; localStorage tier hack removed
  // so a user clearing browser data doesn't lose their paid tier. Use loadProfile() to refresh.
  loadLocalTier(){/* deprecated — kept as no-op for any legacy callers */},
  // Mark locked layers with lock icon in left panel
  markLockedLayers(){
    document.querySelectorAll('.ly[data-layer]').forEach(el=>{
      const ly=el.dataset.layer;
      if(ly&&!this.canAccess(ly)){
        el.classList.add('locked');
        el.classList.remove('on');
        if(layers&&ly in layers)layers[ly]=false;
        const sw=el.querySelector('.sw');if(sw)sw.style.pointerEvents='none';
      }else{
        el.classList.remove('locked');
        const sw=el.querySelector('.sw');if(sw)sw.style.pointerEvents='';
      }
    });
  }
};

// Inline-handler bridge — see header note
window.BDOC_Auth = BDOC_Auth;
