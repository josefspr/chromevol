#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {fork}=require('node:child_process');
const {createRequire}=require('node:module');
const core=require('./chromevol-core.js');
const adequacy=require('./chromevol-adequacy.js');
const maStats=require('./chromevol-statistics.js');

// Execute this non-modular Emscripten build in an isolated child process.
async function worker(job) {
  const loader=path.resolve(job.loader), dir=path.dirname(loader);
  return new Promise((resolve,reject)=>{
    const context={require:createRequire(loader),process,console,__dirname:dir,__filename:loader,
      WebAssembly,TextDecoder,TextEncoder,URL,setTimeout,clearTimeout,Buffer};
    const print=(...items)=>console.log(...items);
    context.Module={noInitialRun:true,noExitRuntime:true,print,printErr:(...items)=>console.error(...items),
      locateFile:name=>name.endsWith('.wasm')?job.wasm:path.join(dir,name),
      onAbort:message=>reject(new Error('WASM aborted: '+message)),
      onRuntimeInitialized(){
        try {
          const FS=context.FS;
          FS.mkdirTree('/input');FS.mkdirTree('/results');
          FS.writeFile('/input/TreesFile.txt',core.normalizeText(job.tree));
          FS.writeFile('/input/countsFile',core.normalizeText(job.counts));
          let nativeParams=core.fixPaths(job.params);
          if(job.simulationCount){
            // In simulation mode _dataFile is an output directory, not a counts file.
            nativeParams=nativeParams.replace(/^_dataFile\s*=.*$/m,'_dataFile = /results');
            for(let i=0;i<job.simulationCount;i++)FS.mkdirTree('/results/'+i);
          }
          FS.writeFile('/input/params.txt',nativeParams);
          for(const file of job.extraFiles||[])FS.writeFile('/input/'+file.name,file.bytes);
          FS.chdir('/input');
          let code=0,error;
          try { code=context.callMain(['param=/input/params.txt'])??0; }
          catch(e){
            if(e?.name==='ExitStatus')code=e.status;
            else {code=1;error=e?.stack||String(e);}
          }
          const files=[];
          function collect(folder,prefix='') {
            for(const name of FS.readdir(folder)) {
              if(name==='.'||name==='..')continue;
              const target=folder+'/'+name,relative=prefix+name;
              if(FS.isDir(FS.stat(target).mode))collect(target,relative+'/');
              else files.push({name:relative,bytes:Buffer.from(FS.readFile(target))});
            }
          }
          collect('/results');
          resolve({code,error,files});
        } catch(e){reject(e);}
      }
    };
    // Run in Node's main realm, avoiding cross-context global lookups.
    try {
      const source=fs.readFileSync(loader,'utf8');
      const load=new Function('Module','require','__dirname','__filename',
        source+'\nreturn {FS,callMain};\n');
      const runtime=load(context.Module,context.require,dir,loader);
      context.FS=runtime.FS;
      context.callMain=runtime.callMain;
    }
    catch(e){reject(e);}
  });
}
if(process.argv[2]==='--internal-worker') {
  process.once('message',async job=>{
    try {
      const result=await worker(job);
      process.send(result,()=>process.exit(0));
    }catch(e){process.send({code:1,error:e.stack||String(e),files:[]},()=>process.exit(1));}
  });
} else {
  main().catch(error=>{console.error('Error: '+error.message);process.exitCode=1;});
}

async function main() {
  const args=process.argv.slice(2),opts={};
  if(!args.length||args.includes('--help')) {
    console.log(`Usage: node run-models.js --tree TREE --counts COUNTS --params PARAMS [--output RESULTS.zip]

Required: original params.txt with definedModels JSON (not a native param_Model.txt).
Optional paths (default: beside this script):
  --loader chromEvol.js
  --wasm chromEvol.wasm
  --template param_NEW_MODELS_anat.txt
  --defaults DEFAULT_PARAM_VALUES.txt
  --adequacy best|selected|all (homogeneous or heterogeneous model adequacy)
  --adequacy-model NAME (for selected)
  --adequacy-sims 1000 (default; use 10 for a quick check)

The ZIP matches the browser export. No npm installation is required.`);
    return;
  }
  const allowed=new Set(['tree','counts','params','output','loader','wasm','template','defaults','adequacy','adequacy-model','adequacy-sims']);
  for(let i=0;i<args.length;i+=2) {
    const key=args[i].replace(/^--/,'');
    if(!args[i].startsWith('--')||!allowed.has(key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid option: '+args[i]+' (use --help)');
    opts[key]=args[i+1];
  }
  for(const key of ['tree','counts','params'])if(!opts[key])throw new Error('Missing --'+key);
  const local=name=>path.join(__dirname,name);
  const loader=path.resolve(opts.loader||local('chromEvol.js'));
  const wasm=path.resolve(opts.wasm||path.join(path.dirname(loader),'chromEvol.wasm'));
  fs.accessSync(loader,fs.constants.R_OK);fs.accessSync(wasm,fs.constants.R_OK);
  const read=file=>fs.readFileSync(file,'utf8');
  const original=read(opts.params),settings=core.readParameters(original);
  if(!['Homogenous','TimeHeterogeneous',undefined].includes(settings.analysisType))throw new Error('Only homogeneous and time heterogeneous analyses are supported.');
  const definitions=JSON.parse(settings.definedModels||'[]');
  if(!Array.isArray(definitions)||!definitions.length)throw new Error('params.txt must contain at least one model in definedModels.');
  const input=core.prepareRun({tree:read(opts.tree),counts:read(opts.counts),params:original,
    template:read(opts.template||local('param_NEW_MODELS_anat.txt')),
    defaultsText:read(opts.defaults||local('DEFAULT_PARAM_VALUES.txt'))});
  const mode=opts.adequacy;
  if(mode&&!['best','selected','all'].includes(mode))throw new Error('--adequacy must be best, selected or all.');
  if(mode==='selected'&&!opts['adequacy-model'])throw new Error('Use --adequacy-model NAME with selected.');
  const simulations=Number(opts['adequacy-sims']||1000);
  if(!Number.isInteger(simulations)||simulations<1)throw new Error('--adequacy-sims must be a positive integer.');
  const results=[],logs=[],adequacyEntries=[];let adequacyFailed=false;
  let active,stopped=false;
  const stop=()=>{stopped=true;active?.kill();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  async function runJob(job,label) {
    return new Promise(resolve=>{
        const child=fork(__filename,['--internal-worker'],{stdio:['ignore','pipe','pipe','ipc'],serialization:'advanced'});
        active=child;let reply;
        for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
          const line=chunk.toString();logs.push('['+label+'] '+line);process.stdout.write(line);
        });
        child.on('message',message=>{reply=message;});
        child.on('error',error=>{reply={code:1,error:error.message,files:[]};});
        child.on('close',(code,signal)=>{
          active=undefined;
          resolve(reply||{code:code??1,error:stopped?'Stopped by user':'Worker ended without results ('+(signal||code)+')',files:[]});
        });
        child.send({loader,wasm,...job});
      });
  }
  const output=path.resolve(opts.output||'sincopa-results.zip');
  try {
    for(const model of input.nativeFiles) {
      if(stopped)break;
      const heading='Running '+(model.id+1)+'/'+input.nativeFiles.length+': '+model.modelName;
      console.log(heading);logs.push(heading+'\n');
      const data=await runJob({tree:input.tree,counts:input.counts,params:model.params},model.modelName);
      const record=core.parseRun(model,data.files||[],data.error||(data.code!==0?'Exit code '+data.code:undefined));
      if(!record.error&&!record.files.some(file=>file.name==='chromEvol.res'))record.summaryError='chromEvol.res was not generated.';
      results.push(record);
    }
    if(mode&&!stopped) {
      let selected=[];
      try {selected=adequacy.selectModels(results,mode,opts['adequacy-model']);}
      catch(error){
        adequacyFailed=true;
        adequacyEntries.push({name:'adequacy/selection_error.txt',content:error.message});
        console.error(error.message);
      }
      for(const record of selected) {
        if(stopped)break;
        const safe=record.modelName.replace(/[^a-zA-Z0-9._=-]/g,'_');
        const folder='adequacy/'+(record.id+1)+'_'+safe+'/';
        try {
          let job=adequacy.prepareSimulation(record,input,{simulations});
          const plan=adequacy.baseCorrectionPlan(record,input,job);
          if(plan.required) {
            if(plan.needed) {
              const heading='Base-number correction for '+record.modelName;
              console.log(heading);logs.push(heading+'\n');
              adequacyEntries.push({name:folder+'base_correction/second_run.params',content:plan.job.params});
              const refit=await runJob(plan.job,'MA correction '+record.modelName);
              for(const file of refit.files||[])adequacyEntries.push({name:folder+'base_correction/'+file.name,content:file.bytes});
              if(refit.error||refit.code!==0)throw new Error('Base-number correction failed: '+(refit.error||refit.code));
              const corrected=core.parseRun(record,refit.files||[]);
              if(!corrected.parsed||corrected.summaryError)throw new Error('Base-number correction did not produce a readable final model.');
              const refitText=core.textOf(refit.files.find(f=>f.name==='chromEvol.res').bytes);
              const inferredMax=Number(refitText.match(/Max allowed chromosome number\s*=\s*(\d+)/)?.[1]);
              if(Number.isFinite(inferredMax)){job.maxChromosome=Math.max(job.maxChromosome,inferredMax);job.minimumMaxChromosome=inferredMax;}
              plan.complete=true;
            }
            job.params=adequacy.setParameter(job.params,'_maxBaseNumTransition',plan.maxBaseNumTransition);
          }
          const {job:unusedJob,...planReport}=plan;
          adequacyEntries.push({name:folder+'base_correction.json',content:JSON.stringify(planReport,null,2)+'\n'});
          const heading='Running '+simulations+' adequacy simulations for '+record.modelName;
          console.log(heading);logs.push(heading+'\n');
          adequacyEntries.push({name:folder+'tree_wo_counts.tree',content:job.tree});
          for(const file of job.extraFiles)adequacyEntries.push({name:folder+file.name,content:file.bytes});
          const batchRun=await adequacy.boundedSimulations({job,counts:input.counts,isStopped:()=>stopped,
            execute:async (attempt,index)=>{
              const message='Adequacy attempt '+(index+1)+' for '+record.modelName+': max chromosome '+attempt.maxChromosome;
              console.log(message);logs.push(message+'\n');
              return runJob(attempt,'MA '+record.modelName);
            },onAttempt:({index,job:attempt,result})=>{
              const prefix=folder+'attempts/'+(index+1)+'/';
              adequacyEntries.push({name:prefix+'param_sim.txt',content:attempt.params});
              for(const file of result.files||[])adequacyEntries.push({name:prefix+'simulations/'+file.name,content:file.bytes});
            }});
          adequacyFailed ||= !batchRun.passed;
          adequacyEntries.push({name:folder+'simulation_attempts.json',content:JSON.stringify(batchRun.attempts,null,2)+'\n'},
            {name:folder+'simulation_check.json',content:JSON.stringify(batchRun.check,null,2)+'\n'},
            {name:folder+'param_sim.txt',content:batchRun.job.params});
          for(const file of batchRun.result.files||[])adequacyEntries.push({name:folder+'simulations/'+file.name,content:file.bytes});
          console.log('Simulation file check: '+(batchRun.passed?'PASS':'FAILED after retries / execution error'));
          if(batchRun.passed) {
            const mlTree=record.files.find(file=>file.name==='MLAncestralReconstruction.tree');
            const batch=maStats.calculateBatch({counts:input.counts,tree:core.textOf(mlTree.bytes),files:batchRun.result.files,simulations,hasBaseNumber:job.hasBaseNumber,baseCorrectionComplete:plan.complete});
            batch.baseCorrection=planReport;
            if(!batch.provisional)batch.stage=job.heterogeneous?'heterogeneous-model-adequacy':'homogeneous-model-adequacy';
            batch.fittedModel={name:core.fitName(record),regimes:job.regimeCount,heterogeneous:job.heterogeneous,scope:'Complete selected fit, including every regime; not an independent test of each regime.'};
            for(const file of maStats.batchFiles(batch))adequacyEntries.push({name:folder+file.name,content:file.content});
            console.log('Four adequacy statistics calculated'+(batch.provisional?' (diagnostic only).':'.'));
          }
        }catch(error){
          adequacyFailed=true;
          adequacyEntries.push({name:folder+'adequacy_error.json',content:JSON.stringify({stage:'model-adequacy',passed:false,error:error.message},null,2)});
          console.error('Adequacy simulation check failed: '+error.message);
        }
      }
    }
    const log=logs.join('')+(stopped?'\nRun interrupted. Archive contains available results only.\n':'');
    const zip=core.makeZip([...core.exportEntries({input,results,log}),...adequacyEntries]);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,Buffer.from(await zip.arrayBuffer()));
    console.log('\nSaved '+output);
    const failed=results.filter(r=>r.error||r.summaryError).length;
    console.log(results.length+'/'+input.nativeFiles.length+' model(s) processed; '+failed+' failed or missing summaries.');
    if(mode)console.log('Adequacy simulation check: '+(adequacyFailed?'FAILED / follow-up required':'completed')+'; see adequacy.json for diagnostic status and limitations.');
    process.exitCode=stopped?130:(failed||adequacyFailed)?1:0;
  } finally {
    active?.kill();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}
