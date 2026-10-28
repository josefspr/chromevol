importScripts('chromevol-core.js');
/* Uses the classic globals in the supplied chromEvol.js. */
self.onmessage = async ({data}) => {
  let started = false;
  let pendingLogs = [], lastLogFlush = Date.now();
  function flushLogs() {
    if (!pendingLogs.length) return;
    self.postMessage({type:'logBatch', texts:pendingLogs});
    pendingLogs = []; lastLogFlush = Date.now();
  }
  function queueLog(text) {
    pendingLogs.push(String(text));
    // WASM blocks this worker's event loop: check the clock instead of using a timer.
    if (Date.now() - lastLogFlush >= 1000) flushLogs();
  }
  function collect(directory) {
    const files = [];
    for (const name of FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const path = directory + '/' + name;
      if (FS.isDir(FS.stat(path).mode)) files.push(...collect(path));
      else files.push({name: path.slice('/results/'.length), bytes: FS.readFile(path)});
    }
    return files;
  }
  self.Module = {
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: name => new URL(name, self.location.href).href,
    print: queueLog,
    printErr: queueLog,
    onAbort: reason => {flushLogs();self.postMessage({type: 'error', text: 'WASM aborted: ' + reason});},
    onRuntimeInitialized() {
      started = true;
      let code, failure;
      try {
        FS.mkdirTree('/input');
        FS.mkdirTree('/results');
        FS.writeFile('/input/TreesFile.txt', data.tree);
        FS.writeFile('/input/countsFile', data.counts);
        let params=SincopaCore.fixPaths(data.params);
        if(data.simulationCount){
          params=params.replace(/^_dataFile\s*=.*$/m,'_dataFile = /results');
          for(let i=0;i<data.simulationCount;i++)FS.mkdirTree('/results/'+i);
        }
        for(const file of data.extraFiles||[])FS.writeFile('/input/'+file.name,file.bytes);
        FS.writeFile('/input/params.txt', params); 
        FS.chdir('/input');
        // One command-line argument, matching the Python executable call.
        code = callMain(['param=/input/params.txt'])??0;
      } catch (error) {
        if(error?.name==='ExitStatus')code=error.status;
        else {code=1;failure=error?.message||String(error);}
      }
      try {
        flushLogs();
        self.postMessage({type: 'done', code, error: failure, files: collect('/results')});
      } catch (error) {
        flushLogs();self.postMessage({type: 'error', text: String(error)});
      }
    }
  };
  try {
    importScripts('chromEvol.js');
  } catch (error) {
    if (!started) flushLogs();self.postMessage({type: 'error', text: String(error)});
  }
};
