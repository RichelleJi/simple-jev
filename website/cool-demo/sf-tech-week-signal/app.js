import { classifyBatch, MAX_BATCH_SIZE } from './classifier-client.mjs';

const sourceEvents=window.SF_TECH_WEEK_EVENTS||[];
const events=sourceEvents.map((e,i)=>({id:i+1,sourceId:e.source_id,date:e.date,time:e.time,name:e.title,host:e.host||'Host not listed',location:e.location||'Location TBD',description:e.description||'',summary:e.summary||'',themes:e.themes||[],formats:e.formats||[],sponsors:e.sponsors||[],descriptionStatus:e.description_status||'pending',sourceUrl:e.source_url,signal:'Unclassified',signals:[],best:'—',score:null,verdict:'—',confidence:0,classified:false,processedRank:0}));
const personaSignal={founder:'Investor access',jobseeker:'Looking for a job',engineer:'Engineer talent',researcher:'Research talent'};
const defaultCriteria=[
 ['Investor access','I','Partner, principal, angel, or allocator density; fundraising intent; small-group access.',20,'positive','Investor access'],
 ['Engineer talent','E','Strong engineers, technical leaders, project maintainers, and formats that reveal real ability.',16,'positive','Engineer talent'],
 ['Research talent','R','Researchers, paper authors, labs, frontier-model teams, and substantive technical depth.',14,'positive','Research talent'],
 ['Looking for a job','J','Active recruiters, hiring managers, open roles, referral access, and career-relevant conversations.',12,'positive','Looking for a job'],
 ['Food quality','F','Substantial, well-reviewed food that supports the event format—not just snack-table bait.',8,'positive','Food quality'],
 ['Exclusivity','X','Meaningful curation, relevant invitees, limited capacity, and credible access barriers.',9,'positive','Exclusivity'],
 ['Swag ROI','S','Usefulness and quality of giveaways relative to the time and attention the event demands.',6,'positive','Swag ROI'],
 ['Venue quality','V','Comfort, acoustics, accessibility, location, layout, and suitability for conversation.',7,'positive','Venue quality'],
 ['Sales pitch / noise','!','Sponsor-heavy framing, vague futurism, lead-gen language, and low audience specificity.',8,'negative','Sales pitch / noise']
];
let criteria=defaultCriteria.map(item=>[...item]);
let activeSignal='all',processedEvents=0,classificationRunning=false,latestProcessedFirst=false,processedRank=0;
const developerMode=new URLSearchParams(location.search).get('dev')==='1';
document.querySelector('#devLatency').hidden=!developerMode;

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
function sourceLink(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.tech-week.com'?url.href:'#'}catch{return '#'}}
function modelLabel(model){return ({'featherless-ai/Qwen3.6-35B-A3B-classifier':'Qwen3.6 · 35B-A3B','featherless-ai/Qwen3.8-27B-classifier':'Qwen3.8 · 27B','featherless-ai/Qwen3.5-4B-classifier':'Qwen3.5 · 4B','featherless-ai/gemma-4-26B-A4B-classifier':'Gemma 4 · 26B-A4B','featherless-ai/gemma-4-12B-it-classifier':'Gemma 4 · 12B-it','featherless-ai/RWKV-std-classifier':'RWKV · std','featherless-ai/RWKV-mid-classifier':'RWKV · mid','featherless-ai/RWKV-small-classifier':'RWKV · small'})[model]||model}
function classificationRubric(){return criteria.map(item=>({name:item[0],weight:item[3],guidance:item[2]}))}
function signalTitle(name){return criteria.find(item=>item[0]===name)?.[5]||name}
function renderSignalTitles(){document.querySelectorAll('[data-signal]:not([data-signal="all"])').forEach(button=>{button.textContent=signalTitle(button.dataset.signal)});document.querySelectorAll('[data-mix-signal]').forEach(label=>{if(label.childNodes[1])label.childNodes[1].textContent=` ${signalTitle(label.dataset.mixSignal)} `})}
function applyClassification(result){const event=events.find(item=>item.sourceId===result.source_id);if(!event)return;event.signal=result.signal;event.signals=Array.isArray(result.signals)&&result.signals.length?result.signals:[result.signal];event.best=result.best_for;event.score=result.vibe;event.verdict=result.verdict;event.confidence=result.confidence||0;event.classified=true;event.processedRank=++processedRank}

function renderRecommendations(persona='founder'){
 const picks=events.filter(e=>e.classified&&e.signals.includes(personaSignal[persona])).sort((a,b)=>b.score-a.score).slice(0,3);
 document.querySelector('#recommendationList').innerHTML=picks.length?picks.map((e,i)=>`<div class="rec"><span class="rec-rank">0${i+1}</span><div><h3><a href="${sourceLink(e.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(e.name)}</a></h3><p>${escapeHtml(e.host)} · ${e.signals.map(signalTitle).map(escapeHtml).join(' · ')}</p></div><strong class="score">${e.score}</strong></div>`).join(''):'<div class="empty-state">Run the classifier to build this shortlist.</div>';
}
function rowMarkup(e,full=false){
 const day=new Date(`${e.date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'}),signals=e.classified&&e.signals.length?e.signals:['Unclassified'],signalMarkup=`<span class="signal-tags">${signals.map(signal=>`<span class="tag${signal===e.signal?' primary':''}">${escapeHtml(signalTitle(signal))}</span>`).join('')}</span>`,score=e.classified?e.score:'—',verdictText=e.classified?e.verdict:'—';
 const eventCell=`<a class="event-name event-link" href="${sourceLink(e.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(e.name)}</a><span class="event-host">${escapeHtml(e.host)} · ${escapeHtml(e.location)}</span>`;
 const verdictMarkup=`<span class="verdict ${verdictText==='GO'?'go':verdictText==='SKIP'?'skip':''}">${verdictText}</span>`;
 if(full)return `<tr data-event-id="${e.id}"><td><span class="event-day">${escapeHtml(day)}</span>${escapeHtml(e.time)}</td><td>${eventCell}</td><td>${signalMarkup}</td><td>${escapeHtml(e.best)}</td><td class="score-cell">${score}</td><td>${verdictMarkup}</td></tr>`;
 return `<tr data-event-id="${e.id}"><td>${eventCell}</td><td>${signalMarkup}</td><td>${escapeHtml(e.best)}</td><td class="score-cell">${score}</td><td>${verdictMarkup}</td></tr>`;
}
function updateEventRendering(){
 document.querySelectorAll('#allEventRows tr,#overviewRows tr').forEach(row=>{const event=events[Number(row.dataset.eventId)-1];row.classList.toggle('event-classified',event?.classified);row.classList.toggle('event-active',false);row.classList.toggle('event-queued',!event?.classified)});
 document.querySelector('.event-table-panel')?.classList.toggle('is-classifying',classificationRunning);
}
function renderAllEvents(){
 const q=document.querySelector('#eventSearch').value.trim().toLowerCase();
 const filtered=events.filter(e=>(activeSignal==='all'||e.signals.includes(activeSignal))&&(!q||`${e.name} ${e.host} ${e.location} ${e.date} ${e.description}`.toLowerCase().includes(q)));
 const ordered=latestProcessedFirst?[...filtered].sort((a,b)=>(b.processedRank||0)-(a.processedRank||0)||a.id-b.id):filtered;
 document.querySelector('#allEventRows').innerHTML=ordered.map(e=>rowMarkup(e,true)).join('');document.querySelector('#eventEmpty').hidden=filtered.length>0;updateEventRendering();
}
function renderCriteria(){
 document.querySelector('#criteriaGrid').innerHTML=criteria.map((c,i)=>`<article class="panel criterion"><div class="criterion-top"><div><h3 class="${c[4]}">${escapeHtml(c[0])}</h3><p>${escapeHtml(c[2])}</p></div><span class="criterion-icon">${c[1]}</span></div><div class="criterion-controls"><input class="${c[4]}" type="range" min="0" max="40" value="${c[3]}" style="--fill:${c[3]/40*100}%" data-weight="${i}" aria-label="${escapeHtml(c[0])} weight"><span class="bar-label">${escapeHtml(c[0])}</span><output>${c[3]}%</output></div></article>`).join('');
 document.querySelectorAll('[data-weight]').forEach(input=>input.addEventListener('input',e=>{criteria[+e.target.dataset.weight][3]=+e.target.value;e.target.style.setProperty('--fill',`${e.target.value/40*100}%`);e.target.parentElement.querySelector('output').value=`${e.target.value}%`}));
 renderSignalTitles();
}
function updateLiveSignalMix(){
 const signals=[['Investor access','mixInvestor','var(--acid)'],['Engineer talent','mixEngineer','var(--cyan)'],['Research talent','mixResearch','var(--blue)'],['Looking for a job','mixJobs','#d58cff'],['Sales pitch / noise','mixNoise','var(--red)']],sample=events.filter(e=>e.classified),total=sample.length;
 const counts=signals.map(([signal])=>sample.filter(e=>e.signals.includes(signal)).length),tagTotal=counts.reduce((sum,count)=>sum+count,0);let cursor=0;const slices=signals.map(([signal,id,color],index)=>{const count=counts[index],start=cursor,end=cursor+(tagTotal?count/tagTotal*100:0);cursor=end;document.querySelector(`#${id}`).textContent=count;return `${color} ${start}% ${end}%`});
 const pie=document.querySelector('#liveMixPie');pie.style.background=tagTotal?`conic-gradient(${slices.join(',')})`:'#242c31';pie.setAttribute('aria-label',tagTotal?`Signal tag mix: ${tagTotal} tags across ${total} classified events`:'No events classified yet');document.querySelector('#liveMixTotal').textContent=tagTotal;
}
function updateDevLatency(samples,processed,startedAt){
 if(!developerMode||!samples.length)return;const ordered=[...samples].sort((a,b)=>a-b),average=samples.reduce((sum,value)=>sum+value,0)/samples.length,p95=ordered[Math.min(ordered.length-1,Math.floor(ordered.length*.95))],latest=samples[samples.length-1],elapsed=Math.max(1,performance.now()-startedAt);
 document.querySelector('#latencyAvg').textContent=`${average.toFixed(0)} ms`;document.querySelector('#latencyP95').textContent=`${p95.toFixed(0)} ms`;document.querySelector('#latencyLatest').textContent=`${latest.toFixed(0)} ms`;document.querySelector('#latencyThroughput').textContent=`${(processed/elapsed*1000).toFixed(1)} ev/s`;
}
function updateStatus(run,pct){
 const input=run.input_tokens||0,output=run.output_tokens||0,total=input+output;document.querySelector('#processedCount').textContent=`${(run.processed_events||0).toLocaleString()} / ${(run.total_events||events.length).toLocaleString()}`;document.querySelector('#runProgress').style.width=`${pct}%`;document.querySelector('#runDetail').textContent=`${pct}%`;document.querySelector('#inputTokens').textContent=input.toLocaleString();document.querySelector('#outputTokens').textContent=output.toLocaleString();document.querySelector('#totalTokens').textContent=total.toLocaleString();document.querySelector('#tokenInBar').style.width=total?`${input/total*100}%`:'0';document.querySelector('#tokenOutBar').style.width=total?`${output/total*100}%`:'0';
}
async function loadSavedClassifications(model){
 events.forEach(event=>{event.signal='Unclassified';event.signals=[];event.best='—';event.score=null;event.verdict='—';event.classified=false;event.processedRank=0});processedRank=0;processedEvents=0;updateStatus({processed_events:0,total_events:events.length,input_tokens:0,output_tokens:0},0);renderAllEvents();renderRecommendations(document.querySelector('#personaSelect').value);updateLiveSignalMix();
}
async function runClassification(){
 if(classificationRunning)return;const panel=document.querySelector('#runPanel'),button=document.querySelector('#runBtn'),state=document.querySelector('#runState'),status=document.querySelector('#runStatus'),activity=document.querySelector('#modelActivity'),model=document.querySelector('#modelSelect').value,latencySamples=[],startedAt=performance.now();
 classificationRunning=true;latestProcessedFirst=true;processedRank=0;events.forEach(event=>{event.signal='Unclassified';event.signals=[];event.best='—';event.score=null;event.verdict='—';event.classified=false;event.processedRank=0});renderAllEvents();renderRecommendations();updateLiveSignalMix();panel.classList.remove('complete');panel.classList.add('running');state.textContent='RUNNING';button.disabled=true;status.textContent=`Starting ${modelLabel(model)}…`;activity.textContent='Connecting to the public Simple Jev classifier API.';updateStatus({processed_events:0,total_events:events.length,input_tokens:0,output_tokens:0},0);
 try{
  let offset=0,last={model,total_events:events.length,processed_events:0,input_tokens:0,output_tokens:0,total_latency_ms:0},lastRequestStarted=0;activity.textContent='Connected to the public Simple Jev classifier API.';
  while(offset<events.length){
   const batchEnd=Math.min(offset+MAX_BATCH_SIZE,events.length);status.textContent=`Classifying with ${modelLabel(model)}…`;activity.textContent=`Sending events ${offset+1}–${batchEnd} of ${events.length} to Simple Jev.`;
   const wait=Math.max(0,500-(Date.now()-lastRequestStarted));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   const batchEvents=events.slice(offset,batchEnd).map(event=>({source_id:event.sourceId,title:event.name,host:event.host,location:event.location,description:event.description,summary:event.summary,themes:event.themes,formats:event.formats,sponsors:event.sponsors}));
   lastRequestStarted=Date.now();const batch=await classifyBatch({model,events:batchEvents,rubric:classificationRubric()});batch.results.forEach(applyClassification);offset=batchEnd;processedEvents=offset;last={model,total_events:events.length,processed_events:offset,input_tokens:last.input_tokens+batch.input_tokens,output_tokens:last.output_tokens+batch.output_tokens,total_latency_ms:last.total_latency_ms+batch.batch_latency_ms,batch_latency_ms:batch.batch_latency_ms};const pct=Math.round(offset/events.length*100);latencySamples.push(batch.batch_latency_ms);updateStatus(last,pct);updateDevLatency(latencySamples,offset,startedAt);renderAllEvents();renderRecommendations(document.querySelector('#personaSelect').value);updateLiveSignalMix();
  }
  panel.classList.remove('running');panel.classList.add('complete');state.textContent='COMPLETE';status.textContent='Classification complete';activity.textContent=`${events.length.toLocaleString()} events classified with Simple Jev.`;showToast(`${events.length.toLocaleString()} events classified`);
 }catch(error){panel.classList.remove('running');state.textContent='ERROR';status.textContent='Run stopped';activity.textContent=error.message;showToast(error.message)}finally{classificationRunning=false;button.disabled=false;updateEventRendering()}
}
function switchView(name){document.getElementById(name)?.scrollIntoView({behavior:'smooth',block:'start'})}
function showToast(message){const toast=document.querySelector('#toast');toast.textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3200)}

document.querySelectorAll('.nav-item').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();switchView(a.getAttribute('href').slice(1))}));
document.querySelector('#personaSelect').addEventListener('change',e=>renderRecommendations(e.target.value));
document.querySelector('#eventSearch').addEventListener('input',renderAllEvents);
document.querySelectorAll('[data-signal]').forEach(button=>button.addEventListener('click',()=>{activeSignal=button.dataset.signal;document.querySelectorAll('[data-signal]').forEach(item=>item.classList.toggle('active',item===button));renderAllEvents()}));
document.querySelector('#runBtn').addEventListener('click',runClassification);
document.querySelector('#resetRubricBtn').addEventListener('click',()=>{criteria=defaultCriteria.map(item=>[...item]);renderCriteria()});
document.querySelector('#modelSelect').addEventListener('change',event=>{document.querySelector('#configCurrent').textContent=`SF calendar · ${modelLabel(event.target.value)}`;loadSavedClassifications(event.target.value)});
document.querySelector('#processedCount').textContent=`0 / ${events.length.toLocaleString()}`;document.querySelector('[data-signal="all"] b').textContent=events.length.toLocaleString();renderCriteria();renderRecommendations();renderAllEvents();updateLiveSignalMix();loadSavedClassifications(document.querySelector('#modelSelect').value);

function registerAgentTools(){const context=document.modelContext;if(!context?.registerTool)return;const controller=new AbortController(),register=tool=>Promise.resolve(context.registerTool(tool,{signal:controller.signal})).catch(()=>{});register({name:'navigate_signal_dashboard',title:'Navigate Signal dashboard',description:'Open a dashboard view: overview, events, or criteria.',inputSchema:{type:'object',properties:{view:{type:'string',enum:['overview','events','criteria']}},required:['view'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!['overview','events','criteria'].includes(input?.view))throw new Error('Invalid view');switchView(input.view);return{view:input.view,status:'visible'}}});register({name:'filter_sf_tech_week_events',title:'Filter SF Tech Week events',description:'Filter events by search text and any matching signal tag.',inputSchema:{type:'object',properties:{query:{type:'string'},signal:{type:'string',enum:['all','Investor access','Engineer talent','Research talent','Looking for a job','Sales pitch / noise']}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){switchView('events');activeSignal=input?.signal||'all';document.querySelector('#eventSearch').value=input?.query||'';document.querySelectorAll('[data-signal]').forEach(item=>item.classList.toggle('active',item.dataset.signal===activeSignal));renderAllEvents();return{matches:document.querySelectorAll('#allEventRows tr').length,signal:activeSignal,query:input?.query||''}}})}
registerAgentTools();
