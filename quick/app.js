import {PART_TEMPLATES,createPart} from './shapes.js';
import {STENCIL_FONTS} from './fonts.js';
import {addStencilText,fitStencilText,textPlacementForPart} from './text.js';
import {setDrawingSource,clearDrawing,setTextPlacementHandler} from '../app.js';
const $=id=>document.getElementById(id),DRAFT_KEY='arc.parts.v1';
const sketches={
  sign:'<rect x="10" y="15" width="80" height="42" rx="3"/><path d="M26 46l8-20 8 20m-12-7h9m13 7V26h9a5 5 0 0 1 0 10h-9m9 0a5 5 0 0 1 0 10h-9"/>',
  rectangle:'<rect x="18" y="15" width="64" height="42" rx="2"/>',
  circle:'<circle cx="50" cy="36" r="25"/><circle cx="50" cy="36" r="10"/>',
  tab:'<path d="M31 62V28a19 19 0 0 1 38 0v34Z"/><circle cx="50" cy="28" r="7"/>',
  flange:'<circle cx="50" cy="36" r="27"/><circle cx="50" cy="36" r="10"/><circle cx="36" cy="22" r="3"/><circle cx="64" cy="22" r="3"/><circle cx="36" cy="50" r="3"/><circle cx="64" cy="50" r="3"/>',
  plate:'<rect x="15" y="12" width="70" height="48" rx="6"/><circle cx="50" cy="36" r="12"/><circle cx="25" cy="22" r="3"/><circle cx="75" cy="22" r="3"/><circle cx="25" cy="50" r="3"/><circle cx="75" cy="50" r="3"/>',
  strap:'<rect x="10" y="20" width="80" height="32" rx="16"/><circle cx="26" cy="36" r="6"/><circle cx="74" cy="36" r="6"/>'
};
const TEXT_KEY='arc.parts-text.v1';
const textDefaults={enabled:false,text:'WERKSTATT',font:'allerta-stencil',height:22,tracking:1,lineGap:5,x:0,y:0,angle:0,bridges:'font',bridgeWidth:1.5,clearance:1};
let textSettings={...textDefaults};
try {const saved=JSON.parse(localStorage.getItem(TEXT_KEY));if(saved?.version===1){textSettings=Object.fromEntries(Object.keys(textDefaults).map(k=>[k,saved[k]??textDefaults[k]]));}}catch{}
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
  button.append(svg,text);button.addEventListener('click',()=>{type=t.id;if(type==='sign')textSettings.enabled=true;applyTextFields();renderFields();rebuild();});$('template-list').append(button);
}
function renderFields() {
  const template=PART_TEMPLATES.find(t=>t.id===type);$('part-title').textContent=template.name;$('part-fields').replaceChildren();
  for(const [key,label,unit] of template.fields) {
    const row=document.createElement('label');row.className='field';row.textContent=label;
    const wrap=document.createElement('span');wrap.className='input-wrap';
    const input=document.createElement('input');input.type='number';input.id=`part-${key}`;input.dataset.parameter=key;input.value=values[type][key];input.step=key==='count'?'1':'any';input.min=key==='phase'?'-36000':'0';input.max=key==='count'?'32':key==='phase'?'36000':'10000';input.required=true;
    const suffix=document.createElement('span');suffix.textContent=unit;wrap.append(input,suffix);row.append(wrap);$('part-fields').append(row);
  }
  $('part-hint').textContent=type==='flange'?'Lochkreis = Durchmesser durch die Lochmitten. Winkel ab +X, gegen den Uhrzeigersinn.':type==='plate'?'Randabstände bis zur Lochmitte. Vier symmetrische Ecklöcher.':type==='circle'?'Innendurchmesser 0 = volle Scheibe.':['rectangle','sign'].includes(type)?'Eckenradius 0 = scharfe Ecken.':type==='tab'?'Loch mittig im runden Kopf. Lochdurchmesser 0 = ohne Loch.':'Lochmitten in den beiden Rundungen. Lochdurchmesser 0 = ohne Löcher.';
  $('text-body').disabled=!['tab','strap'].includes(type);
  for(const button of document.querySelectorAll('[data-part-type]'))button.setAttribute('aria-pressed',String(button.dataset.partType===type));
}
function rebuild(options={}) {
  $('save-dxf').disabled=true;part=null;let stage='part',base=null;
  try {
    const input=Object.fromEntries([...$('part-fields').querySelectorAll('input')].map(e=>[e.dataset.parameter,e.value===''?NaN:e.valueAsNumber]));
    const next=createPart(type,input);base=next;values[type]={...next.parameters};stage='text';textSettings=readTextFields();part=addStencilText(next,textSettings);
    setDrawingSource(part.dxf,part.filename,options);$('filename').textContent=part.name;
    $('part-status').classList.remove('error');$('part-status').textContent='Fertigmaße · Schnittfuge wird eingerechnet.';
    $('save-dxf').disabled=false;
    $('text-status').textContent=part.textInfo?`${part.textInfo.width.toLocaleString('de-DE',{maximumFractionDigits:1})} × ${part.textInfo.height.toLocaleString('de-DE',{maximumFractionDigits:1})} mm · ${part.textInfo.contours} Textkonturen${part.textInfo.simplified?` · ${part.textInfo.simplified} kleine Schnittdetails entfallen`:''}`:'';
    $('text-status').classList.remove('error');
    try {localStorage.setItem(DRAFT_KEY,JSON.stringify({version:1,type,values}));localStorage.setItem(TEXT_KEY,JSON.stringify({version:1,...textSettings}));}
    catch {$('part-status').textContent='Maße gelten nur in diesem Tab. Browser-Speicher nicht verfügbar.';}
  } catch(error) {
    $('text-status').textContent=stage==='text'?error.message:'';$('text-status').classList.add('error');if(stage==='text'&&base){setDrawingSource(base.dxf,base.filename,{...options,blockExportReason:error.message});$('filename').textContent=base.name;}else{clearDrawing(error.message);$('filename').textContent='Maße prüfen';}$('part-status').classList.add('error');$('part-status').textContent=stage==='text'?'Beschriftung prüfen.':error.message;
  }
}
$('part-form').addEventListener('submit',event=>event.preventDefault());
$('part-form').addEventListener('input',rebuild);
$('reset-part').addEventListener('click',()=>{values[type]={...PART_TEMPLATES.find(t=>t.id===type).defaults};renderFields();rebuild();});
$('save-dxf').addEventListener('click',()=>{
  if(!part)return;
  const url=URL.createObjectURL(new Blob([part.dxf],{type:'application/dxf'}));const a=document.createElement('a');a.href=url;a.download=part.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
const textFields={text:'text-value',font:'text-font',height:'text-height',tracking:'text-tracking',lineGap:'text-line-gap',angle:'text-angle',x:'text-x',y:'text-y',bridges:'text-bridges',bridgeWidth:'text-bridge-width',clearance:'text-clearance'};
for(const font of STENCIL_FONTS){$('text-font').add(new Option(font.name,font.id));}
const fontStyle=document.createElement('style');fontStyle.textContent=STENCIL_FONTS.map(f=>`@font-face{font-family:arc-${f.id};src:url(data:font/woff;base64,${f.data}) format('woff');font-display:swap;}`).join('');document.head.append(fontStyle);
function readTextFields() {
  const result={enabled:$('text-enabled').checked};
  for(const [key,id] of Object.entries(textFields)){const e=$(id);result[key]=e.type==='number'?e.valueAsNumber:e.value;}
  return result;
}
function updateTextSample() {
  $('text-controls').hidden=!$('text-enabled').checked;$('text-bridge-width').disabled=$('text-bridges').value==='font';
  $('text-sample').style.fontFamily=`arc-${$('text-font').value}`;$('text-sample').textContent=$('text-value').value.toLocaleUpperCase('de-DE');
}
function applyTextFields() {
  $('text-enabled').checked=!!textSettings.enabled;
  for(const [key,id] of Object.entries(textFields))$(id).value=textSettings[key];
  updateTextSample();
}
for(const id of ['text-enabled',...Object.values(textFields)])$(id).addEventListener('input',()=>{updateTextSample();rebuild({preservePlacement:true,preserveView:true});});
$('text-center').addEventListener('click',()=>{$('text-x').value=0;$('text-y').value=0;rebuild({preservePlacement:true,preserveView:true});});
function basePart() {return createPart(type,Object.fromEntries([...$('part-fields').querySelectorAll('input')].map(e=>[e.dataset.parameter,e.valueAsNumber])));}
function fitText(align=false) {
  let base=null;
  try {
    base=basePart();
    if(align)for(const [key,value] of Object.entries(textPlacementForPart(base)))$(textFields[key]).value=value;
    const best=fitStencilText(base,readTextFields());
    $('text-height').value=best;$('text-enabled').checked=true;updateTextSample();rebuild({preservePlacement:true,preserveView:true});
  }catch(error){part=null;$('save-dxf').disabled=true;if(base)setDrawingSource(base.dxf,base.filename,{preservePlacement:true,preserveView:true,blockExportReason:error.message});else clearDrawing(error.message);$('text-status').textContent=error.message;$('text-status').classList.add('error');}
}
$('text-fit').addEventListener('click',()=>fitText());
$('text-body').addEventListener('click',()=>fitText(true));
for(const [id,delta] of [['text-rotate-left',-90],['text-rotate-right',90]])$(id).addEventListener('click',()=>{$('text-angle').value=(Number($('text-angle').value)||0)+delta;rebuild({preservePlacement:true,preserveView:true});});
setTextPlacementHandler(point=>{
  $('text-x').value=Number(point.x.toFixed(2));$('text-y').value=Number(point.y.toFixed(2));$('text-enabled').checked=true;updateTextSample();rebuild({preservePlacement:true,preserveView:true});
});
applyTextFields();renderFields();rebuild();
