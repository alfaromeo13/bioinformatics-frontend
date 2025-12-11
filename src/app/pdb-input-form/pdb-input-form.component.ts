import { firstValueFrom } from 'rxjs';
import { Component } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { GlobalService } from '../global-service/global.service';
import { ProteinHttpService } from '../global-service/protein.service';
import { SpinnerComponentService } from '../spinner-component/spinner.component.service';

@Component({
  selector: 'app-pdb-input-form',
  templateUrl: './pdb-input-form.component.html',
  styleUrl: './pdb-input-form.component.css'
})
export class PdbInputFormComponent {

  /** Stores the uploaded PDB file */
  pdbFile: File | null = null;

  /** User input fields for backend API submission */
  form = {
    protein_chains: '',
    partner_chains: '',
    mutations: '',
    detect_interface: false
  };

  constructor(
    public globalService: GlobalService,
    private toastr: ToastrService,
    private loader: SpinnerComponentService,
    private proteinService: ProteinHttpService,
  ) { }

  /**
   * Handles file browsing input.
   * Accepts only .pdb files and stores them locally.
   */
  onFileChange(event: any) {
    const file = event.target.files[0];
    if (file && file.name.endsWith('.pdb')) {
      this.pdbFile = file;
    } else {
      alert("Please upload a valid .pdb file.");
    }
  }

  /**
   * Toggles "detect interface" mode.
   * When enabled, manual mutation input is cleared.
   */
  onCheckBox() {
    this.form.detect_interface = !this.form.detect_interface;
    this.form.mutations = '';
  }

  /**
   * Entry point when the user clicks "GO".
   * Validates input fields, uploads form + PDB to backend,
   * then begins polling for results.
   */
  onGoClick() {
    // --- Validate user input ----
    if (!this.pdbFile) {
      this.toastr.warning('Please upload a PDB file.');
      return;
    }
    if (!this.form.protein_chains.trim()) {
      this.toastr.warning('Protein Chains must be entered.');
      return;
    }
    if (!this.form.partner_chains.trim()) {
      this.toastr.warning('Partner Chains must be entered.');
      return;
    }
    if (!this.form.mutations.trim() && !this.form.detect_interface) {
      this.toastr.warning('Please provide Mutations or enable Detect Interface.');
      return;
    }

    // Start backend request
    this.loader.setLoading(true);

    this.proteinService.postData(this.form, this.pdbFile).subscribe({
      next: (res) => {
        this.pdbFile = null;

        // Store job ID and begin polling for results
        if (res.job_id) {
          localStorage.setItem('proteinJobId', res.job_id);
          this.waitForResults(res.job_id);
        }
      },
      error: (err) => {
        this.loader.setLoading(false);
        console.error('Error:', err);
        this.toastr.error('Failed to start job.');
      }
    });
  }

  /**
   * Retrieves the tail-end of backend log output.
   * Keeps only the last 15 lines for UI readability.
   */
  private async fetchJobLog(jobId: string) {
    try {
      const res: any = await firstValueFrom(this.proteinService.getJobLog(jobId));
      if (res && res.log) {
        let log = res.log.trim();
        const lines = log.split('\n');

        if (lines.length > 15) {
          log = lines.slice(-15).join('\n');
          log = '... (truncated)\n' + log;
        }

        this.loader.jobLog = log;
      }
    } catch (err) {
      console.warn('Log fetch failed:', err);
    }
  }

  /**
   * Polls backend every N seconds to check when job is complete.
   * When complete:
   *  - retrieves file list
   *  - loads PDBs into NGL viewer
   *  - parses and loads DAT files
   */
  async waitForResults(jobId: string, interval = 15000): Promise<void> {

    let timeoutHandle: any;

    const check = async () => {
      try {
        // Refresh log output
        await this.fetchJobLog(jobId);

        // Get job status from backend
        const res = await firstValueFrom(this.proteinService.getResultList(jobId));

        if (res.status === 'completed') {

          clearTimeout(timeoutHandle);

          // Save filenames globally
          this.globalService.resultFiles = res.files;
          this.toastr.success('Results ready!');

          const pdbFiles = res.files.filter((f: string) => f.endsWith('.pdb'));
          const datFiles = res.files.filter((f: string) => f.endsWith('.dat'));

          // Load all PDB structures into viewer
          await this.globalService.loadAllPdbsFromBackend(jobId, pdbFiles);

          // Parse and store .dat mutation files
          if (datFiles.length) {
            await this.loadDatFilesAndPlot(jobId, datFiles);
          }

          // End UI loading indicator
          this.loader.setLoading(false);
          this.loader.jobLog = '';
          return;
        }

        // Not completed → schedule next poll
        timeoutHandle = setTimeout(check, interval);

      } catch (err: any) {
        console.error('Polling error:', err);
        clearTimeout(timeoutHandle);
        this.loader.setLoading(false);
        this.toastr.error('Error checking results');
      }
    };

    check();
  }

  /**
   * Loads all .dat files for the finished job and parses them into the
   * mutation-analysis cache used for heatmaps.
   */
  async loadDatFilesAndPlot(jobId: string, datFiles: string[]): Promise<void> {
    const allData: any[] = [];

    // Load & parse each DAT file individually
    for (const file of datFiles) {
      const text = await firstValueFrom(this.proteinService.getFileContent(jobId, file));
      const parsed = this.globalService.parseFullDat(text, file);

      allData.push(parsed);

      const key = file.replace(/\.dat$/i, '');
      this.globalService.parsedByFile[key] = parsed;
    }

    // Expose mutation keys for the MutationAnalysisComponent
    this.globalService.datMutations = Object.keys(this.globalService.parsedByFile);

    // Pre-build a combined overview heatmap dataset (optional)
    const residues = Array.from(new Set(allData.flatMap(d => d.entries.map((e: any) => e.residue))));
    const mutants = Array.from(new Set(allData.flatMap(d => d.entries.map((e: any) => e.mutant))));
    const z: number[][] = residues.map(() => Array(mutants.length).fill(NaN));

    for (const d of allData) {
      for (const e of d.entries) {
        const y = residues.indexOf(e.residue);
        const x = mutants.indexOf(e.mutant);
        if (y !== -1 && x !== -1) z[y][x] = e.energy;
      }
    }

    this.globalService.showHeatmap$.next();
  }
}
