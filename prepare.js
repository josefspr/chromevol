// The six default models from the supplied index.html.
const definitions = [
  ['DysBnum', 'CONST', 'IGNORE', 'IGNORE'],
  ['DysBnumDup', 'CONST', 'CONST', 'IGNORE'],
  ['DysDup', 'IGNORE', 'CONST', 'IGNORE'],
  ['DysDupDem=', 'IGNORE', 'CONST', '_duplConstR'],
  ['DysDupDem', 'IGNORE', 'CONST', 'CONST'],
  ['Dys', 'IGNORE', 'IGNORE', 'IGNORE']
];
const models = definitions.map(([name, base, duplication, demi]) => ({
  name, _baseNumberR: base, _duplConstR: duplication,
  _gainConstR: 'CONST', _lossConstR: 'CONST', _demiPloidyR: demi
}));
document.getElementById('models').value = JSON.stringify(models, null, 2);

// This reproduces the relevant CGI wrapper fields, not a native model template.
function createParams(definedModels) {
  return [
    'analysisType:Homogenous',
    'NumberOfTrees:1',
    'TreesDirArr:/input/ChromEvol_Tree_1,',
    'AdeqTest:NO',
    'definedModels:' + definedModels.replace(/\r?\n\s*/g, ''),
    '_treesFile:/input/TreesFile.txt',
    '_dataFile:/input/countsFile',
    '_outDir:/input/chromevol_out',
    '_name:browser_run',
    '_cpusNum:1'
  ].join('\n') + '\n';
}

document.getElementById('inputForm').addEventListener('submit', async event => {
  event.preventDefault();
  const [tree, counts] = await Promise.all([
    document.getElementById('tree').files[0].text(),
    document.getElementById('counts').files[0].text()
  ]);
  // Keep text between pages; the output page creates its own Blob links.
  sessionStorage.setItem('sincopaInput', JSON.stringify({
    tree, counts,
    params: createParams(document.getElementById('models').value)
  }));
  window.location.href = 'output.html';
});
