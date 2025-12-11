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

  /** Used to clean up RxJS subscriptions on destroy */
  private destroy$ = new Subject<void>();

  /** Section wrapper used for auto-scrolling into view */
  @ViewChild('viewerSection') viewerSection!: ElementRef<HTMLDivElement>;

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private loader: SpinnerComponentService,
  ) { }

  /**
   * Subscribes to:
   *  - scrollRequest$: request to automatically scroll viewer into view.
   *  - animateZoom$: external request to animate the camera zoom.
   *
   * These events are triggered by sibling components via GlobalService.
   */
  ngAfterViewInit() {
    this.globalService.scrollRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.scrollToViewer());

    this.globalService.animateZoom$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.animateCameraZoom());
  }

  /** Cleans all subscriptions to avoid memory leaks */
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Zooms in using a smooth animated camera movement */
  zoomIn() {
    this.adjustZoom(0.85);
  }

  /** Zooms out using a smooth animated camera movement */
  zoomOut() {
    this.adjustZoom(1.15);
  }

  /**
   * Smoothly animates camera zoom based on a scaling factor.
   * factor < 1 = zoom in
   * factor > 1 = zoom out
   */
  private adjustZoom(factor: number, duration = 400) {
    if (!this.globalService.stage) return;

    const cam = this.globalService.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      // cosine easing for smooth zoom
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2;

      cam.position.z = startZ - (startZ - targetZ) * eased;
      this.globalService.stage.viewer.requestRender();

      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  /**
   * Generates a screenshot of the current viewer canvas and downloads it.
   */
  async takeScreenshot() {
    try {
      const viewerBlob = await this.makePhoto();
      NGL.download(viewerBlob, "snapshot.png");
    } catch (err) {
      console.error("Screenshot error:", err);
      this.toastr.error("Could not create screenshot.");
    }
  }

  /**
   * Uses NGL Stage to produce a high-resolution PNG image.
   */
  async makePhoto() {
    return await this.globalService.stage.makeImage({
      factor: 2,
      antialias: true,
      trim: false,
      transparent: false
    });
  }

  /** Toggles NGL viewer into fullscreen mode */
  toggleFullscreen() {
    if (this.globalService.stage) this.globalService.stage.toggleFullscreen();
  }

  /**
   * Rebuilds all molecular representations using the current viewer settings.
   * Optionally re-centers the camera (autoView).
   */
  updateRepresentation(autoView = true) {
    if (!this.globalService.stage) return;

    this.loader.setLoading(true);
    const comps = this.globalService.stage.compList;

    if (!comps.length) {
      this.loader.setLoading(false);
      return;
    }

    // Small delay ensures NGL updates safely
    setTimeout(() => {
      comps.forEach((c: any) => {
        c.removeAllRepresentations();
        c.addRepresentation(this.globalService.viewerSettings.representation, {
          colorScheme: this.globalService.viewerSettings.color,
          opacity:
            this.globalService.viewerSettings.representation === 'surface'
              ? 0.6
              : 1.0
        });
      });

      if (autoView) {
        this.globalService.stage.autoView();
        this.animateCameraZoom(0.8, 1000); // subtle cinematic zoom-in
      }

      this.globalService.stage.viewer.requestRender();

      // Hide spinner when representation finished drawing
      this.globalService.stage.viewer.signals.rendered.addOnce(() => {
        this.loader.setLoading(false);
      });

    }, 50);
  }

  /**
   * Reloads all PDBs into the viewer.
   * - In ZIP mode: loads PDBs from the local ZIP file.
   * - In backend mode: re-fetches PDBs using the backend API.
   */
  async refreshViewer() {

    // -----------------------------
    // ZIP MODE — load from ZIP only
    // -----------------------------
    if (this.globalService.zipMode) {
      const pdbFiles = this.globalService.resultFiles.filter(f => f.endsWith('.pdb'));
      if (!pdbFiles.length) {
        this.toastr.warning('No PDB files found in ZIP.');
        return;
      }

      this.loader.setLoading(true);
      this.globalService.stage.removeAllComponents();

      for (const file of pdbFiles) {
        try {
          const text = await this.globalService.getFile(null, file); // null jobId ignored in ZIP mode
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

    // -----------------------------
    // BACKEND MODE — re-fetch files
    // -----------------------------
    const jobId = localStorage.getItem('proteinJobId');
    if (!jobId) {
      this.toastr.warning('No job found to reload.');
      return;
    }

    const pdbFiles = this.globalService.resultFiles.filter(f => f.endsWith('.pdb'));
    if (!pdbFiles.length) {
      this.toastr.warning('No PDB files available.');
      return;
    }

    this.loader.setLoading(true);
    this.globalService.stage.removeAllComponents();

    await this.globalService.loadAllPdbsFromBackend(jobId, pdbFiles);

    this.globalService.currentlyShownPdb = null;
    this.toastr.success('Viewer refreshed from backend.');
  }

  /**
   * Smoothly scrolls the NGL viewer into view.
   * Triggered when:
   *  - a heatmap cell is clicked
   *  - a PDB is loaded
   *  - other components call scrollRequest$
   */
  private scrollToViewer(): void {
    if (!this.viewerSection?.nativeElement) return;

    setTimeout(() => {
      this.viewerSection.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest'
      });
    });
  }

  /**
   * Highlights a specific chain by:
   *  - selecting all residues in the chain
   *  - adding a temporary glowing yellow representation
   */
  focusChain() {
    if (!this.globalService.stage || !this.globalService.viewerSettings.focusChain.trim()) return;

    const chainInput = this.globalService.viewerSettings.focusChain.trim().toUpperCase();
    const comps = this.globalService.stage.compList;

    if (!comps.length) return;

    for (const comp of comps) {
      const structure = comp.structure;

      structure.eachChain((chainProxy: any) => {
        const chainName = chainProxy.chainname?.toUpperCase();

        if (chainName === chainInput) {

          const highlight = comp.addRepresentation(
            this.globalService.viewerSettings.representation,
            {
              sele: `:${chainName}`,
              color: 'yellow',
              opacity: 1.0,
              scale: 1.3,
            }
          );

          // fade out glow after 3 seconds
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
        }
      });
    }
  }

  /**
   * Smooth camera zoom animation, used when:
   *  - heatmap selects a mutation
   *  - PDB is loaded
   *  - dashboard triggers global animateZoom$
   */
  animateCameraZoom(factor = 0.8, duration = 1000) {
    if (!this.globalService.stage) return;

    const cam = this.globalService.stage.viewer.camera;
    const startZ = cam.position.z;
    const targetZ = startZ * factor;

    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2;

      cam.position.z = startZ - (startZ - targetZ) * eased;

      this.globalService.stage.viewer.requestRender();
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}