/* ═══════════════════════════════════════════════════════════════════
   PROD2026 MASTER CLOUD — MAIN APP LOGIC (main.js)

   Contains:
     - Navigation (Labor / Materials / Selection)
     - Labor System (scanner, processes, worker cards, finish modal)
     - Worker Stats & Analytics
     - JO History Panel
     - Materials System (issuance, returns, ledger)
     - JO Scheduler (Google Calendar-style)
     - JO Cost Tracker
     - Attendance Module
     - Print Utilities
═══════════════════════════════════════════════════════════════════ */

/* ===== NAVIGATION ===== */
    function backToMenu() {
        document.getElementById('laborView').style.display = 'none';
        document.getElementById('materialsView').style.display = 'none';
        document.getElementById('selectionView').style.display = 'flex';
    }
    function switchToLabor() {
        document.getElementById('selectionView').style.display = 'none';
        document.getElementById('materialsView').style.display = 'none';
        document.getElementById('laborView').style.display = 'block';
        initLabor();
    }
    function switchToMaterials() {
        document.getElementById('selectionView').style.display = 'none';
        document.getElementById('laborView').style.display = 'none';
        document.getElementById('materialsView').style.display = 'flex';
        initMaterials();
    }

    /* ===== LABOR LOGIC ===== */
    var samDB = JSON.parse(localStorage.getItem('prod_sam_v7')) || { "SEWING": 0.9, "PACKING": 0.9, "PUNCHING": 0.24 };
    var logs = JSON.parse(localStorage.getItem('logs_v7')) || [];
    var workerPhotos = JSON.parse(localStorage.getItem('worker_photos_v7')) || {};
    var laborRate = parseFloat(localStorage.getItem('labor_rate_v7')) || 106;
    var statsHistory = JSON.parse(localStorage.getItem('prod_stat_history_v1')) || {};
    /* Persistent archive: completed jobs survive resetDay() */
    var statsArchive = JSON.parse(localStorage.getItem('stats_archive_v7')) || [];
    var _activeFilter = { from: '', to: '' };  /* active date filter state */
    var currentActiveLog = null;

    function saveStatsArchive() {
        localStorage.setItem('stats_archive_v7', JSON.stringify(statsArchive));
        /* Broadcast to LIVE_v2 J.O. Cost tab instantly */
        try { new BroadcastChannel('prod2026_logs').postMessage('stats_updated'); } catch(e) {}
    }

    /* Merge a finished log entry into the persistent archive (no duplicates by uid) */
    function archiveCompletedEntry(entry) {
        var idx = statsArchive.findIndex(function(e){ return e.uid === entry.uid; });
        if (idx > -1) { statsArchive[idx] = entry; } else { statsArchive.push(entry); }
        saveStatsArchive();
    }

    function initLabor() {
        document.getElementById('scriptUrlField').value = localStorage.getItem('prod_script_url') || '';
        document.getElementById('laborRateInp').value = laborRate;
        renderLaborTable(); renderAdmin(); setupLaborAutoFlow(); renderStatsDashboard(); renderSideLeaderboard(); renderJOHistory();
    }

    function calculateNetMinutes(startTime, endTime) {
        var t1 = new Date(startTime); var t2 = new Date(endTime);
        if (isNaN(t1) || isNaN(t2) || t2 <= t1) return 1;
        var totalMins = (t2 - t1) / 60000;
        var breakStart = new Date(t1); breakStart.setHours(10, 0, 0, 0);
        var breakEnd = new Date(t1); breakEnd.setHours(10, 30, 0, 0);
        var overlapStart = Math.max(t1.getTime(), breakStart.getTime());
        var overlapEnd = Math.min(t2.getTime(), breakEnd.getTime());
        if (overlapEnd > overlapStart) { totalMins -= (overlapEnd - overlapStart) / 60000; }
        return Math.max(1, totalMins);
    }

    var laborFlowSetup = false;
    function setupLaborAutoFlow() {
        if (laborFlowSetup) return;
        laborFlowSetup = true;

        document.getElementById('scanJO').addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            var val = e.target.value.trim();
            if (!val) return;
            if (val.toUpperCase().startsWith('DONE|')) {
                var tid = val.split('|')[1].trim();
                var log = logs.find(function(l) { return String(l.uid).toUpperCase() === tid.toUpperCase(); });
                if (log) { if (log.timeOut) alert('JOB ALREADY COMPLETED'); else openFinishModal(log); }
                else alert('Record not found.');
                e.target.value = '';
            } else if (val.toUpperCase().startsWith('INFO|')) {
                var tid2 = val.split('|')[1].trim();
                var log2 = logs.find(function(l) { return String(l.uid).toUpperCase() === tid2.toUpperCase(); });
                e.target.value = '';
                if (log2) {
                    var mins = calculateNetMinutes(log2.timeIn, log2.timeOut);
                    var st = log2.status || (parseFloat(log2.efficiency) >= 70 ? 'PASS' : 'FAIL');
                    alert('PRODUCTION RECORD\n------------------\nDate: ' + log2.date + '\nJ.O.: ' + log2.jo + '\nWorker: ' + log2.operator + '\nProcess: ' + log2.process + '\nQty: ' + log2.qty + '\nHours: ' + (mins/60).toFixed(2) + '\nEff: ' + log2.efficiency + '%\nCost: \u20B1' + log2.laborCost + '\nStatus: ' + st + '\nRemarks: ' + (log2.remarks||'—'));
                } else alert('Record not found: ' + tid2);
            } else if (val.length > 2) {
                var joVal = val.toUpperCase();
                document.getElementById('displayJO').innerText = joVal;
                document.getElementById('displayJO2').innerText = 'J.O.: ' + joVal;
                document.getElementById('step1').style.display = 'none';
                document.getElementById('step2').style.display = 'block';
                document.getElementById('scanName').focus();
                e.target.value = '';
                /* Populate worker suggestions */
                filterWorkerSuggestions('');
            }
        });

        document.getElementById('scanName').addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            var val = e.target.value.trim().toUpperCase();
            if (val.length > 0) {
                document.getElementById('displayName').innerText = val;
                document.getElementById('step2').style.display = 'none';
                document.getElementById('step3').style.display = 'block';
                renderProcessPicker();
                setTimeout(function() { document.getElementById('scanProcessInp').focus(); }, 100);
                e.target.value = '';
            }
        });

        document.getElementById('scanProcessInp').addEventListener('keydown', function(e) {
            if (e.key !== 'Enter') return;
            var val = e.target.value.toUpperCase().trim();
            if (samDB[val]) { startNewJob(val); e.target.value = ''; }
        });
    }

    function startNewJob(proc) {
        var entry = {
            uid: 'J' + Date.now(),
            date: new Date().toLocaleDateString('sv-SE'),
            operator: document.getElementById('displayName').innerText,
            jo: document.getElementById('displayJO').innerText,
            process: proc, sam: samDB[proc],
            timeIn: new Date().toISOString(),
            timeOut: null, qty: 0, efficiency: 0, laborCost: 0, remarks: ''
        };
        logs.unshift(entry); saveLocally(); printStartSlip(entry.uid); resetSteps();
    }

    function openFinishModal(log) {
        currentActiveLog = log;
        document.getElementById('mJo').innerText = log.jo;
        document.getElementById('mWorker').innerText = log.operator;
        document.getElementById('mProcess').innerText = log.process;
        document.getElementById('mQtyInput').value = '';
        document.getElementById('mDefectInput').value = '';
        document.getElementById('mRemarksInput').value = log.remarks || '';
        function toLocalISO(d) { var dt = d ? new Date(d) : new Date(); return new Date(dt.getTime() - dt.getTimezoneOffset()*60000).toISOString().slice(0,16); }
        document.getElementById('mTimeIn').value = toLocalISO(log.timeIn);
        document.getElementById('mTimeOut').value = toLocalISO(null);
        document.getElementById('finishOverlay').style.display = 'flex';
        setTimeout(function() { document.getElementById('mQtyInput').focus(); }, 200);
        updateLiveStats();
    }

    function updateLiveStats() {
        if (!currentActiveLog) return;
        var t1 = document.getElementById('mTimeIn').value;
        var t2 = document.getElementById('mTimeOut').value;
        var qty = parseFloat(document.getElementById('mQtyInput').value) || 0;
        var defectQty = parseFloat(document.getElementById('mDefectInput').value) || 0;
        var mins = calculateNetMinutes(t1, t2);
        var eff = ((qty * currentActiveLog.sam) / mins * 100).toFixed(1);
        var totalProduced = qty + defectQty;
        var defectRate = totalProduced > 0 ? ((defectQty / totalProduced) * 100).toFixed(1) : '0.0';
        document.getElementById('mHrsVal').innerText = (mins/60).toFixed(2);
        document.getElementById('mEffVal').innerText = eff + '%';
        document.getElementById('mCostVal').innerText = '\u20B1' + ((mins/60)*laborRate).toFixed(2);
        var defSpan = document.getElementById('mDefectVal');
        defSpan.innerText = defectRate + '%';
        defSpan.style.color = parseFloat(defectRate) > 5 ? '#dc2626' : parseFloat(defectRate) > 2 ? '#f59e0b' : '#16a34a';
        var bar = document.getElementById('mStatusBox');
        bar.innerText = eff >= 70 ? 'PASS' : 'FAIL';
        bar.className = 'status-strip ' + (eff >= 70 ? 'status-pass' : 'status-fail');
    }

    async function submitFinish() {
        var qty = parseFloat(document.getElementById('mQtyInput').value);
        if (isNaN(qty)) return alert('Please enter Qty');
        var idx = logs.findIndex(function(l) { return String(l.uid) === String(currentActiveLog.uid); });
        if (idx === -1) return;
        var t1 = document.getElementById('mTimeIn').value;
        var t2 = document.getElementById('mTimeOut').value;
        var mins = calculateNetMinutes(t1, t2);
        var defectQty = parseFloat(document.getElementById('mDefectInput').value) || 0;
        logs[idx].timeIn = new Date(t1).toISOString();
        logs[idx].timeOut = new Date(t2).toISOString();
        logs[idx].qty = qty;
        logs[idx].defectQty = defectQty;
        logs[idx].remarks = document.getElementById('mRemarksInput').value;
        logs[idx].efficiency = ((qty * logs[idx].sam) / mins * 100).toFixed(1);
        logs[idx].laborCost = ((mins / 60) * laborRate).toFixed(2);
        logs[idx].status = parseFloat(logs[idx].efficiency) >= 70 ? 'PASS' : 'FAIL';
        archiveCompletedEntry(logs[idx]);
        updateStatsHistory(logs[idx]);
        saveLocally();
        renderSideLeaderboard();
        /* Edge fix: cloud sync errors must never block the save */
        try { await syncWithCloud(logs[idx]); } catch(_e) { console.warn('cloud sync skipped'); }
        var _uid = logs[idx] ? logs[idx].uid : null;
        closeModal();
        if (_uid) printFinishSlip(_uid);
    }

    function updateStatsHistory(entry) {
        var name = entry.operator; var mins = calculateNetMinutes(entry.timeIn, entry.timeOut);
        if (!statsHistory[name]) statsHistory[name] = { totalHrs:0, totalQty:0, totalCost:0, jobs:0, processes:{} };
        var s = statsHistory[name];
        s.totalHrs  += (mins/60);
        s.totalQty  += parseFloat(entry.qty)       || 0;
        s.totalCost += parseFloat(entry.laborCost) || 0;
        s.jobs      += 1;
        if (!s.processes[entry.process]) s.processes[entry.process] = { totalEff:0, count:0 };
        s.processes[entry.process].totalEff += parseFloat(entry.efficiency) || 0;
        s.processes[entry.process].count    += 1;
        localStorage.setItem('prod_stat_history_v1', JSON.stringify(statsHistory));
        renderStatsDashboard();
    }

    /* ══════ CHART REGISTRY ══════ */
    var _workerCharts = {};
    function _destroyCharts() {
        Object.keys(_workerCharts).forEach(function(k){ try{ _workerCharts[k].destroy(); }catch(e){} });
        _workerCharts = {};
    }

    /* ══════ DATA VALIDATION ══════ */
    function isValidEntry(l) {
        if (!l.timeOut) return false;
        var qty=parseFloat(l.qty), eff=parseFloat(l.efficiency), cost=parseFloat(l.laborCost);
        var mins=calculateNetMinutes(l.timeIn,l.timeOut);
        if (isNaN(qty)||qty<=0)               return false;
        if (isNaN(eff)||eff<=0||eff>500)      return false;
        if (isNaN(cost)||cost<=0)             return false;
        if (mins<2)                           return false;
        if (!l.operator||!l.process)          return false;
        return true;
    }

    function buildStatsFromLogs(logsArr) {
        var result = {};
        logsArr.filter(isValidEntry).forEach(function(entry) {
            var name=entry.operator.trim(), mins=calculateNetMinutes(entry.timeIn,entry.timeOut);
            var eff=parseFloat(entry.efficiency), cost=parseFloat(entry.laborCost), qty=parseFloat(entry.qty);
            var dQty=parseFloat(entry.defectQty)||0;
            var day=getEntryDate(entry);
            if (!result[name]) result[name]={ totalHrs:0,totalQty:0,totalCost:0,jobs:0,passJobs:0,totalDefects:0,processes:{},dailyData:{} };
            var s=result[name];
            s.totalHrs+=(mins/60); s.totalQty+=qty; s.totalCost+=cost; s.jobs+=1; s.totalDefects+=dQty;
            if (eff>=70) s.passJobs+=1;
            if (!s.processes[entry.process]) s.processes[entry.process]={totalEff:0,count:0};
            s.processes[entry.process].totalEff+=eff; s.processes[entry.process].count+=1;
            if (!s.dailyData[day]) s.dailyData[day]={totalEff:0,count:0,hrs:0,defects:0};
            s.dailyData[day].totalEff+=eff; s.dailyData[day].count+=1; s.dailyData[day].hrs+=(mins/60); s.dailyData[day].defects+=dQty;
        });
        return result;
    }

    /* ══════ POINTS: 3 pillars (35+35+30=100) ══════ */
    function calcPoints(s) {
        var days=Object.keys(s.dailyData);
        var hrsPts=days.length ? days.reduce(function(a,d){return a+Math.min(35,(s.dailyData[d].hrs/7)*35);},0)/days.length : 0;
        var avgDailyHrs=days.length ? days.reduce(function(a,d){return a+s.dailyData[d].hrs;},0)/days.length : s.totalHrs;
        var totalProduced=s.totalQty+s.totalDefects;
        var defectRate=totalProduced>0?s.totalDefects/totalProduced:0;
        var qualPts=Math.max(0,35*(1-(defectRate/0.10)));
        var procList=Object.keys(s.processes).map(function(p){return s.processes[p].totalEff/s.processes[p].count;});
        var avgEff=procList.length?procList.reduce(function(a,b){return a+b;},0)/procList.length:0;
        var effPts=avgEff>=70?15+Math.min(15,((avgEff-70)/30)*15):Math.max(0,(avgEff/70)*15);
        return { total:Math.min(100,Math.round(hrsPts+qualPts+effPts)), hrsPts:Math.round(hrsPts), qualPts:Math.round(qualPts), effPts:Math.round(effPts), avgEff:avgEff, avgDailyHrs:avgDailyHrs, defectRate:defectRate, passRate:s.jobs>0?(s.passJobs/s.jobs)*100:0 };
    }

    function _ptsRow(label, earned, max, color) {
        var pct=Math.min(100,(earned/max)*100);
        return '<div class="pts-row"><span class="pts-cat">'+label+'</span>'
            +'<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
            +'<div style="width:70px;background:#e2e8f0;border-radius:99px;height:6px;overflow:hidden;"><div style="width:'+pct+'%;height:100%;background:'+color+';border-radius:99px;"></div></div>'
            +'<span class="pts-earned" style="color:'+color+';min-width:44px;text-align:right;">'+earned+' / '+max+'</span></div></div>';
    }

    function renderTeamKpi(data, ranked) {
        var bar=document.getElementById('teamKpiBar'); if(!bar) return;
        var totalHrs=0,totalQty=0,totalCost=0,totalJobs=0,totalPass=0,totalDefects=0;
        Object.keys(data).forEach(function(n){var s=data[n]; totalHrs+=s.totalHrs; totalQty+=s.totalQty; totalCost+=s.totalCost; totalJobs+=s.jobs; totalPass+=s.passJobs; totalDefects+=s.totalDefects;});
        var teamPassRate=totalJobs>0?((totalPass/totalJobs)*100).toFixed(1):'N/A';
        var tot=totalQty+totalDefects; var teamDefRate=tot>0?((totalDefects/tot)*100).toFixed(1):'0.0';
        var teamAvgPts=ranked.length?Math.round(ranked.reduce(function(a,b){return a+b.pts.total;},0)/ranked.length):0;
        var top=ranked.length?ranked[0].name:'N/A';
        var kpis=[
            {val:Object.keys(data).length, lbl:'Workers',        color:'#3b82f6'},
            {val:totalJobs,                 lbl:'Valid Jobs',     color:'#8b5cf6'},
            {val:totalQty.toLocaleString(), lbl:'Total Qty',      color:'#0891b2'},
            {val:totalHrs.toFixed(1)+'h',   lbl:'Total Hours',    color:'#f59e0b'},
            {val:'₱'+totalCost.toLocaleString(undefined,{maximumFractionDigits:0}), lbl:'Total Cost', color:'#10b981'},
            {val:teamPassRate+'%',           lbl:'Team Pass Rate', color:parseFloat(teamPassRate)>=70?'#16a34a':'#dc2626'},
            {val:teamDefRate+'%',            lbl:'Team Defect%',   color:parseFloat(teamDefRate)>5?'#dc2626':'#16a34a'},
            {val:teamAvgPts+' pts',          lbl:'Avg Team Pts',   color:'#d97706'},
            {val:top,                        lbl:'Top Performer',  color:'#f59e0b'}
        ];
        bar.innerHTML=kpis.map(function(k){
            var fs=k.val.toString().length>8?'13px':'20px';
            return '<div class="kpi-tile" style="border-left-color:'+k.color+'"><div class="kpi-val" style="color:'+k.color+';font-size:'+fs+';">'+k.val+'</div><div class="kpi-lbl">'+k.lbl+'</div></div>';
        }).join('');
    }

    function renderPodium(ranked) {
        var sec=document.getElementById('podiumSection'),bar=document.getElementById('podiumBar'),list=document.getElementById('podiumList');
        if (!ranked.length){sec.style.display='none';return;} sec.style.display='block';
        var podOrder=ranked.length>=3?[ranked[1],ranked[0],ranked[2]]:ranked.slice();
        var heights=[60,95,45],emojis=['🥈','🥇','🥉'];
        bar.innerHTML=podOrder.map(function(w,i){return '<div class="podium-col"><div class="podium-pts">'+w.pts.total+' pts</div><div class="podium-block" style="height:'+heights[i]+'px;background:'+(i===1?'#fde68a':i===0?'#e2e8f0':'#fcd9b0')+'">'+emojis[i]+'</div><div class="podium-name">'+w.name+'</div></div>';}).join('');
        var mc=['#f59e0b','#94a3b8','#cd7f32'];
        list.innerHTML=ranked.map(function(w,i){var c=i<3?mc[i]:'#cbd5e1',ico=i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1);
            return '<div style="display:flex;align-items:center;gap:12px;background:white;border-radius:12px;padding:10px 14px;border-left:5px solid '+c+'">'
                +'<span style="font-size:16px;width:26px;text-align:center;">'+ico+'</span>'
                +'<span style="font-weight:900;flex:1;color:#1e293b;">'+w.name+'</span>'
                +'<span style="font-size:10px;color:#94a3b8;margin-right:8px;">Hrs '+w.pts.avgDailyHrs.toFixed(1)+'/day · Def '+(w.pts.defectRate*100).toFixed(1)+'% · Eff '+w.pts.avgEff.toFixed(1)+'%</span>'
                +'<span style="font-weight:900;color:'+c+';font-size:18px;">'+w.pts.total+'</span><span style="font-size:10px;color:#94a3b8;"> / 100</span></div>';
        }).join('');
    }

    function renderStatsDashboard(customData) {
        _destroyCharts();
        var dashboard=document.getElementById('statsDashboard'); dashboard.innerHTML='';
        /* If a date filter is active and no customData forced in, re-run the filter */
        if (!customData && _activeFilter && _activeFilter.from) {
            _runFilter();
            return;
        }
        /* Use customData (from filter) or build from full archive (all-time view) */
        var data = customData || buildStatsFromLogs(getMergedArchive());
        if (!Object.keys(data).length) {
            document.getElementById('teamKpiBar').innerHTML='';
            document.getElementById('podiumSection').style.display='none';
            dashboard.innerHTML='<p style="color:#94a3b8;text-align:center;grid-column:1/-1;padding:40px 0;">No valid completed records found.<br><small>Records need qty &gt; 0, efficiency &gt; 0%, job time &gt; 2 min.</small></p>';
            return;
        }
        var ranked=Object.keys(data).map(function(name){return{name:name,s:data[name],pts:calcPoints(data[name])};}).sort(function(a,b){return b.pts.total-a.pts.total;});
        renderTeamKpi(data,ranked); renderPodium(ranked);
        ranked.forEach(function(w,idx){
            var name=w.name,s=w.s,pts=w.pts,rank=idx+1;
            var mc=rank===1?'#f59e0b':rank===2?'#94a3b8':rank===3?'#cd7f32':'#e2e8f0';
            var mi=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
            var procList=Object.keys(s.processes).map(function(p){return{name:p,avg:s.processes[p].totalEff/s.processes[p].count,count:s.processes[p].count};}).sort(function(a,b){return b.avg-a.avg;});
            var avgEff=pts.avgEff,barColor=avgEff>=90?'#16a34a':avgEff>=70?'#f59e0b':'#dc2626';
            var barW=Math.min(100,avgEff).toFixed(1);
            var statusLbl=avgEff>=90?'🏆 EXCELLENT':avgEff>=70?'✅ PASS':'⚠️ IMPROVE';
            var statusBg=avgEff>=70?'#dcfce7':'#fee2e2',statusClr=avgEff>=70?'#166534':'#991b1b';
            var top3=procList.slice(0,3),low3=procList.length>3?procList.slice(-3).reverse():[];
            var topHTML=top3.map(function(p){return '<div class="stat-row" style="border:none"><span>'+p.name+' <span style="color:#94a3b8;font-size:10px;">('+p.count+'x)</span></span><span class="top-rank">'+p.avg.toFixed(1)+'%</span></div>';}).join('');
            var lowHTML=low3.map(function(p){return '<div class="stat-row" style="border:none"><span>'+p.name+' <span style="color:#94a3b8;font-size:10px;">('+p.count+'x)</span></span><span class="low-rank">'+p.avg.toFixed(1)+'%</span></div>';}).join('');
            var defRatePct=(pts.defectRate*100).toFixed(1);
            var defClr=parseFloat(defRatePct)>5?'#dc2626':parseFloat(defRatePct)>2?'#f59e0b':'#16a34a';
            var hrsClr=pts.avgDailyHrs>=7?'#16a34a':pts.avgDailyHrs>=5?'#f59e0b':'#dc2626';
            var cid='chart_'+name.replace(/\W/g,'_');
            dashboard.innerHTML+='<div class="stat-card" style="border-left:5px solid '+mc+'">'
                +'<div class="pts-badge"><div class="pts-num">'+pts.total+'</div><div class="pts-lbl">pts</div></div>'
                +'<div style="padding-right:70px;margin-bottom:8px;">'
                +'<div class="stat-worker-name" style="border:none;margin:0;">'+mi+' '+name+'</div>'
                +'<span style="font-size:11px;font-weight:900;padding:3px 9px;border-radius:8px;background:'+statusBg+';color:'+statusClr+';">'+statusLbl+'</span>'
                +'</div>'
                +'<div class="eff-bar-wrap"><div class="eff-bar-fill" style="width:'+barW+'%;background:'+barColor+'"></div></div>'
                +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px;">'
                +'<div style="text-align:center;background:white;border-radius:10px;padding:7px 3px;"><div style="font-size:15px;font-weight:900;color:#3b82f6;">'+s.jobs+'</div><div style="font-size:8px;color:#94a3b8;font-weight:800;text-transform:uppercase;">Jobs</div></div>'
                +'<div style="text-align:center;background:white;border-radius:10px;padding:7px 3px;"><div style="font-size:15px;font-weight:900;color:'+hrsClr+';">'+pts.avgDailyHrs.toFixed(1)+'h</div><div style="font-size:8px;color:#94a3b8;font-weight:800;text-transform:uppercase;">Avg/Day</div></div>'
                +'<div style="text-align:center;background:white;border-radius:10px;padding:7px 3px;"><div style="font-size:15px;font-weight:900;color:'+defClr+';">'+defRatePct+'%</div><div style="font-size:8px;color:#94a3b8;font-weight:800;text-transform:uppercase;">Defect%</div></div>'
                +'<div style="text-align:center;background:white;border-radius:10px;padding:7px 3px;"><div style="font-size:13px;font-weight:900;color:#10b981;">₱'+s.totalCost.toLocaleString(undefined,{maximumFractionDigits:0})+'</div><div style="font-size:8px;color:#94a3b8;font-weight:800;text-transform:uppercase;">Earned</div></div>'
                +'</div>'
                +'<div class="pts-breakdown">'
                +'<div style="font-size:10px;font-weight:900;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">⭐ Points Breakdown</div>'
                +_ptsRow('⏱ Daily Hours ('+pts.avgDailyHrs.toFixed(1)+'h avg · target 7h)',pts.hrsPts,35,hrsClr)
                +_ptsRow('✅ Quality / Defect Rate ('+defRatePct+'%)',pts.qualPts,35,defClr)
                +_ptsRow('⚡ Efficiency ('+avgEff.toFixed(1)+'% avg)',pts.effPts,30,barColor)
                +'</div>'
                +(top3.length?'<div style="margin-top:10px;border-top:1px solid #ddd;padding-top:8px;"><span class="stat-label" style="color:var(--success)">⭐ TOP PROCESSES</span>'+topHTML+'</div>':'')
                +(low3.length?'<div style="margin-top:8px;border-top:1px solid #ddd;padding-top:8px;"><span class="stat-label" style="color:var(--danger)">⚠️ LOWEST PROCESSES</span>'+lowHTML+'</div>':'')
                +'<div class="worker-chart-wrap"><canvas id="'+cid+'"></canvas></div>'
                +'<button class="btn-del-worker" onclick="deleteWorkerStats(\''+name.replace(/'/g,"\\'")+'\')" title="Delete all stats for this worker">🗑 DELETE WORKER</button>'
                +'</div>';
        });
        setTimeout(function(){
            ranked.forEach(function(w){
                var s=w.s,cid='chart_'+w.name.replace(/\W/g,'_'),canvas=document.getElementById(cid); if(!canvas) return;
                var days=Object.keys(s.dailyData).sort();
                var dayAvgEff=days.map(function(d){return(s.dailyData[d].totalEff/s.dailyData[d].count).toFixed(1);});
                var dayHrs=days.map(function(d){return s.dailyData[d].hrs.toFixed(2);});
                if (days.length>1) {
                    _workerCharts[cid]=new Chart(canvas,{type:'line',data:{labels:days,datasets:[
                        {label:'Eff %',data:dayAvgEff,borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.07)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:dayAvgEff.map(function(v){return parseFloat(v)>=70?'#16a34a':'#dc2626';}),tension:0.35,fill:true,yAxisID:'y'},
                        {label:'70% target',data:days.map(function(){return 70;}),borderColor:'rgba(220,38,38,0.45)',borderDash:[6,4],borderWidth:1.5,pointRadius:0,fill:false,yAxisID:'y'},
                        {label:'Hrs',data:dayHrs,borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,0.07)',borderWidth:2,pointRadius:3,tension:0.35,fill:false,yAxisID:'y2'}
                    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false}},scales:{y:{min:0,max:150,position:'left',ticks:{font:{size:9},callback:function(v){return v+'%';}},grid:{color:'rgba(0,0,0,0.04)'}},y2:{min:0,max:12,position:'right',ticks:{font:{size:9},callback:function(v){return v+'h';}},grid:{display:false}},x:{ticks:{font:{size:9},maxRotation:30},grid:{display:false}}}}});
                } else {
                    var procList=Object.keys(s.processes).map(function(p){return{name:p,avg:s.processes[p].totalEff/s.processes[p].count};}).sort(function(a,b){return b.avg-a.avg;});
                    _workerCharts[cid]=new Chart(canvas,{type:'bar',data:{labels:procList.map(function(p){return p.name;}),datasets:[
                        {label:'Avg Eff %',data:procList.map(function(p){return p.avg.toFixed(1);}),backgroundColor:procList.map(function(p){return p.avg>=70?'rgba(22,163,74,0.75)':'rgba(220,38,38,0.75)';}),borderRadius:6,borderSkipped:false},
                        {label:'70%',data:procList.map(function(){return 70;}),type:'line',borderColor:'rgba(220,38,38,0.55)',borderDash:[6,4],borderWidth:1.5,pointRadius:0,fill:false}
                    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:150,ticks:{font:{size:9},callback:function(v){return v+'%';}},grid:{color:'rgba(0,0,0,0.04)'}},x:{ticks:{font:{size:9}},grid:{display:false}}}}});
                }
            });
        },80);
    }

    /* Delete a single worker from stats */
    function deleteWorkerStats(name) {
        if (!confirm('Delete ALL stats for "' + name + '"? This cannot be undone.')) return;
        /* Remove from statsHistory */
        delete statsHistory[name];
        localStorage.setItem('prod_stat_history_v1', JSON.stringify(statsHistory));
        /* Remove from persistent archive */
        statsArchive = statsArchive.filter(function(e){ return e.operator !== name; });
        saveStatsArchive();
        /* Remove from logs */
        logs = logs.filter(function(l){ return l.operator !== name; });
        saveLocally();
        renderStatsDashboard();
    }

    /* Reliable date extraction — never shifts due to timezone */
    function getEntryDate(l) {
        if (l.date && /^\d{4}-\d{2}-\d{2}$/.test(l.date)) return l.date;
        if (l.timeIn) {
            var s = l.timeIn.toString();
            if (s.length >= 10) return s.slice(0, 10);
        }
        return '';
    }

    /* Returns merged archive + live logs, deduplicated by uid */
    function getMergedArchive() {
        var merged = statsArchive.slice();
        logs.filter(function(l) { return l.timeOut; }).forEach(function(l) {
            var ai = merged.findIndex(function(e) { return e.uid === l.uid; });
            if (ai > -1) { merged[ai] = l; } else { merged.push(l); }
        });
        return merged;
    }

    /* Auto-fill TO date when FROM is picked */
    function autoFillTo() {
        var from = document.getElementById('statFilterFrom').value;
        var to   = document.getElementById('statFilterTo').value;
        if (from && !to) {
            document.getElementById('statFilterTo').value = from;
        }
    }

    /* TODAY shortcut */
    function filterToday() {
        var today = new Date().toLocaleDateString('sv-SE');
        document.getElementById('statFilterFrom').value = today;
        document.getElementById('statFilterTo').value   = today;
        applyDateFilter();
    }

    function applyDateFilter() {
        var from = document.getElementById('statFilterFrom').value;
        var to   = document.getElementById('statFilterTo').value;
        if (!from) return alert('Please select a FROM date.');
        if (!to)   { to = from; document.getElementById('statFilterTo').value = from; }
        if (from > to) return alert('FROM date cannot be after TO date.');
        _activeFilter.from = from;
        _activeFilter.to   = to;
        _runFilter();
    }

    function _runFilter() {
        var from = _activeFilter.from;
        var to   = _activeFilter.to;
        if (!from || !to) { _renderAllTime(); return; }

        var merged = getMergedArchive();
        var subset = merged.filter(function(l) {
            var d = getEntryDate(l);
            return d && d >= from && d <= to;
        });

        var label = (from === to) ? from : (from + ' to ' + to);

        if (!subset.length) {
            document.getElementById('statsFilterLabel').innerText = 'No records found: ' + label;
            _destroyCharts();
            document.getElementById('teamKpiBar').innerHTML = '';
            document.getElementById('podiumSection').style.display = 'none';
            document.getElementById('statsDashboard').innerHTML =
                '<p style="color:#e74c3c;text-align:center;grid-column:1/-1;padding:40px 0;font-weight:900;font-size:16px;">' +
                '\u26a0\ufe0f No records found for <b>' + label + '</b>' +
                '<br><span style="color:#94a3b8;font-weight:400;font-size:13px;">Make sure finished jobs exist for this date.</span></p>';
            return;
        }

        var data = buildStatsFromLogs(subset);
        if (!Object.keys(data).length) {
            document.getElementById('statsFilterLabel').innerText = 'Validation failed: ' + label;
            _destroyCharts();
            document.getElementById('statsDashboard').innerHTML =
                '<p style="color:#e74c3c;text-align:center;grid-column:1/-1;padding:40px 0;font-weight:900;">' +
                '\u26a0\ufe0f Records found but failed validation<br>' +
                '<span style="color:#94a3b8;font-weight:400;font-size:13px;">Need: qty &gt; 0, efficiency &gt; 0%, job time &gt; 2 min</span></p>';
            return;
        }

        document.getElementById('statsFilterLabel').innerText =
            'Showing: ' + label + '  \u00b7  ' + subset.length + ' jobs';
        renderStatsDashboard(data);
    }

    function _renderAllTime() {
        document.getElementById('statsFilterLabel').innerText = 'Showing: All-Time \u00b7 Verified completed jobs only';
        renderStatsDashboard();
    }

    function clearDateFilter() {
        _activeFilter.from = '';
        _activeFilter.to   = '';
        document.getElementById('statFilterFrom').value = '';
        document.getElementById('statFilterTo').value   = '';
        _renderAllTime();
    }


    /* ══════ PASSWORD LOCK ══════ */
    var _statsUnlocked = false;
    function openStatsWithLock() {
        document.getElementById('adminPanel').style.display='none';
        var el=document.getElementById('statsPanel');
        if (el.style.display==='block') { closeStats(); return; }
        el.style.display='block';
        if (_statsUnlocked) {
            document.getElementById('statsLockScreen').style.display='none';
            document.getElementById('statsContent').style.display='block';
            renderStatsDashboard();
        } else {
            document.getElementById('statsLockScreen').style.display='flex';
            document.getElementById('statsContent').style.display='none';
            document.getElementById('statsLockError').style.display='none';
            document.getElementById('statsPasswordInput').value='';
            setTimeout(function(){ document.getElementById('statsPasswordInput').focus(); },200);
        }
    }
    function checkStatsPassword() {
        var pw=document.getElementById('statsPasswordInput').value;
        if (pw==='McjimBelt2026') {
            _statsUnlocked=true;
            document.getElementById('statsLockScreen').style.display='none';
            document.getElementById('statsContent').style.display='block';
            document.getElementById('statsLockError').style.display='none';
            renderStatsDashboard();
        } else {
            document.getElementById('statsLockError').style.display='block';
            document.getElementById('statsPasswordInput').value='';
            document.getElementById('statsPasswordInput').focus();
        }
    }
    function lockStats() {
        _statsUnlocked=false;
        document.getElementById('statsLockScreen').style.display='flex';
        document.getElementById('statsContent').style.display='none';
        document.getElementById('statsPasswordInput').value='';
        document.getElementById('statsLockError').style.display='none';
    }
    function closeStats() {
        document.getElementById('statsPanel').style.display='none';
    }

    /* ══════ ATTENDANCE ══════ */
    var _attWeekOffset = 0;

    function getWeekDates(offset) {
        var now=new Date(); now.setHours(0,0,0,0);
        var dow=now.getDay(); var mon=new Date(now); mon.setDate(now.getDate()-(dow===0?6:dow-1)+(offset*7));
        var dates=[];
        for (var i=0;i<6;i++){ var d=new Date(mon); d.setDate(mon.getDate()+i); dates.push(d); }
        return dates;
    }

    /* Use local date parts — toISOString() shifts to UTC which breaks PH timezone (UTC+8) */
    function fmtDate(d){
        var y=d.getFullYear();
        var m=('0'+(d.getMonth()+1)).slice(-2);
        var day=('0'+d.getDate()).slice(-2);
        return y+'-'+m+'-'+day;
    }
    function fmtLabel(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }

    function attChangeWeek(dir){ _attWeekOffset+=dir; renderAttendance(); }
    function attGoToCurrentWeek(){ _attWeekOffset=0; renderAttendance(); }

    function renderAttendance() {
        var dates=getWeekDates(_attWeekOffset);
        var dayKeys=['mon','tue','wed','thu','fri','sat'];
        /* Update column headers */
        ['MON','TUE','WED','THU','FRI','SAT'].forEach(function(d,i){
            var el=document.getElementById('attH_'+dayKeys[i]);
            if(el) el.innerHTML=d+'<br><span style="font-size:10px;font-weight:600;color:#64748b;">'+fmtLabel(dates[i])+'</span>';
        });
        /* Update week label */
        document.getElementById('attWeekLabel').innerText=fmtLabel(dates[0])+' — '+fmtLabel(dates[5]);

        var archive=JSON.parse(localStorage.getItem('attendance_archive_v7')||'[]');
        var live=JSON.parse(localStorage.getItem('logs_v7')||'[]');
        /* Merge live into archive */
        live.forEach(function(p){
            var idx=archive.findIndex(function(a){return a.uid===p.uid;});
            if(idx>-1){ if(JSON.stringify(archive[idx])!==JSON.stringify(p)) archive[idx]=p; }
            else archive.push(p);
        });
        /* ALSO merge permanent store — this restores any entries deleted from external attendance HTML */
        var permanentEntries = Object.values(JSON.parse(localStorage.getItem('att_permanent_v8') || '{}'));
        permanentEntries.forEach(function(p) {
            if (!p || !p.uid) return;
            var idx = archive.findIndex(function(a){ return a.uid === p.uid; });
            if (idx === -1) archive.push(p); /* restore deleted entry */
        });
        localStorage.setItem('attendance_archive_v7',JSON.stringify(archive));
        /* Save current state to permanent store */
        savePermanentAttendance(archive);

        /* Build workers map for this week only */
        var workers={};
        var weekDateStrs=dates.map(fmtDate);
        archive.forEach(function(log){
            /* Get date from log — use stored date or extract from timeIn using local time */
            var d=log.date;
            if(!d && log.timeIn){
                var _ti=new Date(log.timeIn);
                d=_ti.getFullYear()+'-'+('0'+(_ti.getMonth()+1)).slice(-2)+'-'+('0'+_ti.getDate()).slice(-2);
            }
            var di=weekDateStrs.indexOf(d); if(di<0) return; // not this week
            var name=log.operator; if(!name) return;
            if(!workers[name]) workers[name]={name:name,days:{}};
            var dayKey=dayKeys[di];
            var hrs=0;
            if(log.timeIn&&log.timeOut){ hrs=(new Date(log.timeOut)-new Date(log.timeIn))/3600000; if(hrs>4.5) hrs-=0.5; }
            var isLate=new Date(log.timeIn).getHours()>=7;
            if(!workers[name].days[dayKey]) {
                workers[name].days[dayKey]={isLate:isLate,totalHrs:hrs,sumEff:parseFloat(log.efficiency||0),count:1};
            } else {
                workers[name].days[dayKey].totalHrs+=hrs;
                workers[name].days[dayKey].sumEff+=parseFloat(log.efficiency||0);
                workers[name].days[dayKey].count+=1;
            }
        });

        var tbody=document.getElementById('attTableBody'); tbody.innerHTML='';
        var tdBase='border:1px solid #000; padding:4px; text-align:center; font-size:13px; height:45px; vertical-align:middle;';
        Object.keys(workers).sort().forEach(function(name){
            var w=workers[name];
            var row='<tr><td style="'+tdBase+' width:170px; text-align:left; padding-left:8px; font-weight:bold;">'+name+'</td>';
            dayKeys.forEach(function(dk){
                var dd=dates[dayKeys.indexOf(dk)];
                var isToday=fmtDate(dd)===fmtDate(new Date());
                var bg=isToday?'background:#fffbeb;':'';
                var d=w.days[dk];
                if(d){
                    var avgEff=d.sumEff/d.count;
                    row+='<td style="'+tdBase+bg+'">'
                        +'<div style="display:flex;justify-content:center;align-items:center;gap:4px;">'
                        +(d.isLate?'<span style="background:#ff0000;color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;">L</span>':'<span style="font-size:16px;">😊</span>')
                        +(avgEff>=70?'<span style="font-size:15px;">✅</span>':'<span style="font-size:15px;">❌</span>')
                        +'</div>'
                        +'<span style="font-size:9px;color:#444;display:block;margin-top:1px;">'+d.totalHrs.toFixed(1)+'h'+(d.totalHrs>7.5?' <b style="font-size:8px;background:#000;color:#fff;padding:1px 2px;border-radius:2px;">OT</b>':'')+'</span>'
                        +'</td>';
                } else {
                    row+='<td style="'+tdBase+bg+'"><span style="background:#ff0000;color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;margin:auto;">A</span></td>';
                }
            });
            row+='<td style="'+tdBase+'" class="no-print"><button onclick="attDeleteWorker(\''+name.replace(/'/g,"\\'")+'\')" style="background:#ff4d4d;color:white;border:none;padding:3px 8px;cursor:pointer;border-radius:4px;font-size:10px;font-weight:bold;">×</button></td>';
            row+='</tr>';
            tbody.innerHTML+=row;
        });
        if (!Object.keys(workers).length) {
            tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:30px;color:#94a3b8;font-weight:700;">No attendance data for this week.</td></tr>';
        }
    }

    function attDeleteWorker(name) {
        if(!confirm('Remove "'+name+'" from THIS VIEW only? Their records will be preserved in the permanent archive and can be restored.')) return;
        /* Only remove from display archive, NOT from permanent store */
        var archive=JSON.parse(localStorage.getItem('attendance_archive_v7')||'[]');
        localStorage.setItem('attendance_archive_v7',JSON.stringify(archive.filter(function(l){return l.operator!==name;})));
        renderAttendance();
    }

    function openAttendance() {
        _attWeekOffset=0;
        document.getElementById('attendanceOverlay').style.display='flex';
        renderAttendance();
    }
    function closeAttendance() {
        document.getElementById('attendanceOverlay').style.display='none';
    }

    function renderLaborTable() {
        var grid = document.getElementById('workerGrid'); grid.innerHTML = '';
        var grp = logs.reduce(function(a,l){ if(!a[l.operator]) a[l.operator]=[]; a[l.operator].push(l); return a; }, {});
        Object.keys(grp).sort().forEach(function(nm) {
            var group = grp[nm]; var tMins=0, tEff=0, tCost=0, done=0;
            var h = '<div class="worker-card"><div class="worker-header"><div class="photo-container">'
                + '<img src="'+(workerPhotos[nm]||'https://via.placeholder.com/130?text=USER')+'" class="worker-photo">'
                + '<label class="photo-picker-btn" onclick="document.getElementById(\'file_'+nm+'\').click()">📷</label>'
                + '<input type="file" id="file_'+nm+'" style="display:none" onchange="uploadPhoto(this,\''+nm+'\')">'
                + '</div><div class="worker-name">'+nm+'</div></div><div class="job-list">';
            group.forEach(function(l) {
                var isDone = l.timeOut !== null;
                if (isDone) { var m = calculateNetMinutes(l.timeIn,l.timeOut); tMins+=m; tEff+=parseFloat(l.efficiency); tCost+=parseFloat(l.laborCost); done++; }
                var badge = isDone ? (parseFloat(l.efficiency)>=70?'bg-pass':'bg-fail') : 'bg-active';
                var clickFn = isDone ? '' : 'openFinishModal(logs.find(function(x){return x.uid===\''+l.uid+'\';}))';
                h += '<div class="job-item" onclick="'+clickFn+'">'
                    + '<div><b>'+l.jo+'</b> | '+l.process+'</div>'
                    + '<div style="display:flex;align-items:center;gap:8px;">'
                    + '<div class="eff-badge '+badge+'">'+(isDone?l.efficiency+'%':'ACTIVE')+'</div>'
                    + '<button class="btn-row-del" onclick="event.stopPropagation();deleteEntry(\''+l.uid+'\')">🗑️</button>'
                    + '</div></div>';
            });
            h += '</div><div class="card-footer"><div>HRS: '+(tMins/60).toFixed(2)+'</div><div>EFF: '+(done>0?(tEff/done):0).toFixed(1)+'%</div><div>\u20B1'+tCost.toFixed(0)+'</div></div></div>';
            grid.innerHTML += h;
        });
    }

    function printScreenReport() {
        if (!logs.length) return alert('No data to print.');
        var cont = document.getElementById('reportContent'); cont.innerHTML = '';
        var grp = logs.reduce(function(a,l){ if(!a[l.operator]) a[l.operator]=[]; a[l.operator].push(l); return a; }, {});
        Object.keys(grp).sort().forEach(function(name) {
            var tHrs=0, tCost=0, tEff=0, done=0;
            var sec = '<div class="rpt-worker-title">Worker: ' + name + '</div>'
                + '<table class="report-table"><thead><tr>'
                + '<th>Date</th><th>JO</th><th>Process</th><th>QTY</th><th>HRS</th><th>Cost</th><th>EFF%</th><th>Status</th>'
                + '</tr></thead><tbody>';
            grp[name].forEach(function(l) {
                var mins = l.timeOut ? calculateNetMinutes(l.timeIn, l.timeOut) : 0;
                tHrs += (mins/60);
                tCost += parseFloat(l.laborCost || 0);
                tEff  += parseFloat(l.efficiency || 0);
                if (l.timeOut) done++;
                sec += '<tr>'
                    + '<td>' + l.date + '</td>'
                    + '<td>' + l.jo + '</td>'
                    + '<td>' + l.process + '</td>'
                    + '<td>' + l.qty + '</td>'
                    + '<td>' + (mins/60).toFixed(2) + '</td>'
                    + '<td>\u20B1' + (parseFloat(l.laborCost||0)).toFixed(2) + '</td>'
                    + '<td>' + l.efficiency + '%</td>'
                    + '<td>' + (l.status || '--') + '</td>'
                    + '</tr>';
            });
            var avgEff = done > 0 ? tEff / done : 0;
            sec += '<tr class="totals-row">'
                + '<td colspan="4" style="text-align:right; padding-right:10px;">Totals / Average:</td>'
                + '<td>' + tHrs.toFixed(2) + '</td>'
                + '<td>\u20B1' + tCost.toFixed(2) + '</td>'
                + '<td>' + avgEff.toFixed(1) + '%</td>'
                + '<td>' + (avgEff >= 70 ? 'PASS' : 'FAIL') + '</td>'
                + '</tr>';
            sec += '</tbody></table>';
            cont.innerHTML += sec;
        });
        document.body.classList.add('print-report');
        // Temporarily disable dynamic thermal print style so A4 is used
        var dynStyle = document.getElementById('dynamic-print-style');
        if (dynStyle) dynStyle.disabled = true;
        window.print();
        if (dynStyle) dynStyle.disabled = false;
        document.body.classList.remove('print-report');
    }

    function saveLocally() {
        localStorage.setItem('logs_v7', JSON.stringify(logs));
        /* Broadcast to LIVE_v2 J.O. Cost tab instantly */
        try { new BroadcastChannel('prod2026_logs').postMessage('logs_updated'); } catch(e) {}
        renderLaborTable(); renderSideLeaderboard(); renderJOHistory();
    }
    function deleteEntry(uid) { if(confirm('Delete this entry?')) { logs = logs.filter(function(l){ return String(l.uid)!==String(uid); }); saveLocally(); } }
    function uploadPhoto(input, name) { if(input.files&&input.files[0]){ var r=new FileReader(); r.onload=function(e){ workerPhotos[name]=e.target.result; localStorage.setItem('worker_photos_v7',JSON.stringify(workerPhotos)); renderLaborTable(); }; r.readAsDataURL(input.files[0]); } }
    async function syncWithCloud(e) { var url=localStorage.getItem('prod_script_url'); if(url) fetch(url,{method:'POST',mode:'no-cors',body:JSON.stringify(e)}); }

    function printStartSlip(uid) {
        var e = logs.find(function(l){ return String(l.uid)===String(uid); });
        var qrC = document.getElementById('qrS'); qrC.innerHTML = '';
        setTimeout(function() {
            new QRCode(qrC, { text: 'DONE|'+e.uid, width: 220, height: 220 });
            document.getElementById('sJo').innerText = e.jo;
            document.getElementById('sProc').innerText = e.process;
            document.getElementById('sWorker').innerText = e.operator;
            document.getElementById('sUid').innerText = e.uid;
            setTimeout(function(){ document.body.classList.add('print-start'); window.print(); document.body.classList.remove('print-start'); }, 500);
        }, 50);
    }

    function printFinishSlip(uid) {
        var e = logs.find(function(l){ return String(l.uid)===String(uid); });
        var qrC = document.getElementById('qrF'); qrC.innerHTML = '';
        setTimeout(function() {
            var mins = calculateNetMinutes(e.timeIn, e.timeOut);
            var hours = (mins/60).toFixed(2);
            document.getElementById('fDate').innerText = e.date;
            document.getElementById('fJo').innerText = e.jo;
            document.getElementById('fWorker').innerText = e.operator;
            document.getElementById('fProc').innerText = e.process;
            document.getElementById('fQty').innerText = e.qty + (e.defectQty ? ' (DEF: ' + e.defectQty + ')' : '');
            document.getElementById('fHrs').innerText = hours;
            document.getElementById('fEff').innerText = e.efficiency+'%';
            document.getElementById('fCost').innerText = '\u20B1'+e.laborCost;
            document.getElementById('fStatus').innerText = e.status;
            var csv = e.date+','+e.jo+','+e.operator+','+e.process+','+e.qty+','+hours+','+e.efficiency+'%,'+e.laborCost;
            new QRCode(qrC, { text: csv, width: 220, height: 220 });
            setTimeout(function(){ document.body.classList.add('print-finish'); window.print(); document.body.classList.remove('print-finish'); }, 500);
        }, 50);
    }

    function resetSteps() {
        document.getElementById('step1').style.display='block';
        document.getElementById('step2').style.display='none';
        document.getElementById('step3').style.display='none';
        document.getElementById('scanJO').value='';
        document.getElementById('scanName').value='';
        document.getElementById('scanProcessInp').value='';
        document.getElementById('displayJO').innerText='';
        document.getElementById('displayJO2').innerText='';
        document.getElementById('displayName').innerText='';
        document.getElementById('workerSuggestList').innerHTML='';
        document.getElementById('scanJO').focus();
    }
    function closeModal() { document.getElementById('finishOverlay').style.display='none'; resetSteps(); currentActiveLog=null; }
    function toggleAdmin() { var el=document.getElementById('adminPanel'); el.style.display=(el.style.display==='block')?'none':'block'; document.getElementById('statsPanel').style.display='none'; }
    function toggleStats() { openStatsWithLock(); }
    function enableUrlEdit() { document.getElementById('scriptUrlField').readOnly=false; document.getElementById('editUrlBtn').style.display='none'; document.getElementById('saveUrlBtn').style.display='block'; }
    function saveUrlEdit() { localStorage.setItem('prod_script_url',document.getElementById('scriptUrlField').value); document.getElementById('scriptUrlField').readOnly=true; document.getElementById('editUrlBtn').style.display='block'; document.getElementById('saveUrlBtn').style.display='none'; }
    function saveLaborRate() { laborRate=parseFloat(document.getElementById('laborRateInp').value); localStorage.setItem('labor_rate_v7',laborRate); renderLaborTable(); }
    function renderAdmin() { var g=document.getElementById('samSettings'); g.innerHTML=''; Object.keys(samDB).sort().forEach(function(k){ g.innerHTML+='<div style="display:flex;gap:10px;margin-bottom:10px;"><input class="sk" value="'+k+'" style="flex:2;padding:10px;border:1px solid #ccc;border-radius:6px;"><input class="sv" type="number" step="0.01" value="'+samDB[k]+'" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:6px;"><button onclick="this.parentElement.remove()" style="background:var(--danger);color:white;border:none;padding:10px 15px;border-radius:5px;cursor:pointer;">X</button></div>'; }); }
    function addNewRow() { document.getElementById('samSettings').innerHTML+='<div style="display:flex;gap:10px;margin-bottom:10px;"><input class="sk" placeholder="Process" style="flex:2;padding:10px;border:1px solid #ccc;border-radius:6px;"><input class="sv" type="number" step="0.01" placeholder="SAM" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:6px;"><button onclick="this.parentElement.remove()" style="background:var(--danger);color:white;border:none;padding:10px 15px;border-radius:5px;cursor:pointer;">X</button></div>'; }
    function saveAdminEdits() { var db={}; document.getElementById('samSettings').querySelectorAll('div').forEach(function(r){ var k=r.querySelector('.sk').value.toUpperCase().trim(); var v=parseFloat(r.querySelector('.sv').value); if(k) db[k]=v; }); samDB=db; localStorage.setItem('prod_sam_v7',JSON.stringify(samDB)); alert('Processes saved.'); }
    function renderProcessPicker() { var grid=document.getElementById('procPickerGrid'); grid.innerHTML=''; Object.keys(samDB).sort().forEach(function(p){ var b=document.createElement('button'); b.className='proc-btn'; b.innerHTML='<span>'+p+'</span><br><small>SAM: '+samDB[p]+'</small>'; b.onclick=function(){ startNewJob(p); }; grid.appendChild(b); }); }
    /* ══ savePermanentAttendance — was missing, caused crash on save ══ */
    function savePermanentAttendance(archive) {
        try {
            var obj = {};
            (archive || []).forEach(function(e) { if (e && e.uid) obj[e.uid] = e; });
            localStorage.setItem('att_permanent_v8', JSON.stringify(obj));
        } catch(ex) { console.warn('savePermanentAttendance:', ex); }
    }

    /* ══ EXPORT TO COSTLIVE — downloads .json file (fixes Edge file:// origin block) ══ */
    function exportToCostlive() {
        try {
            var payload = {
                _exported:  new Date().toISOString(),
                _source:    'PROD2026',
                logs:       safeGet('logs_v7',               '[]'),
                archive:    safeGet('attendance_archive_v7', '[]'),
                stats:      safeGet('stats_archive_v7',      '[]'),
                perm:       safeGet('att_permanent_v8',      '{}')
            };
            function safeGet(k, def) {
                try { return JSON.parse(localStorage.getItem(k) || def); } catch(_){ return JSON.parse(def); }
            }
            payload.logs    = safeGet('logs_v7',               '[]');
            payload.archive = safeGet('attendance_archive_v7', '[]');
            payload.stats   = safeGet('stats_archive_v7',      '[]');
            payload.perm    = safeGet('att_permanent_v8',      '{}');

            var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            var d    = new Date();
            var ds   = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            a.href = url;
            a.download = 'prod2026_sync_' + ds + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert('✅ Sync file downloaded!\n\nNow in COSTLIVE:\nClick  ⟳ Sync Now  →  select this file.\n\nAll attendance data will appear in the Weekly View.');
        } catch(ex) {
            alert('Export error: ' + ex.message);
        }
    }

    function resetDay() { if(confirm('Reset active list? Worker Stats will NOT be deleted.')) { logs=[]; saveLocally(); renderSideLeaderboard(); /* Clear JO active states but keep history */ renderJOHistory(); } }
    function clearAllHistory() { if(confirm('WARNING: This permanently deletes all lifetime worker stats. Proceed?')) { statsHistory={}; statsArchive=[]; localStorage.setItem('prod_stat_history_v1',JSON.stringify(statsHistory)); saveStatsArchive(); renderStatsDashboard(); } }

    /* ══════ SIDE LEADERBOARD (beside scanner) ══════ */
    function renderSideLeaderboard() {
        var el = document.getElementById('sideLeaderboardList');
        if (!el) return;
        /* Use only today's live logs that are completed */
        var completed = logs.filter(function(l){ return l.timeOut && isValidEntry(l); });
        if (!completed.length) {
            el.innerHTML = '<div class="slb-empty">No data yet.<br>Complete jobs to see rankings.</div>';
            return;
        }
        var data = buildStatsFromLogs(completed);
        var ranked = Object.keys(data).map(function(name){ return { name:name, pts:calcPoints(data[name]) }; }).sort(function(a,b){ return b.pts.total - a.pts.total; });
        var medalEmoji = ['🥇','🥈','🥉'];
        var rowClass = ['slb-gold','slb-silver','slb-bronze'];
        el.innerHTML = ranked.map(function(w, i){
            var cls = i < 3 ? rowClass[i] : '';
            var rank = i < 3 ? medalEmoji[i] : '#' + (i+1);
            return '<div class="slb-row ' + cls + '">'
                + '<span class="slb-rank">' + rank + '</span>'
                + '<span class="slb-name">' + w.name + '</span>'
                + '<div style="text-align:right;flex-shrink:0;">'
                + '<div class="slb-pts">' + w.pts.total + '</div>'
                + '<div class="slb-pts-lbl">/ 100 pts</div>'
                + '</div></div>';
        }).join('');
    }

    /* ══════ JO HISTORY PANEL ══════
       Source of truth: Firebase jo_history node
       Local copy: localStorage jo_history_v8
       All changes → saveHistory() which updates both
    ══════════════════════════════ */
    var joHistory = JSON.parse(localStorage.getItem('jo_history_v8')) || [];

    function recordJOHistory(joNum) {
        var today = new Date().toLocaleDateString('sv-SE');
        var existing = joHistory.find(function(j){ return j.jo === joNum; });
        if (!existing) {
            joHistory.unshift({ jo: joNum, date: today, ts: Date.now(), status: 'pending' });
            if (joHistory.length > 100) joHistory = joHistory.slice(0, 100);
            saveHistory();
        }
        renderJOHistory();
    }

    /* Remove a JO from history by JO number — called when marked Done */
    function removeJOHistoryByName(joNum, silent) {
        var before = joHistory.length;
        joHistory = joHistory.filter(function(h) { return h.jo !== joNum; });
        if (joHistory.length !== before) {
            saveHistory(); // removes from Firebase → all devices update instantly
            renderJOHistory();
            if (!silent) {
                var t = document.getElementById('jos-toast');
                if (t) {
                    t.textContent = '✅ ' + joNum + ' removed from J.O. History (Done)';
                    t.className = 'show ok';
                    clearTimeout(t._jt);
                    t._jt = setTimeout(function(){ t.className=''; }, 3500);
                }
            }
        }
    }

    function renderJOHistory() {
        var el = document.getElementById('joHistoryList');
        if (!el) return;
        if (!joHistory.length) {
            el.innerHTML = '<div class="joh-empty">No J.O. recorded yet.</div>';
            return;
        }
        var today = new Date().toLocaleDateString('sv-SE');
        var activeJOs = logs.filter(function(l){ return !l.timeOut; }).map(function(l){ return l.jo; });
        el.innerHTML = joHistory.map(function(j, idx) {
            var isActive = activeJOs.indexOf(j.jo) > -1 || j.status === 'pending';
            var statusHtml = isActive
                ? '<span class="joh-status active">ACTIVE</span>'
                : '<span class="joh-status done">DONE</span>';
            var dateLabel = j.date === today ? 'TODAY' : (j.date || '');
            var subInfo = [j.item, j.color, j.total ? 'Qty:'+j.total : ''].filter(Boolean).join(' · ');
            return '<div class="joh-row ' + (isActive ? 'joh-active' : '') + '" onclick="reuseJO(\'' + j.jo + '\')" title="Click to reuse">'
                + '<div style="flex:1;min-width:0;">'
                + '<div class="joh-num">' + j.jo + '</div>'
                + (subInfo ? '<div style="font-size:9px;color:#64748b;font-weight:600;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + subInfo + '</div>' : '')
                + '<span class="joh-date">' + dateLabel + '</span>'
                + '</div>'
                + statusHtml
                + '<button class="joh-remove" onclick="event.stopPropagation();removeJOHistory(' + idx + ')" title="Remove">×</button>'
                + '</div>';
        }).join('');
    }

    function reuseJO(joNum) {
        document.getElementById('displayJO').innerText = joNum;
        document.getElementById('displayJO2').innerText = 'J.O.: ' + joNum;
        document.getElementById('step1').style.display = 'none';
        document.getElementById('step2').style.display = 'block';
        document.getElementById('scanName').value = '';
        document.getElementById('scanName').focus();
        filterWorkerSuggestions('');
    }

    function removeJOHistory(idx) {
        joHistory.splice(idx, 1);
        saveHistory(); // sync removal to Firebase → all devices
        renderJOHistory();
    }

    /* ══════ WORKER SUGGESTIONS (from previous workers) ══════ */
    function getKnownWorkers() {
        var names = {};
        logs.forEach(function(l){ if(l.operator) names[l.operator]=true; });
        statsArchive.forEach(function(l){ if(l.operator) names[l.operator]=true; });
        return Object.keys(names).sort();
    }

    function filterWorkerSuggestions(val, containerId) {
        var cid = containerId || 'workerSuggestList';
        var el = document.getElementById(cid);
        if (!el) return;
        var workers = getKnownWorkers();
        var filtered = val ? workers.filter(function(w){ return w.toUpperCase().includes(val.toUpperCase()); }) : workers;
        if (!filtered.length) { el.innerHTML = ''; return; }
        el.innerHTML = filtered.slice(0, 8).map(function(w) {
            var photo = workerPhotos[w] || 'https://via.placeholder.com/40?text=' + encodeURIComponent(w.charAt(0));
            return '<div class="worker-suggestion" onclick="selectWorkerName(\'' + w.replace(/'/g,"\\'") + '\')">'
                + '<img class="ws-photo" src="' + photo + '" onerror="this.src=\'https://via.placeholder.com/40?text=?\'">'
                + '<span class="ws-name">' + w + '</span>'
                + '</div>';
        }).join('');
    }

    function selectWorkerName(name) {
        document.getElementById('displayName').innerText = name;
        document.getElementById('step2').style.display = 'none';
        document.getElementById('step3').style.display = 'block';
        renderProcessPicker();
        setTimeout(function() { document.getElementById('scanProcessInp').focus(); }, 100);
    }

    /* ===== MATERIALS LOGIC ===== */
    var matDef = {
        'U PLY ADHESIVE': { price: 177.4390244, unitWeight: 1 },
        'RUGBY UTAC CONTACT CEMENT': { price: 155.4878049, unitWeight: 1 },
        'PAINT': { price: 250.0, unitWeight: 1 },
        'KIWI': { price: 67.0, unitWeight: 0.095 },
        'PACMAC EASY CLEANER': { price: 304.8780488, unitWeight: 1 },
        'SERAFIL THREAD TKT 40': { price: 313.5, unitWeight: 0.11 },
        'DOUBLE SIDED 5MM': { price: 14.2, unitWeight: 0.04 },
        'DOUBLE SIDED 7MM': { price: 14.2, unitWeight: 0.04 },
        'SCATCH TAPE 10MM': { price: 7.0, unitWeight: 0.025 },
        'MASKING TAPE 1.2MM': { price: 14.2, unitWeight: 0.04 }
    };
    var matData = JSON.parse(localStorage.getItem('rd_materials')) || matDef;
    var pendingMat = JSON.parse(localStorage.getItem('rd_sidebar_final') || '[]');
    var mStep = 1;
    var mBuf = { jo:'', name:'', item:'', q:0, w:0 };
    var activeMat = null;
    var matFlowSetup = false;

    function initMaterials() {
        renderMatSidebar(); initMatGrid(); resetMatScanner();
        if (!matFlowSetup) {
            matFlowSetup = true;
            document.getElementById('mat-scanner-input').addEventListener('keydown', function(e) {
                if (e.key !== 'Enter') return;
                var raw = e.target.value.trim();
                if (!raw) return;
                if (raw.includes('{') && raw.includes('}')) {
                    try {
                        var clean = raw.substring(raw.indexOf('{'), raw.lastIndexOf('}')+1);
                        openReturnModal(JSON.parse(clean)); e.target.value = ''; return;
                    } catch(err) { console.log('Invalid QR'); }
                }
                var val = raw.toUpperCase();
                if (mStep===1) { mBuf.jo=val; mStep=2; }
                else if (mStep===2) { mBuf.name=val; mStep=3; }
                else if (mStep===3 && matData[val]) { mBuf.item=val; mStep=4; }
                else if (mStep===3 && !matData[val]) { alert('Item not found. Please select from grid.'); }
                else if (mStep===4) { mBuf.q=parseFloat(val)||0; mStep=5; }
                else if (mStep===5) { mBuf.w=parseFloat(val)||0; finalizeIssuance(); }
                updateMatUI(); e.target.value='';
            });
        }
        setInterval(focusMatScanner, 2000);
    }

    function focusMatScanner() {
        var isM = Array.from(document.querySelectorAll('.modal-overlay')).some(function(m){ return m.style.display==='flex'; });
        if (!isM && document.getElementById('materialsView').style.display==='flex') {
            document.getElementById('mat-scanner-input').focus();
        }
    }

    function initMatGrid() {
        var g = document.getElementById('material-grid'); g.innerHTML='';
        Object.keys(matData).forEach(function(m) {
            var b = document.createElement('button'); b.className='mat-btn'; b.innerText=m;
            b.onclick = function(){ mBuf.item=m; mStep=4; updateMatUI(); };
            g.appendChild(b);
        });
    }

    function updateMatUI() {
        document.querySelectorAll('.step-dot').forEach(function(d){ d.classList.remove('active','complete'); });
        document.getElementById('material-grid').style.display='none';
        var t = document.getElementById('scan-title');
        var sub = document.getElementById('scan-subtitle');
        var box = document.getElementById('visual-scanner');
        var steps = ['mstep1','mstep2','mstep3','mstep4','mstep5'];
        for (var i=0; i<mStep-1; i++) document.getElementById(steps[i]).classList.add('complete');
        document.getElementById(steps[mStep-1]).classList.add('active');
        if (mStep===1) { t.innerText='SCAN J.O.'; sub.innerText='Step 1: Scan the Job Order barcode'; box.className='scanner-box step-jo'; }
        else if (mStep===2) { t.innerText='SCAN WORKER'; sub.innerText='Step 2: Scan the worker name barcode'; box.className='scanner-box step-name'; }
        else if (mStep===3) { t.innerText='CHOOSE ITEM'; sub.innerText='Step 3: Select material from the grid below'; box.className='scanner-box step-mat'; document.getElementById('material-grid').style.display='grid'; }
        else if (mStep===4) { t.innerText='ENTER QTY (PCS)'; sub.innerText='Step 4: Type quantity and press Enter'; box.className='scanner-box step-qty'; }
        else if (mStep===5) { t.innerText='ENTER WEIGHT (KG)'; sub.innerText='Step 5: Type issued weight in KG and press Enter'; box.className='scanner-box step-iss'; }
        focusMatScanner();
    }

    function finalizeIssuance() {
        document.getElementById('mi-item').value = mBuf.item;
        document.getElementById('mi-name').value = mBuf.name;
        document.getElementById('mi-jo').value = mBuf.jo;
        document.getElementById('mi-qty').value = mBuf.q;
        document.getElementById('mi-iss').value = mBuf.w;
        document.getElementById('modal-issuance').style.display='flex';
    }

    function saveIssuance() {
        var item = { id: Date.now(), n: mBuf.name, j: mBuf.jo, i: mBuf.item, q: mBuf.q, w: mBuf.w };
        pendingMat.push(item); localStorage.setItem('rd_sidebar_final', JSON.stringify(pendingMat));
        renderMatSidebar(); printIssuanceSlip(item); closeMatModals();
    }

    function renderMatSidebar() {
        var l = document.getElementById('pending-list'); l.innerHTML='';
        pendingMat.forEach(function(item) {
            var c = document.createElement('div'); c.className='pending-card';
            c.onclick = function(){ openReturnModal(item); };
            var qb = document.createElement('div'); qb.style.cssText='display:flex;justify-content:center;margin-bottom:5px;';
            c.innerHTML = '<div class="pending-label">'+item.i+'</div><div class="pending-worker">'+item.n+'</div>';
            var rmv = document.createElement('button'); rmv.className='btn-remove'; rmv.innerText='REMOVE';
            rmv.onclick = function(ev){ ev.stopPropagation(); pendingMat=pendingMat.filter(function(p){ return p.id!==item.id; }); localStorage.setItem('rd_sidebar_final',JSON.stringify(pendingMat)); renderMatSidebar(); };
            c.prepend(qb); c.appendChild(rmv); l.appendChild(c);
            new QRCode(qb, { text: JSON.stringify(item), width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M });
        });
    }

    function openReturnModal(data) {
        activeMat = {
            Worker: data.n||data.Worker||'UNDEFINED',
            JO: data.j||data.JO||'UNDEFINED',
            Item: data.i||data.Item||'UNDEFINED',
            Issued: parseFloat(data.w||data.Issued||0),
            Target: parseFloat(data.q||data.Target||1),
            Return: (data.r!==undefined) ? data.r : (data.Return||''),
            id: data.id||null, rowIndex: data.rowIndex||null
        };
        document.getElementById('modal-return').style.display='flex';
        document.getElementById('ret-info').innerHTML = '<b>WORKER:</b> '+activeMat.Worker+'<br><b>JO:</b> '+activeMat.JO+'<br><b>ITEM:</b> '+activeMat.Item+'<br><b>ISSUED:</b> '+activeMat.Issued+' KG';
        var rw = document.getElementById('ret-weight');
        rw.value = activeMat.Return;
        setTimeout(function(){ rw.focus(); calculateMat(); }, 100);
    }

    function calculateMat() {
        var r = parseFloat(document.getElementById('ret-weight').value)||0;
        var info = matData[activeMat.Item] || { price:0, unitWeight:1 };
        var usedWeight = Math.max(0, activeMat.Issued-r);
        var units = usedWeight/info.unitWeight;
        var cpp = (units*info.price)/(activeMat.Target||1);
        document.getElementById('out-used').innerText = units.toFixed(4);
        document.getElementById('out-cpp').innerText = '\u20B1'+cpp.toFixed(4);
    }

    async function saveReturn() {
        var url = localStorage.getItem('rd_ledger_url');
        if (!url) return alert('Please link your Google Sheets URL in Settings first!');
        var retVal = parseFloat(document.getElementById('ret-weight').value)||0;
        var info = matData[activeMat.Item]||{price:0,unitWeight:1};
        var usedWeight = Math.max(0, activeMat.Issued-retVal);
        var usedUnits = usedWeight/info.unitWeight;
        var cpp = (usedUnits*info.price)/(activeMat.Target||1);
        var data = { JO:activeMat.JO, Worker:activeMat.Worker, Item:activeMat.Item, Target:activeMat.Target, Issued:activeMat.Issued, Return:retVal, Used:usedUnits.toFixed(4), CPP:cpp.toFixed(4) };
        if (activeMat.rowIndex) data.rowIndex=activeMat.rowIndex;
        try {
            await fetch(url, { method:'POST', mode:'no-cors', body:JSON.stringify(data) });
            if (activeMat.id) { pendingMat=pendingMat.filter(function(p){ return p.id!==activeMat.id; }); localStorage.setItem('rd_sidebar_final',JSON.stringify(pendingMat)); }
            renderMatSidebar(); printReturnSlip(data); closeMatModals();
        } catch(err) { alert('Network Error'); }
    }

    function printIssuanceSlip(data) {
        var a = document.getElementById('print-area');
        a.innerHTML = '<div style="text-align:center;padding:2px;border:2px solid #000;">'
            +'<p style="border-bottom:2px solid #000;padding-bottom:2px;margin:0 0 5px;font-size:14px;font-weight:900;">ISSUANCE</p>'
            +'<div style="text-align:left;font-size:11px;font-weight:900;">'
            +'<p style="margin:2px 0;">WKR: '+data.n+'</p>'
            +'<p style="margin:2px 0;">JO#: '+data.j+'</p>'
            +'<p style="margin:2px 0;">ITM: '+data.i+'</p>'
            +'<p style="margin:2px 0;">TGT: '+data.q+' PCS</p></div>'
            +'<div id="pq" style="display:flex;justify-content:center;margin:5px;"></div></div>';
        new QRCode(document.getElementById('pq'), { text: JSON.stringify(data), width: 120, height: 120, correctLevel: QRCode.CorrectLevel.H });
        setTimeout(function(){ document.body.classList.add('print-mat'); window.print(); document.body.classList.remove('print-mat'); }, 500);
    }

    function printReturnSlip(data) {
        var a = document.getElementById('print-area');
        var now = new Date().toISOString().split('T')[0];
        var csv = now+','+data.JO+','+data.Worker+','+data.Item+','+data.Target+','+data.Used+','+data.CPP;
        a.innerHTML = '<div style="width:58mm;border:2px solid #000;background:#fff;padding:2mm;">'
            +'<div style="text-align:center;font-size:14px;border-bottom:2px solid #000;padding-bottom:2px;margin-bottom:5px;font-weight:900;">COMPLETED</div>'
            +'<div id="pq-final" style="display:flex;justify-content:center;margin:10px 0;"></div>'
            +'<div style="font-size:11px;border-top:1px solid #000;">'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>DATE:</span><span style="font-weight:900;">'+now+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>JO:</span><span style="font-weight:900;">'+data.JO+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>WORKER:</span><span style="font-weight:900;">'+data.Worker+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>ITEM:</span><span style="font-weight:900;">'+data.Item+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>QTY:</span><span style="font-weight:900;">'+data.Target+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>USE(KG):</span><span style="font-weight:900;">'+data.Used+'</span></div>'
            +'<div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding:4px 0;"><span>COST:</span><span style="font-weight:900;">\u20B1'+data.CPP+'</span></div>'
            +'</div><div style="margin-top:10px;border:3px solid #000;text-align:center;padding:6px;font-size:20px;font-weight:900;letter-spacing:3px;">PASS</div></div>';
        new QRCode(document.getElementById('pq-final'), { text: csv, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.H });
        setTimeout(function(){ document.body.classList.add('print-mat'); window.print(); document.body.classList.remove('print-mat'); }, 600);
    }

    async function loadMatHistory() {
        var url = localStorage.getItem('rd_ledger_url');
        if (!url) return alert('Database URL missing in Settings.');
        document.getElementById('modal-mat-history').style.display='flex';
        document.getElementById('mat-history-list').innerText='Loading history...';
        try {
            var res = await fetch(url); var data = await res.json();
            document.getElementById('mat-history-list').innerHTML = data.reverse().slice(0,15).map(function(r){
                return '<div style="display:flex;justify-content:space-between;padding:15px;border-bottom:1px solid #ddd;">'
                    +'<div><b>JO: '+r.JO+'</b><br><small>'+r.Item+' - '+r.Worker+'</small></div>'
                    +'<button class="btn-nav" style="background:var(--mat-primary);padding:5px 15px;font-size:0.8rem;" onclick=\'openReturnModal('+JSON.stringify(r)+')\'>EDIT</button>'
                    +'</div>';
            }).join('');
        } catch(err) { document.getElementById('mat-history-list').innerText='Could not load history.'; }
    }

    function resetMatScanner() {
        mStep=1; mBuf={jo:'',name:'',item:'',q:0,w:0};
        var inp = document.getElementById('mat-scanner-input');
        if (inp) inp.value='';
        updateMatUI();
    }
    function closeMatModals() { document.querySelectorAll('.modal-overlay').forEach(function(m){ m.style.display='none'; }); resetMatScanner(); }
    function openMatSettings() { document.getElementById('modal-settings').style.display='flex'; document.getElementById('mat-db-url').value=localStorage.getItem('rd_ledger_url')||''; renderMatSettingsList(); }
    function saveMatDbUrl() { localStorage.setItem('rd_ledger_url',document.getElementById('mat-db-url').value.trim()); alert('Database Linked!'); }
    function addNewMat() {
        var n=document.getElementById('nm-name').value.trim().toUpperCase();
        var p=parseFloat(document.getElementById('nm-price').value);
        var w=parseFloat(document.getElementById('nm-w').value);
        if(n&&p){ matData[n]={price:p,unitWeight:w||1}; localStorage.setItem('rd_materials',JSON.stringify(matData)); renderMatSettingsList(); initMatGrid(); document.getElementById('nm-name').value=''; document.getElementById('nm-price').value=''; document.getElementById('nm-w').value=''; alert('Added!'); }
        else alert('Please enter a name and price.');
    }
    function renderMatSettingsList() {
        var l=document.getElementById('mat-settings-list'); l.innerHTML='';
        Object.keys(matData).forEach(function(k){
            var d=document.createElement('div'); d.className='mat-item-row';
            d.innerHTML='<span style="font-weight:700;">'+k+'</span><button onclick="deleteMat(\''+k+'\')" style="background:red;color:white;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;font-weight:700;">DEL</button>';
            l.appendChild(d);
        });
    }
    /* ===== PRINT SETTINGS ===== */
    var printCfg = JSON.parse(localStorage.getItem('print_cfg_v1')) || {
        width: 80, height: 0, mt: 0, mb: 0, ml: 0, mr: 0, fontSize: 13, qrSize: 140
    };

    function openPrintSettings() {
        document.getElementById('ps-width').value   = printCfg.width;
        document.getElementById('ps-height').value  = printCfg.height;
        document.getElementById('ps-mt').value      = printCfg.mt;
        document.getElementById('ps-mb').value      = printCfg.mb;
        document.getElementById('ps-ml').value      = printCfg.ml;
        document.getElementById('ps-mr').value      = printCfg.mr;
        document.getElementById('ps-fontsize').value = printCfg.fontSize;
        document.getElementById('ps-qrsize').value  = printCfg.qrSize;
        updatePsPreview();
        document.getElementById('modal-print-settings').style.display = 'flex';
    }

    function closePrintSettings() {
        document.getElementById('modal-print-settings').style.display = 'none';
    }

    function applyPreset(w, h) {
        document.getElementById('ps-width').value  = w;
        document.getElementById('ps-height').value = h;
        updatePsPreview();
    }

    function updatePsPreview() {
        var w  = document.getElementById('ps-width').value  || printCfg.width;
        var h  = document.getElementById('ps-height').value;
        var mt = document.getElementById('ps-mt').value || 0;
        var mb = document.getElementById('ps-mb').value || 0;
        var ml = document.getElementById('ps-ml').value || 0;
        var mr = document.getElementById('ps-mr').value || 0;
        var fs = document.getElementById('ps-fontsize').value || 13;
        var qs = document.getElementById('ps-qrsize').value || 140;
        var hTxt = (parseInt(h) === 0 || h === '') ? 'Auto' : h + 'mm';
        document.getElementById('ps-preview').innerHTML =
            '📐 Paper: <b>' + w + 'mm × ' + hTxt + '</b> &nbsp;|&nbsp; '
            + '📏 Margins: <b>T'+mt+' B'+mb+' L'+ml+' R'+mr+'mm</b> &nbsp;|&nbsp; '
            + '🔤 Font: <b>' + fs + 'px</b> &nbsp;|&nbsp; '
            + 'QR: <b>' + qs + 'px</b>';
    }

    // attach live preview to all inputs
    (function attachPsListeners() {
        ['ps-width','ps-height','ps-mt','ps-mb','ps-ml','ps-mr','ps-fontsize','ps-qrsize'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('input', updatePsPreview);
        });
    })();

    function savePrintSettings() {
        printCfg.width    = parseInt(document.getElementById('ps-width').value)    || 80;
        printCfg.height   = parseInt(document.getElementById('ps-height').value)   || 0;
        printCfg.mt       = parseInt(document.getElementById('ps-mt').value)       || 0;
        printCfg.mb       = parseInt(document.getElementById('ps-mb').value)       || 0;
        printCfg.ml       = parseInt(document.getElementById('ps-ml').value)       || 0;
        printCfg.mr       = parseInt(document.getElementById('ps-mr').value)       || 0;
        printCfg.fontSize = parseInt(document.getElementById('ps-fontsize').value) || 13;
        printCfg.qrSize   = parseInt(document.getElementById('ps-qrsize').value)   || 140;
        localStorage.setItem('print_cfg_v1', JSON.stringify(printCfg));
        applyPrintStyles();
        closePrintSettings();
        alert('Print settings saved!');
    }

    function resetPrintSettings() {
        printCfg = { width:80, height:0, mt:0, mb:0, ml:0, mr:0, fontSize:13, qrSize:140 };
        localStorage.setItem('print_cfg_v1', JSON.stringify(printCfg));
        applyPrintStyles();
        openPrintSettings();
    }

    function applyPrintStyles() {
        var existing = document.getElementById('dynamic-print-style');
        if (existing) existing.remove();

        var w  = printCfg.width  + 'mm';
        var h  = printCfg.height > 0 ? printCfg.height + 'mm' : 'auto';
        var mt = printCfg.mt + 'mm';
        var mb = printCfg.mb + 'mm';
        var ml = printCfg.ml + 'mm';
        var mr = printCfg.mr + 'mm';
        var fs = printCfg.fontSize + 'px';
        var qs = printCfg.qrSize  + 'px';

        var style = document.createElement('style');
        style.id = 'dynamic-print-style';
        style.innerHTML = [
            '@media print {',
            '  @page { size: ' + w + ' ' + h + '; margin: ' + mt + ' ' + mr + ' ' + mb + ' ' + ml + '; }',
            '  body.print-start #startSlip { width: ' + w + ' !important; }',
            '  body.print-finish #finishSlip { width: ' + w + ' !important; }',
            '  body.print-mat #print-area { width: ' + w + ' !important; }',
            '  .slip-line { font-size: ' + fs + ' !important; padding: 3px 0 !important; }',
            '  .slip-box h2 { font-size: calc(' + fs + ' + 4px) !important; }',
            '  .big-status { font-size: calc(' + fs + ' + 8px) !important; }',
            '  #qrS img, #qrF img { width: ' + qs + ' !important; height: ' + qs + ' !important; }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function printMatDailyReport() {
        var allMat = JSON.parse(localStorage.getItem('rd_sidebar_final') || '[]');
        if (!allMat.length) return alert('No materials data to print.');
        var cont = document.getElementById('matReportContent');
        cont.innerHTML = '';

        // Group by worker
        var grp = allMat.reduce(function(a, item) {
            var nm = item.n || item.Worker || 'UNKNOWN';
            if (!a[nm]) a[nm] = [];
            a[nm].push(item);
            return a;
        }, {});

        Object.keys(grp).sort().forEach(function(name) {
            var sec = '<div style="margin-bottom:30px;"><h3>WORKER: ' + name + '</h3>'
                + '<table class="report-table"><thead><tr>'
                + '<th>JO</th><th>ITEM</th><th>QTY (PCS)</th><th>ISSUED (KG)</th><th>RETURN (KG)</th><th>USED (KG)</th><th>COST/PC</th>'
                + '</tr></thead><tbody>';

            grp[name].forEach(function(item) {
                var issued = parseFloat(item.w || item.Issued || 0);
                var ret    = parseFloat(item.r !== undefined ? item.r : (item.Return || 0));
                var target = parseFloat(item.q || item.Target || 1);
                var matInfo = matData[item.i || item.Item] || { price: 0, unitWeight: 1 };
                var usedW   = Math.max(0, issued - ret);
                var usedU   = usedW / matInfo.unitWeight;
                var cpp     = (usedU * matInfo.price) / (target || 1);

                sec += '<tr>'
                    + '<td>' + (item.j || item.JO || '--') + '</td>'
                    + '<td>' + (item.i || item.Item || '--') + '</td>'
                    + '<td>' + target + '</td>'
                    + '<td>' + issued.toFixed(3) + '</td>'
                    + '<td>' + (ret ? ret.toFixed(3) : '--') + '</td>'
                    + '<td>' + usedU.toFixed(4) + '</td>'
                    + '<td>\u20B1' + cpp.toFixed(4) + '</td>'
                    + '</tr>';
            });

            sec += '</tbody></table></div>';
            cont.innerHTML += sec;
        });

        document.body.classList.add('print-mat-report');
        var dynStyle = document.getElementById('dynamic-print-style');
        if (dynStyle) dynStyle.disabled = true;
        window.print();
        if (dynStyle) dynStyle.disabled = false;
        document.body.classList.remove('print-mat-report');
    }

    // Apply on load
    applyPrintStyles();



/* ═══════════════════════════════════════════════════════════
   J.O. SCHEDULER — Google Calendar Style + Drag & Drop + File Store
═══════════════════════════════════════════════════════════ */

var josData      = {};
var josSelDate   = null;
var josCalYear   = 0;
var josCalMonth  = 0;
var josEditId    = null;
var josMoveId    = null;
var josMoveDate_ = null;
var josIncoming      = [];
var josIncomingIndex = 0;
var josCurrentView   = 'month';
var josWeekStart     = null; // Date object for start of displayed week
var JOS_KEY  = 'jos_schedule_v1';
var JOSFS_KEY = 'jos_filestore_v1';
var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function josLoad() { try { josData = JSON.parse(localStorage.getItem(JOS_KEY)||'{}'); } catch(e){ josData={}; } }
function josSave() {
  localStorage.setItem(JOS_KEY, JSON.stringify(josData));
  fbPushSchedule(); // live sync to Firebase → all other devices update instantly
}
function josGenId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function josDateStr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

/* ── Open / Close ── */
function openJOScheduler() {
  josLoad();
  var now = new Date();
  josCalYear  = now.getFullYear();
  josCalMonth = now.getMonth();
  josSelDate  = josDateStr(now);
  josWeekStart = getWeekStart(now);

  josIncoming = []; josIncomingIndex = 0;
  var raw = localStorage.getItem('joScanData');
  if (raw) { try { var p=JSON.parse(raw); josIncoming=Array.isArray(p)?p:[p]; } catch(e){ josIncoming=[]; } }
  if (josIncoming.length) showIncomingBanner();

  var badge = document.querySelector('.fb-count-badge');
  if (badge) badge.remove();
  startFbListener();

  document.getElementById('joSchedulerOverlay').style.display = 'flex';
  josRender();
}
function closeJOScheduler() {
  document.getElementById('joSchedulerOverlay').style.display = 'none';
}
function josGoToday() {
  var now = new Date();
  josCalYear = now.getFullYear(); josCalMonth = now.getMonth();
  josSelDate = josDateStr(now);
  josWeekStart = getWeekStart(now);
  josRender();
}

/* ── View switching ── */
function josSetView(v) {
  josCurrentView = v;
  document.getElementById('jos-view-month').classList.toggle('active', v==='month');
  document.getElementById('jos-view-week').classList.toggle('active', v==='week');
  document.getElementById('jos-month-view').style.display = v==='month'?'flex':'none';
  document.getElementById('jos-week-view').style.display  = v==='week' ?'flex':'none';
  josRender();
}

/* ── Master render ── */
function josRender() {
  josRenderMiniCal();
  josRenderSidebarStats();
  if (josCurrentView==='month') josRenderMonth();
  else josRenderWeek();
  josRenderDayPanel();
}

/* ── Nav ── */
function josCalPrev() {
  if (josCurrentView==='week') { josWeekStart=new Date(josWeekStart.getTime()-7*86400000); josCalYear=josWeekStart.getFullYear(); josCalMonth=josWeekStart.getMonth(); }
  else { josCalMonth--; if(josCalMonth<0){josCalMonth=11;josCalYear--;} }
  josRender();
}
function josCalNext() {
  if (josCurrentView==='week') { josWeekStart=new Date(josWeekStart.getTime()+7*86400000); josCalYear=josWeekStart.getFullYear(); josCalMonth=josWeekStart.getMonth(); }
  else { josCalMonth++; if(josCalMonth>11){josCalMonth=0;josCalYear++;} }
  josRender();
}
function getWeekStart(d) { var s=new Date(d); s.setDate(d.getDate()-d.getDay()); s.setHours(0,0,0,0); return s; }

/* ── MINI CALENDAR ── */
function josRenderMiniCal() {
  var label = MONTH_NAMES[josCalMonth]+' '+josCalYear;
  document.getElementById('jos-cal-month-label').textContent = label;
  document.getElementById('jos-mini-month-label').textContent = label;
  var grid = document.getElementById('jos-mini-grid'); grid.innerHTML='';
  var today = josDateStr(new Date());
  var firstDay = new Date(josCalYear,josCalMonth,1).getDay();
  var daysInMonth = new Date(josCalYear,josCalMonth+1,0).getDate();
  for(var i=0;i<firstDay;i++){ var e=document.createElement('div'); e.className='jos-mini-day empty'; grid.appendChild(e); }
  for(var d=1;d<=daysInMonth;d++){
    var ds=josCalYear+'-'+String(josCalMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var entries=josData[ds]||[];
    var el=document.createElement('div');
    el.className='jos-mini-day';
    if(ds===today) el.classList.add('today');
    else if(ds===josSelDate) el.classList.add('selected');
    if(entries.length) el.classList.add('has-jo');
    if(ds<today&&entries.some(function(e){return e.status!=='done';})) el.classList.add('overdue');
    el.textContent=d;
    el.addEventListener('click',(function(dateStr){return function(){josSelDate=dateStr;josRender();};})(ds));
    grid.appendChild(el);
  }
}

/* ── SIDEBAR STATS ── */
function josRenderSidebarStats() {
  var total=0,pending=0,inProg=0,done=0,overdue=0;
  var today=josDateStr(new Date());
  Object.keys(josData).forEach(function(ds){ josData[ds].forEach(function(e){ total++; if(e.status==='done') done++; else if(e.status==='in-progress') inProg++; else if(ds<today) overdue++; else pending++; }); });
  var el=document.getElementById('jos-sidebar-stats');
  el.innerHTML=['Total:'+total,'Pending:'+pending,'In Progress:'+inProg,'Done:'+done,'Overdue:'+overdue].map(function(s){
    var p=s.split(':');
    return '<div class="jos-sidebar-stat">'+p[0]+' <span>'+p[1]+'</span></div>';
  }).join('');
}

/* ── MONTH VIEW ── */
function josRenderMonth() {
  var grid=document.getElementById('jos-month-grid'); grid.innerHTML='';
  var today=josDateStr(new Date());
  var firstDay=new Date(josCalYear,josCalMonth,1).getDay();
  var daysInMonth=new Date(josCalYear,josCalMonth+1,0).getDate();
  var prevMonthDays=new Date(josCalYear,josCalMonth,0).getDate();
  // prev month fillers
  for(var i=0;i<firstDay;i++){
    var d=prevMonthDays-firstDay+1+i;
    var ds=(josCalMonth===0?josCalYear-1:josCalYear)+'-'+String(josCalMonth===0?12:josCalMonth).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    grid.appendChild(josMonthCell(ds,d,true,today));
  }
  for(var d=1;d<=daysInMonth;d++){
    var ds=josCalYear+'-'+String(josCalMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    grid.appendChild(josMonthCell(ds,d,false,today));
  }
  // next month fillers
  var total=firstDay+daysInMonth;
  var rows=Math.ceil(total/7);
  var remaining=rows*7-total;
  for(var i=1;i<=remaining;i++){
    var ds=(josCalMonth===11?josCalYear+1:josCalYear)+'-'+String(josCalMonth===11?1:josCalMonth+2).padStart(2,'0')+'-'+String(i).padStart(2,'0');
    grid.appendChild(josMonthCell(ds,i,true,today));
  }
}

function josMonthCell(ds,dayNum,otherMonth,today) {
  var el=document.createElement('div');
  el.className='jos-month-cell'+(otherMonth?' other-month':'');
  if(ds===today) el.classList.add('today-cell');
  if(ds===josSelDate) el.classList.add('selected-cell');
  el.dataset.date=ds;

  var numDiv=document.createElement('div');
  numDiv.className='jos-month-day-num';
  numDiv.textContent=dayNum;
  el.appendChild(numDiv);

  var entries=josData[ds]||[];
  var maxShow=3;
  entries.slice(0,maxShow).forEach(function(e){ el.appendChild(josMonthEvent(e,ds)); });
  if(entries.length>maxShow){
    var more=document.createElement('div');
    more.className='jos-month-more';
    more.textContent='+'+(entries.length-maxShow)+' more';
    more.addEventListener('click',function(ev){ev.stopPropagation();josSelDate=ds;josRenderDayPanel();});
    el.appendChild(more);
  }

  // Click = select date
  el.addEventListener('click',function(){ josSelDate=ds; josRender(); });

  // Drag-over target
  el.addEventListener('dragover',function(ev){ ev.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave',function(){ el.classList.remove('drag-over'); });
  el.addEventListener('drop',function(ev){
    ev.preventDefault(); el.classList.remove('drag-over');
    var data=JSON.parse(ev.dataTransfer.getData('text/plain')||'{}');
    if(data.id&&data.fromDate) josDragMove(data.id,data.fromDate,ds);
  });
  return el;
}

function josMonthEvent(e,ds) {
  var today=josDateStr(new Date());
  var statusCls='ev-'+(e.status==='pending'&&ds<today?'overdue':e.status||'pending');
  var div=document.createElement('div');
  div.className='jos-month-event '+statusCls;
  div.textContent=e.jo+(e.item?' · '+e.item:'');
  div.draggable=true;
  div.addEventListener('dragstart',function(ev){ ev.dataTransfer.setData('text/plain',JSON.stringify({id:e.id,fromDate:ds})); });
  div.addEventListener('click',function(ev){ ev.stopPropagation(); josSelDate=ds; josRenderDayPanel(); josOpenCard(e.id); });
  return div;
}

/* ── WEEK VIEW ── */
function josRenderWeek() {
  var hdr=document.getElementById('jos-week-header');
  var body=document.getElementById('jos-week-body');
  hdr.innerHTML=''; body.innerHTML='';
  var today=josDateStr(new Date());

  // Time gutter header
  var gutterHdr=document.createElement('div'); hdr.appendChild(gutterHdr);

  var days=[];
  for(var i=0;i<7;i++){
    var d=new Date(josWeekStart.getTime()+i*86400000);
    days.push(d);
    var ds=josDateStr(d);
    var hdrCell=document.createElement('div');
    hdrCell.className='jos-week-hdr-cell';
    var numEl=document.createElement('div');
    numEl.className='jos-week-hdr-num'+(ds===today?' today-num':'');
    numEl.textContent=d.getDate();
    var dayEl=document.createElement('div');
    dayEl.className='jos-week-hdr-day';
    dayEl.textContent=['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
    hdrCell.appendChild(dayEl); hdrCell.appendChild(numEl);
    hdrCell.addEventListener('click',function(dateStr){return function(){josSelDate=dateStr;josRenderDayPanel();};}(ds));
    hdr.appendChild(hdrCell);
  }

  // Gutter col (decorative)
  var gutterCol=document.createElement('div');
  gutterCol.style.cssText='border-left:none;display:flex;flex-direction:column;justify-content:flex-start;padding:8px 4px;color:#70757a;font-size:10px;';
  body.appendChild(gutterCol);

  days.forEach(function(d) {
    var ds=josDateStr(d);
    var col=document.createElement('div');
    col.className='jos-week-col';
    if(ds===josSelDate) col.style.background='#f8f9fa';
    col.dataset.date=ds;
    col.addEventListener('click',function(){josSelDate=ds;josRenderDayPanel();});
    col.addEventListener('dragover',function(ev){ev.preventDefault();col.classList.add('drag-over');});
    col.addEventListener('dragleave',function(){col.classList.remove('drag-over');});
    col.addEventListener('drop',function(ev){
      ev.preventDefault();col.classList.remove('drag-over');
      var data=JSON.parse(ev.dataTransfer.getData('text/plain')||'{}');
      if(data.id&&data.fromDate) josDragMove(data.id,data.fromDate,ds);
    });
    var entries=josData[ds]||[];
    entries.forEach(function(e){
      var today2=josDateStr(new Date());
      var sc='ev-'+(e.status==='pending'&&ds<today2?'overdue':e.status||'pending');
      var ev=document.createElement('div');
      ev.className='jos-week-event '+sc;
      ev.draggable=true;
      ev.textContent=e.jo+(e.item?' · '+e.item:'');
      ev.addEventListener('dragstart',function(evt){evt.dataTransfer.setData('text/plain',JSON.stringify({id:e.id,fromDate:ds}));});
      ev.addEventListener('click',function(evt){evt.stopPropagation();josSelDate=ds;josRenderDayPanel();josOpenCard(e.id);});
      col.appendChild(ev);
    });
    body.appendChild(col);
  });
}

/* ── DRAG MOVE ── */
function josDragMove(id,fromDate,toDate) {
  if(fromDate===toDate) return;
  var entries=josData[fromDate]||[];
  var idx=entries.findIndex(function(e){return e.id===id;});
  if(idx===-1) return;
  var entry=entries.splice(idx,1)[0];
  if(!entries.length) delete josData[fromDate]; else josData[fromDate]=entries;
  if(!josData[toDate]) josData[toDate]=[];
  josData[toDate].push(entry);
  josSave();
  josSelDate=toDate;
  var parts=toDate.split('-');
  josCalYear=parseInt(parts[0]); josCalMonth=parseInt(parts[1])-1;
  josRender();
  josToast('✓ Moved to '+toDate,'ok');
}

/* ── DAY PANEL ── */
function josRenderDayPanel() {
  if(!josSelDate){ return; }
  var parts=josSelDate.split('-');
  var d=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
  document.getElementById('jos-day-panel-title').textContent=DAY_NAMES[d.getDay()]+', '+MONTH_NAMES[d.getMonth()]+' '+d.getDate();
  var entries=josData[josSelDate]||[];
  var list=document.getElementById('jos-day-panel-list');
  if(!entries.length){
    list.innerHTML='<div style="text-align:center;padding:32px 16px;color:#70757a;font-size:13px;">No Job Orders<br><span style="font-size:11px;">Tap + Add above</span></div>';
    return;
  }
  list.innerHTML=entries.map(function(e,idx){
    var today=josDateStr(new Date());
    var st=e.status||'pending';
    if(st==='pending'&&josSelDate<today) st='overdue';
    var pillCls={'pending':'pill-pending-g','in-progress':'pill-in-progress-g','done':'pill-done-g','overdue':'pill-overdue-g'}[st]||'pill-pending-g';
    var stLabel=st.replace('-',' ').toUpperCase();
    var sizes=[32,34,36,38,40,42].filter(function(s){return parseInt(e['s'+s])>0;});
    var sizeHtml=sizes.length?sizes.map(function(s){return '<span class="jos-dc-size-chip">'+s+': '+e['s'+s]+'</span>';}).join(''):'<span style="color:#9e9e9e;font-size:11px;">—</span>';
    return '<div class="jos-day-card st-'+(e.status||'pending')+'" id="josdaycard-'+e.id+'">'
      +'<div class="jos-day-card-hdr" onclick="josToggleDayCard(\''+e.id+'\')">'
      +'<div class="jos-day-card-jo">'+e.jo+'</div>'
      +'<div class="jos-day-card-meta">'+(e.item||'')+(e.color?' · '+e.color:'')+'</div>'
      +'<div class="jos-day-card-pill '+pillCls+'">'+stLabel+'</div>'
      +'</div>'
      +'<div class="jos-day-card-body" id="josdaybody-'+e.id+'">'
      +'<div class="jos-dc-detail"><b>Pieces:</b> '+(e.pieces||'—')+'</div>'
      +'<div class="jos-dc-detail"><b>Total Qty:</b> '+(e.totalqty||'—')+'</div>'
      +'<div class="jos-dc-detail"><b>Doc Date:</b> '+(e.docdate||'—')+'</div>'
      +'<div class="jos-dc-detail"><b>Prepared By:</b> '+(e.prepby||'—')+'</div>'
      +(e.deadline?'<div class="jos-dc-detail"><b>Deadline:</b> '+e.deadline+'</div>':'')
      +(e.remarks?'<div class="jos-dc-detail"><b>Remarks:</b> '+e.remarks+'</div>':'')
      +(e.note?'<div class="jos-dc-detail"><b>Note:</b> '+e.note+'</div>':'')
      +'<div class="jos-dc-sizes">'+sizeHtml+'</div>'
      +'<div class="jos-dc-actions">'
      +'<button class="jos-dc-btn" onclick="josSetStatus(\''+e.id+'\',\''+josSelDate+'\',\'pending\')">⏳</button>'
      +'<button class="jos-dc-btn blue" onclick="josSetStatus(\''+e.id+'\',\''+josSelDate+'\',\'in-progress\')">🔄</button>'
      +'<button class="jos-dc-btn green" onclick="josSetStatus(\''+e.id+'\',\''+josSelDate+'\',\'done\')">✅</button>'
      +'<button class="jos-dc-btn" onclick="openMoveDateModal(\''+e.id+'\',\''+josSelDate+'\')" title="Move">📅</button>'
      +'<button class="jos-dc-btn" onclick="openJOForm(\''+e.id+'\',null)" title="Edit">✏️</button>'
      +'<button class="jos-dc-btn red" onclick="josDeleteEntry(\''+e.id+'\',\''+josSelDate+'\')" title="Delete">🗑</button>'
      +'</div></div></div>';
  }).join('');
  josRenderMiniCal();
}

function josToggleDayCard(id) {
  var b=document.getElementById('josdaybody-'+id);
  if(b) b.classList.toggle('open');
}
function josOpenCard(id) {
  var b=document.getElementById('josdaybody-'+id);
  if(b) b.classList.add('open');
}

/* ── Incoming Banner ── */
function showIncomingBanner() {
  if(!josIncoming.length) return;
  var d=josIncoming[josIncomingIndex];
  var banner=document.getElementById('jos-incoming-banner');
  document.getElementById('jos-incoming-jo-num').textContent=d['JO Number']||'(No JO Number)';
  var meta=[];
  if(d['Item Description']) meta.push(d['Item Description']);
  if(d['Color']) meta.push('Color: '+d['Color']);
  if(d['Total Qty']) meta.push('Qty: '+d['Total Qty']);
  if(d['Doc Date']) meta.push('Doc: '+d['Doc Date']);
  document.getElementById('jos-incoming-meta').textContent=meta.join(' · ');
  var ctr=document.getElementById('jos-incoming-counter');
  ctr.textContent=josIncoming.length>1?(josIncomingIndex+1)+' of '+josIncoming.length+' pending':'1 pending';
  document.getElementById('jos-incoming-nav').style.display=josIncoming.length>1?'flex':'none';
  banner.style.display='flex';
}
function josIncomingPrev(){if(!josIncoming.length)return;josIncomingIndex=(josIncomingIndex-1+josIncoming.length)%josIncoming.length;showIncomingBanner();}
function josIncomingNext(){if(!josIncoming.length)return;josIncomingIndex=(josIncomingIndex+1)%josIncoming.length;showIncomingBanner();}
function josIncomingSave(){if(josIncoming.length>0)localStorage.setItem('joScanData',JSON.stringify(josIncoming));else localStorage.removeItem('joScanData');}
function dismissIncoming(){
  if(!josIncoming.length)return;
  josIncoming.splice(josIncomingIndex,1); josIncomingSave();
  if(!josIncoming.length){document.getElementById('jos-incoming-banner').style.display='none';josToast('All dismissed.','');}
  else{if(josIncomingIndex>=josIncoming.length)josIncomingIndex=josIncoming.length-1;showIncomingBanner();josToast(josIncoming.length+' remaining.','');}
}
function scheduleIncomingJO(){if(josIncoming.length)openJOForm(null,josIncoming[josIncomingIndex]);}

/* ── Status & Delete ── */
function josSetStatus(id,ds,status){
  var entries=josData[ds]||[];
  var joNum='';
  for(var i=0;i<entries.length;i++){
    if(entries[i].id===id){ entries[i].status=status; joNum=entries[i].jo||''; break; }
  }
  josData[ds]=entries; josSave(); josRender();
  josToast('Status: '+status.replace('-',' ').toUpperCase(),'ok');

  if(!joNum) return;

  if(status==='done'){
    /* Remove from JO History on ALL devices via Firebase jo_history node */
    removeJOHistoryByName(joNum, false);
  } else {
    /* Re-add to history if un-done back to active */
    var existing=joHistory.find(function(x){return x.jo===joNum;});
    if(!existing){
      joHistory.unshift({jo:joNum,date:new Date().toLocaleDateString('sv-SE'),ts:Date.now(),status:'pending'});
      saveHistory();
    } else {
      existing.status='pending';
      saveHistory();
    }
    renderJOHistory();
  }
}
function josDeleteEntry(id,ds){
  if(!confirm('Delete this Job Order?'))return;
  var entries=josData[ds]||[];
  var entry=entries.find(function(e){return e.id===id;});
  var joNum=entry?entry.jo:'';
  josData[ds]=entries.filter(function(e){return e.id!==id;});
  if(!josData[ds].length)delete josData[ds];
  josSave(); josRender(); josToast('Deleted.','');
  if(joNum) removeJOHistoryByName(joNum, true);
}

/* ── Add / Edit Form ── */
function openJOForm(editId,prefill){
  josEditId=editId||null;
  document.getElementById('josf-title').textContent=editId?'Edit Job Order':'Add Job Order';
  ['josf-jo','josf-item','josf-color','josf-pieces','josf-totalqty','josf-docdate','josf-prepby','josf-remarks','josf-note'].forEach(function(id){document.getElementById(id).value='';});
  [32,34,36,38,40,42].forEach(function(s){document.getElementById('josf-s'+s).value='';});
  document.getElementById('josf-date').value=josSelDate||'';
  document.getElementById('josf-deadline').value='';
  if(editId&&josSelDate){
    var entry=(josData[josSelDate]||[]).find(function(e){return e.id===editId;});
    if(entry){
      document.getElementById('josf-jo').value=entry.jo||'';
      document.getElementById('josf-item').value=entry.item||'';
      document.getElementById('josf-color').value=entry.color||'';
      document.getElementById('josf-pieces').value=entry.pieces||'';
      document.getElementById('josf-docdate').value=entry.docdate||'';
      document.getElementById('josf-prepby').value=entry.prepby||'';
      document.getElementById('josf-remarks').value=entry.remarks||'';
      document.getElementById('josf-note').value=entry.note||'';
      document.getElementById('josf-deadline').value=entry.deadline||'';
      [32,34,36,38,40,42].forEach(function(s){document.getElementById('josf-s'+s).value=entry['s'+s]||'';});
      josCalcTotal();
    }
  } else if(prefill){
    document.getElementById('josf-jo').value=prefill['JO Number']||'';
    document.getElementById('josf-item').value=prefill['Item Description']||'';
    document.getElementById('josf-color').value=prefill['Color']||'';
    document.getElementById('josf-pieces').value=prefill['No of Pieces']||'';
    document.getElementById('josf-docdate').value=prefill['Doc Date']||'';
    document.getElementById('josf-prepby').value=prefill['Prepared By']||'';
    document.getElementById('josf-remarks').value=prefill['Remarks']||'';
    document.getElementById('josf-note').value=prefill['Note']||'';
    [32,34,36,38,40,42].forEach(function(s){document.getElementById('josf-s'+s).value=prefill[String(s)]||'';});
    josCalcTotal();
  }
  document.getElementById('josFormOverlay').style.display='flex';
  setTimeout(function(){document.getElementById('josf-jo').focus();},100);
}
function closeJOForm(){document.getElementById('josFormOverlay').style.display='none';josEditId=null;}
function josCalcTotal(){
  var t=[32,34,36,38,40,42].reduce(function(s,sz){return s+(parseInt(document.getElementById('josf-s'+sz).value)||0);},0);
  document.getElementById('josf-totalqty').value=t||'';
}
function saveJOEntry(){
  var jo=document.getElementById('josf-jo').value.trim();
  var date=document.getElementById('josf-date').value;
  if(!jo){josToast('J.O. Number required!','err');return;}
  if(!date){josToast('Date required!','err');return;}
  var entry={id:josEditId||josGenId(),jo:jo,item:document.getElementById('josf-item').value.trim(),color:document.getElementById('josf-color').value.trim(),pieces:document.getElementById('josf-pieces').value.trim(),totalqty:document.getElementById('josf-totalqty').value.trim(),docdate:document.getElementById('josf-docdate').value.trim(),prepby:document.getElementById('josf-prepby').value.trim(),remarks:document.getElementById('josf-remarks').value.trim(),note:document.getElementById('josf-note').value.trim(),deadline:document.getElementById('josf-deadline').value,status:'pending',addedAt:new Date().toISOString()};
  [32,34,36,38,40,42].forEach(function(s){entry['s'+s]=document.getElementById('josf-s'+s).value.trim();});
  if(josEditId&&josSelDate){
    var idx=(josData[josSelDate]||[]).findIndex(function(e){return e.id===josEditId;});
    if(idx!==-1){entry.status=josData[josSelDate][idx].status;entry.addedAt=josData[josSelDate][idx].addedAt;josData[josSelDate][idx]=entry;}
    josToast('Updated!','ok');
  } else {
    if(!josData[date])josData[date]=[];
    josData[date].push(entry);
    josToast('Scheduled! ✓','ok');
  }
  josSave();
  josSelDate=date;
  var parts=date.split('-'); josCalYear=parseInt(parts[0]); josCalMonth=parseInt(parts[1])-1;
  josWeekStart=getWeekStart(new Date(josCalYear,josCalMonth,parseInt(parts[2])));
  josRender(); closeJOForm();
  if(josIncoming.length>0){josIncoming.splice(josIncomingIndex,1);josIncomingSave();if(!josIncoming.length)document.getElementById('jos-incoming-banner').style.display='none';else{if(josIncomingIndex>=josIncoming.length)josIncomingIndex=josIncoming.length-1;showIncomingBanner();}}
}

/* ── Move Date ── */
function openMoveDateModal(id,ds){
  josMoveId=id;josMoveDate_=ds;
  var entry=(josData[ds]||[]).find(function(e){return e.id===id;});
  document.getElementById('jos-move-jo-label').textContent=entry?entry.jo:'';
  document.getElementById('josMoveDate').value=ds;
  document.getElementById('josMoveOverlay').style.display='flex';
}
function closeMoveDateModal(){document.getElementById('josMoveOverlay').style.display='none';josMoveId=null;josMoveDate_=null;}
function confirmMoveDate(){
  var newDate=document.getElementById('josMoveDate').value;
  if(!newDate||!josMoveId||!josMoveDate_)return;
  josDragMove(josMoveId,josMoveDate_,newDate);
  closeMoveDateModal();
}

/* ── Toast ── */
function josToast(msg,type){
  var t=document.getElementById('jos-toast');
  t.textContent=msg; t.className='show'+(type?' '+type:'');
  clearTimeout(t._jt); t._jt=setTimeout(function(){t.className='';},3000);
}

/* ── Firebase Config ── */
function openFbConfigPanel(){
  var panel=document.getElementById('fb-config-panel');
  panel.style.display=panel.style.display==='none'?'block':'none';
  if(panel.style.display==='block'){
    document.getElementById('fbm-api-key').value=JO_FIREBASE_CONFIG.apiKey!=='YOUR_API_KEY'?JO_FIREBASE_CONFIG.apiKey:'';
    document.getElementById('fbm-db-url').value=JO_FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT')?'':JO_FIREBASE_CONFIG.databaseURL;
    document.getElementById('fbm-project-id').value=JO_FIREBASE_CONFIG.projectId!=='YOUR_PROJECT_ID'?JO_FIREBASE_CONFIG.projectId:'';
    refreshFbMasterStatus();
  }
}
function refreshFbMasterStatus(){
  var bar=document.getElementById('fb-master-status');
  if(!bar)return;
  if(JO_FIREBASE_CONFIG.apiKey==='YOUR_API_KEY'){bar.style.background='#fef9c3';bar.style.color='#b45309';bar.textContent='⚠️ Not configured';}
  else if(_fbListener){bar.style.background='#e6f4ea';bar.style.color='#137333';bar.textContent='✅ Connected & listening';}
  else{bar.style.background='#e8f0fe';bar.style.color='#1a73e8';bar.textContent='⏳ Configured, not connected';}
}
function saveFbMasterConfig(){
  var apiKey=document.getElementById('fbm-api-key').value.trim();
  var dbUrl=document.getElementById('fbm-db-url').value.trim();
  var projectId=document.getElementById('fbm-project-id').value.trim();
  if(!apiKey||!dbUrl||!projectId){josToast('Fill all 3 fields!','err');return;}
  var cfg={apiKey:apiKey,databaseURL:dbUrl,projectId:projectId,authDomain:projectId+'.firebaseapp.com',storageBucket:projectId+'.appspot.com',messagingSenderId:'',appId:''};
  Object.assign(JO_FIREBASE_CONFIG,cfg);
  localStorage.setItem('jo_firebase_cfg',JSON.stringify(cfg));
  _masterFbApp=null;_masterFbDb=null;_fbListener=null;_fbSchedListener=null;_fbHistoryListener=null;_fbDoneListener=null;
  startFbListener();refreshFbMasterStatus();
  josToast('✅ Firebase saved & connected!','ok');updateFbIndicator(true);
}
function testFbMasterConnection(){
  if(!masterFbInit()){josToast('Not configured','err');return;}
  _masterFbDb.ref('jo_ping_master').set({ping:new Date().toISOString()})
    .then(function(){josToast('✅ Connection OK!','ok');refreshFbMasterStatus();updateFbIndicator(true);})
    .catch(function(e){josToast('✗ Failed: '+e.message,'err');});
}
function clearFbMasterConfig(){
  localStorage.removeItem('jo_firebase_cfg');stopFbListener();_masterFbApp=null;_masterFbDb=null;
  JO_FIREBASE_CONFIG.apiKey='YOUR_API_KEY';refreshFbMasterStatus();updateFbIndicator(false);josToast('Config cleared','');
}

/* ── FILE STORE ── */
function josfsLoad(){try{return JSON.parse(localStorage.getItem(JOSFS_KEY)||'[]');}catch(e){return[];}}
function josfsSave(files){localStorage.setItem(JOSFS_KEY,JSON.stringify(files));}

function openJosFileStore(){
  document.getElementById('josFileStoreOverlay').style.display='flex';
  josfsRender();
}
function closeJosFileStore(){document.getElementById('josFileStoreOverlay').style.display='none';}

function josfsHandleFiles(fileList){
  var files=josfsLoad();
  var processed=0;
  Array.from(fileList).forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      files.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,4),name:file.name,size:file.size,type:file.type,date:new Date().toISOString(),data:e.target.result});
      processed++;
      if(processed===fileList.length){josfsSave(files);josfsRender();josToast('✓ '+processed+' file(s) saved','ok');}
    };
    reader.readAsDataURL(file);
  });
}

function josfsRender(){
  var files=josfsLoad();
  var list=document.getElementById('josfs-file-list');
  if(!files.length){list.innerHTML='<div class="josfs-empty">📂<br>No files stored yet.<br><span style="font-size:12px;">Upload scanned JO files above.</span></div>';return;}
  list.innerHTML=files.map(function(f){
    var icon=f.type.startsWith('image/')?'🖼️':f.type==='application/pdf'?'📑':f.type.includes('csv')?'📊':'📄';
    var sz=f.size<1024?f.size+'B':f.size<1048576?(f.size/1024).toFixed(1)+'KB':(f.size/1048576).toFixed(1)+'MB';
    var dateStr=new Date(f.date).toLocaleDateString();
    return '<div class="josfs-file-item">'
      +'<div class="josfs-file-icon">'+icon+'</div>'
      +'<div class="josfs-file-name" title="'+f.name+'">'+f.name+'</div>'
      +'<div class="josfs-file-date">'+dateStr+'</div>'
      +'<div class="josfs-file-size">'+sz+'</div>'
      +'<div class="josfs-file-actions">'
      +'<button class="josfs-file-btn" onclick="josfsDownload(\''+f.id+'\')" title="Download">⬇️</button>'
      +'<button class="josfs-file-btn" onclick="josfsDelete(\''+f.id+'\')" title="Delete">🗑️</button>'
      +'</div></div>';
  }).join('');
}
function josfsDownload(id){
  var files=josfsLoad();
  var f=files.find(function(x){return x.id===id;});
  if(!f)return;
  var a=document.createElement('a');a.href=f.data;a.download=f.name;a.click();
}
function josfsDelete(id){
  if(!confirm('Remove this file?'))return;
  var files=josfsLoad().filter(function(f){return f.id!==id;});
  josfsSave(files);josfsRender();josToast('File removed','');
}

// File store drag-and-drop
window.addEventListener('load',function(){
  var drop=document.getElementById('josfs-drop');
  if(!drop)return;
  drop.addEventListener('dragover',function(e){e.preventDefault();drop.classList.add('drag');});
  drop.addEventListener('dragleave',function(){drop.classList.remove('drag');});
  drop.addEventListener('drop',function(e){
    e.preventDefault();drop.classList.remove('drag');
    var files=e.dataTransfer.files;
    if(files.length) josfsHandleFiles(files);
  });
});



/* ════════════════════════════════════════════════════
   J.O. COST TRACKER JS — PROD2026 MASTER CLOUD
   Pay field: log.laborCost (confirmed)
════════════════════════════════════════════════════ */
var JOC_PROC_MAP={
  'BOU HOLDER':'CU1','PRE CUT BODY':'CU1','PRECUT PALAMAN':'CU1','RUGBY PRE CUT':'CU1',
  'CUTTING HOLDER / LOOPS':'CU2','CUTTING HOLDER/LOOPS':'CU2','CUTTING HOLDER':'CU2','CUTTING STRAP BODY':'CU2','CUTTING STRAP PALAMAN':'CU2',
  'RE SIZE BODY':'CU3','RESIZE BODY':'CU3','RE SIZE PALAMAN':'CU3','RESIZE PALAMAN':'CU3',
  'SKIVE BABA BODY':'CU4','SKIVE PALAMAN':'CU4','SKIVE TAAS BODY':'CU4','SKIVING HOLDER / LOOPS':'CU4','SKIVING HOLDER':'CU4','SKIVING HOLDER/LOOPS':'CU4',
  'PUNCHING ADJUSTER':'S1','PUNCHING HOLDER / LOOPS':'S1','PUNCHING HOLDER':'S1','PUNCHING HOLDER/LOOPS':'S1','PUNCHING PALAMAN':'S1','TAHI ADJUSTER':'S1',
  'EDGE CUTTING':'S2','HASA DULO':'S2','HASA DULO MBLT':'S2','PUNCHING MANUAL':'S2','PUNCHING MBLT':'S2','PUNCHING AND STAMPING':'S2','ROLLER BUO':'S2','ROLLER PALAMAN':'S2','RUGBY HOLDER':'S2','RUGBY TAAS/BABA':'S2','RUGBY TAAS BABA':'S2','RUGBY PALAMAN':'S2','STAMPING MANUAL':'S2','STAMPING MBLT':'S2','PAINT HOLDER / LOOPS':'S2','PAINT HOLDER':'S2','PAINTING':'S2',
  'GUPIT +SUNOG+QC':'S3','GUPIT SUNOG QC':'S3','SEWING':'S3','SEWING 2M':'S3','SEWING HOLDER / LOOPS':'S3','SEWING HOLDER':'S3','SEWING HOLDER/LOOPS':'S3','SEWING MANUAL':'S3','SEWING MONTEGANI 201':'S3','SEWING MONTEGANI':'S3',
  'PACKING':'S4','PACKING BASIC':'S4','PACKING MONTEGANI':'S4'
};
function jocGetSlot(p){if(!p)return null;var k=p.trim().toUpperCase();if(JOC_PROC_MAP[k])return JOC_PROC_MAP[k];if(/SKIV|RESIZE|RE SIZE/.test(k))return 'CU4';if(/PRECUT|PRE CUT|BOU|RUGBY PRE/.test(k))return 'CU1';if(/CUTTING/.test(k))return 'CU2';if(/PUNCHING|TAHI/.test(k))return 'S1';if(/RUGBY|ROLLER|STAMP|HASA|EDGE|PAINT/.test(k))return 'S2';if(/SEW|GUPIT|SUNOG|QC/.test(k))return 'S3';if(/PACK/.test(k))return 'S4';return null;}
function jocGetAllLogs(){var live=JSON.parse(localStorage.getItem('logs_v7')||'[]');var arch=JSON.parse(localStorage.getItem('attendance_archive_v7')||'[]');var stat=JSON.parse(localStorage.getItem('stats_archive_v7')||'[]');var seen={},all=[];[].concat(live,arch,stat).forEach(function(l){if(!l)return;if(!l.uid){all.push(l);return;}if(!seen[l.uid]){seen[l.uid]=true;all.push(l);}});return all.filter(function(l){return l&&l.jo&&l.process;});}
function jocFmt(v){if(!v||v==0)return '—';return '₱'+parseFloat(v).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function jocGetDate(log){if(log.date&&/^\d{4}-\d{2}-\d{2}$/.test(log.date))return log.date;if(log.timeIn){var d=new Date(log.timeIn);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}return '';}
function jocGetHrs(log){if(!log.timeIn||!log.timeOut)return 0;var h=(new Date(log.timeOut)-new Date(log.timeIn))/3600000;if(h>4.5)h-=0.5;return Math.max(0,h);}
function jocBuildMap(logs){var map={};logs.forEach(function(log){var jo=(log.jo||'').trim().toUpperCase();if(!jo)return;var slot=jocGetSlot(log.process);if(!slot)return;var eff=parseFloat(String(log.efficiency||0).replace('%',''));var status=log.status||(eff>=70?'PASS':'FAIL');/* laborCost is the confirmed PROD2026 pay field */var pay=parseFloat(log.laborCost)||0;var date=jocGetDate(log);var hrs=jocGetHrs(log);if(!map[jo])map[jo]={joNum:jo,date:date,slots:{CU1:[],CU2:[],CU3:[],CU4:[],S1:[],S2:[],S3:[],S4:[]}};if(date&&(!map[jo].date||date<map[jo].date))map[jo].date=date;map[jo].slots[slot].push({worker:log.operator||'?',process:log.process||'',pay:pay,status:status,eff:eff,hrs:hrs,timeIn:log.timeIn,timeOut:log.timeOut});});return map;}

var _jocExp={};
function jocToggleCell(id){_jocExp[id]=!_jocExp[id];var el=document.getElementById(id+'-chips');if(el)el.style.display=_jocExp[id]?'flex':'none';var ar=document.getElementById(id+'-arr');if(ar)ar.textContent=_jocExp[id]?'▲':'▼';}

function jocRenderCell(entries,cellId){
  if(!entries||!entries.length)return '<span style="color:#3a8a3a;font-size:9px;">—</span>';
  var total=entries.reduce(function(a,e){return a+e.pay;},0);
  var hrs=entries.reduce(function(a,e){return a+e.hrs;},0);
  var allPass=entries.every(function(e){return e.status==='PASS';});
  var clr=allPass?'#15803d':'#b91c1c',bg=allPass?'#dcfce7':'#fee2e2',bdr=allPass?'#bbf7d0':'#fecaca';
  var costStr=total>0?jocFmt(total):'<span style="color:#888;font-size:8px;">no cost</span>';
  var hrsStr=hrs>0?hrs.toFixed(1)+'h':'';
  var isOpen=_jocExp[cellId];
  var chips=entries.map(function(e){
    var cd=e.pay>0?'<span style="font-weight:900;font-size:9px;color:'+(e.status==='PASS'?'#15803d':'#b91c1c')+';">₱'+e.pay.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+'</span>':'<span style="font-size:8px;color:#888;">Eff:'+e.eff.toFixed(0)+'%</span>';
    var hm=e.hrs>0?e.hrs.toFixed(1)+'h':'';
    return '<div style="display:flex;align-items:center;gap:3px;padding:2px 5px;border-radius:4px;font-size:9px;font-weight:700;background:'+(e.status==='PASS'?'#dcfce7':'#fee2e2')+';border:1px solid '+(e.status==='PASS'?'#bbf7d0':'#fecaca')+';margin-bottom:2px;"><div style="display:flex;flex-direction:column;flex:1;min-width:0;"><span style="font-weight:800;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px;">'+e.worker+'</span><span style="font-size:8px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px;">'+e.process+'</span>'+(hm?'<span style="font-size:8px;opacity:.6;">'+hm+'</span>':'')+'</div>'+cd+'<span style="font-size:7px;padding:1px 3px;border-radius:2px;font-weight:900;background:'+(e.status==='PASS'?'#16a34a':'#dc2626')+';color:#fff;">'+(e.status==='PASS'?'P':'F')+'</span></div>';
  }).join('');
  return '<div style="min-width:100px;text-align:left;cursor:pointer;" onclick="jocToggleCell(\''+cellId+'\')"><div style="display:flex;align-items:center;gap:3px;padding:2px 5px;border-radius:4px;font-size:9px;font-weight:700;background:'+bg+';border:1px solid '+bdr+';color:'+clr+';margin-bottom:1px;"><span style="font-weight:900;">'+costStr+'</span>'+(hrsStr?'<span style="font-size:8px;opacity:.75;">· '+hrsStr+'</span>':'')+'<span style="font-size:8px;opacity:.75;">· '+entries.length+'w</span><span id="'+cellId+'-arr" style="font-size:8px;margin-left:2px;">'+(isOpen?'▲':'▼')+'</span></div><div id="'+cellId+'-chips" style="display:'+(isOpen?'flex':'none')+';flex-direction:column;">'+chips+'</div></div>';
}

var JOC_DEL_KEY='joc_deleted_v1';
function jocGetDeleted(){try{return JSON.parse(localStorage.getItem(JOC_DEL_KEY)||'[]');}catch(e){return[];}}
function jocDeleteJO(j){if(!confirm('Hide "'+j+'" from J.O. Cost Tracker?\nOriginal logs are NOT affected.'))return;var d=jocGetDeleted();if(d.indexOf(j)===-1)d.push(j);localStorage.setItem(JOC_DEL_KEY,JSON.stringify(d));jocRefresh();}
function jocRestoreAll(){if(!confirm('Restore all hidden J.O. rows?'))return;localStorage.removeItem(JOC_DEL_KEY);jocRefresh();}

var _jocMD={};
function jocRefresh(){
  var allLogs=jocGetAllLogs(),deleted=jocGetDeleted();
  var wSel=document.getElementById('joc-f-worker'),curW=wSel?wSel.value:'';
  var wNames=[];allLogs.forEach(function(l){if(l.operator&&wNames.indexOf(l.operator)===-1)wNames.push(l.operator);});wNames.sort();
  if(wSel){wSel.innerHTML='<option value="">All Workers</option>';wNames.forEach(function(w){var o=document.createElement('option');o.value=w;o.textContent=w;if(w===curW)o.selected=true;wSel.appendChild(o);});}
  var fJo=((document.getElementById('joc-f-jo')||{}).value||'').trim().toUpperCase();
  var fW=(document.getElementById('joc-f-worker')||{}).value||'';
  var fFr=(document.getElementById('joc-f-from')||{}).value||'';
  var fTo=(document.getElementById('joc-f-to')||{}).value||'';
  var fSt=(document.getElementById('joc-f-status')||{}).value||'';
  var logs=allLogs;
  if(fW)logs=logs.filter(function(l){return l.operator===fW;});
  if(fFr)logs=logs.filter(function(l){return jocGetDate(l)>=fFr;});
  if(fTo)logs=logs.filter(function(l){return jocGetDate(l)<=fTo;});
  if(fSt)logs=logs.filter(function(l){var ef=parseFloat(String(l.efficiency||0).replace('%',''));return(l.status||(ef>=70?'PASS':'FAIL'))===fSt;});
  if(fJo)logs=logs.filter(function(l){return(l.jo||'').trim().toUpperCase().indexOf(fJo)>-1;});
  var joMap=jocBuildMap(logs);
  var joList=Object.values(joMap).filter(function(r){return!deleted.includes(r.joNum)||fJo;}).sort(function(a,b){return b.date.localeCompare(a.date);});
  joList.forEach(function(r){_jocMD[r.joNum]=r;});
  var rb=document.getElementById('joc-restore-btn');if(rb)rb.style.display=deleted.length?'block':'none';
  var tbody=document.getElementById('joc-tbody'),cards=document.getElementById('joc-cards');
  if(!joList.length){tbody.innerHTML='<tr><td colspan="13" style="text-align:center;padding:30px;color:#6b7280;font-style:italic;">No J.O. data found. Finish a job in the scanner to see cost data here.</td></tr>';if(cards)cards.innerHTML='';return;}
  var totCU1=0,totCU2=0,totCU3=0,totCU4=0,totS1=0,totS2=0,totS3=0,totS4=0,totJOs=0,totPass=0,totFail=0,totHrs=0;
  tbody.innerHTML=joList.map(function(row,ri){
    var c=function(sl){return row.slots[sl].reduce(function(a,e){return a+e.pay;},0);};
    var cu1=c('CU1'),cu2=c('CU2'),cu3=c('CU3'),cu4=c('CU4'),s1=c('S1'),s2=c('S2'),s3=c('S3'),s4=c('S4');
    var tCU=cu1+cu2+cu3+cu4,grand=tCU+s1+s2+s3+s4;
    var allE=[].concat(row.slots.CU1,row.slots.CU2,row.slots.CU3,row.slots.CU4,row.slots.S1,row.slots.S2,row.slots.S3,row.slots.S4);
    var joHrs=allE.reduce(function(a,e){return a+e.hrs;},0);
    var joAllPass=allE.length>0&&allE.every(function(e){return e.status==='PASS';});
    totCU1+=cu1;totCU2+=cu2;totCU3+=cu3;totCU4+=cu4;totS1+=s1;totS2+=s2;totS3+=s3;totS4+=s4;totJOs++;
    allE.forEach(function(e){if(e.status==='PASS')totPass++;else totFail++;});totHrs+=joHrs;
    var pfx='jocr'+ri,rb=(ri%2===0)?'#7fff7f':'#6de86d',bd='1px solid #3ab03a';
    return '<tr style="background:'+rb+'">'
      +'<td style="padding:5px 8px;border:'+bd+';vertical-align:top;cursor:pointer;" onclick="jocOpenDetail(\''+row.joNum+'\')">'
      +'<div style="font-weight:900;font-size:11px;color:#1a1a2e;">'+row.joNum+'</div>'
      +'<div style="font-size:9px;color:#2c6e2c;">'+(row.date||'—')+'</div>'
      +(joHrs>0?'<div style="font-size:9px;color:#6b7280;">'+joHrs.toFixed(1)+'h</div>':'')
      +'<div style="margin-top:3px;"><span style="font-size:8px;padding:2px 5px;border-radius:3px;font-weight:700;'+(joAllPass?'background:#dcfce7;color:#16a34a':'background:#fee2e2;color:#dc2626')+'">'+(joAllPass?'✓ ALL PASS':'⚠ HAS FAIL')+'</span></div>'
      +'<div style="font-size:8px;color:#2563eb;margin-top:2px;">🔍 details</div></td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.CU1,pfx+'_CU1')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.CU2,pfx+'_CU2')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.CU3,pfx+'_CU3')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.CU4,pfx+'_CU4')+'</td>'
      +'<td style="padding:5px 8px;border:'+bd+';text-align:center;font-weight:800;font-size:11px;color:#0a400a;background:#4cc94c;vertical-align:top;">'+jocFmt(tCU)+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.S1,pfx+'_S1')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.S2,pfx+'_S2')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.S3,pfx+'_S3')+'</td>'
      +'<td style="padding:4px 5px;border:'+bd+';vertical-align:top;">'+jocRenderCell(row.slots.S4,pfx+'_S4')+'</td>'
      +'<td style="padding:5px 8px;border:'+bd+';text-align:center;font-weight:800;font-size:12px;color:#1a1a2e;background:#b8f0b8;vertical-align:top;cursor:pointer;" onclick="jocOpenDetail(\''+row.joNum+'\')">'
      +jocFmt(grand)+(joHrs>0?'<div style="font-size:8px;color:#6b7280;font-weight:400;">'+joHrs.toFixed(1)+'h</div>':'')+'</td>'
      +'<td style="padding:4px;border:'+bd+';text-align:center;vertical-align:middle;background:'+rb+';"><button id="joc-sb-'+ri+'" onclick="jocSendToSheets(\''+row.joNum+'\',this)" style="background:#16a34a;color:#fff;border:none;border-radius:5px;padding:4px 7px;font-size:10px;font-weight:700;cursor:pointer;">📊</button></td>'
      +'<td style="padding:4px;border:'+bd+';text-align:center;vertical-align:middle;background:'+rb+';"><button onclick="jocDeleteJO(\''+row.joNum+'\')" style="background:#dc2626;color:#fff;border:none;border-radius:5px;padding:4px 7px;font-size:10px;font-weight:700;cursor:pointer;">🗑</button></td>'
    +'</tr>';
  }).join('');
  var tTCU=totCU1+totCU2+totCU3+totCU4,tGT=tTCU+totS1+totS2+totS3+totS4;
  var cs='background:#fff;border:1px solid #e8e8e8;border-radius:10px;padding:10px 14px;flex:1;min-width:90px;',lb='font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.5px;',vl='font-size:18px;font-weight:900;margin-top:2px;';
  if(cards)cards.innerHTML='<div style="'+cs+'"><div style="'+lb+'">J.O.s</div><div style="'+vl+'color:#2563eb">'+totJOs+'</div></div><div style="'+cs+'"><div style="'+lb+'">Cutting</div><div style="'+vl+'color:#2563eb;font-size:14px">'+jocFmt(tTCU)+'</div></div><div style="'+cs+'"><div style="'+lb+'">Stage 1</div><div style="'+vl+'color:#16a34a;font-size:14px">'+jocFmt(totS1)+'</div></div><div style="'+cs+'"><div style="'+lb+'">Stage 2</div><div style="'+vl+'color:#d97706;font-size:14px">'+jocFmt(totS2)+'</div></div><div style="'+cs+'"><div style="'+lb+'">Stage 3</div><div style="'+vl+'color:#9333ea;font-size:14px">'+jocFmt(totS3)+'</div></div><div style="'+cs+'"><div style="'+lb+'">Stage 4</div><div style="'+vl+'color:#dc2626;font-size:14px">'+jocFmt(totS4)+'</div></div><div style="'+cs+'"><div style="'+lb+'">All Total</div><div style="'+vl+'color:#1a1a2e;font-size:16px">'+jocFmt(tGT)+'</div></div><div style="'+cs+'"><div style="'+lb+'">Total Hrs</div><div style="'+vl+'color:#0891b2;font-size:14px">'+totHrs.toFixed(1)+'h</div></div><div style="'+cs+'"><div style="'+lb+'">✓ Pass</div><div style="'+vl+'color:#16a34a">'+totPass+'</div></div><div style="'+cs+'"><div style="'+lb+'">✗ Fail</div><div style="'+vl+'color:#dc2626">'+totFail+'</div></div>';
}

function jocOpenDetail(joNum){
  var row=_jocMD[joNum];if(!row)return;
  var allE=[].concat(row.slots.CU1,row.slots.CU2,row.slots.CU3,row.slots.CU4,row.slots.S1,row.slots.S2,row.slots.S3,row.slots.S4);
  var total=allE.reduce(function(a,e){return a+e.pay;},0),tHrs=allE.reduce(function(a,e){return a+e.hrs;},0);
  var tP=allE.filter(function(e){return e.status==='PASS';}).length,tF=allE.length-tP;
  var wSet=[];allE.forEach(function(e){if(wSet.indexOf(e.worker)===-1)wSet.push(e.worker);});
  var sNames={CU1:'CUS1 — Cutting Stage 1',CU2:'CUS2 — Cutting Stage 2',CU3:'CUS3 — Cutting Stage 3',CU4:'CUS4 — Cutting Stage 4',S1:'Stage 1 — Advance',S2:'Stage 2 — Assembly / Paint',S3:'Stage 3 — Sewing / QC',S4:'Stage 4 — Packing'};
  var sBg={CU1:'#eff6ff',CU2:'#eff6ff',CU3:'#eff6ff',CU4:'#eff6ff',S1:'#f0fdf4',S2:'#fff7ed',S3:'#fdf4ff',S4:'#fef2f2'};
  var sFg={CU1:'#1d4ed8',CU2:'#1d4ed8',CU3:'#1d4ed8',CU4:'#1d4ed8',S1:'#15803d',S2:'#c2410c',S3:'#7e22ce',S4:'#b91c1c'};
  var sHtml='';
  ['CU1','CU2','CU3','CU4','S1','S2','S3','S4'].forEach(function(sl){
    var ents=row.slots[sl];if(!ents||!ents.length)return;
    var stT=ents.reduce(function(a,e){return a+e.pay;},0),stH=ents.reduce(function(a,e){return a+e.hrs;},0);
    sHtml+='<div style="margin-bottom:14px;"><div style="background:'+sBg[sl]+';color:'+sFg[sl]+';padding:7px 12px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;margin-bottom:6px;"><span>'+sNames[sl]+'</span><span style="font-weight:900;">'+(stT>0?jocFmt(stT):'no cost')+(stH>0?' · '+stH.toFixed(1)+'h':'')+'</span></div>';
    ents.forEach(function(e){
      var tI='',tO='',dS='';if(e.timeIn){var d=new Date(e.timeIn);dS=d.toLocaleDateString('en-PH',{month:'short',day:'numeric'});tI=d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',hour12:true});}if(e.timeOut)tO=new Date(e.timeOut).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',hour12:true});
      var hS=e.hrs>0?e.hrs.toFixed(2)+'h':'',eS=e.eff>0?e.eff.toFixed(1)+'%':'',cS=e.pay>0?jocFmt(e.pay):(eS||'—');
      sHtml+='<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;font-size:12px;margin-bottom:4px;background:'+(e.status==='PASS'?'#f0fdf4':'#fef2f2')+';border:1px solid '+(e.status==='PASS'?'#bbf7d0':'#fecaca')+'"><span style="font-weight:700;min-width:90px;font-size:11px;">'+e.worker+'</span><span style="flex:1;color:#374151;font-size:11px;">'+e.process+'</span><span style="font-size:10px;color:#6b7280;white-space:nowrap;">'+dS+(tI?' '+tI:'')+(tO?' – '+tO:'')+(hS?' · '+hS:'')+(eS?' · '+eS:'')+'</span><span style="font-weight:900;font-size:12px;white-space:nowrap;color:'+(e.status==='PASS'?'#15803d':'#b91c1c')+';">'+cS+'</span><span style="font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700;background:'+(e.status==='PASS'?'#16a34a':'#dc2626')+';color:#fff;">'+e.status+'</span></div>';
    });
    sHtml+='</div>';
  });
  document.getElementById('joc-detail-inner').innerHTML='<div style="background:#2c3e50;color:#fff;padding:18px 22px;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:15px;font-weight:900;">📋 '+joNum+'</div><div style="font-size:11px;opacity:.7;margin-top:2px;">'+(row.date||'')+' · '+allE.length+' entries</div></div><button onclick="jocCloseDetail()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:900;cursor:pointer;">✕</button></div><div style="padding:18px 22px;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:16px;"><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Total Cost</div><div style="font-size:16px;font-weight:900;color:#1a1a2e;margin-top:2px;">'+(total>0?jocFmt(total):'—')+'</div></div><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Total Hours</div><div style="font-size:16px;font-weight:900;color:#2563eb;margin-top:2px;">'+(tHrs>0?tHrs.toFixed(2)+'h':'—')+'</div></div><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Date</div><div style="font-size:13px;font-weight:900;color:#374151;margin-top:2px;">'+(row.date||'—')+'</div></div><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">✓ Pass</div><div style="font-size:16px;font-weight:900;color:#16a34a;margin-top:2px;">'+tP+'</div></div><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">✗ Fail</div><div style="font-size:16px;font-weight:900;color:#dc2626;margin-top:2px;">'+tF+'</div></div><div style="text-align:center;"><div style="font-size:9px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Workers</div><div style="font-size:16px;font-weight:900;color:#7c3aed;margin-top:2px;">'+wSet.length+'</div></div></div>'+sHtml+'</div>';
  document.getElementById('joc-detail-overlay').style.display='block';
  document.getElementById('joc-detail-modal').style.display='block';
}
function jocCloseDetail(){document.getElementById('joc-detail-overlay').style.display='none';document.getElementById('joc-detail-modal').style.display='none';}
function openJOCostTracker(){document.getElementById('joCostOverlay').style.display='flex';jocRefresh();}
function closeJOCostTracker(){document.getElementById('joCostOverlay').style.display='none';}
function jocClearFilters(){['joc-f-jo','joc-f-from','joc-f-to'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});['joc-f-worker','joc-f-status'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});jocRefresh();}

var JOC_SHEETS_KEY='joc_sheets_v1';
function jocGetSheetsSettings(){try{return JSON.parse(localStorage.getItem(JOC_SHEETS_KEY)||'{}');}catch(e){return{};}}
function jocOpenSheetsSettings(){var s=jocGetSheetsSettings();document.getElementById('joc-sheets-url').value=s.url||'';document.getElementById('joc-sheets-name').value=s.sheetName||'JO Cost Tracker';document.getElementById('joc-sheets-overlay').style.display='block';document.getElementById('joc-sheets-modal').style.display='block';}
function jocCloseSheetsSettings(){document.getElementById('joc-sheets-overlay').style.display='none';document.getElementById('joc-sheets-modal').style.display='none';}
function jocSaveSheetsSettings(){var url=document.getElementById('joc-sheets-url').value.trim(),nm=document.getElementById('joc-sheets-name').value.trim()||'JO Cost Tracker';localStorage.setItem(JOC_SHEETS_KEY,JSON.stringify({url:url,sheetName:nm}));jocCloseSheetsSettings();alert('✅ Sheets settings saved!');}

function jocSendToSheets(joNum,btn){
  var s=jocGetSheetsSettings();if(!s.url){jocOpenSheetsSettings();return;}
  var row=_jocMD[joNum];if(!row)return;
  var allE=[].concat(row.slots.CU1,row.slots.CU2,row.slots.CU3,row.slots.CU4,row.slots.S1,row.slots.S2,row.slots.S3,row.slots.S4);
  var c=function(sl){return row.slots[sl].reduce(function(a,e){return a+e.pay;},0);};
  var wNames=[];allE.forEach(function(e){if(wNames.indexOf(e.worker)===-1)wNames.push(e.worker);});
  var payload={action:'appendJO',sheetName:s.sheetName,joNumber:joNum,date:row.date,cu1:c('CU1'),cu2:c('CU2'),cu3:c('CU3'),cu4:c('CU4'),totalCU:c('CU1')+c('CU2')+c('CU3')+c('CU4'),stage1:c('S1'),stage2:c('S2'),stage3:c('S3'),stage4:c('S4'),grandTotal:allE.reduce(function(a,e){return a+e.pay;},0),totalHours:allE.reduce(function(a,e){return a+e.hrs;},0).toFixed(2),passCount:allE.filter(function(e){return e.status==='PASS';}).length,failCount:allE.filter(function(e){return e.status==='FAIL';}).length,workers:wNames.join(', '),detail:allE.map(function(e){return{worker:e.worker,process:e.process,pay:e.pay,status:e.status,hrs:e.hrs.toFixed(2),eff:e.eff.toFixed(1)};})};
  btn.style.background='#d97706';btn.textContent='⏳';
  fetch(s.url,{method:'POST',body:JSON.stringify(payload)}).then(function(){btn.style.background='#16a34a';btn.textContent='✅';setTimeout(function(){btn.style.background='#16a34a';btn.textContent='📊';},3000);}).catch(function(){btn.style.background='#dc2626';btn.textContent='❌';setTimeout(function(){btn.style.background='#16a34a';btn.textContent='📊';},3000);});
}

function jocCopyScript(){
  var s='function doPost(e){\n  try{\n    var data=JSON.parse(e.postData.contents);\n    var ss=SpreadsheetApp.getActiveSpreadsheet();\n    var sheet=ss.getSheetByName(data.sheetName)||ss.insertSheet(data.sheetName);\n    if(sheet.getLastRow()===0){sheet.appendRow([\'J.O. Number\',\'Date\',\'CUS1\',\'CUS2\',\'CUS3\',\'CUS4\',\'Total CU\',\'Stage 1\',\'Stage 2\',\'Stage 3\',\'Stage 4\',\'Grand Total\',\'Total Hrs\',\'Pass\',\'Fail\',\'Workers\',\'Sent At\']);var h=sheet.getRange(1,1,1,17);h.setBackground(\'#2c3e50\');h.setFontColor(\'#fff\');h.setFontWeight(\'bold\');sheet.setFrozenRows(1);}\n    var lr=sheet.getLastRow(),er=-1;\n    if(lr>1){var col=sheet.getRange(2,1,lr-1,1).getValues();for(var i=0;i<col.length;i++){if(String(col[i][0]).trim().toUpperCase()===String(data.joNumber).trim().toUpperCase()){er=i+2;break;}}}\n    var row=[data.joNumber,data.date,+data.cu1||0,+data.cu2||0,+data.cu3||0,+data.cu4||0,+data.totalCU||0,+data.stage1||0,+data.stage2||0,+data.stage3||0,+data.stage4||0,+data.grandTotal||0,+data.totalHours||0,+data.passCount||0,+data.failCount||0,data.workers||\'\',new Date().toLocaleString()];\n    if(er>0)sheet.getRange(er,1,1,row.length).setValues([row]);else sheet.appendRow(row);\n    var tr=er>0?er:sheet.getLastRow();\n    sheet.getRange(tr,1,1,row.length).setBackground((+data.failCount||0)>0?\'#fee2e2\':\'#dcfce7\');\n    if(data.detail&&data.detail.length){var ds=ss.getSheetByName(data.sheetName+\' Detail\')||ss.insertSheet(data.sheetName+\' Detail\');if(ds.getLastRow()===0){ds.appendRow([\'J.O.\',\'Worker\',\'Process\',\'Pay\',\'Status\',\'Hours\',\'Eff%\',\'Sent\']);var dh=ds.getRange(1,1,1,8);dh.setBackground(\'#374151\');dh.setFontColor(\'#fff\');dh.setFontWeight(\'bold\');ds.setFrozenRows(1);}var sa=new Date().toLocaleString();data.detail.forEach(function(e){ds.appendRow([data.joNumber,e.worker,e.process,+e.pay||0,e.status,+e.hrs||0,+e.eff||0,sa]);});}\n    return ContentService.createTextOutput(JSON.stringify({status:\'ok\'})).setMimeType(ContentService.MimeType.JSON);\n  }catch(err){return ContentService.createTextOutput(JSON.stringify({status:\'error\',message:err.message})).setMimeType(ContentService.MimeType.JSON);}}\nfunction doGet(){return ContentService.createTextOutput(JSON.stringify({status:\'ok\',message:\'PROD2026 JO Cost live.\'})).setMimeType(ContentService.MimeType.JSON);}';
  if(navigator.clipboard){navigator.clipboard.writeText(s).then(function(){alert('✅ Script copied!');});}else{var t=document.createElement('textarea');t.value=s;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();alert('✅ Script copied!');}
}

function jocExportCSV(){
  var logs=jocGetAllLogs(),map=jocBuildMap(logs);
  var list=Object.values(map).sort(function(a,b){return b.date.localeCompare(a.date);});
  var csv='J.O.,Date,CUS1,CUS2,CUS3,CUS4,Total CU,Stage1,Stage2,Stage3,Stage4,Grand Total,Total Hrs\n';
  list.forEach(function(r){var c=function(sl){return r.slots[sl].reduce(function(a,e){return a+e.pay;},0);};var allE=[].concat(r.slots.CU1,r.slots.CU2,r.slots.CU3,r.slots.CU4,r.slots.S1,r.slots.S2,r.slots.S3,r.slots.S4);var hrs=allE.reduce(function(a,e){return a+e.hrs;},0);var cu1=c('CU1'),cu2=c('CU2'),cu3=c('CU3'),cu4=c('CU4'),tcu=cu1+cu2+cu3+cu4,s1=c('S1'),s2=c('S2'),s3=c('S3'),s4=c('S4'),gt=tcu+s1+s2+s3+s4;csv+='"'+r.joNum+'","'+r.date+'",'+cu1.toFixed(2)+','+cu2.toFixed(2)+','+cu3.toFixed(2)+','+cu4.toFixed(2)+','+tcu.toFixed(2)+','+s1.toFixed(2)+','+s2.toFixed(2)+','+s3.toFixed(2)+','+s4.toFixed(2)+','+gt.toFixed(2)+','+hrs.toFixed(2)+'\n';});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='jo_cost_tracker.csv';a.click();
}

/* Auto-refresh every 2s when overlay is open */
setInterval(function(){if(document.getElementById('joCostOverlay').style.display!=='none')jocRefresh();},2000);