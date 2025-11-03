import * as NGL from 'ngl';
import { Component, ElementRef, ViewChild} from '@angular/core';
import { ProteinViewerService } from './protin-viewer..service';
import { ToastrService } from 'ngx-toastr';
import { LoaderService } from '../services/loader.service';
import Plotly from 'plotly.js-dist-min';

@Component({
  selector: 'app-protein-viewer-component',
  templateUrl: './protein-viewer.component.html',
  styleUrl: './protein-viewer.component.css'
})
export class ProteinViewerComponent{

  pdbFile: File | null = null;
  resultFiles: string[] = [];
  selectedFileContent = '';
  showViewer = false;
  stage: any = null;
  comp: any = null;

  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private loader: LoaderService,
    private toastr: ToastrService,
    private proteinService: ProteinViewerService,
  ) {}

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

  onCheckBox(){
    this.form.detect_interface = !this.form.detect_interface;
    this.form.mutations = '';
  }

  isGoEnabled(): boolean {
    return !!this.pdbFile;
  }

  onGoClick() {
    if (!this.pdbFile) {
      this.toastr.warning('Please upload a PDB file first.');
      return;
    }

    this.loader.setLoading(true);

    this.proteinService.postData(this.form, this.pdbFile).subscribe({
      next: (res) => {
        this.pdbFile = null;
        this.toastr.info(res.message || 'Job started.');
        if (res.job_id) {
          localStorage.setItem('proteinJobId', res.job_id);
          this.waitForResults(res.job_id); // Start polling every 10 seconds to check result
        }
      },error: (err) => {
        this.loader.setLoading(false);
        console.error('Error:', err);
      }
    });
  }

  /** Check periodically until results appear (max 10 min) **/
  private async waitForResults(jobId: string, maxWait = 10 * 60 * 1000, interval = 15000): Promise<void> {
    const start = Date.now();
    let timeoutHandle: any; // store the timeout reference
  
    const check = async () => {
      try {
        const res = await this.proteinService.getResultList(jobId).toPromise();
  
        if (res.status === 'completed') {
          // 🧹 Cancel any scheduled future timeouts
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
  
        // ⏱️ Schedule next check
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
  

  loadAllPdbsFromBackend(jobId: string, pdbFiles: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stage) {
        this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
        window.addEventListener("resize", () => this.stage.handleResize(), false);
      } else {
        this.stage.removeAllComponents();
      }
  
      this.showViewer = true;
      let remaining = pdbFiles.length;
  
      pdbFiles.forEach((filename, i) => {
        this.proteinService.getFileContent(jobId, filename).subscribe({
          next: (res) => {
            if (res.content) {
              const blob = new Blob([res.content], { type: 'text/plain' });
              this.stage.loadFile(blob, { ext: 'pdb' }).then((comp: any) => {
                comp.addRepresentation('cartoon', { colorScheme: 'chainname' });
                if (i === 0) this.stage.autoView();
  
                remaining--;
                if (remaining === 0) resolve();
              });
            } else {
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
  
  loadDatFilesAndPlot(jobId: string, datFiles: string[]): Promise<void> {
    return new Promise((resolve) => {
      const heatData: { x: string[], y: string[], z: number[][] } = { x: [], y: [], z: [] };
      let pending = datFiles.length;
  
      datFiles.forEach((file) => {
        this.proteinService.getFileContent(jobId, file).subscribe({
          next: (res) => {
            const parsed = this.parseDat(res.content);
            if (parsed) {
              heatData.x.push(parsed.label);
              heatData.y.push('Energy');
              heatData.z.push([parsed.value]);
            }
            pending--;
            if (pending === 0) {
              this.plotHeatmap(heatData);
              resolve(); // finish only after the heatmap is plotted
            }
          },
          error: (err) => {
            console.error('Error loading .dat:', err);
            pending--;
            if (pending === 0) {
              this.plotHeatmap(heatData);
              resolve();
            }
          }
        });
      });
    });
  }  
  
  parseDat(content: string): { label: string, value: number } | null {
    // IIME .dat files usually have lines like: inter_ener_glu60c.dat → "Interaction Energy = -123.45"
    const lines = content.split('\n').filter(l => l.trim());
    const valueLine = lines.find(l => /[0-9\.\-]+/.test(l));
    if (!valueLine) return null;
    const value = parseFloat(valueLine.match(/[0-9\.\-]+/)?.[0] || '0');
    return { label: lines[0].trim().slice(0, 15), value };
  }
  
  plotHeatmap(data: { x: string[], y: string[], z: number[][] }) {
    const layout = {
      title: 'Interaction Energies (kcal/mol)',
      height: 450,
      width: 800,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 60, l: 60, r: 40, b: 80 },
      xaxis: { title: 'File', tickangle: -45 },
      yaxis: { title: 'Energy', automargin: true },
    };
  
    const trace = {
      z: data.z,
      x: data.x,
      y: data.y,
      type: 'heatmap',
      colorscale: [
        [0, 'rgb(0,0,255)'],   // Blue (low)
        [0.5, 'rgb(255,255,255)'], // White (neutral)
        [1, 'rgb(255,0,0)']    // Red (high)
      ],
      showscale: true,
      hoverongaps: false,
      xgap: 2,  // space between boxes
      ygap: 2,
      zsmooth: false,
      colorbar: {
        title: 'Energy',
        titleside: 'right',
        tickfont: { color: '#333' },
        titlefont: { size: 12, color: '#333' },
      },
    };
  
    // Render in the centered container
    Plotly.newPlot('heatmapDiv', [trace], layout, { responsive: true });
  }  
  
  loadInNGL(pdbData: string) {
    this.showViewer = true;
  
    setTimeout(async () => {
      try {
        if (!this.stage) {
          this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });

          // Add NGL built-in control GUI and fullscreen mode
          this.stage.makeFullScreen(true); // enables fullscreen on double click or API
          this.stage.toggleGui();          // shows the right-hand control palette
          // Adds a 3D orientation gizmo (like a compass)
          this.stage.viewer.addOrientationGizmo();
          // Optional: show bounding box and axes
          this.stage.setParameters({ cameraHelper: true });

          window.addEventListener("resize", () => this.stage.handleResize(), false);
        } else {
          this.stage.removeAllComponents();
        }
  
        const comp: any = await this.stage.loadFile(
          new Blob([pdbData], { type: 'text/plain' }),
          { ext: "pdb" }
        );
  
        this.comp = comp;
        this.updateRepresentation(true); // This will do the initial centering only
        this.viewerSection.nativeElement.scrollIntoView({ behavior: 'smooth' });

        // wait for NGL to finish fitting the view (i added some nice animation)
        setTimeout(() => {
          const cam = this.stage.viewer.camera;
          const startZ = cam.position.z;
          const targetZ = startZ * 0.7; // smaller = closer
          const duration = 1000;        // ms, total animation time
          const startTime = performance.now();
          const animateZoom = (time: number) => {
            const progress = Math.min((time - startTime) / duration, 1);
            const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
            cam.position.z = startZ - (startZ - targetZ) * eased;
            this.stage.viewer.requestRender();
            if (progress < 1) requestAnimationFrame(animateZoom);
          };
        
          requestAnimationFrame(animateZoom);
        }, 500);
        
      } catch (err) {
        console.error("NGL failed to load:", err);
      }
    }, 100);
  }
  
  updateRepresentation(autoView = false) {
    if (!this.comp || !this.stage) return;
  
    try {
      this.comp.removeAllRepresentations();
      this.comp.addRepresentation(this.viewerSettings.representation, {
        colorScheme: this.viewerSettings.color,
        opacity: this.viewerSettings.representation === 'surface' ? 0.6 : 1.0,
        useWorker: false
      });
    } catch (err) {
      console.warn("Representation change failed, reverting to cartoon:", err);
      this.comp.addRepresentation("cartoon", { colorScheme: this.viewerSettings.color });
    }
  
    if (autoView) this.stage.autoView(); 
  }

  focusChain() {
    if (!this.comp || !this.viewerSettings.focusChain) return;
    const chain = this.viewerSettings.focusChain.trim();
    this.stage.autoView(chain);
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

  /** Fetch extracted results **/
  loadResults(jobId: string) {
    this.proteinService.getResultList(jobId).subscribe({
      next: (res) => {
        if (res.status === 'completed') {
          this.resultFiles = res.files;
          this.toastr.success('Results ready!');
        } else {
          this.toastr.info('Job still processing...');
        }
      },
      error: (err) => console.error(err)
    });
  }

  /** View file content */
  viewFile(filename: string) {
    const jobId = localStorage.getItem('proteinJobId')!;
    this.proteinService.getFileContent(jobId, filename).subscribe({
      next: (res) => {
        this.selectedFileContent = res.content || '(binary file)';
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
}