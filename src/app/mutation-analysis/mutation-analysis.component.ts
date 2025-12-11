import Plotly from 'plotly.js-dist-min';
import { ToastrService } from 'ngx-toastr';
import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { GlobalService } from '../global-service/global.service';
import { SpinnerComponentService } from '../spinner-component/spinner.component.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-mutation-analysis',
  styleUrl: './mutation-analysis.component.css',
  templateUrl: './mutation-analysis.component.html',
})
export class MutationAnalysisComponent implements AfterViewInit, OnDestroy {

  /** Name of the mutation currently selected by the user */
  selectedMutation: string = '';

  /** Full text content of the selected .dat file */
  selectedMutationContent: string = '';

  /** Emits on destroy to automatically clean subscriptions */
  destroy$ = new Subject<void>();

  /** Notifies the NGL viewer that a zoom-in should occur (heatmap click → viewer zoom) */
  zoomRequest$ = new Subject<void>();

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private loader: SpinnerComponentService,
  ) { }

  /**
   * Subscribe to external heatmap refresh requests.
   * This triggers when ZIP is loaded or export forces “show all heatmap”.
   */
  ngAfterViewInit() {
    this.globalService.showHeatmap$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.onShowAllHeatmap());
  }

  /** Cleanup subscriptions to prevent memory leaks */
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Handles user selecting a specific mutation.
   * Loads its .dat file, parses residue/mutant grid, and re-renders the heatmap.
   */
  async onSelectMutation(mutation: string) {
    this.selectedMutation = mutation;

    const cached = this.globalService.parsedByFile[mutation];
    if (!cached) {
      this.toastr.error("Mutation not found in ZIP");
      return;
    }

    const filename = mutation.endsWith(".dat") ? mutation : `${mutation}.dat`;

    // load .dat file contents (ZIP or backend)
    try {
      const jobId = localStorage.getItem("proteinJobId");
      this.selectedMutationContent = await this.globalService.getFile(jobId, filename);
    } catch {
      this.selectedMutationContent = "";
    }

    // prepare heatmap matrix
    const residues = Array.from(new Set(cached.entries.map(e => e.residue)));
    const mutants = Array.from(new Set(cached.entries.map(e => e.mutant)));
    const z = residues.map(() => Array(mutants.length).fill(NaN));

    for (const e of cached.entries) {
      const y = residues.indexOf(e.residue);
      const x = mutants.indexOf(e.mutant);
      if (y !== -1 && x !== -1) z[y][x] = e.energy;
    }

    // small delay allows Angular to insert the heatmap container
    setTimeout(() => this.plotMutationHeatmap({ x: mutants, y: residues, z }), 50);
  }

  /**
   * Utility to wait until an element appears in the DOM.
   * Used because Plotly requires the container to exist before rendering.
   */
  private async waitForElement(id: string, timeout = 2000): Promise<HTMLElement> {
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        if (Date.now() - start > timeout)
          return reject(new Error(`Timeout waiting for element: ${id}`));
        requestAnimationFrame(check);
      };
      check();
    });
  }

  /**
   * Render the "combined" heatmap using all parsed DAT data.
   * Triggered when user clicks “Show all” or when ZIP loads.
   */
  onShowAllHeatmap() {
    const all = Object.values(this.globalService.parsedByFile);
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
    this.selectedMutationContent = '';
    this.plotMutationHeatmap({ x: mutants, y: residues, z });
  }

  /**
   * Draws a heatmap (specific mutation or combined) and attaches click handler.
   * A click identifies a target residue + mutant and loads the corresponding PDB.
   */
  plotMutationHeatmap(data: { x: string[]; y: string[]; z: number[][] }) {
    const isAll = this.selectedMutation === 'All Mutations';

    this.waitForElement('mutationHeatmapDiv')
      .then((el) => {
        // dynamic height adjustments
        el.style.minHeight = isAll ? '400px' : '180px';
        el.style.display = 'block';

        const dynamicHeight = isAll
          ? Math.max(350, 100 + data.y.length * 25)
          : 180;

        // plotly trace
        const trace = {
          type: 'heatmap',
          x: data.x,
          y: data.y,
          z: data.z,
          colorscale: [
            [0, 'rgb(43,47,129)'],
            [0.5, 'rgb(255,255,255)'],
            [1, 'rgb(190,14,54)'],
          ],
          hovertemplate: 'Residue %{y}, Mutant %{x}: %{z:.2f}<extra></extra>',
          showscale: true,
          xgap: 1,
          ygap: 1,
        } as any;

        // layout styling
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
            title: 'Mutant',
            tickfont: { size: 12, color: '#abb1bf' },
          },
          yaxis: {
            title: 'Residue',
            tickfont: { size: 12, color: '#abb1bf' },
          },
          plot_bgcolor: '#000000ff',
          paper_bgcolor: '#f5f5f5',
        } as any;

        // draw heatmap
        Plotly.newPlot('mutationHeatmapDiv', [trace], layout, { responsive: true })
          .then((div: any) => {
            /**
             * When clicking a heatmap cell:
             * 1. Determine residue + mutant
             * 2. Find matching PDB file in results
             * 3. Load PDB in NGL viewer
             * 4. Highlight residue and zoom in
             */
            div.on('plotly_click', async (ev: any) => {

              if (!this.globalService.stage) {
                this.toastr.warning('Viewer not ready yet.');
                return;
              }

              // ------------------------------
              // Extract clicked residue/mutant
              // ------------------------------
              const clickedResidueNo = parseInt(String(ev.points[0].y).replace(/[^\d]/g, ''), 10);
              if (!Number.isFinite(clickedResidueNo)) {
                this.toastr.warning('Could not read residue number.');
                return;
              }

              const mutant = String(ev.points[0].x).trim().toLowerCase();
              let target: string | undefined;

              // ------------------------------
              // Find corresponding PDB file
              // ------------------------------
              if (this.selectedMutation === 'All Mutations') {
                const relaxedRx = new RegExp(`^joined_proc_${clickedResidueNo}_[a-z]2${mutant}\\.pdb$`, 'i');
                target = this.globalService.resultFiles.find(f => relaxedRx.test(f));

              } else {
                // parse "inter_ener_wtPosMut" naming pattern
                const rowMatch = (this.selectedMutation || '')
                  .match(/inter_ener_([a-z]{3})(\d+)([a-z])$/i);

                const threeToOne: Record<string, string> = {
                  ala: 'a', arg: 'r', asn: 'n', asp: 'd', cys: 'c', gln: 'q', glu: 'e', gly: 'g',
                  his: 'h', ile: 'i', leu: 'l', lys: 'k', met: 'm', phe: 'f', pro: 'p', ser: 's',
                  thr: 't', trp: 'w', tyr: 'y', val: 'v'
                };

                let wildOne = '';
                if (rowMatch) {
                  const wild3 = rowMatch[1].toLowerCase();
                  wildOne = threeToOne[wild3] || '';
                }

                if (wildOne) {
                  const strictRx = new RegExp(`^joined_proc_${clickedResidueNo}_${wildOne}2${mutant}\\.pdb$`, 'i');
                  target = this.globalService.resultFiles.find(f => strictRx.test(f));
                }

                // fallback: allow any wildtype letter
                if (!target) {
                  const relaxedRx = new RegExp(`^joined_proc_${clickedResidueNo}_[a-z]2${mutant}\\.pdb$`, 'i');
                  target = this.globalService.resultFiles.find(f => relaxedRx.test(f));
                }
              }

              if (!target) {
                this.toastr.warning(
                  `No PDB found for residue ${clickedResidueNo} → ${mutant.toUpperCase()}`
                );
                return;
              }

              // ------------------------------
              // Load the selected PDB into viewer
              // ------------------------------
              const jobId = localStorage.getItem('proteinJobId');
              this.loader.setLoading(true);

              try {
                const pdbText = await this.globalService.getFile(jobId, target);
                const blob = new Blob([pdbText], { type: 'text/plain' });

                // reset stage and load model
                this.globalService.stage.removeAllComponents();
                const comp = await this.globalService.stage.loadFile(blob, { ext: 'pdb' });

                this.globalService.normalizeChainNames(comp.structure);
                comp.addRepresentation('cartoon', { colorScheme: 'chainname' });

                // find residue in structure for highlighting
                await new Promise(r => setTimeout(r, 60));

                type ResInfo = { resno: number; resname: string; chainname: string; atomCount: number };
                const residues: ResInfo[] = [];

                comp.structure.eachResidue((r: any) => {
                  residues.push({
                    resno: Number(r.resno),
                    resname: String(r.resname).toUpperCase(),
                    chainname: String(r.chainname),
                    atomCount: Number(r.atomCount)
                  });
                });

                // try resolving residue by number, name, chain etc.
                const candidates = residues.filter(r =>
                  r.resno === clickedResidueNo
                );

                if (!candidates.length) {
                  this.toastr.warning(`Could not locate residue in ${target}`);
                  this.loader.setLoading(false);
                  return;
                }

                const chosen = candidates.sort((a, b) => b.atomCount - a.atomCount)[0];
                const chain = chosen.chainname;
                const selectionStr = chain ? `:${chain} and ${chosen.resno}` : `${chosen.resno}`;

                // highlight clicked residue
                comp.addRepresentation('ball+stick', {
                  sele: selectionStr,
                  color: 'yellow',
                  scale: 1.6,
                  aspectRatio: 1.4
                });

                // auto center + zoom viewer
                try { comp.autoView(selectionStr); } catch { }
                this.zoomRequest$.next();

                this.globalService.stage.viewer.requestRender();
                this.loader.setLoading(false);

                this.toastr.info(
                  `Loaded ${target} → ${chosen.resname}${chosen.resno} (chain ${chain || 'N/A'})`
                );

                // scroll viewer into view
                this.globalService.scrollRequest$.next();

              } catch (err) {
                console.error('PDB load error:', err);
                this.loader.setLoading(false);
                this.toastr.error(`Could not load PDB: ${target}`);
              }
            });
          });
      })
      .catch((err) => console.warn(err.message));
  }
}