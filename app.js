(() => {
  'use strict';

  const CONFIG = window.PADDOCKSCAN_CONFIG || {};
  const firebaseReady = !!(CONFIG.firebase && !String(CONFIG.firebase.apiKey || '').includes('PASTE_') && !String(CONFIG.firebase.appId || '').includes('PASTE_'));
  const DEMO_KEY = 'paddockscan.fullsite.v1';
  const DEMO_USER_KEY = 'paddockscan.demo.user.v1';
  const MAX_IMAGES = 6;
  const MAX_BYTES = 8 * 1024 * 1024;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const defaults = {
    settings: {
      heroEyebrow: 'THE PADDOCKSCAN COMMUNITY',
      heroTitle: 'Every car has a story worth scanning.',
      heroSubtitle: 'Share your vehicle, discover standout builds and enter the PaddockScan Car of the Month.',
      competitionTitle: 'Car of the Month',
      announcement: '',
      accent: '#d6ae36',
      submissionsOpen: true,
      playStoreUrl: CONFIG.playStoreUrl || 'https://play.google.com/apps/testing/com.healthandhit.paddockscan'
    },
    posts: [
      {
        id: 'demo-feature', title: '2018 Ford Mustang GT', vehicle: '2018 Ford Mustang GT', ownerName: 'PaddockScan Demo', location: 'United Kingdom', year: '2018', category: 'Performance',
        summary: 'A premium community feature showing how an approved vehicle story will appear.',
        story: 'This demonstration vehicle shows the complete PaddockScan community layout. Once Firebase is connected, approved user submissions and your own editorial features appear here automatically.',
        imageUrl: 'assets/car-placeholder.svg', website: '', featured: true, createdAt: Date.now() - 86400000 * 2
      },
      {
        id: 'demo-modern', title: 'Modern classics deserve a closer look', vehicle: 'PaddockScan Editorial', ownerName: 'PaddockScan', location: 'Editorial', year: 'Feature', category: 'PaddockScan editorial',
        summary: 'The cars becoming tomorrow’s classics are often hiding in plain sight.', story: 'PaddockScan editorial posts can be created from the Owner Hub on any Android phone. Add a photograph, title, summary and full article, then publish it directly to the community.', imageUrl: 'assets/car-placeholder.svg', website: '', featured: false, createdAt: Date.now() - 86400000
      }
    ],
    submissions: [], reports: [], users: [], profile: null
  };

  let app = null, auth = null, db = null, storage = null, appCheck = null;
  const state = {
    mode: firebaseReady ? 'firebase' : 'demo',
    user: null, admin: false, settings: {}, posts: [], submissions: [], reports: [], users: [], profile: null, cloudGarage: [],
    selectedImages: [], editorialImage: null, deferredInstall: null, lastPublicRoute: 'home'
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const asDate = value => {
    if (!value) return new Date(0);
    if (value.toDate) return value.toDate();
    if (value.seconds) return new Date(value.seconds * 1000);
    return new Date(value);
  };
  const dateText = value => asDate(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const initials = name => String(name || 'PS').trim().split(/\s+/).slice(0,2).map(p => p[0]?.toUpperCase() || '').join('') || 'PS';
  const safeUrl = value => {
    try {
      if (!value) return '';
      const url = new URL(String(value).trim());
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  };

  const normaliseWebsiteUrl = value => {
    const trimmed = String(value || '').trim();

    if (
      !trimmed ||
      /^(https?:\/\/)?(www\.)?$/i.test(trimmed)
    ) {
      return '';
    }

    let candidate = trimmed;

    if (/^http:\/\//i.test(candidate)) {
      candidate = candidate.replace(/^http:\/\//i, 'https://');
    } else if (!/^https:\/\//i.test(candidate)) {
      candidate = /^www\./i.test(candidate)
        ? `https://${candidate}`
        : `https://www.${candidate}`;
    }

    return safeUrl(candidate);
  };
  const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
  const uid = () => state.user?.uid || 'demo-user';

  function toast(message) {
    const el = $('#toast'); if (!el) return;
    el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function saveDemo() {
    const data = { settings: state.settings, posts: state.posts, submissions: state.submissions, reports: state.reports, users: state.users, profile: state.profile };
    localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  }

  function loadDemo() {
    let data = clone(defaults);
    try { const stored = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); if (stored) data = { ...data, ...stored, settings: { ...data.settings, ...(stored.settings || {}) } }; } catch {}
    Object.assign(state, data);
    const demoUser = JSON.parse(localStorage.getItem(DEMO_USER_KEY) || 'null');
    if (demoUser) { state.user = demoUser; state.admin = true; state.profile ||= { displayName: demoUser.displayName, location: '', bio: '', website: '' }; }
  }

  async function initFirebase() {
    if (!firebaseReady || !window.firebase) { loadDemo(); return; }
    try {
      app = firebase.initializeApp(CONFIG.firebase);
      auth = firebase.auth(); db = firebase.firestore(); storage = firebase.storage();
      if (CONFIG.appCheckSiteKey) {
        appCheck = firebase.appCheck(); appCheck.activate(CONFIG.appCheckSiteKey, true);
      }
      auth.useDeviceLanguage();
      auth.onAuthStateChanged(async user => {
        state.user = user;
        state.admin = false;
        if (user) {
          try { const token = await user.getIdTokenResult(true); state.admin = token.claims.admin === true; } catch {}
          await ensureUserProfile();
        }
        await refreshFirebaseData();
        renderAll();
      });
      await refreshFirebaseData();
    } catch (error) {
      console.error(error); state.mode = 'demo'; loadDemo();
      const banner = $('#connectionBanner'); banner.hidden = false; banner.textContent = 'Firebase could not connect. Local demonstration mode is active.';
    }
  }

  async function ensureUserProfile() {
    if (!db || !state.user) return;
    const ref = db.collection('users').doc(state.user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ displayName: state.user.displayName || 'PaddockScan owner', email: state.user.email || '', role: 'user', createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }

  async function refreshFirebaseData() {
    if (!db) return;
    try {
      const settingsSnap = await db.collection('siteSettings').doc('public').get();
      state.settings = { ...clone(defaults.settings), ...(settingsSnap.exists ? settingsSnap.data() : {}) };
      const postsSnap = await db.collection('posts').where('published','==',true).limit(100).get();
      state.posts = postsSnap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>asDate(b.createdAt)-asDate(a.createdAt));
      if (state.user) {
        const profileSnap = await db.collection('users').doc(state.user.uid).get(); state.profile = profileSnap.exists ? profileSnap.data() : null;
        const [mine, garageSnap] = await Promise.all([
          db.collection('submissions').where('ownerUid','==',state.user.uid).limit(50).get(),
          db.collection('users').doc(state.user.uid).collection('garage').limit(100).get()
        ]);
        state.submissions = mine.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>asDate(b.createdAt)-asDate(a.createdAt));
        state.cloudGarage = await Promise.all(garageSnap.docs.map(async d => {
          const data = { id:d.id, ...d.data() };
          try { data.result = data.resultJson ? JSON.parse(data.resultJson) : {}; } catch { data.result = {}; }
          const imagePath = data.cutoutStoragePath || data.originalStoragePath;
          if (imagePath) {
            try { data.imageUrl = await storage.ref(imagePath).getDownloadURL(); }
            catch { data.imageUrl = 'assets/car-placeholder.svg'; }
          } else data.imageUrl = 'assets/car-placeholder.svg';
          return data;
        }));
        state.cloudGarage.sort((a,b)=>asDate(b.updatedAt || b.createdAtIso)-asDate(a.updatedAt || a.createdAtIso));
      } else { state.submissions = []; state.cloudGarage = []; }
      if (state.admin) {
        const [subs, reports, users] = await Promise.all([
          db.collection('submissions').limit(100).get(), db.collection('reports').limit(100).get(), db.collection('users').limit(100).get()
        ]);
        state.submissions = subs.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asDate(b.createdAt)-asDate(a.createdAt));
        state.reports = reports.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asDate(b.createdAt)-asDate(a.createdAt));
        state.users = users.docs.map(d=>({id:d.id,...d.data()}));
      }
    } catch (error) { console.warn('Firebase read failed', error); }
  }

  async function signIn() {
    if (state.mode === 'demo') {
      if (state.user) { localStorage.removeItem(DEMO_USER_KEY); state.user = null; state.admin = false; toast('Signed out of demo mode'); }
      else { state.user = { uid:'demo-admin', displayName:'PaddockScan Owner', email:CONFIG.contactEmail || 'paddockscan@gmail.com' }; state.admin = true; localStorage.setItem(DEMO_USER_KEY, JSON.stringify(state.user)); toast('Demo owner access enabled'); }
      renderAll(); return;
    }
    const provider = new firebase.auth.GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'});
    try { await auth.signInWithPopup(provider); } catch (error) { if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request') await auth.signInWithRedirect(provider); else throw error; }
  }

  async function signOut() { if (state.mode === 'demo') return signIn(); await auth.signOut(); }

  function applySettings() {
    const s = state.settings;
    document.documentElement.style.setProperty('--accent', s.accent || '#d6ae36');
    $('#heroEyebrow').textContent = s.heroEyebrow; $('#heroTitle').textContent = s.heroTitle; $('#heroSubtitle').textContent = s.heroSubtitle;
    $('#competitionTitle').textContent = s.competitionTitle; $('#playStoreButton').href = safeUrl(s.playStoreUrl) || '#';
    const banner = $('#connectionBanner');
    if (s.announcement) { banner.hidden = false; banner.textContent = s.announcement; }
    else if (state.mode === 'demo') { banner.hidden = false; banner.textContent = 'Phone preview mode — connect Firebase to share accounts and submissions between devices.'; }
    else banner.hidden = true;
    $('#submitAuthNotice').innerHTML = !s.submissionsOpen ? '<strong>Submissions are temporarily paused.</strong>' : state.user ? 'Signed in. Your entry will be saved privately for review.' : 'Sign in before sending a public submission. You can still save a local draft in preview mode.';
  }

  function featuredPost() { return state.posts.find(p=>p.featured) || state.posts[0] || defaults.posts[0]; }
  function postCard(post) {
    return `<article class="post-card" data-open-post="${escapeHtml(post.id)}"><div class="post-image"><img src="${escapeHtml(post.imageUrl || 'assets/car-placeholder.svg')}" alt="${escapeHtml(post.title || post.vehicle)}" loading="lazy"><span>${escapeHtml(post.category || 'Community')}</span></div><div class="post-copy"><p class="eyebrow">${escapeHtml(post.year || 'FEATURE')}</p><h3>${escapeHtml(post.title || post.vehicle)}</h3><p>${escapeHtml(post.summary || String(post.story||'').slice(0,150))}</p><div class="post-meta"><span>${escapeHtml(post.ownerName || 'PaddockScan')}</span><span>${dateText(post.createdAt)}</span></div></div></article>`;
  }

  function renderPosts() {
    const feature = featuredPost();
    $('#featuredCard').innerHTML = `<div class="featured-image"><img src="${escapeHtml(feature.imageUrl || 'assets/car-placeholder.svg')}" alt="${escapeHtml(feature.title || feature.vehicle)}"><span class="feature-badge">CURRENT WINNER</span></div><div class="featured-copy"><p class="eyebrow">${escapeHtml(feature.category || 'FEATURED')}</p><h3>${escapeHtml(feature.title || feature.vehicle)}</h3><p>${escapeHtml(feature.summary || feature.story || '')}</p><div class="feature-stats"><div><span>Owner</span><strong>${escapeHtml(feature.ownerName || 'PaddockScan')}</strong></div><div><span>Location</span><strong>${escapeHtml(feature.location || 'United Kingdom')}</strong></div><div><span>Year</span><strong>${escapeHtml(feature.year || '—')}</strong></div></div><button class="button" data-open-post="${escapeHtml(feature.id)}">Read the story</button></div>`;
    $('#homePostGrid').innerHTML = state.posts.filter(p=>p.id!==feature.id).slice(0,3).map(postCard).join('') || postCard(feature);
    filterCommunity();
    $('#hubFeatured').innerHTML = `<img src="${escapeHtml(feature.imageUrl || 'assets/car-placeholder.svg')}" alt=""><h3>${escapeHtml(feature.title || feature.vehicle)}</h3><p>${escapeHtml(feature.ownerName || 'PaddockScan')}</p>`;
  }

  function filterCommunity() {
    const term = ($('#postSearch')?.value || '').trim().toLowerCase(); const category = $('#categoryFilter')?.value || 'all';
    const items = state.posts.filter(p => (category==='all'||p.category===category) && (!term || [p.title,p.vehicle,p.ownerName,p.category,p.story].join(' ').toLowerCase().includes(term)));
    $('#communityPostGrid').innerHTML = items.map(postCard).join(''); $('#communityEmpty').hidden = !!items.length;
  }

  function renderPostDetail(id) {
    const post = state.posts.find(p=>p.id===id); if (!post) { location.hash='#community'; return; }
    const link = safeUrl(post.website);
    $('#postDetail').innerHTML = `<img class="post-detail-image" src="${escapeHtml(post.imageUrl || 'assets/car-placeholder.svg')}" alt="${escapeHtml(post.title || post.vehicle)}"><div class="post-detail-copy"><p class="eyebrow">${escapeHtml(post.category || 'COMMUNITY')}</p><h1>${escapeHtml(post.title || post.vehicle)}</h1><div class="detail-byline">By ${escapeHtml(post.ownerName || 'PaddockScan')} · ${dateText(post.createdAt)}${post.location?` · ${escapeHtml(post.location)}`:''}</div><p class="lead">${escapeHtml(post.summary || '')}</p><div class="article-body">${escapeHtml(post.story || '').replace(/\n/g,'<br>')}</div><div class="detail-actions">${link?`<a class="button button-secondary" href="${escapeHtml(link)}" target="_blank" rel="ugc noopener">Owner link ↗</a>`:''}<button class="text-link" data-report-post="${escapeHtml(post.id)}">Report this post</button></div></div>`;
  }

  function submissionItem(item, admin=false) {
    const img = item.imageUrls?.[0] || item.imageUrl || 'assets/car-placeholder.svg';
    const actions = admin ? `<div class="submission-actions"><button class="button button-small button-secondary" data-review-submission="${item.id}">Review</button></div>` : '';
    return `<article class="submission-item"><img src="${escapeHtml(img)}" alt=""><div class="submission-main"><span class="status-pill status-${escapeHtml(item.status||'draft')}">${escapeHtml((item.status||'draft').replaceAll('_',' '))}</span><h3>${escapeHtml(item.vehicle || 'Untitled vehicle')}</h3><p>${escapeHtml(item.ownerName || '')} · ${dateText(item.createdAt)}</p></div>${actions}</article>`;
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  }

  function garageValue(result, ...paths) {
    for (const path of paths) {
      const value = path.split('.').reduce((current, key) => current?.[key], result);
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
  }

  function formatGarageValue(value, suffix='') {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '—';
    return `${value}${suffix}`;
  }

  function garageDetailRow(label, value, suffix='') {
    if (value === undefined || value === null || String(value).trim() === '') return '';
    return `<div class="garage-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatGarageValue(value, suffix))}</strong></div>`;
  }

  function garageDetailSection(title, rows) {
    const content = rows.filter(Boolean).join('');
    return content ? `<section class="garage-detail-section"><h3>${escapeHtml(title)}</h3><div class="garage-detail-grid">${content}</div></section>` : '';
  }

  function cloudGarageItem(item) {
    const result = item.result || {};
    const vehicle = item.title || result.title || [garageValue(result,'verifiedIdentity.modelYear','year'), garageValue(result,'verifiedIdentity.make','make'), garageValue(result,'verifiedIdentity.model','model')].filter(Boolean).join(' ') || 'Saved vehicle';
    const registration = item.registration || garageValue(result,'registration.normalizedRegistration','registration.registration','registration');
    const detailBits = [
      registration,
      garageValue(result,'verifiedIdentity.modelYear','year'),
      garageValue(result,'vehicle.fuelType','fuelType','fuel'),
      garageValue(result,'vehicle.bodyStyle','bodyStyle')
    ].filter(Boolean);
    return `<article class="submission-item garage-list-item" data-open-garage="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(vehicle)} details"><img src="${escapeHtml(item.imageUrl || 'assets/car-placeholder.svg')}" alt="${escapeHtml(vehicle)}"><div class="submission-main"><span class="status-pill status-approved">private app scan</span><h3>${escapeHtml(vehicle)}</h3><p>${escapeHtml(detailBits.join(' · ') || 'Synced from PaddockScan')}</p><small>${dateText(item.updatedAt || item.createdAtIso)}</small></div><div class="submission-actions"><button class="button button-small button-secondary" type="button" data-open-garage="${escapeHtml(item.id)}">Open details</button></div></article>`;
  }

  async function openGarageDetail(id) {
    const item = state.cloudGarage.find(vehicle => vehicle.id === id);
    if (!item) return;
    const result = item.result || {};
    const identity = result.verifiedIdentity || {};
    const vehicleData = result.vehicle || {};
    const specs = result.specifications || result.estimatedSpecifications || {};
    const valuation = result.valuation || result.estimatedValuation || {};
    const confidence = result.confidence || {};
    const registration = item.registration || garageValue(result,'registration.normalizedRegistration','registration.registration','registration');
    const title = item.title || result.title || [identity.modelYear, identity.make, identity.model].filter(Boolean).join(' ') || 'Saved vehicle';

    let historyText = firstValue(result.historyText, result.vehicleHistory, item.historyText);
    if (state.mode === 'firebase' && state.user) {
      try {
        const historySnap = await db.collection('users').doc(state.user.uid).collection('garage').doc(item.id).collection('history').doc('current').get();
        if (historySnap.exists) historyText = firstValue(historySnap.data().historyText, historyText);
      } catch (error) { console.warn('Garage history read failed', error); }
    }

    const make = firstValue(identity.make, garageValue(result,'make','vehicle.make'));
    const model = firstValue(identity.model, garageValue(result,'model','vehicle.model'));
    const year = firstValue(identity.modelYear, garageValue(result,'year','estimated_year_from'));
    const generation = firstValue(identity.generation, garageValue(result,'generation','vehicle.generation'));
    const trim = firstValue(identity.trim, garageValue(result,'trim','vehicle.trim'));
    const colour = firstValue(identity.colour, garageValue(result,'colour','vehicle.colour'));
    const bodyStyle = firstValue(vehicleData.bodyStyle, garageValue(result,'bodyStyle'));
    const fuel = firstValue(vehicleData.fuelType, garageValue(result,'fuelType','fuel','estimated_fuel_type'));
    const transmission = firstValue(vehicleData.transmission, garageValue(result,'transmission','estimated_transmission'));
    const engineCc = firstValue(vehicleData.engineCapacityCc, specs.engineCapacityCc, garageValue(result,'engineCapacityCc','estimated_engine_capacity_cc'));
    const engineName = firstValue(vehicleData.engineName, specs.engineName, garageValue(result,'engineName','estimated_engine_name'));
    const power = firstValue(vehicleData.horsepowerBhp, specs.horsepowerBhp, garageValue(result,'horsepowerBhp','estimated_horsepower_bhp'));
    const torque = firstValue(vehicleData.torqueNm, specs.torqueNm, garageValue(result,'torqueNm','estimated_torque_nm'));
    const mpg = firstValue(vehicleData.combinedMpgUk, specs.combinedMpgUk, garageValue(result,'combinedMpgUk','estimated_combined_mpg_uk'));
    const co2 = firstValue(vehicleData.co2GramsPerKm, specs.co2GramsPerKm, garageValue(result,'co2GramsPerKm','estimated_co2_grams_per_km'));
    const originalPrice = firstValue(valuation.originalMsrp, garageValue(result,'originalMsrp','estimatedOriginalMsrp','estimated_original_msrp'));
    const currentValue = firstValue(valuation.currentValue, garageValue(result,'currentValue','estimatedValue','estimated_current_value'));
    const lowValue = firstValue(valuation.marketLow, garageValue(result,'marketLow','estimated_market_low'));
    const highValue = firstValue(valuation.marketHigh, garageValue(result,'marketHigh','estimated_market_high'));
    const overallConfidence = firstValue(confidence.overallPercent, confidence.overall, garageValue(result,'confidencePercent','confidence'));
    const reasoning = firstValue(result.reasoningSummary, result.reasoning_summary, result.specificationEstimateNotes, result.specification_estimate_notes);

    $('#garageDetailContent').innerHTML = `
      <div class="garage-detail-hero">
        <img src="${escapeHtml(item.imageUrl || 'assets/car-placeholder.svg')}" alt="${escapeHtml(title)}">
        <div><p class="eyebrow">MY PADDOCKSCAN GARAGE</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml([registration, year, fuel, bodyStyle].filter(Boolean).join(' · '))}</p></div>
      </div>
      ${garageDetailSection('Vehicle identity', [
        garageDetailRow('Registration', registration), garageDetailRow('Make', make), garageDetailRow('Model', model),
        garageDetailRow('Year', year), garageDetailRow('Generation', generation), garageDetailRow('Trim / variant', trim),
        garageDetailRow('Colour', colour), garageDetailRow('Body style', bodyStyle)
      ])}
      ${garageDetailSection('Engine and performance', [
        garageDetailRow('Engine', engineName), garageDetailRow('Engine capacity', engineCc, ' cc'), garageDetailRow('Fuel', fuel),
        garageDetailRow('Transmission', transmission), garageDetailRow('Power', power, ' bhp'), garageDetailRow('Torque', torque, ' Nm'),
        garageDetailRow('Combined economy', mpg, ' mpg'), garageDetailRow('CO₂', co2, ' g/km')
      ])}
      ${garageDetailSection('Estimated value', [
        garageDetailRow('Price when new', originalPrice ? `£${Number(originalPrice).toLocaleString('en-GB')}` : null),
        garageDetailRow('Current estimate', currentValue ? `£${Number(currentValue).toLocaleString('en-GB')}` : null),
        garageDetailRow('Market low', lowValue ? `£${Number(lowValue).toLocaleString('en-GB')}` : null),
        garageDetailRow('Market high', highValue ? `£${Number(highValue).toLocaleString('en-GB')}` : null)
      ])}
      ${garageDetailSection('Scan information', [
        garageDetailRow('Confidence', overallConfidence, Number(overallConfidence) <= 1 ? '' : '%'),
        garageDetailRow('Saved', dateText(item.updatedAt || item.createdAtIso)),
        garageDetailRow('Scan ID', item.scanId || item.id)
      ])}
      ${reasoning ? `<section class="garage-detail-section"><h3>Identification notes</h3><p class="garage-detail-copy">${escapeHtml(reasoning)}</p></section>` : ''}
      ${historyText ? `<section class="garage-detail-section"><h3>Vehicle history</h3><div class="garage-history-text">${escapeHtml(historyText).replace(/\n/g,'<br>')}</div></section>` : '<section class="garage-detail-section"><h3>Vehicle history</h3><p class="garage-detail-copy">No saved editorial history is available for this vehicle yet. Generate it in the Android app, then refresh the Garage.</p></section>'}
    `;
    $('#garageDetailDialog').showModal();
  }

  function renderGarage() {
    const gate = $('#garageGate'), content = $('#garageContent');
    if (!state.user) { gate.innerHTML = '<div class="panel"><h2>Sign in to open your Garage</h2><p>Your drafts and submission history appear here.</p><button class="button" data-auth>Sign in with Google</button></div>'; content.hidden=true; return; }
    gate.innerHTML=''; content.hidden=false;
    $('#profileName').textContent = state.profile?.displayName || state.user.displayName || 'PaddockScan owner'; $('#profileEmail').textContent = state.user.email || 'Demo account'; $('#profileAvatar').textContent = initials(state.profile?.displayName || state.user.displayName);
    const mine = state.admin ? state.submissions.filter(s=>s.ownerUid===uid() || state.mode==='demo') : state.submissions;
    const cloudCount = state.cloudGarage?.length || 0;
    $('#garageStats').innerHTML = [ ['App vehicles',cloudCount], ['Drafts',mine.filter(s=>s.status==='draft').length], ['Under review',mine.filter(s=>s.status==='pending').length], ['Published',mine.filter(s=>s.status==='approved').length] ].map(([l,n])=>`<div class="stat-card"><strong>${n}</strong><span>${l}</span></div>`).join('');
    $('#cloudGarageList').innerHTML = cloudCount ? state.cloudGarage.map(cloudGarageItem).join('') : '<div class="empty-state"><h3>No synced app vehicles yet</h3><p>Sign into the Android app with this same Google account and save a scan to Garage. New saves upload automatically.</p></div>';
    $('#mySubmissionList').innerHTML = mine.map(i=>submissionItem(i,false)).join('') || '<div class="empty-state"><h3>No community submissions yet</h3><p>Your website drafts will appear here.</p></div>';
  }

  function renderHub() {
    const gate=$('#hubGate'), content=$('#hubContent'); $('#hubModeChip').textContent = state.mode==='demo'?'PHONE PREVIEW':'FIREBASE LIVE';
    $('#hubSignInButton').textContent = state.user ? 'Sign out' : 'Sign in';
    if (!state.user) { gate.innerHTML='<div class="panel auth-gate-card"><h2>Owner Hub locked</h2><p>Sign in with the administrator account to manage the website.</p><button class="button" data-auth>Sign in</button></div>'; content.hidden=true; return; }
    if (!state.admin) { gate.innerHTML='<div class="panel auth-gate-card"><h2>Administrator access required</h2><p>Your account is signed in, but it does not have the Firebase <code>admin</code> custom claim.</p></div>'; content.hidden=true; return; }
    gate.innerHTML=''; content.hidden=false;
    const pending=state.submissions.filter(s=>s.status==='pending').length;
    $('#pendingBadge').textContent=pending; $('#dashboardStats').innerHTML=[['Pending',pending],['Published',state.posts.length],['Users',state.users.length||1],['Reports',state.reports.filter(r=>r.status!=='resolved').length]].map(([l,n])=>`<div class="stat-card"><strong>${n}</strong><span>${l}</span></div>`).join('');
    $('#attentionList').innerHTML=state.submissions.filter(s=>s.status==='pending').slice(0,5).map(i=>submissionItem(i,true)).join('')||'<div class="empty-state"><p>Nothing needs attention.</p></div>';
    renderAdminLists(); populateDesigner(); renderSettings();
  }

  function renderAdminLists() {
    const filter=$('#submissionStatusFilter')?.value||'all'; const subs=state.submissions.filter(s=>filter==='all'||s.status===filter);
    $('#adminSubmissionList').innerHTML=subs.map(i=>submissionItem(i,true)).join('')||'<div class="empty-state"><p>No matching submissions.</p></div>';
    $('#adminPostList').innerHTML=state.posts.map(p=>`<article class="submission-item"><img src="${escapeHtml(p.imageUrl||'assets/car-placeholder.svg')}" alt=""><div class="submission-main"><span class="status-pill status-approved">published</span><h3>${escapeHtml(p.title||p.vehicle)}</h3><p>${escapeHtml(p.ownerName||'PaddockScan')} · ${dateText(p.createdAt)}</p></div><div class="submission-actions"><button class="button button-small button-secondary" data-feature-post="${p.id}">${p.featured?'Featured':'Feature'}</button><button class="button button-small danger-button" data-delete-post="${p.id}">Remove</button></div></article>`).join('');
    $('#reportList').innerHTML=state.reports.map(r=>`<article class="submission-item"><div class="submission-main"><span class="status-pill">${escapeHtml(r.status||'open')}</span><h3>${escapeHtml(r.reason||'Content report')}</h3><p>${escapeHtml(r.details||'No details')} · ${dateText(r.createdAt)}</p></div><div class="submission-actions"><button class="button button-small button-secondary" data-resolve-report="${r.id}">Resolve</button></div></article>`).join('')||'<div class="empty-state"><p>No reports.</p></div>';
    $('#userList').innerHTML=(state.users.length?state.users:[{id:uid(),displayName:state.profile?.displayName||state.user?.displayName,email:state.user?.email,role:'admin'}]).map(u=>`<article class="submission-item"><div class="account-avatar">${initials(u.displayName)}</div><div class="submission-main"><h3>${escapeHtml(u.displayName||'User')}</h3><p>${escapeHtml(u.email||'')} · ${escapeHtml(u.role||'user')}</p></div></article>`).join('');
  }

  function populateDesigner() {
    const f=$('#designerForm'); if(!f)return; const s=state.settings;
    ['heroEyebrow','heroTitle','heroSubtitle','competitionTitle','announcement','accent','playStoreUrl'].forEach(k=>{if(f.elements[k])f.elements[k].value=s[k]??''}); f.elements.submissionsOpen.value=String(s.submissionsOpen!==false);
  }

  function renderSettings() {
    $('#connectionDetails').innerHTML = `<div class="setting-row"><span>Mode</span><strong>${state.mode==='demo'?'Local phone preview':'Firebase live'}</strong></div><div class="setting-row"><span>Domain</span><strong>${escapeHtml(CONFIG.domain||'paddockscan.com')}</strong></div><div class="setting-row"><span>Signed in</span><strong>${state.user?'Yes':'No'}</strong></div><div class="setting-row"><span>Administrator</span><strong>${state.admin?'Yes':'No'}</strong></div>`;
    $('#currentUid').textContent = state.user?.uid || 'Sign in to reveal your UID';
    $('#adminSetupText').textContent = state.mode==='demo' ? 'Demo mode gives the local owner account administrator access automatically.' : 'For production, add the admin custom claim to this UID using the included Firebase Admin setup instructions.';
  }

  function renderAccount() {
    const btn=$('#accountButton'); $('.account-avatar',btn).textContent=initials(state.profile?.displayName||state.user?.displayName); $('.account-label',btn).textContent=state.user?(state.profile?.displayName||state.user.displayName||'Account').split(' ')[0]:'Sign in';
    $('#accountDialogContent').innerHTML=state.user?`<p class="eyebrow">ACCOUNT</p><h2>${escapeHtml(state.profile?.displayName||state.user.displayName||'PaddockScan owner')}</h2><p>${escapeHtml(state.user.email||'')}</p><div class="stack-actions"><a class="button" href="#garage" onclick="document.getElementById('accountDialog').close()">Open My Garage</a>${state.admin?'<a class="button button-secondary" href="#hub" onclick="document.getElementById(\'accountDialog\').close()">Open Owner Hub</a>':''}<button class="button button-secondary" data-auth>Sign out</button></div>`:`<p class="eyebrow">PADDOCKSCAN ACCOUNT</p><h2>Sign in</h2><p>Use the same Google account as the PaddockScan Android app.</p><button class="button" data-auth>Continue with Google</button>`;
  }

  function renderAll() {
    applySettings(); renderPosts(); renderGarage(); renderHub(); renderAccount();
    $('#monthChip').textContent=new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric'}).format(new Date()).toUpperCase(); $('#copyrightYear').textContent=new Date().getFullYear();
  }

  function route() {
    const raw=(location.hash||'#home').slice(1); const [routeName,param]=raw.split('/'); const valid=['home','community','post','submit','garage','about','legal','hub']; const name=valid.includes(routeName)?routeName:'home';
    $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===name)); $('#publicFooter').hidden=name==='hub';
    if(name!=='hub'&&name!=='post')state.lastPublicRoute=name; if(name==='post')renderPostDetail(param); if(name==='legal')renderLegal(param||'privacy');
    scrollTo({top:0,behavior:'smooth'}); $('#mainNav').classList.remove('open');
  }

  function renderLegal(type) {
    const docs={
      privacy:['Privacy Notice',`PaddockScan collects account details, profile information, vehicle submission data, uploaded photographs and moderation records when you choose to use community features. We use this information to operate accounts, review submissions, publish approved content, respond to reports and protect the service. Firebase and Google authentication providers process technical data required to provide these services. Public posts show only the information approved for publication; email addresses are not shown publicly. You may request access, correction or deletion by contacting ${CONFIG.contactEmail||'paddockscan@gmail.com'}.`],
      terms:['Terms of Use','You must provide accurate information, use only photographs and material you own or are authorised to share, and avoid unlawful, abusive, misleading or privacy-invasive content. Submissions may be edited for formatting, rejected, unpublished or removed. You grant PaddockScan a non-exclusive licence to display and promote approved material while it remains published. Vehicle identifications, values and specifications are informational estimates and should be independently verified before purchasing, selling or repairing a vehicle.'],
      community:['Community Rules','Be respectful. Submit genuine automotive content. Do not expose addresses, documents, precise locations or another person’s personal information. Do not upload copyrighted photographs without permission, unsafe links, spam, threats, hate, sexual content or illegal material. Registration plates may be hidden or replaced before publication. Use the report control where content raises a concern.'],
      deletion:['Account and Data Deletion',`To request deletion of your PaddockScan community account, profile, private drafts or published submissions, email ${CONFIG.contactEmail||'paddockscan@gmail.com'} from the address linked to your account. Include your display name and identify the material to remove. Requests will be verified before deletion.`]
    }; const doc=docs[type]||docs.privacy;
    $('#legalContent').innerHTML=`<h1>${doc[0]}</h1><p>Last updated ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</p>${doc[1].split('\n').map(p=>`<p>${escapeHtml(p)}</p>`).join('')}`;
  }

  async function filesToDataUrls(files) {
    const out=[]; for(const file of files){ if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Only JPG, PNG and WebP images are accepted.'); if(file.size>MAX_BYTES)throw new Error(`${file.name} is larger than 8 MB.`); out.push(await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})); } return out;
  }

  async function uploadFiles(files, submissionId, ownerUid) {
    const urls=[]; for(let i=0;i<files.length;i++){ const file=files[i], ext=(file.name.split('.').pop()||'jpg').toLowerCase(); const ref=storage.ref(`community/${ownerUid}/${submissionId}/${i}-${Date.now()}.${ext}`); await ref.put(file,{contentType:file.type}); urls.push(await ref.getDownloadURL()); } return urls;
  }

  async function saveSubmission(status) {
    const form=$('#submissionForm'); if(status==='pending'&&!form.reportValidity())return;
    if(state.settings.submissionsOpen===false&&status==='pending'){toast('Submissions are paused.');return;}
    const data=Object.fromEntries(new FormData(form).entries());
    const item={ownerUid:uid(),ownerName:String(data.ownerName||state.profile?.displayName||state.user?.displayName||'Demo owner').trim(),location:String(data.location||'').trim(),vehicle:String(data.vehicle||'').trim(),year:String(data.year||'').trim(),category:String(data.category||'Community'),website:normaliseWebsiteUrl(data.website),story:String(data.story||'').trim(),summary:String(data.story||'').trim().slice(0,280),hidePlate:data.hidePlate==='on',consent:data.consent==='on',status,createdAt:nowIso(),updatedAt:nowIso()};
    if(!item.vehicle){toast('Add the vehicle name first.');return;}
    $('#submissionStatus').textContent='Saving…';
    try{
      if(state.mode==='firebase'){
        if(!state.user){await signIn();return;}
        const ref=db.collection('submissions').doc(); item.imageUrls=await uploadFiles(state.selectedImages,ref.id,state.user.uid); item.ownerEmail=state.user.email||''; item.createdAt=firebase.firestore.FieldValue.serverTimestamp(); item.updatedAt=item.createdAt; await ref.set(item);
      } else { item.id=`sub-${Date.now()}`; item.imageUrls=state.selectedImages.length?await filesToDataUrls(state.selectedImages):['assets/car-placeholder.svg']; state.submissions.unshift(item); saveDemo(); }
      form.reset(); if (form.elements.website) form.elements.website.value='https://www.'; state.selectedImages=[]; renderImagePreviews(); $('#storyCount').textContent='0'; $('#submissionStatus').textContent=status==='draft'?'Draft saved in My Garage.':'Submitted for review.'; toast(status==='draft'?'Draft saved':'Submission sent'); await refreshFirebaseData(); renderAll();
    } catch (error) {
      console.error(error);

      const message =
        error?.code === 'storage/unauthorized'
          ? 'Photo upload was blocked by Firebase Storage rules. Publish the Storage rules, then sign out and back in.'
          : (error.message || 'Could not save submission.');

      $('#submissionStatus').textContent = message;
    }
  }

  function renderImagePreviews(){const grid=$('#imagePreviewGrid'); if(!state.selectedImages.length){grid.innerHTML='<div class="upload-placeholder"><span>＋</span><strong>Add up to 6 photos</strong><small>JPG, PNG or WebP. 8 MB each.</small></div>';return;} grid.innerHTML=state.selectedImages.map((f,i)=>`<div class="image-preview"><img src="${URL.createObjectURL(f)}" alt="Selected photo ${i+1}"><button type="button" data-remove-image="${i}" aria-label="Remove">×</button></div>`).join('');}

  function openReview(id){const item=state.submissions.find(s=>s.id===id);if(!item)return; const imgs=item.imageUrls?.length?item.imageUrls:[item.imageUrl||'assets/car-placeholder.svg']; $('#reviewContent').innerHTML=`<p class="eyebrow">SUBMISSION REVIEW</p><h2>${escapeHtml(item.vehicle)}</h2><div class="review-gallery">${imgs.map(u=>`<img src="${escapeHtml(u)}" alt="">`).join('')}</div><div class="review-meta"><div><span>Owner</span><strong>${escapeHtml(item.ownerName)}</strong></div><div><span>Location</span><strong>${escapeHtml(item.location||'—')}</strong></div><div><span>Year</span><strong>${escapeHtml(item.year||'—')}</strong></div><div><span>Category</span><strong>${escapeHtml(item.category||'—')}</strong></div></div><p class="review-story">${escapeHtml(item.story)}</p><div class="admin-action-bar"><button class="button" data-sub-action="approve" data-id="${id}">Approve and publish</button><button class="button button-secondary" data-sub-action="changes_requested" data-id="${id}">Request changes</button><button class="button danger-button" data-sub-action="rejected" data-id="${id}">Reject</button></div>`; $('#reviewDialog').showModal();}

  async function submissionAction(id,action){const item=state.submissions.find(s=>s.id===id);if(!item)return; try{if(state.mode==='firebase'){await db.collection('submissions').doc(id).update({status:action,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}); if(action==='approve'){const post={title:item.vehicle,vehicle:item.vehicle,ownerName:item.ownerName,ownerUid:item.ownerUid,location:item.location||'',year:item.year||'',category:item.category||'Community',summary:item.summary||String(item.story||'').slice(0,280),story:item.story||'',website:item.website||'',imageUrl:item.imageUrls?.[0]||item.imageUrl||'assets/car-placeholder.svg',published:true,featured:false,createdAt:firebase.firestore.FieldValue.serverTimestamp()};await db.collection('posts').doc(id).set(post);await db.collection('submissions').doc(id).update({status:'approved'});}}else{item.status=action;if(action==='approve'){state.posts.unshift({id:item.id,title:item.vehicle,...item,imageUrl:item.imageUrls?.[0]||'assets/car-placeholder.svg',published:true,featured:false});}saveDemo();}$('#reviewDialog').close();await refreshFirebaseData();renderAll();toast(action==='approve'?'Submission published':'Submission updated');}catch(e){toast(e.message||'Update failed');}}

  async function saveSettings(event){event.preventDefault();const f=event.currentTarget;const next={heroEyebrow:f.heroEyebrow.value.trim(),heroTitle:f.heroTitle.value.trim(),heroSubtitle:f.heroSubtitle.value.trim(),competitionTitle:f.competitionTitle.value.trim(),announcement:f.announcement.value.trim(),accent:f.accent.value,playStoreUrl:safeUrl(f.playStoreUrl.value),submissionsOpen:f.submissionsOpen.value==='true'};try{if(state.mode==='firebase')await db.collection('siteSettings').doc('public').set({...next,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});else{state.settings={...state.settings,...next};saveDemo();}state.settings={...state.settings,...next};applySettings();$('#designerStatus').textContent='Homepage published.';toast('Homepage updated');}catch(e){$('#designerStatus').textContent=e.message||'Could not publish.';}}

  async function publishEditorial(event){event.preventDefault();const f=event.currentTarget;const data=Object.fromEntries(new FormData(f).entries());const post={title:String(data.title).trim(),vehicle:String(data.title).trim(),ownerName:'PaddockScan',location:'Editorial',year:String(data.year||'Feature'),category:String(data.category||'PaddockScan editorial'),summary:String(data.summary).trim(),story:String(data.story).trim(),website:normaliseWebsiteUrl(data.website),published:true,featured:false,createdAt:nowIso()};try{if(state.mode==='firebase'){const ref=db.collection('posts').doc();if(state.editorialImage){const u=(await uploadFiles([state.editorialImage],`editorial-${ref.id}`,state.user.uid))[0];post.imageUrl=u}else post.imageUrl='assets/car-placeholder.svg';post.createdAt=firebase.firestore.FieldValue.serverTimestamp();await ref.set(post)}else{post.id=`post-${Date.now()}`;post.imageUrl=state.editorialImage?(await filesToDataUrls([state.editorialImage]))[0]:'assets/car-placeholder.svg';state.posts.unshift(post);saveDemo()}f.reset();if(f.elements.website)f.elements.website.value='https://www.';state.editorialImage=null;$('#editorialImagePreview img').src='assets/car-placeholder.svg';$('#editorialStatus').textContent='Post published.';await refreshFirebaseData();renderAll();toast('Editorial post published')}catch(e){$('#editorialStatus').textContent=e.message||'Publish failed'}}

  async function postAction(id,action){try{if(action==='feature'){if(state.mode==='firebase'){const batch=db.batch();state.posts.forEach(p=>batch.update(db.collection('posts').doc(p.id),{featured:p.id===id}));await batch.commit()}else state.posts.forEach(p=>p.featured=p.id===id)}else if(action==='delete'){if(!confirm('Remove this public post?'))return;if(state.mode==='firebase')await db.collection('posts').doc(id).delete();else state.posts=state.posts.filter(p=>p.id!==id)}if(state.mode==='demo')saveDemo();await refreshFirebaseData();renderAll()}catch(e){toast(e.message||'Action failed')}}

  async function submitReport(event){event.preventDefault();const d=Object.fromEntries(new FormData(event.currentTarget).entries());const report={postId:d.postId,reason:d.reason,details:String(d.details||''),reporterUid:uid(),status:'open',createdAt:nowIso()};if(state.mode==='firebase'){report.createdAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection('reports').add(report)}else{report.id=`rep-${Date.now()}`;state.reports.unshift(report);saveDemo()}event.currentTarget.reset();$('#reportDialog').close();toast('Report sent for review');renderAll()}

  async function saveProfile(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget).entries());const profile={displayName:String(data.displayName).trim(),location:String(data.location||'').trim(),bio:String(data.bio||'').trim(),website:normaliseWebsiteUrl(data.website),email:state.user?.email||'',updatedAt:nowIso()};if(state.mode==='firebase'){profile.updatedAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection('users').doc(state.user.uid).set(profile,{merge:true})}else{state.profile=profile;saveDemo()}state.profile={...(state.profile||{}),...profile};$('#profileDialog').close();renderAll();toast('Profile saved')}

  function exportBackup(){const blob=new Blob([JSON.stringify({version:1,exportedAt:nowIso(),settings:state.settings,posts:state.posts,submissions:state.submissions,reports:state.reports,users:state.users,profile:state.profile},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`paddockscan-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  async function importBackup(file){const data=JSON.parse(await file.text());if(!data.settings||!Array.isArray(data.posts))throw new Error('This is not a valid PaddockScan backup.');Object.assign(state,{settings:data.settings,posts:data.posts,submissions:data.submissions||[],reports:data.reports||[],users:data.users||[],profile:data.profile||null});saveDemo();renderAll();toast('Backup imported')}

  function bindEvents(){
    window.addEventListener('hashchange',route); window.addEventListener('online',()=>toast('Connection restored')); window.addEventListener('offline',()=>toast('You are offline'));
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstall=e;$('#installButton').hidden=false});
    $('#installButton').addEventListener('click',async()=>{if(state.deferredInstall){state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$('#installButton').hidden=true}else toast('Open Chrome menu and choose Add to Home screen')});
    $('#menuButton').addEventListener('click',()=>{const open=$('#mainNav').classList.toggle('open');$('#menuButton').setAttribute('aria-expanded',String(open))});
    $('#accountButton').addEventListener('click',()=>$('#accountDialog').showModal()); $('#hubSignInButton').addEventListener('click',()=>state.user?signOut():signIn());
    $('#refreshGarageButton').addEventListener('click',async()=>{ if(!state.user)return signIn(); $('#refreshGarageButton').disabled=true; try{await refreshFirebaseData();renderAll();toast('Garage refreshed')}finally{$('#refreshGarageButton').disabled=false} });
    $('#postSearch').addEventListener('input',filterCommunity);$('#categoryFilter').addEventListener('change',filterCommunity);$('#submissionStatusFilter').addEventListener('change',renderAdminLists);
    $('#chooseImagesButton').addEventListener('click',()=>$('#carImages').click());$('#uploadZone').addEventListener('click',e=>{if(e.target.id==='uploadZone'||e.target.classList.contains('upload-placeholder'))$('#carImages').click()});
    $('#carImages').addEventListener('change',e=>{const incoming=[...e.target.files];state.selectedImages=[...state.selectedImages,...incoming].slice(0,MAX_IMAGES);renderImagePreviews();e.target.value=''});
    $('#submissionForm textarea[name=story]').addEventListener('input',e=>$('#storyCount').textContent=e.target.value.length);$('#submissionForm').addEventListener('submit',e=>{e.preventDefault();saveSubmission('pending')});$('#saveDraftButton').addEventListener('click',()=>saveSubmission('draft'));
    $('#designerForm').addEventListener('submit',saveSettings);$('#previewHomeButton').addEventListener('click',()=>location.hash='#home');$('#editorialForm').addEventListener('submit',publishEditorial);$('#chooseEditorialImage').addEventListener('click',()=>$('#editorialImage').click());$('#editorialImage').addEventListener('change',e=>{state.editorialImage=e.target.files?.[0]||null;if(state.editorialImage)$('#editorialImagePreview img').src=URL.createObjectURL(state.editorialImage)});
    $('#reportForm').addEventListener('submit',submitReport);$('#profileForm').addEventListener('submit',saveProfile);$('#editProfileButton').addEventListener('click',()=>{const f=$('#profileForm');f.displayName.value=state.profile?.displayName||state.user?.displayName||'';f.location.value=state.profile?.location||'';f.bio.value=state.profile?.bio||'';f.website.value=state.profile?.website||'https://www.';$('#profileDialog').showModal()});
    $('#exportDemoButton').addEventListener('click',exportBackup);$('#importDemoInput').addEventListener('change',async e=>{try{await importBackup(e.target.files[0])}catch(err){toast(err.message)}e.target.value=''});$('#resetDemoButton').addEventListener('click',()=>{if(confirm('Reset all local demo content?')){localStorage.removeItem(DEMO_KEY);loadDemo();renderAll();toast('Demo reset')}});$('#copyUidButton').addEventListener('click',async()=>{await navigator.clipboard.writeText(state.user?.uid||'');toast('UID copied')});
    $$('#hubNav button').forEach(b=>b.addEventListener('click',()=>{$$('#hubNav button').forEach(x=>x.classList.toggle('active',x===b));$$('.hub-panel').forEach(p=>p.classList.toggle('active',p.dataset.hubPanel===b.dataset.hub));$('#hubTitle').textContent=b.textContent.replace(/\d+/g,'').trim()}));
    document.addEventListener('click',async e=>{
      const authBtn=e.target.closest('[data-auth]');if(authBtn){e.preventDefault();$('#accountDialog')?.close();state.user?await signOut():await signIn();return}
      const garageOpen=e.target.closest('[data-open-garage]');if(garageOpen){await openGarageDetail(garageOpen.dataset.openGarage);return}
      const open=e.target.closest('[data-open-post]');if(open){location.hash=`#post/${open.dataset.openPost}`;return}
      const back=e.target.closest('[data-back]');if(back){location.hash=`#${state.lastPublicRoute||'community'}`;return}
      const rem=e.target.closest('[data-remove-image]');if(rem){state.selectedImages.splice(Number(rem.dataset.removeImage),1);renderImagePreviews();return}
      const review=e.target.closest('[data-review-submission]');if(review){openReview(review.dataset.reviewSubmission);return}
      const sub=e.target.closest('[data-sub-action]');if(sub){await submissionAction(sub.dataset.id,sub.dataset.subAction);return}
      const feat=e.target.closest('[data-feature-post]');if(feat){await postAction(feat.dataset.featurePost,'feature');return}
      const del=e.target.closest('[data-delete-post]');if(del){await postAction(del.dataset.deletePost,'delete');return}
      const report=e.target.closest('[data-report-post]');if(report){$('#reportForm').postId.value=report.dataset.reportPost;$('#reportDialog').showModal();return}
      const resolve=e.target.closest('[data-resolve-report]');if(resolve){const id=resolve.dataset.resolveReport;if(state.mode==='firebase')await db.collection('reports').doc(id).update({status:'resolved'});else{const r=state.reports.find(x=>x.id===id);if(r)r.status='resolved';saveDemo()}renderAll();return}
      const close=e.target.closest('[data-close-dialog]');if(close){document.getElementById(close.dataset.closeDialog).close();return}
      const go=e.target.closest('[data-go-hub]');if(go){$(`#hubNav button[data-hub="${go.dataset.goHub}"]`)?.click();return}
    });
  }

  async function init(){loadDemo();bindEvents();renderAll();route();await initFirebase();renderAll();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(console.warn)}
  init();
})();
