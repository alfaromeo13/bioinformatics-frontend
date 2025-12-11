import JSZip from 'jszip';
import * as NGL from 'ngl';
import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { Subject, firstValueFrom } from 'rxjs';
import { ProteinHttpService } from "./protein.service";
import { SpinnerComponentService } from "../spinner-component/spinner.component.service";

@Injectable({ providedIn: 'root' })
export class GlobalService {

    zipMode = false;
    stage: any = null;
    showViewer = false;
    resultFiles: string[] = [];
    datMutations: string[] = [];
    zipData: JSZip | null = null;
    availableChains: string[] = [];
    currentlyShownPdb: string | null = null;

    parsedByFile: Record<string, {
        file: string; entries:
        { residue: string; mutant: string; energy: number }[]
    }> = {};

    viewerSettings = {
        representation: 'cartoon',
        color: 'chainname',
        focusChain: ''
    };

    showHeatmap$ = new Subject<void>(); // triger show heatmap
    animateZoom$ = new Subject<void>(); // animate zoom
    scrollRequest$ = new Subject<void>(); // trigger scroll from service

    constructor(
        private toastr: ToastrService,
        private loader: SpinnerComponentService,
        private proteinService: ProteinHttpService,
    ) { }

    /** Load a previously exported ZIP file (offline preview mode) */
    async loadExistingJob(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input?.files?.[0];

        if (!file || !file.name.endsWith('.zip')) {
            this.toastr.warning('Please select a valid results ZIP (.zip)');
            return;
        }

        this.loader.setLoading(true);

        try {
            // Load ZIP
            const zip = await JSZip.loadAsync(file);
            const allFiles = Object.keys(zip.files);

            // Activate ZIP mode
            this.zipMode = true;
            this.zipData = zip;

            // disable backend mode
            localStorage.removeItem("proteinJobId");

            this.resultFiles = allFiles;
            this.toastr.success('Preview loaded from ZIP');

            const pdbFiles = allFiles.filter(f => f.endsWith('.pdb'));
            const datFiles = allFiles.filter(f => f.endsWith('.dat'));

            this.showViewer = true;
            await new Promise(r => setTimeout(r));

            if (!this.stage) {
                this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
                window.addEventListener("resize", () => this.stage.handleResize(), false);
            } else {
                this.stage.removeAllComponents();
            }

            // Load PDBs from ZIP
            for (const pdb of pdbFiles) {
                const content = await zip.file(pdb)!.async("string");
                const blob = new Blob([content], { type: "text/plain" });
                const comp = await this.stage.loadFile(blob, { ext: "pdb" });

                this.normalizeChainNames(comp.structure);
                comp.addRepresentation("cartoon", { colorScheme: "chainname" });
            }

            this.stage.autoView();
            this.animateZoom$.next();
            this.availableChains = this.getAvailableChains();
            this.scrollRequest$.next();

            // Load DAT files into parsedByFile
            if (datFiles.length) {
                for (const dat of datFiles) {
                    const content = await zip.file(dat)!.async("string");
                    const parsed = this.parseFullDat(content, dat);
                    const key = dat.replace(/\.dat$/i, "");
                    this.parsedByFile[key] = parsed;
                }

                this.datMutations = Object.keys(this.parsedByFile);
                this.showHeatmap$.next();
            }

        } catch (err) {
            console.error("ZIP load error:", err);
            this.toastr.error("Failed to load ZIP preview");
        } finally {
            this.loader.setLoading(false);
        }
    }

    /** Ensure chainname is populated from segid if chainname is empty */
    normalizeChainNames(structure: any): void {
        structure.eachAtom((a: any) => {
            if (!a.chainname && a.segid) {
                a.chainname = a.segid.trim();
            }
        });

        // Log the distinct chain names detected
        const found = new Set<string>();
        structure.eachChain((c: any) => found.add(c.chainname));
        console.log('Normalized chains:', Array.from(found));
    }

    /** Parse a full .dat file into structured energy data */
    parseFullDat(content: string, filename: string) {
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

    getAvailableChains(): string[] {
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

    async loadAllPdbsFromBackend(jobId: string, pdbFiles: string[]): Promise<void> {
        this.showViewer = true;
        await new Promise(r => setTimeout(r));

        if (!this.stage) {
            this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
            window.addEventListener("resize", () => this.stage.handleResize(), false);
        } else {
            this.stage.removeAllComponents();
        }

        for (const filename of pdbFiles) {
            try {
                const text = await this.getFile(jobId, filename);
                const blob = new Blob([text], { type: "text/plain" });
                const comp = await this.stage.loadFile(blob, { ext: "pdb" });

                this.normalizeChainNames(comp.structure);
                comp.addRepresentation(this.viewerSettings.representation, {
                    colorScheme: this.viewerSettings.color
                });

            } catch (err) {
                console.error(err);
                this.toastr.error(`Failed to load ${filename}`);
            }
        }

        this.stage.autoView();
        this.animateZoom$.next();
        this.availableChains = this.getAvailableChains();
        this.loader.setLoading(false);
    }

    async getFile(jobId: string | null, filename: string): Promise<string> {
        if (this.zipMode && this.zipData) {
            const z = this.zipData.file(filename);
            if (!z) throw new Error(`ZIP missing file ${filename}`);
            return await z.async("string");
        }
        return await firstValueFrom(this.proteinService.getFileContent(jobId!, filename));
    }
}