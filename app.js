import {parseDXF, generateGCode} from './core.js';
import {prepareToolpaths,toolpathLength,inferCutSides,orderToolpaths} from './toolpaths.js';
import {positionDrawing,positionToolpaths} from './layout.js';
import {PRESET_STORAGE_KEY,validatePreset,upsertPreset,parsePresetLibrary,serializePresetLibrary} from './presets.js';

const $ = id => document.getElementById(id);
let source='',drawing=null,generated='',name='zeichnung.dxf',uploadVersion=0;
let cutSides=[],selected=null,activeTool='select',toolpaths=null,history=[];
let cutOrigins=[],analysis=[];
let scene=null,scenePaths=[],geometryCache=null,viewMapping=null,snapPoints=[];
const preview=$('preview'), view={zoom:1,x:0,y:0,frame:null};
const numeric=['feed','delay','kerf','overlap'];
const MACHINE_STORAGE_KEY='arc.machine.v1';
const validMachine=value=>value&&typeof value.on==='string'&&typeof value.off==='string'&&[value.on,value.off].every(command=>/^M\d{1,3}(?:\s+[SP]\d+(?:\.\d+)?)?$/i.test(command.trim()))&&value.on.trim().toUpperCase()!==value.off.trim().toUpperCase();
let presets=[],activeThickness=null,presetMessage='';
const sideLabel={on:'Auf Linie',inside:'Innen',outside:'Außen',unset:'Seite wählen'};
const sideColor={on:'#65e0b3',inside:'#f2bb67',outside:'#71bfff',unset:'#bdb6a6'};
function settings() {
  const placement=Object.fromEntries([['angle','angle'],['moveX','move-x'],['moveY','move-y'],['zeroX','zero-x'],['zeroY','zero-y']].map(([key,id])=>[key,Number($(id).value || NaN)]));
  return {...Object.fromEntries(numeric.map(id=>[id,Number($(id).value || NaN)])),on:$('on').value,off:$('off').value,dwellUnit:$('dwell-unit').value,origin:false,cutSides,cutOrder:$('cut-order').value,contourAnalysis:analysis,placement};
}
function notice(messages,error=false,info=false) {
  $('messages').replaceChildren();
  if (!messages.length) return;
  const div=document.createElement('div');div.className='notice'+(error?' error':info?' info':'');
  div.textContent=messages.join(' ');$('messages').append(div);
}
function analyzeDrawing() {
  try {return inferCutSides(drawing);}
  catch(error) {return drawing.paths.map(()=>({side:null,reason:`Die automatische Analyse konnte nicht abgeschlossen werden: ${error.message} Bitte wähle die Schnittseite manuell.`}));}
}
function update() {
  updatePresetStatus();
  const milliseconds=$('dwell-unit').value==='ms',delay=Number($('delay').value);
  $('dwell-hint').textContent=`Mach3: „G04 Dwell in ms“ ${milliseconds?'aktivieren':'deaktivieren'}. `+(Number.isFinite(delay)&&delay>=0?(delay===0?'0 s: keine Wartezeit.':`${String(delay).replace('.',',')} s → G4 P${Number((delay*(milliseconds?1000:1)).toFixed(6))}.`):'Einstechzeit wird in Sekunden eingegeben.');
  generated='';toolpaths=null;scene=null;scenePaths=[];$('download').disabled=true;$('linecount').textContent='';
  if (!drawing) {$('code').textContent='Keine Zeichnung geladen.';updateInspector();render();return;}
  try {
    const options=settings();
    const worldPlacement={...options.placement,zeroX:0,zeroY:0};
    scene=positionDrawing(drawing,worldPlacement);
    const key=JSON.stringify([options.kerf,options.overlap,cutSides,options.cutOrder]);
    if(!geometryCache||geometryCache.drawing!==drawing||geometryCache.key!==key)geometryCache={drawing,key,paths:orderToolpaths(drawing,prepareToolpaths(drawing,options,{allowUnassigned:true}),options)};
    toolpaths=geometryCache.paths;scenePaths=positionToolpaths(drawing,toolpaths,worldPlacement);
    const b=scene.bounds;$('size').textContent=`${(b.maxX-b.minX).toFixed(1)} × ${(b.maxY-b.minY).toFixed(1)} mm`;
    $('order-summary').textContent=options.cutOrder==='file'?'Originale DXF-Reihenfolge':`Innen zuerst · ${toolpaths.length?`zuletzt: Kontur ${toolpaths.at(-1).sourceIndex+1}`:'außen zuletzt'}`;
    const pending=cutSides.filter(side=>side===null).length;
    const auto=cutOrigins.filter(origin=>origin==='auto').length;
    const messages=[...drawing.warnings,...(auto?[`Automatisch zugeordnet: ${auto}.`]:[])];
    const split=toolpaths.length-new Set(toolpaths.map(p=>p.sourceIndex)).size;
    if(split>0)messages.push(`Zusätzliche Bahnen durch Schnittfugenkorrektur: ${split}. Alle werden exportiert.`);
    if(pending) {
      messages.push(`Konturen ohne Schnittseite: ${pending}. Vor dem Export manuell zuordnen.`);
      $('code').textContent='Export wartet auf die Zuordnung aller Konturen.';
      notice(messages,drawing.incomplete);
    } else {
      generated=generateGCode(drawing,options,toolpaths);
      $('code').textContent=generated;
      $('linecount').textContent=`${generated.trim().split('\n').length.toLocaleString('de-DE')} Zeilen`;
      $('download').disabled=false;notice(messages,false,!drawing.warnings.length&&!split);
    }
  } catch(error) {$('code').textContent='Behebe den oben angezeigten Fehler, um G-Code zu erzeugen.';notice([...drawing.warnings,error.message],true);}
  $('length').textContent=toolpaths?`${toolpathLength(toolpaths).toFixed(1)} mm`:'— mm';
  updateInspector();render();
}
function load() {
  drawing=null;cutSides=[];cutOrigins=[];analysis=[];selected=null;history=[];geometryCache=null;Object.assign(view,{zoom:1,x:0,y:0,frame:null});
  try {
    drawing=parseDXF(source,$('units')?.value || 'mm');analysis=analyzeDrawing();
    cutSides=analysis.map(result=>result.side);cutOrigins=cutSides.map(side=>side===null?null:'auto');
    resetPlacementFields();
    const b=drawing.bounds;
    $('size').textContent=`${(b.maxX-b.minX).toFixed(1)} × ${(b.maxY-b.minY).toFixed(1)} mm`;
    $('contours').textContent=drawing.paths.length.toLocaleString();
    $('empty').hidden=true;
  } catch(error) {
    $('size').textContent='— × — mm';$('contours').textContent='—';$('length').textContent='— mm';
    $('empty').hidden=false;notice([error.message],true);
  }
  update();
}
export function setDrawingSource(text,filename='teil.dxf') {
  ++uploadVersion;source=text;name=filename;
  if($('filename'))$('filename').textContent=filename;
  if($('filehint'))$('filehint').textContent='Parametrisches Teil · mm';
  notice([]);load();
}
export function clearDrawing(message) {
  ++uploadVersion;source='';drawing=null;cutSides=[];cutOrigins=[];analysis=[];selected=null;history=[];geometryCache=null;
  $('size').textContent='— × — mm';$('contours').textContent='—';$('length').textContent='— mm';
  $('empty').hidden=false;update();notice([message],true);
}
async function open(file) {
  if (!file) return;
  const version=++uploadVersion;
  drawing=null;source='';cutSides=[];cutOrigins=[];analysis=[];selected=null;history=[];notice([]);update();
  $('size').textContent='— × — mm';$('contours').textContent='—';$('length').textContent='— mm';
  $('empty').hidden=false;$('filename').textContent=file.name;$('filehint').textContent='Zeichnung wird gelesen …';
  if (file.size>10*1024*1024) {$('filehint').textContent='Datei größer als 10 MB';notice(['Die Datei ist zu groß. Verwende eine ASCII-DXF-Datei mit weniger als 10 MB.'],true);return;}
  try {
    const buffer=await file.arrayBuffer();if(version!==uploadVersion)return;
    const bytes=new Uint8Array(buffer);
    const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
    source=new TextDecoder(encoding).decode(buffer);name=file.name;
    $('filehint').textContent=`${(file.size/1024).toFixed(1)} KB · zum Ersetzen klicken`;load();
  } catch(error) {
    if(version!==uploadVersion)return;
    source='';$('filehint').textContent='Zeichnung konnte nicht gelesen werden';notice(['Die Datei konnte nicht gelesen werden. Bitte wähle sie erneut aus.'],true);
  }
}

function updateInspector() {
  const path=selected===null?null:drawing?.paths[selected];
  $('selected-title').textContent=path?`Kontur ${selected+1}`:'Keine Kontur ausgewählt';
  $('selected-detail').textContent=path?`Ebene ${path.layer} · ${path.closed?'Geschlossene Kontur':'Offene Kontur — nur Auf Linie'}`:'Kontur in Zeichnung oder Liste anklicken.';
  $('selected-reason').textContent=path?(cutOrigins[selected]==='manual'?`Manuell: ${sideLabel[cutSides[selected]]}.`:`${cutSides[selected]===null?'Manuelle Prüfung nötig. ':''}${analysis[selected]?.reason || 'Wähle eine Schnittseite manuell.'}`):'Offene und uneindeutige Konturen manuell zuordnen.';
  document.querySelectorAll('[data-side]').forEach(button=>{
    button.disabled=!path || (!path.closed && button.dataset.side!=='on');
    button.setAttribute('aria-pressed',String(!!path && cutSides[selected]===button.dataset.side));
  });
  const pending=cutSides.filter(side=>side===null).length;
  $('assignment-count').textContent=pending?`${pending} ZU PRÜFEN`:`${cutOrigins.filter(origin=>origin==='auto').length} AUTO`;
  $('undo').disabled=!history.length;$('reset-sides').disabled=!cutSides.some(s=>s!==null);$('auto-detect').disabled=!drawing;
  const list=$('contour-list');list.replaceChildren();
  if (!drawing) {const p=document.createElement('p');p.className='list-empty';p.textContent='Keine Konturen.';list.append(p);return;}
  drawing.paths.forEach((p,i)=>{
    const row=document.createElement('button');row.className='contour-row'+(selected===i?' selected':'');
    row.dataset.contourRow=i;row.setAttribute('aria-pressed',String(selected===i));
    const dot=document.createElement('span');dot.className='contour-dot';dot.style.background=sideColor[cutSides[i] ?? 'unset'];
    const title=document.createElement('span');title.className='contour-row-name';title.textContent=`Kontur ${i+1}`;
    const meta=document.createElement('small');meta.textContent=`${p.closed?'Geschlossen':'Offen'} · ${p.layer} · ${cutOrigins[i]==='auto'?'Auto':cutOrigins[i]==='manual'?'Manuell':'Prüfen'}`;title.append(meta);
    const badge=document.createElement('span');badge.className='side-badge'+(cutSides[i]===null?' unassigned':'');badge.textContent=sideLabel[cutSides[i] ?? 'unset'];
    badge.dataset.cutSide=cutSides[i]??'unset';
    const orders=(toolpaths||[]).map((path,index)=>path.sourceIndex===i?index+1:null).filter(Boolean);
    const sequence=document.createElement('span');sequence.className='cut-sequence';sequence.textContent=orders.length?`#${orders[0]}${orders.length>1?`–${orders.at(-1)}`:''}`:'?';sequence.title=orders.length?'Schnittreihenfolge':'Nicht zugeordnet';
    row.append(dot,sequence,title,badge);row.addEventListener('click',()=>selectContour(i,false));list.append(row);
  });
}
function assignSide(index,side) {
  if (!drawing?.paths[index])return;
  selected=index;
  if(side!=='on' && !drawing.paths[index].closed) {
    updateInspector();render();notice([...drawing.warnings,`Kontur ${index+1} ist offen. Wähle Auf Linie oder schließe die Lücken im CAD, um Innen oder Außen zu verwenden.`],true);return;
  }
  if(cutSides[index]!==side||cutOrigins[index]!=='manual') {history.push({sides:cutSides.slice(),origins:cutOrigins.slice()});cutSides[index]=side;cutOrigins[index]='manual';}
  update();
}
function selectContour(index,paint=true) {
  if (!drawing?.paths[index])return;
  selected=index;
  if(paint && ['inside','outside','on'].includes(activeTool))assignSide(index,activeTool);
  else {updateInspector();render();}
}
document.querySelectorAll('[data-side]').forEach(button=>button.addEventListener('click',()=>assignSide(selected,button.dataset.side)));
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{
  activeTool=button.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  $('editor-help').textContent=activeTool==='select'?'Kontur anklicken · Ziehen verschiebt die Ansicht.':activeTool==='move'?'Zeichnung ziehen · Nullpunkt bleibt fest.':activeTool==='zero'?'Nullpunkt anklicken · Fang an Endpunkten, Mittelpunkten und Begrenzungen.':`${sideLabel[activeTool]}: Konturen zum Zuordnen anklicken.`;
  preview.classList.toggle('painting',['inside','outside','on','zero'].includes(activeTool));
  preview.classList.toggle('moving-drawing',activeTool==='move');render();
}));
$('undo').addEventListener('click',()=>{if(history.length){const previous=history.pop();cutSides=previous.sides;cutOrigins=previous.origins;update();}});
$('reset-sides').addEventListener('click',()=>{history.push({sides:cutSides.slice(),origins:cutOrigins.slice()});cutSides=cutSides.map(()=>null);cutOrigins=cutOrigins.map(()=>null);update();});
$('auto-detect').addEventListener('click',()=>{
  if(!drawing)return;
  analysis=analyzeDrawing();geometryCache=null;history.push({sides:cutSides.slice(),origins:cutOrigins.slice()});
  cutSides=cutSides.map((side,i)=>cutOrigins[i]==='manual'?side:analysis[i].side);
  cutOrigins=cutOrigins.map((origin,i)=>origin==='manual'?origin:cutSides[i]===null?null:'auto');update();
});

function render() {
  const {width,height}=preview.getBoundingClientRect();preview.replaceChildren();
  if(!width||!height)return;
  preview.setAttribute('viewBox',`0 0 ${width} ${height}`);if(!drawing)return;
  const displayed=scene||drawing;
  const zero=[Number($('zero-x').value),Number($('zero-y').value)];
  if(!view.frame) {
    const frame={...displayed.bounds};
    for(const path of scenePaths)for(const [x,y] of path.points){frame.minX=Math.min(frame.minX,x);frame.maxX=Math.max(frame.maxX,x);frame.minY=Math.min(frame.minY,y);frame.maxY=Math.max(frame.maxY,y);}
    if(scene&&zero.every(Number.isFinite)){frame.minX=Math.min(frame.minX,zero[0]);frame.maxX=Math.max(frame.maxX,zero[0]);frame.minY=Math.min(frame.minY,zero[1]);frame.maxY=Math.max(frame.maxY,zero[1]);}
    view.frame=frame;
  }
  const b=view.frame;
  const w=b.maxX-b.minX,h=b.maxY-b.minY;
  const scale=Math.max(1e-9,Math.min((width-100)/Math.max(w,1),(height-100)/Math.max(h,1)))*view.zoom;
  const project=p=>[(p[0]-(b.minX+b.maxX)/2)*scale+width/2+view.x,height/2-(p[1]-(b.minY+b.maxY)/2)*scale+view.y];
  viewMapping={scale,project,unproject:(clientX,clientY)=>{const rect=preview.getBoundingClientRect();return [(clientX-rect.left-width/2-view.x)/scale+(b.minX+b.maxX)/2,(height/2+view.y-(clientY-rect.top))/scale+(b.minY+b.maxY)/2];}};
  const element=(tag,attributes)=>{
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);preview.append(node);return node;
  };
  const coords=p=>p.map(v=>v.toFixed(3)).join(',');
  const pathData=path=>`M${coords(project(path.segments[0].start))}`+path.segments.map(s=>{
    if(s.type==='line')return ` L${coords(project(s.end))}`;
    const radius=Math.hypot(s.start[0]-s.center[0],s.start[1]-s.center[1])*scale;
    return ` A${radius.toFixed(4)},${radius.toFixed(4)} 0 ${Math.abs(s.sweep)>Math.PI+1e-8?1:0} ${s.sweep<0?1:0} ${coords(project(s.end))}`;
  }).join('');
  const materialView=!!$('material-preview')?.checked&&!!$('text-enabled')?.checked;
  if(materialView)element('path',{d:displayed.paths.map(path=>pathData(path)+(path.closed?' Z':'')).join(' '),fill:'#c1c9ae','fill-rule':'evenodd','pointer-events':'none',class:'material-preview'});
  // Reference geometry remains visible independently of the compensated paths.
  displayed.paths.forEach((path,i)=>element('path',{d:pathData(path),fill:'none',stroke:sideColor[cutSides[i]??'unset'],'stroke-width':cutSides[i]===null?1.8:1.2,'stroke-dasharray':cutSides[i]===null?'5 4':'3 4',opacity:materialView?0:cutSides[i]===null?0.9:0.65,class:'drawing-reference','data-reference-side':cutSides[i]??'unset','pointer-events':'none'}));
  if(document.body.classList.contains('parts-app')&&scene) {
    const bounds=scene.bounds,a=project([bounds.minX,bounds.minY]),b=project([bounds.maxX,bounds.maxY]);
    const y=a[1]+26,x=a[0]-26,color='#a4b4a7';
    element('path',{d:`M${a[0]},${y-5}v10 M${a[0]},${y}H${b[0]} M${b[0]},${y-5}v10 M${x-5},${a[1]}h10 M${x},${a[1]}V${b[1]} M${x-5},${b[1]}h10`,fill:'none',stroke:color,'stroke-width':0.8,opacity:0.6,'pointer-events':'none',class:'part-dimension'});
    const dimension=(px,py,value,rotate=false)=>element('text',{x:px,y:py,fill:color,'font-family':'monospace','font-size':10,'text-anchor':'middle',...(rotate?{transform:`rotate(-90 ${px} ${py})`}:{}),'paint-order':'stroke',stroke:'#1d292b','stroke-width':4,'pointer-events':'none',class:'part-dimension'}).textContent=value.toLocaleString('de-DE',{maximumFractionDigits:2})+' mm';
    dimension((a[0]+b[0])/2,y-5,bounds.maxX-bounds.minX);dimension(x-6,(a[1]+b[1])/2,bounds.maxY-bounds.minY,true);
  }
  let previous=null;
  for(const [order,path] of scenePaths.entries()) {
    const points=path.points.map(project),picked=selected===path.sourceIndex,color=sideColor[path.cutSide];
    if(previous&&!materialView)element('path',{d:`M${coords(previous)} L${coords(points[0])}`,fill:'none',stroke:'#688e82','stroke-width':1,'stroke-dasharray':'4 5','pointer-events':'none'});
    const line=pathData(path);
    const band=Number($('kerf').value)*scale;
    if(!materialView&&band>2 && Number.isFinite(band))element('path',{d:line,fill:'none',stroke:color,'stroke-width':band,opacity:picked?0.18:0.08,'stroke-linejoin':'round','pointer-events':'none'});
    if(picked)element('path',{d:line,fill:'none',stroke:'#ffffff','stroke-width':7,opacity:0.14,'stroke-linejoin':'round','pointer-events':'none'});
    element('path',{d:line,fill:'none',stroke:color,'stroke-width':picked?2.8:2,'stroke-linejoin':'round','stroke-linecap':'round',opacity:materialView&&!picked?0:1,class:'toolpath','data-source':path.sourceIndex,'data-cut-order':order+1,'data-cut-side':path.cutSide,'pointer-events':'none'});
    if(!materialView&&path.overlapSegments?.length) {
      const overlap=element('path',{d:pathData({segments:path.overlapSegments}),fill:'none',stroke:'#ee9ddd','stroke-width':picked?4:3,'stroke-dasharray':'4 2','stroke-linecap':'round',class:'overlap-path','data-source':path.sourceIndex,'pointer-events':'none'});
      const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`${path.overlapLength} mm Überlappung`;overlap.append(title);
    }
    element('circle',{cx:points[0][0],cy:points[0][1],r:picked?4:2.5,fill:color,opacity:materialView?0:1,'pointer-events':'none'});
    element('text',{x:points[0][0]+8,y:points[0][1]-9,fill:color,'font-family':'sans-serif','font-size':11,'font-weight':600,'paint-order':'stroke',stroke:'#14262b','stroke-width':3,'pointer-events':'none',class:'cut-number',opacity:materialView?0:1}).textContent=`#${order+1}`;
    previous=project(path.overlapSegments?.at(-1)?.end || path.segments.at(-1).end);
  }
  // Wide invisible strokes make small paths practical to pick with mouse or touch.
  displayed.paths.forEach((path,index)=>{
    const points=path.points.map(project);
    const hit=element('path',{d:pathData(path),fill:'none',stroke:'transparent','stroke-width':16,'pointer-events':'stroke','data-contour':index,tabindex:0,role:'button','aria-label':`Kontur ${index+1}, ${path.closed?'geschlossen':'offen'}, ${sideLabel[cutSides[index] ?? 'unset']}`,'aria-pressed':selected===index,class:'contour-hit'});
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=`Kontur ${index+1} · ${sideLabel[cutSides[index] ?? 'unset']} · ${path.layer}`;hit.append(title);
    const start=points[0];
    if(cutSides[index]===null)element('text',{x:start[0]+8,y:start[1]-9,fill:'#d6cbb5','font-family':'sans-serif','font-size':11,'pointer-events':'none'}).textContent='?';
    if(selected===index && (!toolpaths||cutSides[index]===null))element('path',{d:pathData(path),fill:'none',stroke:'#f2bb67','stroke-width':2,'pointer-events':'none'});
  });
  snapPoints=[];
  if(scene) {
    const bounds=scene.bounds;
    for(const path of scene.paths)for(const segment of path.segments) {
      if(snapPoints.length>1500)break;
      snapPoints.push(segment.start,segment.end);if(segment.center)snapPoints.push(segment.center);
    }
    for(const x of [bounds.minX,(bounds.minX+bounds.maxX)/2,bounds.maxX])for(const y of [bounds.minY,(bounds.minY+bounds.maxY)/2,bounds.maxY])snapPoints.push([x,y]);
    if(activeTool==='zero')for(const point of snapPoints){const p=project(point);element('circle',{cx:p[0],cy:p[1],r:2.5,fill:'none',stroke:'#e3d9ca',opacity:0.5,'pointer-events':'none',class:'zero-snap'});}
    const p=project(zero);
    element('path',{d:`M0,${p[1]} H${width} M${p[0]},0 V${height}`,stroke:'#cc7770',opacity:0.24,'stroke-width':1,'stroke-dasharray':'6 6','pointer-events':'none',class:'work-axes'});
    element('circle',{cx:p[0],cy:p[1],r:6,fill:'#14262b',stroke:'#f49389','stroke-width':1.5,'pointer-events':'none',class:'work-zero','data-world-x':zero[0],'data-world-y':zero[1]});
    element('path',{d:`M${p[0]-10},${p[1]} h20 M${p[0]},${p[1]-10} v20`,stroke:'#f49389','stroke-width':1.3,'pointer-events':'none'});
    element('text',{x:p[0]+11,y:p[1]+17,fill:'#f49389','font-family':'monospace','font-size':10,'paint-order':'stroke',stroke:'#14262b','stroke-width':3,'pointer-events':'none'}).textContent='X0 Y0';
  }
  element('text',{x:20,y:24,fill:'#8eafa1','font-family':'monospace','font-size':10,'pointer-events':'none'}).textContent=`${(displayed.bounds.maxX-displayed.bounds.minX).toFixed(1)} × ${(displayed.bounds.maxY-displayed.bounds.minY).toFixed(1)} mm · ${Math.round(view.zoom*100)}%`;
}

let drag=null,suppressClick=false;
function zeroCandidate(event) {
  let point=viewMapping.unproject(event.clientX,event.clientY),best=12,snapped=false;
  const rect=preview.getBoundingClientRect(),mouse=[event.clientX-rect.left,event.clientY-rect.top];
  for(const candidate of snapPoints) {
    const p=viewMapping.project(candidate),distance=Math.hypot(p[0]-mouse[0],p[1]-mouse[1]);
    if(distance<best){best=distance;point=candidate;snapped=true;}
  }
  return {point:point.map(v=>Number(v.toFixed(snapped?6:3))),snapped};
}
preview.addEventListener('click',event=>{
  if(suppressClick)return;
  if(activeTool==='zero'&&scene&&viewMapping) {
    const candidate=zeroCandidate(event);$('zero-x').value=candidate.point[0];$('zero-y').value=candidate.point[1];update();return;
  }
  if(activeTool==='move')return;
  const target=event.target.closest('[data-contour]');
  if(target)selectContour(Number(target.dataset.contour));
});
preview.addEventListener('keydown',event=>{
  const target=event.target.closest('[data-contour]');
  if(target && ['Enter',' '].includes(event.key)){event.preventDefault();const index=Number(target.dataset.contour);selectContour(index);preview.querySelector(`[data-contour="${index}"]`)?.focus({preventScroll:true});}
});
function zoomBy(factor,x=0,y=0) {
  const next=Math.max(0.3,Math.min(30,view.zoom*factor)),ratio=next/view.zoom;
  view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.zoom=next;render();
}
preview.addEventListener('wheel',event=>{
  if(!drawing)return;event.preventDefault();
  const rect=preview.getBoundingClientRect();zoomBy(event.deltaY<0?1.15:1/1.15,event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2);
},{passive:false});
preview.addEventListener('pointerdown',event=>{
  if(event.button!==0 || !drawing||activeTool==='zero')return;
  if(activeTool==='move'&&!scene)return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:view.x,startY:view.y,moved:false,kind:activeTool==='move'?'drawing':'view',moveX:Number($('move-x').value),moveY:Number($('move-y').value),scale:viewMapping.scale};suppressClick=false;
});
preview.addEventListener('pointermove',event=>{
  if(activeTool==='zero'&&scene&&viewMapping&&!drag) {
    const candidate=zeroCandidate(event),p=viewMapping.project(candidate.point);
    let marker=$('zero-target');
    if(!marker){marker=document.createElementNS('http://www.w3.org/2000/svg','circle');marker.id='zero-target';marker.setAttribute('r','8');marker.setAttribute('fill','none');marker.setAttribute('stroke','#f49389');marker.setAttribute('pointer-events','none');preview.append(marker);}
    marker.setAttribute('cx',p[0]);marker.setAttribute('cy',p[1]);return;
  }
  if(!drag || drag.id!==event.pointerId)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.moved && Math.hypot(dx,dy)<5)return;
  if(!drag.moved){drag.moved=true;preview.setPointerCapture(event.pointerId);}
  if(drag.kind==='drawing') {
    $('move-x').value=Number((drag.moveX+dx/drag.scale).toFixed(3));$('move-y').value=Number((drag.moveY-dy/drag.scale).toFixed(3));update();
  } else {view.x=drag.startX+dx;view.y=drag.startY+dy;render();}
});
preview.addEventListener('pointerleave',()=>$('zero-target')?.remove());
const endDrag=()=>{suppressClick=!!drag?.moved;drag=null;setTimeout(()=>{suppressClick=false;},0);};
preview.addEventListener('pointerup',endDrag);preview.addEventListener('pointercancel',endDrag);
$('zoom-in').addEventListener('click',()=>zoomBy(1.4));$('zoom-out').addEventListener('click',()=>zoomBy(1/1.4));
$('material-preview')?.addEventListener('change',render);
$('fit').addEventListener('click',()=>{Object.assign(view,{zoom:1,x:0,y:0,frame:null});render();});

function resetPlacementFields() {
  for(const id of ['angle','move-x','move-y'])$(id).value=0;
  $('zero-x').value=drawing?drawing.bounds.minX:0;$('zero-y').value=drawing?drawing.bounds.minY:0;
}
function placementChanged() {
  Object.assign(view,{zoom:1,x:0,y:0,frame:null});update();
}
for(const id of ['angle','move-x','move-y','zero-x','zero-y'])$(id).addEventListener('input',placementChanged);
$('cut-order').addEventListener('change',update);
$('rotate-left').addEventListener('click',()=>{$('angle').value=(Number($('angle').value)||0)-90;placementChanged();});
$('rotate-right').addEventListener('click',()=>{$('angle').value=(Number($('angle').value)||0)+90;placementChanged();});
const setZero=point=>{$('zero-x').value=Number(point[0].toFixed(6));$('zero-y').value=Number(point[1].toFixed(6));placementChanged();};
$('zero-lower-left').addEventListener('click',()=>{if(scene)setZero([scene.bounds.minX,scene.bounds.minY]);});
$('zero-center').addEventListener('click',()=>{if(scene)setZero([(scene.bounds.minX+scene.bounds.maxX)/2,(scene.bounds.minY+scene.bounds.maxY)/2]);});
$('zero-cad').addEventListener('click',()=>setZero([0,0]));
$('reset-placement').addEventListener('click',()=>{resetPlacementFields();placementChanged();});

$('file')?.addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';open(file);});
for(const drop of [$('dropzone'),...($('file')?[preview.parentElement]:[])].filter(Boolean)) {
  for(const type of ['dragenter','dragover'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('drag');});
  for(const type of ['dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('drag');});
  drop.addEventListener('drop',event=>open(event.dataTransfer.files[0]));
}
$('units')?.addEventListener('change',()=>{if(source)load();});
$('settings').addEventListener('submit',event=>event.preventDefault());
const settingsChanged=event=>{
  if(['on','off','dwell-unit'].includes(event.target.id)) {
    const machine={version:1,on:$('on').value.trim().toUpperCase(),off:$('off').value.trim().toUpperCase(),dwellUnit:$('dwell-unit').value};
    if(validMachine(machine))try{localStorage.setItem(MACHINE_STORAGE_KEY,JSON.stringify(machine));}
    catch{$('storage-status').textContent='Plasmabefehle gelten nur in diesem Tab. Browser-Speicher nicht verfügbar.';$('storage-status').hidden=false;}
  }
  presetMessage='';update();
};
$('settings').addEventListener('input',settingsChanged);
$('dwell-unit').addEventListener('change',settingsChanged);
if(typeof ResizeObserver!=='undefined')new ResizeObserver(render).observe(preview.parentElement);else window.addEventListener('resize',render);
function downloadText(contents,filename,type='text/plain') {
  const url=URL.createObjectURL(new Blob([contents],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('download').addEventListener('click',()=>{if(generated)downloadText(generated,name.replace(/\.dxf$/i,'')+'.nc');});
$('sample')?.addEventListener('click',async()=>{
  try{
    const response=await fetch('sample.dxf');if(!response.ok)throw new Error();
    await open(new File([await response.text()],'montageplatte.dxf',{type:'text/plain'}));
  }catch{notice(['Die Beispielzeichnung konnte nicht geladen werden. Lade die Seite neu oder starte die lokale App mit npm start.'],true);}
});

function refreshPresetSelect() {
  const select=$('preset-select');select.replaceChildren(new Option('Individuell / ungespeichert',''));
  for(const preset of presets)select.add(new Option(`${preset.thickness} mm`,String(preset.thickness)));
  select.value=activeThickness===null?'':String(activeThickness);
  $('export-presets').disabled=!presets.length;
  $('delete-preset').disabled=activeThickness===null;
}
function currentPreset() {
  return validatePreset({thickness:Number($('thickness').value || NaN),...Object.fromEntries(['feed','delay','overlap','kerf'].map(id=>[id,Number($(id).value || NaN)]))});
}
function updatePresetStatus() {
  const saved=presets.find(p=>p.thickness===activeThickness);
  const changed=!saved || ['thickness','feed','delay','overlap','kerf'].some(key=>Number($(key).value)!==saved[key]);
  $('preset-status').textContent=presetMessage || (saved?(changed?`${saved.thickness} mm · Änderungen nicht gespeichert.`:`${saved.thickness} mm · Vorgaben geladen.`):'Blechdicke eingeben, um Vorgaben zu speichern.');
  $('preset-status').classList.toggle('modified',!!saved&&changed);
  const thickness=Number($('thickness').value);
  $('save-preset').textContent=thickness>0&&Number.isFinite(thickness)?`${thickness} mm ${presets.some(p=>p.thickness===thickness)?'aktualisieren':'speichern'}`:'Vorgabe speichern';
  const display=id=>$(id).value===''?'—':$(id).value;
  $('preset-summary').textContent=`${display('feed')} mm/min · ${display('delay')} s Einstechzeit · ${display('overlap')} mm Überlappung`;
}
function saveLibrary() {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY,serializePresetLibrary(presets,activeThickness));
    $('storage-status').hidden=true;return true;
  } catch {
    $('storage-status').textContent='Der Browser konnte die Vorgaben nicht speichern. Sie sind nur in diesem Tab verfügbar. Lade sie zur Sicherung als JSON herunter.';
    $('storage-status').hidden=false;return false;
  }
}
function applyPreset(preset) {
  for(const key of ['thickness','feed','delay','overlap','kerf'])$(key).value=preset[key];
}
$('preset-select').addEventListener('change',()=>{
  activeThickness=$('preset-select').value===''?null:Number($('preset-select').value);
  const preset=presets.find(p=>p.thickness===activeThickness);
  if(preset)applyPreset(preset);else $('thickness').value='';
  presetMessage='';refreshPresetSelect();saveLibrary();update();
});
$('save-preset').addEventListener('click',()=>{
  try {
    const preset=currentPreset();presets=upsertPreset(presets,preset);activeThickness=preset.thickness;
    refreshPresetSelect();const saved=saveLibrary();
    presetMessage=saved?`${preset.thickness} mm · im Browser gespeichert.`:`Vorgaben für ${preset.thickness} mm sind in diesem Tab verfügbar. Lade eine JSON-Sicherung herunter.`;
    updatePresetStatus();
  } catch(error) {presetMessage=error.message;updatePresetStatus();}
});
$('delete-preset').addEventListener('click',()=>{
  if(activeThickness===null)return;
  const thickness=activeThickness;presets=presets.filter(p=>p.thickness!==thickness);activeThickness=null;
  refreshPresetSelect();saveLibrary();presetMessage=`${thickness} mm gelöscht. Schnittwerte bleiben erhalten.`;updatePresetStatus();
});
$('export-presets').addEventListener('click',()=>downloadText(serializePresetLibrary(presets,activeThickness),'arc-blechvorgaben.json','application/json'));
$('import-presets-trigger').addEventListener('click',()=>$('import-presets').click());
$('import-presets').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try {
    if(file.size>1024*1024)throw new Error('Vorgabendateien müssen kleiner als 1 MB sein.');
    const incoming=parsePresetLibrary(await file.text());
    const originalKeys=new Set(presets.map(p=>p.thickness));let next=presets.slice(),added=0,kept=0;
    for(const preset of incoming.presets) {
      if(originalKeys.has(preset.thickness)){kept++;continue;}
      next=upsertPreset(next,preset);added++;
    }
    presets=next;refreshPresetSelect();const saved=saveLibrary();
    presetMessage=`Importierte Vorgaben: ${added}${kept?`; vorhandene Blechdicken beibehalten: ${kept}`:''}.${saved?'':' Lade eine JSON-Sicherung herunter, um sie dauerhaft zu behalten.'}`;updatePresetStatus();
  } catch(error) {presetMessage=`Vorgaben konnten nicht importiert werden: ${error.message}`;updatePresetStatus();}
});
$('edit-presets').addEventListener('click',()=>{$('sheet-settings').scrollIntoView({behavior:'smooth',block:'center'});$('thickness').focus({preventScroll:true});});
try {
  const machine=JSON.parse(localStorage.getItem(MACHINE_STORAGE_KEY));
  if(machine?.version===1&&validMachine(machine)){$('on').value=machine.on;$('off').value=machine.off;if(['s','ms'].includes(machine.dwellUnit))$('dwell-unit').value=machine.dwellUnit;}
} catch {/* Invalid machine settings fall back to M8/M9 and never enter G-code. */}
try {
  const stored=localStorage.getItem(PRESET_STORAGE_KEY);
  if(stored) {
    const library=parsePresetLibrary(stored);presets=library.presets;activeThickness=library.activeThickness;
    const preset=presets.find(p=>p.thickness===activeThickness);if(preset)applyPreset(preset);
  }
} catch {
  $('storage-status').textContent='Gespeicherte Vorgaben konnten nicht gelesen werden. Importiere eine Sicherung oder speichere neue Vorgaben und lade sie als JSON herunter.';$('storage-status').hidden=false;
}
refreshPresetSelect();update();
