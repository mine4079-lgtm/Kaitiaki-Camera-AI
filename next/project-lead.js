(()=>{"use strict";
const $=id=>document.getElementById(id);
const URL_KEY="kaitiaki-next-cloud-endpoint";
const TOKEN_KEY="kaitiaki-next-session-token";
const PERSIST_TOKEN_KEY="kaitiaki-next-device-token";
const ROLE_KEY="kaitiaki-access-role";
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let checks=[],filtered=[];

function endpoint(){return (localStorage.getItem(URL_KEY)||"https://kaitiaki-next-vision.monaghan666.workers.dev").replace(/\/+$/,"")}
function token(){return localStorage.getItem(PERSIST_TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||""}
function role(){return localStorage.getItem(ROLE_KEY)||"team"}
function esc(s){return String(s??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function csv(v){const t=String(v??"");return /[",\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t}
function unique(values){return [...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"}))}
function latestDate(values){return values.filter(Boolean).sort().at(-1)||""}
function dedupe(items){
  const keep=new Map();
  for(const c of items||[]){
    const camera=String(c.cameraNo||"").trim().toUpperCase(),checkNo=Number(c.checkNo)||0,date=String(c.checkedDate||"").trim();
    const key=(camera&&checkNo&&date)?camera+"|"+checkNo+"|"+date:"id:"+String(c.id||Math.random());
    const old=keep.get(key);
    if(!old||String(c.updatedAt||c.createdAt||"")>String(old.updatedAt||old.createdAt||""))keep.set(key,c);
  }
  return [...keep.values()];
}
function setOptions(select,values,allLabel,current){
  if(!select)return "all";
  select.replaceChildren();
  const all=document.createElement("option");all.value="all";all.textContent=allLabel;select.append(all);
  for(const v of values){const o=document.createElement("option");o.value=v;o.textContent=v;select.append(o)}
  select.value=values.includes(current)?current:"all";
  return select.value;
}
function applyRole(next){
  const nav=$("projectLeadNav");
  if(nav)nav.hidden=next!=="project_lead";
  if(next!=="project_lead"&&document.getElementById("projectLead")?.classList.contains("current")){
    document.querySelector('[data-tab="scan"]')?.click();
  }
}
window.KaitiakiSetAccessRole=next=>{
  const safe=next==="project_lead"?"project_lead":"team";
  localStorage.setItem(ROLE_KEY,safe);applyRole(safe);
  window.dispatchEvent(new CustomEvent("kaitiaki-role-changed",{detail:{role:safe}}));
};
async function verifyStoredRole(){
  applyRole("team");
  const t=token();if(!t||!navigator.onLine){localStorage.setItem(ROLE_KEY,"team");return}
  try{
    const res=await fetch(endpoint()+"/session",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({token:t})});
    if(!res.ok){localStorage.setItem(ROLE_KEY,"team");return}
    const data=await res.json();window.KaitiakiSetAccessRole(data.role==="project_lead"?"project_lead":"team");
  }catch{localStorage.setItem(ROLE_KEY,"team")}
}
verifyStoredRole();

function fillYears(){
  const sel=$("plYear"),current=Number(sel?.value)||new Date().getFullYear();
  const years=[...new Set(checks.map(c=>Number(c.reportYear)).filter(Number.isFinite))].sort((a,b)=>b-a);
  if(!years.length)years.push(new Date().getFullYear());
  sel.replaceChildren();for(const y of years){const o=document.createElement("option");o.value=String(y);o.textContent=String(y);sel.append(o)}
  sel.value=years.includes(current)?String(current):String(years[0]);
}
function currentYearChecks(){const year=Number($("plYear")?.value)||new Date().getFullYear();return checks.filter(c=>Number(c.reportYear)===year)}
function refillFilters(){
  const yearChecks=currentYearChecks();
  const zoneSel=$("plZone"),blockSel=$("plBlock"),camSel=$("plCamera");
  const zone=setOptions(zoneSel,unique(yearChecks.map(c=>String(c.zone||"").trim())),"All zones",zoneSel?.value||"all");
  const z=yearChecks.filter(c=>zone==="all"||String(c.zone||"").trim()===zone);
  const block=setOptions(blockSel,unique(z.map(c=>String(c.block||"").trim())),"All blocks",blockSel?.value||"all");
  const zb=z.filter(c=>block==="all"||String(c.block||"").trim()===block);
  setOptions(camSel,unique(zb.map(c=>String(c.cameraNo||"").trim())),"All cameras",camSel?.value||"all");
}
function selectedChecks(){
  const year=Number($("plYear")?.value)||new Date().getFullYear(),zone=$("plZone")?.value||"all",block=$("plBlock")?.value||"all",camera=$("plCamera")?.value||"all";
  return checks.filter(c=>Number(c.reportYear)===year)
    .filter(c=>zone==="all"||String(c.zone||"").trim()===zone)
    .filter(c=>block==="all"||String(c.block||"").trim()===block)
    .filter(c=>camera==="all"||String(c.cameraNo||"").trim()===camera);
}
function renderBars(data){
  const totals=Array(12).fill(0);
  for(const c of data)(c.monthlyPossum||[]).forEach((n,i)=>totals[i]+=Number(n)||0);
  const max=Math.max(1,...totals),root=$("plMonthlyBars");if(!root)return;
  root.innerHTML=totals.map((n,i)=>"<div class='monthbar'><span>"+MONTHS[i]+"</span><div><i style='height:"+Math.max(3,Math.round(n/max*90))+"px'></i></div><b>"+n+"</b></div>").join("");
}
function renderSpecies(data){
  const totals={};
  for(const c of data)for(const [name,n] of Object.entries(c.speciesCounts||{}))totals[name]=(totals[name]||0)+(Number(n)||0);
  const entries=Object.entries(totals).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  $("plSpeciesSummary").innerHTML=entries.length?entries.map(([k,n])=>"<strong>"+esc(k)+"</strong> "+Number(n).toLocaleString()).join(" · "):"No detections in this filter.";
}
function renderCameraSummary(data){
  const map=new Map();
  for(const c of data){
    const key=String(c.cameraNo||"").trim();if(!key)continue;
    const x=map.get(key)||{camera:key,zone:"",block:"",checks:0,possums:0,lastPossum:"",latestCheck:"",issues:"",latestUpdate:""};
    x.checks++;x.possums+=Number(c.totalPossum)||0;
    x.zone=c.zone||x.zone;x.block=c.block||x.block;x.lastPossum=latestDate([x.lastPossum,c.latestPossumDate]);
    if(String(c.checkedDate||"")>=String(x.latestCheck||"")){x.latestCheck=c.checkedDate||"";x.issues=c.issuesNotes||"";x.latestUpdate=c.updatedAt||""}
    map.set(key,x);
  }
  const rows=[...map.values()].sort((a,b)=>a.camera.localeCompare(b.camera,undefined,{numeric:true,sensitivity:"base"}));
  const body=$("plCameraBody");body.replaceChildren();
  for(const r of rows){
    const tr=document.createElement("tr");
    tr.innerHTML="<td><strong>"+esc(r.camera)+"</strong></td><td>"+esc(r.zone)+"</td><td>"+esc(r.block)+"</td><td>"+r.checks+"</td><td>"+r.possums+"</td><td>"+esc(r.lastPossum)+"</td><td>"+esc(r.latestCheck)+"</td><td>"+esc(r.issues)+"</td>";
    body.append(tr);
  }
}
function render(){
  if(role()!=="project_lead")return;
  refillFilters();
  filtered=selectedChecks();
  $("plChecks").textContent=filtered.length.toLocaleString();
  $("plCameras").textContent=new Set(filtered.map(c=>c.cameraNo).filter(Boolean)).size.toLocaleString();
  $("plPossums").textContent=filtered.reduce((a,c)=>a+(Number(c.totalPossum)||0),0).toLocaleString();
  $("plDetections").textContent=filtered.reduce((a,c)=>a+(Number(c.meaningfulCount)||0),0).toLocaleString();
  $("plLastPossum").textContent=latestDate(filtered.map(c=>c.latestPossumDate))||"—";
  renderBars(filtered);renderSpecies(filtered);renderCameraSummary(filtered);
  $("plStatus").textContent=filtered.length+" completed camera check"+(filtered.length===1?"":"s")+" in this view. Read-only.";
}
async function load(){
  if(role()!=="project_lead"){applyRole(role());return}
  if(!navigator.onLine){$("plStatus").textContent="Offline — Project Lead dashboard needs the shared database.";return}
  const t=token();if(!t){$("plStatus").textContent="Connect the Project Lead access token in AI settings first.";return}
  $("plStatus").textContent="Loading Project Lead dashboard…";
  try{
    const res=await fetch(endpoint()+"/project-lead/dashboard",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify({token:t,limit:1000})});
    const data=await res.json();if(!res.ok||data.role!=="project_lead")throw Error(data.error||"Project Lead access unavailable");
    checks=dedupe(data.checks||[]);fillYears();refillFilters();render();
  }catch(e){$("plStatus").textContent="Project Lead dashboard unavailable: "+String(e.message||e)}
}
function exportCsv(){
  if(!filtered.length){$("plStatus").textContent="No filtered Project Lead data to export.";return}
  const head=["Camera","Zone","Block","Check No","Checked date","Serviced by","Possum images","Presence","Last possum","Meaningful detections","Other detections","Issues"];
  const lines=[head.map(csv).join(",")];
  for(const c of filtered){
    lines.push([c.cameraNo,c.zone,c.block,c.checkNo,c.checkedDate,c.servicedBy,c.totalPossum,c.approxPresence,c.latestPossumDate,c.meaningfulCount,c.notes,c.issuesNotes].map(csv).join(","));
  }
  const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="kaitiaki-project-lead-"+($("plYear")?.value||"report")+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $("plStatus").textContent="Exported "+filtered.length+" filtered camera check"+(filtered.length===1?"":"s")+".";
}
window.KaitiakiLoadProjectLead=load;
$("plRefresh")?.addEventListener("click",load);
$("plExport")?.addEventListener("click",exportCsv);
for(const id of ["plYear","plZone","plBlock","plCamera"])$(id)?.addEventListener("change",()=>{if(id==="plYear"){refillFilters()}render()});
window.addEventListener("kaitiaki-role-changed",e=>applyRole(e.detail?.role||"team"));
})();