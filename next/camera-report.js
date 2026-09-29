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
  try{
    const db=await openDB();let rows;try{rows=await allRows(db)}finally{db.close()}
    const linked=rows.filter(r=>r.cameraCheckId===c.id);
    if(!linked.length){$("cameraCheckStatusText").textContent="No imported images are attached to this camera check yet.";return}
    const processed=linked.filter(r=>r.aiPrediction);
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
    saveCurrent(null);renderReport();
    $("cameraCheckStatusText").textContent="Camera check saved: "+report.cameraNo+" · "+report.meaningfulCount+" meaningful detections · "+report.skippedCount+" empty/vegetation frames skipped.";
  }catch(e){$("cameraCheckStatusText").textContent="Could not finish camera check: "+String(e.message||e)}
  finally{btn.disabled=false}
}

async function backfillExistingChecks(){
  const checks=localChecks();if(!checks.length)return;
  let db,rows=[];try{db=await openDB();rows=await allRows(db)}catch{return}finally{db?.close()}
  let changed=false;
  for(const c of checks){
    const linked=rows.filter(r=>r.cameraCheckId===c.id&&r.aiPrediction);
    if(!linked.length)continue;
    const meaningful=linked.filter(r=>!isSkipped(r));
    const possums=meaningful.filter(r=>effectiveLabel(r)==="Possum");
    const year=Number(c.reportYear||String(c.checkedDate||today()).slice(0,4))||new Date().getFullYear();
    const monthly=Array(12).fill(0),dates=[];
    for(const r of possums){const d=new Date(r.capturedAt||r.lastModified||0);if(!Number.isNaN(d.getTime())){dates.push(d);if(d.getFullYear()===year)monthly[d.getMonth()]++}}
    dates.sort((a,b)=>a-b);const total=monthly.reduce((a,n)=>a+n,0);
    const latest=dates.length?dateOnly(dates.at(-1).toISOString()):"";
    if(c.latestPossumDate!==latest||c.approxPresence!==presenceFromCount(total)||Number(c.totalPossum)!==total){
      c.latestPossumDate=latest;c.approxPresence=presenceFromCount(total);c.totalPossum=total;c.monthlyPossum=monthly;c.updatedAt=new Date().toISOString();saveLocalCheck(c);syncCheck(c);changed=true;
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

function bars(checks,year){
  const totals=Array(12).fill(0);
  for(const c of checks)if(Number(c.reportYear)===year){(c.monthlyPossum||[]).forEach((n,i)=>totals[i]+=Number(n)||0)}
  const max=Math.max(1,...totals),root=$("monthlyBars");if(!root)return;
  root.innerHTML=totals.map((n,i)=>"<div class='monthbar'><span>"+MONTHS[i]+"</span><div><i style='height:"+Math.max(3,Math.round(n/max*90))+"px'></i></div><b>"+n+"</b></div>").join("");
}
async function renderReport(){
  const status=$("reportStatus");if(!status)return;
  status.textContent="Loading camera checks…";
  const checks=await mergedChecks(),year=Number($("reportYear")?.value)||new Date().getFullYear();
  const yearChecks=checks.filter(c=>Number(c.reportYear)===year);
  $("reportChecks").textContent=yearChecks.length.toLocaleString();
  $("reportPossums").textContent=yearChecks.reduce((a,c)=>a+(Number(c.totalPossum)||0),0).toLocaleString();
  $("reportDetections").textContent=yearChecks.reduce((a,c)=>a+(Number(c.meaningfulCount)||0),0).toLocaleString();
  $("reportSkipped").textContent=yearChecks.reduce((a,c)=>a+(Number(c.skippedCount)||0),0).toLocaleString();
  bars(checks,year);
  const body=$("cameraReportBody");body.replaceChildren();
  for(const c of yearChecks.slice(0,250)){
    const tr=document.createElement("tr");
    tr.innerHTML="<td>"+esc(c.cameraNo)+"</td><td>"+esc(c.zone)+"</td><td>"+esc(c.block)+"</td><td>"+esc(c.checkNo)+"</td><td>"+esc(c.checkedDate)+"</td><td>"+esc(c.servicedBy)+"</td><td>"+esc(c.totalPossum)+"</td><td>"+esc(c.approxPresence||presenceFromCount(c.totalPossum))+"</td><td>"+esc(c.latestPossumDate||"")+"</td><td>"+esc(c.notes||"")+"</td><td>"+esc(c.issuesNotes||"")+"</td>";
    body.append(tr);
    if(c.cameraNo)saveRegister(c.cameraNo,{zone:c.zone||"",block:c.block||"",status:c.status||"Active"});
  }
  status.textContent=yearChecks.length+" camera check"+(yearChecks.length===1?"":"s")+" shown for "+year+".";
}
async function exportReport(){
  const checks=await mergedChecks(),year=Number($("reportYear")?.value)||new Date().getFullYear();
  const data=checks.filter(c=>Number(c.reportYear)===year);
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
$("exportCameraReport")?.addEventListener("click",exportReport);
$("reportYear")?.addEventListener("change",renderReport);
window.KaitiakiLoadCameraReport=renderReport;
fillCameraList();renderCurrent();initYears();if($("cameraCheckedDate")&&!$("cameraCheckedDate").value)$("cameraCheckedDate").value=today();setTimeout(backfillExistingChecks,500);
})();
