import * as NGL from 'ngl';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { ProteinViewerService } from './protein-viewer.service';
import { ToastrService } from 'ngx-toastr';
import { firstValueFrom } from 'rxjs';
import Plotly from 'plotly.js-dist-min';
import { SpinnerComponentService } from '../spinner-component/spinner.component.service';

@Component({
  selector: 'app-protein-viewer-component',
  templateUrl: './protein-viewer.component.html',
  styleUrl: './protein-viewer.component.css'
})
export class ProteinViewerComponent {

  stage: any = null;
  showViewer = false;
  resultFiles: string[] = [];
  pdbFile: File | null = null;
  datMutations: string[] = [];
  selectedMutation: string = '';
  availableChains: string[] = [];
  selectedMutationContent: string = '';
  currentlyShownPdb: string | null = null;
  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private toastr: ToastrService,
    private loader: SpinnerComponentService,
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

  async refreshViewer() {
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) {
      this.toastr.warning('No job found to reload.');
      return;
    }

    // Only reload if we had results before
    const pdbFiles = this.resultFiles.filter(f => f.endsWith('.pdb'));
    if (!pdbFiles.length) {
      this.toastr.warning('No PDB files found to reload.');
      return;
    }

    this.loader.setLoading(true);
    this.stage.removeAllComponents();

    await this.loadAllPdbsFromBackend(jobId, pdbFiles);
    this.currentlyShownPdb = null;

    this.toastr.success('Viewer refreshed, loaded all PDBs again.');
  }

  /** Check periodically until results appear **/
  private async waitForResults(jobId: string, interval = 15000): Promise<void> {

    let timeoutHandle: any; // store the timeout reference

    const check = async () => {
      try {

        await this.fetchJobLog(jobId);

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
          this.loader.jobLog = '';
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
                comp.addRepresentation(this.viewerSettings.representation, {
                  colorScheme: this.viewerSettings.color,
                  opacity: this.viewerSettings.representation === 'surface' ? 0.6 : 1.0,
                });

                if (i === 0) this.stage.autoView();
                remaining--;
                if (remaining === 0) {
                  // All PDBs loaded, now do final centering, zoom, and scroll
                  this.stage.autoView();

                  setTimeout(() => {
                    this.stage.autoView();
                    this.animateCameraZoom(0.8, 1000);
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
        const id = match[1];
        const energy = parseFloat(match[2]);
        const residueMatch = id.match(/(\d+)/);
        const mutantMatch = id.match(/([A-Z])$/);
        const residue = residueMatch ? residueMatch[1] : 'UNK';
        const mutant = mutantMatch ? mutantMatch[1] : '?';
        parsed.push({ residue, mutant, energy });
      }
    }

    return { file: filename.replace('.dat', ''), entries: parsed };
  }


  // cache parsed data per file (key: base filename without .dat)
  private parsedByFile: Record<string, { file: string; entries: { residue: string; mutant: string; energy: number }[] }> = {};


  // when you load all DATs initially, store them:
  async loadDatFilesAndPlot(jobId: string, datFiles: string[]): Promise<void> {
    const allData: any[] = [];

    for (const file of datFiles) {
      const text = await firstValueFrom(this.proteinService.getFileContent(jobId, file));
      const parsed = this.parseFullDat(text, file);
      allData.push(parsed);

      const key = file.replace(/\.dat$/i, '');
      this.parsedByFile[key] = parsed;
    }

    this.datMutations = Object.keys(this.parsedByFile);

    // Build combined heatmap once (big overview)
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
  }

  async onSelectMutation(mutation: string) {
    this.selectedMutation = mutation;
    const cached = this.parsedByFile[mutation];

    if (!cached || !cached.entries.length) {
      this.toastr.error('Failed to load mutation data');
      return;
    }

    // dump raw DAT text if you still want it (optional: keep a raw cache too)
    const jobId = localStorage.getItem('proteinJobId')!;
    const filename = mutation.endsWith('.dat') ? mutation : `${mutation}.dat`;
    try {
      this.selectedMutationContent = await firstValueFrom(this.proteinService.getFileContent(jobId, filename));
    } catch {
      // if fetching raw text fails, still render heatmap from cached parsed data
      this.selectedMutationContent = '';
    }

    const residues = Array.from(new Set(cached.entries.map(e => e.residue)));
    const mutants = Array.from(new Set(cached.entries.map(e => e.mutant)));
    const z: number[][] = residues.map(() => Array(mutants.length).fill(NaN));
    for (const e of cached.entries) {
      const y = residues.indexOf(e.residue);
      const x = mutants.indexOf(e.mutant);
      if (y !== -1 && x !== -1) z[y][x] = e.energy;
    }

    // wait for Angular to render <div id="mutationHeatmapDiv">
    setTimeout(() => this.plotMutationHeatmap({ x: mutants, y: residues, z }), 50);
  }

  // the "All heatmap" button — rebuild combined from cache
  onShowAllHeatmap() {
    const all = Object.values(this.parsedByFile);
    if (!all.length) return;

    const residues = Array.from(new Set(all.flatMap(d => d.entries.map(e => e.residue))));
    const mutants = Array.from(new Set(all.flatMap(d => d.entries.map(e => e.mutant))));
    const z: number[][] = residues.map(() => Array(mutants.length).fill(NaN));

    for (const d of all) {
      for (const e of d.entries) {
        const y = residues.indexOf(e.residue);
        const x = mutants.indexOf(e.mutant);
        if (y !== -1 && x !== -1) z[y][x] = e.energy;
      }
    }

    this.selectedMutation = 'All Mutations';
    this.selectedMutationContent = ''; // hide text for "all"
    this.plotMutationHeatmap({ x: mutants, y: residues, z });
  }

  plotMutationHeatmap(data: { x: string[]; y: string[]; z: number[][] }) {
    const isAll = this.selectedMutation === 'All Mutations';
    this.waitForElement('mutationHeatmapDiv')
      .then((el) => {
        el.style.minHeight = isAll ? '400px' : '180px';
        el.style.display = 'block';

        const dynamicHeight = isAll
          ? Math.max(350, 100 + data.y.length * 25) // grow with rows, minimum 350
          : 180;

        const trace = {
          type: 'heatmap',
          x: data.x,
          y: data.y,
          z: data.z,
          colorscale: [
            [0, 'rgb(43, 47, 129)'],
            [0.5, 'rgb(255,255,255)'],
            [1, 'rgb(190, 14, 54)']
          ],
          hovertemplate: 'Residue %{y}, Mutant %{x}: %{z:.2f}<extra></extra>',
          showscale: true,
          xgap: 1,
          ygap: 1,
        } as any;

        const layout = {
          title: {
            text: isAll
              ? 'Combined Mutational Energy Heatmap'
              : `Heatmap for ${this.selectedMutation}`,
            font: { size: 17, color: '#abb1bf', family: 'Inter, sans-serif', weight: 'bold' },
            xanchor: 'center',
            x: 0.5,
            y: 0.97,
          },
          height: dynamicHeight,
          margin: isAll
            ? { t: 60, b: 20, l: 80, r: 40 }
            : { t: 60, b: 40, l: 60, r: 30 },
          xaxis: {
            title: {
              text: 'Mutant',
              font: { size: 15, color: '#abb1bf', weight: 'bold' },
              standoff: 12,
            },
            tickfont: { size: 12, color: '#abb1bf' },
            automargin: true,
          },
          yaxis: {
            title: {
              text: 'Residue',
              font: { size: 15, color: '#abb1bf', weight: 'bold' },
              standoff: 12,
            },
            tickfont: { size: 12, color: '#abb1bf' },
            automargin: true,
          },
          plot_bgcolor: '#000000ff',
          paper_bgcolor: '#f5f5f5',
        } as any;


        Plotly.newPlot('mutationHeatmapDiv', [trace], layout, { responsive: true })
          .then((div: any) => {
            div.on('plotly_click', (ev: any) => {
              const residue = String(ev.points[0].y).trim();
              const mutant = String(ev.points[0].x).toLowerCase();
              const prefixMap: Record<string, string> = {
                arg: 'r2',
                glu: 'e2',
                asn: 'n2',
                gln: 'q2',
                lys: 'k2',
                ser: 's2',
                thr: 't2',
              };

              // Try to derive prefix from selected mutation type, fallback to any match
              let prefix =
                Object.entries(prefixMap).find(([k]) =>
                  this.selectedMutation.toLowerCase().includes(k)
                )?.[1] || '';

              // For "Show All", allow fallback to any matching prefix
              if (isAll) prefix = ''; // let the filter find any match

              // Build expected pattern
              const expectedPattern = new RegExp(
                `joined_proc_${residue}_(?:[a-z]\\d)?${mutant}\\.pdb`,
                'i'
              );

              // Find matching PDB
              const target = this.resultFiles.find(f => expectedPattern.test(f));

              if (!target) {
                this.toastr.warning(
                  `No matching PDB found for residue ${residue} and mutant ${mutant.toUpperCase()}`
                );
                console.warn('Expected regex:', expectedPattern);
                console.warn('Available PDBs:', this.resultFiles);
                return;
              }

              // Load only that PDB
              const jobId = localStorage.getItem('proteinJobId')!;
              this.loader.setLoading(true);

              this.proteinService.getFileContent(jobId, target).subscribe({
                next: res => {
                  const blob = new Blob([res], { type: 'text/plain' });
                  this.stage.removeAllComponents();
                  this.stage.loadFile(blob, { ext: 'pdb' }).then((comp: any) => {
                    comp.addRepresentation(this.viewerSettings.representation, {
                      colorScheme: this.viewerSettings.color,
                      opacity:
                        this.viewerSettings.representation === 'surface' ? 0.6 : 1.0,
                    });
                    this.stage.autoView();
                    this.animateCameraZoom(0.8, 1000);
                    this.loader.setLoading(false);
                    this.toastr.info(`Showing ${target}`);
                  });
                },
                error: () => {
                  this.loader.setLoading(false);
                  this.toastr.error(`Could not load PDB for ${target}`);
                },
              });

              this.scrollToViewer();
            });
          });
      })
      .catch(err => console.warn(err.message));
  }

  zoomIn() {
    this.adjustZoom(0.85);  // Zoom in by reducing camera distance
  }

  zoomOut() {
    this.adjustZoom(1.15);  // Zoom out by increasing camera distance
  }

  /**
   * Helper function to smoothly animate zooming.
   * @param factor - <1 zooms in, >1 zooms out
   * @param duration - milliseconds
   */
  private adjustZoom(factor: number, duration = 400) {
    if (!this.stage) return;

    const cam = this.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // smooth ease-in-out
      cam.position.z = startZ - (startZ - targetZ) * eased;
      this.stage.viewer.requestRender();
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Wait until an element with the given ID exists in the DOM */
  private async waitForElement(id: string, timeout = 2000): Promise<HTMLElement> {
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return reject(new Error(`Timeout waiting for element: ${id}`));
        requestAnimationFrame(check);
      };
      check();
    });
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
        this.animateCameraZoom(0.8, 1000); // smooth re-zoom animation
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
          found = true;
        }
      });
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


  async makePhoto() {
    return await this.stage.makeImage({
      factor: 2,
      antialias: true,
      trim: false,
      transparent: false
    });
  }

  async takeScreenshot() {
    try {
      const viewerBlob = await this.makePhoto();
      NGL.download(viewerBlob, "snapshot.png");
    } catch (err) {
      console.error("Screenshot error:", err);
      this.toastr.error("Could not create screenshot.");
    }
  }

  async loadExistingJob(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];

    if (!file || !file.name.endsWith('.zip')) {
      this.toastr.warning('Please select a valid results ZIP (.zip)');
      return;
    }

    this.loader.setLoading(true);

    try {
      const zip = await JSZip.loadAsync(file);
      const allFiles = Object.keys(zip.files);

      this.resultFiles = allFiles;
      this.toastr.success('Preview loaded from ZIP');

      const pdbFiles = allFiles.filter(f => f.endsWith('.pdb'));
      const datFiles = allFiles.filter(f => f.endsWith('.dat'));

      // 1. Load all PDBs into viewer
      this.showViewer = true;
      await new Promise(r => setTimeout(r)); // ensure DOM is ready

      if (!this.stage) {
        this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
        window.addEventListener("resize", () => this.stage.handleResize(), false);
      } else {
        this.stage.removeAllComponents();
      }

      // Load PDBs
      for (const pdb of pdbFiles) {
        const content = await zip.file(pdb)!.async('string');
        const blob = new Blob([content], { type: 'text/plain' });

        const comp = await this.stage.loadFile(blob, { ext: 'pdb' });
        comp.addRepresentation('cartoon', { colorScheme: 'chainname' });
      }

      this.stage.autoView();
      this.animateCameraZoom();
      this.availableChains = this.getAvailableChains();
      this.scrollToViewer();

      // 2. Parse DATs and build heatmaps
      if (datFiles.length) {
        for (const dat of datFiles) {
          const content = await zip.file(dat)!.async('string');
          const parsed = this.parseFullDat(content, dat);
          const key = dat.replace(/\.dat$/i, '');
          this.parsedByFile[key] = parsed;
        }

        this.datMutations = Object.keys(this.parsedByFile);
        this.onShowAllHeatmap();
      }
    } catch (err) {
      console.error('ZIP load error:', err);
      this.toastr.error('Failed to load ZIP preview');
    } finally {
      this.loader.setLoading(false);
    }
  }

  private async fetchJobLog(jobId: string) {
    try {
      const res: any = await firstValueFrom(this.proteinService.getJobLog(jobId));
      if (res && res.log) {
        let log = res.log.trim();
        const lines = log.split('\n');
        if (lines.length > 15) {
          log = lines.slice(-15).join('\n'); // keeps only the last 15 lines
          log = '... (truncated)\n' + log;   // optional: indicate truncation
        }
        this.loader.jobLog = log;
      }
    } catch (err) {
      console.warn('Log fetch failed:', err);
    }
  }


  toggleFullscreen() {
    if (this.stage) this.stage.toggleFullscreen();
  }

  async exportResults() {
    if (!this.resultFiles.length) {
      this.toastr.warning('No results to export yet.');
      return;
    }

    const jobId = localStorage.getItem('proteinJobId');
    const zip = new JSZip();

    // Include all PDB and DAT files
    for (const file of this.resultFiles.filter(f => f.endsWith('.pdb') || f.endsWith('.dat'))) {
      const res = await firstValueFrom(this.proteinService.getFileContent(jobId!, file));
      zip.file(file, res);
    }

    // Add viewer image snapshot
    try {
      const viewerBlob = await this.makePhoto();
      zip.file('viewer_snapshot.png', viewerBlob);
    } catch (err) {
      this.toastr.warning("Viewer image could not be captured.");
    }

    // Generate and add heatmap image
    try {
      // Force "Show All" heatmap if not already selected
      if (this.selectedMutation !== 'All Mutations') {
        this.onShowAllHeatmap();
        await new Promise(resolve => setTimeout(resolve, 500)); // wait for heatmap to render
      }

      const heatmapDiv = document.getElementById('mutationHeatmapDiv');
      if (!heatmapDiv) throw new Error('Heatmap not found');

      const heatmapImg = await Plotly.toImage(heatmapDiv, {
        format: 'png',
        height: heatmapDiv.offsetHeight,
        width: heatmapDiv.offsetWidth,
        scale: 2
      });

      const res = await fetch(heatmapImg);
      const blob = await res.blob();
      zip.file('combined_heatmap.png', blob);

    } catch (err) {
      console.warn('Heatmap image export failed:', err);
      this.toastr.warning("Could not export heatmap image.");
    }

    // Final ZIP export
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `results_${jobId}.zip`);
    this.toastr.success('Results exported successfully!');
  }
}