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
let galleryRecords=[],galleryIndex=0,galleryKind="sighting",localGalleryUrl=null,galleryWarning="",galleryRepairCheck=null;

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
  $("sharedMetaNote").textContent=(galleryWarning?galleryWarning+"\n\n":"")+(r.ai_note||"No description available.");
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
  if(!check?.id||!check.latestPossumDate)return {ok:false,message:"Repair stopped safely: this check has no saved Last possum date to use as a reliable cutoff."};
  const expected=Number(check.totalPossum)||0,year=Number(check.reportYear)||new Date().getFullYear();
  const cutoff=new Date(check.latestPossumDate+"T23:59:59.999").getTime();
  if(!Number.isFinite(cutoff))return {ok:false,message:"Repair stopped safely: the saved Last possum date could not be read."};

  const db=await openDB();let rows=[];try{rows=await getAllRows(db)}finally{db.close()}
  const linked=rows.filter(r=>r.cameraCheckId===check.id);
  const possums=linked.filter(r=>{
    const label=r.verified?r.label:r.aiPrediction;
    if(label!=="Possum")return false;
    const d=new Date(r.capturedAt||r.lastModified||0);
    return !Number.isNaN(d.getTime())&&d.getFullYear()===year&&d.getTime()<=cutoff;
  }).sort((x,y)=>String(x.capturedAt||"").localeCompare(String(y.capturedAt||"")));

  if(possums.length!==expected){
    return {ok:false,message:"Repair stopped safely: using Last possum "+check.latestPossumDate+" gives "+possums.length+" possum images, but the report expects "+expected+". Nothing was changed."};
  }

  const keepKeys=new Set(possums.map(r=>r.key));
  const extras=linked.filter(r=>{
    const label=r.verified?r.label:r.aiPrediction;
    if(label!=="Possum")return false;
    const d=new Date(r.capturedAt||r.lastModified||0);
    return !Number.isNaN(d.getTime())&&d.getFullYear()===year&&!keepKeys.has(r.key);
  });

  if(!extras.length)return {ok:true,message:"This check already matches the report count of "+expected+" possum images.",removed:0};

  const now=new Date().toISOString();
  const updates=extras.map(r=>({...r,cameraCheckId:"",checkNo:"",checkedDate:"",servicedBy:"",updatedAt:now}));
  const db2=await openDB();try{
    await new Promise((ok,no)=>{const t=db2.transaction(STORE,"readwrite"),st=t.objectStore(STORE);for(const r of updates)st.put(r);t.oncomplete=ok;t.onerror=()=>no(t.error)});
  }finally{db2.close()}

  for(const r of updates)syncRecord(r,r.preview);
  return {ok:true,message:"Repaired "+check.cameraNo+". Kept the "+expected+" possum images up to "+check.latestPossumDate+" and unlinked "+extras.length+" extra possum record"+(extras.length===1?"":"s")+". No images or classifications were deleted.",removed:extras.length};
}
$("sharedRepair")?.addEventListener("click",async()=>{
  const btn=$("sharedRepair"),check=galleryRepairCheck;if(!btn||!check)return;
  btn.disabled=true;btn.textContent="Repairing…";
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
  }finally{btn.disabled=false;btn.textContent="Repair check links"}
});

async function loadShared(kind){
  const root=$(kind==="sighting"?"sharedSightings":"sharedReview");
  const status=$(kind==="sighting"?"sharedSightingsStatus":"sharedReviewStatus");
  if(!root||!status)return;
  clearImages();
  if(!navigator.onLine){status.textContent="Offline — shared records need internet. Your local Review still works.";return}
  if(!token()){status.textContent="Connect AI once on this device to open shared team records.";return}
  status.textContent="Checking shared database…";
  try{const health=await fetch(endpoint(),{cache:"no-store"}).then(r=>r.json());if(!health.sharedReady)throw Error("Worker is online but D1 is not connected to it.")}catch(e){status.textContent="Shared connection problem: "+String(e.message||e);return}
  status.textContent="Loading shared team records…";
  try{
    const path=kind==="sighting"?"/team/sightings":"/team/review";
    const url=endpoint()+path;
    const res=await fetch(url,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:teamBody({limit:150})});
    const data=await res.json();
    if(!res.ok||data.sharedReady!==true)throw Error(data.error||"Shared database not connected yet");
    root.replaceChildren();
    const speciesSelect=$(kind==="sighting"?"sharedSightingsSpecies":"sharedReviewSpecies");
    const chosenSpecies=speciesSelect?.value||"all";
    const records=(data.records||[]).filter(r=>{if(r.ai_prediction==="Empty image")return false;const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;return chosenSpecies==="all"||label===chosenSpecies});
    if(!records.length){
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
      const confirm=confirmationText(r,kind);body.innerHTML="<strong>"+esc(r.camera_no||label||"Needs review")+"</strong><span class='kind "+(r.human_verified?"good":"")+"'>"+esc(confirm+(r.ai_confidence!=null&&!r.human_verified?" · "+r.ai_confidence+"%":""))+"</span><small>"+esc(label||"")+(r.file_name?" · "+esc(r.file_name):"")+"</small><small>"+esc(niceDate(r.captured_at||r.verified_at||r.updated_at))+(who?" · "+esc(who):"")+"</small>";
      card.append(body);root.append(card);
    }
    status.textContent=records.length+" shared "+(kind==="sighting"?"sighting":"review")+" record"+(records.length===1?"":"s")+" shown.";
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
        updated_at:r.updatedAt||"",
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

window.KaitiakiLoadSharedSightings=()=>loadShared("sighting");
window.KaitiakiLoadSharedReview=()=>loadShared("review");
$("refreshSightings")?.addEventListener("click",window.KaitiakiLoadSharedSightings);
$("refreshSharedReview")?.addEventListener("click",window.KaitiakiLoadSharedReview);
$("sharedSightingsSpecies")?.addEventListener("change",window.KaitiakiLoadSharedSightings);
$("sharedReviewSpecies")?.addEventListener("change",window.KaitiakiLoadSharedReview);
})();