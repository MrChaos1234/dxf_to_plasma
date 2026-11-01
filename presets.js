// Presets describe operator-supplied process values, not recommended cut tables.
export const PRESET_STORAGE_KEY='arc.sheet-presets.v1';
export function validatePreset(value) {
  if (!value || typeof value!=='object') throw new Error('Invalid thickness preset.');
  for (const key of ['thickness','feed','delay','overlap','kerf']) {
    if (typeof value[key]!=='number' || !Number.isFinite(value[key])) throw new Error(`Preset ${key} must be a finite number.`);
  }
  if (value.thickness<=0 || value.thickness>1000) throw new Error('Sheet thickness must be greater than 0 and no more than 1000 mm.');
  if (value.feed<=0) throw new Error('Feed rate must be greater than zero.');
  if (value.delay<0 || value.overlap<0) throw new Error('Pierce delay and overlap must be zero or greater.');
  if (value.kerf<=0 || value.kerf>1000) throw new Error('Kerf width must be greater than 0 and no more than 1000 mm.');
  return Object.fromEntries(['thickness','feed','delay','overlap','kerf'].map(key=>[key,value[key]]));
}
export function upsertPreset(presets,preset) {
  const valid=validatePreset(preset);
  const next=presets.filter(p=>p.thickness!==valid.thickness).concat(valid).sort((a,b)=>a.thickness-b.thickness);
  if (next.length>200) throw new Error('A maximum of 200 thickness presets is supported.');
  return next;
}
export function parsePresetLibrary(text) {
  const data=JSON.parse(text);
  if (data?.version!==1 || !Array.isArray(data.presets) || data.presets.length>200) throw new Error('This is not a supported Arc thickness-presets file.');
  const presets=data.presets.map(validatePreset).sort((a,b)=>a.thickness-b.thickness);
  if (new Set(presets.map(p=>p.thickness)).size!==presets.length) throw new Error('The preset library contains duplicate sheet thicknesses.');
  const activeThickness=presets.some(p=>p.thickness===data.activeThickness)?data.activeThickness:null;
  return {presets,activeThickness};
}
export function serializePresetLibrary(presets,activeThickness=null) {
  const data=parsePresetLibrary(JSON.stringify({version:1,presets,activeThickness}));
  return JSON.stringify({version:1,...data},null,2)+'\n';
}
