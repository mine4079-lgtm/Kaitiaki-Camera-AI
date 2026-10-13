/* Shared team sightings UI + background sync. */
(()=>{"use strict";
const $=id=>document.getElementById(id);
const DB_NAME="kaitiaki-next-v1",STORE="image-records";
const URL_KEY="kaitiaki-next-cloud-endpoint";
const TOKEN_KEY="kaitiaki-next-session-token";
const PERSIST_TOKEN_KEY="kaitiaki-next-device-token";
const DEVICE_ID_KEY="kaitiaki-device-id";
const PENDING_KEY="kaitiaki-shared-pending";
const SYNCED_KEY="kaitiaki-shared-synced-v3";
const PESTS=["Possum","Rat","Stoat","Mouse","Deer","Pig"];
let imageUrls=[];
let galleryRecords=[],galleryIndex=0,galleryKind="sighting",localGalleryUrl=null,galleryWarning="",galleryRepairCheck=null,visibleSharedReviewRecords=[];
let selectedSightingsCameras=null,visibleSightingsRecords=[];

function endpoint(){return (localStorage.getItem(URL_KEY)||"https://kaitiaki-next-vision.monaghan666.workers.dev").replace(/\/+$/,"")}
function token(){return localStorage.getItem(PERSIST_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||""}
function deviceId(){return localStorage.getItem(DEVICE_ID_KEY)||""}
function teamBody(extra={}){return JSON.stringify({token:token(),...extra})}
function candidate(r){
  if(r.aiSkipped||r.aiPrediction==="Empty image")return false;
  if(r.verified)return true;
  if(r.aiPrediction==="Unsure"||r.aiNeedsExtraReview)return true;
  return (PESTS.includes(r.aiPrediction)&&Number(r.aiConfidence)>=85) || (!!r.aiPrediction&&Number(r.aiConfidence)<85);
}
function pending(){try{return new Set(JSON.parse(localStorage.getItem(PENDING_KEY)||"[]"))}catch{return new Set()}}
function syncedMap(){try{return JSON.parse(localStorage.getItem(SYNCED_KEY)||"{}")}catch{return {}}}
function markSynced(record){const m=syncedMap();m[record.key]=record.updatedAt||"";const entries=Object.entries(m).slice(-2500);localStorage.setItem(SYNCED_KEY,JSON.stringify(Object.fromEntries(entries)))}
function needsSync(record){const m=syncedMap();return m[record.key]!==String(record.updatedAt||"")}
function savePending(set){localStorage.setItem(PENDING_KEY,JSON.stringify([...set].slice(-2000)))}
function markPending(key){const set=pending();set.add(key);savePending(set)}
function clearPending(key){const set=pending();set.delete(key);savePending(set)}
function blobToDataURL(blob){return new Promise((ok,no)=>{if(!(blob instanceof Blob)){ok(null);return}const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(blob)})}
function openDB(){return new Promise((ok,no)=>{const q=indexedDB.open(DB_NAME,1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function getRow(db,key){return new Promise((ok,no)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).get(key);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function getAllRows(db){return new Promise((ok,no)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}

async function syncRecord(record,preview){
  if(!record?.key||!candidate(record))return;
  if(!navigator.onLine||!token()){markPending(record.key);return}
  try{
    const image=await blobToDataURL(preview||record.preview);
    const body={record:{...record,syncId:(record.deviceId||deviceId()||"device")+"|"+record.key},image};
    const res=await fetch(endpoint()+"/team/sync",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody(body)});
    if(!res.ok)throw Error("sync "+res.status);
    clearPending(record.key);
    markSynced(record);
  }catch{markPending(record.key)}
}
window.KaitiakiSharedSync=syncRecord;
window.KaitiakiSharedSyncMetadataIfChanged=async record=>{if(!record?.key||!needsSync(record))return false;return syncRecordMetadata(record)};

async function syncRecordMetadata(record){
  if(!record?.key||!navigator.onLine||!token())return false;
  try{
    const body={record:{...record,syncId:(record.deviceId||deviceId()||"device")+"|"+record.key},image:null};
    const res=await fetch(endpoint()+"/team/sync",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody(body)});
    if(!res.ok)throw Error("sync "+res.status);
    clearPending(record.key);markSynced(record);return true;
  }catch{markPending(record.key);return false}
}

async function reconcileCompletedLocalReview(){
  if(!navigator.onLine||!token())return 0;
  let db,rows=[];
  try{db=await openDB();rows=await getAllRows(db)}catch{return 0}finally{db?.close()}
  let n=0;
  for(const row of rows){
    if(!row?.verified)continue;
    if(await syncRecordMetadata(row))n++;
  }
  return n;
}

async function flushPending(){
  if(!navigator.onLine||!token())return;
  const keys=[...pending()];if(!keys.length)return;
  let db;
  try{
    db=await openDB();
    for(const key of keys){
      const row=await getRow(db,key);
      if(!row){clearPending(key);continue}
      await syncRecord(row,row.preview);
    }
  }finally{db?.close()}
}
window.addEventListener("online",()=>setTimeout(()=>{flushPending();catchUpExisting()},500));
async function catchUpExisting(){
  if(!navigator.onLine||!token())return;
  try{
    const ready=await fetch(endpoint(),{cache:"no-store"}).then(r=>r.json());
    if(!ready.sharedReady)return;
    const db=await openDB();
    try{
      const rows=await getAllRows(db);
      for(const row of rows){
        if(candidate(row)&&needsSync(row))await syncRecord(row,row.preview);
      }
    }finally{db.close()}
  }catch{}
}
setTimeout(()=>{flushPending();catchUpExisting()},1200);

function clearImages(){for(const u of imageUrls)URL.revokeObjectURL(u);imageUrls=[]}
async function loadImage(id,img){
  try{
    const res=await fetch(endpoint()+"/team/image",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({id})});
    const data=await res.json();
    if(!res.ok||!data.imageData)throw Error(data.error||"Shared image unavailable");
    img.src=data.imageData;
  }catch{
    const p=document.createElement("div");p.className="placeholder";p.textContent="Shared image unavailable";img.replaceWith(p);
  }
}
function esc(s){return String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function niceDate(v){if(!v)return"";try{return new Date(v).toLocaleString()}catch{return v}}
function recordLabel(r){return r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction}
function confirmationText(r,kind){
  if(r.human_verified)return "Human confirmed";
  if(kind==="sighting")return "AI accepted";
  return "Needs human review";
}
function confirmerText(r,kind){
  if(r.human_verified)return r.reviewer_name||"Team member";
  if(kind==="sighting")return r.imported_by?("AI accepted · imported by "+r.imported_by):"AI accepted";
  return r.imported_by?("Imported by "+r.imported_by):"Not confirmed yet";
}
function galleryLinkAudit(records){
  const times=records.map(r=>new Date(r.captured_at||0).getTime()).filter(Number.isFinite).filter(t=>t>0).sort((a,b)=>a-b);
  const imports=records.map(r=>r.imported_at||r.created_at||"").filter(Boolean);
  const batches=new Set(imports.map(v=>{const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toISOString().slice(0,16)}));
  const ids=new Set(records.map(r=>String(r.camera_check_id||r.cameraCheckId||"").trim()).filter(Boolean));
  const signatures=new Map();
  for(const r of records){
    const sig=String(r.file_name||r.name||"").trim().toLowerCase()+"|"+String(r.captured_at||r.capturedAt||"").trim();
    if(sig!=="|")signatures.set(sig,(signatures.get(sig)||0)+1);
  }
  const duplicates=[...signatures.values()].filter(n=>n>1).reduce((n,v)=>n+v-1,0);
  const first=times.length?new Date(times[0]).toLocaleString():"not recorded";
  const last=times.length?new Date(times[times.length-1]).toLocaleString():"not recorded";
  const importTimes=imports.map(v=>new Date(v).getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
  const importRange=importTimes.length?new Date(importTimes[0]).toLocaleString()+" to "+new Date(importTimes[importTimes.length-1]).toLocaleString():"not recorded";
  return "Linked records inspected: "+records.length+
    "\nCapture range: "+first+" to "+last+
    "\nRecord creation range: "+importRange+
    "\nApproximate import/creation batches (per minute): "+batches.size+
    "\nExact duplicate filename + capture-time candidates: "+duplicates+
    "\nDistinct linked camera-check IDs in this viewer: "+(ids.size||"not supplied")+
    (duplicates?"\nDuplicate candidates need checking before any unlinking.":"\nNo exact filename-and-capture-time duplicates detected. This does not rule out incorrect links.");
}
async function showGalleryRecord(){
  const dlg=$("sharedImageDialog");if(!dlg||!galleryRecords.length)return;
  const r=galleryRecords[galleryIndex],label=recordLabel(r)||"Needs review";
  $("sharedDialogTitle").textContent=(r.camera_no?r.camera_no+" · ":"")+label;
  $("sharedMetaCamera").textContent=r.camera_no||"Not recorded";
  $("sharedMetaCaptured").textContent=niceDate(r.captured_at)||"Not recorded";
  $("sharedMetaClass").textContent=confirmationText(r,galleryKind)+(label?" · "+label:"");
  $("sharedMetaWho").textContent=confirmerText(r,galleryKind);
  $("sharedMetaAi").textContent=(r.ai_prediction||"No AI result")+(r.ai_confidence!=null?" · "+r.ai_confidence+"%":"")+(r.ai_second_choice?" · second: "+r.ai_second_choice:"");
  $("sharedMetaFile").textContent=r.file_name||"";
  $("sharedMetaImported").textContent=niceDate(r.imported_at||r.created_at)||"Not recorded";
  $("sharedMetaProcessed").textContent=niceDate(r.ai_checked_at||r.updated_at)||"Not recorded";
  $("sharedMetaNote").textContent=(galleryWarning?galleryWarning+"\n\n":"")+(r.ai_note||"No description available.");
  const audit=$("sharedLinkAudit");
  if(audit&&galleryWarning&&galleryRecords.length>1){audit.style.display="block";audit.textContent=galleryLinkAudit(galleryRecords)}
  else if(audit){audit.style.display="none";audit.textContent=""}
  $("sharedPosition").textContent=(galleryIndex+1)+" of "+galleryRecords.length;
  $("sharedPrev").disabled=galleryRecords.length<2;
  $("sharedNext").disabled=galleryRecords.length<2;
  const img=$("sharedLarge");if(localGalleryUrl){URL.revokeObjectURL(localGalleryUrl);localGalleryUrl=null}img.removeAttribute("src");img.alt=label+" trail-camera image";
  if(r._localPreview instanceof Blob){
    localGalleryUrl=URL.createObjectURL(r._localPreview);img.src=localGalleryUrl;
  }else if(r.has_image){
    try{
      const res=await fetch(endpoint()+"/team/image",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({id:r.id})});
      const data=await res.json();if(!res.ok||!data.imageData)throw Error();
      if(galleryRecords[galleryIndex]?.id===r.id)img.src=data.imageData;
    }catch{if(galleryRecords[galleryIndex]?.id===r.id)img.alt="Shared image unavailable"}
  }
}
function openSharedGallery(records,index,kind,warning="",repairCheck=null){
  galleryRecords=records;galleryIndex=index;galleryKind=kind;galleryWarning=warning;galleryRepairCheck=repairCheck;
  const repair=$("sharedRepair");if(repair)repair.hidden=!repairCheck;
  $("sharedImageDialog")?.showModal();showGalleryRecord();
}
$("closeSharedDialog")?.addEventListener("click",()=>{$("sharedImageDialog")?.close();galleryRepairCheck=null;const repair=$("sharedRepair");if(repair)repair.hidden=true;if(localGalleryUrl){URL.revokeObjectURL(localGalleryUrl);localGalleryUrl=null}});
$("sharedPrev")?.addEventListener("click",()=>{if(!galleryRecords.length)return;galleryIndex=(galleryIndex-1+galleryRecords.length)%galleryRecords.length;showGalleryRecord()});
$("sharedNext")?.addEventListener("click",()=>{if(!galleryRecords.length)return;galleryIndex=(galleryIndex+1)%galleryRecords.length;showGalleryRecord()});


async function repairCameraCheckLinks(check){
  if(!check?.id)return {ok:false,message:"Repair stopped: this camera check has no saved ID."};
  const expected=Number(check.totalPossum)||0,year=Number(check.reportYear)||new Date().getFullYear();
  if(expected<1)return {ok:false,message:"Repair stopped: this report does not have a possum-image count to keep."};

  const db=await openDB();let rows=[];try{rows=await getAllRows(db)}finally{db.close()}
  const linkedPossums=rows.filter(r=>{
    if(r.cameraCheckId!==check.id)return false;
    const label=r.verified?r.label:r.aiPrediction;
    if(label!=="Possum")return false;
    const d=new Date(r.capturedAt||r.lastModified||0);
    return !Number.isNaN(d.getTime())&&d.getFullYear()===year;
  }).sort((a,b)=>{
    const ad=new Date(a.capturedAt||a.lastModified||0).getTime();
    const bd=new Date(b.capturedAt||b.lastModified||0).getTime();
    return ad-bd||String(a.key).localeCompare(String(b.key));
  });

  if(linkedPossums.length<=expected){
    return {ok:true,message:check.cameraNo+" already has "+linkedPossums.length+" linked possum image"+(linkedPossums.length===1?"":"s")+". Nothing to remove.",removed:0};
  }

  const keep=new Set(linkedPossums.slice(0,expected).map(r=>r.key));
  const extras=linkedPossums.filter(r=>!keep.has(r.key));
  const now=new Date().toISOString();
  const updates=extras.map(r=>({...r,cameraCheckId:"",checkNo:"",checkedDate:"",servicedBy:"",updatedAt:now}));

  const db2=await openDB();try{
    await new Promise((ok,no)=>{const t=db2.transaction(STORE,"readwrite"),st=t.objectStore(STORE);for(const r of updates)st.put(r);t.oncomplete=ok;t.onerror=()=>no(t.error)});
  }finally{db2.close()}

  for(const r of updates)syncRecord(r,r.preview);
  return {ok:true,message:"Repaired "+check.cameraNo+". Kept "+expected+" possum images and unlinked "+extras.length+" extras. No image previews or classifications were deleted.",removed:extras.length};
}

$("sharedRepair")?.addEventListener("click",async()=>{
  const btn=$("sharedRepair"),check=galleryRepairCheck;if(!btn||!check)return;
  btn.disabled=true;btn.textContent="Keeping report count…";
  try{
    const result=await repairCameraCheckLinks(check);
    galleryWarning=result.message;
    $("sharedMetaNote").textContent=result.message+"\n\n"+(galleryRecords[galleryIndex]?.ai_note||"No description available.");
    alert(result.message);
    if(result.ok&&result.removed>0){
      $("sharedImageDialog")?.close();
      galleryRepairCheck=null;
      setTimeout(()=>window.KaitiakiOpenCameraCheckGallery(check),50);
    }else if(result.ok){
      btn.hidden=true;
    }
  }catch(e){
    const message="Repair failed safely: "+String(e.message||e)+". Nothing was deleted.";
    galleryWarning=message;$("sharedMetaNote").textContent=message;alert(message);
  }finally{btn.disabled=false;btn.textContent="Keep report count"}
});

async function sharedCameraChecks(){
  if(!navigator.onLine||!token())return [];
  try{
    const res=await fetch(endpoint()+"/team/camera-checks",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:1000})});
    const data=await res.json();if(!res.ok)return [];
    return data.checks||[];
  }catch{return []}
}
function dedupeSharedChecks(checks){
  const keep=new Map();
  for(const c of checks){
    const camera=String(c.cameraNo||"").trim().toUpperCase();
    const checkNo=Number(c.checkNo)||0;
    const date=String(c.checkedDate||"").trim();
    const key=(camera&&checkNo&&date)?camera+"|"+checkNo+"|"+date:"id:"+String(c.id||Math.random());
    const old=keep.get(key);
    if(!old||String(c.updatedAt||c.createdAt||"")>String(old.updatedAt||old.createdAt||""))keep.set(key,c);
  }
  return [...keep.values()];
}
function fillSightingsYear(checks){
  const select=$("sharedSightingsYear");if(!select)return new Date().getFullYear();
  const current=Number(select.value)||new Date().getFullYear();
  const years=[...new Set(checks.map(c=>Number(c.reportYear)).filter(Number.isFinite))].sort((a,b)=>b-a);
  if(!years.length)years.push(new Date().getFullYear());
  select.replaceChildren();
  for(const y of years){const o=document.createElement("option");o.value=String(y);o.textContent=String(y);select.append(o)}
  select.value=years.includes(current)?String(current):String(years[0]);
  return Number(select.value);
}
function checkKey(c){return String(c.cameraNo||"").trim().toUpperCase()+"|"+(Number(c.checkNo)||0)+"|"+String(c.checkedDate||"").trim()}
async function knownSharedCameras(records){
  const names=new Set(records.map(r=>String(r.camera_no||"").trim().toUpperCase()).filter(Boolean));
  try{
    const reg=JSON.parse(localStorage.getItem("kaitiaki-camera-register-v1")||"{}");
    for(const c of Object.values(reg||{}))if(c?.cameraNo)names.add(String(c.cameraNo).trim().toUpperCase());
  }catch{}
  try{
    const checks=JSON.parse(localStorage.getItem("kaitiaki-camera-checks-v1")||"[]");
    for(const c of checks||[])if(c?.cameraNo)names.add(String(c.cameraNo).trim().toUpperCase());
  }catch{}
  if(navigator.onLine&&token()){
    try{
      const res=await fetch(endpoint()+"/team/camera-checks",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:1000})});
      const data=await res.json();
      if(res.ok)for(const c of data.checks||[])if(c?.cameraNo)names.add(String(c.cameraNo).trim().toUpperCase());
    }catch{}
  }
  return [...names].filter(Boolean).sort();
}
async function fillSharedCameraFilter(kind,records){
  const cameras=await knownSharedCameras(records);
  if(kind==="sighting"){
    const root=$("sharedSightingsCameraList"),summary=$("sharedSightingsCameraSummary");
    if(!root)return null;
    if(selectedSightingsCameras instanceof Set){
      selectedSightingsCameras=new Set([...selectedSightingsCameras].filter(c=>cameras.includes(c)));
    }
    root.replaceChildren();
    for(const cam of cameras){
      const label=document.createElement("label"),cb=document.createElement("input");
      cb.type="checkbox";cb.value=cam;cb.checked=selectedSightingsCameras===null||selectedSightingsCameras.has(cam);
      cb.addEventListener("change",()=>{
        const checked=[...root.querySelectorAll("input:checked")].map(x=>x.value);
        selectedSightingsCameras=checked.length===cameras.length?null:new Set(checked);
        if(summary)summary.textContent=selectedSightingsCameras===null?"All cameras":checked.length+" selected";
        loadShared("sighting");
      });
      label.append(cb,document.createTextNode(cam));root.append(label);
    }
    const count=selectedSightingsCameras===null?cameras.length:selectedSightingsCameras.size;
    if(summary)summary.textContent=selectedSightingsCameras===null?"All cameras":count+" selected";
    return selectedSightingsCameras;
  }
  const select=$("sharedReviewCamera");if(!select)return "all";
  const current=select.value||"all";
  select.replaceChildren();
  const all=document.createElement("option");all.value="all";all.textContent="All cameras";select.append(all);
  for(const cam of cameras){const o=document.createElement("option");o.value=cam;o.textContent=cam;select.append(o)}
  select.value=cameras.includes(current)?current:"all";
  return select.value;
}

async function loadShared(kind){
  const root=$(kind==="sighting"?"sharedSightings":"sharedReview");
  const status=$(kind==="sighting"?"sharedSightingsStatus":"sharedReviewStatus");
  if(!root||!status)return;
  clearImages();
  if(!navigator.onLine){status.textContent="Offline — shared records need internet. Your local Review still works.";return}
  if(!token()){status.textContent="Connect AI once on this device to open shared team records.";return}
  if(kind==="review"){
    status.textContent="Updating completed local reviews…";
    await reconcileCompletedLocalReview();
  }
  status.textContent="Checking shared database…";
  try{const health=await fetch(endpoint(),{cache:"no-store"}).then(r=>r.json());if(!health.sharedReady)throw Error("Worker is online but D1 is not connected to it.")}catch(e){status.textContent="Shared connection problem: "+String(e.message||e);return}
  status.textContent="Loading shared team records…";
  try{
    const path=kind==="sighting"?"/team/sightings":"/team/review";
    const url=endpoint()+path;
    const res=await fetch(url,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:kind==="sighting"?500:150})});
    const data=await res.json();
    if(!res.ok||data.sharedReady!==true)throw Error(data.error||"Shared database not connected yet");
    root.replaceChildren();
    const speciesSelect=$(kind==="sighting"?"sharedSightingsSpecies":"sharedReviewSpecies");
    const chosenSpecies=speciesSelect?.value||"all";
    let baseRecords=(data.records||[]).filter(r=>r.ai_prediction!=="Empty image");
    let reportYear=null;
    if(kind==="sighting"){
      const checks=dedupeSharedChecks(await sharedCameraChecks());
      reportYear=fillSightingsYear(checks);
      const allowedChecks=checks.filter(c=>Number(c.reportYear)===reportYear);
      const allowedIds=new Set(allowedChecks.map(c=>String(c.id||"")).filter(Boolean));
      const allowedKeys=new Set(allowedChecks.map(checkKey));
      baseRecords=baseRecords.filter(r=>{
        const hasId=!!String(r.camera_check_id||"").trim();
        const byId=hasId&&allowedIds.has(String(r.camera_check_id));
        const byLegacyKey=!hasId&&allowedKeys.has(String(r.camera_no||"").trim().toUpperCase()+"|"+(Number(r.check_no)||0)+"|"+String(r.checked_date||"").trim());
        if(!byId&&!byLegacyKey)return false;
        if(!r.captured_at)return true;
        const d=new Date(r.captured_at);
        return Number.isNaN(d.getTime())||d.getFullYear()===reportYear;
      });
    }
    const chosenCamera=await fillSharedCameraFilter(kind,baseRecords);
    let records=baseRecords.filter(r=>{
      const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
      const speciesOK=chosenSpecies==="all"||label===chosenSpecies;
      const camera=String(r.camera_no||"").trim().toUpperCase();
      const cameraOK=kind==="sighting"?(chosenCamera===null||chosenCamera.has(camera)):(chosenCamera==="all"||camera===chosenCamera);
      return speciesOK&&cameraOK;
    });
    if(kind==="sighting"){
      const sort=$("sharedSightingsSort")?.value||"oldest";
      records=records.sort((a,b)=>{
        const av=new Date(a.captured_at||a.updated_at||0).getTime()||0,bv=new Date(b.captured_at||b.updated_at||0).getTime()||0;
        return sort==="newest"?bv-av:av-bv;
      });
      root.classList.toggle("time-view",($("sharedSightingsView")?.value||"grid")==="time");
    }else root.classList.remove("time-view");
    if(kind==="sighting")visibleSightingsRecords=records;
    if(kind==="review")visibleSharedReviewRecords=records;
    if(!records.length){
      if(kind==="sighting")visibleSightingsRecords=[];
      root.innerHTML='<div class="empty">No shared '+(kind==="sighting"?"pest sightings":"review items")+' yet.</div>';
      status.textContent="Up to date.";
      return;
    }
    for(const [recordIndex,r] of records.entries()){
      const card=document.createElement("button");card.type="button";card.className="item";card.addEventListener("click",()=>openSharedGallery(records,recordIndex,kind));
      if(r.has_image){
        const img=document.createElement("img");
        img.alt=(r.confirmed_label||r.ai_prediction||"Detection")+" trail-camera image";
        img.loading="lazy";card.append(img);loadImage(r.id,img);
      }else{
        const p=document.createElement("div");p.className="placeholder";p.textContent="No shared preview";card.append(p);
      }
      const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
      const who=r.reviewer_name||r.imported_by||"";
      const body=document.createElement("div");body.className="item-body";
      const confirm=confirmationText(r,kind),stamp=r.captured_at||r.verified_at||r.updated_at;
      let timeHtml="";
      if(kind==="sighting"&&stamp){
        const d=new Date(stamp);
        if(!Number.isNaN(d.getTime()))timeHtml="<small class='time-date'>"+esc(d.toLocaleDateString())+"</small><small class='time-stamp'>"+esc(d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}))+"</small>";
      }
      body.innerHTML="<strong>"+esc(r.camera_no||label||"Needs review")+"</strong>"+timeHtml+"<span class='kind "+(r.human_verified?"good":"")+"'>"+esc(confirm+(r.ai_confidence!=null&&!r.human_verified?" · "+r.ai_confidence+"%":""))+"</span><small>"+esc(label||"")+(r.file_name?" · "+esc(r.file_name):"")+"</small><small>"+esc(niceDate(stamp))+(who?" · "+esc(who):"")+"</small>";
      card.append(body);root.append(card);
    }
    let integrityNote="",integrityMismatches=[];
    if(kind==="sighting"){
      const checks=dedupeSharedChecks(await sharedCameraChecks()).filter(c=>Number(c.reportYear)===reportYear);
      const allowedIds=new Set(checks.map(c=>String(c.id||"").trim()).filter(Boolean));
      const possumCounts=new Map();
      const countedIds=new Set();
      const addPossumRecord=r=>{
        const id=String(r.camera_check_id||"").trim();
        if(!id||!allowedIds.has(id))return;
        const captured=String(r.captured_at||"");
        if(captured){
          const d=new Date(captured);
          if(!Number.isNaN(d.getTime())&&d.getFullYear()!==reportYear)return;
        }
        const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
        if(label!=="Possum"||countedIds.has(String(r.id||"")))return;
        countedIds.add(String(r.id||""));
        possumCounts.set(id,(possumCounts.get(id)||0)+1);
      };
      for(const r of baseRecords)addPossumRecord(r);
      // Report summaries include all processed Possum predictions, including low-confidence
      // candidates which intentionally remain in Team Review rather than Sightings.
      try{
        const reviewRes=await fetch(endpoint()+"/team/review",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:500})});
        const reviewData=await reviewRes.json();
        if(reviewRes.ok&&reviewData.sharedReady===true){
          for(const r of reviewData.records||[])addPossumRecord(r);
        }else throw Error("Review records unavailable for count comparison");
      }catch{
        integrityNote=" Count comparison incomplete because shared Review records could not be loaded.";
      }
      if(!integrityNote){
        integrityMismatches=checks.filter(c=>String(c.id||"").trim()&&Number(c.totalPossum||0)!==Number(possumCounts.get(String(c.id))||0))
          .map(c=>({...c,comparedPossums:Number(possumCounts.get(String(c.id))||0),difference:Number(c.totalPossum||0)-Number(possumCounts.get(String(c.id))||0)}))
          .sort((a,b)=>String(a.cameraNo||"").localeCompare(String(b.cameraNo||""),undefined,{numeric:true})||String(b.checkedDate||"").localeCompare(String(a.checkedDate||"")));
        if(integrityMismatches.length)integrityNote=" Warning: "+integrityMismatches.length+" camera checks have a possum-count mismatch. Details are listed below.";
      }
    }
    status.textContent=records.length+" shared "+(kind==="sighting"?"sighting":"review")+" record"+(records.length===1?"":"s")+" shown."+(kind==="sighting"&&reportYear?" Matched to "+reportYear+" finished camera checks.":"")+integrityNote;
    if(kind==="sighting"&&integrityMismatches.length){
      const panel=document.createElement("section");panel.className="integrity-mismatch-list";
      panel.style.cssText="display:block;width:100%;max-width:100%;box-sizing:border-box;overflow-x:auto;margin:12px 0 18px;padding:14px;border:1px solid #e6c98a;border-radius:12px;background:#fff8e8;color:#24332f";
      const heading=document.createElement("strong");heading.textContent="Camera checks to investigate";panel.append(heading);
      const intro=document.createElement("p");intro.textContent="These are image counts, not individual possums. A difference can mean missing links or an older check that needs reconciling.";panel.append(intro);
      const repairRow=document.createElement("div");repairRow.style.cssText="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 14px";
      const auditButton=document.createElement("button");auditButton.type="button";auditButton.textContent="Inspect link problems";
      const auditHelp=document.createElement("span");auditHelp.textContent="Read-only check of duplicate image links, missing dates and likely wrong check links. Does not change records.";
      auditHelp.style.cssText="font-size:13px";
      auditButton.addEventListener("click",async()=>{
        const cameras=[...new Set(integrityMismatches.map(c=>String(c.cameraNo||"").trim().toUpperCase()).filter(Boolean))];
        if(!cameras.length)return;
        auditButton.disabled=true;auditButton.textContent="Inspecting…";
        try{
          const res=await fetch(endpoint()+"/team/camera-check-audit",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({cameraNos:cameras})});
          const data=await res.json();
          if(!res.ok||data.sharedReady!==true)throw Error(data.error||("Worker returned "+res.status));
          const lines=["Read-only audit complete.","Cameras: "+cameras.join(", "),"Shared records inspected: "+data.recordsInspected,
            "Possum records inspected: "+data.possumsInspected,"Exact duplicate filename + capture-time candidates overall: "+data.exactDuplicateCandidates,
            "","Per camera check: report count | linked records | unique file/time signatures | duplicate candidates | missing capture date | date-rule would move"];
          for(const c of data.checks||[]){
            if(c.reportImages!==c.linkedPossumRecords||c.exactDuplicateCandidates||c.missingCaptureDate||c.dateRuleWouldMove){
              lines.push(c.cameraNo+" check "+c.checkNo+" ("+c.checkedDate+"): "+c.reportImages+" | "+c.linkedPossumRecords+" | "+c.uniqueFileTimeSignatures+" | "+c.exactDuplicateCandidates+" | "+c.missingCaptureDate+" | "+c.dateRuleWouldMove);
              for(const sample of (c.samples||[]).slice(0,3))lines.push("  "+(sample.fileName||"(no filename)")+" · "+(sample.capturedAt||"no capture date")+" · ID "+sample.recordId);
            }
          }
          lines.push("","Possum records without a valid linked check: "+data.orphan.totalPossum,
            "Missing capture date among those: "+data.orphan.missingCaptureDate,
            "No check link: "+data.orphan.noCheckLink,
            "No images or classifications were changed.");
          alert(lines.join("\n"));
        }catch(e){alert("Audit failed: "+String(e.message||e))}
        finally{auditButton.disabled=false;auditButton.textContent="Inspect link problems"}
      });
      repairRow.append(auditButton,auditHelp);panel.append(repairRow);
      const table=document.createElement("table");table.style.cssText="width:100%;border-collapse:collapse;font-size:14px";
      const thead=document.createElement("thead"),hr=document.createElement("tr");
      for(const label of ["Camera","Check","Checked","Report images","Matched images","Difference","Inspect"]){const th=document.createElement("th");th.textContent=label;th.style.cssText="text-align:left;padding:7px 5px;border-bottom:1px solid #e2d2ab";hr.append(th)}
      thead.append(hr);table.append(thead);
      const tbody=document.createElement("tbody");
      for(const c of integrityMismatches){
        const tr=document.createElement("tr");
        const vals=[c.cameraNo||"Unknown",String(c.checkNo||"—"),c.checkedDate||"—",String(Number(c.totalPossum||0)),String(c.comparedPossums),(c.difference>0?"+":"")+String(c.difference)];
        for(const val of vals){const td=document.createElement("td");td.textContent=val;td.style.cssText="padding:7px 5px;border-bottom:1px solid #eee0c4;vertical-align:top";tr.append(td)}
        const actionCell=document.createElement("td");actionCell.style.cssText="padding:7px 5px;border-bottom:1px solid #eee0c4;vertical-align:top";
        const inspect=document.createElement("button");inspect.type="button";inspect.textContent="View images";inspect.style.cssText="white-space:nowrap;cursor:pointer";
        inspect.addEventListener("click",async()=>{
          inspect.disabled=true;inspect.textContent="Opening…";
          try{
            if(typeof window.KaitiakiOpenCameraCheckGallery!=="function")throw Error("Image viewer is not available in this app version. Refresh and try again.");
            const opened=await window.KaitiakiOpenCameraCheckGallery(c);
            if(!opened)throw Error("No matching possum images could be opened for this check.");
          }catch(e){alert(String(e.message||e))}
          finally{inspect.disabled=false;inspect.textContent="View images"}
        });
        actionCell.append(inspect);tr.append(actionCell);tbody.append(tr);
      }
      table.append(tbody);panel.append(table);const integrityRoot=$("sharedSightingsIntegrity");if(integrityRoot)integrityRoot.replaceChildren(panel);
    }
  }catch(e){
    root.innerHTML='<div class="empty">Shared database not connected yet.</div>';
    status.textContent="Shared database error: "+String(e.message||e);
  }
}

window.KaitiakiOpenCameraCheckGallery=async(check)=>{
  if(!check?.cameraNo)return false;

  // On the device that processed the SD card, use the exact saved local records first.
  try{
    const db=await openDB();
    let rows=[];try{rows=await getAllRows(db)}finally{db.close()}
    const reportYear=Number(check.reportYear)||new Date().getFullYear();
    const local=rows.filter(r=>{
      if(r.cameraCheckId!==check.id)return false;
      const label=r.verified?r.label:r.aiPrediction;
      if(label!=="Possum")return false;
      const d=new Date(r.capturedAt||r.lastModified||0);
      return !Number.isNaN(d.getTime())&&d.getFullYear()===reportYear;
    }).sort((a,b)=>String(a.capturedAt||"").localeCompare(String(b.capturedAt||"")));
    if(local.length){
      const mismatch=Number(check.totalPossum)!==local.length;
      const records=local.map((r,i)=>({
        id:"local-"+i+"-"+r.key,
        camera_no:r.cameraNo||check.cameraNo,
        file_name:r.name||"",
        ai_prediction:r.aiPrediction||"",
        ai_confidence:r.aiConfidence??null,
        ai_second_choice:r.aiSecondChoice||"",
        ai_note:r.aiNote||"",
        confirmed_label:r.verified?r.label:"",
        human_verified:r.verified?1:0,
        reviewer_name:r.reviewedBy||"",
        imported_by:r.importedBy||"",
        captured_at:r.capturedAt||"",
        verified_at:r.verifiedAt||"",
        imported_at:r.createdAt||"",
        ai_checked_at:r.aiCheckedAt||"",
        updated_at:r.updatedAt||"",
        camera_check_id:r.cameraCheckId||"",
        relative_path:r.path||"",
        has_image:r.preview instanceof Blob?1:0,
        _localPreview:r.preview instanceof Blob?r.preview:null
      }));
      const warning=mismatch?"Report count: "+check.totalPossum+" possum images. "+local.length+" saved image links were found for this older check, so some may belong to another SD-card run.":"";
      openSharedGallery(records,0,"sighting",warning,mismatch?check:null);return mismatch?"mismatch-opened":true;
    }
  }catch{}

  // Other team devices use the shared D1 copy for the exact camera check.
  if(!navigator.onLine||!token())return false;
  try{
    const res=await fetch(endpoint()+"/team/sightings",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:500,cameraCheckId:check.id,cameraNo:check.cameraNo})});
    const data=await res.json();if(!res.ok||data.sharedReady!==true)throw Error();
    const reportYear=Number(check.reportYear)||new Date().getFullYear();
    const records=(data.records||[]).filter(r=>{
      const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
      if(label!=="Possum"||!r.captured_at)return false;
      const d=new Date(r.captured_at);
      return !Number.isNaN(d.getTime())&&d.getFullYear()===reportYear;
    });
    if(!records.length)return false;
    const mismatch=Number(check.totalPossum)!==records.length;
    const warning=mismatch?"Report count: "+check.totalPossum+" possum images. "+records.length+" shared image links were found for this older check, so some may belong to another SD-card run.":"";
    openSharedGallery(records,0,"sighting",warning);return mismatch?"mismatch-opened":true;
  }catch{return false}
};

function csvCell(v){
  const t=String(v??"");
  return /[",\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
}
function exportVisibleSightingsCsv(){
  const rows=visibleSightingsRecords||[];
  const status=$("sharedSightingsStatus");
  if(!rows.length){if(status)status.textContent="No visible sightings to export.";return}
  const year=$("sharedSightingsYear")?.value||"all";
  const species=$("sharedSightingsSpecies")?.value||"all";
  const head=["Camera","Species","Capture date","Capture time","Captured at","Check No","Checked date","AI suggestion","AI confidence","Human confirmed","Confirmed label","Confirmed by","Imported by","File name"];
  const lines=[head.map(csvCell).join(",")];
  for(const r of rows){
    const stamp=r.captured_at||"";
    let date="",time="";
    if(stamp){
      const d=new Date(stamp);
      if(!Number.isNaN(d.getTime())){date=d.toLocaleDateString();time=d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}
    }
    const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
    lines.push([
      r.camera_no||"",label||"",date,time,stamp,r.check_no||"",r.checked_date||"",
      r.ai_prediction||"",r.ai_confidence??"",r.human_verified?"Yes":"No",r.confirmed_label||"",
      r.reviewer_name||"",r.imported_by||"",r.file_name||""
    ].map(csvCell).join(","));
  }
  const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  const safeSpecies=String(species).replace(/[^A-Za-z0-9_-]+/g,"-");
  a.href=url;a.download="kaitiaki-sightings-"+year+"-"+safeSpecies+".csv";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(status)status.textContent="Exported "+rows.length+" visible sighting"+(rows.length===1?"":"s")+" to CSV.";
}
window.KaitiakiLoadSharedSightings=()=>loadShared("sighting");
window.KaitiakiLoadSharedReview=()=>loadShared("review");
$("refreshSightings")?.addEventListener("click",window.KaitiakiLoadSharedSightings);
$("exportSightingsCsv")?.addEventListener("click",exportVisibleSightingsCsv);
$("refreshSharedReview")?.addEventListener("click",window.KaitiakiLoadSharedReview);
$("sharedSightingsSpecies")?.addEventListener("change",window.KaitiakiLoadSharedSightings);
$("sharedSightingsYear")?.addEventListener("change",window.KaitiakiLoadSharedSightings);
$("sharedSightingsSort")?.addEventListener("change",window.KaitiakiLoadSharedSightings);
$("sharedSightingsView")?.addEventListener("change",window.KaitiakiLoadSharedSightings);
$("sharedSightingsSelectAll")?.addEventListener("click",()=>{selectedSightingsCameras=null;window.KaitiakiLoadSharedSightings()});
$("sharedSightingsClearAll")?.addEventListener("click",()=>{selectedSightingsCameras=new Set();window.KaitiakiLoadSharedSightings()});
$("sharedReviewSpecies")?.addEventListener("change",window.KaitiakiLoadSharedReview);
$("sharedReviewCamera")?.addEventListener("change",window.KaitiakiLoadSharedReview);
$("clearVisibleSharedReview")?.addEventListener("click",async()=>{
  const records=visibleSharedReviewRecords.filter(r=>r?.id);
  if(!records.length){$("sharedReviewStatus").textContent="No visible shared review records to clear.";return}
  if(!confirm("Clear "+records.length+" visible shared review item"+(records.length===1?"":"s")+"?\n\nUse this only for old items the team has already reviewed. They will be marked resolved in the shared database; confirmed sightings and reports are not deleted."))return;
  const btn=$("clearVisibleSharedReview");btn.disabled=true;
  $("sharedReviewStatus").textContent="Clearing completed old review items…";
  try{
    const res=await fetch(endpoint()+"/team/review-resolve",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({ids:records.map(r=>r.id)})});
    const data=await res.json();
    if(!res.ok)throw Error(data.error||"Could not clear shared review");
    $("sharedReviewStatus").textContent="Cleared "+Number(data.resolved||records.length)+" shared review item"+(Number(data.resolved||records.length)===1?"":"s")+".";
    await loadShared("review");
  }catch(e){$("sharedReviewStatus").textContent="Could not clear shared review: "+String(e.message||e)}
  finally{btn.disabled=false}
});
})();