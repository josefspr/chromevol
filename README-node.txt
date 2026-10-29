ChromEvol Node launcher

PREPARATION
-----------
Extract the entire ZIP into a folder. Keep all its files together.
Node.js must be installed: 
check with node --version in a terminal.
If necessary install it from https://nodejs.org and reopen the terminal.
No npm packages, Python or R are required.

The ZIP includes:
-----------------
- Current deployed run-models.js, core, adequacy and statistics modules
- Current parameter template/defaults and matching chromEvol.js / chromEvol.wasm
- Your tree as TreesFile.txt, counts as countsFile, and original params.txt
- Linux, Windows command prompt and PowerShell run-chromevol scripts
All code, inputs and parameters are in the same extracted folder.
You do not need to save the inputs or parameters separately, rename files,
or edit virtual filesystem paths. Keep chromEvol.js and chromEvol.wasm paired
when updating them.

RUNNING CHROMEVOL 
-----------------
LINUX
Open a terminal in the extracted folder and run:

sh ./run-chromevol.sh

Alternatively: chmod +x run-chromevol.sh, then ./run-chromevol.sh
The script also works when invoked by its full path from another directory.

WINDOWS
In PowerShell or Command Prompt, open the extracted folder and run:

.\run-chromevol.cmd

A PowerShell script is also included: .\run-chromevol.ps1
If your execution policy blocks PowerShell scripts, use run-fitting.cmd.

RESULTS
-------
The scripts use TreesFile.txt, countsFile and params.txt in their own folder
and create results.zip there. 

The scripts return the launcher's exit code (0 for success).

The equivalent direct command, on Windows or Linux, is:
node ./run-models.js --tree ./TreesFile.txt --counts ./countsFile --params ./params.txt --output ./results.zip

OPTIONAL ADEQUACY
-----------------
The default scripts follow the adequacy checkbox, model choice and simulation
count saved in params.txt. No extra command-line flags are needed.
Explicit command-line arguments override the saved settings. Extra script arguments
are forwarded to the launcher. To disable adequacy for one run, append:
--adequacy none

To override the simulation count, append --adequacy-sims 10 (or 1000).
The following commands explicitly enable adequacy on the best model:

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
---------------
Open homepage (index.html) on the website and upload results.zip. The results page
shows the summary, output links and any adequacy p-values. ZIP input is read
locally by the browser. You may also extract the output ZIP to inspect its files.

UPDATES
Code and WASM in this package were fetched from the deployed website when you
clicked Download Node launcher. Download again to obtain later deployed code.
The package runs locally without internet once Node.js is installed.
For all launcher options: node ./run-models.js --help

RUN LOG
All included run scripts redirect stdout and stderr to run.log in the extracted
job folder. The terminal remains quiet while the program is running. Each new run
overwrites run.log. The script still returns the Node launcher exit code.
Linux: tail -f run.log
PowerShell: Get-Content .\run.log -Wait
Open a second terminal to monitor the log while the first one runs the job.

