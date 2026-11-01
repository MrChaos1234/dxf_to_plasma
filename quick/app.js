import {PART_TEMPLATES,createPart} from './shapes.js';
import {setDrawingSource,clearDrawing} from '../app.js';
const $=id=>document.getElementById(id),DRAFT_KEY='arc.parts.v1';
const sketches={
  rectangle:'<rect x="18" y="15" width="64" height="42" rx="2"/>',
  circle:'<circle cx="50" cy="36" r="25"/><circle cx="50" cy="36" r="10"/>',
  tab:'<path d="M31 62V28a19 19 0 0 1 38 0v34Z"/><circle cx="50" cy="28" r="7"/>',
  flange:'<circle cx="50" cy="36" r="27"/><circle cx="50" cy="36" r="10"/><circle cx="36" cy="22" r="3"/><circle cx="64" cy="22" r="3"/><circle cx="36" cy="50" r="3"/><circle cx="64" cy="50" r="3"/>',
  plate:'<rect x="15" y="12" width="70" height="48" rx="6"/><circle cx="50" cy="36" r="12"/><circle cx="25" cy="22" r="3"/><circle cx="75" cy="22" r="3"/><circle cx="25" cy="50" r="3"/><circle cx="75" cy="50" r="3"/>',
  strap:'<rect x="10" y="20" width="80" height="32" rx="16"/><circle cx="26" cy="36" r="6"/><circle cx="74" cy="36" r="6"/>'
};
let type='rectangle',values=Object.fromEntries(PART_TEMPLATES.map(t=>[t.id,{...t.defaults}])),part=null;
try {
  const saved=JSON.parse(localStorage.getItem(DRAFT_KEY));
  if(saved?.version===1&&PART_TEMPLATES.some(t=>t.id===saved.type)) {
    for(const t of PART_TEMPLATES)if(saved.values?.[t.id]){try{values[t.id]=createPart(t.id,saved.values[t.id]).parameters;}catch{/* Keep defaults for invalid drafts. */}}
    type=saved.type;
  }
} catch {/* A missing draft never prevents drawing a new part. */}
for(const t of PART_TEMPLATES) {
  const button=document.createElement('button');button.className='template-button';button.dataset.partType=t.id;
  button.setAttribute('aria-pressed',String(t.id===type));
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 72');svg.setAttribute('aria-hidden','true');
  // The pictograms are trusted static markup; all user input uses text/value properties.
  svg.innerHTML=sketches[t.id];
  const text=document.createElement('span'),name=document.createElement('strong'),description=document.createElement('small');name.textContent=t.name;description.textContent=t.description;text.append(name,description);
  button.append(svg,text);button.addEventListener('click',()=>{type=t.id;renderFields();rebuild();});$('template-list').append(button);
}
function renderFields() {
  const template=PART_TEMPLATES.find(t=>t.id===type);$('part-title').textContent=template.name;$('part-fields').replaceChildren();
  for(const [key,label,unit] of template.fields) {
    const row=document.createElement('label');row.className='field';row.textContent=label;
    const wrap=document.createElement('span');wrap.className='input-wrap';
    const input=document.createElement('input');input.type='number';input.id=`part-${key}`;input.dataset.parameter=key;input.value=values[type][key];input.step=key==='count'?'1':'any';input.min=key==='phase'?'-36000':'0';input.max=key==='count'?'32':key==='phase'?'36000':'10000';input.required=true;
    const suffix=document.createElement('span');suffix.textContent=unit;wrap.append(input,suffix);row.append(wrap);$('part-fields').append(row);
  }
  $('part-hint').textContent=type==='flange'?'Lochkreis = Durchmesser durch die Lochmitten. Winkel ab +X, gegen den Uhrzeigersinn.':type==='plate'?'Randabstände bis zur Lochmitte. Vier symmetrische Ecklöcher.':type==='circle'?'Innendurchmesser 0 = volle Scheibe.':type==='rectangle'?'Eckenradius 0 = scharfe Ecken.':type==='tab'?'Loch mittig im runden Kopf. Lochdurchmesser 0 = ohne Loch.':'Lochmitten in den beiden Rundungen. Lochdurchmesser 0 = ohne Löcher.';
  for(const button of document.querySelectorAll('[data-part-type]'))button.setAttribute('aria-pressed',String(button.dataset.partType===type));
}
function rebuild() {
  $('save-dxf').disabled=true;part=null;
  try {
    const input=Object.fromEntries([...$('part-fields').querySelectorAll('input')].map(e=>[e.dataset.parameter,e.value===''?NaN:e.valueAsNumber]));
    const next=createPart(type,input);values[type]={...next.parameters};part=next;
    setDrawingSource(part.dxf,part.filename);$('filename').textContent=part.name;
    $('part-status').classList.remove('error');$('part-status').textContent='Fertigmaße · Schnittfuge wird eingerechnet.';
    $('save-dxf').disabled=false;
    try {localStorage.setItem(DRAFT_KEY,JSON.stringify({version:1,type,values}));}
    catch {$('part-status').textContent='Maße gelten nur in diesem Tab. Browser-Speicher nicht verfügbar.';}
  } catch(error) {
    clearDrawing(error.message);$('filename').textContent='Maße prüfen';$('part-status').classList.add('error');$('part-status').textContent=error.message;
  }
}
$('part-form').addEventListener('submit',event=>event.preventDefault());
$('part-form').addEventListener('input',rebuild);
$('reset-part').addEventListener('click',()=>{values[type]={...PART_TEMPLATES.find(t=>t.id===type).defaults};renderFields();rebuild();});
$('save-dxf').addEventListener('click',()=>{
  if(!part)return;
  const url=URL.createObjectURL(new Blob([part.dxf],{type:'application/dxf'}));const a=document.createElement('a');a.href=url;a.download=part.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
renderFields();rebuild();
