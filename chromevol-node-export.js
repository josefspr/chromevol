/* Shared launcher ZIP builder used by index.html and results.html. */
(function(root){
'use strict';
function filename(input){
  const title=String(input.jobTitle||root.SincopaCore.readParameters(input.params||'').jobTitle||'results')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim()||'results';
  return 'chromevol-launch-node-'+title+'.zip';
}
async function build(input){
  if(!input?.tree||!input?.counts||!input?.params)throw new Error('Prepare the tree, counts and parameters before downloading.');
  const sources=[
    ['run-models.js','run-models.js'],
    ['chromevol-core.js','chromevol-core.js'],
    ['chromevol-adequacy.js','chromevol-adequacy.js'],
    ['chromevol-statistics.js','chromevol-statistics.js'],
    ['param_NEW_MODELS_anat.txt','param_NEW_MODELS_anat.txt'],
    ['DEFAULT_PARAM_VALUES.txt','DEFAULT_PARAM_VALUES.txt'],
    ['chromEvol.js','chromEvol.js'],
    ['chromEvol.wasm','chromEvol.wasm'],
    ['README-node.txt','README.txt']
  ];
    const entries=await Promise.all(sources.map(async([source,name])=>{
      const response=await fetch(source,{cache:'no-store'});
      if(!response.ok)throw new Error('Could not load '+source+' (HTTP '+response.status+').');
      return {name,content:new Uint8Array(await response.arrayBuffer())};
    }));
    entries.push(
      {name:'TreesFile.txt',content:input.tree},
      {name:'countsFile',content:input.counts},
      {name:'params.txt',content:root.SincopaCore.portableParams(input.params)},
      {name:'run-chromevol.sh',content:[
        '#!/bin/sh',
        'cd -- "$(dirname -- "$0")" || exit 1',
        'exec node ./run-models.js --tree ./TreesFile.txt --counts ./countsFile --params ./params.txt --output ./results.zip "$@" > ./run.log 2>&1',
        ''
      ].join('\n')},
      {name:'run-chromevol.cmd',content:[
        '@echo off','setlocal','cd /d "%~dp0"',
        'node ".\\run-models.js" --tree ".\\TreesFile.txt" --counts ".\\countsFile" --params ".\\params.txt" --output ".\\results.zip" %* > ".\\run.log" 2>&1',
        'exit /b %errorlevel%',''
      ].join('\r\n')},
      {name:'run-chromevol.ps1',content:[
        '# Run from any working directory. Extra arguments are passed to the launcher.',
        '& node (Join-Path $PSScriptRoot "run-models.js") --tree (Join-Path $PSScriptRoot "TreesFile.txt") --counts (Join-Path $PSScriptRoot "countsFile") --params (Join-Path $PSScriptRoot "params.txt") --output (Join-Path $PSScriptRoot "results.zip") @args > (Join-Path $PSScriptRoot "run.log") 2>&1',
        'exit $LASTEXITCODE',''
      ].join('\r\n')}
    );

  if(input.originalTree!==undefined)entries.push({name:'TreesFile_original.txt',content:input.originalTree});
  if(input.originalCounts!==undefined)entries.push({name:'countsFile_original',content:input.originalCounts});
  if(input.taxaMatchingSummary)entries.push({name:'taxa_matching_report.txt',content:input.taxaMatchingSummary});
  if(input.taxaMatching)entries.push({name:'taxa_matching_report.json',content:JSON.stringify(input.taxaMatching,null,2)+'\n'});
  return {blob:root.SincopaCore.makeZip(entries),filename:filename(input)};
}
function download({blob,filename}){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
root.ChromevolNodeExport={build,download,filename};
})(globalThis);
