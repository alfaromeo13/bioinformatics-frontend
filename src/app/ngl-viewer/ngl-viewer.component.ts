import * as NGL from 'ngl';
import { ToastrService } from 'ngx-toastr';
import { GlobalService } from '../global-service/global.service';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { SpinnerComponentService } from '../spinner-component/spinner.component.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-ngl-viewer',
  templateUrl: './ngl-viewer.component.html',
  styleUrl: './ngl-viewer.component.css'
})
export class NglViewerComponent implements AfterViewInit, OnDestroy {

  private destroy$ = new Subject<void>();

  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private loader: SpinnerComponentService,
  ) { }

  ngAfterViewInit() {
    this.globalService.scrollRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.scrollToViewer();
      });

    this.globalService.animateZoom$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.animateCameraZoom();
      });
  }

  ngOnDestroy() {
    // Emit and complete destroy notifier
    this.destroy$.next();
    this.destroy$.complete();
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
    if (!this.globalService.stage) return;

    const cam = this.globalService.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // smooth ease-in-out
      cam.position.z = startZ - (startZ - targetZ) * eased;
      this.globalService.stage.viewer.requestRender();
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
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

  async makePhoto() {
    return await this.globalService.stage.makeImage({
      factor: 2,
      antialias: true,
      trim: false,
      transparent: false
    });
  }

  toggleFullscreen() {
    if (this.globalService.stage) this.globalService.stage.toggleFullscreen();
  }

  updateRepresentation(autoView = true) {
    if (!this.globalService.stage) return;

    this.loader.setLoading(true);
    const comps = this.globalService.stage.compList;
    if (!comps.length) {
      this.loader.setLoading(false);
      return;
    }

    setTimeout(() => {
      comps.forEach((c: any) => {
        c.removeAllRepresentations();
        c.addRepresentation(this.globalService.viewerSettings.representation, {
          colorScheme: this.globalService.viewerSettings.color,
          opacity: this.globalService.viewerSettings.representation === 'surface' ? 0.6 : 1.0
        });
      });

      if (autoView) {
        this.globalService.stage.autoView();
        this.animateCameraZoom(0.8, 1000); // smooth re-zoom animation
      }
      this.globalService.stage.viewer.requestRender();
      this.globalService.stage.viewer.signals.rendered.addOnce(() => {
        this.loader.setLoading(false);
        console.log("Representation render complete");
      });
    }, 50);
  }

  async refreshViewer() {

    // ZIP MODE → reload from ZIP only
    if (this.globalService.zipMode) {

      const pdbFiles = this.globalService.resultFiles.filter(f => f.endsWith('.pdb'));
      if (!pdbFiles.length) {
        this.toastr.warning('No PDB files found in ZIP.');
        return;
      }

      this.loader.setLoading(true);
      this.globalService.stage.removeAllComponents();

      // Load from ZIP using service.getFile()
      for (const file of pdbFiles) {
        try {
          const text = await this.globalService.getFile(null, file); // ZIP mode ignores jobId
          const blob = new Blob([text], { type: 'text/plain' });

          const comp = await this.globalService.stage.loadFile(blob, { ext: 'pdb' });

          this.globalService.normalizeChainNames(comp.structure);
          comp.addRepresentation(
            this.globalService.viewerSettings.representation,
            { colorScheme: this.globalService.viewerSettings.color }
          );
        } catch (err) {
          console.error(err);
          this.toastr.error(`Failed to load ${file} from ZIP`);
        }
      }

      this.globalService.stage.autoView();
      this.globalService.animateZoom$.next();
      this.loader.setLoading(false);

      this.toastr.success('Viewer refreshed from ZIP.');
      return;
    }

    // BACKEND MODE → original logic
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) {
      this.toastr.warning('No job found to reload.');
      return;
    }

    const pdbFiles = this.globalService.resultFiles.filter(f => f.endsWith('.pdb'));
    if (!pdbFiles.length) {
      this.toastr.warning('No PDB files found to reload.');
      return;
    }

    this.loader.setLoading(true);
    this.globalService.stage.removeAllComponents();

    await this.globalService.loadAllPdbsFromBackend(jobId, pdbFiles);
    this.globalService.currentlyShownPdb = null;

    this.toastr.success('Viewer refreshed from backend.');
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

  focusChain() {
    if (!this.globalService.stage || !this.globalService.viewerSettings.focusChain.trim()) return;

    const chainInput = this.globalService.viewerSettings.focusChain.trim().toUpperCase();
    const comps = this.globalService.stage.compList;
    if (!comps.length) return;

    let found = false;

    for (const comp of comps) {
      const structure = comp.structure;

      structure.eachChain((chainProxy: any) => {
        const chainName = chainProxy.chainname?.toUpperCase();

        if (chainInput === chainName) {
          // Select entire chain
          const selection = new NGL.Selection(`:${chainName}`);
          this.globalService.stage.viewer.requestRender();

          // Add a glowing highlight representation
          const highlight = comp.addRepresentation(this.globalService.viewerSettings.representation, {
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
              this.globalService.stage.viewer.requestRender();
            }, 100);
          }, 3000);
          found = true;
        }
      });
    }
  }

  animateCameraZoom(factor = 0.8, duration = 1000) {
    if (!this.globalService.stage) return;
    const cam = this.globalService.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // ease-in-out
      cam.position.z = startZ - (startZ - targetZ) * eased;
      this.globalService.stage.viewer.requestRender();
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
}