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

// Port of the homogeneous branch of edit_param_file(), for data[0].
function createParams(template, model, countsText) {
  // find_MinMax(..., 4): only integer FASTA counts >= 4 determine base number.
  const counts = Object.values(Object.fromEntries(
    countsText.split('>').slice(1).map(record => {
      const lines = record.trim().split(/\r?\n/).filter(line => line.trim());
      return [lines[0], lines[1].trim()];
    })
  )).filter(value => /^\d+$/.test(value) && Number(value) >= 4).map(Number);
  const baseNumber = Math.min(...counts);
  const replacements = {
    '<OUT_DIR>': '/input/ChromEvol_Tree_1/' + model.name,
    '<CNT_FILE>': '/input/countsFile',
    '<TREE_FILE>': '/input/TreesFile.txt',
    '<MAX_CHR_NUM>': '-1', // no fixed root for this simple test
    '<MIN_CHR_NUM>': '-1',
    '<MIN_CLADE_SIZE>': '5',
    '<IS_HETEROGENEOUS>': 'false',
    '<MAX_NUM_MODELS>': '1'
  };
  for (const [key, value] of Object.entries(replacements)) {
    template = template.split(key).join(value);
  }
  const functions = {
    _baseNumberR: '_baseNumRFunc', _gainConstR: '_gainFunc',
    _lossConstR: '_lossFunc', _duplConstR: '_duplFunc',
    _demiPloidyR: '_demiDuplFunc'
  };
  const parameters = {
    _baseNumberR: '_baseNumR', _gainConstR: '_gain',
    _lossConstR: '_loss', _duplConstR: '_dupl', _demiPloidyR: '_demiPloidyR'
  };
  const values = {
    CONST: '1', LINEAR: '2,0.1', LINEAR_BD: '1', EXP: '2,0.1',
    LOGNORMAL: '8,0.17,0.11', REVERSE_SIGMOID: '8,0.17,0.11'
  };
  const lines = [], assigned = {};
  let index = 1;
  // Object.entries preserves the model JSON order, as Python does.
  for (const [transition, func] of Object.entries(model)) {
    if (transition === 'name') continue;
    if (func === 'IGNORE') {
      lines.push(functions[transition] + ' = IGNORE');
    } else if (Object.hasOwn(values, func)) {
      assigned[transition] = index++ + ';' + values[func];
      lines.push(functions[transition] + ' = ' + func,
        parameters[transition] + '_1 = ' + assigned[transition]);
      if (transition === '_baseNumberR') {
        lines.push('_baseNum_1 = ' + index++ + ';' + baseNumber);
      }
    }
  }
  // Shared rates reuse their source parameter index and initial values.
  for (const [transition, source] of Object.entries(model)) {
    if (transition !== 'name' && Object.hasOwn(assigned, source)) {
      lines.push(functions[transition] + ' = ' + model[source],
        parameters[transition] + '_1 = ' + assigned[source]);
    }
  }
  return template + (template.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
}

document.getElementById('inputForm').addEventListener('submit', async event => {
  event.preventDefault();
  const [tree, counts, template] = await Promise.all([
    document.getElementById('tree').files[0].text(),
    document.getElementById('counts').files[0].text(),
    fetch('param_NEW_MODELS_anat').then(response => {
      if (!response.ok) throw new Error('Could not load param_NEW_MODELS_anat');
      return response.text();
    })
  ]);
  // Keep text between pages; the output page creates its own Blob links.
  sessionStorage.setItem('sincopaInput', JSON.stringify({
    tree, counts,
    params: createParams(template, JSON.parse(document.getElementById('models').value)[0], counts)
  }));
  window.location.href = 'output.html';
});
