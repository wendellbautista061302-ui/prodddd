/* ═══════════════════════════════════════════════════════════════════
   PROD2026 — FIREBASE / CLOUD SYNC MODULE (supabase-sync.js)
   
   Handles cross-device live sync via Firebase Realtime Database:
     jo_queue    → Scanner pushes new JOs; Master consumes & deletes
     jo_history  → Shared JO History (add on scan, remove on done)
     jos_data    → Shared calendar schedule
     jo_done     → Signal to remove a JO from history on all devices

   To configure: open Settings in the app and paste your Firebase config.
═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
       FIREBASE — COMPLETE CROSS-DEVICE LIVE SYNC
       Nodes:
         jo_queue    → Scanner pushes new JOs here; Master consumes & deletes
         jo_history  → Shared JO History (add on scan, remove on done) — LIVE
         jos_data    → Shared calendar schedule — LIVE
         jo_done     → Signal to remove a JO from history on all devices
    ═══════════════════════════════════════════════════════════════════ */
    var JO_FIREBASE_CONFIG = {
      apiKey:            "YOUR_API_KEY",
      authDomain:        "YOUR_PROJECT.firebaseapp.com",
      databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
      projectId:         "YOUR_PROJECT_ID",
      storageBucket:     "YOUR_PROJECT.appspot.com",
      messagingSenderId: "YOUR_SENDER_ID",
      appId:             "YOUR_APP_ID"
    };

    var _masterFbApp       = null;
    var _masterFbDb        = null;
    var _fbListener        = null;   // jo_queue
    var _fbSchedListener   = null;   // jos_data
    var _fbHistoryListener = null;   // jo_history
    var _fbDoneListener    = null;   // jo_done
    var _seenFbIds         = {};
    var _fbSyncPause       = false;
    var _fbHistPause       = false;

    function masterFbLoadConfig() {
      try {
        var saved = JSON.parse(localStorage.getItem('jo_firebase_cfg') || 'null');
        if (saved && saved.apiKey && saved.apiKey !== 'YOUR_API_KEY') {
          Object.assign(JO_FIREBASE_CONFIG, saved);
        }
      } catch(e) {}
    }
    masterFbLoadConfig();

    function masterFbInit() {
      if (_masterFbApp) return true;
      try {
        if (JO_FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') return false;
        _masterFbApp = firebase.initializeApp(JO_FIREBASE_CONFIG, 'master');
        _masterFbDb  = _masterFbApp.database();
        return true;
      } catch(e) {
        console.warn('Master Firebase init failed:', e);
        return false;
      }
    }

    /* ── Push calendar schedule to Firebase ── */
    function fbPushSchedule() {
      if (!masterFbInit() || _fbSyncPause) return;
      try {
        var data = (typeof josData !== 'undefined') ? josData : {};
        _masterFbDb.ref('jos_data').set(data);
      } catch(e) { console.warn('fbPushSchedule failed:', e); }
    }

    /* ── Push full JO History to Firebase (called after every local history change) ── */
    function fbPushHistory() {
      if (!masterFbInit() || _fbHistPause) return;
      try {
        // Convert array to object keyed by JO number for Firebase
        var obj = {};
        joHistory.forEach(function(h) {
          var key = h.jo.replace(/[^a-zA-Z0-9_]/g, '_');
          obj[key] = h;
        });
        _masterFbDb.ref('jo_history').set(obj);
      } catch(e) { console.warn('fbPushHistory failed:', e); }
    }

    /* ── Save JO History locally + push to Firebase ── */
    function saveHistory() {
      localStorage.setItem('jo_history_v8', JSON.stringify(joHistory));
      fbPushHistory();
    }

    /* ── Listen for JO History changes from ANY device ── */
    function startFbHistoryListener() {
      if (!masterFbInit() || _fbHistoryListener) return;
      _fbHistoryListener = _masterFbDb.ref('jo_history').on('value', function(snap) {
        var remote = snap.val();
        _fbHistPause = true;
        if (remote && typeof remote === 'object') {
          // Convert Firebase object back to array, sorted by ts desc
          var arr = Object.values(remote).sort(function(a, b) {
            return (b.ts || 0) - (a.ts || 0);
          });
          joHistory = arr;
        } else if (remote === null) {
          // All history was cleared remotely
          joHistory = [];
        }
        localStorage.setItem('jo_history_v8', JSON.stringify(joHistory));
        renderJOHistory();
        _fbHistPause = false;
      });
    }

    /* ── Listen for calendar schedule changes from ANY device ── */
    function startFbSchedListener() {
      if (!masterFbInit() || _fbSchedListener) return;
      _fbSchedListener = _masterFbDb.ref('jos_data').on('value', function(snap) {
        var remote = snap.val();
        if (!remote || typeof remote !== 'object') return;
        _fbSyncPause = true;
        if (typeof josData !== 'undefined') {
          Object.keys(remote).forEach(function(ds) { josData[ds] = remote[ds]; });
          Object.keys(josData).forEach(function(ds) { if (!remote[ds]) delete josData[ds]; });
          localStorage.setItem('jos_schedule_v1', JSON.stringify(josData));
          var ov = document.getElementById('joSchedulerOverlay');
          if (ov && ov.style.display === 'flex') josRender();
        }
        _fbSyncPause = false;
      });
    }

    /* ── Listen for incoming JOs from Scanner (jo_queue) ── */
    function startFbListener() {
      if (!masterFbInit()) return;
      if (_fbListener) return;

      /* jo_queue — new JO submitted from any Scanner */
      _fbListener = _masterFbDb.ref('jo_queue').on('child_added', function(snap) {
        var jo = snap.val();
        if (!jo || !jo['JO Number']) return;
        var id = snap.key;
        if (_seenFbIds[id]) return;
        _seenFbIds[id] = true;

        var joNum    = (jo['JO Number'] || '').trim();
        var today    = new Date().toLocaleDateString('sv-SE');
        var targetDate = jo._scheduledDate || new Date().toISOString().slice(0, 10);

        /* 1. Add to JO History (shared across all devices via Firebase) */
        var existsInHistory = joHistory.find(function(h) { return h.jo === joNum; });
        if (!existsInHistory) {
          joHistory.unshift({
            jo:      joNum,
            date:    today,
            ts:      Date.now(),
            item:    jo['Item Description'] || '',
            color:   jo['Color'] || '',
            pieces:  jo['No of Pieces'] || '',
            total:   jo['Total Qty'] || '',
            docdate: jo['Doc Date'] || '',
            status:  'pending'
          });
          if (joHistory.length > 100) joHistory = joHistory.slice(0, 100);
          saveHistory(); // saves locally + pushes to Firebase
          renderJOHistory();
        }

        /* 2. Auto-schedule onto the calendar */
        if (typeof josData !== 'undefined') {
          if (!josData[targetDate]) josData[targetDate] = [];
          var alreadyOnCal = josData[targetDate].some(function(e) { return e.jo === joNum; });
          if (!alreadyOnCal) {
            var entry = {
              id: id || (Date.now().toString(36) + Math.random().toString(36).slice(2,5)),
              jo: joNum, item: jo['Item Description']||'', color: jo['Color']||'',
              pieces: jo['No of Pieces']||'', totalqty: jo['Total Qty']||'',
              docdate: jo['Doc Date']||'', prepby: jo['Prepared By']||'',
              remarks: jo['Remarks']||'', note: jo['Note']||'',
              deadline: '', status: 'pending', addedAt: new Date().toISOString()
            };
            [32,34,36,38,40,42].forEach(function(s) { entry['s'+s] = jo[String(s)]||''; });
            josData[targetDate].push(entry);
            localStorage.setItem('jos_schedule_v1', JSON.stringify(josData));
            fbPushSchedule();
          }
        }

        /* 3. Show notification */
        josIncoming = josIncoming || [];
        josIncoming.push(jo);
        josIncomingSave();
        var ov = document.getElementById('joSchedulerOverlay');
        if (ov && ov.style.display === 'flex') {
          josIncomingIndex = josIncoming.length - 1;
          showIncomingBanner(); josRender();
          josToast('📥 New JO: ' + joNum, 'ok');
        } else {
          showFbNotificationDot(josIncoming.length);
        }
        snap.ref.remove();
      });

      startFbSchedListener();
      startFbHistoryListener();
      updateFbIndicator(true);
    }

    function stopFbListener() {
      if (_masterFbDb) {
        if (_fbListener)        { _masterFbDb.ref('jo_queue').off('child_added', _fbListener);   _fbListener=null; }
        if (_fbSchedListener)   { _masterFbDb.ref('jos_data').off('value', _fbSchedListener);     _fbSchedListener=null; }
        if (_fbHistoryListener) { _masterFbDb.ref('jo_history').off('value', _fbHistoryListener); _fbHistoryListener=null; }
      }
      updateFbIndicator(false);
    }

    function updateFbIndicator(connected) {
      var dot = document.getElementById('fb-sync-dot');
      if (!dot) return;
      dot.title = connected ? '☁️ Cloud sync active — live on all devices' : '⚠️ Cloud sync off — same device only';
      dot.style.background = connected ? '#22c55e' : '#f59e0b';
    }

    function showFbNotificationDot(count) {
      var btn = document.querySelector('[onclick="openJOScheduler()"]');
      if (!btn) return;
      var badge = btn.querySelector('.fb-count-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'fb-count-badge';
        badge.style.cssText = 'background:#ef4444;color:#fff;font-size:9px;font-weight:900;padding:2px 5px;border-radius:10px;margin-left:4px;';
        btn.appendChild(badge);
      }
      badge.textContent = count + ' new';
    }

    window.addEventListener('load', function() {
      masterFbLoadConfig();
      setTimeout(function() { startFbListener(); }, 1500);
    });