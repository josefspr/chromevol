chromEvol Node launcher — this job's inputs and current website code

PREPARATION
Extract the entire ZIP into a folder. Keep all its files together.
Node.js must be installed: check with node --version in a terminal.
If necessary install it from https://nodejs.org and reopen the terminal.
No npm packages, Python or R are required.

The ZIP includes:
- Current deployed run-models.js, core, adequacy and statistics modules
- Current parameter template/defaults and matching chromEvol.js / chromEvol.wasm
- Your tree as TreesFile.txt, counts as countsFile, and original params.txt
- Linux, Windows command prompt and PowerShell fitting scripts
All code, inputs and parameters are in the same extracted folder.
You do not need to save the inputs or parameters separately, rename files,
or edit virtual filesystem paths. Keep chromEvol.js and chromEvol.wasm paired
when updating them.

LINUX
Open a terminal in the extracted folder and run:

sh ./run-fitting.sh

Alternatively: chmod +x run-fitting.sh, then ./run-fitting.sh
The script also works when invoked by its full path from another directory.

WINDOWS
In PowerShell or Command Prompt, open the extracted folder and run:

.\run-fitting.cmd

A PowerShell script is also included: .\run-fitting.ps1
If your execution policy blocks PowerShell scripts, use run-fitting.cmd.

RESULT
The fitting scripts use TreesFile.txt, countsFile and params.txt in their own
folder and create results.zip there. They fit the defined models; heterogeneous
parameters trigger the complete Background/shift model search.
Keep the terminal open and the computer awake while running.
The scripts return the launcher's exit code (0 for success).

The equivalent direct command, on Windows or Linux, is:
node ./run-models.js --tree ./TreesFile.txt --counts ./countsFile --params ./params.txt --output ./results.zip

OPTIONAL ADEQUACY
The default scripts run fitting only. Adequacy needs an explicit --adequacy flag
in Node, even if the browser adequacy checkbox was enabled. Extra script arguments
are forwarded to the launcher.

Linux diagnostic check:
sh ./run-fitting.sh --adequacy best --adequacy-sims 10

Windows diagnostic check:
.\run-fitting.cmd --adequacy best --adequacy-sims 10

Replace 10 with 1000 for the original full simulation count.
To test one named homogeneous model, replace --adequacy best with:
--adequacy selected --adequacy-model "Dys"
For heterogeneous runs, best tests the complete final fit including its shifts.
Ten-simulation results are diagnostic only. The existing adequacy data restrictions
still apply: rooted binary tree, matching taxa, integer counts without missing data,
no digits in taxon-name portions, and no spaces/parentheses/commas/semicolons in
heterogeneous partition taxon labels.

VIEWING RESULTS
Open zip_viewer.html on the website and upload results.zip. The results page
shows the summary, output links and any adequacy p-values. ZIP input is read
locally by the browser. You may also extract the output ZIP to inspect its files.

UPDATES
Code and WASM in this package were fetched from the deployed website when you
clicked Download Node launcher. Download again to obtain later deployed code.
The package runs locally without internet once Node.js is installed.
For all launcher options: node ./run-models.js --help
