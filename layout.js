const TURN=Math.PI*2;
function pointTransform(drawing,placement={}) {
  const values={angle:0,moveX:0,moveY:0,zeroX:0,zeroY:0,...placement};
  if(!Object.values(values).every(Number.isFinite))throw new Error('Drehung, Zeichnungsposition und Nullpunktkoordinaten müssen endliche Zahlen sein.');
  const radians=(values.angle%360)*Math.PI/180;
  const cos=Math.cos(radians),sin=Math.sin(radians);
  const cx=(drawing.bounds.minX+drawing.bounds.maxX)/2,cy=(drawing.bounds.minY+drawing.bounds.maxY)/2;
  return point=>{
    const x=point[0]-cx,y=point[1]-cy;
    const result=[cx+x*cos-y*sin+values.moveX-values.zeroX,cy+x*sin+y*cos+values.moveY-values.zeroY];
    if(!result.every(Number.isFinite))throw new Error('Die Positionierung der Zeichnung hat ungültige Koordinaten erzeugt.');
    return result;
  };
}
function transformPath(path,transform) {
  const segment=s=>({...s,start:transform(s.start),end:transform(s.end),...(s.center?{center:transform(s.center)}:{})});
  return {...path,points:path.points.map(transform),segments:path.segments.map(segment),...(path.overlapSegments?{overlapSegments:path.overlapSegments.map(segment)}:{})};
}
function boundsOf(paths) {
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  const include=([x,y])=>{bounds.minX=Math.min(bounds.minX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxX=Math.max(bounds.maxX,x);bounds.maxY=Math.max(bounds.maxY,y);};
  for(const path of paths)for(const s of path.segments) {
    include(s.start);include(s.end);
    if(s.type!=='arc')continue;
    const radius=Math.hypot(s.start[0]-s.center[0],s.start[1]-s.center[1]);
    const angle=Math.atan2(s.start[1]-s.center[1],s.start[0]-s.center[0]);
    for(let i=0;i<4;i++) {
      const target=i*Math.PI/2,delta=s.sweep>0?target-angle:angle-target;
      if(((delta%TURN)+TURN)%TURN<=Math.abs(s.sweep)+1e-12)include([s.center[0]+radius*Math.cos(target),s.center[1]+radius*Math.sin(target)]);
    }
  }
  return bounds;
}
export function positionDrawing(drawing,placement={}) {
  const transform=pointTransform(drawing,placement),paths=drawing.paths.map(path=>transformPath(path,transform));
  return {...drawing,paths,bounds:boundsOf(paths)};
}
export function positionToolpaths(drawing,paths,placement={}) {
  const transform=pointTransform(drawing,placement);
  return paths.map(path=>transformPath(path,transform));
}
