// Presets describe operator-supplied process values, not recommended cut tables.
export const PRESET_STORAGE_KEY='arc.sheet-presets.v1';
export function validatePreset(value) {
  if (!value || typeof value!=='object') throw new Error('Ungültige Blechvorgabe.');
  for (const key of ['thickness','feed','delay','overlap','kerf']) {
    if (typeof value[key]!=='number' || !Number.isFinite(value[key])) throw new Error(`Der Wert für ${ {thickness:'Blechdicke',feed:'Schnittgeschwindigkeit',delay:'Einstechzeit',overlap:'Überlappung',kerf:'Schnittfugenbreite'}[key]} muss eine endliche Zahl sein.`);
  }
  if (value.thickness<=0 || value.thickness>1000) throw new Error('Die Blechdicke muss größer als 0 und höchstens 1000 mm sein.');
  if (value.feed<=0) throw new Error('Die Schnittgeschwindigkeit muss größer als null sein.');
  if (value.delay<0 || value.overlap<0) throw new Error('Einstechzeit und Überlappung dürfen nicht negativ sein.');
  if (value.kerf<=0 || value.kerf>1000) throw new Error('Die Schnittfugenbreite muss größer als 0 und höchstens 1000 mm sein.');
  return Object.fromEntries(['thickness','feed','delay','overlap','kerf'].map(key=>[key,value[key]]));
}
export function upsertPreset(presets,preset) {
  const valid=validatePreset(preset);
  const next=presets.filter(p=>p.thickness!==valid.thickness).concat(valid).sort((a,b)=>a.thickness-b.thickness);
  if (next.length>200) throw new Error('Es werden höchstens 200 Blechvorgaben unterstützt.');
  return next;
}
export function parsePresetLibrary(text) {
  let data;
  try {data=JSON.parse(text);}
  catch {throw new Error('Die Vorgabendatei enthält kein gültiges JSON.');}
  if (data?.version!==1 || !Array.isArray(data.presets) || data.presets.length>200) throw new Error('Diese Datei ist keine unterstützte Arc-Blechvorgabendatei.');
  const presets=data.presets.map(validatePreset).sort((a,b)=>a.thickness-b.thickness);
  if (new Set(presets.map(p=>p.thickness)).size!==presets.length) throw new Error('Die Vorgabensammlung enthält doppelte Blechdicken.');
  const activeThickness=presets.some(p=>p.thickness===data.activeThickness)?data.activeThickness:null;
  return {presets,activeThickness};
}
export function serializePresetLibrary(presets,activeThickness=null) {
  const data=parsePresetLibrary(JSON.stringify({version:1,presets,activeThickness}));
  return JSON.stringify({version:1,...data},null,2)+'\n';
}
