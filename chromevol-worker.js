/* Uses the classic globals in the supplied chromEvol.js. */
self.onmessage = async ({data}) => {
  let started = false;
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
    print: text => self.postMessage({type: 'log', text: String(text)}),
    printErr: text => self.postMessage({type: 'log', text: String(text)}),
    onAbort: reason => self.postMessage({type: 'error', text: 'WASM aborted: ' + reason}),
    onRuntimeInitialized() {
      started = true;
      let code, failure;
      try {
        FS.mkdirTree('/input');
        FS.mkdirTree('/results');
        FS.writeFile('/input/TreesFile.txt', data.tree);
        FS.writeFile('/input/countsFile', data.counts);
        FS.writeFile('/input/params.txt', data.params.replace(/\r\n?/g, '\n'));
        FS.chdir('/input');
        // One command-line argument, matching the Python executable call.
        code = callMain(['param=/input/params.txt']);
      } catch (error) {
        failure = String(error);
      }
      try {
        self.postMessage({type: 'done', code, error: failure, files: collect('/results')});
      } catch (error) {
        self.postMessage({type: 'error', text: String(error)});
      }
    }
  };
  try {
    importScripts('chromEvol.js');
  } catch (error) {
    if (!started) self.postMessage({type: 'error', text: String(error)});
  }
};
