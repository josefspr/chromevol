/* Browser ZIP import for Sincopa browser/Node exports. */
(function(root){
'use strict';
const decode=bytes=>new TextDecoder().decode(bytes);
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc32(data){let n=0xffffffff;for(const b of data)n=(n>>>8)^crcTable[(n^b)&255];return (n^0xffffffff)>>>0;}
async function readZip(buffer) {
  const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){
    if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===bytes.length){end=p;break;}
  }
  if(end<0)throw new Error('This is not a supported ZIP file.');
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('Split ZIP archives are not supported.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true);
  let p=view.getUint32(end+16,true);
  if(count===65535||p===0xffffffff||size===0xffffffff)throw new Error('ZIP64 archives are not supported.');
  const directoryEnd=p+size;
  if(directoryEnd>end)throw new Error('Invalid ZIP directory.');
  const files=new Map();let expanded=0;
  for(let i=0;i<count;i++) {
    if(p+46>directoryEnd||view.getUint32(p,true)!==0x02014b50)throw new Error('Invalid ZIP entry.');
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true);
    const packed=view.getUint32(p+20,true),unpacked=view.getUint32(p+24,true);
    const nameSize=view.getUint16(p+28,true),extraSize=view.getUint16(p+30,true),commentSize=view.getUint16(p+32,true);
    const local=view.getUint32(p+42,true);
    if(p+46+nameSize+extraSize+commentSize>directoryEnd)throw new Error('Truncated ZIP entry.');
    const name=decode(bytes.subarray(p+46,p+46+nameSize));p+=46+nameSize+extraSize+commentSize;
    if(name.endsWith('/'))continue;
    if(flags&1)throw new Error('Encrypted ZIP files are not supported.');
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||files.has(name))throw new Error('Invalid or duplicate ZIP path.');
    expanded+=unpacked;if(expanded>512*1024*1024)throw new Error('Unpacked archive exceeds 512 MB.');
    if(local+30>bytes.length||view.getUint32(local,true)!==0x04034b50)throw new Error('Invalid ZIP file header.');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    if(start+packed>bytes.length)throw new Error('Truncated ZIP data.');
    let data=bytes.subarray(start,start+packed);
    if(method===8) {
      const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data=new Uint8Array(await new Response(stream).arrayBuffer());
    }else if(method!==0)throw new Error('Unsupported ZIP compression method: '+method);
    if(data.length!==unpacked||crc32(data)!==crc)throw new Error('ZIP integrity check failed: '+name);
    files.set(name,data);
  }
  return files;
}
function restore(files) {
  const text=name=>{if(!files.has(name))throw new Error('Missing archive file: '+name);return decode(files.get(name));};
  const params=text('params.txt'),settings=root.SincopaCore.readParameters(params);
  const definedModels=JSON.parse(settings.definedModels||'[]');
  const nativeFiles=[];
  for(const [name,bytes] of files){
    const match=name.match(/^parameters\/(\d+)_(.+)$/);if(!match)continue;
    const id=Number(match[1])-1;
    nativeFiles.push({id,modelName:definedModels[id]?.name||match[2].replace(/^param_|\.txt$/g,''),filename:match[2],params:decode(bytes)});
  }
  nativeFiles.sort((a,b)=>a.id-b.id);
  const input={params,tree:text('input/TreesFile.txt'),counts:text('input/countsFile'),definedModels,nativeFiles,
    analysisType:settings.analysisType||'Homogenous',maxRateRegimes:settings.maxRateRegimes||'1',minCladeSize:settings.minCladeSize||'5'};
  const groups=new Map();
  for(const [name,bytes] of files){
    const match=name.match(/^models\/(\d+)_([^/]+)\/(.+)$/);if(!match)continue;
    const id=Number(match[1])-1;
    if(!groups.has(id))groups.set(id,{model:nativeFiles.find(m=>m.id===id)||{id,modelName:definedModels[id]?.name||match[2],filename:'param_'+match[2]+'.txt',params:''},files:[]});
    groups.get(id).files.push({name:match[3],bytes});
  }
  const records=[...groups.values()].map(group=>{
    const failure=group.files.find(f=>f.name==='run-status.txt');
    return {...group,error:failure?decode(failure.bytes):undefined};
  });
  if(!records.length)throw new Error('No calculated model outputs were found in this archive.');
  return {input,records,log:files.has('run.log')?decode(files.get('run.log')):''};
}
function openDB(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('sincopa-zip-viewer',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('archive');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function saveArchive(buffer,name){
  const db=await openDB();
  try {await new Promise((resolve,reject)=>{
    const tx=db.transaction('archive','readwrite');tx.objectStore('archive').put({buffer,name},'latest');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Could not save uploaded ZIP.'));
  });}finally{db.close();}
}
async function loadArchive(){
  const db=await openDB();let result;
  try {result=await new Promise((resolve,reject)=>{
    const request=db.transaction('archive').objectStore('archive').get('latest');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
  if(!result)throw new Error('No uploaded ZIP is saved. Open zip_viewer.html and choose a ZIP file.');
  return {...restore(await readZip(result.buffer)),archiveName:result.name};
}
root.SincopaZipImport={readZip,restore,saveArchive,loadArchive};
})(globalThis);
