'use strict';
const fs=require('node:fs');
const path=require('node:path');
const source=process.argv[2], destination=process.argv[3];
if(!source||!destination)throw new Error('Usage: node scripts_generate_syria_locations.js SOURCE_DATA_DIR DESTINATION');
const read=name=>JSON.parse(fs.readFileSync(path.join(source,`${name}.json`),'utf8'));
const governorates=read('governorates');
const localities=read('localities');
const collator=new Intl.Collator('ar');
const governorateName=new Map(governorates.map(x=>[x.id,x.name.ar]));
const townsByGovernorate=Object.fromEntries(governorates.map(g=>[g.name.ar,[]]));
for(const locality of localities){
  const governorate=governorateName.get(locality.governorateId), name=String(locality.name?.ar||'').trim();
  if(governorate&&name)townsByGovernorate[governorate].push(name);
}
for(const governorate of Object.keys(townsByGovernorate))townsByGovernorate[governorate]=[...new Set(townsByGovernorate[governorate])].sort(collator.compare);
const payload={version:'OpenSyria geography v0.1.5',license:'CC BY 4.0',source:'https://github.com/Open-Syria/data-geography',governorates:governorates.map(x=>x.name.ar).sort(collator.compare),townsByGovernorate};
const output=`/* Syrian governorates and localities. Source: OpenSyria Data Geography v0.1.5, CC BY 4.0. */\nwindow.SYRIA_LOCATIONS=${JSON.stringify(payload)};\n`;
fs.writeFileSync(destination,output);
