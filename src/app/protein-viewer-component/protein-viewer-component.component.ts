import * as NGL from 'ngl';
import { Component, ElementRef, ViewChild} from '@angular/core';
import { ProteinViewerComponentService } from './protin-viewer-component.service';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-protein-viewer-component',
  templateUrl: './protein-viewer-component.component.html',
  styleUrl: './protein-viewer-component.component.css'
})
export class ProteinViewerComponentComponent {

  isLoading = false;
  pdbFile: File | null = null;
  resultFiles: string[] = [];
  selectedFileContent = '';
  showViewer = false;
  stage: any = null;
  comp: any = null;
  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private toastr: ToastrService,
    private proteinService: ProteinViewerComponentService,
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

  onGoClick() {
    const hasManualInput =
    this.form.protein_chains &&
    this.form.partner_chains &&
    (this.form.mutations || this.form.detect_interface);
  
    if (!this.pdbFile && !hasManualInput) {
      this.toastr.info("Please either upload a PDB file OR fill in all fields before running.");
      return;
    }
    
    this.isLoading = true;
    this.proteinService.postData(this.form, this.pdbFile).subscribe({
        next: (res) => {
          this.isLoading = false;
          console.log('Backend response:', res);
          if (res.job_id) localStorage.setItem('proteinJobId', res.job_id);
          if (this.pdbFile) {
            const reader = new FileReader();
            reader.onload = () => this.loadInNGL(reader.result as string);
            reader.readAsText(this.pdbFile);
          }
          this.pdbFile = null;
        }, error: (err) => {
          this.isLoading = false;
          console.error('Error:', err);
        }
      });
  }

  isGoEnabled(): boolean {
    if (this.pdbFile) return true;
    const { protein_chains, partner_chains, mutations } = this.form;
    return !!(protein_chains && partner_chains && mutations);
  }

  loadInNGL(pdbData: string) {
    this.showViewer = true;
  
    setTimeout(async () => {
      try {
        if (!this.stage) {
          this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
          window.addEventListener("resize", () => this.stage.handleResize(), false);
        } else {
          this.stage.removeAllComponents();
        }
  
        const comp: any = await this.stage.loadFile(
          new Blob([pdbData], { type: 'text/plain' }),
          { ext: "pdb" }
        );
  
        this.comp = comp;
        this.updateRepresentation();
        this.stage.autoView();
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
  
  updateRepresentation() {
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
  
    this.stage.autoView();
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

   /** Upload file + run script */
   saveData() {
    this.proteinService.postData(this.form, this.pdbFile).subscribe({
      next: (res) => console.log('Backend response:', res),
      error: (err) => console.error('Error:', err)
    });
  }

  /** Check job result and get file list */
  loadResults() {
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) {
      this.proteinService['toastr'].warning('No job ID found.');
      return;
    }

    this.proteinService.getResultList(jobId).subscribe({
      next: (res) => {
        if (res.status === 'completed') {
          this.resultFiles = res.files;
          console.log('Result files:', this.resultFiles);
        } else {
          this.proteinService['toastr'].info('Job still processing...');
        }
      },
      error: (err) => console.error('Error:', err)
    });
  }

  /** Fetch a specific result file’s content */
  viewFile(filename: string) {
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) return;

    this.proteinService.getFileContent(jobId, filename).subscribe({
      next: (res) => {
        this.selectedFileContent = res.content || '(binary file)';
        console.log('File content:', res);
      },
      error: (err) => console.error('Error:', err)
    });
  }

  /** Download the file directly */
  downloadFile(filename: string) {
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) return;
    const link = document.createElement('a');
    link.href = `${this.proteinService.baseUrl}/get-file/${jobId}/${filename}`;
    link.download = filename;
    link.click();
  }
}