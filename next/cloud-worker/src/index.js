/* Kaitiaki Next — private cloud vision bridge. Deploy separately, never in GitHub Pages.
 * Required Worker secrets: OPENAI_API_KEY and KAITIAKI_ACCESS_TOKEN.
 * Optional Worker vars: OPENAI_MODEL (default gpt-4.1-mini), ALLOWED_ORIGIN.
 * Images are processed in memory, NOT stored by this Worker.
 */
const LABELS=["Possum","Rat","Stoat","Mouse","Deer","Pig","Weka","Other wildlife","Empty image","Unsure"];
const MAX_BYTES=8*1024*1024;
function respond(body,status=200,origin=""){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":origin,"vary":"Origin"}})}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"";
 const expected=env.ALLOWED_ORIGIN||"https://mine4079-lgtm.github.io";
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin===expected?origin:"","access-control-allow-methods":"POST, GET, OPTIONS","access-control-allow-headers":"authorization,content-type","access-control-max-age":"600","vary":"Origin"}});
 if(origin!==expected)return respond({error:"Origin not allowed"},403,"");
 if(request.method==="GET")return respond({ready:!!(env.OPENAI_API_KEY&&env.KAITIAKI_ACCESS_TOKEN),service:"kaitiaki-next-cloud"},200,origin);
 if(request.method!=="POST")return respond({error:"Use POST"},405,origin);
 if(!env.OPENAI_API_KEY||!env.KAITIAKI_ACCESS_TOKEN)return respond({error:"Server not configured"},503,origin);
 const auth=request.headers.get("Authorization")||"";
 if(auth!=="Bearer "+env.KAITIAKI_ACCESS_TOKEN)return respond({error:"Not authorised"},401,origin);
 const contentLength=Number(request.headers.get("content-length")||0);
 if(contentLength>MAX_BYTES*1.5)return respond({error:"Image too large"},413,origin);
 let input;
 try{input=await request.json()}catch{return respond({error:"Invalid JSON"},400,origin)}
 const image=input&&input.image;
 if(typeof image!=="string" || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length>MAX_BYTES*1.5)return respond({error:"Invalid or oversized image. JPEG, PNG, WebP only."},400,origin);
 const guide="You are a cautious New Zealand trail-camera wildlife classifier. Identify what is actually visible in THIS photograph. Target species are Possum, Rat, Stoat, Mouse, Deer, Pig, Weka. Other wildlife (e.g. kereru, kiwi, tuatara, bird, dog, cat) is Other wildlife, never Empty image. Empty image is only for genuinely no visible animal. Unsure when indistinct/ambiguous. Do not hallucinate. Distinguish rat from possum carefully. Return strict JSON object with label (one exact allowed label), confidence (integer 0-100 expressing subjective estimate, NOT calibrated statistical probability), note (short plain English on visible evidence); no extra keys.";
 let response;
 try{response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"authorization":"Bearer "+env.OPENAI_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:env.OPENAI_MODEL||"gpt-4.1-mini",temperature:0,max_completion_tokens:200,response_format:{type:"json_object"},messages:[{role:"system",content:guide},{role:"user",content:[{type:"text",text:"Classify this image with one of the exact labels."},{type:"image_url",image_url:{url:image,detail:"low"}}]}]})})}catch{return respond({error:"Vision service unavailable"},502,origin)}
 if(!response.ok)return respond({error:"Vision service returned "+response.status},502,origin);
 let result;try{const payload=await response.json();result=JSON.parse(payload.choices[0].message.content)}catch{return respond({error:"Invalid model response"},502,origin)}
 if(!LABELS.includes(result.label)||!Number.isInteger(result.confidence)||result.confidence<0||result.confidence>100||typeof result.note!=="string")return respond({error:"Unexpected model classification"},502,origin);
 const label=result.label,confidence=result.confidence;
 return respond({label,confidence,note:result.note.slice(0,240),modelId:env.OPENAI_MODEL||"gpt-4.1-mini",requiresHumanConfirmation:true,review:label==="Unsure"||confidence<85},200,origin);
}};
