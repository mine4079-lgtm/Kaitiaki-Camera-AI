/* Shared team sightings UI + background sync. */
(()=>{"use strict";
const $=id=>document.getElementById(id);
const DB_NAME="kaitiaki-next-v1",STORE="image-records";
const URL_KEY="kaitiaki-next-cloud-endpoint";
const TOKEN_KEY="kaitiaki-next-session-token";
const PERSIST_TOKEN_KEY="kaitiaki-next-device-token";
const DEVICE_ID_KEY="kaitiaki-device-id";
const TEAM_KEY="kaitiaki-team-name";
const PENDING_KEY="kaitiaki-shared-pending";
const PESTS=["Possum","Rat","Stoat","Mouse","Deer","Pig"];
let imageUrls=[];

function endpoint(){return (localStorage.getItem(URL_KEY)||"https://kaitiaki-next-vision.monaghan666.workers.dev").replace(/\/+$/,"")}
function token(){return localStorage.getItem(PERSIST_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||""}
function deviceId(){return localStorage.getItem(DEVICE_ID_KEY)||""}
function teamName(){return localStorage.getItem(TEAM_KEY)||""}
function headers(){const t=token();return t?{authorization:"Bearer "+t}:{}}
function candidate(r){
  if(r.verified)return true;
  if(r.aiPrediction==="Unsure"||r.aiNeedsExtraReview)return true;
  return (PESTS.includes(r.aiPrediction)&&Number(r.aiConfidence)>=85) || (!!r.aiPrediction&&Number(r.aiConfidence)<85);
}
function pending(){try{return new Set(JSON.parse(localStorage.getItem(PENDING_KEY)||"[]"))}catch{return new Set()}}
function savePending(set){localStorage.setItem(PENDING_KEY,JSON.stringify([...set].slice(-2000)))}
function markPending(key){const set=pending();set.add(key);savePending(set)}
function clearPending(key){const set=pending();set.delete(key);savePending(set)}
function blobToDataURL(blob){return new Promise((ok,no)=>{if(!(blob instanceof Blob)){ok(null);return}const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(blob)})}
function openDB(){return new Promise((ok,no)=>{const q=indexedDB.open(DB_NAME,1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function getRow(db,key){return new Promise((ok,no)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).get(key);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}

async function syncRecord(record,preview){
  if(!record?.key||!candidate(record))return;
  if(!navigator.onLine||!token()){markPending(record.key);return}
  try{
    const image=await blobToDataURL(preview||record.preview);
    const body={record:{...record,syncId:(record.deviceId||deviceId()||"device")+"|"+record.key},image};
    const res=await fetch(endpoint()+"/team/sync",{method:"POST",headers:{"content-type":"application/json",...headers()},body:JSON.stringify(body)});
    if(!res.ok)throw Error("sync "+res.status);
    clearPending(record.key);
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
window.addEventListener("online",()=>setTimeout(flushPending,500));
setTimeout(flushPending,1200);

function clearImages(){for(const u of imageUrls)URL.revokeObjectURL(u);imageUrls=[]}
async function loadImage(id,img){
  try{
    const res=await fetch(endpoint()+"/team/image?id="+encodeURIComponent(id),{headers:headers()});
    if(!res.ok)throw Error();
    const blob=await res.blob(),url=URL.createObjectURL(blob);imageUrls.push(url);img.src=url;
  }catch{
    const p=document.createElement("div");p.className="placeholder";p.textContent="Shared image unavailable";img.replaceWith(p);
  }
}
function esc(s){return String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function niceDate(v){if(!v)return"";try{return new Date(v).toLocaleString()}catch{return v}}

async function loadShared(kind){
  const root=$(kind==="sighting"?"sharedSightings":"sharedReview");
  const status=$(kind==="sighting"?"sharedSightingsStatus":"sharedReviewStatus");
  if(!root||!status)return;
  clearImages();
  if(!navigator.onLine){status.textContent="Offline — shared records need internet. Your local Review still works.";return}
  if(!token()){status.textContent="Connect AI once on this device to open shared team records.";return}
  status.textContent="Loading shared team records…";
  try{
    const team=teamName();
    const path=kind==="sighting"?"/team/sightings":"/team/review";
    const url=endpoint()+path+"?limit=150"+(team?"&team="+encodeURIComponent(team):"");
    const res=await fetch(url,{headers:headers()});
    const data=await res.json();
    if(!res.ok||data.sharedReady!==true)throw Error(data.error||"Shared database not connected yet");
    root.replaceChildren();
    const records=data.records||[];
    if(!records.length){
      root.innerHTML='<div class="empty">No shared '+(kind==="sighting"?"pest sightings":"review items")+' yet.</div>';
      status.textContent="Up to date.";
      return;
    }
    for(const r of records){
      const card=document.createElement("article");card.className="item";
      if(r.image_key){
        const img=document.createElement("img");
        img.alt=(r.confirmed_label||r.ai_prediction||"Detection")+" trail-camera image";
        img.loading="lazy";card.append(img);loadImage(r.id,img);
      }else{
        const p=document.createElement("div");p.className="placeholder";p.textContent="No shared preview";card.append(p);
      }
      const label=r.human_verified?(r.confirmed_label||r.ai_prediction):r.ai_prediction;
      const who=r.reviewer_name||r.imported_by||"";
      const body=document.createElement("div");body.className="item-body";
      body.innerHTML="<strong>"+esc(label||"Needs review")+"</strong><span class='kind "+(r.human_verified?"good":"")+"'>"+esc(r.human_verified?"Confirmed":(r.ai_confidence!=null?"AI · "+r.ai_confidence+"%":"AI result"))+"</span><small>"+esc(r.file_name)+"</small><small>"+esc(niceDate(r.verified_at||r.updated_at))+(who?" · "+esc(who):"")+"</small>";
      card.append(body);root.append(card);
    }
    status.textContent=records.length+" shared "+(kind==="sighting"?"sighting":"review")+" record"+(records.length===1?"":"s")+" shown.";
  }catch(e){
    root.innerHTML='<div class="empty">Shared database not connected yet.</div>';
    status.textContent=String(e.message||e);
  }
}

window.KaitiakiLoadSharedSightings=()=>loadShared("sighting");
window.KaitiakiLoadSharedReview=()=>loadShared("review");
$("refreshSightings")?.addEventListener("click",window.KaitiakiLoadSharedSightings);
$("refreshSharedReview")?.addEventListener("click",window.KaitiakiLoadSharedReview);
})();