import {parseFont} from '../vendor/opentype.js';
import {ClipperLib} from '../vendor/clipper.js';
import {STENCIL_FONTS} from './fonts.js';
import {parseDXF} from '../core.js';
const SCALE=100000,C=ClipperLib,cache=new Map(),MEASURE=Symbol();
const point=([x,y])=>({X:Math.round(x*SCALE),Y:Math.round(y*SCALE)});
function clip(subject,clipPaths=[],type=C.ClipType.ctUnion,tree=false) {
  const engine=new C.Clipper();engine.StrictlySimple=true;
  engine.AddPaths(subject,C.PolyType.ptSubject,true);
  if(clipPaths.length)engine.AddPaths(clipPaths,C.PolyType.ptClip,true);
  const output=tree?new C.PolyTree():[];
  engine.Execute(type,output,C.PolyFillType.pftNonZero,C.PolyFillType.pftNonZero);return output;
}
function inflate(paths,distance) {
  if(!distance)return paths;
  const offset=new C.ClipperOffset(2,0.005*SCALE);offset.AddPaths(paths,C.JoinType.jtRound,C.EndType.etClosedPolygon);const out=[];offset.Execute(out,distance*SCALE);return out;
}
const box=paths=>{const p=paths.flat();return {minX:Math.min(...p.map(p=>p.X))/SCALE,maxX:Math.max(...p.map(p=>p.X))/SCALE,minY:Math.min(...p.map(p=>p.Y))/SCALE,maxY:Math.max(...p.map(p=>p.Y))/SCALE};};
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(point);
function fontFor(id) {
  if(cache.has(id))return cache.get(id);
  const source=STENCIL_FONTS.find(f=>f.id===id);if(!source)throw new Error('Unbekannte Schablonenschrift.');
  const bytes=Uint8Array.from(atob(source.data),c=>c.charCodeAt(0)),font=parseFont(bytes.buffer);cache.set(id,font);return font;
}
function polygonPaths(commands) {
  const paths=[];let current=[],last=null,steps=0;
  const add=p=>{if(++steps>30000)throw new Error('Schrift zu detailliert. Text kürzen.');if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>1e-9){current.push(p);last=p;}};
  function curve(points,depth=0) {
    const a=points[0],b=points.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    if(points.every(p=>{const t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=0.005;})){add(b);return;}
    if(depth>=24)throw new Error('Schriftkurve konnte nicht genau genug berechnet werden.');
    let row=points;const left=[row[0]],right=[row.at(-1)];while(row.length>1){row=row.slice(1).map((p,i)=>p.map((v,j)=>(v+row[i][j])/2));left.push(row[0]);right.push(row.at(-1));}curve(left,depth+1);curve(right.reverse(),depth+1);
  }
  const finish=()=>{if(current.length>2)paths.push(current.map(point));current=[];last=null;};
  for(const c of commands) {
    if(c.type==='M'){finish();add([c.x,-c.y]);}
    else if(c.type==='L')add([c.x,-c.y]);
    else if(c.type==='Q')curve([last,[c.x1,-c.y1],[c.x,-c.y]]);
    else if(c.type==='C')curve([last,[c.x1,-c.y1],[c.x2,-c.y2],[c.x,-c.y]]);
    else if(c.type==='Z')finish();
  }
  finish();return clip(paths);
}
function hasHoles(paths) {const tree=clip(paths,[],C.ClipType.ctUnion,true);return tree.Childs().some(node=>node.Childs().length>0);}
function shapePolygon(path) {
  const points=[];
  for(const s of path.segments) {
    points.push(s.start);
    if(s.type==='arc') {
      const r=Math.hypot(s.start[0]-s.center[0],s.start[1]-s.center[1]),a=Math.atan2(s.start[1]-s.center[1],s.start[0]-s.center[0]);
      const n=Math.max(2,Math.ceil(Math.abs(s.sweep)/Math.max(0.001,2*Math.acos(Math.max(-1,1-0.005/r)))));
      if(n>20000)throw new Error('Teil für Textprüfung zu groß.');
      for(let i=1;i<n;i++)points.push([s.center[0]+r*Math.cos(a+s.sweep*i/n),s.center[1]+r*Math.sin(a+s.sweep*i/n)]);
    }
  }
  const result=points.map(point);if(!C.Clipper.Orientation(result))result.reverse();return result;
}
export function addStencilText(part,options) {
  if(!options?.enabled)return part;
  const text=typeof options.text==='string'?options.text.normalize('NFC').toLocaleUpperCase('de-DE'):'';
  if(!text.trim())throw new Error('Text eingeben oder Beschriftung ausschalten.');
  if(text.length>60||text.split('\n').length>3)throw new Error('Höchstens 60 Zeichen und drei Zeilen verwenden.');
  const {height,tracking,lineGap,x,y,bridgeWidth,clearance}=options,angle=options.angle===undefined?0:options.angle;
  if(![height,tracking,lineGap,x,y,bridgeWidth,clearance,angle].every(Number.isFinite))throw new Error('Textmaße müssen gültige Zahlen sein.');
  if(height<8||height>200||tracking<0||tracking>50||lineGap<0||lineGap>100||Math.abs(x)>10000||Math.abs(y)>10000||bridgeWidth<0.5||bridgeWidth>20||clearance<0.1||clearance>100)throw new Error('Text: Höhe 8–200 mm, Stege 0,5–20 mm, Abstand 0,1–100 mm.');
  if(Math.abs(angle)>36000)throw new Error('Textdrehung muss zwischen −36000 und 36000 Grad liegen.');
  if(!['font','horizontal','vertical','cross'].includes(options.bridges))throw new Error('Unbekannte Stegvariante.');
  const font=fontFor(options.font),cap=font.charToGlyph('H').getBoundingBox().y2,fontSize=height*font.unitsPerEm/cap;
  const rows=[];let vertices=0,simplified=0;
  for(const line of text.split('\n')) {
    let advance=0,previous=null;const letters=[];
    for(const character of line) {
      if(character==='\r')continue;
      const glyph=font.charToGlyph(character);
      if(!glyph.index)throw new Error(`Zeichen „${character}“ wird von dieser Schrift nicht unterstützt.`);
      if(previous)advance+=font.getKerningValue(previous,glyph)*fontSize/font.unitsPerEm+tracking;
      let paths=polygonPaths(glyph.getPath(0,0,fontSize).commands);
      if(character!==' '&&!paths.length)throw new Error(`Zeichen „${character}“ hat keine schneidbare Kontur.`);
      if(paths.length&&options.bridges!=='font') {
        const b=box(paths),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,w=bridgeWidth/2,strips=[];
        if(['horizontal','cross'].includes(options.bridges))strips.push(rect(b.minX-1,cy-w,b.maxX+1,cy+w));
        if(['vertical','cross'].includes(options.bridges))strips.push(rect(cx-w,b.minY-1,cx+w,b.maxY+1));
        paths=clip(paths,strips,C.ClipType.ctDifference);
        // Extra bridges can create tiny triangular cut slivers at diagonal strokes.
        // Leave those in the metal instead of emitting unmachinable pinhole cuts.
        const stable=paths.filter(path=>inflate([path],-bridgeWidth/2).length>0);
        simplified+=paths.length-stable.length;paths=stable;
        if(!paths.length)throw new Error(`Der Zusatzsteg entfernt „${character}“ vollständig. Steg verkleinern oder Schrift vergrößern.`);
      }
      if(hasHoles(paths))throw new Error(`„${character}“ enthält eine lose Innenfläche. Andere Schrift oder zusätzliche Stege wählen.`);
      paths=paths.map(path=>path.map(p=>({X:p.X+Math.round(advance*SCALE),Y:p.Y})));
      vertices+=paths.reduce((n,p)=>n+p.length,0);if(vertices>20000)throw new Error('Text zu detailliert. Weniger Zeichen verwenden.');
      letters.push(...paths);advance+=(glyph.advanceWidth||0)*fontSize/font.unitsPerEm;previous=glyph;
    }
    rows.push(letters);
  }
  const nonempty=rows.filter(p=>p.length);if(!nonempty.length)throw new Error('Keine schneidbaren Textzeichen.');
  const arranged=rows.flatMap((paths,index)=>{if(!paths.length)return [];const b=box(paths),dx=-(b.minX+b.maxX)/2;return paths.map(p=>p.map(v=>({X:v.X+Math.round(dx*SCALE),Y:v.Y-Math.round(index*(height+lineGap)*SCALE)})));});
  const textBounds=box(arranged),drawing=parseDXF(part.dxf),b=drawing.bounds;
  const moveX=(b.minX+b.maxX)/2+x,moveY=(b.minY+b.maxY)/2+y;
  const cx=(textBounds.minX+textBounds.maxX)/2,cy=(textBounds.minY+textBounds.maxY)/2,radians=(angle%360)*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const paths=clip(arranged.map(path=>path.map(p=>{const px=p.X/SCALE-cx,py=p.Y/SCALE-cy;return point([moveX+px*cos-py*sin,moveY+px*sin+py*cos]);})));
  const placedBounds=box(paths),width=placedBounds.maxX-placedBounds.minX,totalHeight=placedBounds.maxY-placedBounds.minY;
  if(options[MEASURE])return {width,height:totalHeight};
  if(hasHoles(paths))throw new Error('Text bildet lose Innenflächen. Mehr Zeichenabstand oder zusätzliche Stege wählen.');
  const outer=[shapePolygon(drawing.paths[0])],holes=drawing.paths.slice(1).map(shapePolygon),expanded=inflate(paths,clearance);
  if(clip(expanded,outer,C.ClipType.ctDifference).length)throw new Error('Text liegt zu nah am Außenrand. Schrift verkleinern oder verschieben.');
  if(holes.length&&clip(expanded,holes,C.ClipType.ctIntersection).length)throw new Error('Text liegt zu nah an einem Loch. Schrift verkleinern oder verschieben.');
  const boxes=paths.map(p=>box([p])),grown=new Map();
  const grow=i=>{if(!grown.has(i))grown.set(i,inflate([paths[i]],clearance/2));return grown.get(i);};
  for(let i=0;i<paths.length;i++)for(let j=0;j<i;j++) {
    const a=boxes[i],b=boxes[j];
    if(a.minX>b.maxX+clearance||b.minX>a.maxX+clearance||a.minY>b.maxY+clearance||b.minY>a.maxY+clearance)continue;
    if(clip(grow(i),grow(j),C.ClipType.ctIntersection).length)throw new Error('Abstand zwischen Textkonturen zu klein. Schrift oder Zeichenabstand vergrößern, Mindestabstand verkleinern oder Zusatzstege wählen.');
  }
  // Also enforce clearance between disconnected cuts of the font (its stencil bridges).
  // Growing cuts by half the requested clearance reveals closed material islands.
  if(hasHoles(inflate(paths,clearance/2)))throw new Error('Schriftstege sind schmaler als der Mindestabstand. Schrift vergrößern, Abstand verkleinern oder Zusatzstege wählen.');
  const dxf=paths.map(path=>['0','LWPOLYLINE','8','Schablonentext','90',path.length,'70','1',...path.flatMap(p=>['10',p.X/SCALE,'20',p.Y/SCALE])].join('\n')).join('\n');
  const slug=text.trim().toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,32)||'text';
  return {...part,dxf:part.dxf.replace('0\nENDSEC\n0\nEOF',dxf+'\n0\nENDSEC\n0\nEOF'),filename:part.filename.replace(/\.dxf$/,`_text_${slug}.dxf`),textInfo:{text,width,height:totalHeight,angle,contours:paths.length,simplified}};
}

export function fitStencilText(part,options) {
  const dimensions=addStencilText(part,{...options,enabled:true,height:8,tracking:0,lineGap:0,bridges:'font',[MEASURE]:true});
  const b=parseDXF(part.dxf).bounds,w=b.maxX-b.minX-2*(Math.abs(options.x)+options.clearance),h=b.maxY-b.minY-2*(Math.abs(options.y)+options.clearance);
  const upper=Math.min(200,8*w/dimensions.width,8*h/dimensions.height);
  let trial=Math.floor(upper*2)/2,failed=upper,best=null;
  for(let i=0;i<22&&trial>=8;i++) {
    try {addStencilText(part,{...options,enabled:true,height:trial});best=trial;break;}
    catch {failed=trial;trial=Math.max(8,Math.floor(trial*0.85*2)/2);if(trial===8&&failed===8)break;}
  }
  if(best===null)throw new Error('Text passt hier nicht. Text kürzen, Versatz ändern oder Teil vergrößern.');
  for(let i=0;i<7&&failed-best>0.5;i++) {
    const middle=Math.floor((failed+best));const height=middle/2;
    try{addStencilText(part,{...options,enabled:true,height});best=height;}catch{failed=height;}
  }
  return best;
}

export function textPlacementForPart(part) {
  const p=part.parameters;
  if(part.type==='tab')return {x:0,y:(p.length-p.width/2-p.hole/2)/2-p.length/2,angle:90};
  return {x:0,y:0,angle:0};
}
