import { Component, ElementRef, ViewChild} from '@angular/core';
import * as NGL from 'ngl';

@Component({
  selector: 'app-protein-viewer-component',
  templateUrl: './protein-viewer-component.component.html',
  styleUrl: './protein-viewer-component.component.css'
})
export class ProteinViewerComponentComponent {

  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  form = {
    protein_chains: '',
    partner_chains: '',
    mutations: '',
    detect_interface: false
  };

  pdbFile: File | null = null;
  showViewer = false;
  stage: any = null;
  comp: any = null;

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

  onGoClick() {
    if (!this.pdbFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      const pdbContent = reader.result as string;
      this.loadInNGL(pdbContent);
    };
    reader.readAsText(this.pdbFile);
    this.pdbFile = null;
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

        // wait for NGL to finish fitting the view
        setTimeout(() => {
          const cam = this.stage.viewer.camera;
          const startZ = cam.position.z;
          const targetZ = startZ * 0.7; // smaller = closer
          const duration = 1000;        // ms, total animation time
          const startTime = performance.now();
        
          const animateZoom = (time: number) => {
            const progress = Math.min((time - startTime) / duration, 1);
            // ease-in-out curve
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
    const oldParams = { backgroundColor: this.stage.parameters.backgroundColor };
    this.stage.viewer.requestRender();
    this.stage.setParameters({ backgroundColor: "white" });
    this.stage.makeImage({
      factor: 2,
      antialias: true,
      trim: false,
      transparent: false,
    }).then((blob: Blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "protein_view.png";
      link.click();
      URL.revokeObjectURL(link.href);
      this.stage.setParameters(oldParams);
      this.stage.viewer.requestRender();
    });
  }  
}