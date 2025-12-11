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

  @ViewChild('viewer') viewer!: NglViewerComponent;
  @ViewChild('mutations') mutations!: MutationAnalysisComponent;
  destroy$ = new Subject<void>();

  ngAfterViewInit() {
    this.mutations.zoomRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.viewer.animateCameraZoom());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private proteinService: ProteinHttpService,
  ) { }

  async exportResults() {
    if (!this.globalService.resultFiles.length) {
      this.toastr.warning('No results to export yet.');
      return;
    }

    const jobId = localStorage.getItem('proteinJobId');
    const zip = new JSZip();

    // Include all PDB and DAT files
    for (const file of this.globalService.resultFiles.filter(f => f.endsWith('.pdb') || f.endsWith('.dat'))) {
      const res = await firstValueFrom(this.proteinService.getFileContent(jobId!, file));
      zip.file(file, res);
    }

    // Add viewer image snapshot
    try {
      const viewerBlob = await this.viewer.makePhoto();
      zip.file('viewer_snapshot.png', viewerBlob);
    } catch (err) {
      this.toastr.warning("Viewer image could not be captured.");
    }

    // Generate and add heatmap image
    try {
      // Force "Show All" heatmap if not already selected
      if (this.mutations.selectedMutation !== 'All Mutations') {
        this.globalService.showHeatmap$.next();
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