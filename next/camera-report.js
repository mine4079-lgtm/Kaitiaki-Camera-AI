/* Camera Check + reporting workflow for Kaitiaki Camera AI. */
(()=>{"use strict";
const $=id=>document.getElementById(id);
const DB_NAME="kaitiaki-next-v1",STORE="image-records";
const CHECKS_KEY="kaitiaki-camera-checks-v1",REGISTER_KEY="kaitiaki-camera-register-v1",CURRENT_KEY="kaitiaki-current-camera-check-v1";
const TEAM_KEY="kaitiaki-team-name",STAFF_KEY="kaitiaki-staff-name",DEVICE_NAME_KEY="kaitiaki-device-name",DEVICE_ID_KEY="kaitiaki-device-id";
const URL_KEY="kaitiaki-next-cloud-endpoint",TOKEN_KEY="kaitiaki-next-session-token",PERSIST_TOKEN_KEY="kaitiaki-next-device-token";
const DEFAULT_URL="https://kaitiaki-next-vision.monaghan666.workers.dev";
const PESTS=["Possum","Rat","Stoat","Mouse","Deer","Pig"];
const LABELS=["Possum","Rat","Stoat","Mouse","Deer","Pig","Weka","Other wildlife","Human","Unsure"];
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function endpoint(){return (localStorage.getItem(URL_KEY)||DEFAULT_URL).replace(/\/+$/,"")}
function token(){return localStorage.getItem(PERSIST_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||""}
function team(){return {
  teamName:localStorage.getItem(TEAM_KEY)||"",
  staffName:localStorage.getItem(STAFF_KEY)||"",
  deviceName:localStorage.getItem(DEVICE_NAME_KEY)||"",
  deviceId:localStorage.getItem(DEVICE_ID_KEY)||""
}}
function loadJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"")||fallback}catch{return fallback}}
function saveJSON(key,value){localStorage.setItem(key,JSON.stringify(value))}
function today(){return new Date().toISOString().slice(0,10)}
function uuid(){return crypto.randomUUID?crypto.randomUUID():"check-"+Date.now()+"-"+Math.random().toString(36).slice(2)}
function esc(s){return String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function csv(s){return '"'+String(s??"").replace(/"/g,'""')+'"'}

function current(){return loadJSON(CURRENT_KEY,null)}
function saveCurrent(c){if(c)saveJSON(CURRENT_KEY,c);else localStorage.removeItem(CURRENT_KEY);renderCurrent()}
window.KaitiakiCameraCheckContext=()=>{const c=current();return c?{
  cameraCheckId:c.id,cameraNo:c.cameraNo,zone:c.zone,block:c.block,status:c.status,
  checkNo:c.checkNo,checkedDate:c.checkedDate,servicedBy:c.servicedBy
}:{}};

function register(){return loadJSON(REGISTER_KEY,{})}
function saveRegister(cameraNo,meta){
  const all=register();all[cameraNo.toUpperCase()]={cameraNo,...meta};saveJSON(REGISTER_KEY,all);fillCameraList();
}
function fillCameraList(){
  const list=$("cameraList");if(!list)return;list.replaceChildren();
  Object.values(register()).sort((a,b)=>a.cameraNo.localeCompare(b.cameraNo)).forEach(c=>{
    const o=document.createElement("option");o.value=c.cameraNo;list.append(o);
  });
}
function applyCameraMeta(){
  const key=$("cameraNo")?.value.trim().toUpperCase();if(!key)return;
  const c=register()[key];if(!c)return;
  if($("cameraZone"))$("cameraZone").value=c.zone||"";
  if($("cameraBlock"))$("cameraBlock").value=c.block||"";
  if($("cameraStatus"))$("cameraStatus").value=c.status||"Active";
  suggestCheckNo(key);
}
function localChecks(){return loadJSON(CHECKS_KEY,[])}
function saveLocalCheck(check){
  const all=localChecks(),i=all.findIndex(x=>x.id===check.id);
  if(i>=0)all[i]=check;else all.unshift(check);
  saveJSON(CHECKS_KEY,all.slice(0,1500));
}
function suggestCheckNo(cameraNo){
  if(!$("cameraCheckNo"))return;
  const n=localChecks().filter(c=>String(c.cameraNo||"").toUpperCase()===cameraNo.toUpperCase()).reduce((m,c)=>Math.max(m,Number(c.checkNo)||0),0)+1;
  if(!$("cameraCheckNo").value||Number($("cameraCheckNo").value)<=1)$("cameraCheckNo").value=String(n);
}
async function startCheck(){
  const cameraNo=$("cameraNo").value.trim().toUpperCase();
  if(!cameraNo){$("cameraCheckStatusText").textContent="Enter the camera number first.";return}
  const t=team();
  if(!t.staffName){$("cameraCheckStatusText").textContent="Set your name once in Team before starting a camera check.";return}
  const c={
    id:uuid(),cameraNo,
    zone:$("cameraZone").value.trim(),block:$("cameraBlock").value.trim(),
    status:$("cameraStatus").value,
    checkNo:Math.max(1,Number($("cameraCheckNo").value)||1),
    checkedDate:$("cameraCheckedDate").value||today(),
    servicedBy:t.staffName||"",
    issuesNotes:$("cameraIssues").value.trim(),
    approxPresence:$("cameraPresence").value||"",
    teamName:t.teamName,deviceName:t.deviceName,deviceId:t.deviceId,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  saveRegister(cameraNo,{zone:c.zone,block:c.block,status:c.status});
  saveCurrent(c);
  let attached=0;
  try{attached=await window.KaitiakiAttachConnectedToCameraCheck?.(window.KaitiakiCameraCheckContext?.()||{})||0}catch{}
  $("cameraCheckStatusText").textContent=attached
    ?"Camera check started for "+cameraNo+". "+attached+" already imported image"+(attached===1?"":"s")+" attached to this check."
    :"Camera check started for "+cameraNo+". New imports will be attached automatically. If these photos were imported earlier, reconnect that same SD card/folder once and press Start camera check again.";
}
function cancelCheck(){
  if(!current())return;
  if(!confirm("Cancel this camera check? Imported image records will stay saved, but new imports will no longer be attached to it."))return;
  saveCurrent(null);
  $("cameraCheckStatusText").textContent="Camera check cleared.";
}
function renderCurrent(){
  const c=current(),box=$("currentCameraCheck");
  if(!box)return;
  if(!c){box.textContent="No camera check started yet.";return}
  box.innerHTML="<strong>"+esc(c.cameraNo)+"</strong> · Check "+esc(c.checkNo)+" · "+esc(c.checkedDate)+(c.servicedBy?" · "+esc(c.servicedBy):"")+"<br><small>"+esc(c.zone||"No zone")+" · "+esc(c.block||"No block")+" · "+esc(c.status||"")+"</small>";
}

function readAscii(view,start,len){let s="";for(let i=0;i<len;i++)s+=String.fromCharCode(view.getUint8(start+i));return s.replace(/\0/g,"").trim()}
function exifDateToIso(v){
  const m=/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v||"");
  return m?m[1]+"-"+m[2]+"-"+m[3]+"T"+m[4]+":"+m[5]+":"+m[6]:null;
}
async function extractCaptureDate(file){
  try{
    if(!/jpe?g/i.test(file.type||file.name))return {capturedAt:new Date(file.lastModified).toISOString(),source:"file"};
    const buf=await file.slice(0,256*1024).arrayBuffer(),v=new DataView(buf);
    if(v.byteLength<4||v.getUint16(0)!==0xFFD8)throw Error("not jpeg");
    let p=2;
    while(p+4<v.byteLength){
      if(v.getUint8(p)!==0xFF){p++;continue}
      const marker=v.getUint8(p+1),len=v.getUint16(p+2);
      if(marker===0xE1&&p+2+len<=v.byteLength&&readAscii(v,p+4,6)==="Exif"){
        const t=p+10,little=v.getUint16(t)===0x4949;
        const u16=o=>v.getUint16(o,little),u32=o=>v.getUint32(o,little);
        const ifd0=t+u32(t+4);
        const findTag=(base,tag)=>{
          const n=u16(base);for(let i=0;i<n;i++){const e=base+2+i*12;if(e+12>v.byteLength)break;if(u16(e)===tag)return e}return -1
        };
        let exifPtr=findTag(ifd0,0x8769);
        let exifBase=exifPtr>=0?t+u32(exifPtr+8):ifd0;
        let e=findTag(exifBase,0x9003); if(e<0)e=findTag(exifBase,0x0132);
        if(e>=0){
          const count=u32(e+4),off=count<=4?e+8:t+u32(e+8);
          const iso=exifDateToIso(readAscii(v,off,Math.min(count,32)));
          if(iso)return {capturedAt:iso,source:"exif"};
        }
        break;
      }
      if(!len||len<2)break;p+=2+len;
    }
  }catch{}
  return {capturedAt:new Date(file.lastModified).toISOString(),source:"file"};
}
window.KaitiakiExtractCaptureDate=extractCaptureDate;

function openDB(){return new Promise((ok,no)=>{const q=indexedDB.open(DB_NAME,1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function allRows(db){return new Promise((ok,no)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function effectiveLabel(r){return r.verified?r.label:(r.aiPrediction||"")}
function isSkipped(r){return !!r.aiSkipped||r.aiPrediction==="Empty image"}
function dateOnly(v){return v?String(v).slice(0,10):""}
function presenceFromCount(n){n=Number(n)||0;return n===0?"None":n<=9?"Low":n<=15?"Medium":"High"}

async function finishCheck(){
  const c=current();if(!c){$("cameraCheckStatusText").textContent="Start a camera check first.";return}
  const btn=$("finishCameraCheck");btn.disabled=true;
  $("cameraCheckStatusText").textContent="Finishing "+c.cameraNo+"…";
  try{
    let db=await openDB(),rows;try{rows=await allRows(db)}finally{db.close()}
    let linked=rows.filter(r=>r.cameraCheckId===c.id);
    if(!linked.length){
      try{await window.KaitiakiAttachConnectedToCameraCheck?.(window.KaitiakiCameraCheckContext?.()||{})}catch{}
      db=await openDB();try{rows=await allRows(db)}finally{db.close()}
      linked=rows.filter(r=>r.cameraCheckId===c.id);
    }
    if(!linked.length){
      const startedAt=new Date(c.createdAt||0).getTime();
      const recover=rows.filter(r=>{
        if(r.cameraCheckId||!r.aiPrediction||!r.aiCheckedAt||!startedAt)return false;
        const checkedAt=new Date(r.aiCheckedAt).getTime();
        return Number.isFinite(checkedAt)&&checkedAt>=startedAt;
      });
      if(recover.length){
        const context=window.KaitiakiCameraCheckContext?.()||{};
        const now=new Date().toISOString(),updates=recover.map(r=>({...r,...context,updatedAt:now}));
        db=await openDB();try{
          await new Promise((ok,no)=>{const t=db.transaction(STORE,"readwrite"),st=t.objectStore(STORE);for(const r of updates)st.put(r);t.oncomplete=ok;t.onerror=()=>no(t.error)});
        }finally{db.close()}
        for(const r of updates)window.KaitiakiSharedSync?.(r,r.preview);
        rows=rows.map(r=>updates.find(u=>u.key===r.key)||r);
        linked=rows.filter(r=>r.cameraCheckId===c.id);
      }
    }
    if(!linked.length){
      let forced=0;
      try{forced=await window.KaitiakiAttachConnectedToCameraCheck?.(window.KaitiakiCameraCheckContext?.()||{},{force:true})||0}catch{}
      if(forced){
        db=await openDB();try{rows=await allRows(db)}finally{db.close()}
        linked=rows.filter(r=>r.cameraCheckId===c.id);
      }
    }
    if(!linked.length){$("cameraCheckStatusText").textContent="Could not finish "+c.cameraNo+": the connected files still could not be linked to this check.";return}
    const processed=linked.filter(r=>r.aiPrediction||(r.verified&&r.label));
    if(!processed.length){$("cameraCheckStatusText").textContent="Images are imported, but AI identification has not been run yet.";return}
    const meaningful=processed.filter(r=>!isSkipped(r));
    const species={};for(const r of meaningful){const label=effectiveLabel(r);if(label)species[label]=(species[label]||0)+1}
    const year=Number((c.checkedDate||today()).slice(0,4))||new Date().getFullYear();
    const monthly=Array(12).fill(0);
    const possums=meaningful.filter(r=>effectiveLabel(r)==="Possum");
    for(const r of possums){
      const d=new Date(r.capturedAt||r.lastModified||0);
      if(!Number.isNaN(d.getTime())&&d.getFullYear()===year)monthly[d.getMonth()]++;
    }
    const dates=linked.map(r=>r.capturedAt).filter(Boolean).map(v=>new Date(v)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>a-b);
    const checkedTimes=processed.map(r=>r.aiCheckedAt||r.verifiedAt||r.updatedAt).filter(Boolean).sort();
    const possumDates=possums.map(r=>new Date(r.capturedAt||r.lastModified||0)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>a-b);
    const latestPossumDate=possumDates.length?dateOnly(possumDates.at(-1).toISOString()):"";
    let presence="";
    const noteParts=Object.entries(species).filter(([k])=>k!=="Possum").sort((a,b)=>b[1]-a[1]).map(([k,n])=>k+" "+n);
    const t=team(),now=new Date().toISOString();
    const totalForYear=monthly.reduce((a,n)=>a+n,0);
    presence=presenceFromCount(totalForYear);
    const report={
      ...c,
      zone:$("cameraZone").value.trim()||c.zone,block:$("cameraBlock").value.trim()||c.block,status:$("cameraStatus").value||c.status,
      checkNo:Math.max(1,Number($("cameraCheckNo").value)||c.checkNo||1),checkedDate:$("cameraCheckedDate").value||c.checkedDate,
      servicedBy:c.servicedBy||t.staffName||"",classifiedBy:t.staffName||c.servicedBy||"",
      classifiedDate:dateOnly(checkedTimes.at(-1)||now),
      firstImageDate:dates.length?dateOnly(dates[0].toISOString()):"",
      lastImageDate:dates.length?dateOnly(dates.at(-1).toISOString()):"",
      approxPresence:presence,latestPossumDate,reportYear:year,monthlyPossum:monthly,totalPossum:totalForYear,
      speciesCounts:species,imagesProcessed:processed.length,meaningfulCount:meaningful.length,
      skippedCount:processed.filter(isSkipped).length,humanCount:species.Human||0,unsureCount:species.Unsure||0,
      notes:noteParts.join("; "),issuesNotes:$("cameraIssues").value.trim()||c.issuesNotes||"",
      updatedAt:now
    };
    saveLocalCheck(report);await syncCheck(report);
    saveCurrent(null);window.KaitiakiClearConnectedFiles?.();renderReport();
    $("cameraCheckStatusText").textContent="Camera check saved: "+report.cameraNo+" · "+report.meaningfulCount+" meaningful detections · "+report.skippedCount+" empty/vegetation frames skipped. Connected SD/folder cleared for the next camera.";
  }catch(e){$("cameraCheckStatusText").textContent="Could not finish camera check: "+String(e.message||e)}
  finally{btn.disabled=false}
}

function captureDateForLink(r){
  const raw=String(r?.capturedAt||"");
  if(/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
  const d=new Date(r?.lastModified||0);if(Number.isNaN(d.getTime()))return "";
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
async function reconcileLocalCameraLinks(cameraNames=[]){
  let checks=localChecks();
  try{
    const remote=await sharedChecks(),byId=new Map(checks.map(c=>[String(c.id),c]));
    for(const c of remote){const old=byId.get(String(c.id));if(!old||String(c.updatedAt||"")>String(old.updatedAt||""))byId.set(String(c.id),c)}
    checks=[...byId.values()];
  }catch{}
  const deduped=dedupeCameraChecks(checks).checks;
  const chosen=new Set(cameraNames.map(v=>String(v).trim().toUpperCase()).filter(Boolean));
  const filtered=chosen.size?deduped.filter(c=>chosen.has(String(c.cameraNo||"").trim().toUpperCase())):deduped;
  const byId=new Map(filtered.map(c=>[String(c.id),c])),groups=new Map();
  for(const c of filtered){
    const camera=String(c.cameraNo||"").trim().toUpperCase(),year=Number(c.reportYear)||Number(String(c.checkedDate||"").slice(0,4));
    const date=String(c.checkedDate||"").slice(0,10);if(!camera||!year||!date)continue;
    const key=camera+"|"+year;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);
  }
  const ambiguous=new Set();
  for(const [key,group] of groups){
    group.sort((a,b)=>String(a.checkedDate).localeCompare(String(b.checkedDate))||Number(a.checkNo||0)-Number(b.checkNo||0));
    const dates=new Map();for(const c of group){const d=String(c.checkedDate).slice(0,10);dates.set(d,(dates.get(d)||0)+1)}
    if([...dates.values()].some(n=>n>1))ambiguous.add(key);
  }
  const db=await openDB();let rows=[];try{rows=await allRows(db)}finally{db.close()}
  const now=new Date().toISOString(),updates=[];
  for(const r of rows){
    const current=byId.get(String(r.cameraCheckId||""));
    const camera=String(r.cameraNo||current?.cameraNo||"").trim().toUpperCase();
    if(!camera||(chosen.size&&!chosen.has(camera)))continue;
    const captured=captureDateForLink(r);if(!/^\d{4}-\d{2}-\d{2}$/.test(captured))continue;
    const year=Number(captured.slice(0,4)),key=camera+"|"+year,group=groups.get(key);
    if(!group||ambiguous.has(key))continue;
    if(r.cameraCheckId&&!current)continue;
    if(current&&String(current.cameraNo||"").trim().toUpperCase()!==camera)continue;
    const target=group.find(c=>String(c.checkedDate).slice(0,10)>=captured);if(!target)continue;
    if(String(r.cameraCheckId||"")===String(target.id)&&Number(r.checkNo||0)===Number(target.checkNo||0)&&String(r.checkedDate||"").slice(0,10)===String(target.checkedDate||"").slice(0,10))continue;
    updates.push({...r,cameraCheckId:target.id,cameraNo:target.cameraNo,zone:target.zone||r.zone||"",block:target.block||r.block||"",status:target.status||r.status||"",checkNo:target.checkNo,checkedDate:target.checkedDate,servicedBy:target.servicedBy||r.servicedBy||"",updatedAt:now});
  }
  if(updates.length){
    const db2=await openDB();try{await new Promise((ok,no)=>{const t=db2.transaction(STORE,"readwrite"),st=t.objectStore(STORE);for(const r of updates)st.put(r);t.oncomplete=ok;t.onerror=()=>no(t.error)})}finally{db2.close()}
    for(const r of updates)await window.KaitiakiSharedSyncMetadataIfChanged?.(r);
  }
  localStorage.setItem("kaitiaki-camera-link-reconciled-v1","true");
  await backfillExistingChecks();
  return {moved:updates.length,ambiguousCameras:ambiguous.size};
}
window.KaitiakiReconcileLocalCameraLinks=reconcileLocalCameraLinks;

async function backfillExistingChecks(){
  const checks=localChecks();if(!checks.length)return;
  const includeManualOnly=localStorage.getItem("kaitiaki-camera-link-reconciled-v1")==="true";
  let db,rows=[];try{db=await openDB();rows=await allRows(db)}catch{return}finally{db?.close()}
  let changed=false;
  for(const c of checks){
    const linked=rows.filter(r=>r.cameraCheckId===c.id&&(r.aiPrediction||(includeManualOnly&&r.verified&&r.label)));
    if(!linked.length)continue;
    const meaningful=linked.filter(r=>!isSkipped(r));
    const possums=meaningful.filter(r=>effectiveLabel(r)==="Possum");
    const year=Number(c.reportYear||String(c.checkedDate||today()).slice(0,4))||new Date().getFullYear();
    const monthly=Array(12).fill(0),dates=[];
    for(const r of possums){const d=new Date(r.capturedAt||r.lastModified||0);if(!Number.isNaN(d.getTime())){dates.push(d);if(d.getFullYear()===year)monthly[d.getMonth()]++}}
    dates.sort((a,b)=>a-b);const total=monthly.reduce((a,n)=>a+n,0);
    const latest=dates.length?dateOnly(dates.at(-1).toISOString()):"";
    if(c.latestPossumDate!==latest||c.approxPresence!==presenceFromCount(total)||Number(c.totalPossum)!==total){
      c.latestPossumDate=latest;c.approxPresence=presenceFromCount(total);c.totalPossum=total;c.monthlyPossum=monthly;c.updatedAt=new Date().toISOString();saveLocalCheck(c);await syncCheck(c);changed=true;
    }
  }
  if(changed)renderReport();
}

async function syncCheck(check){
  if(!navigator.onLine||!token())return false;
  try{
    const res=await fetch(endpoint()+"/team/camera-check-sync",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({token:token(),check})});
    if(!res.ok)throw Error("sync "+res.status);return true;
  }catch{return false}
}
async function sharedChecks(){
  if(!navigator.onLine||!token())return [];
  const res=await fetch(endpoint()+"/team/camera-checks",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({token:token(),limit:1000})});
  const data=await res.json();if(!res.ok)throw Error(data.error||"Shared report unavailable");return data.checks||[];
}
async function mergedChecks(){
  const map=new Map(localChecks().map(c=>[c.id,c]));
  try{for(const c of await sharedChecks()){const old=map.get(c.id);if(!old||String(c.updatedAt||"")>String(old.updatedAt||""))map.set(c.id,c)}}catch{}
  return [...map.values()].sort((a,b)=>String(b.checkedDate||"").localeCompare(String(a.checkedDate||""))||String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
}

function cameraSort(a,b){
  return String(a.cameraNo||"").localeCompare(String(b.cameraNo||""),undefined,{numeric:true,sensitivity:"base"})
    || Number(b.checkNo||0)-Number(a.checkNo||0)
    || String(b.checkedDate||"").localeCompare(String(a.checkedDate||""))
    || String(b.updatedAt||"").localeCompare(String(a.updatedAt||""));
}
function dedupeCameraChecks(checks){
  const keep=new Map(),duplicates=[];
  for(const c of checks){
    const camera=String(c.cameraNo||"").trim().toUpperCase();
    const checkNo=Number(c.checkNo)||0;
    const date=String(c.checkedDate||"").trim();
    if(!camera||!checkNo||!date){
      keep.set("id:"+String(c.id||Math.random()),c);
      continue;
    }
    const key=camera+"|"+checkNo+"|"+date;
    const old=keep.get(key);
    if(!old){keep.set(key,c);continue}
    const oldTime=String(old.updatedAt||old.createdAt||"");
    const newTime=String(c.updatedAt||c.createdAt||"");
    if(newTime>oldTime){duplicates.push(old);keep.set(key,c)}
    else duplicates.push(c);
  }
  return {checks:[...keep.values()],duplicates};
}
function fillReportCameraFilter(checks,year){
  const select=$("reportCamera");if(!select)return "all";
  const current=select.value||"all";
  const cameras=[...new Set(checks.filter(c=>Number(c.reportYear)===year).map(c=>String(c.cameraNo||"").trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
  select.replaceChildren();
  const all=document.createElement("option");all.value="all";all.textContent="All cameras";select.append(all);
  for(const cam of cameras){const o=document.createElement("option");o.value=cam;o.textContent=cam;select.append(o)}
  select.value=cameras.includes(current)?current:"all";
  return select.value;
}
function bars(checks,year){
  const totals=Array(12).fill(0);
  for(const c of checks)if(Number(c.reportYear)===year){(c.monthlyPossum||[]).forEach((n,i)=>totals[i]+=Number(n)||0)}
  const max=Math.max(1,...totals),root=$("monthlyBars");if(!root)return;
  root.innerHTML=totals.map((n,i)=>"<div class='monthbar'><span>"+MONTHS[i]+"</span><div><i style='height:"+Math.max(3,Math.round(n/max*90))+"px'></i></div><b>"+n+"</b></div>").join("");
}
async function renderReport(){
  const status=$("reportStatus");if(!status)return;
  status.textContent="Loading camera checks…";
  const merged=await mergedChecks(),year=Number($("reportYear")?.value)||new Date().getFullYear();
  const deduped=dedupeCameraChecks(merged),checks=deduped.checks;
  const selectedCamera=fillReportCameraFilter(checks,year);
  const yearChecks=checks
    .filter(c=>Number(c.reportYear)===year&&(selectedCamera==="all"||String(c.cameraNo||"").trim()===selectedCamera))
    .sort(cameraSort);
  $("reportChecks").textContent=yearChecks.length.toLocaleString();
  $("reportPossums").textContent=yearChecks.reduce((a,c)=>a+(Number(c.totalPossum)||0),0).toLocaleString();
  $("reportDetections").textContent=yearChecks.reduce((a,c)=>a+(Number(c.meaningfulCount)||0),0).toLocaleString();
  $("reportSkipped").textContent=yearChecks.reduce((a,c)=>a+(Number(c.skippedCount)||0),0).toLocaleString();
  bars(yearChecks,year);
  const body=$("cameraReportBody");body.replaceChildren();
  for(const c of yearChecks.slice(0,250)){
    const tr=document.createElement("tr");
    const possumCell=Number(c.totalPossum)>0?"<button class='report-drilldown' type='button' title='Open possum images'>"+esc(c.totalPossum)+"</button>":"0";
    tr.innerHTML="<td><strong>"+esc(c.cameraNo)+"</strong></td><td>"+esc(c.zone)+"</td><td>"+esc(c.block)+"</td><td>"+esc(c.checkNo)+"</td><td>"+esc(c.checkedDate)+"</td><td>"+esc(c.servicedBy)+"</td><td>"+possumCell+"</td><td>"+esc(c.approxPresence||presenceFromCount(c.totalPossum))+"</td><td>"+esc(c.latestPossumDate||"")+"</td><td>"+esc(c.notes||"")+"</td><td>"+esc(c.issuesNotes||"")+"</td>";
    tr.querySelector(".report-drilldown")?.addEventListener("click",async()=>{
      const opened=await window.KaitiakiOpenCameraCheckGallery?.(c);
      if(opened==="mismatch-opened")status.textContent=c.cameraNo+" opened with an older image-link warning. Report count remains "+c.totalPossum+" possum images; the gallery may include extra saved links from another SD-card run.";
      else if(!opened)status.textContent="No exact saved possum previews found for "+c.cameraNo+" in this camera check. The count is still "+c.totalPossum+" possum image detections, not individual possums.";
    });
    body.append(tr);
    if(c.cameraNo)saveRegister(c.cameraNo,{zone:c.zone||"",block:c.block||"",status:c.status||"Active"});
  }
  const cameraText=selectedCamera==="all"?"":(" · "+selectedCamera);
  const duplicateCount=deduped.duplicates.filter(c=>Number(c.reportYear)===year&&(selectedCamera==="all"||String(c.cameraNo||"").trim()===selectedCamera)).length;
  status.textContent=yearChecks.length+" camera check"+(yearChecks.length===1?"":"s")+" shown for "+year+cameraText+"."+(duplicateCount?" "+duplicateCount+" older duplicate check"+(duplicateCount===1?" was":"s were")+" ignored.":"");
}
async function runReportAudit(){
  const button=$("runReportAudit"),status=$("reportAuditStatus"),body=$("reportAuditBody");
  if(!button||!status||!body)return;
  button.disabled=true;button.textContent="Checking…";status.textContent="Running read-only audit…";body.replaceChildren();
  try{
    if(!navigator.onLine)throw Error("Connect to the internet before running the shared audit.");
    if(!token())throw Error("Team access token is missing on this device. Reconnect Team access, then try again.");
    const merged=await mergedChecks(),year=Number($("reportYear")?.value)||new Date().getFullYear();
    const selectedCamera=$("reportCamera")?.value||"all";
    const cameraNos=[...new Set(merged.filter(c=>Number(c.reportYear||String(c.checkedDate||"").slice(0,4))===year&&(selectedCamera==="all"||String(c.cameraNo||"").trim()===selectedCamera)).map(c=>String(c.cameraNo||"").trim().toUpperCase()).filter(Boolean))];
    if(!cameraNos.length)throw Error("No camera checks found for the selected year and camera.");
    const res=await fetch(endpoint()+"/team/camera-check-audit",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({token:token(),cameraNos})});
    const data=await res.json();if(!res.ok||data.sharedReady!==true)throw Error(data.error||("Worker returned "+res.status));
    const checks=(data.checks||[]).filter(c=>Number(c.reportYear)===year&&(selectedCamera==="all"||String(c.cameraNo||"").trim()===selectedCamera));
    for(const c of checks){
      const tr=document.createElement("tr");
      const vals=[c.cameraNo,"#"+c.checkNo,c.checkedDate,c.reportYear,c.reportImages,c.linkedPossumRecords,c.datedPossumRecords,c.capturedInReportYear,c.capturedOutsideReportYear,c.missingCaptureDate,c.reportVsDatedDelta];
      for(const value of vals){const td=document.createElement("td");td.textContent=value??"—";tr.append(td)}
      body.append(tr);
    }
    status.textContent="Read-only audit complete: "+checks.length+" camera checks inspected. No shared records or report totals were changed.";
     const recovery=(data.recoveryCandidates||[]).filter(c=>String(c.cameraNo||"").toUpperCase()==="OXIC1");
     const detail=document.getElementById("reportAuditDetails");
     if(detail){
       detail.replaceChildren();
       const heading=document.createElement("p");heading.className="sub";
       heading.textContent="OXIC1 missing-date recovery clues (read-only): "+recovery.length+" candidate records. Exact image matches are clues only; no dates have been copied.";
       detail.append(heading);
       const table=document.createElement("table");table.className="report-table";
       const thead=document.createElement("thead"),hr=document.createElement("tr");
       ["Missing-date filename","Path","Record created","Dated filename match","Match type","Exact image bytes","Time gap (seconds)"].forEach(v=>{const th=document.createElement("th");th.textContent=v;hr.append(th)});
       thead.append(hr);table.append(thead);const tbody=document.createElement("tbody");
       for(const c of recovery){
         const matches=c.matches||[];
         if(!matches.length){const tr=document.createElement("tr");[c.fileName,c.relativePath,c.recordCreatedAt,"No dated filename match","—","—","—"].forEach(v=>{const td=document.createElement("td");td.textContent=v||"—";tr.append(td)});tbody.append(tr);continue}
         for(const m of matches){const tr=document.createElement("tr");[c.fileName,c.relativePath,c.recordCreatedAt,m.fileName,m.matchType,m.exactImageBytesMatch?"YES":(m.hasStoredImage&&c.hasStoredImage?"NO":"Not available"),m.creationGapSeconds??"—"].forEach(v=>{const td=document.createElement("td");td.textContent=v??"—";tr.append(td)});tbody.append(tr)}
       }
       table.append(tbody);detail.append(table);
       const linked=(data.oxic1LinkedRecordDetails||[]).filter(r=>String(r.cameraNo||"").toUpperCase()==="OXIC1");
       const linkedHeading=document.createElement("p");linkedHeading.className="sub";
       linkedHeading.textContent="OXIC1 linked possum records (read-only): showing "+linked.length+" of "+(data.oxic1LinkedRecordCount??linked.length)+" records returned by the audit. No records changed.";
       detail.append(linkedHeading);
       const linkedTable=document.createElement("table");linkedTable.className="report-table";
       const linkedHead=document.createElement("thead"),linkedHr=document.createElement("tr");
       ["Check #","Check date","Capture date","Filename","Status","Record ID","Camera-check link"].forEach(v=>{const th=document.createElement("th");th.textContent=v;linkedHr.append(th)});
       linkedHead.append(linkedHr);linkedTable.append(linkedHead);const linkedBody=document.createElement("tbody");
       for(const r of linked){
         const tr=document.createElement("tr");
         [r.checkNo==null?"—":"#"+r.checkNo,r.checkedDate||"—",r.capturedAt||"MISSING",r.fileName||"—",r.status||"—",r.recordId||"—",r.cameraCheckId||"—"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td)});
         linkedBody.append(tr);
       }
       linkedTable.append(linkedBody);detail.append(linkedTable);
     }
    if(!checks.length)status.textContent="Audit completed, but no checks matched the selected year/camera. Try All cameras or another year.";
  }catch(e){status.textContent="Audit failed: "+String(e.message||e)}
  finally{button.disabled=false;button.textContent="Check report count breakdown"}
}
async function exportReport(){
  const merged=await mergedChecks(),checks=dedupeCameraChecks(merged).checks,year=Number($("reportYear")?.value)||new Date().getFullYear(),camera=$("reportCamera")?.value||"all";
  const data=checks.filter(c=>Number(c.reportYear)===year&&(camera==="all"||String(c.cameraNo||"").trim()===camera)).sort(cameraSort);
  const head=["Camera No'","Zones","Blocks","Status","Check No'","Checked date (in the field)","Serviced by","Classified date","Date of first image (if matching expected FIRST date)","Date of last image (if matching expected LAST date)","Approx possum presence","Most recent possum sighting","Classified by",...MONTHS.map(m=>m+" "+year),"Total "+year,"Notes","Issues notes"];
  const lines=[head.map(csv).join(",")];
  for(const c of data){
    const months=Array.from({length:12},(_,i)=>Number(c.monthlyPossum?.[i])||0);
    lines.push([c.cameraNo,c.zone,c.block,c.status,c.checkNo,c.checkedDate,c.servicedBy,c.classifiedDate,c.firstImageDate,c.lastImageDate,c.approxPresence||presenceFromCount(c.totalPossum),c.latestPossumDate||"",c.classifiedBy,...months,c.totalPossum,c.notes,c.issuesNotes].map(csv).join(","));
  }
  const url=URL.createObjectURL(new Blob(["\ufeff",lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="Kaitiaki_Camera_Check_Data_"+year+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function initYears(){
  const y=$("reportYear");if(!y)return;const now=new Date().getFullYear();
  for(let n=now-2;n<=now+1;n++){const o=document.createElement("option");o.value=n;o.textContent=n;if(n===now)o.selected=true;y.append(o)}
}
$("cameraNo")?.addEventListener("change",applyCameraMeta);
$("cameraNo")?.addEventListener("blur",applyCameraMeta);
$("startCameraCheck")?.addEventListener("click",startCheck);
$("cancelCameraCheck")?.addEventListener("click",cancelCheck);
$("finishCameraCheck")?.addEventListener("click",finishCheck);
$("refreshReport")?.addEventListener("click",renderReport);
$("runReportAudit")?.addEventListener("click",runReportAudit);
$("exportCameraReport")?.addEventListener("click",exportReport);
$("reportYear")?.addEventListener("change",renderReport);
$("reportCamera")?.addEventListener("change",renderReport);
window.KaitiakiLoadCameraReport=renderReport;
fillCameraList();renderCurrent();initYears();if($("cameraCheckedDate")&&!$("cameraCheckedDate").value)$("cameraCheckedDate").value=today();setTimeout(backfillExistingChecks,500);
})();
