import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePreset,upsertPreset,parsePresetLibrary,serializePresetLibrary} from '../presets.js';
const preset={thickness:3,feed:1200,delay:0.7,overlap:1.5,kerf:1.2};
test('thickness presets round-trip all process defaults and active selection',()=>{
  const text=serializePresetLibrary([preset],3);
  assert.deepEqual(parsePresetLibrary(text),{presets:[preset],activeThickness:3});
  assert.equal(parsePresetLibrary(serializePresetLibrary([preset],99)).activeThickness,null);
});
test('saving a thickness updates only that thickness and sorts the library',()=>{
  const other={...preset,thickness:1,feed:1800};
  const previous=[preset,other];
  const updated=upsertPreset(previous,{...preset,feed:900,delay:0,overlap:0});
  assert.deepEqual(updated.map(p=>p.thickness),[1,3]);assert.deepEqual(updated[0],other);
  assert.equal(updated[1].feed,900);assert.equal(updated[1].delay,0);
  assert.equal(previous[0].feed,1200,'saving must not mutate the previous library');
});
test('invalid imported defaults are rejected instead of entering machine output',()=>{
  for(const change of [{thickness:0},{thickness:1001},{feed:0},{delay:-1},{overlap:-1},{kerf:0},{feed:'1000'},{feed:Infinity},{overlap:NaN}])assert.throws(()=>validatePreset({...preset,...change}));
  assert.throws(()=>parsePresetLibrary('not JSON'));
  assert.throws(()=>parsePresetLibrary(JSON.stringify({version:2,presets:[preset]})));
  assert.throws(()=>parsePresetLibrary(JSON.stringify({version:1,presets:[preset,preset]})),/doppelte/);
  assert.throws(()=>parsePresetLibrary(JSON.stringify({version:1,presets:Array(201).fill(preset)})),/unterstützte/);
  assert.deepEqual(validatePreset({...preset,extra:'discard me'}),preset);
});
