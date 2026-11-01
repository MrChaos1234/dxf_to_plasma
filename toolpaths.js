import {ClipperLib} from './vendor/clipper.js';

const JOIN_TOLERANCE = 0.00001; // mm; never bridge visible gaps in a drawing.
const OFFSET_TOLERANCE = 0.01; // mm; bounded sampling, polygon offset and arc refit budget.
const INTEGER_SCALE = 100000;
const FULL_TURN = Math.PI*2;
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const reversePath = p => ({...p,points:p.points.slice().reverse(),segments:p.segments.slice().reverse().map(s=>({...s,start:s.end,end:s.start,...(s.type==='arc'?{sweep:-s.sweep}:{})}))});

// Follow only unambiguous degree-two connections. Branching geometry stays open.
export function joinContours(paths) {
  const grid = new Map(), used = new Set(), result = [];
  const cell = p => p.map(v=>Math.floor(v/JOIN_TOLERANCE));
  const key = (x,y) => `${x},${y}`;
  paths.forEach((p,index)=>{
    if (p.closed) return;
    [p.points[0],p.points.at(-1)].forEach((point,end)=>{
      const [x,y] = cell(point), k = key(x,y);
      if (!grid.has(k)) grid.set(k,[]);
      grid.get(k).push({point,index,end,layer:p.layer});
    });
  });
  const neighbors = endpoint => {
    const [x,y] = cell(endpoint.point), matches = [];
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      for (const item of grid.get(key(x+dx,y+dy)) || []) {
        if (item.index===endpoint.index && item.end===endpoint.end) continue;
        if (item.layer===endpoint.layer && distance(item.point,endpoint.point)<=JOIN_TOLERANCE) matches.push(item);
      }
    }
    return matches;
  };
  paths.forEach((original,index)=>{
    if (used.has(index)) return;
    used.add(index);
    let path = {...original,points:original.points.slice(),segments:original.segments.slice()};
    if (!path.closed) {
      const grow = endpoint => {
        while(true) {
          const candidates = neighbors(endpoint);
          if (candidates.length!==1 || used.has(candidates[0].index)) break;
          const next = candidates[0];
          used.add(next.index);
          const piece = next.end ? reversePath(paths[next.index]) : paths[next.index];
          if (distance(path.points.at(-1),piece.points[0])>1e-9) {
            path.segments.push({type:'line',start:path.points.at(-1),end:piece.points[0]});
            path.points.push(piece.points[0]);
          }
          for (const p of piece.points.slice(1)) path.points.push(p);
          for (const s of piece.segments) path.segments.push(s);
          endpoint = {index:next.index,end:1-next.end,point:piece.points.at(-1),layer:piece.layer};
        }
      };
      grow({index,end:1,point:original.points.at(-1),layer:original.layer});
      path = reversePath(path);
      grow({index,end:0,point:original.points[0],layer:original.layer});
      path = reversePath(path);
      if (distance(path.points[0],path.points.at(-1))<=JOIN_TOLERANCE) {
        if (distance(path.points[0],path.points.at(-1))>1e-9) path.segments.push({type:'line',start:path.points.at(-1),end:path.points[0]});
        path.points.push(path.points[0]); path.closed = true;
      }
    }
    result.push(path);
  });
  return result;
}

export function toolpathLength(paths) {
  return paths.reduce((total,p)=>total+[...p.segments,...(p.overlapSegments || [])].reduce((sum,s)=>sum+(s.type==='arc'?distance(s.start,s.center)*Math.abs(s.sweep):distance(s.start,s.end)),0),0);
}

function overlapSegments(path,length) {
  if (!path.closed || !length) return [];
  const perimeter=toolpathLength([path]);
  if (length>=perimeter-1e-9) throw new Error(`Die Überlappung muss kürzer als diese Kontur sein (${perimeter.toFixed(3)} mm). Verringere die Überlappung.`);
  const result=[];
  let remaining=length;
  for (const segment of path.segments) {
    if (remaining<=1e-9) break;
    const span=segment.type==='arc'?distance(segment.start,segment.center)*Math.abs(segment.sweep):distance(segment.start,segment.end);
    if (span<=1e-12) continue;
    if (remaining>=span-1e-9) {result.push(segment);remaining-=span;continue;}
    const fraction=remaining/span;
    if (segment.type==='line') result.push({...segment,end:segment.start.map((v,i)=>v+(segment.end[i]-v)*fraction)});
    else {
      const sweep=segment.sweep*fraction;
      const radius=distance(segment.start,segment.center);
      const angle=Math.atan2(segment.start[1]-segment.center[1],segment.start[0]-segment.center[0])+sweep;
      result.push({...segment,sweep,end:[segment.center[0]+radius*Math.cos(angle),segment.center[1]+radius*Math.sin(angle)]});
    }
    remaining=0;
  }
  return result;
}

function sampleSegments(segments,tolerance=OFFSET_TOLERANCE/4) {
  const points = [segments[0].start];
  for (const s of segments) {
    if (s.type==='line') points.push(s.end);
    else {
      const radius = distance(s.start,s.center);
      const step = Math.min(Math.PI/36,2*Math.acos(Math.max(-1,1-tolerance/radius)));
      const count = Math.ceil(Math.abs(s.sweep)/Math.max(step,1e-6));
      if (points.length+count>30000) throw new Error('Die Kontur ist für die Schnittfugenkorrektur zu detailliert. Vereinfache sie im CAD.');
      const start = Math.atan2(s.start[1]-s.center[1],s.start[0]-s.center[0]);
      for(let i=1;i<count;i++) {
        const angle = start+s.sweep*i/count;
        points.push([s.center[0]+radius*Math.cos(angle),s.center[1]+radius*Math.sin(angle)]);
      }
      points.push(s.end);
    }
  }
  if (points.length>30000) throw new Error('Die Kontur ist für die Schnittfugenkorrektur zu detailliert. Vereinfache sie im CAD.');
  return points;
}

// Recover circular runs after polygon offsetting while bounding the deviation
// from every vertex AND every intervening chord, not just three fitted points.
function fitArc(points,from,to) {
  const a=points[from], m=points[Math.floor((from+to)/2)], b=points[to];
  const ux=m[0]-a[0],uy=m[1]-a[1],vx=b[0]-a[0],vy=b[1]-a[1];
  const determinant=2*(ux*vy-uy*vx);
  if (Math.abs(determinant)<1e-10) return null;
  const u2=ux*ux+uy*uy,v2=vx*vx+vy*vy;
  const center=[a[0]+(u2*vy-v2*uy)/determinant,a[1]+(ux*v2-vx*u2)/determinant];
  const radius=distance(a,center), tolerance=OFFSET_TOLERANCE/4;
  if (!Number.isFinite(radius) || radius>1e7 || radius<tolerance) return null;
  let sweep=0, direction=0;
  for(let i=from;i<=to;i++) {
    if (Math.abs(distance(points[i],center)-radius)>tolerance) return null;
    if (i===from) continue;
    const p=points[i-1],q=points[i];
    const dx=p[0]-center[0],dy=p[1]-center[1],ex=q[0]-center[0],ey=q[1]-center[1];
    const angle=Math.atan2(dx*ey-dy*ex,dx*ex+dy*ey);
    if (Math.abs(angle)<1e-12 || (direction && Math.sign(angle)!==direction)) return null;
    direction=Math.sign(angle); sweep+=angle;
    const chord=distance(p,q);
    if (radius-Math.sqrt(Math.max(0,radius*radius-chord*chord/4))>OFFSET_TOLERANCE/2) return null;
  }
  if (Math.abs(sweep)>Math.PI+1e-8) return null;
  return {type:'arc',start:a,end:b,center,sweep};
}

function fitSegments(points) {
  const segments=[];
  for(let i=0;i<points.length-1;) {
    let best=null,end=i;
    for(let j=i+4;j<Math.min(points.length,i+257);j++) {
      const arc=fitArc(points,i,j);
      if (!arc) break;
      if (Math.abs(arc.sweep)>=0.08) {best=arc;end=j;}
    }
    if (best) {segments.push(best);i=end;}
    else {segments.push({type:'line',start:points[i],end:points[i+1]});i++;}
  }
  return segments;
}

function circleOffset(path,delta) {
  const arcs=path.segments,first=arcs[0];
  if (first.type!=='arc' || !arcs.every(s=>s.type==='arc' && distance(s.center,first.center)<1e-7 && Math.sign(s.sweep)===Math.sign(first.sweep))) return null;
  if (Math.abs(Math.abs(arcs.reduce((sum,s)=>sum+s.sweep,0))-FULL_TURN)>1e-7) return null;
  const radius=distance(first.start,first.center),newRadius=radius+delta;
  if (newRadius<=0.000001) throw new Error('Die Schnittfuge ist zu breit: Die innere Schnittbahn fällt vollständig weg. Verringere die Schnittfugenbreite oder verwende Auf Linie.');
  const start=first.start.map((v,i)=>first.center[i]+(v-first.center[i])*newRadius/radius);
  const opposite=start.map((v,i)=>2*first.center[i]-v);
  const segments=[{type:'arc',start,end:opposite,center:first.center,sweep:Math.sign(first.sweep)*Math.PI},{type:'arc',start:opposite,end:start,center:first.center,sweep:Math.sign(first.sweep)*Math.PI}];
  return [{...path,segments,points:sampleSegments(segments)}];
}

export function offsetContour(path,side,kerf) {
  if (!['on','inside','outside'].includes(side)) throw new Error('Unbekannte Schnittseite. Wähle Auf Linie, Innen oder Außen.');
  if (side==='on') return [path];
  if (!path.closed) throw new Error('Innen/Außen benötigt eine geschlossene Kontur. Verwende Auf Linie oder schließe die Lücken im CAD.');
  if (!Number.isFinite(kerf) || kerf<=0 || kerf>1000) throw new Error('Die Schnittfugenbreite muss größer als 0 und höchstens 1000 mm sein.');
  const delta=(side==='outside'?1:-1)*kerf/2;
  const circle=circleOffset(path,delta);
  if (circle) return circle;
  const polygon=[];
  for (const point of sampleSegments(path.segments)) {
    if (point.some(v=>!Number.isFinite(v) || Math.abs(v)>1000000)) throw new Error('Koordinaten überschreiten den unterstützten Korrekturbereich von ±1.000.000 mm.');
    const p={X:Math.round(point[0]*INTEGER_SCALE),Y:Math.round(point[1]*INTEGER_SCALE)};
    if (!polygon.length || p.X!==polygon.at(-1).X || p.Y!==polygon.at(-1).Y) polygon.push(p);
  }
  if (polygon.length>1 && polygon[0].X===polygon.at(-1).X && polygon[0].Y===polygon.at(-1).Y) polygon.pop();
  const area=ClipperLib.Clipper.Area(polygon);
  if (polygon.length<3 || Math.abs(area)<1) throw new Error('Die Kontur umschließt keine Fläche. Verwende Auf Linie oder repariere sie im CAD.');
  const simple=ClipperLib.Clipper.SimplifyPolygon(polygon,ClipperLib.PolyFillType.pftEvenOdd);
  if (simple.length!==1 || Math.abs(Math.abs(ClipperLib.Clipper.Area(simple[0]))-Math.abs(area))>INTEGER_SCALE*INTEGER_SCALE*0.0001) throw new Error('Die Kontur schneidet oder berührt sich selbst. Repariere sie im CAD, bevor du Innen/Außen verwendest.');
  if (!ClipperLib.Clipper.Orientation(polygon)) polygon.reverse();
  const offsetter=new ClipperLib.ClipperOffset(2,OFFSET_TOLERANCE/4*INTEGER_SCALE);
  offsetter.AddPath(polygon,ClipperLib.JoinType.jtRound,ClipperLib.EndType.etClosedPolygon);
  const output=[];
  offsetter.Execute(output,delta*INTEGER_SCALE);
  if (!output.length) throw new Error('Die Schnittfuge ist zu breit: Die innere Schnittbahn fällt vollständig weg. Verringere die Schnittfugenbreite oder verwende Auf Linie.');
  return output.map(poly=>{
    if (area<0) poly.reverse();
    const points=poly.map(p=>[p.X/INTEGER_SCALE,p.Y/INTEGER_SCALE]);
    // Start near the normal offset of the source start, with stable corner ties.
    const first=path.segments[0];
    const tangent=first.type==='line'?[first.end[0]-first.start[0],first.end[1]-first.start[1]]:[-(first.start[1]-first.center[1])*Math.sign(first.sweep),(first.start[0]-first.center[0])*Math.sign(first.sweep)];
    const magnitude=Math.hypot(...tangent);
    const startTarget=magnitude?[first.start[0]+tangent[1]/magnitude*delta*Math.sign(area),first.start[1]-tangent[0]/magnitude*delta*Math.sign(area)]:path.points[0];
    let nearest=0;
    for(let i=1;i<points.length;i++) if(distance(points[i],startTarget)<distance(points[nearest],startTarget)) nearest=i;
    const rotated=points.slice(nearest).concat(points.slice(0,nearest));
    rotated.push(rotated[0]);
    const segments=fitSegments(rotated);
    return {...path,closed:true,segments,points:sampleSegments(segments)};
  });
}

// Infer material/void boundaries by nesting parity, never by winding or file order.
// A narrow band around each boundary makes touching/crossing/near-coincident
// geometry ambiguous instead of allowing a point-in-polygon guess to decide it.
export function inferCutSides(drawing) {
  const unknown=reason=>drawing.paths.map(()=>({side:null,reason}));
  if (drawing.incomplete) return unknown('Nicht unterstützte Zeichnungselemente können die Konturzuordnung verändern. Prüfe die Zeichnung und wähle die Schnittseiten manuell.');
  if (drawing.paths.length>500) return unknown('Die Zeichnung ist für die automatische Konturanalyse zu groß. Wähle die Schnittseiten manuell.');
  const scale=INTEGER_SCALE,margin=0.01*scale;
  const area=paths=>paths.reduce((sum,p)=>sum+Math.abs(ClipperLib.Clipper.Area(p)),0);
  const clip=(a,b,type)=>{
    const engine=new ClipperLib.Clipper(),result=[];
    engine.AddPaths(a,ClipperLib.PolyType.ptSubject,true);engine.AddPaths(b,ClipperLib.PolyType.ptClip,true);
    engine.Execute(type,result,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
    return result;
  };
  const inflate=(polygon,amount,closed=true)=>{
    const engine=new ClipperLib.ClipperOffset(2,margin/8),result=[];
    engine.AddPath(polygon,ClipperLib.JoinType.jtRound,closed?ClipperLib.EndType.etClosedPolygon:ClipperLib.EndType.etOpenRound);
    engine.Execute(result,amount);return result;
  };
  let vertexCount=0;
  const records=drawing.paths.map(path=>{
    if(vertexCount>50000)return {polygon:[],bounds:{minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity},closed:path.closed,invalid:true,reason:'Die Zeichnung ist für die automatische Analyse zu detailliert.'};
    let polygon=[];
    try {
      for (const point of sampleSegments(path.segments)) {
        if (point.some(v=>!Number.isFinite(v)||Math.abs(v)>1000000)) throw new Error('Koordinaten liegen außerhalb des Bereichs für die automatische Analyse.');
        const p={X:Math.round(point[0]*scale),Y:Math.round(point[1]*scale)};
        if (!polygon.length||p.X!==polygon.at(-1).X||p.Y!==polygon.at(-1).Y) polygon.push(p);
      }
      if (path.closed&&polygon.length>1&&polygon[0].X===polygon.at(-1).X&&polygon[0].Y===polygon.at(-1).Y) polygon.pop();
      vertexCount+=polygon.length;
      const bounds=polygon.reduce((b,p)=>({minX:Math.min(b.minX,p.X),minY:Math.min(b.minY,p.Y),maxX:Math.max(b.maxX,p.X),maxY:Math.max(b.maxY,p.Y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
      if (!path.closed) return {polygon,bounds,closed:false,band:polygon.length>=2?inflate(polygon,margin,false):[],reason:'Offene Kontur: Wähle Auf Linie manuell oder schließe sie im CAD, bevor du Innen/Außen verwendest.'};
      const signedArea=ClipperLib.Clipper.Area(polygon);
      const unique=new Set(polygon.map(p=>`${p.X},${p.Y}`));
      const simple=ClipperLib.Clipper.SimplifyPolygon(polygon,ClipperLib.PolyFillType.pftEvenOdd);
      if (polygon.length<3||unique.size!==polygon.length||Math.abs(signedArea)<1||simple.length!==1||Math.abs(Math.abs(ClipperLib.Clipper.Area(simple[0]))-Math.abs(signedArea))>scale*scale*0.0001) {
        return {polygon,bounds,closed:true,invalid:true,reason:'Diese Kontur berührt oder schneidet sich selbst oder umschließt keine Fläche. Prüfe sie und wähle die Schnittseite manuell.'};
      }
      if (!ClipperLib.Clipper.Orientation(polygon)) polygon.reverse();
      const outer=inflate(polygon,margin),inner=inflate(polygon,-margin);
      const band=inner.length?clip(outer,inner,ClipperLib.ClipType.ctDifference):outer;
      return {polygon,bounds,closed:true,band,reason:null};
    } catch(error) {
      const bounds=polygon.reduce((b,p)=>({minX:Math.min(b.minX,p.X),minY:Math.min(b.minY,p.Y),maxX:Math.max(b.maxX,p.X),maxY:Math.max(b.maxY,p.Y)}),{minX:-Infinity,minY:-Infinity,maxX:Infinity,maxY:Infinity});
      return {polygon,bounds,closed:path.closed,invalid:true,reason:`Die automatische Analyse konnte diese Kontur nicht prüfen: ${error.message} Wähle die Schnittseite manuell.`};
    }
  });
  if (vertexCount>50000) return unknown('Die Zeichnung ist für die automatische Konturanalyse zu detailliert. Wähle die Schnittseiten manuell.');
  const related=(a,b)=>a.bounds.minX<=b.bounds.maxX+2*margin&&a.bounds.maxX>=b.bounds.minX-2*margin&&a.bounds.minY<=b.bounds.maxY+2*margin&&a.bounds.maxY>=b.bounds.minY-2*margin;
  let checks=0;
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++) {
    const a=records[i],b=records[j];
    if (!related(a,b))continue;
    if (++checks>10000) return unknown('Zu viele überlappende Konturen für eine sichere Zuordnung. Wähle die Schnittseiten manuell.');
    if (a.invalid||b.invalid) {
      if (a.closed&&!a.invalid)a.reason='Ungültige Geometrie in der Nähe macht die Materialgrenze uneindeutig. Wähle die Schnittseite manuell.';
      if (b.closed&&!b.invalid)b.reason='Ungültige Geometrie in der Nähe macht die Materialgrenze uneindeutig. Wähle die Schnittseite manuell.';
      continue;
    }
    if (!a.closed&&!b.closed)continue;
    try {
      if (a.band.length&&b.band.length&&area(clip(a.band,b.band,ClipperLib.ClipType.ctIntersection))>1) {
        if(a.closed)a.reason='Konturen berühren oder schneiden sich oder liegen weniger als 0,02 mm auseinander. Wähle die Schnittseite manuell.';
        if(b.closed)b.reason='Konturen berühren oder schneiden sich oder liegen weniger als 0,02 mm auseinander. Wähle die Schnittseite manuell.';
      }
    } catch {
      if(a.closed)a.reason='Die Lage der Konturen zueinander konnte nicht geprüft werden. Wähle die Schnittseite manuell.';
      if(b.closed)b.reason='Die Lage der Konturen zueinander konnte nicht geprüft werden. Wähle die Schnittseite manuell.';
    }
  }
  // Uncertain enclosing boundaries also make any enclosed part/hole uncertain.
  const ambiguous=records.filter(r=>r.closed&&r.reason);
  for(const a of records)if(a.closed&&!a.reason) {
    for(const b of ambiguous) {
      if (b.invalid||!related(a,b))continue;
      if(ClipperLib.Clipper.PointInPolygon(a.polygon[0],b.polygon)!==0) {a.reason='Eine umschließende Kontur ist uneindeutig. Wähle die Schnittseite manuell.';break;}
    }
  }
  return records.map((record,index)=>{
    const containers=[];
    for(let j=0;j<records.length;j++) {
      if(j===index||!records[j].closed||records[j].invalid||records[j].reason||record.invalid||!record.polygon.length)continue;
      if(ClipperLib.Clipper.PointInPolygon(record.polygon[0],records[j].polygon)===1)containers.push(j);
    }
    if(record.reason)return {side:null,reason:record.reason,containers};
    const depth=containers.length;
    return depth%2?{side:'inside',containers,depth,reason:`Loch auf Verschachtelungsebene ${depth} erkannt. Innen hält die Schnittfuge auf der Abfallseite. Bei einer Gravur bitte prüfen und die Auswahl ändern.`}:{side:'outside',containers,depth,reason:depth?`Materialinsel auf Verschachtelungsebene ${depth} erkannt. Außen hält die Schnittfuge auf der Abfallseite.`:'Geschlossene Außenkontur erkannt. Außen hält die Schnittfuge außerhalb des Werkstücks.'};
  });
}

export function orderToolpaths(drawing,paths,settings={}) {
  if(settings.cutOrder==='file')return paths.slice().sort((a,b)=>a.sourceIndex-b.sourceIndex);
  const analysis=settings.contourAnalysis || inferCutSides(drawing);
  const groups=new Map();
  for(const path of paths) {
    if(!groups.has(path.sourceIndex))groups.set(path.sourceIndex,[]);
    groups.get(path.sourceIndex).push(path);
  }
  const dependencies=new Map([...groups.keys()].map(index=>[index,new Set()]));
  for(const index of groups.keys())for(const parent of analysis[index]?.containers || []) {
    if(groups.has(parent))dependencies.get(parent).add(index);
  }
  const size=index=>{
    return Math.abs(drawing.paths[index].segments.reduce((sum,s)=>{
      if(s.type==='line')return sum+s.start[0]*s.end[1]-s.end[0]*s.start[1];
      const radius=Math.hypot(s.start[0]-s.center[0],s.start[1]-s.center[1]);
      return sum+s.center[0]*(s.end[1]-s.start[1])-s.center[1]*(s.end[0]-s.start[0])+radius*radius*s.sweep;
    },0)/2);
  };
  const priority={inside:0,on:1,outside:2},areas=new Map([...groups.keys()].map(index=>[index,size(index)]));
  const compare=(a,b)=>{
    const pa=priority[groups.get(a)[0].cutSide] ?? 1,pb=priority[groups.get(b)[0].cutSide] ?? 1;
    return pa-pb || (pa===2?areas.get(a)-areas.get(b):0) || a-b;
  };
  const remaining=new Set(groups.keys()),result=[];
  while(remaining.size) {
    const ready=[...remaining].filter(index=>![...dependencies.get(index)].some(child=>remaining.has(child))).sort(compare);
    // A defensive fallback for externally supplied analysis; normal containment
    // is acyclic. Retain stable priority rather than dropping any toolpaths.
    const next=ready.length?ready[0]:[...remaining].sort(compare)[0];
    result.push(...groups.get(next));remaining.delete(next);
  }
  return result;
}

export function prepareToolpaths(drawing,settings,{allowUnassigned=false}={}) {
  const paths=[];
  const overlap=settings.overlap ?? 0;
  if (!Number.isFinite(overlap) || overlap<0) throw new Error('Die Überlappung muss eine endliche Zahl von null oder mehr Millimetern sein.');
  drawing.paths.forEach((path,index)=>{
    const side=settings.cutSides?.[index]===null?null:(settings.cutSides?.[index] ?? 'on');
    if(side===null) {
      if(allowUnassigned)return;
      throw new Error(`Kontur ${index+1}: Wähle vor dem Export eine Schnittseite manuell.`);
    }
    try {
      for(const toolpath of offsetContour(path,side,settings.kerf)) paths.push({...toolpath,sourceIndex:index,cutSide:side,overlapSegments:overlapSegments(toolpath,overlap),overlapLength:toolpath.closed?overlap:0});
    } catch(error) {throw new Error(`Kontur ${index+1}: ${error.message}`);}
  });
  return paths;
}
