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

  selectedMutation: string = '';
  selectedMutationContent: string = '';
  
  destroy$ = new Subject<void>();

  zoomRequest$ = new Subject<void>();

  constructor(
    private toastr: ToastrService,
    public globalService: GlobalService,
    private loader: SpinnerComponentService,
  ) { }

  ngAfterViewInit() {
    this.globalService.showHeatmap$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.onShowAllHeatmap());
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onSelectMutation(mutation: string) {
    this.selectedMutation = mutation;

    const cached = this.globalService.parsedByFile[mutation];
    if (!cached) {
      this.toastr.error("Mutation not found in ZIP");
      return;
    }

    const filename = mutation.endsWith(".dat") ? mutation : `${mutation}.dat`;

    try {
      const jobId = localStorage.getItem("proteinJobId");
      this.selectedMutationContent = await this.globalService.getFile(jobId, filename);
    } catch {
      this.selectedMutationContent = "";
    }

    const residues = Array.from(new Set(cached.entries.map(e => e.residue)));
    const mutants = Array.from(new Set(cached.entries.map(e => e.mutant)));
    const z = residues.map(() => Array(mutants.length).fill(NaN));

    for (const e of cached.entries) {
      const y = residues.indexOf(e.residue);
      const x = mutants.indexOf(e.mutant);
      if (y !== -1 && x !== -1) z[y][x] = e.energy;
    }

    setTimeout(() => this.plotMutationHeatmap({ x: mutants, y: residues, z }), 50);
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

  // the "All heatmap" button — rebuild combined from cache
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
          ? Math.max(350, 100 + data.y.length * 25)
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
            div.on('plotly_click', async (ev: any) => {
              if (!this.globalService.stage) { this.toastr.warning('Viewer not ready yet.'); return; }

              const clickedResidueNo = parseInt(String(ev.points[0].y).replace(/[^\d]/g, ''), 10);
              if (!Number.isFinite(clickedResidueNo)) {
                this.toastr.warning('Could not read residue number from heatmap.');
                return;
              }
              const mutant = String(ev.points[0].x).trim().toLowerCase();

              console.log(`Heatmap click: residue ${clickedResidueNo}, mutant ${mutant}`);

              let target: string | undefined;

              if (this.selectedMutation === 'All Mutations') {
                const relaxedRx = new RegExp(`^joined_proc_${clickedResidueNo}_[a-z]2${mutant}\\.pdb$`, 'i');
                target = this.globalService.resultFiles.find(f => relaxedRx.test(f));
              } else {
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

                if (!target) {
                  const relaxedRx = new RegExp(`^joined_proc_${clickedResidueNo}_[a-z]2${mutant}\\.pdb$`, 'i');
                  target = this.globalService.resultFiles.find(f => relaxedRx.test(f));
                }
              }

              if (!target) {
                this.toastr.warning(`No PDB found for residue ${clickedResidueNo} → ${mutant.toUpperCase()}`);
                console.log('Available PDB files:', this.globalService.resultFiles.filter(f => f.endsWith('.pdb')));
                return;
              }

              console.log(`Loading PDB: ${target}`);

              const fileMatch = target.match(/^joined_proc_(\d+)_([a-z])2([a-z])\.pdb$/i);
              const posFromName = fileMatch ? parseInt(fileMatch[1], 10) : undefined;
              const mutOne = fileMatch ? fileMatch[3].toUpperCase() : undefined;

              const oneToThree: Record<string, string> = {
                A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY',
                H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER',
                T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL'
              };
              const mutantThree = mutOne ? oneToThree[mutOne] : undefined;

              const jobId = localStorage.getItem('proteinJobId');
              this.loader.setLoading(true);

              try {
                const pdbText = await this.globalService.getFile(jobId, target);
                const blob = new Blob([pdbText], { type: 'text/plain' });

                this.globalService.stage.removeAllComponents();

                const comp = await this.globalService.stage.loadFile(blob, { ext: 'pdb' });

                this.globalService.normalizeChainNames(comp.structure);
                comp.structure.eachAtom((a: any) => {
                  if (!a.chainname && a.segid) a.chainname = a.segid.trim();
                });

                comp.addRepresentation('cartoon', { colorScheme: 'chainname', opacity: 1.0 });

                await new Promise(r => setTimeout(r, 60));

                type ResInfo = { resno: number; resname: string; chainname: string; atomCount: number };
                const residues: ResInfo[] = [];

                comp.structure.eachResidue((r: any) => {
                  residues.push({
                    resno: Number(r.resno),
                    resname: String(r.resname || '').toUpperCase(),
                    chainname: String(r.chainname || ''),
                    atomCount: Number(r.atomCount || 0)
                  });
                });

                const findResidues = (pred: (r: ResInfo) => boolean) =>
                  residues.filter(pred);

                let candidates: ResInfo[] = [];

                if (Number.isFinite(posFromName)) {
                  candidates = findResidues(r => r.resno === posFromName);
                }

                if ((!candidates || candidates.length === 0) && mutantThree) {
                  candidates = findResidues(r => r.resname === mutantThree);
                }

                if ((!candidates || candidates.length === 0) && Number.isFinite(clickedResidueNo)) {
                  candidates = findResidues(r => r.resno === clickedResidueNo);
                }

                if (!candidates || candidates.length === 0) {
                  this.loader.setLoading(false);
                  this.toastr.warning(
                    `Could not locate the mutated residue in ${target}. ` +
                    (Number.isFinite(posFromName) ? `Tried resno ${posFromName}. ` : '') +
                    (mutantThree ? `Tried resname ${mutantThree}. ` : '')
                  );
                  return;
                }

                const preferProc = candidates.filter(r => r.chainname.toUpperCase() === 'PROC');
                let chosen = (preferProc.length ? preferProc : candidates)
                  .sort((a, b) => b.atomCount - a.atomCount)[0];

                const chainName = chosen.chainname.trim();
                const selectionStr = chainName ? `:${chainName} and ${chosen.resno}` : `${chosen.resno}`;

                comp.addRepresentation('ball+stick', {
                  sele: selectionStr,
                  color: 'yellow',
                  scale: 1.6,
                  aspectRatio: 1.4
                });

                try { comp.autoView(selectionStr); } catch { }
                
                this.zoomRequest$.next();

                this.globalService.stage.viewer.requestRender();

                this.loader.setLoading(false);
                this.toastr.info(
                  `Loaded ${target} ${chosen.resname}${chosen.resno}` +
                  (chainName ? ` (chain ${chainName})` : '')
                );
                this.globalService.scrollRequest$.next();

              } catch (err) {
                console.error('ZIP/Backend load error:', err);
                this.loader.setLoading(false);
                this.toastr.error(`Could not load PDB for ${target}`);
              }
            });
          });
      })
      .catch((err) => console.warn(err.message));
  }

}