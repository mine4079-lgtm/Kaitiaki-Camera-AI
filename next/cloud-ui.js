/* Cloud vision controls. Isolated from the human-review state machine. */
(()=>{"use strict";
const $=id=>document.getElementById(id),NAME="kaitiaki-next-v1",STORE="image-records",URL_KEY="kaitiaki-next-cloud-endpoint";
let files=new Map(),running=false,paused=false;
window.KaitiakiCloudIsRunning=()=>running;
const getKey=f=>(f.webkitRelativePath||f.name)+"|"+f.size+"|"+f.lastModified;
function say(m){$("cloudStatus").textContent=m}
function dbOpen(){return new Promise((ok,no)=>{const req=indexedDB.open(NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:"key"})};req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error)})}
function getAll(db){return new Promise((ok,no)=>{const tx=db.transaction(STORE,"readonly"),q=tx.objectStore(STORE).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function put(db,row){return new Promise((ok,no)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(row);tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})}
async function prepareImage(file){const bmp=await createImageBitmap(file);try{const draw=max=>{const scale=Math.min(1,max/Math.max(bmp.width,bmp.height));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(bmp.width*scale));c.height=Math.max(1,Math.round(bmp.height*scale));c.getContext("2d",{alpha:false}).drawImage(bmp,0,0,c.width,c.height);return c};const apiCanvas=draw(1280),previewCanvas=draw(420);const preview=await new Promise((ok,no)=>previewCanvas.toBlob(b=>b?ok(b):no(Error("Preview unavailable")),"image/jpeg",.68));return {image:apiCanvas.toDataURL("image/jpeg",.8),preview}}finally{bmp.close()}}
function endpoint(){const v=$("cloudEndpoint").value.trim().replace(/\/+$/,"");if(!/^https:\/\//.test(v))throw Error("Enter a secure HTTPS backend URL");return v}
function token(){const v=$("cloudToken").value.trim();if(!v)throw Error("Enter your access token");return v}
$("cloudEndpoint").value=localStorage.getItem(URL_KEY)||"";
$("cloudCheck").onclick=async()=>{try{const url=endpoint(),key=token(),res=await fetch(url,{cache:"no-store"}),data=await res.json();if(!res.ok||!data.ready)throw Error("Backend is not configured");localStorage.setItem(URL_KEY,url);$("cloudStart").disabled=false;say("Ready. Images only leave your device when you press Identify. Access token is not saved.");}catch(e){$("cloudStart").disabled=true;say("Connection unavailable: "+String(e.message||e))}};
for(const id of ["cloudEndpoint","cloudToken"])$(id).oninput=()=>{$("cloudStart").disabled=true};
for(const id of ["photos","folder"])$(id).addEventListener("change",e=>{for(const f of Array.from(e.target.files||[]))files.set(getKey(f),f);say(files.size.toLocaleString()+" images connected across your current selections. Add more folders if needed, import them, then press Identify.")});
$("cloudPause").onclick=()=>{paused=true;say("Pausing after current image…")};
$("cloudStart").onclick=async()=>{
if(running)return;let url,key;
try{url=endpoint();key=token()}catch(e){say(e.message);return}
const db=await dbOpen();const rows=await getAll(db),queue=rows.filter(r=>files.has(r.key)&&!r.aiPrediction);
if(!queue.length){say("No unscanned imported photos found. Import or re-select the original folder.");db.close();return}
if(!confirm("Upload "+queue.length.toLocaleString()+" photo(s) to cloud vision AI? Your work images leave this device and API charges may apply.")){db.close();return}
running=true;paused=false;$("cloudStart").disabled=true;$("cloudPause").disabled=false;$("start").disabled=true;
let done=0,failed=0;try{
for(const row of queue){
if(paused)break;
try{
const prepared=await prepareImage(files.get(row.key)),image=prepared.image;
const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},body:JSON.stringify({image})});
const out=await res.json();if(!res.ok)throw Error(out.error||"HTTP "+res.status);
const allowed=["Possum","Rat","Stoat","Mouse","Deer","Pig","Weka","Other wildlife","Empty image","Unsure"];if(!allowed.includes(out.label)||!Number.isInteger(out.confidence)||out.confidence<0||out.confidence>100||(out.second_choice!==null&&out.second_choice!==undefined&&!allowed.includes(out.second_choice)))throw Error("Invalid prediction");
const next={...row,preview:row.preview instanceof Blob?row.preview:prepared.preview,aiPrediction:out.label,aiConfidence:out.confidence,aiSecondChoice:out.second_choice??null,aiNote:String(out.note||"").slice(0,300),aiModel:String(out.modelId||""),aiCheckedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await put(db,next);if(typeof window.KaitiakiNextApplyAIResult==="function")window.KaitiakiNextApplyAIResult(next);done++;
}catch(err){failed++;say("Error: "+String(err.message||err));if(failed>=3){paused=true;break}}
say(done.toLocaleString()+" / "+queue.length.toLocaleString()+" AI results saved · "+failed+" errors"+(paused?" · paused":""));await new Promise(resolve=>setTimeout(resolve,0))
}
say((paused?"Paused safely. ":"Completed. ")+done.toLocaleString()+" AI results saved, "+failed+" failed. Open Results now — no refresh needed.");
}finally{db.close();running=false;$("cloudStart").disabled=false;$("cloudPause").disabled=true;$("start").disabled=!$("photos").files.length&&!$("folder").files.length}
};
})();