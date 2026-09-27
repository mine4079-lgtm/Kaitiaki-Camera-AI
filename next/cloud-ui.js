/* Cloud vision controls. Isolated from the human-review state machine. */
(()=>{"use strict";
const $=id=>document.getElementById(id),NAME="kaitiaki-next-v1",STORE="image-records",URL_KEY="kaitiaki-next-cloud-endpoint",TOKEN_KEY="kaitiaki-next-session-token",PERSIST_TOKEN_KEY="kaitiaki-next-device-token",REMEMBER_KEY="kaitiaki-next-remember-token",DEFAULT_URL="https://kaitiaki-next-vision.monaghan666.workers.dev";
let files=new Map(),running=false,paused=false;
window.KaitiakiCloudIsRunning=()=>running;
const getKey=f=>(f.webkitRelativePath||f.name)+"|"+f.size+"|"+f.lastModified;
function say(m){$("cloudStatus").textContent=m}
function dbOpen(){return new Promise((ok,no)=>{const req=indexedDB.open(NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:"key"})};req.onsuccess=()=>ok(req.result);req.onerror=()=>no(req.error)})}
function getAll(db){return new Promise((ok,no)=>{const tx=db.transaction(STORE,"readonly"),q=tx.objectStore(STORE).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}
function put(db,row){return new Promise((ok,no)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(row);tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})}
function assessQuality(canvas){const max=96,scale=Math.min(1,max/Math.max(canvas.width,canvas.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(canvas.width*scale));c.height=Math.max(1,Math.round(canvas.height*scale));const ctx=c.getContext("2d",{alpha:false,willReadFrequently:true});ctx.drawImage(canvas,0,0,c.width,c.height);const d=ctx.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,gray=new Float32Array(w*h);let sum=0;for(let i=0,p=0;i<d.length;i+=4,p++){const g=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];gray[p]=g;sum+=g}const mean=sum/gray.length;let edge=0,n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(x+1<w){edge+=Math.abs(gray[p]-gray[p+1]);n++}if(y+1<h){edge+=Math.abs(gray[p]-gray[p+w]);n++}}const detail=n?edge/n:0,dark=mean<42,lowDetail=detail<7.5;return {dark,lowDetail,meanBrightness:Math.round(mean),detailScore:Math.round(detail*10)/10,flagged:dark||lowDetail,reason:[dark?"dark":"",lowDetail?"low detail / possible blur":""].filter(Boolean).join(" + ")}}
async function prepareImage(file){const bmp=await createImageBitmap(file);try{const draw=max=>{const scale=Math.min(1,max/Math.max(bmp.width,bmp.height));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(bmp.width*scale));c.height=Math.max(1,Math.round(bmp.height*scale));c.getContext("2d",{alpha:false}).drawImage(bmp,0,0,c.width,c.height);return c};const apiCanvas=draw(1280),previewCanvas=draw(420),quality=assessQuality(apiCanvas);const preview=await new Promise((ok,no)=>previewCanvas.toBlob(b=>b?ok(b):no(Error("Preview unavailable")),"image/jpeg",.68));return {image:apiCanvas.toDataURL("image/jpeg",.8),preview,quality}}finally{bmp.close()}}
function endpoint(){const v=$("cloudEndpoint").value.trim().replace(/\/+$/,"");if(!/^https:\/\//.test(v))throw Error("Enter a secure HTTPS backend URL");return v}
function token(){const v=$("cloudToken").value.trim();if(!v)throw Error("Enter your access token");return v}
$("cloudEndpoint").value=localStorage.getItem(URL_KEY)||DEFAULT_URL;
$("rememberToken").checked=localStorage.getItem(REMEMBER_KEY)==="yes";
$("cloudToken").value=localStorage.getItem(PERSIST_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||"";
async function checkConnection(){
  if(!navigator.onLine){$("cloudStart").disabled=true;say("Offline — import, review and CSV still work. AI identification needs internet.");return false}
  try{
    const url=endpoint(),key=token(),res=await fetch(url,{cache:"no-store"}),data=await res.json();
    if(!res.ok||!data.ready)throw Error("Backend is not configured");
    localStorage.setItem(URL_KEY,url);
    if($("rememberToken").checked){localStorage.setItem(PERSIST_TOKEN_KEY,key);localStorage.setItem(REMEMBER_KEY,"yes");sessionStorage.removeItem(TOKEN_KEY)}else{sessionStorage.setItem(TOKEN_KEY,key);localStorage.removeItem(PERSIST_TOKEN_KEY);localStorage.removeItem(REMEMBER_KEY)}
    $("cloudStart").disabled=false;
    say("AI ready.");
    $("aiSettings").open=false;
    return true;
  }catch(e){
    $("cloudStart").disabled=true;
    $("aiSettings").open=true;
    say("AI connection unavailable: "+String(e.message||e));
    return false;
  }
}
$("cloudCheck").onclick=checkConnection;
for(const id of ["cloudEndpoint","cloudToken"])$(id).oninput=()=>{$("cloudStart").disabled=true;say("AI connection needs checking.")};$("rememberToken").onchange=()=>{if(!$("rememberToken").checked){localStorage.removeItem(PERSIST_TOKEN_KEY);localStorage.removeItem(REMEMBER_KEY)}else localStorage.setItem(REMEMBER_KEY,"yes")};
for(const id of ["photos","folder"])$(id).addEventListener("change",e=>{for(const f of Array.from(e.target.files||[]))files.set(getKey(f),f);say(files.size.toLocaleString()+" images connected. Import them, then Identify unscanned photos.")});
window.addEventListener("kaitiaki-clear-files",()=>{files.clear();say("Connected folders cleared. Saved results are unchanged.")});
$("cloudPause").onclick=()=>{paused=true;say("Pausing after current image…")};
$("cloudStart").onclick=async()=>{
if(running)return;if(!navigator.onLine){say("Offline — AI identification needs internet. Your local work is still available.");return}let url,key;
try{url=endpoint();key=token()}catch(e){$("aiSettings").open=true;say(e.message);return}
if($("cloudStart").disabled){if(!await checkConnection())return}
const db=await dbOpen();const rows=await getAll(db),queue=rows.filter(r=>files.has(r.key)&&!r.aiPrediction);
if(!queue.length){say("No unscanned imported photos found. Import or re-select the original folder.");db.close();return}
if(!confirm("Identify "+queue.length.toLocaleString()+" unscanned photo(s)? Resized copies will be sent to Gemini; originals stay untouched.")){db.close();return}
running=true;paused=false;$("cloudStart").disabled=true;$("cloudPause").disabled=false;$("start").disabled=true;
let done=0,failed=0;try{
for(const row of queue){
if(paused)break;
try{
const prepared=await prepareImage(files.get(row.key)),image=prepared.image;
const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},body:JSON.stringify({image})});
const out=await res.json();if(!res.ok)throw Error(out.error||"HTTP "+res.status);
const allowed=["Possum","Rat","Stoat","Mouse","Deer","Pig","Weka","Other wildlife","Empty image","Unsure"];if(!allowed.includes(out.label)||!Number.isInteger(out.confidence)||out.confidence<0||out.confidence>100||(out.second_choice!==null&&out.second_choice!==undefined&&!allowed.includes(out.second_choice)))throw Error("Invalid prediction");
const extraReview=out.label==="Empty image"&&prepared.quality.flagged;const next={...row,preview:row.preview instanceof Blob?row.preview:prepared.preview,aiPrediction:out.label,aiConfidence:out.confidence,aiSecondChoice:out.second_choice??null,aiNote:String(out.note||"").slice(0,300),aiModel:String(out.modelId||""),aiNeedsExtraReview:extraReview,aiQualityReason:extraReview?prepared.quality.reason:"",aiQualityBrightness:prepared.quality.meanBrightness,aiQualityDetail:prepared.quality.detailScore,aiCheckedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await put(db,next);if(typeof window.KaitiakiNextApplyAIResult==="function")window.KaitiakiNextApplyAIResult(next);window.KaitiakiSharedSync?.(next,prepared.preview);done++;
}catch(err){failed++;say("Error: "+String(err.message||err));if(failed>=3){paused=true;break}}
say(done.toLocaleString()+" / "+queue.length.toLocaleString()+" AI results saved · "+failed+" errors"+(paused?" · paused":""));await new Promise(resolve=>setTimeout(resolve,0))
}
say((paused?"Paused safely. ":"Done. ")+done.toLocaleString()+" results saved, "+failed+" failed. Open Results to review.");
}finally{db.close();running=false;$("cloudStart").disabled=false;$("cloudPause").disabled=true;$("start").disabled=!$("photos").files.length&&!$("folder").files.length}
};
if(navigator.onLine&&$("cloudEndpoint").value&&$("cloudToken").value){checkConnection()}else if(!navigator.onLine){$("cloudStart").disabled=true;say("Offline — import, review and CSV still work. AI identification needs internet.")}else{$("aiSettings").open=true}
})();