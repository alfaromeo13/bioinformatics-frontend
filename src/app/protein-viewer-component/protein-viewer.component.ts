import * as NGL from 'ngl';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { ProteinViewerService } from './protin-viewer..service';
import { ToastrService } from 'ngx-toastr';
import { LoaderService } from '../services/loader.service';
import { firstValueFrom } from 'rxjs';
import Plotly from 'plotly.js-dist-min';

@Component({
  selector: 'app-protein-viewer-component',
  templateUrl: './protein-viewer.component.html',
  styleUrl: './protein-viewer.component.css'
})
export class ProteinViewerComponent {

  comp: any = null;
  stage: any = null;
  showViewer = false;
  selectedFileContent = '';
  resultFiles: string[] = [];
  pdbFile: File | null = null;
  availableChains: string[] = [];
  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private loader: LoaderService,
    private toastr: ToastrService,
    private proteinService: ProteinViewerService,
  ) { }

  form = {
    protein_chains: '',
    partner_chains: '',
    mutations: '',
    detect_interface: false
  };

  viewerSettings = {
    representation: 'cartoon',
    color: 'chainname',
    focusChain: ''
  };

  onFileChange(event: any) {
    const file = event.target.files[0];
    if (file && file.name.endsWith('.pdb')) {
      this.pdbFile = file;
    } else {
      alert("Please upload a valid .pdb file.");
    }
  }

  onCheckBox() {
    this.form.detect_interface = !this.form.detect_interface;
    this.form.mutations = '';
  }

  onGoClick() {
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

    // --- If all good, proceed ---
    this.loader.setLoading(true);

    this.proteinService.postData(this.form, this.pdbFile).subscribe({
      next: (res) => {
        this.pdbFile = null;
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

  /** Check periodically until results appear (max 10 min) **/
  private async waitForResults(jobId: string, maxWait = 10 * 60 * 1000, interval = 15000): Promise<void> {
    const start = Date.now();
    let timeoutHandle: any; // store the timeout reference

    const check = async () => {
      try {

        const res = await firstValueFrom(this.proteinService.getResultList(jobId));

        if (res.status === 'completed') {

          clearTimeout(timeoutHandle);
          this.resultFiles = res.files;
          this.toastr.success('Results ready!');

          const pdbFiles = res.files.filter((f: string) => f.endsWith('.pdb'));
          const datFiles = res.files.filter((f: string) => f.endsWith('.dat'));

          // Wait for both PDBs and DATs to finish loading
          await this.loadAllPdbsFromBackend(jobId, pdbFiles);
          if (datFiles.length) await this.loadDatFilesAndPlot(jobId, datFiles);

          this.loader.setLoading(false);
          return;
        }

        // Timeout check
        if (Date.now() - start >= maxWait) {
          clearTimeout(timeoutHandle); // stop any further checks
          this.loader.setLoading(false);
          this.toastr.warning('Timeout after 10 min.');
          return;
        }

        // Schedule next check
        timeoutHandle = setTimeout(check, interval);

      } catch (err: any) {
        console.error('Polling error:', err);
        clearTimeout(timeoutHandle); // also clear on error
        this.loader.setLoading(false);
        this.toastr.error('Error checking results');
      }
    };
    check();
  }

  private getAvailableChains(): string[] {
    if (!this.stage) return [];
    const names = new Set<string>();
    this.stage.compList.forEach((comp: any) => {
      const structure = comp.structure;
      structure.eachChain((chainProxy: any) => {
        if (chainProxy.chainname && chainProxy.chainname.trim() !== '') {
          names.add(chainProxy.chainname.trim());
        }
      });
    });
    return Array.from(names);
  }

  private scrollToViewer(): void {
    if (this.viewerSection && this.viewerSection.nativeElement) {
      setTimeout(() => {
        this.viewerSection.nativeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      });
    }
  }

  loadAllPdbsFromBackend(jobId: string, pdbFiles: string[]): Promise<void> {
    return new Promise(async (resolve, reject) => {
      this.showViewer = true;
      await new Promise(r => setTimeout(r)); // let Angular render the div

      if (!this.stage) {
        this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
        window.addEventListener("resize", () => this.stage.handleResize(), false);
      } else {
        this.availableChains = [];
        this.viewerSettings.focusChain = '';
        this.stage.removeAllComponents();
      }

      let remaining = pdbFiles.length;

      pdbFiles.forEach((filename, i) => {
        this.proteinService.getFileContent(jobId, filename).subscribe({
          next: (res) => {
            if (res) {
              const blob = new Blob([res], { type: 'text/plain' });
              this.stage.loadFile(blob, { ext: 'pdb' }).then((comp: any) => {
                this.comp = comp;

                console.log('All chains and residues:');
                this.comp.structure.eachChain((chain: any) => {
                  console.log(`Chain: ${chain.chainname}, Residues: ${chain.residueCount}`);
                });

                comp.addRepresentation('cartoon', { colorScheme: 'chainname' });
                if (i === 0) this.stage.autoView();
                remaining--;
                if (remaining === 0) {
                  // All PDBs loaded, now do final centering, zoom, and scroll
                  this.stage.autoView();

                  setTimeout(() => {
                    this.stage.autoView();
                    this.animateCameraZoom(0.7, 1000);
                    this.availableChains = this.getAvailableChains();
                    this.stage.viewer.signals.rendered.addOnce(() => {
                      this.loader.setLoading(false);
                      this.scrollToViewer(); // scroll to the viewer
                    });
                  }, 100);
                  resolve();
                }
              });
            } else {
              console.warn(`Empty response for ${filename}`);
              remaining--;
              if (remaining === 0) resolve();
            }
          },
          error: (err) => {
            console.error('Error loading PDB:', err);
            this.toastr.error(`Failed to load ${filename}`);
            reject(err);
          }
        });
      });
    });
  }

  /** Parse a full .dat file into structured energy data */
  private parseFullDat(content: string, filename: string) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('GENERATED') && !l.startsWith('SMEHEC') && !l.startsWith('JOINING'));
    const parsed: { residue: string; mutant: string; energy: number }[] = [];

    for (const line of lines) {
      const match = line.match(/([A-Z0-9_]+)\s+(-?\d+(?:\.\d+)?)/);
      if (match) {
        const id = match[1]; // e.g. PROC_60_E2A
        const energy = parseFloat(match[2]);
        // extract residue index (number) and mutant amino acid (last letter)
        const residueMatch = id.match(/(\d+)/);
        const mutantMatch = id.match(/([A-Z])$/);
        const residue = residueMatch ? residueMatch[1] : 'UNK';
        const mutant = mutantMatch ? mutantMatch[1] : '?';
        parsed.push({ residue, mutant, energy });
      }
    }

    return { file: filename.replace('.dat', ''), entries: parsed };
  }

  /** Load .dat files and build a 2D heatmap matrix */
  async loadDatFilesAndPlot(jobId: string, datFiles: string[]): Promise<void> {
    const allData: any[] = [];

    for (const file of datFiles) {
      const res = await firstValueFrom(this.proteinService.getFileContent(jobId, file));
      allData.push(this.parseFullDat(res, file));
    }

    // collect all unique residues and mutants
    const residues = Array.from(new Set(allData.flatMap(d => d.entries.map((e: any) => e.residue))));
    const mutants = Array.from(new Set(allData.flatMap(d => d.entries.map((e: any) => e.mutant))));

    // fill matrix z[y][x]
    const z: number[][] = residues.map(() => Array(mutants.length).fill(NaN));

    for (const d of allData) {
      for (const e of d.entries) {
        const y = residues.indexOf(e.residue);
        const x = mutants.indexOf(e.mutant);
        if (y !== -1 && x !== -1) z[y][x] = e.energy;
      }
    }

    this.plotHeatmap({
      x: mutants,
      y: residues,
      z
    });
  }

  plotHeatmap(data: { x: string[]; y: string[]; z: number[][] }) {
    const allVals = data.z.flat().filter(v => Number.isFinite(v));
    const zmin = Math.min(...allVals);
    const zmax = Math.max(...allVals);

    const trace = {
      type: 'heatmap',
      x: data.x,
      y: data.y,
      z: data.z,
      zmin,
      zmax,
      colorscale: [
        [0, 'rgb(0,0,255)'],
        [0.5, 'rgb(255,255,255)'],
        [1, 'rgb(255,0,0)']
      ],
      hovertemplate: 'Residue %{y}, Mutant %{x}: %{z:.2f}<extra></extra>',
      showscale: true,
      xgap: 1,
      ygap: 1,
    };

    const layout = {
      title: 'Mutational Energy Heatmap (kcal/mol)',
      autosize: true,
      height: 300,
      margin: { t: 60, l: 80, r: 60, b: 80 },
      xaxis: { title: 'Mutant' },
      yaxis: { title: 'Residue' },
      plot_bgcolor: '#f5f5f5',
      paper_bgcolor: '#f5f5f5',
    };

    Plotly.newPlot('heatmapDiv', [trace], layout, { responsive: true });
  }

  updateRepresentation(autoView = true) {
    if (!this.stage) return;

    this.loader.setLoading(true);
    const comps = this.stage.compList;
    if (!comps.length) {
      this.loader.setLoading(false);
      return;
    }

    setTimeout(() => {
      comps.forEach((c: any) => {
        c.removeAllRepresentations();
        c.addRepresentation(this.viewerSettings.representation, {
          colorScheme: this.viewerSettings.color,
          opacity: this.viewerSettings.representation === 'surface' ? 0.6 : 1.0
        });
      });

      if (autoView) {
        this.stage.autoView();
        this.animateCameraZoom(0.8, 800); // smooth re-zoom animation
      }
      this.stage.viewer.requestRender();
      this.stage.viewer.signals.rendered.addOnce(() => {
        this.loader.setLoading(false);
        console.log("Representation render complete");
      });
    }, 50);
  }

  focusChain() {
    if (!this.stage || !this.viewerSettings.focusChain.trim()) return;

    const chainInput = this.viewerSettings.focusChain.trim().toUpperCase();
    const comps = this.stage.compList;
    if (!comps.length) return;

    let found = false;

    for (const comp of comps) {
      const structure = comp.structure;

      structure.eachChain((chainProxy: any) => {
        const chainName = chainProxy.chainname?.toUpperCase();

        if (chainInput === chainName) {
          // Select entire chain
          const selection = new NGL.Selection(`:${chainName}`);

          // Auto focus the camera
          comp.autoView(selection);
          this.animateCameraZoom(0.7, 800);
          this.stage.viewer.requestRender();

          // Add a glowing highlight representation
          const highlight = comp.addRepresentation(this.viewerSettings.representation, {
            sele: `:${chainName}`,
            color: 'yellow',
            opacity: 1.0,
            scale: 1.3,
          });

          setTimeout(() => {
            let opacity = 1.0;
            const fadeInterval = setInterval(() => {
              opacity -= 0.15;
              if (opacity <= 0) {
                clearInterval(fadeInterval);
                comp.removeRepresentation(highlight);
              } else {
                highlight.setParameters({ opacity });
              }
              this.stage.viewer.requestRender();
            }, 100);
          }, 3000);

          this.toastr.success(`Focused on chain ${chainName}`);
          found = true;
        }
      });
    }

    if (!found) {
      this.toastr.warning(`No matching chain found for "${chainInput}"`);
    }
  }

  /** Smooth camera zoom animation */
  private animateCameraZoom(factor = 0.8, duration = 1000) {
    if (!this.stage) return;
    const cam = this.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // ease-in-out
      cam.position.z = startZ - (startZ - targetZ) * eased;
      this.stage.viewer.requestRender();
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  takeScreenshot() {
    if (!this.stage) return;
    this.stage.viewer.requestRender();
    this.stage.setParameters({ backgroundColor: "white" });
    this.stage.makeImage({
      factor: 1,
      antialias: true,
      trim: true,
      transparent: false,
    }).then((blob: Blob) => NGL.download(blob, 'snapshot.png'));
  }

  /** View file content */
  viewFile(filename: string) {
    const jobId = localStorage.getItem('proteinJobId')!;
    this.proteinService.getFileContent(jobId, filename).subscribe({
      next: (res) => {
        this.selectedFileContent = res || '(binary file)';
      },
      error: (err) => console.error(err)
    });
  }

  /** Download the file directly */
  downloadFile(filename: string) {
    const jobId = localStorage.getItem('proteinJobId')!;
    const link = document.createElement('a');
    link.href = `${this.proteinService.baseUrl}/get-file/${jobId}/${filename}`;
    link.download = filename;
    link.click();
  }

  // DEMOOOOOO ISPOD

  async loadExistingJob() {
    this.loader.setLoading(true);
    let id = localStorage.getItem('proteinJobId')!
    try {
      const res = await firstValueFrom(this.proteinService.getResultList(id));

      if (res.status === 'completed') {
        this.toastr.success('Loaded existing results!');
        this.resultFiles = res.files;

        const pdbFiles = res.files.filter((f: string) => f.endsWith('.pdb'));
        const datFiles = res.files.filter((f: string) => f.endsWith('.dat'));

        await this.loadAllPdbsFromBackend(id, pdbFiles);
        if (datFiles.length) await this.loadDatFilesAndPlot(id, datFiles);

      } else {
        this.toastr.info('Job still processing...');
      }
    } catch (err) {
      console.error(err);
      this.toastr.error('Failed to load existing job');
    } finally {
      this.loader.setLoading(false);
    }
  }

  toggleFullscreen() {
    if (this.stage) this.stage.toggleFullscreen();
  }
}