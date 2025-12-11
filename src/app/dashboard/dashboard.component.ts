import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { firstValueFrom, Subject, takeUntil } from 'rxjs';
import Plotly from 'plotly.js-dist-min';
import { AfterViewInit, Component, OnDestroy, ViewChild } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { GlobalService } from '../global-service/global.service';
import { ProteinHttpService } from '../global-service/protein.service';
import { NglViewerComponent } from '../ngl-viewer/ngl-viewer.component';
import { MutationAnalysisComponent } from '../mutation-analysis/mutation-analysis.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements AfterViewInit, OnDestroy {

  /** Direct references to child components in the dashboard */
  @ViewChild('viewer') viewer!: NglViewerComponent;
  @ViewChild('mutations') mutations!: MutationAnalysisComponent;

  /** Emits when component is destroyed, used to auto-unsubscribe */
  destroy$ = new Subject<void>();

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private proteinService: ProteinHttpService,
  ) { }

  /**
   * After child views render, connect mutation heatmap click → trigger zoom in viewer.
   */
  ngAfterViewInit() {
    this.mutations.zoomRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.viewer.animateCameraZoom());
  }

  /**
   * Cleanup subscriptions on destroy to prevent memory leaks.
   */
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Exports all analysis results into a single ZIP file.
   * Includes: PDB files, DAT files, viewer screenshot, combined heatmap image.
   */
  async exportResults() {
    if (!this.globalService.resultFiles.length) {
      this.toastr.warning('No results to export yet.');
      return;
    }

    const jobId = localStorage.getItem('proteinJobId');
    const zip = new JSZip();

    /** ---------------------------
     * 1. Add all PDB + DAT files
     * -------------------------- */
    for (const file of this.globalService.resultFiles.filter(f => f.endsWith('.pdb') || f.endsWith('.dat'))) {
      const res = await firstValueFrom(this.proteinService.getFileContent(jobId!, file));
      zip.file(file, res);
    }

    /** ---------------------------
     * 2. Add viewer screenshot
     * -------------------------- */
    try {
      const viewerBlob = await this.viewer.makePhoto();
      zip.file('viewer_snapshot.png', viewerBlob);
    } catch {
      this.toastr.warning("Viewer image could not be captured.");
    }

    /** ---------------------------
     * 3. Add combined heatmap image
     * -------------------------- */
    try {
      // Force "All Mutations" heatmap if needed
      if (this.mutations.selectedMutation !== 'All Mutations') {
        this.globalService.showHeatmap$.next();
        await new Promise(resolve => setTimeout(resolve, 500)); // allow Plotly to redraw
      }

      const heatmapDiv = document.getElementById('mutationHeatmapDiv');
      if (!heatmapDiv) throw new Error('Heatmap not found');

      // Convert DOM heatmap to PNG
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

    /** ---------------------------
     * 4. Trigger ZIP download
     * -------------------------- */
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `results_${jobId}.zip`);
    this.toastr.success('Results exported successfully!');
  }
}